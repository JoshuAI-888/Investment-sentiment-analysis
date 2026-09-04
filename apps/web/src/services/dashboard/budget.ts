/**
 * The global budget check F07 §4.6 requires before every refresh dispatch.
 *
 * D-20's ceiling is $350/month; D-32 starts the run rate near $200/month with the X line
 * unfunded. `GLOBAL_BUDGET_CEILING_USD` below is the safety-net default this function falls
 * back to; F18 (`services/budget/policy.ts`) is now built and is where the ceiling becomes
 * operator-editable and live — `app/api/dashboard/refresh/route.ts` resolves the live figure
 * (`resolveBudgetThresholds().hardUsd`) and passes it in explicitly as `ceilingUsd` rather than
 * this module reaching into settings itself, so this function's signature, its one DB query
 * shape, and every existing caller/test stay exactly as they were.
 */
import { dec } from '@/calc/decimal';
import { spendInWindow } from '@/repositories/cost';
import { getPool, type Queryable } from '@/repositories/client';

/** D-20. Not yet operator-editable (F18) — the constant is the honest state of the world today. */
export const GLOBAL_BUDGET_CEILING_USD = '350';

/**
 * F07 review finding 1: how long a `budget` refusal marker (`dashboard:last_refusal`) is
 * allowed to keep the refresh control disabled before the dashboard re-checks for itself.
 * Recorded spend does not change second to second the way a rate-limit cooldown does, so this
 * is longer than `REFRESH_COOLDOWN_SECONDS`/`REFRESH_LOCK_TTL_SECONDS` (`rate-limit.ts`) — but
 * it is still a bounded window, not "forever": a refusal with no expiry at all is a permanently
 * bricked refresh button with no path back once the underlying condition clears (a new month, a
 * ceiling change), which is exactly the bug this constant exists to close.
 */
export const BUDGET_REFUSAL_TTL_SECONDS = 15 * 60;

export type BudgetCheckResult =
  | { readonly allowed: true; readonly spentUsd: string; readonly ceilingUsd: string }
  | { readonly allowed: false; readonly spentUsd: string; readonly ceilingUsd: string; readonly message: string };

/**
 * Exported for `services/budget/policy.ts` (F18), which evaluates the same calendar-month
 * window at the D-32 warn/reduce/hard tiers — one definition of "this month," not two.
 */
export function monthWindow(now: Date): { from: Date; to: Date } {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from, to };
}

/**
 * Refuses when this calendar month's recorded spend has already reached the global ceiling.
 * Unpriced calls are not silently treated as free — `spendInWindow`'s `unpricedCount` is
 * available to a caller that wants to surface it, though a dashboard refresh against
 * never-priced providers (market data, Marketaux) will typically show `unpricedCount > 0` and
 * `totalUsd` unaffected by this feature's own calls.
 */
export async function checkGlobalBudget(
  now: Date = new Date(),
  db: Queryable = getPool(),
  ceilingUsd: string = GLOBAL_BUDGET_CEILING_USD,
): Promise<BudgetCheckResult> {
  const { from, to } = monthWindow(now);
  const { totalUsd } = await spendInWindow(from, to, db);

  // F18 build discipline: decimal-safe, not `Number()` — a raw JS number in a budget threshold
  // comparison is a named review failure. `dec()` throws on a non-decimal string rather than
  // silently coercing to `NaN`, which is what `Number.isFinite` used to guard against here.
  if (dec(totalUsd).greaterThanOrEqualTo(dec(ceilingUsd))) {
    return {
      allowed: false,
      spentUsd: totalUsd,
      ceilingUsd,
      message: `This month's recorded spend ($${totalUsd}) has reached the global ceiling ($${ceilingUsd}, D-20). Refresh is disabled until next month or until the ceiling changes.`,
    };
  }

  return { allowed: true, spentUsd: totalUsd, ceilingUsd };
}
