import { z } from 'zod';

export const RNI_SOURCE_WORKFLOW_STAGE = 'interpret_source' as const;
export const RNI_SOURCE_WORKFLOW_MAX_ATTEMPTS = 3 as const;

const uuid = z.string().uuid();
const instant = z
  .string()
  .datetime({ offset: true })
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:Z|[+-]\d{2}:\d{2})$/u,
    'Workflow instants require exact millisecond precision',
  );
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const stableCode = z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/u);
const workflowPolicy = z
  .object({
    leaseMs: z.number().int().positive().max(120_000),
    baseBackoffMs: z.number().int().positive().max(3_600_000),
    maxBackoffMs: z.number().int().positive().max(86_400_000),
  })
  .strict()
  .refine((value) => value.maxBackoffMs >= value.baseBackoffMs, {
    message: 'Maximum backoff must be at least the base backoff',
    path: ['maxBackoffMs'],
  });

export const rniSourceWorkflowSubjectV2 = z
  .object({
    version: z.literal('rni-source-workflow-subject-v2'),
    runId: uuid,
    planHash: digest,
    platform: z.enum(['reddit', 'x']),
    outerAttempt: z.number().int().min(1).max(3),
    outerToken: uuid,
    deadline: instant,
    workflowPolicy,
    sourceItemId: uuid,
    retrievalId: uuid,
    contentVersionId: uuid,
    outboxEventId: uuid,
    stage: z.literal(RNI_SOURCE_WORKFLOW_STAGE),
    stageVersion: z.string().min(1).max(200),
  })
  .strict();

export type RniSourceWorkflowSubjectV2 = z.infer<typeof rniSourceWorkflowSubjectV2>;

export const rniSourceWorkflowDeliveryV2 = z
  .object({
    version: z.literal('rni-source-workflow-delivery-v2'),
    subject: rniSourceWorkflowSubjectV2,
    inputHash: digest,
  })
  .strict();

export type RniSourceWorkflowDeliveryV2 = z.infer<typeof rniSourceWorkflowDeliveryV2>;

const outerLease = z
  .object({
    acquiredAt: instant,
    expiresAt: instant,
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.expiresAt) <= Date.parse(value.acquiredAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Outer lease expiry must be after acquisition',
        path: ['expiresAt'],
      });
    }
  });

export const rniSourceWorkflowAuthorityV2 = z
  .object({
    runId: uuid,
    planHash: digest,
    platform: z.enum(['reddit', 'x']),
    outerAttempt: z.number().int().min(1).max(3),
    outerToken: uuid,
    deadline: instant,
    workflowPolicy,
    outerLease,
  })
  .strict();

export type RniSourceWorkflowAuthorityV2 = z.infer<typeof rniSourceWorkflowAuthorityV2>;

const sourceLease = z
  .object({
    owner: z.string().min(1).max(200),
    token: uuid,
    acquiredAt: instant,
    expiresAt: instant,
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.expiresAt) <= Date.parse(value.acquiredAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Source lease expiry must be after acquisition',
        path: ['expiresAt'],
      });
    }
  });

const retryDetails = z
  .object({
    errorCode: stableCode,
    failedAt: instant,
    delayMs: z.number().int().positive(),
  })
  .strict();

const terminalDetails = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('permanent_failure'),
      errorCode: stableCode,
      causeCode: stableCode.nullable(),
      failedAt: instant,
    })
    .strict(),
  z
    .object({
      kind: z.literal('budget_stopped'),
      reason: z.enum([
        'attempts',
        'wall_time',
        'sources',
        'input_tokens',
        'output_tokens',
        'cost',
        'cancelled',
      ]),
      stoppedAt: instant,
    })
    .strict(),
]);

