/**
 * The dispatch-tick lock (F16 §4.1 step 2 / step 7). Built on the exact `INCR` + conditional
 * `EXPIRE` idiom `services/dashboard/rate-limit.ts#acquireRefreshLock` already uses for F07's
 * refresh mutex, and F02's send cap before that — an established, reviewed pattern for this
 * shape of Redis guard, not a new one invented for this feature.
 *
 * **Why the TTL is a fixed constant rather than derived from the due jobs' own
 * `maxRuntimeSeconds`.** F16 §4.1 orders the steps: verify signature, *then* acquire the lock,
 * *then* select due jobs (step 3). The lock has to exist before anything is known about which
 * jobs are due this tick, so there is nothing yet to size it against. `DISPATCH_TICK_LOCK_TTL_SECONDS`
 * is set well past both Wave 1 jobs' real runtime (`market_data_poll`/`attention_poll` are
 * bounded HTTP collectors over ~100 securities, not long batch jobs) and past the five-minute
 * QStash cadence itself, so a tick that is merely running long does not get contended by the very
 * next delivery, and a tick that is genuinely stuck still recovers on its own within one extra
 * cadence interval — matching step 7's "an expired lock must not strand a job forever."
 */
import type { RedisClient } from './redis';
import { KEYS } from './redis';

export const DISPATCH_TICK_LOCK_TTL_SECONDS = 600;

export type DispatchLockHandle = { readonly release: () => Promise<void> };

/** `null` when another dispatch tick already holds the lock — the caller must treat this as a no-op, never a queued retry (F16 §4.1 step 2). */
export async function acquireDispatchTickLock(
  redis: RedisClient,
  ttlSeconds: number = DISPATCH_TICK_LOCK_TTL_SECONDS,
): Promise<DispatchLockHandle | null> {
  const key = KEYS.dispatchTickLock();
  const count = await redis.incr(key);
  if (count !== 1) return null;

  await redis.expire(key, ttlSeconds);
  return { release: () => redis.del(key) };
}
