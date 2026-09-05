import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type {
  RniSourceCommitResult,
  RniSourceItem,
  RniSourcePersistencePort,
} from '@/rni/contracts';
import {
  runPersistSourceStage,
  type RniCompletedSourceCheckpoint,
  type RniPersistSourceDependencies,
  type RniPersistSourceRequest,
  type RniWorkflowBudgetPort,
  type RniWorkflowClaim,
  type RniWorkflowClock,
  type RniWorkflowError,
  type RniWorkflowPort,
  type RniWorkflowStepKey,
} from '@/rni/workflow';

const runId = '00000000-0000-4000-8000-000000000301';
const proposedSourceId = '00000000-0000-4000-8000-000000000302';
const durableSourceId = '00000000-0000-4000-8000-000000000399';

function source(overrides: Partial<RniSourceItem> = {}): RniSourceItem {
  return {
    id: proposedSourceId,
    platform: 'reddit',
    sourceKind: 'post',
    externalId: 't3_rni_e03',
    canonicalUrl: 'https://www.reddit.com/r/stocks/comments/rni_e03/source_first/',
    originalUrl: 'https://www.reddit.com/r/stocks/comments/rni_e03/source_first/?context=3',
    subredditOrScope: 'r/stocks',
    authorHandleHash: null,
    title: 'Source-first evidence',
    boundedContent: 'NVDA execution remains the central claim.',
    contentSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    captureMode: 'full_post',
    publishedAt: '2026-09-05T00:00:00.000Z',
    discoveredAt: '2026-09-05T00:05:00.000Z',
    observedAt: '2026-09-05T00:05:00.000Z',
    searchQueryId: '00000000-0000-4000-8000-000000000303',
    providerRequestId: 'resp_rni_e03',
    metadata: { score: 42, nested: { b: 2, a: 1 } },
    rightsPolicyVersion: 'rni-source-policy-v1',
    createdAt: '2026-09-05T00:05:01.000Z',
    ...overrides,
  };
}

function request(sourceInput = source()): RniPersistSourceRequest {
  return {
    runId,
    subjectId: 'reddit:t3_rni_e03',
    stageVersion: 'rni-persist-source-v1',
    source: sourceInput,
  };
}

class TestClock implements RniWorkflowClock {
  #time = Date.parse('2026-09-05T02:00:00.000Z');
  #holdNextSleep = false;
  #releaseHeldSleep: (() => void) | null = null;
  #sleepStarted: ((ms: number) => void) | null = null;
  readonly sleeps: number[] = [];

  now(): Date {
    return new Date(this.#time);
  }

  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    if (this.#holdNextSleep) {
      this.#holdNextSleep = false;
      this.#sleepStarted?.(ms);
      await new Promise<void>((resolve) => {
        this.#releaseHeldSleep = resolve;
      });
    }
    this.#time += ms;
  }

  advance(ms: number): void {
    this.#time += ms;
  }

  holdSleep(): Promise<number> {
    this.#holdNextSleep = true;
    return new Promise((resolve) => {
      this.#sleepStarted = resolve;
    });
  }

  releaseSleep(): void {
    this.#releaseHeldSleep?.();
    this.#releaseHeldSleep = null;
  }
}

class WorkflowFault extends Error {
  constructor(
    readonly classification: RniWorkflowError['classification'],
    readonly code: string,
  ) {
    super(code);
  }
}

function classify(error: unknown): RniWorkflowError {
  if (error instanceof WorkflowFault) {
    return { classification: error.classification, code: error.code };
  }
  return { classification: 'permanent', code: 'UNEXPECTED_TEST_ERROR' };
}

type StoredStep = {
  key: RniWorkflowStepKey;
  idempotencyKey: string;
  inputHash: string;
  attempt: number;
  startedAt: string;
  commitResult: RniSourceCommitResult | null;
  leaseOwner: string | null;
  leaseUntil: string | null;
  notBefore: string | null;
  completed: RniCompletedSourceCheckpoint | null;
};

