/**
 * F15 §4.2 — the **allowlisted typed key catalogue**. ADR-012: this is a governed control plane,
 * not an environment-variable editor. A key reaches `/admin/settings` only by being listed here;
 * `app_setting_no_secrets_check` (migration `0006_`) is the database-level backstop for the one
 * property that must never depend on this list alone — a secret cannot enter this catalogue even
 * if a future entry tried, because the column itself rejects `sensitive = true`.
 *
 * D-15 names the price-trigger thresholds explicitly as "operator-editable, versioned and
 * audited, because they govern X spend." D-32 records the real numbers this catalogue seeds:
 * the global budget ceilings ($290 warn / $320 reduce-optional / $350 hard) and the fact that
 * **X read ceilings start at zero** until the trigger is verified firing — not the source PRD's
 * stale $80/$90/$100 figures F15 §4.7 still quotes, which predate D-20's budget re-base. Seeding
 * D-32's numbers here (not $80/$90/$100) is a decision worth a reader's attention; recorded in
 * this feature's PR body under Decisions.
 */
import { z } from 'zod';

export type SettingValueType = 'decimal' | 'integer' | 'boolean' | 'string';

export type SettingCatalogueEntry = {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly valueType: SettingValueType;
  readonly governanceClass: 'budget' | 'trigger';
  readonly schema: z.ZodTypeAny;
  /** The value this key is seeded with when no config_version has ever carried it. */
  readonly defaultValue: unknown;
};

const percent = z.string().regex(/^\d{1,3}(\.\d{1,4})?$/, 'must be a decimal percent, e.g. "3.00"');
const nonNegativeInt = z.number().int().nonnegative();
const usd = z.string().regex(/^\d{1,7}(\.\d{1,2})?$/, 'must be a decimal USD amount, e.g. "290.00"');

export const SETTINGS_CATALOGUE: readonly SettingCatalogueEntry[] = [
  {
    key: 'trigger.price_move_pct',
    label: 'Price-move trigger threshold',
    description:
      'The daily price move (%) on FMP Starter daily bars (D-31) that opens an X-sampling ' +
      'window for a name (D-15). Governs X spend directly — this is the trigger.',
    valueType: 'decimal',
    governanceClass: 'trigger',
    schema: percent,
    defaultValue: '3.00',
  },
  {
    key: 'trigger.window_minutes',
    label: 'Trigger window length (minutes)',
    description: 'How long a name stays eligible for X sampling after its trigger fires.',
    valueType: 'integer',
    governanceClass: 'trigger',
    schema: nonNegativeInt,
    defaultValue: 15,
  },
  {
    key: 'trigger.x_reads_per_event',
    label: 'X reads per trigger event',
    description: 'D-32\'s X_READS_PER_TRIGGER_EVENT — the read budget spent on one fired trigger.',
    valueType: 'integer',
    governanceClass: 'trigger',
    schema: nonNegativeInt,
    defaultValue: 100,
  },
  {
    key: 'x.monthly_read_ceiling',
    label: 'X monthly read ceiling',
    description:
      'D-32: starts at 0 — X reads are not funded until the price trigger is verified firing ' +
      'on real price movement. Raise to 30,000 only after that evidence exists.',
    valueType: 'integer',
    governanceClass: 'budget',
    schema: nonNegativeInt,
    defaultValue: 0,
  },
  {
    key: 'x.daily_read_ceiling',
    label: 'X daily read ceiling',
    description: 'D-32: starts at 0, alongside the monthly ceiling.',
    valueType: 'integer',
    governanceClass: 'budget',
    schema: nonNegativeInt,
    defaultValue: 0,
  },
  {
    key: 'budget.warn_usd',
    label: 'Monthly spend — warn threshold',
    description: 'D-20/D-32: $290. F18 enforces; F15 sets the value (§4.7, §2 Out).',
    valueType: 'decimal',
    governanceClass: 'budget',
    schema: usd,
    defaultValue: '290.00',
  },
  {
    key: 'budget.reduce_usd',
    label: 'Monthly spend — reduce-optional threshold',
    description: 'D-20/D-32: $320.',
    valueType: 'decimal',
    governanceClass: 'budget',
    schema: usd,
    defaultValue: '320.00',
  },
  {
    key: 'budget.hard_usd',
    label: 'Monthly spend — hard block threshold',
    description: 'D-20/D-32: $350. The single global ceiling D-11 leaves as the only budget control.',
    valueType: 'decimal',
    governanceClass: 'budget',
    schema: usd,
    defaultValue: '350.00',
  },
] as const;

export const SETTING_SCHEMA_VERSION = '1';

export function findCatalogueEntry(key: string): SettingCatalogueEntry | undefined {
  return SETTINGS_CATALOGUE.find((entry) => entry.key === key);
}
