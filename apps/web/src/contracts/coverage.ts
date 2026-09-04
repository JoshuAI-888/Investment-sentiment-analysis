/**
 * Point-in-time and coverage contracts (F22).
 *
 * The feature that cannot be retrofitted. Under D-16 there is no backfill, so point-in-time
 * discipline, permanent retention and gap recording either exist from the first collected item
 * or the corpus is permanently unable to support D-09's promotion path.
 */
import { z } from 'zod';
import { timestamp } from './primitives';

/** The four axes coverage is tracked on. `market` is flat-rate; the other three are sampled. */
export const coverageAxis = z.enum(['reddit', 'x', 'substack', 'market']);
export type CoverageAxis = z.infer<typeof coverageAxis>;

export const gapReason = z.enum([
  'collector_down',
  'provider_outage',
  'quota_exhausted',
  /** F16 §4.1b: a sampling window refused by an X ceiling. Refused, never truncated. */
  'budget_denied',
  'unknown',
]);
export type GapReason = z.infer<typeof gapReason>;

/**
 * `permanent` is `true` as a **literal**, not a flag (F22 §3, and §7 review step 6 checks it).
 *
 * Under forward-only collection there is no other kind of gap. A boolean column would admit a
 * row claiming otherwise, and the first such row would quietly license interpolating across it.
 */
export const coverageGap = z
  .object({
    axis: coverageAxis,
    from: timestamp,
    to: timestamp,
    reason: gapReason,
    permanent: z.literal(true),
  })
  .refine((gap) => gap.to > gap.from, {
    message: 'a gap ends after it begins',
    path: ['to'],
  });
export type CoverageGap = z.infer<typeof coverageGap>;

export const coverageWindow = z.object({
  axis: coverageAxis,
  /** The coverage floor. Read from `collector_start`, never from configuration. */
  startedAt: timestamp,
  gaps: z.array(coverageGap),
  lastObservedAt: timestamp.nullable(),
});
export type CoverageWindow = z.infer<typeof coverageWindow>;

/**
 * Whether a metric may be computed over a requested window.
 *
 * Three of these are abstentions rather than values (product invariant §6.3). `below_floor` and
 * `overlaps_gap` are the ones F22 exists to produce: a window reaching before an axis started,
 * or across a hole in it, is not a smaller sample — it is a sample whose frame cannot be stated.
 */
export const windowEligibility = z.enum([
  'eligible',
  'below_floor',
  'overlaps_gap',
  'no_coverage',
]);
export type WindowEligibility = z.infer<typeof windowEligibility>;

export const windowVerdict = z.object({
  eligibility: windowEligibility,
  axis: coverageAxis,
  requestedFrom: timestamp,
  requestedTo: timestamp,
  /** The gaps the requested window actually touches. Rendered, never smoothed over. */
  overlappingGaps: z.array(coverageGap),
  floor: timestamp.nullable(),
  /** Verbatim, for a surface to render. §4.4: every historical view carries its floor. */
  disclosure: z.string(),
});
export type WindowVerdict = z.infer<typeof windowVerdict>;

/**
 * An as-of query bounds BOTH temporal columns. Carried as a type so that a caller cannot
 * construct one that bounds only `observed_at` — which is the failure the guard exists for and
 * which reads perfectly naturally.
 */
export const asOfQuery = z.object({
  table: z.string().min(1),
  asOfInstant: timestamp,
});
export type AsOfQuery = z.infer<typeof asOfQuery>;
