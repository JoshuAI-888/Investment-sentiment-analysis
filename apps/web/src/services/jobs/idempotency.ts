/**
 * F16 §4.1 step 4: "Claim each with an idempotency key derived from `(job_id, due_at)`. A
 * re-delivery of the same due instant is a no-op." `repositories/jobs.ts#claimJobRun`'s own doc
 * states plainly that it enforces the key's uniqueness but does not derive it — "F16a derives
 * the key, not this module." This is that derivation, and the only one in the codebase.
 */

/**
 * `(job_id, due_at)` for the ordinary clock and manual paths. `dueAt` must be the job's own
 * `next_due_at` at the moment it was selected, not the wall clock the dispatcher happened to run
 * at — two dispatch ticks racing (or a retried delivery) the same due instant must derive the
 * identical key, which only holds if both read the same stored `next_due_at` rather than each
 * stamping their own `now()`.
 *
 * **`extraComponent` (F16 §4.1b's trigger path).** "A spike detected twice in one interval is
 * one window" needs a key that is unique per *(triggering job's due instant, security)*, not
 * merely per due instant — one `market-data.poll` tick can span many securities, and each
 * firing security opens its own bounded window, not one window shared by every spike that tick.
 * Appending the security id keeps the same `(job_id, due_at)` grammar's guarantee (a stable,
 * derived key, never read back and re-derived differently) while giving each triggered window
 * its own identity within the tick that opened it.
 */
export function buildDispatchIdempotencyKey(jobId: string, dueAt: Date, extraComponent?: string): string {
  const base = `${jobId}:${dueAt.toISOString()}`;
  return extraComponent === undefined ? base : `${base}:${extraComponent}`;
}
