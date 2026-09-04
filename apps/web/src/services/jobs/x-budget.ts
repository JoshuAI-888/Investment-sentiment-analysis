/**
 * The X read-budget check F16 §4.1b step 4 requires before a sampling window dispatches
 * ("checked against F18's X read ceilings... a window that would breach a ceiling is not
 * truncated — it is refused"). **F18 (budget policy) has not been built** — there is no
 * `X_MONTHLY_READ_CEILING`/`X_DAILY_READ_CEILING`/`X_READS_PER_TRIGGER_EVENT` anywhere in this
 * tree, no `app_setting` row for them, and no admin surface to edit them (that is F16b/F18's
 * Wave 4 territory).
 *
 * **This is not a gap this module papers over — it is D-32, already decided and already the
 * correct current value.** `docs/MEMORY.md` D-32: *"the X read ceilings start at zero"* until
 * "the price trigger... is built, deployed, and demonstrably firing on real price movement." That
 * condition is not yet true (F16a is what makes it true, and this PR is the first time the
 * trigger exists at all), so the ceiling this module encodes — zero — is not a placeholder
 * standing in for a real number; it *is* the real, currently-correct number. When F18 lands and
 * the owner sets real ceilings (D-32's own named switch-on trigger), this is the one file that
 * changes, and `services/jobs/trigger.ts`'s call site does not.
 */
export type XBudgetCheck = { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

/**
 * `readsRequested` is intentionally required (never defaulted to 0) so a call site cannot pass
 * this check by accident without stating how many reads the window it is about to open would
 * actually spend.
 */
export function checkXReadBudget(readsRequested: number): XBudgetCheck {
  if (readsRequested <= 0) {
    throw new RangeError(`readsRequested must be positive; received ${String(readsRequested)}`);
  }

  // D-32: the ceiling is zero until the switch-on trigger fires. Every positive request is
  // therefore refused today, by design — see the module doc.
  return {
    allowed: false,
    reason:
      'D-32: X read ceilings start at zero until the price trigger is demonstrably firing in ' +
      'production. This spike would have opened a real sampling window, but the budget for it ' +
      'has not been switched on yet.',
  };
}
