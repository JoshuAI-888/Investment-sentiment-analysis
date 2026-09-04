/**
 * `JobService.execute` (F16 §3 / §4.1 step 5) — "the **single** execution path for every refresh
 * in the system, whether a clock, a trigger, or a human started it."
 *
 * There is exactly one function here — `executeJob` — and every caller in this feature goes
 * through it: `dispatch.ts`'s tick loop (`triggerType: 'scheduled'`), `trigger.ts`'s fired
 * spikes (`triggerType: 'triggered'`, recursively, from inside this same function), and — once
 * F16b (SURFACE, Wave 4) builds the admin manual-refresh route — a human
 * (`triggerType: 'manual'`). A reviewer diffing that eventual manual-refresh route against
 * `dispatch.ts`'s scheduled call site should find them both bottoming out in this one function
 * with only the `triggerType`/`requestedBy` fields differing — that is F16 §7 review step 4's
 * "diff the manual-refresh and scheduled code paths — they must be the same function" made
 * literally true rather than merely similar.
 *
 * Everything upstream of the claim (which job, which idempotency key) is the caller's job; this
 * function does not select due work or decide eligibility.
 */
import {
  advanceJobDefinitionSchedule,
  claimJobRun,
  finishJobRun,
  startJobRun,
  type JobRunOutcome,
} from '@/repositories/jobs';
import type { JobDefinition, JobRun } from '@/contracts/operations';
import { getPool, type Queryable } from '@/repositories/client';
import {
  ATTENTION_POLL_JOB_KEY,
  MARKET_DATA_POLL_JOB_KEY,
  SUBSTACK_POLL_JOB_KEY,
  runAttentionPoll,
  runMarketDataPoll,
  runSubstackPoll,
  type CollectorRunResult,
} from './collectors';
import { X_SAMPLING_WINDOW_JOB_KEY, type TriggerDispatchRequest } from './trigger';
import { computeNextDueAt } from './schedule';

export type JobHandler = (job: JobDefinition, db: Queryable, now: Date) => Promise<CollectorRunResult>;

/**
 * `x_sampling_window` is deliberately a stub — F16a builds the dispatch mechanism (the
 * eligibility check, the budget refusal, the idempotency key), not a real X-fetching collector,
 * which is out of this feature's scope (`docs/progress/collect.md`; see this feature's report).
 * Wave 1 seeds the row `enabled = false` and D-32's zero read ceiling means this is currently
 * unreachable in production regardless — this stub exists only so the call path is real and
 * testable, not so it is safe to enable today.
 */
const stubXSamplingWindowHandler: JobHandler = (_job, _db, _now) =>
  Promise.resolve({
    outcome: {
      status: 'skipped',
      completedAt: new Date(),
      itemsRead: 0,
      itemsWritten: 0,
      providerCalls: 0,
      estimatedCostUsd: '0',
      metrics: {
        note:
          'x_sampling_window has no real execution yet — F16a builds the dispatch path (eligibility, ' +
          'budget refusal, idempotency), not the X fetch itself. See the feature report.',
      },
    },
    triggerDispatchRequests: [],
  });

const DISPATCH_TABLE: Readonly<Record<string, JobHandler>> = {
  [MARKET_DATA_POLL_JOB_KEY]: (job, db, now) => runMarketDataPoll(job, db, now),
  [ATTENTION_POLL_JOB_KEY]: (_job, db, now) => runAttentionPoll(db, now),
  [SUBSTACK_POLL_JOB_KEY]: (_job, db, now) => runSubstackPoll(db, now),
  [X_SAMPLING_WINDOW_JOB_KEY]: stubXSamplingWindowHandler,
};

export type ExecuteJobArgs = {
  readonly job: JobDefinition;
  readonly triggerType: JobRun['triggerType'];
  /** F16 §4.1 step 4: `(job_id, due_at)` for a scheduled tick; `trigger.ts` derives its own for a triggered window. Never generated in this function — a caller that cannot state its own idempotency key is describing a different operation. */
  readonly idempotencyKey: string;
  readonly lockKey: string;
  readonly db?: Queryable;
  readonly now?: Date;
  readonly requestedBy?: string | null;
  readonly requestReason?: string | null;
  readonly dryRun?: boolean;
};

