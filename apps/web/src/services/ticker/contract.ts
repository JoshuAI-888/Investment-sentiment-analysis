/**
 * F09 §3 — "Produces: the ticker snapshot contract."
 *
 * **Not placed in `src/contracts/`.** That directory is SPINE-owned
 * (`docs/progress/surface.md`, `CLAUDE.md`) and this lane may consume it but not add to it — the
 * same precedent F07 already set for `services/dashboard/contract.ts`. Reused shapes
 * (`decimalString`, `timestamp`) are imported normally; only *adding* to `src/contracts/` is out
 * of bounds.
 *
 * This is the single source of truth for what `GET /api/ticker/:symbol/snapshot` returns,
 * `assembleTickerSnapshot` builds and `tests/contract/ticker-snapshot.test.ts` checks against.
 */
import { z } from 'zod';
import { decimalString, timestamp } from '@/contracts/primitives';

export const metricEligibility = z.enum(['ok', 'insufficient_data', 'not_applicable', 'stale']);
export type MetricEligibility = z.infer<typeof metricEligibility>;

/**
 * What `InspectableMetric` needs to render one number, plus product invariant §6.1's labelling
 * requirement (`source`, `n`, `window`, `observedAt` freshness) — the same shape F07's
 * `dashboardMetric` establishes, duplicated here deliberately (not imported) so the two features'
 * contracts can evolve independently, per `ui/dashboard/types.ts`'s own precedent for why a
 * structurally-identical shape is still declared twice rather than shared.
 */
export const axisMetric = z.object({
  calculationId: z.string().min(1),
  metricId: z.string().min(1),
  label: z.string().min(1),
  display: z.string().nullable(),
  unit: z.string(),
  roundingRule: z.string(),
  eligibility: metricEligibility,
  reason: z.string().nullable(),
  asOf: timestamp.nullable(),
  source: z.string().nullable(),
  n: z.number().int().nonnegative().nullable(),
  window: z.string().nullable(),
  observedAt: timestamp.nullable(),
  stale: z.boolean(),
});
export type AxisMetric = z.infer<typeof axisMetric>;

// ── Header (F09 §4.1) ────────────────────────────────────────────────────────────────────────

export const marketSession = z.enum(['premarket', 'regular', 'afterhours', 'closed', 'eod']);

export const tickerHeader = z.object({
  securityId: z.string().uuid(),
  symbol: z.string().min(1),
  name: z.string().min(1),
  exchange: z.string().min(1),
  assetType: z.enum(['equity', 'etf']),
  sector: z.string().nullable(),
  /** Raw stored fact — no registered method backs a single price print (see this feature's CONTRACTS note). */
  price: decimalString.nullable(),
  changePercent: decimalString.nullable(),
  session: marketSession.nullable(),
  provider: z.string().nullable(),
  observedAt: timestamp.nullable(),
  /**
   * Round-4 lane-review finding 4: F09 §2 lists "insider and filings links (cut-line items 3 and
   * 2)" as **In** scope; nothing on this branch implemented or disclosed them until now.
   * `security.cik` needs no provider call — these are plain SEC EDGAR browse URLs, built from a
   * column already on hand. `null` when the security has no CIK on record (an honest "not
   * available", not a broken link).
   */
  filingsHref: z.string().nullable(),
  insiderTransactionsHref: z.string().nullable(),
});
export type TickerHeader = z.infer<typeof tickerHeader>;

// ── Attention axis (F09 §4.2) ───────────────────────────────────────────────────────────────────

export const attentionChartPoint = z.object({
  observedAt: timestamp,
  mentions: z.number().int().nonnegative(),
  rank: z.number().int().positive().nullable(),
});

export const attentionAxis = z.object({
  /** `null` when nothing has ever been observed on this axis for this security. */
  mentions: z.number().int().nonnegative().nullable(),
  rank: z.number().int().positive().nullable(),
  observedAt: timestamp.nullable(),
  mentionDelta: axisMetric.nullable(),
  rankChange: axisMetric.nullable(),
  /** F22 §4.4: segments split at every recorded gap. A gap is never interpolated across. */
  chartSegments: z.array(z.array(attentionChartPoint)),
  /** Verbatim per §4.4 — every historical view carries its coverage floor. */
  coverageDisclosure: z.string(),
  gapCount: z.number().int().nonnegative(),
});
export type AttentionAxis = z.infer<typeof attentionAxis>;

