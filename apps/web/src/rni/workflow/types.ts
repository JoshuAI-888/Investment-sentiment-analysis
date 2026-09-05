import type {
  RniSourceCommitResult,
  RniSourceItem,
  RniSourcePersistencePort,
} from '@/rni/contracts';

export const RNI_PERSIST_SOURCE_STAGE = 'persist_source' as const;

export type RniWorkflowStepKey = {
  readonly runId: string;
  readonly stage: typeof RNI_PERSIST_SOURCE_STAGE;
  readonly subjectId: string;
  readonly stageVersion: string;
};

export type RniPersistSourceRequest = {
  readonly runId: string;
  /** Stable acquisition identity, such as the platform plus provider external ID. */
  readonly subjectId: string;
  readonly stageVersion: string;
  readonly source: RniSourceItem;
};

export type RniCompletedSourceCheckpoint = {
  readonly key: RniWorkflowStepKey;
  readonly idempotencyKey: string;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly attempt: number;
  readonly commitResult: RniSourceCommitResult;
  readonly semanticDispatch: 'enqueued' | 'deduplicated';
  readonly completedAt: string;
};

export type RniWorkflowClaim =
  | {
      readonly kind: 'acquired';
      readonly attempt: number;
      readonly inputHash: string;
      /** Original durable step start; it never resets on retry or crash redelivery. */
      readonly startedAt: string;
      /** Present when a prior delivery checkpointed the commit before it stopped. */
      readonly priorCommitResult: RniSourceCommitResult | null;
    }
  | { readonly kind: 'busy'; readonly retryAt: string }
  | { readonly kind: 'completed'; readonly checkpoint: RniCompletedSourceCheckpoint };

export type RniInterpretationJob = {
  readonly runId: string;
  /** Always the identity returned by `RniSourcePersistencePort.commitSource`. */
  readonly sourceItemId: string;
  readonly stageVersion: string;
  readonly idempotencyKey: string;
};

/**
 * Portable facade over the repository's existing durable job/queue mechanism.
 *
 * The implementation owns atomic lease/checkpoint semantics and idempotent enqueue. This is not
 * a source-persistence abstraction: source writes cross the frozen `RniSourcePersistencePort`
 * directly. Every mutation below is operational workflow state, never a business-row rollback.
 */
export interface RniWorkflowPort {
  /**
   * Atomically claims an expired/new step, rejects conflicting input hashes, and enforces any
   * persisted failure `retryAt` as a not-before time by returning `busy` until it passes.
   */
  claimStep(input: {
    key: RniWorkflowStepKey;
    idempotencyKey: string;
    inputHash: string;
    leaseOwner: string;
    leasedAt: string;
    leaseUntil: string;
  }): Promise<RniWorkflowClaim>;

  /**
   * Runs `operation` while renewing the claimed lease before `heartbeatEveryMs` elapses. It must
   * stop renewal when the operation settles and propagate either its value or error unchanged.
   */
  withLeaseHeartbeat<T>(input: {
    key: RniWorkflowStepKey;
    idempotencyKey: string;
    leaseOwner: string;
    leaseMs: number;
    heartbeatEveryMs: number;
  }, operation: () => Promise<T>): Promise<T>;

  checkpointSourceCommit(input: {
    key: RniWorkflowStepKey;
    idempotencyKey: string;
    inputHash: string;
    leaseOwner: string;
    attempt: number;
    commitResult: RniSourceCommitResult;
    checkpointedAt: string;
  }): Promise<void>;

  enqueueInterpretation(job: RniInterpretationJob): Promise<{ readonly enqueued: boolean }>;

  completeStep(checkpoint: RniCompletedSourceCheckpoint & {
    readonly leaseOwner: string;
  }): Promise<void>;

  recordFailure(input: {
    key: RniWorkflowStepKey;
    idempotencyKey: string;
    inputHash: string;
    leaseOwner: string;
    attempt: number;
    errorClass: 'transient' | 'permanent';
    errorCode: string;
    failedAt: string;
    retryAt: string | null;
  }): Promise<void>;

  recordBudgetStop(input: {
    key: RniWorkflowStepKey;
    idempotencyKey: string;
    inputHash: string;
    leaseOwner: string;
    attempt: number;
    reason: RniWorkflowBudgetStopReason;
    stoppedAt: string;
  }): Promise<void>;
}

export const RNI_WORKFLOW_BUDGET_STOP_REASONS = [
  'attempts',
  'wall_time',
  'sources',
  'input_tokens',
  'output_tokens',
  'cost',
  'cancelled',
] as const;
export type RniWorkflowBudgetStopReason =
  (typeof RNI_WORKFLOW_BUDGET_STOP_REASONS)[number];

export interface RniWorkflowBudgetPort {
  /**
   * Must atomically reserve any priced allowance it grants. The persist step itself estimates
   * zero model tokens/cost, but carries those dimensions so later semantic stages use the same
   * fail-closed gate instead of growing an unbudgeted side path. Reservation is idempotent for a
   * step `idempotencyKey`; rechecking a transient attempt must not spend the allowance twice.
   */
  reserve(input: {
    key: RniWorkflowStepKey;
    idempotencyKey: string;
    /** Stable across attempts and crash redelivery; this is the atomic reservation identity. */
    reservationKey: string;
    attempt: number;
    elapsedMs: number;
    estimatedSources: number;
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
    estimatedCostUsd: string;
    at: string;
  }): Promise<
    | { readonly allowed: true }
    | { readonly allowed: false; readonly reason: RniWorkflowBudgetStopReason }
  >;
}

export interface RniWorkflowClock {
  now(): Date;
  sleep(ms: number): Promise<void>;
}

export type RniWorkflowError = {
  readonly classification: 'transient' | 'permanent' | 'crash';
  /** Stable, non-secret code suitable for the append-only status log. */
  readonly code: string;
};

export type RniWorkflowErrorClassifier = (error: unknown) => RniWorkflowError;

export type RniWorkflowPolicy = {
  readonly maxAttempts: number;
  readonly maxWallTimeMs: number;
  readonly leaseMs: number;
  readonly heartbeatEveryMs: number;
  readonly baseBackoffMs: number;
  readonly backoffFactor: number;
  readonly maxBackoffMs: number;
  /** Full-jitter sample in [0, 1). Injected for deterministic tests. */
  readonly random: () => number;
};

export type RniPersistSourceDependencies = {
  readonly sourcePersistence: RniSourcePersistencePort;
  readonly workflow: RniWorkflowPort;
  readonly budget: RniWorkflowBudgetPort;
  readonly clock: RniWorkflowClock;
  readonly leaseOwner: string;
  readonly classifyError?: RniWorkflowErrorClassifier;
  readonly policy?: Partial<RniWorkflowPolicy>;
};

export type RniPersistSourceStageResult =
  | ({ readonly status: 'completed' } & RniCompletedSourceCheckpoint)
  | {
      readonly status: 'deferred';
      readonly idempotencyKey: string;
      readonly inputHash: string;
      readonly retryAt: string;
    }
  | {
      readonly status: 'budget_stopped';
      readonly idempotencyKey: string;
      readonly inputHash: string;
      readonly attempt: number;
      readonly reason: RniWorkflowBudgetStopReason;
    }
  | {
      readonly status: 'failed';
      readonly idempotencyKey: string;
      readonly inputHash: string;
      readonly attempt: number;
      readonly errorClass: 'transient' | 'permanent';
      readonly errorCode: string;
    };
