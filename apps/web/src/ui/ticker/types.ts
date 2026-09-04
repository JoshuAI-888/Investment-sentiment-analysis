/**
 * The ticker UI components' own prop shapes — `02-ARCHITECTURE-CONTRACTS.md` §3: "ui/ may import
 * only contracts/", enforced by `layer-direction`. Declared independently of
 * `src/services/ticker/contract.ts`, exactly as `ui/dashboard/types.ts` already does for F07;
 * `page.tsx` (the `app/` layer, allowed to import both) passes data that is structurally
 * identical, so no conversion step is needed at the call site.
 *
 * `DivergencePanelView.disclosure` (below) carries product invariant §6.4's line verbatim —
 * rendered dynamically from `market.divergence_state`'s own artifact output
 * (`services/ticker/snapshot.ts`), never hardcoded in a component.
 *
 * The exact text, on one line so `check:copy`'s static scan can find it verbatim:
 * "This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast."
 */

export type MetricEligibility = 'ok' | 'insufficient_data' | 'not_applicable' | 'stale';

export type AxisMetricView = {
  readonly calculationId: string;
  readonly metricId: string;
  readonly label: string;
  readonly display: string | null;
  readonly unit: string;
  readonly roundingRule: string;
  readonly eligibility: MetricEligibility;
  readonly reason: string | null;
  readonly asOf: Date | null;
  readonly source: string | null;
  readonly n: number | null;
  readonly window: string | null;
  readonly observedAt: Date | null;
  readonly stale: boolean;
};

export type TickerHeaderView = {
  readonly securityId: string;
  readonly symbol: string;
  readonly name: string;
  readonly exchange: string;
  readonly assetType: 'equity' | 'etf';
  readonly sector: string | null;
  readonly price: string | null;
  readonly changePercent: string | null;
  readonly session: string | null;
  readonly provider: string | null;
  readonly observedAt: Date | null;
  readonly filingsHref: string | null;
  readonly insiderTransactionsHref: string | null;
};

export type AttentionChartPointView = {
  readonly observedAt: Date;
  readonly mentions: number;
  readonly rank: number | null;
};

export type AttentionAxisView = {
  readonly mentions: number | null;
  readonly rank: number | null;
  readonly observedAt: Date | null;
  readonly mentionDelta: AxisMetricView | null;
  readonly rankChange: AxisMetricView | null;
  readonly chartSegments: readonly (readonly AttentionChartPointView[])[];
  readonly coverageDisclosure: string;
  readonly gapCount: number;
};

export type StanceFrameView = {
  readonly axis: 'reddit' | 'x' | 'substack';
  readonly label: string;
  readonly metric: AxisMetricView | null;
  readonly sampleAdequacy: string | null;
  readonly retrievedCount: number;
  readonly usedCount: number;
  readonly window: string;
  readonly disclosure: string;
  readonly selectionBiasNotes: readonly string[];
};

export type NewsAxisView = {
  readonly metric: AxisMetricView | null;
  readonly articleCount: number;
  readonly window: string;
};

export type PriceReturnView = {
  readonly horizonCalendarDays: 7 | 30 | 90 | 180;
  readonly totalReturn: string | null;
  readonly asOfDate: string;
  readonly baselinePriceDate: string;
  readonly qualityStatus: string;
};

export type PriceAxisView = {
  readonly returns: readonly PriceReturnView[];
  readonly horizonDisclosure: string;
  readonly volatility20: AxisMetricView | null;
  readonly regime: AxisMetricView | null;
  readonly rsi14: AxisMetricView | null;
  readonly movingAverage20: AxisMetricView | null;
  readonly movingAverage50: AxisMetricView | null;
};

export type DivergencePanelView =
  | {
      readonly available: true;
      readonly metricId: 'market.divergence_state';
      readonly calculationId: string;
      readonly state: string;
      readonly interpretation: string;
      readonly disclosure: string;
      readonly socialAxisDisclosure: string;
      readonly observedAt: Date | null;
      readonly stale: boolean;
    }
  | { readonly available: false; readonly reason: string };

export type EvidenceItemView = {
  readonly id: string;
  readonly dedupeKey: string;
  readonly sourceKind: string;
  readonly provider: string;
  readonly publisher: string | null;
  readonly title: string;
  readonly url: string | null;
  readonly publishedAt: Date | null;
  readonly retrievedAt: Date;
  readonly snippet: string | null;
  readonly relevance: string | null;
  readonly availability: 'available' | 'unreachable' | 'removed' | 'paywalled' | 'unchecked';
  readonly lastCheckedAt: Date | null;
  readonly unreachableNote: string | null;
};

export type EvidenceDrawerView = {
  readonly items: readonly EvidenceItemView[];
  readonly retrievedCount: number;
  readonly usedCount: number;
  readonly truncated: boolean;
  readonly pageTruncated: boolean;
};

export type MethodologyEntryView = {
  readonly axis: string;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly title: string;
  readonly source: string;
  readonly window: string;
  readonly thresholds: readonly { readonly key: string; readonly value: string; readonly unit: string }[];
  readonly limitations: readonly string[];
  readonly inspectorHref: string | null;
};

export type TickerRefusalView = {
  readonly refused: true;
  readonly reason: 'not_found' | 'ambiguous' | 'ineligible';
  readonly message: string;
};
