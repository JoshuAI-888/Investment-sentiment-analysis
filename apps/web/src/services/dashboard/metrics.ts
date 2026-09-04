/**
 * Pure projections from a `CalculationArtifact` to what the dashboard renders — F07 §4.4's
 * labelling invariant (source, `n`, window, freshness) and the shape `InspectableMetric`
 * (`src/ui/InspectableMetric.tsx`) needs. Kept import-free of anything with I/O so it is
 * unit-testable with a hand-built artifact and no database (F07 §5's "label formatting;
 * freshness thresholds" unit cases).
 */
import type { CalculationArtifact } from '@/calc/artifact';
import { applyRounding, D } from '@/calc/decimal';
import type { DashboardMetric } from './contract';

type LabelConfig = { readonly countPrefix: string | null; readonly window: string; readonly source: string };

const LABEL_CONFIG: Readonly<Record<string, LabelConfig>> = {
  'price.regime': { countPrefix: 'close_', window: '21 trading sessions', source: 'market' },
  'price.volatility_20': { countPrefix: 'close_', window: '21 trading sessions', source: 'market' },
  'news.sentiment': { countPrefix: 'entity_sentiment_', window: 'articles retrieved this refresh', source: 'marketaux' },
  'market.sector_breadth': { countPrefix: null, window: 'this refresh cycle', source: 'internal — aggregated across sector proxies' },
  'market.composite': { countPrefix: null, window: 'this refresh cycle', source: 'internal — weighted blend of component methods' },
};

function countN(artifact: CalculationArtifact, config: LabelConfig): number {
  if (config.countPrefix !== null) {
    return artifact.inputs.filter((input) => input.key.startsWith(config.countPrefix as string)).length;
  }
  if (artifact.methodId === 'market.sector_breadth') {
    const withData = artifact.inputs.find((input) => input.key === 'sector_etfs_with_data');
    return withData === undefined ? 0 : Math.trunc(Number(withData.value));
  }
  // market.composite: one declared input per participating component.
  return artifact.inputs.length;
}

/** The freshest `observedAt` among an artifact's inputs — what "freshness" is measured against. */
export function freshestObservedAt(artifact: CalculationArtifact): string | null {
  const observed = artifact.inputs
    .map((input) => input.provenance.observedAt)
    .filter((value): value is string => value !== null)
    .sort();
  return observed.at(-1) ?? null;
}

export function toDashboardMetric(artifact: CalculationArtifact, label: string): DashboardMetric {
  const config = LABEL_CONFIG[artifact.methodId];

  return {
    calculationId: artifact.calculationId,
    metricId: artifact.methodId,
    label,
    display: artifact.result?.display ?? null,
    unit: artifact.result?.unit ?? '',
    roundingRule: artifact.result?.roundingRule ?? '',
    eligibility: artifact.eligibility,
    reason: artifact.abstention?.message ?? null,
    asOf: new Date(artifact.asOf),
    source: config?.source ?? null,
    n: config === undefined ? null : countN(artifact, config),
    window: config?.window ?? null,
    observedAt: freshestObservedAt(artifact) === null ? null : new Date(freshestObservedAt(artifact) as string),
    stale: artifact.eligibility === 'stale',
  };
}

/**
 * F07 review finding 2. F07 §4.2 requires the *renormalized* weight actually applied to a
 * `market.composite` component this cycle — not the fixed official weight, which is only what
 * gets applied when all four components participate. `calc/methods/market-composite.ts` records
 * exactly this in each participating component's own `contribution_<key>` step, as the
 * `official_weight` / `participating_weight_sum` operands its `evaluate` divides — reading them
 * back here is a projection off that trace, not a second computation. `null` when the component
 * did not participate this cycle (no step was recorded for it) or the composite was never
 * computed at all.
 */
export function renormalizedComponentWeight(compositeArtifact: CalculationArtifact, componentKey: string): string | null {
  const step = compositeArtifact.steps.find((candidate) => candidate.key === `contribution_${componentKey}`);
  if (step === undefined) return null;

  const officialWeightRaw = step.operands['official_weight'];
  const participatingWeightSumRaw = step.operands['participating_weight_sum'];
  if (officialWeightRaw === undefined || participatingWeightSumRaw === undefined) return null;

  const officialWeight = new D(officialWeightRaw);
  const participatingWeightSum = new D(participatingWeightSumRaw);
  if (participatingWeightSum.isZero()) return null;

  return applyRounding(officialWeight.div(participatingWeightSum), 'ratio_6dp_half_even');
}

/**
 * F07 §4.5's page-level state. `empty` beats everything else — a dashboard that has never
 * computed anything is not "insufficient", it has not started. `degraded` beats `stale`/
 * `insufficient` because it names an infrastructure cause the other two do not. Otherwise the
 * worst metric present decides: any `stale` metric marks the page stale, any `insufficient_data`
 * (with nothing worse) marks it insufficient, and only all-`ok` is `fresh`.
 */
export function pageState(args: {
  readonly hasEverComputed: boolean;
  readonly degradedProviders: readonly string[];
  readonly metrics: readonly Pick<DashboardMetric, 'eligibility'>[];
}): 'fresh' | 'stale' | 'degraded' | 'insufficient' | 'empty' {
  if (!args.hasEverComputed) return 'empty';
  if (args.degradedProviders.length > 0) return 'degraded';
  if (args.metrics.some((m) => m.eligibility === 'stale')) return 'stale';
  if (args.metrics.some((m) => m.eligibility === 'insufficient_data' || m.eligibility === 'not_applicable')) {
    return 'insufficient';
  }
  return 'fresh';
}