export const rniSourceWorkflowCheckpointV2 = z
  .object({
    version: z.literal('rni-source-workflow-checkpoint-v2'),
    delivery: rniSourceWorkflowDeliveryV2,
    status: z.enum(['running', 'retry_wait', 'completed', 'permanent_failure', 'budget_stopped']),
    attempt: z.number().int().min(1).max(RNI_SOURCE_WORKFLOW_MAX_ATTEMPTS),
    startedAt: instant,
    updatedAt: instant,
    lease: sourceLease.nullable(),
    notBefore: instant.nullable(),
    retry: retryDetails.nullable(),
    outputHash: digest.nullable(),
    completedAt: instant.nullable(),
    terminal: terminalDetails.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const issue = (path: string, message: string): void => {
      context.addIssue({ code: z.ZodIssueCode.custom, message, path: [path] });
    };
    const startedAt = Date.parse(value.startedAt);
    const updatedAt = Date.parse(value.updatedAt);

    if (updatedAt < startedAt) {
      issue('updatedAt', 'Checkpoint update cannot predate its start');
    }
    if (updatedAt >= Date.parse(value.delivery.subject.deadline)) {
      issue('updatedAt', 'Checkpoint update cannot reach or outlive the run deadline');
    }

    if (value.lease !== null) {
      if (Date.parse(value.lease.acquiredAt) < startedAt) {
        issue('lease', 'Source lease cannot predate the checkpoint');
      }
      if (
        updatedAt < Date.parse(value.lease.acquiredAt) ||
        updatedAt >= Date.parse(value.lease.expiresAt)
      ) {
        issue('updatedAt', 'Running update must fall inside its source lease');
      }
      if (Date.parse(value.lease.expiresAt) > Date.parse(value.delivery.subject.deadline)) {
        issue('lease', 'Source lease cannot outlive the run deadline');
      }
    }

    if (value.status === 'running') {
      if (value.lease === null) issue('lease', 'Running checkpoint requires a lease');
      if (value.notBefore !== null) issue('notBefore', 'Running checkpoint cannot be deferred');
      if (value.retry !== null) issue('retry', 'Running checkpoint cannot retain retry details');
      if (value.outputHash !== null || value.completedAt !== null) {
        issue('outputHash', 'Running checkpoint cannot contain completed output');
      }
      if (value.terminal !== null) issue('terminal', 'Running checkpoint cannot be terminal');
    }

    if (value.status === 'retry_wait') {
      if (value.lease !== null) issue('lease', 'Deferred checkpoint cannot retain a lease');
      if (value.notBefore === null || value.retry === null) {
        issue('notBefore', 'Deferred checkpoint requires retry details and a not-before time');
      } else {
        if (Date.parse(value.retry.failedAt) < startedAt) {
          issue('retry', 'Retry failure cannot predate the checkpoint');
        }
        if (Date.parse(value.retry.failedAt) !== updatedAt) {
          issue('retry', 'Retry failure must match the last checkpoint transition');
        }
        if (Date.parse(value.notBefore) <= Date.parse(value.retry.failedAt)) {
          issue('notBefore', 'Retry not-before must follow the failure');
        }
        if (
          Date.parse(value.notBefore) !==
          Date.parse(value.retry.failedAt) + value.retry.delayMs
        ) {
          issue('notBefore', 'Retry not-before must exactly equal failure time plus delay');
        }
        if (Date.parse(value.notBefore) >= Date.parse(value.delivery.subject.deadline)) {
          issue('notBefore', 'Retry not-before must precede the run deadline');
        }
      }
      if (value.outputHash !== null || value.completedAt !== null || value.terminal !== null) {
        issue('outputHash', 'Deferred checkpoint cannot contain terminal output');
      }
    }

    if (value.status === 'completed') {
      if (value.lease !== null || value.notBefore !== null || value.retry !== null) {
        issue('lease', 'Completed checkpoint cannot retain live execution state');
      }
      if (value.outputHash === null || value.completedAt === null) {
        issue('outputHash', 'Completed checkpoint requires output hash and completion time');
      } else if (Date.parse(value.completedAt) < startedAt) {
        issue('completedAt', 'Completion cannot predate the checkpoint');
      } else if (Date.parse(value.completedAt) !== updatedAt) {
        issue('completedAt', 'Completion time must match the last checkpoint transition');
      }
      if (value.terminal !== null) issue('terminal', 'Completed checkpoint cannot be terminal');
    }

    if (value.status === 'permanent_failure') {
      if (value.lease !== null || value.notBefore !== null || value.retry !== null) {
        issue('lease', 'Permanent failure cannot retain live execution state');
      }
      if (value.outputHash !== null || value.completedAt !== null) {
        issue('outputHash', 'Permanent failure cannot contain completed output');
      }
      if (value.terminal?.kind !== 'permanent_failure') {
        issue('terminal', 'Permanent failure requires matching terminal details');
      } else if (Date.parse(value.terminal.failedAt) < startedAt) {
        issue('terminal', 'Permanent failure cannot predate the checkpoint');
      } else if (Date.parse(value.terminal.failedAt) !== updatedAt) {
        issue('terminal', 'Permanent failure must match the last checkpoint transition');
      }
    }

    if (value.status === 'budget_stopped') {
      if (value.lease !== null || value.notBefore !== null || value.retry !== null) {
        issue('lease', 'Budget stop cannot retain live execution state');
      }
      if (value.outputHash !== null || value.completedAt !== null) {
        issue('outputHash', 'Budget stop cannot contain completed output');
      }
      if (value.terminal?.kind !== 'budget_stopped') {
        issue('terminal', 'Budget stop requires matching terminal details');
      } else if (Date.parse(value.terminal.stoppedAt) < startedAt) {
        issue('terminal', 'Budget stop cannot predate the checkpoint');
      } else if (Date.parse(value.terminal.stoppedAt) !== updatedAt) {
        issue('terminal', 'Budget stop must match the last checkpoint transition');
      }
    }
  });

