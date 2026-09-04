/**
 * The bitemporal tables, as data with no dependencies.
 *
 * Deliberately importable from anywhere — `repositories/as-of.ts` reads it to build the guard,
 * and `eslint.config.ts` reads it to arm `no-unbounded-pit-read`. **The lint rule and the guard
 * must agree on the same list**, and the only way to guarantee that is for there to be one.
 *
 * Adding a bitemporal table without adding it here leaves that table unguarded, and nothing
 * reports it — which is why `tests/unit/bitemporal-coverage.test.ts` checks the list against
 * the live schema rather than trusting it.
 */
export const BITEMPORAL_TABLES = [
  'market_snapshot',
  'attention_snapshot',
  'sentiment_snapshot',
  'security_profile_snapshot',
  'evidence_item',
] as const;

export type BitemporalTable = (typeof BITEMPORAL_TABLES)[number];

/**
 * The valid-time column each one uses. `evidence_item` names it `available_at` — when the
 * provider made the item available — because `published_at` is when the author wrote it, which
 * is emphatically not when we could have seen it.
 */
export const VALID_TIME_COLUMN: Record<BitemporalTable, string> = {
  market_snapshot: 'observed_at',
  attention_snapshot: 'observed_at',
  sentiment_snapshot: 'observed_at',
  security_profile_snapshot: 'observed_at',
  evidence_item: 'available_at',
};

/**
 * Tables that carry `ingested_at` but are **not** guarded as bitemporal fact tables, with the
 * reason. Listed rather than filtered so that a new table with a temporal column forces a
 * decision — the same discipline F03 applied to its valid-time/transaction-time pairs.
 */
export const NOT_A_FACT_TABLE: Record<string, string> = {
  calculation_input:
    "records the temporality of a fact rather than being one. It is read through its artifact, by calculation_id, never as a time series — and the artifact's own `input_cutoff` is what bounds it.",
  raw_provider_payload:
    'is raw storage under a retention policy (F22 §4.3), read by id from an artifact for the Inspector. It is not a metric source, and the sanitized payload may be absent entirely where rights forbid retention.',
};