class MemoryWorkflow implements RniWorkflowPort {
  readonly steps = new Map<string, StoredStep>();
  readonly jobs = new Map<string, { runId: string; sourceItemId: string; stageVersion: string }>();
  readonly failures: Array<Parameters<RniWorkflowPort['recordFailure']>[0]> = [];
  readonly budgetStops: Array<Parameters<RniWorkflowPort['recordBudgetStop']>[0]> = [];
  readonly heartbeatSections: string[] = [];
  readonly activeHeartbeats = new Set<string>();
  crashCheckpointOnce = false;
  crashCompleteOnce = false;

  async claimStep(
    input: Parameters<RniWorkflowPort['claimStep']>[0],
  ): Promise<RniWorkflowClaim> {
    const current = this.steps.get(input.idempotencyKey);
    if (current?.inputHash !== undefined && current.inputHash !== input.inputHash) {
      throw new Error('fake input hash conflict');
    }
    if (current?.completed !== null && current?.completed !== undefined) {
      return { kind: 'completed', checkpoint: current.completed };
    }
    if (
      current?.notBefore !== null &&
      current?.notBefore !== undefined &&
      Date.parse(current.notBefore) > Date.parse(input.leasedAt)
    ) {
      return { kind: 'busy', retryAt: current.notBefore };
    }
    if (this.activeHeartbeats.has(input.idempotencyKey) && current?.leaseUntil !== null) {
      const renewedUntil = new Date(Date.parse(input.leasedAt) + 10_000).toISOString();
      if (current !== undefined) current.leaseUntil = renewedUntil;
      return { kind: 'busy', retryAt: renewedUntil };
    }
    if (
      current?.leaseUntil !== null &&
      current?.leaseUntil !== undefined &&
      Date.parse(current.leaseUntil) > Date.parse(input.leasedAt)
    ) {
      return { kind: 'busy', retryAt: current.leaseUntil };
    }

    const next: StoredStep = {
      key: input.key,
      idempotencyKey: input.idempotencyKey,
      inputHash: input.inputHash,
      attempt: (current?.attempt ?? 0) + 1,
      startedAt: current?.startedAt ?? input.leasedAt,
      commitResult: current?.commitResult ?? null,
      leaseOwner: input.leaseOwner,
      leaseUntil: input.leaseUntil,
      notBefore: null,
      completed: null,
    };
    this.steps.set(input.idempotencyKey, next);
    return {
      kind: 'acquired',
      attempt: next.attempt,
      inputHash: next.inputHash,
      startedAt: next.startedAt,
      priorCommitResult: next.commitResult,
    };
  }

  async withLeaseHeartbeat<T>(
    input: Parameters<RniWorkflowPort['withLeaseHeartbeat']>[0],
    operation: () => Promise<T>,
  ): Promise<T> {
    this.owned(input.idempotencyKey, input.leaseOwner);
    this.heartbeatSections.push(input.idempotencyKey);
    this.activeHeartbeats.add(input.idempotencyKey);
    try {
      return await operation();
    } finally {
      this.activeHeartbeats.delete(input.idempotencyKey);
    }
  }

  async checkpointSourceCommit(
    input: Parameters<RniWorkflowPort['checkpointSourceCommit']>[0],
  ): Promise<void> {
    if (this.crashCheckpointOnce) {
      this.crashCheckpointOnce = false;
      throw new WorkflowFault('crash', 'SIMULATED_PROCESS_CRASH');
    }
    this.owned(input.idempotencyKey, input.leaseOwner).commitResult = input.commitResult;
  }

  async enqueueInterpretation(
    input: Parameters<RniWorkflowPort['enqueueInterpretation']>[0],
  ): Promise<{ enqueued: boolean }> {
    const enqueued = !this.jobs.has(input.idempotencyKey);
    this.jobs.set(input.idempotencyKey, {
      runId: input.runId,
      sourceItemId: input.sourceItemId,
      stageVersion: input.stageVersion,
    });
    return { enqueued };
  }

