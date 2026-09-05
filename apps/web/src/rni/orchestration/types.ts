import { z } from 'zod';
import type { JobDefinition, JobRun } from '@/contracts/operations';
import type { NewJobRun } from '@/repositories/jobs';
import {
  rniAiRoute,
  rniManualRefreshScopePreview,
  rniPlatformSlice,
  rniRun,
  rniTaskEnvelope,
  type RniManualRefreshScope,
} from '@/rni/contracts';

export const instant = z
  .string()
  .datetime()
  .refine((value) => Number.isFinite(Date.parse(value)));
export const digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const identifier = z.string().min(1).max(200);
const amount = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,12})?$/u);
const count = z.number().int().nonnegative().max(100_000);
export const taskCounts = z
  .object({
    rni_discovery: count,
    rni_relationship: count,
    rni_classifier: count,
    rni_verification: count,
    rni_challenger: count,
  })
  .strict();

/** Server-resolved, immutable limits for one new run. No client-supplied model or windows. */
export const refreshPlan = z
  .object({
    configVersion: z.string().regex(/^[1-9]\d*$/u),
    universeVersion: z.string().regex(/^[1-9]\d*$/u),
    promptVersion: identifier,
    aiRoute: rniAiRoute,
    scopePreview: rniManualRefreshScopePreview,
    timezone: z
      .string()
      .min(1)
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }),
    windowStart: instant,
    windowEnd: instant,
    comparisonStart: instant.nullable(),
    comparisonEnd: instant.nullable(),
    envelopes: z.array(rniTaskEnvelope).length(5),
    /** Maximum calls across ALL platform attempts, including retries, not expected averages. */
    calls: z.object({ reddit: taskCounts, x: taskCounts }).strict(),
    maxAttempts: z.number().int().min(1).max(3),
    maxRuntimeMs: z.number().int().min(1000).max(900_000),
    leaseMs: z.number().int().min(1000).max(120_000),
    baseBackoffMs: z.number().int().min(1).max(60_000),
    maxBackoffMs: z.number().int().min(1).max(120_000),
    coalesceMs: z.number().int().min(0).max(300_000),
    maxCostUsd: amount,
    coverage: z
      .object({ reddit: z.string().min(1).max(1000), x: z.string().min(1).max(1000) })
      .strict(),
  })
  .strict()
  .superRefine((plan, context) => {
    if (
      plan.scopePreview.universeVersion !== plan.universeVersion ||
      Date.parse(plan.windowStart) >= Date.parse(plan.windowEnd) ||
      (plan.comparisonStart === null) !== (plan.comparisonEnd === null) ||
      (plan.comparisonStart !== null &&
        plan.comparisonEnd !== null &&
        (Date.parse(plan.comparisonStart) >= Date.parse(plan.comparisonEnd) ||
          Date.parse(plan.comparisonEnd) > Date.parse(plan.windowStart))) ||
      new Set(plan.envelopes.map((entry) => entry.task)).size !== 5 ||
      plan.calls.x.rni_discovery !== 0 ||
      plan.maxBackoffMs < plan.baseBackoffMs
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid RNI run plan lineage or bounds',
      });
    }
  });
export type RniRefreshPlan = z.infer<typeof refreshPlan>;

export const platformDelivery = z
  .object({
    version: z.literal('rni-platform-v1'),
    runId: z.string().uuid(),
    platform: z.enum(['reddit', 'x']),
    planHash: digest,
    deliveryKey: identifier,
    attempt: z.number().int().min(1).max(3),
  })
  .strict();
export type RniPlatformDelivery = z.infer<typeof platformDelivery>;

export const combinedDelivery = platformDelivery
  .omit({ platform: true })
  .extend({
    version: z.literal('rni-combined-v1'),
  })
  .strict();
export type RniCombinedDelivery = z.infer<typeof combinedDelivery>;

export const combinedArtifact = z
  .object({
    runId: z.string().uuid(),
    planHash: digest,
    artifactHash: digest,
    status: z.enum(['complete', 'partial', 'insufficient']),
  })
  .strict();
export type RniCombinedArtifact = z.infer<typeof combinedArtifact>;

/** The I07 adapter must use this token in its atomic publication predicate, not just log it. */
export type RniCombinedFence = Readonly<{
  stage: 'combined';
  runId: string;
  planHash: string;
  attempt: number;
  token: string;
  acquiredAt: string;
  expiresAt: string;
  deadline: string;
}>;

const combinedExecution = z
  .object({
    status: z.enum(['waiting', 'pending', 'running', 'complete', 'failed']),
    attempt: z.number().int().min(0).max(3),
    delivery: combinedDelivery,
    notBefore: instant,
    lastAttemptAt: instant.nullable(),
    lease: z.object({ token: z.string().uuid(), expiresAt: instant }).strict().nullable(),
    errorCode: z
      .enum([
        'SYNTHESIS_TRANSIENT',
        'SYNTHESIS_PERMANENT',
        'VALIDATION_FAILED',
        'BUDGET_STOPPED',
        'LEASE_EXPIRED',
        'DEADLINE_EXCEEDED',
      ])
      .nullable(),
    outcomeHash: digest.nullable(),
    outcomeToken: z.string().uuid().nullable(),
    /** Written only in the SAME transaction as the fenced I07 publication, never from a read callback. */
    publication: z
      .object({
        artifact: combinedArtifact,
        token: z.string().uuid(),
        attempt: z.number().int().min(1).max(3),
        acquiredAt: instant,
        expiresAt: instant,
        committedAt: instant,
      })
      .strict()
      .nullable(),
  })
  .strict();

