import { describe, expect, it, vi } from 'vitest';
import type {
  RniSourceCommitResult,
  RniSourceItem,
  RniSourcePersistencePort,
} from '@/rni/contracts';
import {
  runPersistSourceStage,
  type RniWorkflowBudgetPort,
  type RniWorkflowClaim,
  type RniWorkflowPort,
} from '@/rni/workflow';

const runId = '00000000-0000-4000-8000-000000000401';
const proposedSourceId = '00000000-0000-4000-8000-000000000402';
const committedSourceId = '00000000-0000-4000-8000-000000000499';

function source(overrides: Partial<RniSourceItem> = {}): RniSourceItem {
  return {
    id: proposedSourceId,
    platform: 'x',
    sourceKind: 'x_post',
    externalId: '1900000000000000401',
    canonicalUrl: 'https://x.com/i/web/status/1900000000000000401',
    originalUrl: 'https://x.com/i/web/status/1900000000000000401',
    subredditOrScope: 'configured-semiconductors',
    authorHandleHash: null,
    title: null,
    boundedContent: '$NVDA execution remains the focus.',
    contentSha256: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    captureMode: 'full_post',
    publishedAt: '2026-09-05T00:00:00.000Z',
    discoveredAt: '2026-09-05T00:05:00.000Z',
    observedAt: '2026-09-05T00:05:00.000Z',
    searchQueryId: '00000000-0000-4000-8000-000000000403',
    providerRequestId: 'fixture:x:e03',
    metadata: { retrievalRank: 1 },
    rightsPolicyVersion: 'rni-source-policy-v1',
    createdAt: '2026-09-05T00:05:01.000Z',
    ...overrides,
  };
}

function workflow(events: string[]): RniWorkflowPort {
  let commitResult: RniSourceCommitResult | null = null;
  return {
    async claimStep(input): Promise<RniWorkflowClaim> {
      events.push('claim');
      return {
        kind: 'acquired',
        attempt: 1,
        inputHash: input.inputHash,
        startedAt: input.leasedAt,
        priorCommitResult: commitResult,
      };
    },
    async checkpointSourceCommit(input) {
      events.push('checkpoint');
      commitResult = input.commitResult;
    },
    async withLeaseHeartbeat(_input, operation) {
      events.push('heartbeat:start');
      try {
        return await operation();
      } finally {
        events.push('heartbeat:stop');
      }
    },
    async enqueueInterpretation(job) {
      events.push(`enqueue:${job.sourceItemId}`);
      expect(job).not.toHaveProperty('boundedContent');
      expect(job).not.toHaveProperty('source');
      return { enqueued: true };
    },
    async completeStep() {
      events.push('complete');
    },
    async recordFailure() {
      events.push('failure');
    },
    async recordBudgetStop() {
      events.push('budget-stop');
    },
  };
}

const budget: RniWorkflowBudgetPort = {
  reserve: vi.fn(async () => ({ allowed: true as const })),
};

describe('RNI frozen source-persistence workflow contract', () => {
  it('commits through the frozen port before dispatch and never queues the proposed ID', async () => {
    const events: string[] = [];
    const sourcePersistence: RniSourcePersistencePort = {
      async commitSource() {
        events.push('commit');
        return {
          sourceItemId: committedSourceId,
          sourceInserted: true,
          retrievalInserted: true,
          contentVersionInserted: true,
        };
      },
    };

    const result = await runPersistSourceStage(
      {
        runId,
        subjectId: 'x:1900000000000000401',
        stageVersion: 'rni-persist-source-v1',
        source: source(),
      },
      {
        sourcePersistence,
        workflow: workflow(events),
        budget,
        clock: {
          now: () => new Date('2026-09-05T02:30:00.000Z'),
          sleep: vi.fn(async () => undefined),
        },
        leaseOwner: 'contract-worker',
        policy: { random: () => 0 },
      },
    );

    expect(events).toEqual([
      'claim',
      'heartbeat:start',
      'commit',
      'checkpoint',
      `enqueue:${committedSourceId}`,
      'complete',
      'heartbeat:stop',
    ]);
    expect(events).not.toContain(`enqueue:${proposedSourceId}`);
    expect(result).toMatchObject({
      status: 'completed',
      commitResult: { sourceItemId: committedSourceId },
    });
  });

  it('rejects invalid bounded evidence before any source or workflow side effect', async () => {
    const events: string[] = [];
    const sourcePersistence: RniSourcePersistencePort = {
      commitSource: vi.fn(async () => {
        throw new Error('must not run');
      }),
    };

    await expect(
      runPersistSourceStage(
        {
          runId,
          subjectId: 'x:1900000000000000401',
          stageVersion: 'rni-persist-source-v1',
          source: source({ boundedContent: '<html>untrusted whole page</html>' }),
        },
        {
          sourcePersistence,
          workflow: workflow(events),
          budget,
          clock: {
            now: () => new Date('2026-09-05T02:30:00.000Z'),
            sleep: vi.fn(async () => undefined),
          },
          leaseOwner: 'contract-worker',
        },
      ),
    ).rejects.toThrow('Whole-page HTML is not valid bounded evidence');
    expect(sourcePersistence.commitSource).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});
