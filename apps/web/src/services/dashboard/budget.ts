/**
 * The global budget check F07 §4.6 requires before every refresh dispatch.
 *
 * D-20's ceiling is $350/month; D-32 starts the run rate near $200/month with the X line
 * unfunded. F18 (Wave 5) will make this operator-editable and give it its own home; until then
 * this is the one place a number this load-bearing is allowed to live, named plainly rather
 * than folded into a magic literal at the call site.
 */
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

function monthWindow(now: Date): { from: Date; to: Date } {
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

  const spent = Number(totalUsd);
  const ceiling = Number(ceilingUsd);

  if (Number.isFinite(spent) && Number.isFinite(ceiling) && spent >= ceiling) {
    return {
      allowed: false,
      spentUsd: totalUsd,
      ceilingUsd,
      message: `This month's recorded spend ($${totalUsd}) has reached the global ceiling ($${ceilingUsd}, D-20). Refresh is disabled until next month or until the ceiling changes.`,
    };
  }

  return { allowed: true, spentUsd: totalUsd, ceilingUsd };
}
