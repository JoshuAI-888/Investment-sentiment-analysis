import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  rniSourceCommitResult,
  rniSourceItem,
  type RniSourceCommitResult,
} from '@/rni/contracts';
import {
  RNI_PERSIST_SOURCE_STAGE,
  RNI_WORKFLOW_BUDGET_STOP_REASONS,
  type RniCompletedSourceCheckpoint,
  type RniPersistSourceDependencies,
  type RniPersistSourceRequest,
  type RniPersistSourceStageResult,
  type RniWorkflowError,
  type RniWorkflowPolicy,
  type RniWorkflowStepKey,
} from './types';

const requestEnvelope = z
  .object({
    runId: z.string().uuid(),
    subjectId: z.string().min(1).max(500),
    stageVersion: z.string().min(1).max(200),
  })
  .strict();

const errorCode = z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/u);
const isoTimestamp = z.string().datetime({ offset: true });
const budgetStopReason = z.enum(RNI_WORKFLOW_BUDGET_STOP_REASONS);
const budgetDecision = z.discriminatedUnion('allowed', [
  z.object({ allowed: z.literal(true) }).strict(),
  z.object({ allowed: z.literal(false), reason: budgetStopReason }).strict(),
]);
const dispatchResult = z.object({ enqueued: z.boolean() }).strict();
const sha256Digest = z.string().regex(/^[a-f0-9]{64}$/u);

export const defaultRniWorkflowPolicy: RniWorkflowPolicy = {
  maxAttempts: 3,
  maxWallTimeMs: 30_000,
  leaseMs: 10_000,
  heartbeatEveryMs: 3_000,
  baseBackoffMs: 500,
  backoffFactor: 2,
  maxBackoffMs: 8_000,
  random: Math.random,
};

const defaultErrorClassifier = (): RniWorkflowError => ({
  classification: 'permanent',
  code: 'UNCLASSIFIED_WORKFLOW_ERROR',
});

