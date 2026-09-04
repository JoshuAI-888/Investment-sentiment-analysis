/**
 * `EmptyState` — F07 §4.5's "Empty (cold start)" row: *"explains that history is accruing and
 * names the depth so far."* Distinct from an `insufficient_data` metric, which has already been
 * computed and abstained — this is the state before anything has been computed at all, so
 * there is no `calculationId` to open an Inspector on (F-06's cold-start risk: "a brand-new
 * deployment looks intentional, not broken").
 */

export type EmptyStateProps = { readonly computedDepth: number };

export function EmptyState({ computedDepth }: EmptyStateProps) {
  return (
    <div className="rounded border border-neutral-200 bg-neutral-50 p-6 text-sm text-neutral-700" data-empty-state="">
      <p className="font-semibold">History is accruing.</p>
      <p className="mt-1">
        {computedDepth === 0
          ? 'Nothing has been computed for this dashboard yet.'
          : `${String(computedDepth)} computation(s) recorded so far.`}{' '}
        Use refresh to compute the first reading from what has been collected.
      </p>
    </div>
  );
}