const platformExecution = z
  .object({
    slice: rniPlatformSlice,
    attempt: z.number().int().min(0).max(3),
    delivery: platformDelivery,
    notBefore: instant,
    lease: z.object({ token: z.string().uuid(), expiresAt: instant }).strict().nullable(),
    outcomeHash: digest.nullable(),
    outcomeToken: z.string().uuid().nullable(),
  })
  .strict();

export const executionRecord = z
  .object({
    version: z.literal('rni-execution-v1'),
    partition: identifier,
    jobRunId: z.string().uuid(),
    run: rniRun,
    plan: refreshPlan,
    planHash: digest,
    coalesceKey: digest,
    coalesceUntil: instant,
    deadline: instant,
    rerunOf: z.string().uuid().nullable(),
    reservedCostUsd: amount,
    platforms: z.object({ reddit: platformExecution, x: platformExecution }).strict(),
    combined: combinedExecution,
  })
  .strict();
export type RniExecutionRecord = z.infer<typeof executionRecord>;

const runCommand = z
  .object({
    disposition: z.literal('run'),
    key: identifier,
    intentHash: digest,
    runId: z.string().uuid(),
    scopePreview: rniManualRefreshScopePreview,
    acceptedAt: instant,
  })
  .strict();
export const skippedScheduleCommand = z
  .object({
    disposition: z.literal('skipped'),
    key: identifier,
    intentHash: digest,
    jobId: z.string().uuid(),
    dueAt: instant,
    nextDueAt: instant,
    acceptedAt: instant,
  })
  .strict();
export const commandRecord = z.discriminatedUnion('disposition', [
  runCommand,
  skippedScheduleCommand,
]);
export type RniCommandRecord = z.infer<typeof commandRecord>;

export const budgetUsage = z.object({ rollingDayUsd: amount, calendarMonthUsd: amount }).strict();
export type RniBudgetUsage = z.infer<typeof budgetUsage>;

/**
 * Coordinator adapter seam, not a second queue/ledger implementation.
 *
 * `transact` serializes command, scope, schedule and AI admission operations for the trusted
 * partition. Reads below lock the selected rows; every write rolls back on throw. No provider
 * call may occur inside the transaction. `createJob` inserts the existing normal job_run.
 * `createExecution` inserts rni_run and exactly two slices linked to that already-created job.
 * `putExecution` projects lifecycle changes to those same rows. `enqueue` is an idempotent
 * transactional outbox write, committed before any QStash publication. The relay must retry an
 * ambiguous publication with the same delivery key. An empty transaction must perform no write.
 *
 * Budget usage includes actual/uncertain I10 spend plus ALL outstanding admissions exactly once,
 * across partitions. `admitBudget` must take the global I10 budget lock and recheck the exact
 * proposal atomically, so two different scopes/partitions cannot overspend concurrently. Admitted
 * headroom converts to the existing I10 per-call reservations, never a competing spend ledger.
 */
export interface RniOrchestrationTransaction {
  getCommand(key: string): Promise<unknown | null>;
  putCommand(command: RniCommandRecord): Promise<void>;
  getExecution(runId: string): Promise<unknown | null>;
  findCoalescible(key: string, at: string): Promise<unknown | null>;
  resolveActivePlan(scope: RniManualRefreshScope, asOf: string): Promise<unknown>;
  getJobDefinition(jobId: string): Promise<JobDefinition | null>;
  /** Under the scheduled job lock; retained through the skip/advance or create transaction. */
  isScheduledJobBusy(jobId: string): Promise<boolean>;
  createJob(input: NewJobRun): Promise<JobRun>;
  createExecution(record: RniExecutionRecord): Promise<void>;
  putExecution(record: RniExecutionRecord): Promise<void>;
  admitBudget(input: {
    runId: string;
    at: string;
    costUsd: string;
    runLimitUsd: string;
  }): Promise<RniBudgetUsage>;
  enqueue(delivery: RniPlatformDelivery, notBefore: string): Promise<void>;
  enqueueCombined(delivery: RniCombinedDelivery, notBefore: string): Promise<void>;
  advanceSchedule(input: {
    jobId: string;
    version: number;
    dueAt: string;
    nextDueAt: string;
  }): Promise<void>;
  audit(input: {
    event:
      | 'accepted'
      | 'coalesced'
      | 'rerun'
      | 'platform_terminal'
      | 'platform_retry'
      | 'combined_committed'
      | 'combined_terminal'
      | 'combined_retry'
      | 'schedule_skipped';
    runId: string | null;
    actor: string;
    at: string;
    jobId?: string;
    dueAt?: string;
  }): Promise<void>;
}

export interface RniOrchestrationStore {
  transact<T>(
    partition: string,
    operation: (tx: RniOrchestrationTransaction) => Promise<T>,
  ): Promise<T>;
}

export type RniOrchestrationDependencies = {
  store: RniOrchestrationStore;
  /** Trusted server-owned environment/account partition, never an HTTP body field. */
  partition: string;
  actor: string;
  manualJobId: string;
  now(): Date;
  newId(): string;
  /** Must enforce role/rate-limit checks before any persisted command access. */
  authorize(action: 'refresh' | 'rerun' | 'schedule'): Promise<void>;
};
