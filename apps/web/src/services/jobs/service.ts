/**
 * `JobService` — F16 §3: "the single execution path for every refresh in the system, whether a
 * clock, a trigger, or a human started it." `executeJob` below **is** `JobService.execute`; the
 * dispatcher (`dispatchDueJobs`), the trigger path (`services/jobs/trigger.ts`, via the
 * `dispatchTriggeredJob` callback threaded through `JobHandlerContext`) and — once F16b's admin
 * UI exists — a manual refresh all call this one function, differing only in `triggerType` and
 * where `dueAt` comes from. F16 §7 review step 4 asks a reviewer to "diff the manual-refresh and
 * scheduled code paths — they must be the same function": there is exactly one function to diff
 * against itself here, which is the point.
 *
 * F16 §4.1's own step order is load-bearing and this module does not re-decide it — the route
 * handler (`app/api/cron/dispatch/route.ts`) is where signature verification (step 1) and the
 * Redis lock (step 2) happen, *before* this module is ever called; `dispatchDueJobs` picks up at
 * step 3 (select due jobs) and `executeJob` covers steps 4–6 (claim, execute, record outcome).
 */
import type { JobDefinition, JobRun } from '@/contracts/operations';
import type { Queryable } from '@/repositories/client';
import { getPool } from '@/repositories/client';
import {
  advanceJobDefinitionSchedule,
  claimJobRun,
  dueJobDefinitions,
  findRunningJobRun,
  finishJobRun,
  startJobRun,
  type JobRunOutcome,
  type TerminalJobRunStatus as RepositoryTerminalStatus,
} from '@/repositories/jobs';
import { buildDispatchIdempotencyKey } from './idempotency';
import { getJobHandler, type DispatchTriggeredJobInput, type DispatchTriggeredJobResult, type JobHandlerOutcome } from './registry';
import type { RedisClient } from './redis';
import { computeNextDueAt } from './schedule';

export type ExecuteJobInput = {
  readonly jobDefinition: JobDefinition;
  readonly triggerType: JobRun['triggerType'];
  /** F16 §4.1 step 4's `due_at` — the instant this specific claim is "for". */
  readonly dueAt: Date;
  /** F16 §4.1b: composes the idempotency key for a triggered window (`idempotency.ts`). */
  readonly extraIdempotencyComponent?: string;
  readonly dryRun?: boolean;
  readonly requestedBy?: string | null;
  readonly requestReason?: string | null;
  readonly db?: Queryable;
  readonly redis: RedisClient;
  readonly now?: Date;
};

export type ExecuteJobOutcome = 'executed' | 'duplicate_delivery' | 'concurrency_skipped';

export type ExecuteJobResult = {
  readonly outcome: ExecuteJobOutcome;
  readonly run: JobRun;
};

/**
 * Builds `finishJobRun`'s input, omitting any field the handler did not report entirely rather
 * than passing it as an explicit `undefined` — `finishJobRun`'s own doc treats an omitted
 * optional field as "leave the column's own default/prior value alone," which is a different,
 * deliberate thing from a caller asserting the value is empty. `exactOptionalPropertyTypes` (this
 * project's own `tsconfig.json`) makes the distinction a compile error if it is not honoured, not
 * merely a convention to remember.
 */
function finishArgsFromOutcome(outcome: JobHandlerOutcome, completedAt: Date): JobRunOutcome {
  let metrics: unknown = outcome.metrics;
  if (outcome.dryRunSummary !== undefined) {
    const base: Record<string, unknown> = typeof outcome.metrics === 'object' && outcome.metrics !== null ? { ...(outcome.metrics as Record<string, unknown>) } : {};
    metrics = { ...base, dryRun: outcome.dryRunSummary };
  }

  return {
    status: outcome.status as RepositoryTerminalStatus,
    completedAt,
    ...(outcome.itemsRead === undefined ? {} : { itemsRead: outcome.itemsRead }),
    ...(outcome.itemsWritten === undefined ? {} : { itemsWritten: outcome.itemsWritten }),
    ...(outcome.providerCalls === undefined ? {} : { providerCalls: outcome.providerCalls }),
    ...(outcome.estimatedCostUsd === undefined ? {} : { estimatedCostUsd: outcome.estimatedCostUsd }),
    ...(outcome.unpricedUnits === undefined ? {} : { unpricedUnits: outcome.unpricedUnits }),
    error: outcome.error ?? null,
    ...(metrics === undefined ? {} : { metrics }),
    ...(outcome.dataAsOf === undefined ? {} : { dataAsOf: outcome.dataAsOf }),
  };
}

/**
 * `JobService.execute(jobId, idempotencyKey)` (F16 §3) — named `executeJob` here because the
 * idempotency key is *derived*, not supplied by the caller (F16 §4.1 step 4 is this function's
 * own job, via `buildDispatchIdempotencyKey`), so the public signature takes what a caller
 * actually has (`jobDefinition`, `triggerType`, `dueAt`) rather than a key it would otherwise
 * have to derive identically at every call site.
 */
