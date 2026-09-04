/**
 * The shared vocabulary. Contracts depend on nothing else
 * (`docs/02-ARCHITECTURE-CONTRACTS.md` §3), which is what lets every other layer depend on
 * them without a cycle.
 */
import { z } from 'zod';

/**
 * A decimal, carried as a string from the database to the render and back.
 *
 * This is the single most load-bearing type in the schema. `numeric` parsed into a JS number
 * is a float, and a float that round-trips differently on two platforms makes an artifact's
 * `result_hash` unreproducible — which takes ADR-019's replayability claim with it. The pg
 * type parser is overridden in `repositories/client.ts` so this stays true at the boundary.
 */
export const decimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'must be a decimal string, not a float (02-ARCHITECTURE-CONTRACTS.md §4.2)');

export type DecimalString = z.infer<typeof decimalString>;

/** `bigserial` columns arrive as strings for the same reason. */
export const bigintString = z.string().regex(/^\d+$/, 'must be a positive integer string');

export const uuid = z.string().uuid();

/** Postgres hands back a `Date` for timestamptz; both forms are accepted and normalised. */
export const timestamp = z.union([z.date(), z.string().datetime({ offset: true })]).transform((value) =>
  value instanceof Date ? value : new Date(value),
);

export const isoDate = z.union([z.date(), z.string()]).transform((value) => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
});

export const jsonValue: z.ZodType<unknown> = z.unknown();

/** Product invariant §6.1 — the three sampling frames are never interchangeable. */
export const socialAxis = z.enum(['reddit', 'x', 'substack']);
export type SocialAxis = z.infer<typeof socialAxis>;

export const stanceLabel = z.enum(['bullish', 'bearish', 'neutral']);
export type StanceLabel = z.infer<typeof stanceLabel>;

/**
 * Abstention is a value, not an absent one (product invariant §6.3). A metric below threshold
 * says so; it does not render a zero, a dash, or a smaller number.
 */
export const insufficiencyReason = z.enum([
  'below_sample_threshold',
  'no_coverage_in_window',
  'scorer_unavailable',
  'provider_unavailable',
  'methodology_version_boundary',
  /**
   * `attention.rank_change`, F06 §4.1: absent from the board at the *prior* end only — new to
   * the board since the last observation, not a thin sample and not the same fact as the mirror
   * case below. Kept distinct from `not_applicable` rather than folded into it (lane-review):
   * before this, both ends of "absent from the board" produced the identical reason and message,
   * so a UI wanting to say "New" had no structured field to read it from and would have had to
   * re-derive the state itself by reading `rank_prior` out of the artifact's raw inputs —
   * exactly the thing a registered method exists to prevent.
   */
  'new_to_board',
  /** The mirror case: present at the *prior* end, absent *now* — fell off the board. */
  'dropped_from_board',
  'not_applicable',
]);
export type InsufficiencyReason = z.infer<typeof insufficiencyReason>;