function canonicalJson(value: unknown, seen = new Set<object>()): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Workflow hashes require finite JSON numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('Workflow hashes reject cyclic input');
    seen.add(value);
    const encoded = `[${value.map((entry) => canonicalJson(entry, seen)).join(',')}]`;
    seen.delete(value);
    return encoded;
  }
  if (typeof value === 'object') {
    if (seen.has(value)) throw new Error('Workflow hashes reject cyclic input');
    seen.add(value);
    const record = value as Record<string, unknown>;
    const encoded = `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key], seen)}`)
      .join(',')}}`;
    seen.delete(value);
    return encoded;
  }
  throw new Error(`Workflow hashes reject non-JSON ${typeof value}`);
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function sourceHashMaterial(source: z.infer<typeof rniSourceItem>): Omit<typeof source, 'id'> {
  const { id: _callerProposedId, ...durableEvidence } = source;
  return durableEvidence;
}

export function rniWorkflowStepIdempotencyKey(key: RniWorkflowStepKey): string {
  return `rni-step-${sha256(key)}`;
}

export function rniInterpretationIdempotencyKey(
  key: RniWorkflowStepKey,
  sourceItemId: string,
): string {
  return `rni-interpret-${sha256({ key, sourceItemId })}`;
}

export function rniSourceBudgetReservationKey(key: RniWorkflowStepKey): string {
  return `rni-budget-${sha256({ key, resource: 'source' })}`;
}

function logicalOutputHash(key: RniWorkflowStepKey, sourceItemId: string): string {
  return sha256({
    sourceItemId,
    interpretationIdempotencyKey: rniInterpretationIdempotencyKey(key, sourceItemId),
  });
}

export function rniWorkflowBackoffMs(attempt: number, policy: RniWorkflowPolicy): number {
  const ceiling = Math.min(
    policy.maxBackoffMs,
    policy.baseBackoffMs * policy.backoffFactor ** Math.max(0, attempt - 1),
  );
  return Math.floor(policy.random() * ceiling);
}

function resolvedPolicy(overrides: Partial<RniWorkflowPolicy> | undefined): RniWorkflowPolicy {
  const policy = { ...defaultRniWorkflowPolicy, ...overrides };
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    throw new Error('RNI workflow maxAttempts must be a positive integer');
  }
  for (const [name, value] of [
    ['maxWallTimeMs', policy.maxWallTimeMs],
    ['leaseMs', policy.leaseMs],
    ['heartbeatEveryMs', policy.heartbeatEveryMs],
    ['baseBackoffMs', policy.baseBackoffMs],
    ['maxBackoffMs', policy.maxBackoffMs],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`RNI workflow ${name} must be finite and non-negative`);
    }
  }
  if (!Number.isFinite(policy.backoffFactor) || policy.backoffFactor < 1) {
    throw new Error('RNI workflow backoffFactor must be finite and at least one');
  }
  if (policy.leaseMs <= 0 || policy.heartbeatEveryMs <= 0) {
    throw new Error('RNI workflow lease and heartbeat intervals must be positive');
  }
  if (policy.heartbeatEveryMs >= policy.leaseMs) {
    throw new Error('RNI workflow heartbeat interval must be shorter than its lease');
  }
  return {
    ...policy,
    random: () => {
      const sample = policy.random();
      if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
        throw new Error('RNI workflow random must return a value in [0, 1)');
      }
      return sample;
    },
  };
}

function dateAfter(date: Date, milliseconds: number): string {
  return new Date(date.getTime() + milliseconds).toISOString();
}

function assertInputHash(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error('RNI workflow checkpoint input hash conflict');
  }
}

function validateCompletedCheckpoint(
  checkpoint: RniCompletedSourceCheckpoint,
  expectedKey: RniWorkflowStepKey,
  expectedIdempotencyKey: string,
  expectedInputHash: string,
): RniCompletedSourceCheckpoint {
  if (canonicalJson(checkpoint.key) !== canonicalJson(expectedKey)) {
    throw new Error('RNI workflow checkpoint step-key conflict');
  }
  if (checkpoint.idempotencyKey !== expectedIdempotencyKey) {
    throw new Error('RNI workflow checkpoint idempotency-key conflict');
  }
  assertInputHash(checkpoint.inputHash, expectedInputHash);
  if (!Number.isInteger(checkpoint.attempt) || checkpoint.attempt < 1) {
    throw new Error('RNI workflow checkpoint has an invalid attempt');
  }
  const commitResult = rniSourceCommitResult.parse(checkpoint.commitResult);
  const outputHash = sha256Digest.parse(checkpoint.outputHash);
  if (outputHash !== logicalOutputHash(expectedKey, commitResult.sourceItemId)) {
    throw new Error('RNI workflow checkpoint output hash conflict');
  }
  return {
    ...checkpoint,
    outputHash,
    commitResult,
    semanticDispatch: z.enum(['enqueued', 'deduplicated']).parse(checkpoint.semanticDispatch),
    completedAt: isoTimestamp.parse(checkpoint.completedAt),
  };
}

function completedResult(
  checkpoint: RniCompletedSourceCheckpoint,
): RniPersistSourceStageResult {
  return { status: 'completed', ...checkpoint };
}

function validateClassifiedError(error: RniWorkflowError): RniWorkflowError {
  return {
    classification: z.enum(['transient', 'permanent', 'crash']).parse(error.classification),
    code: errorCode.parse(error.code),
  };
}

/**
 * Commits bounded source evidence before dispatching any semantic work. The returned durable
 * identity is checkpointed and is the only source ID ever placed on the interpretation job.
 * Redelivery resumes from a committed checkpoint or replays the idempotent frozen source port.
 */
export async function runPersistSourceStage(
  input: RniPersistSourceRequest,
  deps: RniPersistSourceDependencies,
): Promise<RniPersistSourceStageResult> {
  const envelope = requestEnvelope.parse({
    runId: input.runId,
    subjectId: input.subjectId,
    stageVersion: input.stageVersion,
  });
  const source = rniSourceItem.parse(input.source);
  const key: RniWorkflowStepKey = {
    runId: envelope.runId,
    stage: RNI_PERSIST_SOURCE_STAGE,
    subjectId: envelope.subjectId,
    stageVersion: envelope.stageVersion,
  };
  // The caller-proposed UUID is deliberately excluded. DATA owns durable identity, and an exact
  // duplicate may arrive with a newly minted proposal while still being the same stage input.
  const inputHash = sha256({ key, source: sourceHashMaterial(source) });
  const idempotencyKey = rniWorkflowStepIdempotencyKey(key);
  const budgetReservationKey = rniSourceBudgetReservationKey(key);
  const policy = resolvedPolicy(deps.policy);
  const classifyError = deps.classifyError ?? defaultErrorClassifier;

  for (;;) {
    const claimedAt = deps.clock.now();
    const claim = await deps.workflow.claimStep({
      key,
      idempotencyKey,
      inputHash,
      leaseOwner: deps.leaseOwner,
      leasedAt: claimedAt.toISOString(),
      leaseUntil: dateAfter(claimedAt, policy.leaseMs),
    });

    if (claim.kind === 'busy') {
      return {
        status: 'deferred',
        idempotencyKey,
        inputHash,
        retryAt: isoTimestamp.parse(claim.retryAt),
      };
    }
    if (claim.kind === 'completed') {
      return completedResult(
        validateCompletedCheckpoint(claim.checkpoint, key, idempotencyKey, inputHash),
      );
    }

    assertInputHash(claim.inputHash, inputHash);
    const startedAtMs = Date.parse(isoTimestamp.parse(claim.startedAt));
    const attempt = claim.attempt;
    if (!Number.isInteger(attempt) || attempt < 1) {
      throw new Error('RNI workflow claim returned an invalid attempt');
    }

    if (attempt > policy.maxAttempts) {
      const stoppedAt = deps.clock.now().toISOString();
      await deps.workflow.recordBudgetStop({
        key,
        idempotencyKey,
        inputHash,
        leaseOwner: deps.leaseOwner,
        attempt,
        reason: 'attempts',
        stoppedAt,
      });
      return { status: 'budget_stopped', idempotencyKey, inputHash, attempt, reason: 'attempts' };
    }

    const beforeWork = deps.clock.now();
    if (Math.max(0, beforeWork.getTime() - startedAtMs) > policy.maxWallTimeMs) {
      await deps.workflow.recordBudgetStop({
        key,
        idempotencyKey,
        inputHash,
        leaseOwner: deps.leaseOwner,
        attempt,
        reason: 'wall_time',
        stoppedAt: beforeWork.toISOString(),
      });
      return {
        status: 'budget_stopped',
        idempotencyKey,
        inputHash,
        attempt,
        reason: 'wall_time',
      };
    }

    try {
      return await deps.workflow.withLeaseHeartbeat(
        {
          key,
          idempotencyKey,
          leaseOwner: deps.leaseOwner,
          leaseMs: policy.leaseMs,
          heartbeatEveryMs: policy.heartbeatEveryMs,
        },
        async () => {
          const budgetAt = deps.clock.now();
          const budget = budgetDecision.parse(
            await deps.budget.reserve({
              key,
              idempotencyKey,
              reservationKey: budgetReservationKey,
              attempt,
              elapsedMs: Math.max(0, budgetAt.getTime() - startedAtMs),
              estimatedSources: claim.priorCommitResult === null ? 1 : 0,
              estimatedInputTokens: 0,
              estimatedOutputTokens: 0,
              estimatedCostUsd: '0',
              at: budgetAt.toISOString(),
            }),
          );
          if (!budget.allowed) {
            const reason = budgetStopReason.parse(budget.reason);
            await deps.workflow.recordBudgetStop({
              key,
              idempotencyKey,
              inputHash,
              leaseOwner: deps.leaseOwner,
              attempt,
              reason,
              stoppedAt: deps.clock.now().toISOString(),
            });
            return { status: 'budget_stopped', idempotencyKey, inputHash, attempt, reason };
          }

          let commitResult: RniSourceCommitResult;
          if (claim.priorCommitResult === null) {
            commitResult = rniSourceCommitResult.parse(
              await deps.sourcePersistence.commitSource(source),
            );
            await deps.workflow.checkpointSourceCommit({
              key,
              idempotencyKey,
              inputHash,
              leaseOwner: deps.leaseOwner,
              attempt,
              commitResult,
              checkpointedAt: deps.clock.now().toISOString(),
            });
          } else {
            commitResult = rniSourceCommitResult.parse(claim.priorCommitResult);
          }

          const interpretationIdempotencyKey = rniInterpretationIdempotencyKey(
            key,
            commitResult.sourceItemId,
          );
          const dispatch = dispatchResult.parse(
            await deps.workflow.enqueueInterpretation({
              runId: key.runId,
              sourceItemId: commitResult.sourceItemId,
              stageVersion: key.stageVersion,
              idempotencyKey: interpretationIdempotencyKey,
            }),
          );
          const semanticDispatch = dispatch.enqueued ? 'enqueued' : 'deduplicated';
          const completedAt = deps.clock.now().toISOString();
          const checkpoint: RniCompletedSourceCheckpoint = {
            key,
            idempotencyKey,
            inputHash,
            outputHash: logicalOutputHash(key, commitResult.sourceItemId),
            attempt,
            commitResult,
            semanticDispatch,
            completedAt,
          };
          await deps.workflow.completeStep({ ...checkpoint, leaseOwner: deps.leaseOwner });
          return completedResult(checkpoint);
        },
      );
    } catch (caught) {
      const failure = validateClassifiedError(classifyError(caught));
      if (failure.classification === 'crash') throw caught;

      const failedAt = deps.clock.now();
      const canRetry = failure.classification === 'transient' && attempt < policy.maxAttempts;
      const delayMs = canRetry ? rniWorkflowBackoffMs(attempt, policy) : 0;
      const remainsWithinWallTime =
        failedAt.getTime() - startedAtMs + delayMs <= policy.maxWallTimeMs;
      const retryAt = canRetry && remainsWithinWallTime ? dateAfter(failedAt, delayMs) : null;
      await deps.workflow.recordFailure({
        key,
        idempotencyKey,
        inputHash,
        leaseOwner: deps.leaseOwner,
        attempt,
        errorClass: failure.classification,
        errorCode: failure.code,
        failedAt: failedAt.toISOString(),
        retryAt,
      });

      if (retryAt === null) {
        return {
          status: 'failed',
          idempotencyKey,
          inputHash,
          attempt,
          errorClass: failure.classification,
          errorCode: failure.code,
        };
      }
      await deps.clock.sleep(delayMs);
    }
  }
}
