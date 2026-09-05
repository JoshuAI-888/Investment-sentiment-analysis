/**
 * The dispatcher's own Redis lock (F16 §4.1 step 2 / step 7).
 *
 * "Acquire a Redis lock with a TTL exceeding the maximum run time. A second concurrent delivery
 * is a no-op, not a queued duplicate." / "Release the lock, including on failure. An expired
 * lock must not strand a job forever."
 *
 * Built on the exact same `INCR` + conditional `EXPIRE` primitive `services/dashboard/
 * rate-limit.ts#acquireRefreshLock` already uses over the shared Upstash REST client
 * (`services/dashboard/redis.ts`) — an established, reviewed pattern for this shape of guard,
 * not a new one invented for this feature. `INCR` returns `1` only for the caller that just
 * created the key; every other concurrent caller sees `2` or higher and is told "someone else
 * already holds this," which is the no-op F16 §4.1 step 2 asks for.
 *
 * **The one known gap in this pattern, inherited rather than introduced here.** A crash between
 * the `INCR` and the `EXPIRE` call would leave the key with no TTL — a lock that never expires.
 * `acquireRefreshLock` accepts this already (two calls, not one atomic `SET ... NX EX`) because
 * Upstash's REST client here exposes `GET`/`SET`/`INCR`/`EXPIRE` as separate commands with no
 * multi-command pipeline; this module makes the identical, already-reviewed trade rather than
 * inventing a second locking primitive for one feature. Named plainly under this feature's
 * `RISKS` rather than left implicit.
 */
import type { RedisClient } from './redis';

/** The single dispatch tick's own mutex — one key, cluster-wide, covering the whole tick. */
const DISPATCH_LOCK_KEY = 'dispatch:lock';

/**
 * F16 §4.3: dispatch runs on a five-minute cadence and does "minimal work when nothing is due."
 * The lock has to outlive not one job's `max_runtime_seconds` but the whole tick's worth of due
 * jobs run in sequence — and the lock is acquired *before* those jobs are even selected (F16
 * §4.1's own step order: lock at step 2, select due jobs at step 3), so this cannot be computed
 * from the jobs about to run. Ten minutes — double the five-minute cadence — is the Wave 1
 * policy: comfortably above any single seeded job's own `max_runtime_seconds` ceiling
 * (`scripts/seed-job-definitions.ts`: 60–300 seconds each) even allowing for more than one to run
 * in the same tick, and short enough that a genuinely stuck dispatcher recovers within two ticks
 * rather than being stranded for hours.
 */
export const DISPATCH_LOCK_TTL_SECONDS = 600;

export type LockHandle = {
  readonly release: () => Promise<void>;
};

/**
 * `null` when another delivery already holds the lock — the caller's own no-op branch. The
 * returned handle's `release` is idempotent (`DEL` on an already-gone key is a no-op in Redis),
 * so a caller may safely call it from a `finally` block that also runs after an already-handled
 * early return.
 */
export async function acquireDispatchLock(
  redis: RedisClient,
  ttlSeconds: number = DISPATCH_LOCK_TTL_SECONDS,
): Promise<LockHandle | null> {
  const count = await redis.incr(DISPATCH_LOCK_KEY);
  if (count !== 1) return null;

  await redis.expire(DISPATCH_LOCK_KEY, ttlSeconds);
  return { release: () => redis.del(DISPATCH_LOCK_KEY) };
}
