/**
 * F07 §4.6 — refresh is "authenticated, rate-limited, idempotent, budget-checked".
 *
 * Budget is `budget.ts`; auth is `requireUser()` at the route handler. This file is the other
 * two, both built on the same `INCR` + conditional `EXPIRE` primitive F02's send cap uses
 * (`services/auth/send-cap.ts`) — an established, reviewed pattern for exactly this shape of
 * Redis-backed guard, not a new one invented for this feature.
 *
 * **Idempotency, not just rate limiting.** §4.6 asks for both, and they are different
 * properties: a second identical request within the cooldown window must not start a second
 * computation (idempotent), and a caller cannot simply retry faster to get a second one anyway
 * (rate-limited). One lock key serves both: `acquireRefreshLock` is a mutex held for the
 * duration of one refresh, released when it completes; `checkRefreshRateLimit` additionally
 * refuses a *new* request within the cooldown even after the previous one released the lock,
 * so a caller cannot poll the refresh button into a de-facto continuous trigger.
 */
import type { RedisClient } from './redis';
import { KEYS } from './redis';

export const REFRESH_COOLDOWN_SECONDS = 60;
export const REFRESH_LOCK_TTL_SECONDS = 120;

export type RateLimitResult = { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number };

/** Refuses a refresh requested within `REFRESH_COOLDOWN_SECONDS` of the last one that started. */
export async function checkRefreshRateLimit(redis: RedisClient): Promise<RateLimitResult> {
  const key = KEYS.refreshCooldown();
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, REFRESH_COOLDOWN_SECONDS);
    return { allowed: true };
  }
  return { allowed: false, retryAfterSeconds: REFRESH_COOLDOWN_SECONDS };
}

export type LockHandle = { readonly release: () => Promise<void> };

/**
 * A mutex so two concurrent refresh requests (a double-click, two tabs) never run the
 * computation twice. `null` means another refresh is already in flight — F07 §4.6's
 * idempotency half, distinct from the cooldown above.
 */
export async function acquireRefreshLock(redis: RedisClient): Promise<LockHandle | null> {
  const key = KEYS.refreshLock();
  const count = await redis.incr(key);
  if (count !== 1) return null;

  await redis.expire(key, REFRESH_LOCK_TTL_SECONDS);
  return {
    release: () => redis.del(key),
  };
}
