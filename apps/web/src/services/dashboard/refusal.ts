/**
 * Recording `POST /api/dashboard/refresh`'s refusal marker (F07 §4.6, `RefreshControl.tsx`).
 *
 * **F07 review finding 1.** The original `route.ts` wrote `dashboard:last_refusal` with a plain
 * `redis.set` and no TTL, for all three refusal reasons. `assembleDashboard` reads that key on
 * every page load and `RefreshControl` initializes disabled whenever it is non-null — and the
 * *only* writer that ever clears it is a *successful* refresh (`refresh.ts`'s
 * `redis.del(KEYS.lastRefusal())`), which a permanently-disabled button can never reach. A
 * double-click, or two tabs, produces a `rate_limited` refusal that then bricks the dashboard's
 * only mutation forever, until someone manually deletes the Redis key.
 *
 * The fix is a TTL per reason, chosen to match how long that specific refusal should actually
 * suppress the button — not a shared, arbitrary number:
 * - `rate_limited` expires with `checkRefreshRateLimit`'s own cooldown (`rate-limit.ts`): once
 *   the cooldown lifts, a new attempt is genuinely allowed again, so the marker should not
 *   outlive it.
 * - `in_progress` expires with the refresh lock's own TTL (`rate-limit.ts`): if the lock itself
 *   is gone (released normally, or expired after a crash), a marker claiming "still running"
 *   past that point is already wrong.
 * - `budget` expires on its own, longer window (`budget.ts`) — recorded spend does not change
 *   second to second, but it is still bounded, not permanent.
 */
import { BUDGET_REFUSAL_TTL_SECONDS } from './budget';
import type { RefreshRefusal } from './contract';
import { REFRESH_COOLDOWN_SECONDS, REFRESH_LOCK_TTL_SECONDS } from './rate-limit';
import { KEYS, type RedisClient } from './redis';

export type RefusalReason = RefreshRefusal['reason'];

/** Named per reason rather than one shared constant — see this file's doc comment for why each differs. */
export const REFUSAL_TTL_SECONDS: Readonly<Record<RefusalReason, number>> = {
  rate_limited: REFRESH_COOLDOWN_SECONDS,
  in_progress: REFRESH_LOCK_TTL_SECONDS,
  budget: BUDGET_REFUSAL_TTL_SECONDS,
};

/** Writes the refusal marker with the TTL its reason earns — never with none at all. */
export async function recordRefusal(redis: RedisClient, reason: RefusalReason, message: string): Promise<void> {
  await redis.set(KEYS.lastRefusal(), JSON.stringify({ refused: true, reason, message }));
  await redis.expire(KEYS.lastRefusal(), REFUSAL_TTL_SECONDS[reason]);
}
