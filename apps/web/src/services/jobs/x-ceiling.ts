/**
 * X read ceilings (F16 §4.1b step 4, D-32).
 *
 * "Before dispatch, the window is checked against F18's X read ceilings (monthly, daily, and
 * per-event). A window that would breach a ceiling is not truncated — it is refused." F18 (the
 * budget policy feature) does not exist yet, so there is no operator-editable table to read
 * these from. D-32 is explicit about what that means in the meantime: **"the X read ceilings
 * start at zero"** until "the price trigger... is built, deployed, and demonstrably firing" —
 * which is this feature. So Wave 1's correct behaviour is that every ceiling defaults to zero,
 * every window therefore breaches it, and every window is refused — not an edge case to handle,
 * the intended state of the world today (mirrored exactly by the "make it explicit and tested,
 * not accidental" instruction this feature was built against).
 *
 * **Not added to `src/env.ts`.** `docs/06-PARALLEL-LANES.md` §4b names that file's append-only
 * block owners explicitly: F04 and F20 (COLLECT), F18 (SURFACE) — not F16a. These three ceilings
 * are D-32/D-20 figures that belong to F18's budget policy once it exists; reading them from a
 * plain, optionally-overridable environment variable here (mirroring `services/dashboard/
 * budget.ts#GLOBAL_BUDGET_CEILING_USD`'s own "not yet operator-editable" stance) avoids both
 * inventing a place for them to live permanently and touching a file this feature does not own.
 * Reported under this feature's `CONTRACTS`.
 */

export type XCeilings = {
  readonly monthlyReadCeiling: number;
  readonly dailyReadCeiling: number;
  readonly perEventReadCeiling: number;
};

function readNonNegativeIntEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${key} must be a non-negative integer when set, got '${raw}'`);
  }
  return parsed;
}

/** D-32's zero default for all three, until the named switch-on trigger fires and someone sets
 *  these env vars deliberately (or F18 ships and supersedes this module entirely). */
export function readXCeilings(): XCeilings {
  return {
    monthlyReadCeiling: readNonNegativeIntEnv('X_MONTHLY_READ_CEILING', 0),
    dailyReadCeiling: readNonNegativeIntEnv('X_DAILY_READ_CEILING', 0),
    perEventReadCeiling: readNonNegativeIntEnv('X_READS_PER_TRIGGER_EVENT', 0),
  };
}

/**
 * D-32's own named post-switch-on figure for "how many reads one fired window asks for" — not a
 * ceiling itself, the *request size* a window makes against the ceilings above. Kept distinct
 * from `X_READS_PER_TRIGGER_EVENT` (a ceiling F18 will own) so raising the ceiling alone, without
 * separately deciding how much one window should actually spend, cannot silently change spend.
 */
export const DEFAULT_TRIGGER_WINDOW_REQUESTED_READS = 100;
