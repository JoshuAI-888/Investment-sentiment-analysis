/**
 * `EvidencePack` and `ClassifiedItem` — F10 §3, §4.3–§4.5.
 *
 * Frozen ahead of F10/F11/F12's parallel build (`MEMORY.md` D-41/D-42) so all three can be built
 * against a stable shape rather than each guessing what the others produce. Builds **on top of**
 * `evidence.ts`'s already-merged `evidenceItem` (F09 renders against it today) rather than
 * replacing it — a `ClassifiedItem` is an `EvidenceItem` plus the classification F10 §4.4 adds
 * (relevance, the collision guard, and F20's stance), never a parallel shape.
 *
 * **Stance stays on `evidenceItem`'s existing nullable `stanceLabel`** (`bullish | bearish |
 * neutral`, never widened to include `'unclear'`) — an item F20 could not confidently classify,
 * or that the collision guard excluded, simply carries `stanceLabel: null` and a `flags` entry
 * explaining why, exactly as F10 §4.4's retry-once-then-drop-to-`unclear` discipline describes.
 * Widening the shared `stanceLabel` enum itself would also change `sentimentSnapshot` and F20's
 * `ScoreResult`, which is a larger change than this feature owns.
 */
import { z } from 'zod';
import { decimalString, socialAxis, timestamp, uuid } from './primitives';
import { evidenceItem } from './evidence';

/**
 * F10 §4.4's flags. `'ticker_collision'` marks an item the collision guard excluded (`relevant:
 * false`); the rest describe an included item's caveats. `'truncated'` is F10 §4.4's named D-21
 * deferral trigger — long-form Substack text past the scorer's 512-token window — not an error.
 */
export const classificationFlag = z.enum([
  'sarcasm',
  'promotional',
  'off_topic',
  'ticker_collision',
  'truncated',
]);
export type ClassificationFlag = z.infer<typeof classificationFlag>;

export const classifiedItem = z.object({
  item: evidenceItem,
  /** Which of the three never-blended frames this item belongs to (D-14). Matches `item.provider`. */
  axis: socialAxis,
  /** `relevance.filter`'s output — Tier B's B1 precision gate is measured against this. */
  relevant: z.boolean(),
  /** The registered `MethodRegistry` version that produced `relevant`, for the Inspector (D-21). */
  relevanceMethodVersion: z.string().min(1),
  /** F20's own confidence for `item.stanceLabel`, used only as a weight — never displayed as accuracy. */
  stanceConfidence: decimalString.nullable(),
  flags: z.array(classificationFlag),
  /**
   * Non-null exactly when this item was retrieved but not used — F10 §4.2's "retrieved count and
   * used count with the reason for each exclusion", carried per item rather than only as a total.
   */
  excludedReason: z.string().nullable(),
});
export type ClassifiedItem = z.infer<typeof classifiedItem>;

/** F10 §4.5's three per-axis statements, verbatim — never a shared or blended sentence. */
export const AXIS_FRAME_STATEMENT: Readonly<Record<z.infer<typeof socialAxis>, string>> = {
  reddit:
    'observed sample of comments from the subreddits polled — not a sample of retail investors.',
  x: 'watched-account sample, collected around a price trigger. Coverage is event-conditional, not continuous.',
  substack: 'curated publication set, selected on the basis recorded in config version {v}.',
};

/**
 * One axis's disclosure, attached to the pack (F10 §4.5). Only the fields for `axis` itself are
 * meaningful on a given entry — e.g. `subredditsPolled` is set only where `axis === 'reddit'`.
 * Kept as one schema with optional fields, rather than a discriminated union, because every
 * consumer (F11's prompt context, F09's page render) wants "the disclosure for axis X" without
 * a runtime narrowing step; the optionality itself is the documentation of which fields apply.
 */
export const frameDisclosure = z.object({
  axis: socialAxis,
  frameStatement: z.string().min(1),
  window: z.object({ from: timestamp, to: timestamp }),
  retrievedCount: z.number().int().nonnegative(),
  usedCount: z.number().int().nonnegative(),
  /**
   * True when `retrievedCount` is a lower bound, not an exact count — `evidenceForSecurity`'s own
   * scan window (`repositories/evidence.ts`'s `CANDIDATE_SCAN_LIMIT`) was hit before every row for
   * this axis was necessarily read. Never omit this: a caller rendering "N found" from a truncated
   * count with no way to know it was truncated reports a wrong number with a right one's confidence.
   */
  truncated: z.boolean(),
  /** Reddit only: the subreddits actually polled this window. */
  subredditsPolled: z.array(z.string()).optional(),
  /** Reddit only: whether the comment tree for each retrieved post was read to completion. */
  treeComplete: z.boolean().optional(),
  /** X only: the watchlist version sampled against. */
  watchlistVersion: z.string().optional(),
  /** X only: the price-trigger event that caused this sample to exist at all. */
  triggerEventId: z.string().optional(),
  /** Substack only: `DEPLOY.md` MT-15's config artifact version (`D-40`). */
  publicationSetVersion: z.string().optional(),
  /** Substack only: the disclosed selection basis, verbatim (D-29). */
  selectionBasis: z.string().optional(),
});
export type FrameDisclosure = z.infer<typeof frameDisclosure>;

export const evidencePack = z
  .object({
    id: uuid,
    securityId: uuid,
    /** The deterministic query that produced this pack — F10 DoD: "visible downstream". */
    retrievalQuery: z.string().min(1),
    retrievalWindow: z.object({ from: timestamp, to: timestamp }),
    /** F10 §4.3: ≤ 30 items, ordered by relevance then recency. */
    items: z.array(classifiedItem).max(30),
    /** 1–3 entries — one per axis actually represented in `items`, never more than the three that exist. */
    frames: z.array(frameDisclosure).min(1).max(3),
    createdAt: timestamp,
  })
  .refine((pack) => new Set(pack.frames.map((f) => f.axis)).size === pack.frames.length, {
    message: 'One frame disclosure per axis — a duplicate axis entry would let two conflicting statements exist for the same frame.',
    path: ['frames'],
  });
export type EvidencePack = z.infer<typeof evidencePack>;