// ── Sampled stance — three per-frame disclosures (D-14, F10 §4.5) ──────────────────────────────

export const socialAxisId = z.enum(['reddit', 'x', 'substack']);
export type SocialAxisId = z.infer<typeof socialAxisId>;

export const stanceFrame = z.object({
  axis: socialAxisId,
  label: z.string().min(1),
  metric: axisMetric.nullable(),
  sampleAdequacy: decimalString.nullable(),
  retrievedCount: z.number().int().nonnegative(),
  usedCount: z.number().int().nonnegative(),
  window: z.string().min(1),
  /** D-14, verbatim per frame — different selection mechanics, so one blended sentence is false. */
  disclosure: z.string().min(1),
  /** The registry's `limitations[]` for this frame's method, reproduced (not paraphrased). */
  selectionBiasNotes: z.array(z.string().min(1)),
});
export type StanceFrame = z.infer<typeof stanceFrame>;

// ── News axis ────────────────────────────────────────────────────────────────────────────────

export const newsAxis = z.object({
  metric: axisMetric.nullable(),
  articleCount: z.number().int().nonnegative(),
  window: z.string().min(1),
});
export type NewsAxis = z.infer<typeof newsAxis>;

// ── Price axis ───────────────────────────────────────────────────────────────────────────────

export const priceReturnView = z.object({
  horizonCalendarDays: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(180)]),
  totalReturn: decimalString.nullable(),
  asOfDate: z.string(),
  baselinePriceDate: z.string(),
  qualityStatus: z.string(),
});
export type PriceReturnView = z.infer<typeof priceReturnView>;

export const priceAxis = z.object({
  returns: z.array(priceReturnView),
  /**
   * F09 §4.2 asks for "5d/20d returns"; `price_return_snapshot`'s horizon check constraint only
   * admits 7/30/90/180 *calendar* days (migration `0002`). Rendered honestly as what is actually
   * stored, with this disclosure surfaced on the page rather than silently relabelling a 7-day
   * calendar return as a "5d" trading-day one. See this feature's CONTRACTS report.
   */
  horizonDisclosure: z.string().min(1),
  volatility20: axisMetric.nullable(),
  regime: axisMetric.nullable(),
  rsi14: axisMetric.nullable(),
  movingAverage20: axisMetric.nullable(),
  movingAverage50: axisMetric.nullable(),
});
export type PriceAxis = z.infer<typeof priceAxis>;

// ── Divergence (F06 §4.6, product invariant §6.4) ───────────────────────────────────────────────

export const divergencePanel = z.discriminatedUnion('available', [
  z.object({
    available: z.literal(true),
    metricId: z.literal('market.divergence_state'),
    calculationId: z.string().min(1),
    state: z.string().min(1),
    interpretation: z.string().min(1),
    /** §6.4, verbatim, sourced from the artifact's own `warnings[]` — never hardcoded in the view. */
    disclosure: z.string().min(1),
    /**
     * Round-4 lane-review finding 2: `interpretation`'s wording ("Discussion is optimistic…") is
     * an unqualified claim about "stance", but the artifact's social leg is Reddit's sampled
     * stance alone (D-14's three frames are never blended) — this names that explicitly so the
     * panel does not let a Reddit-only reading pass as coverage of all three platforms.
     */
    socialAxisDisclosure: z.string().min(1),
    /**
     * Round-4 lane-review finding 3: this artifact's synthesized inputs used to all carry a
     * `null` `provenance.observedAt`, which made it structurally incapable of ever being marked
     * stale regardless of how old the underlying data actually was. Now threaded through for
     * real, so the panel can disclose staleness the same way every other metric on this page does.
     */
    observedAt: timestamp.nullable(),
    stale: z.boolean(),
  }),
  z.object({ available: z.literal(false), reason: z.string().min(1) }),
]);
export type DivergencePanel = z.infer<typeof divergencePanel>;

// ── Evidence drawer (F09 §4.3) ──────────────────────────────────────────────────────────────────