  async completeStep(
    input: Parameters<RniWorkflowPort['completeStep']>[0],
  ): Promise<void> {
    if (this.crashCompleteOnce) {
      this.crashCompleteOnce = false;
      throw new WorkflowFault('crash', 'SIMULATED_PROCESS_CRASH');
    }
    const step = this.owned(input.idempotencyKey, input.leaseOwner);
    const { leaseOwner: _leaseOwner, ...checkpoint } = input;
    step.completed = checkpoint;
    step.leaseOwner = null;
    step.leaseUntil = null;
  }

  async recordFailure(input: Parameters<RniWorkflowPort['recordFailure']>[0]): Promise<void> {
    const step = this.owned(input.idempotencyKey, input.leaseOwner);
    step.leaseOwner = null;
    step.leaseUntil = null;
    step.notBefore = input.retryAt;
    this.failures.push(input);
  }

  async recordBudgetStop(
    input: Parameters<RniWorkflowPort['recordBudgetStop']>[0],
  ): Promise<void> {
    const step = this.owned(input.idempotencyKey, input.leaseOwner);
    step.leaseOwner = null;
    step.leaseUntil = null;
    step.notBefore = null;
    this.budgetStops.push(input);
  }

  private owned(idempotencyKey: string, leaseOwner: string): StoredStep {
    const step = this.steps.get(idempotencyKey);
    if (step === undefined || step.leaseOwner !== leaseOwner) {
      throw new Error('fake lease ownership conflict');
    }
    return step;
  }
}

class MemorySourcePersistence implements RniSourcePersistencePort {
  readonly commitSource = vi.fn(async (): Promise<RniSourceCommitResult> => {
    const duplicate = this.commitSource.mock.calls.length > 1;
    return {
      sourceItemId: durableSourceId,
      sourceInserted: !duplicate,
      retrievalInserted: !duplicate,
      contentVersionInserted: !duplicate,
    };
  });
}

function allowingBudget(): RniWorkflowBudgetPort {
  return { reserve: vi.fn(async () => ({ allowed: true as const })) };
}

function dependencies(
  workflow: MemoryWorkflow,
  sourcePersistence: RniSourcePersistencePort,
  clock: TestClock,
  overrides: Partial<RniPersistSourceDependencies> = {},
): RniPersistSourceDependencies {
  return {
    sourcePersistence,
    workflow,
    budget: allowingBudget(),
    clock,
    leaseOwner: 'worker-1',
    classifyError: classify,
    policy: {
      maxAttempts: 3,
      maxWallTimeMs: 30_000,
      leaseMs: 10_000,
      heartbeatEveryMs: 3_000,
      baseBackoffMs: 500,
      backoffFactor: 2,
      maxBackoffMs: 8_000,
      random: () => 0.5,
    },
    ...overrides,
  };
}