export type ExecuteJobResult = {
  readonly run: JobRun;
  /** `false` for a no-op: the idempotency key was already claimed, or another delivery already holds `running`. */
  readonly executed: boolean;
  readonly triggerDispatchRequests: readonly TriggerDispatchRequest[];
};

function errorPayload(error: unknown): Record<string, unknown> {
  return error instanceof Error
    ? { message: error.message, name: error.name }
    : { message: String(error) };
}

export async function executeJob(args: ExecuteJobArgs): Promise<ExecuteJobResult> {
  const db = args.db ?? getPool();
  const now = args.now ?? new Date();
  const dryRun = args.dryRun ?? false;

  const claim = await claimJobRun(
    {
      jobId: args.job.id,
      triggerType: args.triggerType,
      idempotencyKey: args.idempotencyKey,
      configVersion: args.job.configVersion,
      lockKey: args.lockKey,
      dryRun,
      requestedBy: args.requestedBy ?? null,
      requestReason: args.requestReason ?? null,
    },
    db,
  );

  // F16 §4.1 step 4 / §6: a re-delivery of the same (job_id, due_at) is a no-op. The claim's own
  // `unique` constraint already made this true under concurrency (`repositories/jobs.ts`); this
  // is the caller honouring what it returns.
  if (!claim.claimed) {
    return { run: claim.run, executed: false, triggerDispatchRequests: [] };
  }

  const started = await startJobRun(claim.run.id, now, db);
  if (!started.started) {
    // Another delivery already progressed this exact run past `queued` (an expired lock
    // admitting a second concurrent dispatcher — F16 §4.1 step 7's own named scenario).
    return { run: started.run, executed: false, triggerDispatchRequests: [] };
  }

  if (dryRun) {
    // §4.4: "makes zero external calls." The handler is never invoked.
    const finished = await finishJobRun(
      claim.run.id,
      {
        status: 'skipped',
        completedAt: new Date(),
        metrics: { dryRun: true, jobKey: args.job.jobKey, wouldCallProvider: args.job.jobKey },
      },
      db,
    );
    return { run: finished, executed: true, triggerDispatchRequests: [] };
  }

  const handler = DISPATCH_TABLE[args.job.jobKey];

  let outcome: JobRunOutcome;
  let triggerDispatchRequests: readonly TriggerDispatchRequest[] = [];
  try {
    if (handler === undefined) {
      throw new Error(`no dispatch handler registered for job_key '${args.job.jobKey}'`);
    }
    const result = await handler(args.job, db, now);
    outcome = result.outcome;
    triggerDispatchRequests = result.triggerDispatchRequests;
  } catch (error) {
    outcome = {
      status: 'failed',
      completedAt: new Date(),
      error: errorPayload(error),
    };
  }

  const finished = await finishJobRun(claim.run.id, outcome, db);

  // F16 §4.1 step 6: "record outcome, duration, cost, and the next run." Advancing the schedule
  // is scoped to a clock-driven run — a triggered or manual run does not own this job's cadence,
  // and re-advancing it on every triggered window would desynchronise `next_due_at` from the
  // clock schedule an operator actually configured. Advanced regardless of success/failure: a
  // job whose schedule never moves past a failing due instant would re-attempt (and re-fail) it
  // forever, which is a worse outcome than skipping one interval and retrying next tick — full
  // `max_attempts`/`backoff_policy`-aware retry is a named, deferred gap (see the feature report).
  if (args.triggerType === 'scheduled') {
    const nextDueAt = computeNextDueAt(args.job, args.job.nextDueAt);
    await advanceJobDefinitionSchedule(args.job.id, nextDueAt, 'jobs:dispatch', db);
  }

  // Dispatched *after* this run's own outcome is durably finished, and in its own try/catch, so
  // a triggered window's failure can never be mistaken for — or overwrite the recorded outcome
  // of — the run that discovered it.
  for (const request of triggerDispatchRequests) {
    try {
      await executeJob({
        job: request.job,
        triggerType: 'triggered',
        idempotencyKey: request.idempotencyKey,
        lockKey: args.lockKey,
        db,
        now,
        requestReason: request.reason,
      });
    } catch (dispatchError) {
      // Wave 1 has no alerting channel beyond deployment logs (see the heartbeat route's own note).
      console.error(
        `triggered dispatch for idempotency key '${request.idempotencyKey}' failed`,
        dispatchError,
      );
    }
  }

  return { run: finished, executed: true, triggerDispatchRequests };
}
