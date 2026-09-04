/**
 * `InspectableMetric` — F05 §4.8.
 *
 * > The single component every displayed deterministic value uses. It renders the value, the
 * > display rounding, and the link. **A number rendered without it fails `check:calc-coverage`.**
 *
 * Product invariant §6.2 is that every displayed deterministic value carries a `calculationId`
 * resolving to an immutable artifact. A component is how that becomes structural rather than
 * aspirational: there is no prop combination that renders a number without one, because
 * `calculationId` and `metricId` are required and the link is not optional.
 *
 * **Abstention is rendered, not hidden** (§6.3). `display: null` means the method declined to
 * produce a number, and the component says so in words and still links to the artifact — the
 * reason a value is absent is itself inspectable.
 *
 * The layering is deliberate: `ui/` may import only `contracts/`
 * (`02-ARCHITECTURE-CONTRACTS.md` §3), so this file declares the shape it needs and receives it
 * as props. A component that reached a repository could not be tested or reused.
 */

import { inspectorHref } from './inspector-links';

export type MetricEligibility = 'ok' | 'insufficient_data' | 'not_applicable' | 'stale';

export type InspectableMetricProps = {
  /** The registered method that produced the value, e.g. `attention.rank_change`. */
  readonly metricId: string;
  /** Product invariant §6.2. Required, so a number with nothing to resolve to cannot render. */
  readonly calculationId: string;
  readonly label: string;
  /** The rounded display value, or `null` where the method abstained. */
  readonly display: string | null;
  readonly unit: string;
  /** The registry id of the rule that produced `display` — never an inline number of places. */
  readonly roundingRule: string;
  readonly eligibility: MetricEligibility;
  /** Why there is no number. Required reading when `display` is null (§6.3). */
  readonly reason?: string | null;
  /** F-07: a point inside a series artifact is addressed `{calculationId, pointIndex}`. */
  readonly pointIndex?: number;
  /** Rendered beside a stale value. Never used to suppress it. */
  readonly asOf?: string;
};

const ELIGIBILITY_NOTE: Readonly<Record<MetricEligibility, string | null>> = {
  ok: null,
  stale: 'Older than this metric’s refresh window',
  insufficient_data: 'Not enough observations to state a value',
  not_applicable: 'This metric does not apply here',
};

export function InspectableMetric(props: InspectableMetricProps) {
  const { display, eligibility, reason } = props;
  const note = ELIGIBILITY_NOTE[eligibility];

  return (
    <span
      className="inline-flex flex-col gap-0.5"
      data-inspectable-metric=""
      data-metric={props.metricId}
      data-calculation-id={props.calculationId}
      data-eligibility={eligibility}
      data-rounding-rule={props.roundingRule}
      {...(props.pointIndex === undefined ? {} : { 'data-point-index': String(props.pointIndex) })}
    >
      <span className="text-xs uppercase tracking-wide text-neutral-500">{props.label}</span>

      {display === null ? (
        <span className="text-sm text-neutral-700" data-abstained="">
          {/* Never a zero, never a dash. A dash and a measured zero look identical. */}
          No value — {reason ?? note ?? 'the method declined to produce one'}
        </span>
      ) : (
        <span className="text-lg font-semibold tabular-nums">
          {display}
          {props.unit === '' ? null : <span className="ml-1 text-sm font-normal">{props.unit}</span>}
        </span>
      )}

      {display !== null && note !== null ? (
        <span className="text-xs text-amber-700">{note}</span>
      ) : null}

      {props.asOf === undefined ? null : (
        <span className="text-xs text-neutral-500">as of {props.asOf}</span>
      )}

      <a
        className="text-xs underline decoration-dotted"
        href={inspectorHref(props.calculationId, props.pointIndex)}
      >
        How this was calculated
      </a>
    </span>
  );
}
