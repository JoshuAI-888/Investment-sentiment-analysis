/**
 * `FreshnessBadge` — F07 §3, §4.5's "Stale" row: *"value plus an explicit 'as of {time},
 * refresh failed' marker."* Shared with F08/F09.
 *
 * `stale` is the artifact's own `eligibility === 'stale'` — set by `computeArtifact`
 * (`src/services/calculations.ts`) when the freshest input is older than the method's
 * registered `stalenessMinutes`, never inferred here from a raw clock comparison. Two
 * independent renderings looking at the same clock would eventually disagree at the boundary;
 * one artifact-carried fact cannot.
 */

function formatObservedAt(observedAt: Date | null): string {
  if (observedAt === null) return 'unknown time';
  return observedAt.toISOString();
}

export type FreshnessBadgeProps = {
  readonly observedAt: Date | null;
  readonly stale: boolean;
};

export function FreshnessBadge({ observedAt, stale }: FreshnessBadgeProps) {
  if (stale) {
    return (
      <p className="text-xs text-amber-700" data-freshness="stale">
        As of {formatObservedAt(observedAt)}, refresh failed — this value is older than its refresh window.
      </p>
    );
  }

  return (
    <p className="text-xs text-neutral-500" data-freshness="fresh">
      Observed {formatObservedAt(observedAt)}
    </p>
  );
}
