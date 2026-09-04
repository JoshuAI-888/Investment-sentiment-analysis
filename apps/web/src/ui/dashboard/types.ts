/**
 * The dashboard UI components' own prop shapes.
 *
 * `02-ARCHITECTURE-CONTRACTS.md` §3: "ui/ may import only contracts/" — enforced by
 * `layer-direction`, which does not exempt `import type`. So this file declares the shapes
 * these components need, independently of `src/services/dashboard/contract.ts`, exactly as
 * `InspectableMetricProps` (`src/ui/InspectableMetric.tsx`) already does for the same reason.
 * `page.tsx` (the `app/` layer, allowed to import both `services/` and `ui/`) passes data that
 * is structurally identical, so no conversion step is needed at the call site — only the two
 * declarations must be kept in sync by hand.
 */

export type MetricEligibility = 'ok' | 'insufficient_data' | 'not_applicable' | 'stale';

export type DashboardMetricView = {
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

export type CompositeComponentView = {
  readonly key: 'news_sentiment' | 'price_regime' | 'sector_breadth_score' | 'sampled_retail_stance';
  readonly label: string;
  readonly officialWeight: string;
  /** F07 §4.2, review finding 2: the weight actually applied this cycle — `null` when omitted. */
  readonly renormalizedWeight: string | null;
  readonly participated: boolean;
  readonly metric: DashboardMetricView | null;
};

export type MarketCompositeCardView = {
  readonly composite: DashboardMetricView | null;
  readonly components: readonly CompositeComponentView[];
};

export type SectorTileView = {
  readonly sectorKey: string;
  readonly sectorLabel: string;
  readonly tickerSymbol: string;
  readonly newsSentiment: DashboardMetricView | null;
  readonly priceRegime: DashboardMetricView | null;
};

export type RefreshRefusalView = {
  readonly refused: true;
  readonly reason: 'budget' | 'rate_limited' | 'in_progress';
  readonly message: string;
} | null;

export type DashboardPageState = 'fresh' | 'stale' | 'degraded' | 'insufficient' | 'empty';