export const evidenceAvailability = z.enum(['available', 'unreachable', 'removed', 'paywalled', 'unchecked']);

export const evidenceItemView = z.object({
  id: z.string().uuid(),
  dedupeKey: z.string(),
  sourceKind: z.string().min(1),
  provider: z.string().min(1),
  publisher: z.string().nullable(),
  title: z.string().min(1),
  url: z.string().nullable(),
  publishedAt: timestamp.nullable(),
  retrievedAt: timestamp,
  snippet: z.string().nullable(),
  relevance: decimalString.nullable(),
  availability: evidenceAvailability,
  lastCheckedAt: timestamp.nullable(),
  /** F-19: rendered whenever `availability !== 'available'` — the honest, non-blank fallback. */
  unreachableNote: z.string().nullable(),
});
export type EvidenceItemView = z.infer<typeof evidenceItemView>;

export const evidenceDrawer = z.object({
  items: z.array(evidenceItemView),
  retrievedCount: z.number().int().nonnegative(),
  usedCount: z.number().int().nonnegative(),
  /** `true` when `repositories/evidence.ts#evidenceForSecurity`'s 5,000-row scan itself was
   *  exhausted — a genuinely unbounded corpus past even the scan window. */
  truncated: z.boolean(),
  /**
   * Round-2 lane-review finding 2. `true` when the scan found more *distinct* items
   * (`evidenceForSecurity`'s own `distinctCount`) than fit in this page (`items.length`,
   * capped at 200) — independent of `truncated` above, and the far more common case: a
   * heavily-covered ticker can have hundreds of distinct items well inside the 5,000-row scan
   * window. Every axis below (`stance`, `news`) is filtered out of this same capped page, so
   * this flag is also the honest signal that any axis's own `n` may be a cap-contended
   * subsample, not the true count of relevant evidence on record — see this feature's CONTRACTS
   * report.
   */
  pageTruncated: z.boolean(),
});
export type EvidenceDrawer = z.infer<typeof evidenceDrawer>;

// ── Methodology panel (F09 §4.4) ────────────────────────────────────────────────────────────────

export const methodologyEntry = z.object({
  axis: z.string().min(1),
  methodId: z.string().min(1),
  methodVersion: z.string().min(1),
  title: z.string().min(1),
  source: z.string().min(1),
  window: z.string().min(1),
  thresholds: z.array(z.object({ key: z.string(), value: z.string(), unit: z.string() })),
  limitations: z.array(z.string().min(1)),
  inspectorHref: z.string().nullable(),
});
export type MethodologyEntry = z.infer<typeof methodologyEntry>;

// ── The whole page ───────────────────────────────────────────────────────────────────────────

export const tickerRefusal = z.object({
  refused: z.literal(true),
  reason: z.enum(['not_found', 'ambiguous', 'ineligible']),
  message: z.string().min(1),
});
export type TickerRefusal = z.infer<typeof tickerRefusal>;

export const tickerSnapshotResponse = z.discriminatedUnion('resolved', [
  z.object({ resolved: z.literal(false), refusal: tickerRefusal }),
  z.object({
    resolved: z.literal(true),
    header: tickerHeader,
    attention: attentionAxis,
    stance: z.array(stanceFrame),
    news: newsAxis,
    price: priceAxis,
    divergence: divergencePanel,
    evidence: evidenceDrawer,
    methodology: z.array(methodologyEntry),
    asOf: timestamp,
  }),
]);
export type TickerSnapshotResponse = z.infer<typeof tickerSnapshotResponse>;

// ── Search (F09 §4.5) ────────────────────────────────────────────────────────────────────────

export const searchResultItem = z.object({
  id: z.string().uuid(),
  symbol: z.string().min(1),
  name: z.string().min(1),
  exchange: z.string().min(1),
  assetType: z.enum(['equity', 'etf']),
  eligibilityState: z
    .enum(['ready', 'partial', 'unsupported', 'rights_blocked', 'inactive'])
    .nullable(),
});
export type SearchResultItem = z.infer<typeof searchResultItem>;

export const searchResponse = z.object({
  query: z.string(),
  results: z.array(searchResultItem),
});
export type SearchResponse = z.infer<typeof searchResponse>;