export type RniSourceWorkflowCheckpointV2 = z.infer<typeof rniSourceWorkflowCheckpointV2>;

export type RniSourceWorkflowCheckpointErrorCode =
  | 'IDENTITY_CONFLICT'
  | 'INVALID_TRANSITION'
  | 'OUTPUT_CONFLICT'
  | 'POLICY_CONFLICT'
  | 'STALE_AUTHORITY'
  | 'STALE_LEASE'
  | 'TIME_REGRESSION';

export class RniSourceWorkflowCheckpointError extends Error {
  override readonly name = 'RniSourceWorkflowCheckpointError';

  constructor(
    readonly code: RniSourceWorkflowCheckpointErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type RniSourceWorkflowClaimResult =
  | { readonly kind: 'acquired'; readonly checkpoint: RniSourceWorkflowCheckpointV2 }
  | {
      readonly kind: 'busy';
      readonly retryAt: string;
      readonly checkpoint: RniSourceWorkflowCheckpointV2;
    }
  | {
      readonly kind: 'deferred';
      readonly retryAt: string;
      readonly checkpoint: RniSourceWorkflowCheckpointV2;
    }
  | { readonly kind: 'duplicate'; readonly checkpoint: RniSourceWorkflowCheckpointV2 }
  | { readonly kind: 'terminal'; readonly checkpoint: RniSourceWorkflowCheckpointV2 }
  | {
      readonly kind: 'expired';
      readonly reason: 'outer_authority' | 'deadline';
      readonly checkpoint: RniSourceWorkflowCheckpointV2 | null;
    };

export type RniSourceWorkflowRetryResult =
  | { readonly kind: 'scheduled'; readonly checkpoint: RniSourceWorkflowCheckpointV2 }
  | { readonly kind: 'terminal'; readonly checkpoint: RniSourceWorkflowCheckpointV2 };

type ClaimInput = {
  readonly delivery: RniSourceWorkflowDeliveryV2;
  readonly authority: RniSourceWorkflowAuthorityV2;
  readonly at: string;
  readonly leaseOwner: string;
  readonly leaseToken: string;
  readonly leaseMs: number;
};

type LeaseMutationInput = {
  readonly authority: RniSourceWorkflowAuthorityV2;
  readonly at: string;
  readonly leaseOwner: string;
  readonly leaseToken: string;
};

const claimInput = z
  .object({
    delivery: rniSourceWorkflowDeliveryV2,
    authority: rniSourceWorkflowAuthorityV2,
    at: instant,
    leaseOwner: z.string().min(1).max(200),
    leaseToken: uuid,
    leaseMs: z.number().int().positive().max(120_000),
  })
  .strict();

const leaseMutationInput = z
  .object({
    authority: rniSourceWorkflowAuthorityV2,
    at: instant,
    leaseOwner: z.string().min(1).max(200),
    leaseToken: uuid,
  })
  .strict();

const heartbeatInput = leaseMutationInput
  .extend({ leaseMs: z.number().int().positive().max(120_000) })
  .strict();

const retryInput = leaseMutationInput
  .extend({
    errorCode: stableCode,
    baseBackoffMs: z.number().int().positive().max(3_600_000),
    maxBackoffMs: z.number().int().positive().max(86_400_000),
  })
  .strict()
  .refine((value) => value.maxBackoffMs >= value.baseBackoffMs, {
    message: 'Maximum backoff must be at least the base backoff',
    path: ['maxBackoffMs'],
  });

const completeInput = leaseMutationInput.extend({ outputHash: digest }).strict();

const permanentFailureInput = leaseMutationInput.extend({ errorCode: stableCode }).strict();

const budgetStopInput = leaseMutationInput
  .extend({
    reason: z.enum([
      'attempts',
      'wall_time',
      'sources',
      'input_tokens',
      'output_tokens',
      'cost',
      'cancelled',
    ]),
  })
  .strict();

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function fail(code: RniSourceWorkflowCheckpointErrorCode, message: string): never {
  throw new RniSourceWorkflowCheckpointError(code, message);
}

function assertAuthority(
  subject: RniSourceWorkflowSubjectV2,
  authority: RniSourceWorkflowAuthorityV2,
): void {
  if (
    subject.runId !== authority.runId ||
    subject.planHash !== authority.planHash ||
    subject.platform !== authority.platform ||
    subject.outerAttempt !== authority.outerAttempt ||
    subject.outerToken !== authority.outerToken ||
    subject.deadline !== authority.deadline ||
    !sameValue(subject.workflowPolicy, authority.workflowPolicy)
  ) {
    fail('STALE_AUTHORITY', 'Parent I09 authority does not match the checkpoint subject');
  }
}

function assertLeasePolicy(authority: RniSourceWorkflowAuthorityV2, leaseMs: number): void {
  if (leaseMs !== authority.workflowPolicy.leaseMs) {
    fail('POLICY_CONFLICT', 'Source lease duration changed from immutable authority policy');
  }
}

function assertBackoffPolicy(
  authority: RniSourceWorkflowAuthorityV2,
  baseBackoffMs: number,
  maxBackoffMs: number,
): void {
  if (
    baseBackoffMs !== authority.workflowPolicy.baseBackoffMs ||
    maxBackoffMs !== authority.workflowPolicy.maxBackoffMs
  ) {
    fail('POLICY_CONFLICT', 'Retry backoff changed from immutable authority policy');
  }
}

function assertDelivery(
  checkpoint: RniSourceWorkflowCheckpointV2,
  delivery: RniSourceWorkflowDeliveryV2,
): void {
  if (!sameValue(checkpoint.delivery, delivery)) {
    fail('IDENTITY_CONFLICT', 'Source workflow delivery identity or input hash changed');
  }
}

function assertMonotonic(at: string, earliest: string): void {
  if (Date.parse(at) < Date.parse(earliest)) {
    fail('TIME_REGRESSION', 'Source workflow transition time moved backwards');
  }
}

function authorityExpiry(
  authority: RniSourceWorkflowAuthorityV2,
  at: string,
): 'outer_authority' | 'deadline' | null {
  const now = Date.parse(at);
  const deadline = Date.parse(authority.deadline);
  const outerExpiry = Date.parse(authority.outerLease.expiresAt);
  const boundary = Math.min(deadline, outerExpiry);
  if (now < boundary) return null;
  return deadline <= outerExpiry ? 'deadline' : 'outer_authority';
}

function assertActiveAuthority(authority: RniSourceWorkflowAuthorityV2, at: string): void {
  if (authorityExpiry(authority, at) !== null) {
    fail('STALE_AUTHORITY', 'Parent I09 authority or run deadline has expired');
  }
}

function cappedExpiry(
  at: string,
  leaseMs: number,
  authority: RniSourceWorkflowAuthorityV2,
): string {
  return new Date(
    Math.min(
      Date.parse(at) + leaseMs,
      Date.parse(authority.outerLease.expiresAt),
      Date.parse(authority.deadline),
    ),
  ).toISOString();
}

function runningCheckpoint(
  delivery: RniSourceWorkflowDeliveryV2,
  previous: RniSourceWorkflowCheckpointV2 | null,
  input: Pick<ClaimInput, 'at' | 'leaseOwner' | 'leaseToken' | 'leaseMs' | 'authority'>,
): RniSourceWorkflowCheckpointV2 {
  const attempt = previous === null ? 1 : previous.attempt + 1;
  if (attempt > RNI_SOURCE_WORKFLOW_MAX_ATTEMPTS) {
    fail('INVALID_TRANSITION', 'Source workflow attempt limit is exhausted');
  }
  return rniSourceWorkflowCheckpointV2.parse({
    version: 'rni-source-workflow-checkpoint-v2',
    delivery,
    status: 'running',
    attempt,
    startedAt: previous?.startedAt ?? input.at,
    updatedAt: input.at,
    lease: {
      owner: input.leaseOwner,
      token: input.leaseToken,
      acquiredAt: input.at,
      expiresAt: cappedExpiry(input.at, input.leaseMs, input.authority),
    },
    notBefore: null,
    retry: null,
    outputHash: null,
    completedAt: null,
    terminal: null,
  });
}

function attemptLimitTerminal(
  checkpoint: RniSourceWorkflowCheckpointV2,
  at: string,
): RniSourceWorkflowCheckpointV2 {
  return rniSourceWorkflowCheckpointV2.parse({
    ...checkpoint,
    status: 'permanent_failure',
    lease: null,
    notBefore: null,
    retry: null,
    updatedAt: at,
    terminal: {
      kind: 'permanent_failure',
      errorCode: 'WORKFLOW_ATTEMPT_LIMIT',
      causeCode: null,
      failedAt: at,
    },
  });
}

export function claimRniSourceWorkflowCheckpoint(
  current: RniSourceWorkflowCheckpointV2 | null,
  rawInput: ClaimInput,
): RniSourceWorkflowClaimResult {
  const input = claimInput.parse(rawInput);
  const checkpoint = current === null ? null : rniSourceWorkflowCheckpointV2.parse(current);
  assertAuthority(input.delivery.subject, input.authority);
  assertLeasePolicy(input.authority, input.leaseMs);
  assertMonotonic(input.at, input.authority.outerLease.acquiredAt);

  if (checkpoint !== null) {
    assertDelivery(checkpoint, input.delivery);
    assertMonotonic(input.at, checkpoint.updatedAt);
    if (checkpoint.status === 'completed') return { kind: 'duplicate', checkpoint };
    if (checkpoint.status === 'permanent_failure' || checkpoint.status === 'budget_stopped') {
      return { kind: 'terminal', checkpoint };
    }
  }

  const expired = authorityExpiry(input.authority, input.at);
  if (expired !== null) return { kind: 'expired', reason: expired, checkpoint };

  if (checkpoint === null) {
    return { kind: 'acquired', checkpoint: runningCheckpoint(input.delivery, null, input) };
  }

  if (checkpoint.status === 'running') {
    if (checkpoint.lease === null) {
      fail('INVALID_TRANSITION', 'Running checkpoint is missing its source lease');
    }
    if (
      Date.parse(checkpoint.lease.expiresAt) >
      Math.min(
        Date.parse(input.authority.outerLease.expiresAt),
        Date.parse(input.authority.deadline),
      )
    ) {
      fail('STALE_AUTHORITY', 'Current parent authority ends before the stored source lease');
    }
    if (Date.parse(input.at) < Date.parse(checkpoint.lease.expiresAt)) {
      return { kind: 'busy', retryAt: checkpoint.lease.expiresAt, checkpoint };
    }
    if (checkpoint.attempt === RNI_SOURCE_WORKFLOW_MAX_ATTEMPTS) {
      return { kind: 'terminal', checkpoint: attemptLimitTerminal(checkpoint, input.at) };
    }
    return { kind: 'acquired', checkpoint: runningCheckpoint(input.delivery, checkpoint, input) };
  }

  if (checkpoint.status !== 'retry_wait' || checkpoint.notBefore === null) {
    fail('INVALID_TRANSITION', 'Checkpoint cannot be claimed from its current state');
  }
  if (Date.parse(input.at) < Date.parse(checkpoint.notBefore)) {
    return { kind: 'deferred', retryAt: checkpoint.notBefore, checkpoint };
  }
  if (checkpoint.attempt === RNI_SOURCE_WORKFLOW_MAX_ATTEMPTS) {
    return { kind: 'terminal', checkpoint: attemptLimitTerminal(checkpoint, input.at) };
  }
  return { kind: 'acquired', checkpoint: runningCheckpoint(input.delivery, checkpoint, input) };
}

function assertOwnedRunning(
  checkpoint: RniSourceWorkflowCheckpointV2,
  input: LeaseMutationInput,
): asserts checkpoint is RniSourceWorkflowCheckpointV2 & {
  status: 'running';
  lease: NonNullable<RniSourceWorkflowCheckpointV2['lease']>;
} {
  assertAuthority(checkpoint.delivery.subject, input.authority);
  assertMonotonic(input.at, input.authority.outerLease.acquiredAt);
  assertMonotonic(input.at, checkpoint.updatedAt);
  assertActiveAuthority(input.authority, input.at);
  if (checkpoint.status !== 'running' || checkpoint.lease === null) {
    fail('INVALID_TRANSITION', 'Only a running checkpoint can be mutated');
  }
  if (checkpoint.lease.owner !== input.leaseOwner || checkpoint.lease.token !== input.leaseToken) {
    fail('STALE_LEASE', 'Source workflow lease owner or token is stale');
  }
  assertMonotonic(input.at, checkpoint.lease.acquiredAt);
  if (Date.parse(input.at) >= Date.parse(checkpoint.lease.expiresAt)) {
    fail('STALE_LEASE', 'Source workflow lease has expired');
  }
  if (
    Date.parse(checkpoint.lease.expiresAt) >
    Math.min(Date.parse(input.authority.outerLease.expiresAt), Date.parse(input.authority.deadline))
  ) {
    fail('STALE_AUTHORITY', 'Current parent authority ends before the stored source lease');
  }
}

export function heartbeatRniSourceWorkflowCheckpoint(
  rawCheckpoint: RniSourceWorkflowCheckpointV2,
  rawInput: LeaseMutationInput & { readonly leaseMs: number },
): RniSourceWorkflowCheckpointV2 {
  const checkpoint = rniSourceWorkflowCheckpointV2.parse(rawCheckpoint);
  const input = heartbeatInput.parse(rawInput);
  assertLeasePolicy(input.authority, input.leaseMs);
  assertOwnedRunning(checkpoint, input);
  const expiresAt = new Date(
    Math.max(
      Date.parse(checkpoint.lease.expiresAt),
      Date.parse(cappedExpiry(input.at, input.leaseMs, input.authority)),
    ),
  ).toISOString();
  return rniSourceWorkflowCheckpointV2.parse({
    ...checkpoint,
    updatedAt: input.at,
    lease: { ...checkpoint.lease, expiresAt },
  });
}

function permanentFailure(
  checkpoint: RniSourceWorkflowCheckpointV2,
  errorCode: string,
  causeCode: string | null,
  failedAt: string,
): RniSourceWorkflowCheckpointV2 {
  return rniSourceWorkflowCheckpointV2.parse({
    ...checkpoint,
    status: 'permanent_failure',
    lease: null,
    notBefore: null,
    retry: null,
    updatedAt: failedAt,
    terminal: { kind: 'permanent_failure', errorCode, causeCode, failedAt },
  });
}

export function retryRniSourceWorkflowCheckpoint(
  rawCheckpoint: RniSourceWorkflowCheckpointV2,
  rawInput: LeaseMutationInput & {
    readonly errorCode: string;
    readonly baseBackoffMs: number;
    readonly maxBackoffMs: number;
  },
): RniSourceWorkflowRetryResult {
  const checkpoint = rniSourceWorkflowCheckpointV2.parse(rawCheckpoint);
  const input = retryInput.parse(rawInput);
  assertBackoffPolicy(input.authority, input.baseBackoffMs, input.maxBackoffMs);

  if (checkpoint.status === 'retry_wait' && checkpoint.retry !== null) {
    assertAuthority(checkpoint.delivery.subject, input.authority);
    assertMonotonic(input.at, checkpoint.updatedAt);
    const delayMs = Math.min(
      input.maxBackoffMs,
      input.baseBackoffMs * 2 ** Math.max(0, checkpoint.attempt - 1),
    );
    if (
      checkpoint.retry.errorCode === input.errorCode &&
      checkpoint.retry.failedAt === input.at &&
      checkpoint.retry.delayMs === delayMs &&
      checkpoint.notBefore === new Date(Date.parse(input.at) + delayMs).toISOString()
    ) {
      return { kind: 'scheduled', checkpoint };
    }
    fail('INVALID_TRANSITION', 'Retry replay changed its failure or backoff decision');
  }

  assertOwnedRunning(checkpoint, input);
  if (checkpoint.attempt === RNI_SOURCE_WORKFLOW_MAX_ATTEMPTS) {
    return {
      kind: 'terminal',
      checkpoint: permanentFailure(checkpoint, 'WORKFLOW_ATTEMPT_LIMIT', input.errorCode, input.at),
    };
  }

  const delayMs = Math.min(
    input.maxBackoffMs,
    input.baseBackoffMs * 2 ** Math.max(0, checkpoint.attempt - 1),
  );
  const notBeforeMs = Date.parse(input.at) + delayMs;
  if (
    notBeforeMs >=
    Math.min(Date.parse(input.authority.outerLease.expiresAt), Date.parse(input.authority.deadline))
  ) {
    return {
      kind: 'terminal',
      checkpoint: permanentFailure(
        checkpoint,
        'WORKFLOW_RETRY_WINDOW_EXHAUSTED',
        input.errorCode,
        input.at,
      ),
    };
  }

  return {
    kind: 'scheduled',
    checkpoint: rniSourceWorkflowCheckpointV2.parse({
      ...checkpoint,
      status: 'retry_wait',
      lease: null,
      updatedAt: input.at,
      notBefore: new Date(notBeforeMs).toISOString(),
      retry: { errorCode: input.errorCode, failedAt: input.at, delayMs },
    }),
  };
}

export function completeRniSourceWorkflowCheckpoint(
  rawCheckpoint: RniSourceWorkflowCheckpointV2,
  rawInput: LeaseMutationInput & { readonly outputHash: string },
): RniSourceWorkflowCheckpointV2 {
  const checkpoint = rniSourceWorkflowCheckpointV2.parse(rawCheckpoint);
  const input = completeInput.parse(rawInput);
  assertAuthority(checkpoint.delivery.subject, input.authority);
  assertMonotonic(input.at, checkpoint.updatedAt);

  if (checkpoint.status === 'completed') {
    if (checkpoint.outputHash !== input.outputHash) {
      fail('OUTPUT_CONFLICT', 'Completed replay changed the saved output hash');
    }
    return checkpoint;
  }

  assertOwnedRunning(checkpoint, input);
  return rniSourceWorkflowCheckpointV2.parse({
    ...checkpoint,
    status: 'completed',
    lease: null,
    updatedAt: input.at,
    outputHash: input.outputHash,
    completedAt: input.at,
  });
}

export function failRniSourceWorkflowCheckpoint(
  rawCheckpoint: RniSourceWorkflowCheckpointV2,
  rawInput: LeaseMutationInput & { readonly errorCode: string },
): RniSourceWorkflowCheckpointV2 {
  const checkpoint = rniSourceWorkflowCheckpointV2.parse(rawCheckpoint);
  const input = permanentFailureInput.parse(rawInput);
  assertAuthority(checkpoint.delivery.subject, input.authority);
  assertMonotonic(input.at, checkpoint.updatedAt);

  if (checkpoint.status === 'permanent_failure') {
    if (
      checkpoint.terminal?.kind === 'permanent_failure' &&
      checkpoint.terminal.errorCode === input.errorCode &&
      checkpoint.terminal.causeCode === null &&
      checkpoint.terminal.failedAt === input.at
    ) {
      return checkpoint;
    }
    fail('INVALID_TRANSITION', 'Permanent-failure replay changed terminal details');
  }

  assertOwnedRunning(checkpoint, input);
  return permanentFailure(checkpoint, input.errorCode, null, input.at);
}

export function stopRniSourceWorkflowForBudget(
  rawCheckpoint: RniSourceWorkflowCheckpointV2,
  rawInput: LeaseMutationInput & {
    readonly reason:
      | 'attempts'
      | 'wall_time'
      | 'sources'
      | 'input_tokens'
      | 'output_tokens'
      | 'cost'
      | 'cancelled';
  },
): RniSourceWorkflowCheckpointV2 {
  const checkpoint = rniSourceWorkflowCheckpointV2.parse(rawCheckpoint);
  const input = budgetStopInput.parse(rawInput);
  assertAuthority(checkpoint.delivery.subject, input.authority);
  assertMonotonic(input.at, checkpoint.updatedAt);

  if (checkpoint.status === 'budget_stopped') {
    if (
      checkpoint.terminal?.kind === 'budget_stopped' &&
      checkpoint.terminal.reason === input.reason &&
      checkpoint.terminal.stoppedAt === input.at
    ) {
      return checkpoint;
    }
    fail('INVALID_TRANSITION', 'Budget-stop replay changed terminal details');
  }

  assertOwnedRunning(checkpoint, input);
  return rniSourceWorkflowCheckpointV2.parse({
    ...checkpoint,
    status: 'budget_stopped',
    lease: null,
    updatedAt: input.at,
    terminal: { kind: 'budget_stopped', reason: input.reason, stoppedAt: input.at },
  });
}