describe('RNI persist-source workflow stage', () => {
  it('persists first and dispatches only the committed source identity', async () => {
    const workflow = new MemoryWorkflow();
    const persistence = new MemorySourcePersistence();
    const clock = new TestClock();

    const result = await runPersistSourceStage(
      request(),
      dependencies(workflow, persistence, clock),
    );

    expect(result).toMatchObject({
      status: 'completed',
      attempt: 1,
      semanticDispatch: 'enqueued',
      commitResult: { sourceItemId: durableSourceId },
    });
    expect([...workflow.jobs.values()]).toEqual([
      { runId, sourceItemId: durableSourceId, stageVersion: 'rni-persist-source-v1' },
    ]);
    expect([...workflow.jobs.values()][0]?.sourceItemId).not.toBe(proposedSourceId);
    expect(workflow.heartbeatSections).toHaveLength(1);
  });

  it('replays commit safely after a crash between commit and checkpoint', async () => {
    const workflow = new MemoryWorkflow();
    workflow.crashCheckpointOnce = true;
    const persistence = new MemorySourcePersistence();
    const clock = new TestClock();
    const reservations = new Set<string>();
    const budget: RniWorkflowBudgetPort = {
      reserve: vi.fn(async (input) => {
        if (reservations.has(input.reservationKey)) return { allowed: true as const };
        if (reservations.size > 0) return { allowed: false as const, reason: 'sources' as const };
        reservations.add(input.reservationKey);
        return { allowed: true as const };
      }),
    };

    await expect(
      runPersistSourceStage(
        request(),
        dependencies(workflow, persistence, clock, { budget }),
      ),
    ).rejects.toThrow('SIMULATED_PROCESS_CRASH');

    clock.advance(10_001);
    const result = await runPersistSourceStage(
      request(source({ id: randomUUID() })),
      dependencies(workflow, persistence, clock, { budget, leaseOwner: 'worker-2' }),
    );

    expect(persistence.commitSource).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      status: 'completed',
      attempt: 2,
      commitResult: {
        sourceItemId: durableSourceId,
        sourceInserted: false,
        retrievalInserted: false,
        contentVersionInserted: false,
      },
    });
    expect(workflow.jobs).toHaveLength(1);
    expect(budget.reserve).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(budget.reserve).mock.calls.map(([input]) => input.reservationKey),
    ).toEqual([expect.any(String), expect.any(String)]);
    expect(
      vi.mocked(budget.reserve).mock.calls[0]?.[0].reservationKey,
    ).toBe(vi.mocked(budget.reserve).mock.calls[1]?.[0].reservationKey);
  });

  it('deduplicates dispatch after a crash between enqueue and completion', async () => {
    const workflow = new MemoryWorkflow();
    workflow.crashCompleteOnce = true;
    const persistence = new MemorySourcePersistence();
    const clock = new TestClock();

    await expect(
      runPersistSourceStage(request(), dependencies(workflow, persistence, clock)),
    ).rejects.toThrow('SIMULATED_PROCESS_CRASH');

    clock.advance(10_001);
    const result = await runPersistSourceStage(
      request(),
      dependencies(workflow, persistence, clock, { leaseOwner: 'worker-2' }),
    );

    expect(persistence.commitSource).toHaveBeenCalledTimes(1);
    expect(workflow.jobs).toHaveLength(1);
    expect(result).toMatchObject({
      status: 'completed',
      attempt: 2,
      semanticDispatch: 'deduplicated',
    });
  });

  it('returns the completed checkpoint on exact redelivery without repeating work or budget', async () => {
    const workflow = new MemoryWorkflow();
    const persistence = new MemorySourcePersistence();
    const clock = new TestClock();
    const budget = allowingBudget();
    const deps = dependencies(workflow, persistence, clock, { budget });

    const first = await runPersistSourceStage(request(), deps);
    const duplicate = await runPersistSourceStage(
      request(source({ id: randomUUID(), metadata: { nested: { a: 1, b: 2 }, score: 42 } })),
      { ...deps, leaseOwner: 'worker-2' },
    );

    expect(duplicate).toEqual(first);
    expect(persistence.commitSource).toHaveBeenCalledTimes(1);
    expect(budget.reserve).toHaveBeenCalledTimes(1);
    expect(workflow.jobs).toHaveLength(1);
  });

  it('fails closed when a completed checkpoint output hash does not bind its durable source ID', async () => {
    const workflow = new MemoryWorkflow();
    const persistence = new MemorySourcePersistence();
    const clock = new TestClock();
    await runPersistSourceStage(request(), dependencies(workflow, persistence, clock));
    const stored = [...workflow.steps.values()][0];
    if (stored?.completed === null || stored?.completed === undefined) {
      throw new Error('test expected a completed checkpoint');
    }
    stored.completed = {
      ...stored.completed,
      outputHash: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    };

    await expect(
      runPersistSourceStage(
        request(),
        dependencies(workflow, persistence, clock, { leaseOwner: 'worker-2' }),
      ),
    ).rejects.toThrow('RNI workflow checkpoint output hash conflict');
    expect(persistence.commitSource).toHaveBeenCalledTimes(1);
  });

  it('retries only classified transient failures with deterministic full jitter', async () => {
    const workflow = new MemoryWorkflow();
    const clock = new TestClock();
    const commitSource = vi
      .fn<RniSourcePersistencePort['commitSource']>()
      .mockRejectedValueOnce(new WorkflowFault('transient', 'DATABASE_UNAVAILABLE'))
      .mockResolvedValueOnce({
        sourceItemId: durableSourceId,
        sourceInserted: true,
        retrievalInserted: true,
        contentVersionInserted: true,
      });

    const result = await runPersistSourceStage(
      request(),
      dependencies(workflow, { commitSource }, clock),
    );

    expect(result).toMatchObject({ status: 'completed', attempt: 2 });
    expect(commitSource).toHaveBeenCalledTimes(2);
    expect(clock.sleeps).toEqual([250]);
    expect(workflow.failures).toHaveLength(1);
    expect(workflow.failures[0]).toMatchObject({
      attempt: 1,
      errorClass: 'transient',
      errorCode: 'DATABASE_UNAVAILABLE',
      retryAt: '2026-09-05T02:00:00.250Z',
    });
  });

  it('persists retry not-before so concurrent redelivery cannot bypass backoff', async () => {
    const workflow = new MemoryWorkflow();
    const clock = new TestClock();
    const sleepStarted = clock.holdSleep();
    const commitSource = vi
      .fn<RniSourcePersistencePort['commitSource']>()
      .mockRejectedValueOnce(new WorkflowFault('transient', 'DATABASE_UNAVAILABLE'))
      .mockResolvedValueOnce({
        sourceItemId: durableSourceId,
        sourceInserted: true,
        retrievalInserted: true,
        contentVersionInserted: true,
      });
    const budget = allowingBudget();
    const first = runPersistSourceStage(
      request(),
      dependencies(workflow, { commitSource }, clock, { budget, leaseOwner: 'worker-1' }),
    );

    expect(await sleepStarted).toBe(250);
    const concurrent = await runPersistSourceStage(
      request(),
      dependencies(workflow, { commitSource }, clock, { budget, leaseOwner: 'worker-2' }),
    );
    expect(concurrent).toMatchObject({
      status: 'deferred',
      retryAt: '2026-09-05T02:00:00.250Z',
    });
    expect(commitSource).toHaveBeenCalledTimes(1);

    clock.releaseSleep();
    await expect(first).resolves.toMatchObject({ status: 'completed', attempt: 2 });
    expect(commitSource).toHaveBeenCalledTimes(2);
  });

  it('does not retry permanent failures', async () => {
    const workflow = new MemoryWorkflow();
    const clock = new TestClock();
    const commitSource = vi
      .fn<RniSourcePersistencePort['commitSource']>()
      .mockRejectedValue(new WorkflowFault('permanent', 'SOURCE_IDENTITY_CONFLICT'));

    const result = await runPersistSourceStage(
      request(),
      dependencies(workflow, { commitSource }, clock),
    );

    expect(result).toMatchObject({
      status: 'failed',
      attempt: 1,
      errorClass: 'permanent',
      errorCode: 'SOURCE_IDENTITY_CONFLICT',
    });
    expect(commitSource).toHaveBeenCalledTimes(1);
    expect(clock.sleeps).toEqual([]);
    expect(workflow.jobs).toHaveLength(0);
  });

  it('bounds transient retries by the configured attempt budget', async () => {
    const workflow = new MemoryWorkflow();
    const clock = new TestClock();
    const commitSource = vi
      .fn<RniSourcePersistencePort['commitSource']>()
      .mockRejectedValue(new WorkflowFault('transient', 'DATABASE_UNAVAILABLE'));

    const result = await runPersistSourceStage(
      request(),
      dependencies(workflow, { commitSource }, clock),
    );

    expect(result).toMatchObject({
      status: 'failed',
      attempt: 3,
      errorClass: 'transient',
      errorCode: 'DATABASE_UNAVAILABLE',
    });
    expect(commitSource).toHaveBeenCalledTimes(3);
    expect(clock.sleeps).toEqual([250, 500]);
    expect(workflow.failures.map((failure) => failure.attempt)).toEqual([1, 2, 3]);
    expect(workflow.jobs).toHaveLength(0);
  });

  it('stops before source persistence when the atomic budget gate denies the attempt', async () => {
    const workflow = new MemoryWorkflow();
    const persistence = new MemorySourcePersistence();
    const clock = new TestClock();
    const budget: RniWorkflowBudgetPort = {
      reserve: vi.fn(async () => ({ allowed: false, reason: 'cost' as const })),
    };

    const result = await runPersistSourceStage(
      request(),
      dependencies(workflow, persistence, clock, { budget }),
    );

    expect(result).toMatchObject({ status: 'budget_stopped', reason: 'cost', attempt: 1 });
    expect(persistence.commitSource).not.toHaveBeenCalled();
    expect(workflow.jobs).toHaveLength(0);
    expect(workflow.budgetStops).toHaveLength(1);
    expect(budget.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        estimatedSources: 1,
        estimatedInputTokens: 0,
        estimatedOutputTokens: 0,
        estimatedCostUsd: '0',
      }),
    );
  });

  it('ends a transient retry when the next backoff would exceed wall-time budget', async () => {
    const workflow = new MemoryWorkflow();
    const clock = new TestClock();
    const commitSource = vi
      .fn<RniSourcePersistencePort['commitSource']>()
      .mockRejectedValue(new WorkflowFault('transient', 'DATABASE_UNAVAILABLE'));

    const result = await runPersistSourceStage(
      request(),
      dependencies(workflow, { commitSource }, clock, {
        policy: {
          maxAttempts: 3,
          maxWallTimeMs: 249,
          leaseMs: 10_000,
          heartbeatEveryMs: 3_000,
          baseBackoffMs: 500,
          backoffFactor: 2,
          maxBackoffMs: 8_000,
          random: () => 0.5,
        },
      }),
    );

    expect(result).toMatchObject({ status: 'failed', attempt: 1, errorClass: 'transient' });
    expect(clock.sleeps).toEqual([]);
    expect(workflow.failures[0]?.retryAt).toBeNull();
  });

  it('defers concurrent delivery until the active lease expires', async () => {
    const workflow = new MemoryWorkflow();
    const clock = new TestClock();
    const persistence = new MemorySourcePersistence();
    const firstClaim = await workflow.claimStep({
      key: {
        runId,
        stage: 'persist_source',
        subjectId: 'reddit:t3_rni_e03',
        stageVersion: 'rni-persist-source-v1',
      },
      idempotencyKey:
        'rni-step-3df43f73db06489442b4f2a1142bcd2141e95243c17d9accda415d960167e141',
      inputHash: 'placeholder',
      leaseOwner: 'worker-1',
      leasedAt: clock.now().toISOString(),
      leaseUntil: '2026-09-05T02:00:10.000Z',
    });
    expect(firstClaim.kind).toBe('acquired');

    // Use the runner once to obtain its real deterministic key/hash, then leave that claim leased.
    workflow.steps.clear();
    const budget = allowingBudget();
    const crashPersistence: RniSourcePersistencePort = {
      commitSource: vi.fn(async () => {
        throw new WorkflowFault('crash', 'SIMULATED_PROCESS_CRASH');
      }),
    };
    await expect(
      runPersistSourceStage(
        request(),
        dependencies(workflow, crashPersistence, clock, { budget, leaseOwner: 'worker-1' }),
      ),
    ).rejects.toThrow('SIMULATED_PROCESS_CRASH');

    const result = await runPersistSourceStage(
      request(),
      dependencies(workflow, persistence, clock, { leaseOwner: 'worker-2' }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 'deferred',
        retryAt: '2026-09-05T02:00:10.000Z',
      }),
    );
    expect(persistence.commitSource).not.toHaveBeenCalled();
  });

  it('keeps a slow commit exclusively leased through the heartbeat scope', async () => {
    const workflow = new MemoryWorkflow();
    const clock = new TestClock();
    let resolveCommit: ((result: RniSourceCommitResult) => void) | undefined;
    let markCommitStarted: (() => void) | undefined;
    const commitStarted = new Promise<void>((resolve) => {
      markCommitStarted = resolve;
    });
    const commitSource = vi.fn<RniSourcePersistencePort['commitSource']>(
      () =>
        new Promise<RniSourceCommitResult>((resolve) => {
          resolveCommit = resolve;
          markCommitStarted?.();
        }),
    );
    const first = runPersistSourceStage(
      request(),
      dependencies(workflow, { commitSource }, clock, { leaseOwner: 'worker-1' }),
    );
    await commitStarted;

    clock.advance(20_000);
    const concurrent = await runPersistSourceStage(
      request(),
      dependencies(workflow, { commitSource }, clock, { leaseOwner: 'worker-2' }),
    );
    expect(concurrent).toMatchObject({
      status: 'deferred',
      retryAt: '2026-09-05T02:00:30.000Z',
    });
    expect(commitSource).toHaveBeenCalledTimes(1);

    resolveCommit?.({
      sourceItemId: durableSourceId,
      sourceInserted: true,
      retrievalInserted: true,
      contentVersionInserted: true,
    });
    await expect(first).resolves.toMatchObject({ status: 'completed', attempt: 1 });
  });

  it('keeps wall-time budget anchored to the original durable step start after a crash', async () => {
    const workflow = new MemoryWorkflow();
    workflow.crashCheckpointOnce = true;
    const persistence = new MemorySourcePersistence();
    const clock = new TestClock();
    const budget = allowingBudget();
    const policy = {
      maxAttempts: 3,
      maxWallTimeMs: 5_000,
      leaseMs: 10_000,
      heartbeatEveryMs: 3_000,
      baseBackoffMs: 500,
      backoffFactor: 2,
      maxBackoffMs: 8_000,
      random: () => 0.5,
    };

    await expect(
      runPersistSourceStage(
        request(),
        dependencies(workflow, persistence, clock, { budget, policy }),
      ),
    ).rejects.toThrow('SIMULATED_PROCESS_CRASH');
    clock.advance(10_001);

    const result = await runPersistSourceStage(
      request(),
      dependencies(workflow, persistence, clock, {
        budget,
        policy,
        leaseOwner: 'worker-2',
      }),
    );
    expect(result).toMatchObject({
      status: 'budget_stopped',
      reason: 'wall_time',
      attempt: 2,
    });
    expect(persistence.commitSource).toHaveBeenCalledTimes(1);
    expect(budget.reserve).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a completed stage key is redelivered with changed evidence', async () => {
    const workflow = new MemoryWorkflow();
    const persistence = new MemorySourcePersistence();
    const clock = new TestClock();
    await runPersistSourceStage(request(), dependencies(workflow, persistence, clock));

    await expect(
      runPersistSourceStage(
        request(
          source({
            boundedContent: 'Different source bytes.',
            contentSha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          }),
        ),
        dependencies(workflow, persistence, clock, { leaseOwner: 'worker-2' }),
      ),
    ).rejects.toThrow('fake input hash conflict');
    expect(persistence.commitSource).toHaveBeenCalledTimes(1);
  });
});
