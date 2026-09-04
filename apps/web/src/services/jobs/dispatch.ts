/**
 * One dispatch tick (F16 §4.1 steps 2–7). This is what `POST /api/cron/dispatch` calls **after**
 * the route itself has already verified the QStash signature — signature verification happens in
 * the route handler, never in here, so that "rejected before any work" (§4.1 step 1 / §6's first
 * DoD item) is provable by never importing this module on the rejection path at all, not merely
 * by ordering statements within one function.
 */
import { dueJobDefinitions } from '@/repositories/jobs';
import { getPool, type Queryable } from '@/repositories/client';
import { acquireDispatchTickLock } from './dispatch-lock';
import { resolveRedisClient, type RedisClient } from './redis';
import { KEYS } from './redis';
import { executeJob } from './job-service';
import { scheduledIdempotencyKey } from './idempotency';

export type DispatchTickJobOutcome = {
  readonly jobKey: string;
  readonly jobId: string;
  readonly executed: boolean;
  readonly status: string;
};

export type DispatchTickResult =
  | {
      readonly ran: true;
      readonly dueCount: number;
      readonly truncated: boolean;
      readonly results: readonly DispatchTickJobOutcome[];
    }
  | { readonly ran: false; readonly reason: 'locked' };

export type RunDispatchTickOptions = {
  readonly db?: Queryable;
  readonly now?: Date;
  readonly redis?: RedisClient;
  readonly limit?: number;
};

export async function runDispatchTick(options: RunDispatchTickOptions = {}): Promise<DispatchTickResult> {
  const db = options.db ?? getPool();
  const now = options.now ?? new Date();
  const redis = options.redis ?? resolveRedisClient();
  const lockKey = KEYS.dispatchTickLock();

  // F16 §4.1 step 2: a second concurrent delivery is a no-op, not a queued duplicate.
  const lock = await acquireDispatchTickLock(redis);
  if (lock === null) {
    return { ran: false, reason: 'locked' };
  }

  try {
    // Step 3.
    const due = await dueJobDefinitions(now, db, options.limit);

    const results: DispatchTickJobOutcome[] = [];
    for (const job of due.jobs) {
      // Step 4: derived from (job_id, due_at). `job.nextDueAt` *is* the due instant that made
      // this job selectable — it does not change until `advanceJobDefinitionSchedule` runs, so a
      // re-delivery of the same tick before that happens derives the identical key and is caught
      // by `claimJobRun`'s own unique constraint.
      const idempotencyKey = scheduledIdempotencyKey(job.id, job.nextDueAt);

      // Step 5: the identical `JobService.execute` path a manual or triggered run uses.
      const result = await executeJob({
        job,
        triggerType: 'scheduled',
        idempotencyKey,
        lockKey,
        db,
        now,
      });

      results.push({
        jobKey: job.jobKey,
        jobId: job.id,
        executed: result.executed,
        status: result.run.status,
      });
    }

    return { ran: true, dueCount: due.jobs.length, truncated: due.truncated, results };
  } finally {
    // Step 7: released on every exit path, success or throw.
    await lock.release();
  }
}