export async function executeJob(input: ExecuteJobInput): Promise<ExecuteJobResult> {
  const db = input.db ?? getPool();
  const now = input.now ?? new Date();
  const idempotencyKey = buildDispatchIdempotencyKey(input.jobDefinition.id, input.dueAt, input.extraIdempotencyComponent);

  const claim = await claimJobRun(
    {
      jobId: input.jobDefinition.id,
      triggerType: input.triggerType,
      idempotencyKey,
      configVersion: input.jobDefinition.configVersion,
      dryRun: input.dryRun ?? false,
      requestedBy: input.requestedBy ?? null,
      requestReason: input.requestReason ?? null,
      lockKey: idempotencyKey,
    },
    db,
  );

  if (!claim.claimed) {
    // F16 §4.1 step 4 / the triple-replay test: a re-delivery of the same due instant (or, for a
    // trigger, the same spike) finds its claim already made and does nothing further — no second
    // execution, no second cost event. `claim.run` may be `queued`, `running` or already
    // terminal; every one of those is correctly "already handled," never re-executed here.
    return { outcome: 'duplicate_delivery', run: claim.run };
  }

  if (input.jobDefinition.concurrencyPolicy === 'skip') {
    const running = await findRunningJobRun(input.jobDefinition.id, db);
    if (running !== null && running.id !== claim.run.id) {
      const skipped = await finishJobRun(
        claim.run.id,
        {
          status: 'skipped',
          completedAt: now,
          error: { reason: 'concurrency_policy_skip', alreadyRunningJobRunId: running.id },
        },
        db,
      );
      return { outcome: 'concurrency_skipped', run: skipped };
    }
  }
  // `queue`/`cancel_running` are seeded-schema values (migration 0007's own check constraint)
  // with no Wave 1 job actually using them (`scripts/seed-job-definitions.ts` seeds `skip`
  // everywhere) — deferred rather than half-implemented; see this feature's `DEFERRED`.

  const started = await startJobRun(claim.run.id, now, db);

  const handler = getJobHandler(input.jobDefinition.jobKey);
  if (handler === undefined) {
    const failed = await finishJobRun(
      claim.run.id,
      { status: 'failed', completedAt: now, error: { reason: 'no_handler_registered', jobKey: input.jobDefinition.jobKey } },
      db,
    );
    return { outcome: 'executed', run: failed };
  }

  const dispatchTriggeredJob = (triggerInput: DispatchTriggeredJobInput): Promise<DispatchTriggeredJobResult> =>
    executeJob({
      jobDefinition: triggerInput.jobDefinition,
      triggerType: 'triggered',
      dueAt: input.dueAt,
      extraIdempotencyComponent: triggerInput.extraIdempotencyComponent,
      requestReason: triggerInput.requestReason,
      db,
      redis: input.redis,
      now,
    }).then((result) => ({ outcome: result.outcome === 'duplicate_delivery' ? 'already_claimed' : result.outcome, run: result.run }) as DispatchTriggeredJobResult);

  let outcome: JobHandlerOutcome;
  try {
    outcome = await handler({
      db,
      redis: input.redis,
      now,
      dueAt: input.dueAt,
      dryRun: input.dryRun ?? false,
      jobRun: started.run,
      jobDefinition: input.jobDefinition,
      dispatchTriggeredJob,
    });
  } catch (error) {
    outcome = {
      status: 'failed',
      error: { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined },
    };
  }

  const finished = await finishJobRun(claim.run.id, finishArgsFromOutcome(outcome, now), db);
  return { outcome: 'executed', run: finished };
}

export const JobService = { execute: executeJob };

export type DispatchTickResult = {
  readonly executedCount: number;
  readonly truncated: boolean;
  readonly results: readonly ExecuteJobResult[];
};

/**
 * F16 §4.1 steps 3–6, run once per dispatcher tick. The Redis lock (step 2) is the *caller's*
 * responsibility (`app/api/cron/dispatch/route.ts`) — by the time this runs, the lock is already
 * held for the whole tick, which is exactly what lets a fired trigger inside one job's handler
 * dispatch its own window through `executeJob` without acquiring a second lock (F16 §4.1b's own
 * binding rule: "the trigger may never bypass the lock").
 */
export async function dispatchDueJobs(input: { readonly db?: Queryable; readonly redis: RedisClient; readonly now?: Date }): Promise<DispatchTickResult> {
  const db = input.db ?? getPool();
  const now = input.now ?? new Date();

  const due = await dueJobDefinitions(now, db);
  const results: ExecuteJobResult[] = [];

  for (const job of due.jobs) {
    const result = await executeJob({
      jobDefinition: job,
      triggerType: 'scheduled',
      dueAt: job.nextDueAt,
      db,
      redis: input.redis,
      now,
    });
    results.push(result);

    // F16 §4.1 step 6: "record ... the next run." Only the ordinary clock path advances its own
    // schedule — a triggered window is one-off and a manual run does not own the job's cadence.
    if (result.outcome !== 'duplicate_delivery') {
      const nextDueAt = computeNextDueAt(job, now);
      await advanceJobDefinitionSchedule(job.id, nextDueAt, 'job-service', db);
    }
  }

  return { executedCount: results.length, truncated: due.truncated, results };
}
