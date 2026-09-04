/**
 * `AxisMetricCard` — `InspectableMetric` plus `CoverageLabel` and `FreshnessBadge` together, F09's
 * analogue of F07's `AggregateMetric` (same composition, kept as its own component per
 * `ui/dashboard/types.ts`'s precedent that the two features' shapes evolve independently).
 * Product invariant §6.1: every aggregate renders source, `n`, window and freshness.
 */
import { CoverageLabel } from '../CoverageLabel';
import { FreshnessBadge } from '../FreshnessBadge';
import { InspectableMetric } from '../InspectableMetric';
import type { AxisMetricView } from './types';

export type AxisMetricCardProps = { readonly metric: AxisMetricView; readonly label?: string };

export function AxisMetricCard({ metric, label }: AxisMetricCardProps) {
  return (
    <div data-axis-metric={metric.metricId}>
      <InspectableMetric
        metricId={metric.metricId}
        calculationId={metric.calculationId}
        label={label ?? metric.label}
        display={metric.display}
        unit={metric.unit}
        roundingRule={metric.roundingRule}
        eligibility={metric.eligibility}
        reason={metric.reason}
      />
      <CoverageLabel source={metric.source} n={metric.n} window={metric.window} />
      <FreshnessBadge observedAt={metric.observedAt} stale={metric.stale} />
    </div>
  );
}
