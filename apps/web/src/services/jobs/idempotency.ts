/**
 * Idempotency key construction (F16 §4.1 step 4 / §4.1b). Pulled out as pure functions, separate
 * from `dispatch.ts`/`trigger.ts`'s own orchestration, so the derivation itself — not just its
 * downstream effect on `claimJobRun` — has a direct unit test (§5's own test-plan line: "unit:
 * ... idempotency key construction").
 */

/** F16 §4.1 step 4: "derived from `(job_id, due_at)`." `dueAt` is the job's own `next_due_at` at selection time — the instant that made it due, not the instant the tick happened to run. */
export function scheduledIdempotencyKey(jobId: string, dueAt: Date): string {
  return `${jobId}:${dueAt.toISOString()}`;
}

/**
 * F16 §4.1b: "the same spike detected twice in one interval yields one window." Anchored to the
 * triggering bar's own `observedAt` (its trading date), not to the instant the dispatch tick
 * that noticed it happened to run — a real spike is re-observed on every five-minute tick until
 * the next day's bar lands (D-31 runs on daily bars), and this key has to be identical across
 * every one of those re-observations for the "one spike, one window" rule to hold.
 */
export function triggeredIdempotencyKey(xJobId: string, securityId: string, observedAt: string): string {
  return `${xJobId}:spike:${securityId}:${observedAt}`;
}
