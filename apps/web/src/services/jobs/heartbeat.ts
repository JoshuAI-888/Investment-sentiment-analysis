/**
 * The heartbeat (F16 §4.5, D-16) — "a failsafe alert only, never the primary scheduler, and it
 * must not be able to run jobs."
 *
 * **Enforced by what this module is allowed to import, not merely by what its route handler
 * happens to call.** This file imports one read-only repository function
 * (`repositories/jobs.ts#mostRecentJobRun`) and nothing from `registry.ts`, `service.ts` or
 * `handlers/` — there is no `executeJob`, no `JobHandler`, no registry lookup reachable from
 * here at all, so a bug in this module cannot accidentally come to run a job the way it could if
 * it merely *chose* not to call `executeJob` today.
 *
 * "checks the last **successful** dispatch" (§4.5) is exactly `mostRecentJobRun({statuses:
 * ['succeeded']})`'s own documented purpose — its doc names this heartbeat as the reason the
 * caller must state `'succeeded'` explicitly rather than reach a wider set by omission, so a
 * `queued` or `failed` row can never read as "healthy."
 */
import type { Queryable } from '@/repositories/client';
import { mostRecentJobRun } from '@/repositories/jobs';

/**
 * Six missed five-minute ticks (F16 §4.3's own cadence). Long enough that one slow or
 * cold-started tick is not a false alarm; short enough that a genuinely stalled dispatcher is
 * caught well within the same day it stalls — D-16's "a gap here is a gap forever" is the reason
 * this errs toward catching it sooner rather than tolerating a longer quiet period.
 */
export const HEARTBEAT_STALE_THRESHOLD_MINUTES = 30;

export type HeartbeatCheckResult = {
  readonly stale: boolean;
  readonly lastSuccessfulCompletedAt: string | null;
  readonly minutesSinceLastSuccess: number | null;
  readonly message: string;
};

/** Pure — the actual staleness decision, independently unit-testable against a fixed clock. */
export function evaluateHeartbeat(
  lastSuccessfulCompletedAt: Date | null,
  now: Date,
  thresholdMinutes: number = HEARTBEAT_STALE_THRESHOLD_MINUTES,
): HeartbeatCheckResult {
  if (lastSuccessfulCompletedAt === null) {
    return {
      stale: true,
      lastSuccessfulCompletedAt: null,
      minutesSinceLastSuccess: null,
      message:
        'No job_run has ever completed successfully. Under D-16 this may mean the collector has ' +
        'never started at all — treated as maximally stale rather than silently healthy.',
    };
  }

  const minutesSince = (now.getTime() - lastSuccessfulCompletedAt.getTime()) / 60_000;
  const stale = minutesSince > thresholdMinutes;
  return {
    stale,
    lastSuccessfulCompletedAt: lastSuccessfulCompletedAt.toISOString(),
    minutesSinceLastSuccess: minutesSince,
    message: stale
      ? `No job has completed successfully in ${minutesSince.toFixed(1)} minutes (threshold ` +
        `${String(thresholdMinutes)}). Under D-16 collection is forward-only with no backfill — ` +
        'every minute this is genuinely true is permanently lost corpus.'
      : `Last successful job completed ${minutesSince.toFixed(1)} minutes ago, within the ` +
        `${String(thresholdMinutes)}-minute threshold.`,
  };
}

/** The read + decision, together, for the route handler to call. */
export async function checkDispatchHeartbeat(
  db?: Queryable,
  now: Date = new Date(),
  thresholdMinutes: number = HEARTBEAT_STALE_THRESHOLD_MINUTES,
): Promise<HeartbeatCheckResult> {
  const lastSuccessful = await mostRecentJobRun({ statuses: ['succeeded'] }, db);
  return evaluateHeartbeat(lastSuccessful?.completedAt ?? null, now, thresholdMinutes);
}
