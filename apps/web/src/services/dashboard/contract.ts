/**
 * F07 §3 — "Produces: the dashboard response contract."
 *
 * **Not placed in `src/contracts/`.** That directory is SPINE-owned
 * (`docs/progress/surface.md`, `CLAUDE.md`) and this lane may consume it but not add to it —
 * see this feature's build report under `CONTRACTS` for the follow-up SPINE should make (moving
 * this schema, or one shaped like it, into `src/contracts/dashboard.ts` once it is convenient
 * to coordinate). Until then this is the single source of truth for the shape `GET /api/dashboard`
 * returns, `assembleDashboard` builds and `tests/contract/dashboard.test.ts` checks against.
 *
 * Reuses `decimalString`/`timestamp` from `@/contracts/primitives` — importing an existing
 * export is normal cross-layer consumption; only adding to that directory is out of bounds.
 */
import { z } from 'zod';
import { decimalString, timestamp } from '@/contracts/primitives';

export const metricEligibility = z.enum(['ok', 'insufficient_data', 'not_applicable', 'stale']);
export type MetricEligibility = z.infer<typeof metricEligibility>;

/**
 * What `InspectableMetric` (`src/ui/InspectableMetric.tsx`) needs to render one number, plus
 * the labelling product invariant §6.1 requires on every aggregate: `source`, `n`, `window` and
 * `observedAt` freshness (F07 §4.4). A metric that was never computed (cold start) is `null`
 * rather than represented with a fabricated `calculationId` — F07 §4.5's "Empty" state, not an
 * `insufficient_data` one.
 */
export const dashboardMetric = z.object({
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
  /** F07 §4.5 "Stale": computed on time, but its inputs are older than the method's freshness window. */
  stale: z.boolean(),
});
export type DashboardMetric = z.infer<typeof dashboardMetric>;

/** One of `market.composite`'s (up to) four weighted components, present or omitted this cycle. */
export const compositeComponent = z.object({
  key: z.enum(['news_sentiment', 'price_regime', 'sector_breadth_score', 'sampled_retail_stance']),
  label: z.string().min(1),
  officialWeight: decimalString,
  /**
   * F07 §4.2, review finding 2: the weight actually applied this cycle, renormalized over
   * whichever components participated — read off `market.composite`'s own step trace
   * (`renormalizedComponentWeight`, `metrics.ts`), never derived a second time here. `null` when
   * this component did not participate (nothing was applied) or the composite was never
   * computed at all.
   */
  renormalizedWeight: decimalString.nullable(),
  participated: z.boolean(),
  /** `null` when omitted — F07 §4.2: omitted, never supplied as a fabricated zero. */
  metric: dashboardMetric.nullable(),
});
export type CompositeComponent = z.infer<typeof compositeComponent>;

export const marketCompositeView = z.object({
  /** `null` only in the page-level "empty" cold-start case — see `dashboardResponse.state`. */
  composite: dashboardMetric.nullable(),
  components: z.array(compositeComponent),
});
export type MarketCompositeView = z.infer<typeof marketCompositeView>;

export const sectorTile = z.object({
  sectorKey: z.string().min(1),
  sectorLabel: z.string().min(1),
  tickerSymbol: z.string().min(1),
  newsSentiment: dashboardMetric.nullable(),
  priceRegime: dashboardMetric.nullable(),
});
export type SectorTile = z.infer<typeof sectorTile>;

/**
 * F07 §4.5. `degraded` names what is missing (`degradedProviders`); `empty` is cold start —
 * "history is accruing" plus the depth so far, never a page that merely looks broken.
 */
export const dashboardState = z.enum(['fresh', 'stale', 'degraded', 'insufficient', 'empty']);
export type DashboardState = z.infer<typeof dashboardState>;

export const refreshRefusal = z.object({
  refused: z.literal(true),
  reason: z.enum(['budget', 'rate_limited', 'in_progress']),
  message: z.string().min(1),
});
export type RefreshRefusal = z.infer<typeof refreshRefusal>;

export const dashboardResponse = z.object({
  state: dashboardState,
  computedDepth: z.number().int().nonnegative(),
  marketComposite: marketCompositeView,
  sectorTiles: z.array(sectorTile),
  degradedProviders: z.array(z.string()),
  lastRefusal: refreshRefusal.nullable(),
  providerMode: z.enum(['fixture', 'live']),
});
export type DashboardResponse = z.infer<typeof dashboardResponse>;

export const refreshResponse = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), computedAt: timestamp }),
  z.object({
    status: z.literal('refused'),
    reason: z.enum(['budget', 'rate_limited', 'in_progress']),
    message: z.string().min(1),
  }),
  /** An infrastructure prerequisite (an active `config_version` row) is missing — not a refusal. */
  z.object({ status: z.literal('error'), message: z.string().min(1) }),
]);
export type RefreshResponse = z.infer<typeof refreshResponse>;
