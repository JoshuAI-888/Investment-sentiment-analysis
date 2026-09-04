/**
 * Shared shapes for the evidence pack builder — F10 §4.3/§4.5. Pure data; no I/O, no calc/
 * import. `EvidencePack` is what F11's synthesis will eventually consume (F10 §7 review step
 * 5: "verify the sample-framing statement travels with the pack into F11's output") — F11 does
 * not exist yet (Wave 3, still blocked on MT-06 same as this feature), so nothing here is wired
 * to it; this module is the contract that build is expected to consume.
 */
import type { EvidenceItem } from '@/contracts/evidence';
import type { SocialAxis } from '@/contracts/primitives';
import type { MatchVia } from './matching';

/**
 * Every reason an evidence item can fail to make it into the pack. Recorded per item, never
 * collapsed to a single "excluded" bit — F10 §4.2: "the pack records retrieved count and used
 * count with the reason for each exclusion."
 */
export const EXCLUSION_REASONS = [
  /** Neither symbol, cashtag, company name nor alias appeared. No LLM call was spent. */
  'no_deterministic_match',
  /** Ambiguous bare token, and `entity.collision_guard` did not confirm it. */
  'ticker_collision_unconfirmed',
  /** Ambiguous bare token, and the collision guard's response was unclear twice (dropped). */
  'ticker_collision_unclear',
  /** `relevance.filter` judged the item not to be about the security. */
  'not_relevant',
  /** `relevance.filter`'s response was unclear twice (dropped, never coerced). */
  'relevance_unclear',
  /** Otherwise eligible, cut by the ≤30-item / ≤12-social-snippet bound (F10 §4.3). */
  'pack_bound_exceeded',
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export type AppliedMethod = { readonly methodId: string; readonly methodVersion: string };

export type IncludedItem = {
  readonly kind: 'included';
  readonly item: EvidenceItem;
  /** `null` for a non-social evidence type (news/filing/macro/provider_fact). */
  readonly axis: SocialAxis | null;
  readonly relevanceScore: string;
  readonly matchedVia: MatchVia;
  /**
   * Every method that actually ran for this item, in order — empty for a provider-scoped item
   * that went through neither (filing/macro), one entry for a plain relevance pass, two when the
   * collision guard ran first. Kept as a list rather than a single field so the Inspector-facing
   * "which method produced which field" question (D-21) has a real answer when both ran, not
   * just the last one.
   */
  readonly methods: readonly AppliedMethod[];
  /** Stable across a pack rebuild for the same item — F10 §4.3: "a stable ID that claims will later reference." */
  readonly stableId: string;
};

export type ExcludedItem = {
  readonly kind: 'excluded';
  readonly item: EvidenceItem;
  readonly axis: SocialAxis | null;
  readonly reason: ExclusionReason;
  readonly detail: string;
};

export type RedditFrameMeta = {
  readonly kind: 'reddit';
  /** False for the legacy product under D-39: there is no adapter, so nothing is ever polled. */
  readonly collected: boolean;
  readonly subredditsPolled: readonly string[];
  readonly treeComplete: boolean | null;
};

export type XFrameMeta = {
  readonly kind: 'x';
  readonly watchlistVersion: string | null;
  /** The price-trigger event that caused this sample, or `null` when nothing has triggered. */
  readonly triggerEvent: string | null;
};

export type SubstackFrameMeta = {
  readonly kind: 'substack';
  readonly publicationSetVersion: string;
  readonly selectionBasis: string;
};

export type AxisFrameMeta = RedditFrameMeta | XFrameMeta | SubstackFrameMeta;

/** F10 §4.5 — one per axis, always three, never blended (D-14). */
export type AxisDisclosure = {
  readonly axis: SocialAxis;
  readonly statement: string;
  readonly windowFrom: string | null;
  readonly windowTo: string | null;
  readonly retrievedCount: number;
  readonly usedCount: number;
  readonly exclusions: readonly { readonly reason: ExclusionReason; readonly count: number }[];
  readonly meta: AxisFrameMeta;
};

export type EvidencePack = {
  readonly securityId: string;
  readonly asOf: string;
  /** Bounded (≤30, ≤12 social), ordered by relevance then recency (F10 §4.3). */
  readonly items: readonly IncludedItem[];
  readonly excluded: readonly ExcludedItem[];
  /** Pre-dedup, pre-classification row count this pack was built from. */
  readonly retrievedCount: number;
  /** `items.length` — repeated here so a caller need not recompute it. */
  readonly usedCount: number;
  /** From the repository's own scan-window truncation (`evidenceForSecurity`'s `truncated`). */
  readonly truncatedByScanWindow: boolean;
  /** Always exactly reddit, x, substack, in that order (D-14: three frames, never blended). */
  readonly disclosures: readonly [AxisDisclosure, AxisDisclosure, AxisDisclosure];
};
