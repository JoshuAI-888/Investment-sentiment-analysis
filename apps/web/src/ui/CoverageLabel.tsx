/**
 * `CoverageLabel` — F07 §3, §4.4. Product invariant §6.1: "every aggregate renders source name,
 * `n`, observation window, and `observed_at` freshness." Shared with F08 and F09, which reuse it
 * rather than re-deriving the labelling rule per surface.
 *
 * Deliberately separate from `InspectableMetric` (which renders the *value*): a value and its
 * coverage are two different facts, and F09's evidence drawer wants to show coverage beside
 * things that are not single `InspectableMetric` values (an evidence list's sampling frame,
 * for one). Composing the two is the call site's job, not this component's.
 */

export type CoverageLabelProps = {
  readonly source: string | null;
  readonly n: number | null;
  readonly window: string | null;
};

export function CoverageLabel({ source, n, window }: CoverageLabelProps) {
  return (
    <p className="text-xs text-neutral-500" data-coverage-label="">
      <span data-coverage-source="">{source ?? 'source not recorded'}</span>
      {' · '}
      <span data-coverage-n="">{n === null ? 'n not recorded' : `n=${n}`}</span>
      {' · '}
      <span data-coverage-window="">{window ?? 'window not recorded'}</span>
    </p>
  );
}
