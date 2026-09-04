/**
 * The heartbeat check (F16 §4.5 / D-16). "One deployment-managed daily Vercel Cron that checks
 * the last successful dispatch and alerts if it is stale... a failsafe alert only, never the
 * primary scheduler, and it must not be able to run jobs." This module is exactly that check —
 * pure, read-only, no dispatch import anywhere in its dependency graph.
 *
 * **Why 20 minutes.** The QStash schedule (`docs/DEPLOY.md` MT-04) fires every five minutes. A
 * threshold of four missed ticks tolerates a transient blip (a slow cold start, one failed
 * delivery QStash's own retry recovers) without waiting a full day to notice a genuinely dead
 * dispatcher — which, under D-16, is the one failure this route exists to catch before it costs
 * a second day of unrecoverable corpus.
 */
import { mostRecentJobRun } from '@/repositories/jobs';
import { getPool, type Queryable } from '@/repositories/client';

export const HEARTBEAT_STALE_THRESHOLD_MINUTES = 20;

export type HeartbeatCheck = {
  readonly stale: boolean;
  readonly lastSuccessAt: string | null;
  readonly thresholdMinutes: number;
  readonly checkedAt: string;
  readonly message: string;
};

export async function checkDispatchHeartbeat(
  db: Queryable = getPool(),
  now: Date = new Date(),
  thresholdMinutes: number = HEARTBEAT_STALE_THRESHOLD_MINUTES,
): Promise<HeartbeatCheck> {
  const lastSuccess = await mostRecentJobRun({ statuses: ['succeeded'] }, db);
  const checkedAt = now.toISOString();

  if (lastSuccess === null || lastSuccess.completedAt === null) {
    return {
      stale: true,
      lastSuccessAt: null,
      thresholdMinutes,
      checkedAt,
      message:
        'No job run has ever succeeded. Either the dispatcher has never fired, or every run so ' +
        'far has failed or been skipped — either way, no corpus is being collected right now.',
    };
  }

  const ageMinutes = (now.getTime() - lastSuccess.completedAt.getTime()) / 60_000;
  const stale = ageMinutes > thresholdMinutes;

  return {
    stale,
    lastSuccessAt: lastSuccess.completedAt.toISOString(),
    thresholdMinutes,
    checkedAt,
    message: stale
      ? `The last successful job run completed ${ageMinutes.toFixed(1)} minutes ago, past the ` +
        `${String(thresholdMinutes)}-minute threshold. Under D-16 this is unrecoverable corpus ` +
        'loss accruing right now, not a display glitch.'
      : `The last successful job run completed ${ageMinutes.toFixed(1)} minutes ago, within the ` +
        `${String(thresholdMinutes)}-minute threshold.`,
  };
}
