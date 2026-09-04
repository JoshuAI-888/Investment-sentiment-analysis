/**
 * The "deterministic analysis" stage (F11 §4.2: 1 s budget, "hard failure — this is local
 * computation"). Gathers the numbers a research run is allowed to cite — F06's already-computed
 * metrics — without re-deriving any of them (D-13: "the LLM never computes a stance number").
 *
 * **Reuses `services/ticker/snapshot.ts#assembleTickerSnapshot` (F09), not a second calc path.**
 * F09's function already binds every registered F05/F06 method to a security, computes and
 * persists a fresh `CalculationArtifact` per axis, and projects each to an `AxisMetric` carrying
 * exactly what a citation needs: `metricId`, `calculationId`, `display` (rounded string a claim
 * can string-match against), `eligibility`, `n`, `observedAt`. Building a second, F11-only
 * metrics path would duplicate F09's binding of the calc registry — the thing this build brief
 * explicitly warns against ("your fetch stage should call into F10's evidence pack builder, not
 * reimplement evidence assembly"; the identical reasoning applies to F06's calc methods).
 *
 * **Accepted cost, inherited from F09, not introduced here**: `assembleTickerSnapshot` computes
 * and persists fresh artifacts on every call rather than reading a cached one (F09's own
 * docstring: "a popular ticker viewed repeatedly writes one `calculation_snapshot` row per axis
 * per view"). A research run now does the same. Flagged in this feature's RISKS, not hidden.
 */
import type { TickerSnapshotResponse, AxisMetric } from '@/services/ticker/contract';
import { assembleTickerSnapshot } from '@/services/ticker/snapshot';
import type { Queryable } from '@/repositories/client';

/** One citable number. Only `eligibility === 'ok'` metrics are citable — an abstained metric has no `display` value to cite. */
export type MetricFact = {
  readonly metricId: string;
  readonly calculationId: string;
  readonly label: string;
  /** The exact, rounded string a claim's numeric token must string-match (deterministic check 1). */
  readonly display: string;
  readonly unit: string;
  readonly n: number | null;
  readonly window: string | null;
  readonly observedAt: Date | null;
};

function factsFrom(metric: AxisMetric | null): readonly MetricFact[] {
  if (metric === null || metric.eligibility !== 'ok' || metric.display === null) return [];
  return [
    {
      metricId: metric.metricId,
      calculationId: metric.calculationId,
      label: metric.label,
      display: metric.display,
      unit: metric.unit,
      n: metric.n,
      window: metric.window,
      observedAt: metric.observedAt,
    },
  ];
}

/** Flattens every axis's citable metrics off an already-assembled ticker snapshot into one flat list. */
export function flattenMetrics(snapshot: TickerSnapshotResponse): readonly MetricFact[] {
  if (!snapshot.resolved) return [];
  const out: MetricFact[] = [];
  out.push(...factsFrom(snapshot.attention.mentionDelta));
  out.push(...factsFrom(snapshot.attention.rankChange));
  for (const frame of snapshot.stance) out.push(...factsFrom(frame.metric));
  out.push(...factsFrom(snapshot.news.metric));
  out.push(...factsFrom(snapshot.price.volatility20));
  out.push(...factsFrom(snapshot.price.regime));
  out.push(...factsFrom(snapshot.price.rsi14));
  out.push(...factsFrom(snapshot.price.movingAverage20));
  out.push(...factsFrom(snapshot.price.movingAverage50));
  if (snapshot.divergence.available) {
    out.push({
      metricId: snapshot.divergence.metricId,
      calculationId: snapshot.divergence.calculationId,
      label: 'Attention/stance/price divergence state',
      display: snapshot.divergence.state,
      unit: '',
      n: null,
      window: null,
      observedAt: snapshot.divergence.observedAt,
    });
  }
  return out;
}

export type MetricsGatherer = (input: {
  readonly symbol: string;
  readonly asOf: Date;
  readonly db?: Queryable;
}) => Promise<readonly MetricFact[]>;

/** The real implementation — calls F09's `assembleTickerSnapshot` and flattens its metrics. */
export const realMetricsGatherer: MetricsGatherer = async (input) => {
  const snapshot = await assembleTickerSnapshot(input.symbol, { asOf: input.asOf, db: input.db });
  return flattenMetrics(snapshot);
};
