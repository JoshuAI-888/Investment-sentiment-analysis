/**
 * `AggregateMetric` — `InspectableMetric` plus `CoverageLabel` and `FreshnessBadge` together.
 *
 * F07 §4.4, product invariant §6.1: *"Every aggregate on this page renders: source name, `n`,
 * observation window, and `observed_at` freshness. This is not decoration ... it is a DoD
 * item."* Every metric this feature renders is an aggregate in that sense, so this is the one
 * place that composition happens rather than three components assembled slightly differently
 * at each call site.
 */
import { CoverageLabel } from '../CoverageLabel';
import { FreshnessBadge } from '../FreshnessBadge';
import { InspectableMetric } from '../InspectableMetric';
import type { DashboardMetricView } from './types';

export type AggregateMetricProps = { readonly metric: DashboardMetricView; readonly label?: string };

export function AggregateMetric({ metric, label }: AggregateMetricProps) {
  return (
    <div data-aggregate-metric={metric.metricId}>
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
