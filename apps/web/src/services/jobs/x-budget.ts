/**
 * The X read-budget check F16 §4.1b step 4 requires before a sampling window dispatches
 * ("checked against F18's X read ceilings... a window that would breach a ceiling is not
 * truncated — it is refused"). **F18 has now landed** (`services/budget/policy.ts` +
 * `services/admin/settings-catalogue.ts`'s `x.monthly_read_ceiling` / `x.daily_read_ceiling` /
 * `trigger.x_reads_per_event` rows, F15) — this module is, as F16a's own session log named it,
 * "the one file to change when F18 lands." What changes here is real, general ceiling logic
 * (below), not just the numbers; what does **not** change is D-32's own value for those numbers,
 * because the named switch-on trigger — "the price trigger... built, deployed, and demonstrably
 * firing on real price movement" — has not fired yet. The ceilings below are D-32's real,
 * currently-correct figures, not placeholders.
 *
 * **Why this stays synchronous and reads no settings row directly.** `services/jobs/trigger.ts`
 * (COLLECT-owned, out of this feature's reach beyond this one file) calls
 * `budgetCheck(readsPerEvent)` synchronously, with no `await` and no second argument. Making this
 * function async, or requiring a `db`, would silently break that call site's type — `budget.
 * allowed` would read off a `Promise` instead of the resolved value — without this feature being
 * able to fix it (`docs/features/F18-cost-degradation.md`'s own build discipline: touch no other
 * file under `services/jobs/`). So the constants below are named literals, matching
 * `settings-catalogue.ts`'s seeded defaults for the same three keys exactly (single source of
 * truth for *what the number is*, even though this module cannot itself `await` a live read of
 * it) — and `usage` is an optional, purely-injected parameter so a *future* caller that can await
 * a real settings/consumption read (once trigger.ts's own call site is COLLECT's to make async)
 * can pass real numbers in without this function's shape changing again. Recorded as a named,
 * disclosed deferral in this feature's report rather than solved by widening scope into a file
 * this feature does not own.
 */
import { findCatalogueEntry } from '@/services/admin/settings-catalogue';

/**
 * D-32's own named figures, read from the same catalogue F15 seeded
 * (`settings-catalogue.ts`'s `x.monthly_read_ceiling` / `x.daily_read_ceiling` /
 * `trigger.x_reads_per_event`) rather than re-declared as a fourth copy of the numbers. All
 * three are catalogued as `integer`-typed settings, so `Number(...)` here is safe — these are
 * read counts, not currency, and D-20/D-32's decimal-safety requirement is about dollar
 * comparisons, not integer ones.
 */
function catalogueInt(key: string): number {
  const entry = findCatalogueEntry(key);
  if (entry === undefined) {
    throw new Error(`No settings-catalogue entry for '${key}' — settings-catalogue.ts and x-budget.ts have drifted.`);
  }
  return Number(entry.defaultValue);
}

/** D-32: starts at 0 until the switch-on trigger fires; then 30,000. */
export const X_MONTHLY_READ_CEILING = catalogueInt('x.monthly_read_ceiling');
/** D-32: starts at 0 alongside the monthly ceiling; then 1,430 (≈30,000 / trading days). */
export const X_DAILY_READ_CEILING = catalogueInt('x.daily_read_ceiling');
/** D-32's named per-trigger-event read spend — the size ceiling on any one fired window. */
export const X_READS_PER_TRIGGER_EVENT = catalogueInt('trigger.x_reads_per_event');

export type XBudgetCheck = { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

/**
 * Reads already spent this month/day, for a caller that can supply them (none can yet — see the
 * module doc). Defaults to `0` — the most permissive assumption, deliberately: with the ceilings
 * themselves still at zero (D-32), the outcome is identical either way, and defaulting to "assume
 * nothing spent yet" rather than "assume the ceiling is already exhausted" is what keeps this
 * function honest once a real ceiling and a real caller both exist — an unknown consumption count
 * must never manufacture a refusal that isn't really about the budget.
 */
export type XReadUsage = {
  readonly monthlyReadsConsumed?: number;
  readonly dailyReadsConsumed?: number;
};

/**
 * `readsRequested` is intentionally required (never defaulted to 0) so a call site cannot pass
 * this check by accident without stating how many reads the window it is about to open would
 * actually spend.
 *
 * Real, general logic — not a bare refusal — checked in the order a caller would want to know
 * about: the per-event ceiling first (a request too large for any single trigger event,
 * independent of what else has been spent this month), then the daily ceiling, then the monthly
 * one. Every one of the three is `0` under D-32 today, so every positive request is refused
 * regardless of order — the same externally-observed behaviour this module had before, now for a
 * reason a caller can act on once the ceilings are switched on rather than a single hardcoded
 * `false`.
 */
export function checkXReadBudget(readsRequested: number, usage: XReadUsage = {}): XBudgetCheck {
  if (readsRequested <= 0) {
    throw new RangeError(`readsRequested must be positive; received ${String(readsRequested)}`);
  }

  const monthlyReadsConsumed = usage.monthlyReadsConsumed ?? 0;
  const dailyReadsConsumed = usage.dailyReadsConsumed ?? 0;

  if (readsRequested > X_READS_PER_TRIGGER_EVENT) {
    return {
      allowed: false,
      reason:
        `D-32: this window would read ${String(readsRequested)} posts, more than the ` +
        `${String(X_READS_PER_TRIGGER_EVENT)}-read-per-trigger-event ceiling. Refused, not truncated.`,
    };
  }

  if (dailyReadsConsumed + readsRequested > X_DAILY_READ_CEILING) {
    return {
      allowed: false,
      reason:
        `D-32: X read ceilings start at zero until the price trigger is demonstrably firing in ` +
        `production. This spike would have opened a real sampling window (${String(readsRequested)} ` +
        `reads, ${String(dailyReadsConsumed)} already spent today against a ` +
        `${String(X_DAILY_READ_CEILING)}-read daily ceiling), but the budget for it has not been ` +
        `switched on yet.`,
    };
  }

  if (monthlyReadsConsumed + readsRequested > X_MONTHLY_READ_CEILING) {
    return {
      allowed: false,
      reason:
        `D-32: X read ceilings start at zero until the price trigger is demonstrably firing in ` +
        `production. This spike would have opened a real sampling window (${String(readsRequested)} ` +
        `reads, ${String(monthlyReadsConsumed)} already spent this month against a ` +
        `${String(X_MONTHLY_READ_CEILING)}-read monthly ceiling), but the budget for it has not ` +
        `been switched on yet.`,
    };
  }

  return { allowed: true };
}
