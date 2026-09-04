/**
 * F09 §4.4 — the methodology panel. "Per axis: source, window, method, method version,
 * thresholds, and a link to the Inspector. The stance entry reproduces the registry's
 * `limitations[]` — the selection-bias disclosure appears on the page a user actually reads, not
 * only in the Inspector."
 */
import type { MethodologyEntryView } from './types';

export type MethodologyPanelProps = { readonly entries: readonly MethodologyEntryView[] };

export function MethodologyPanel({ entries }: MethodologyPanelProps) {
  return (
    <section className="rounded border border-neutral-200 p-6" data-methodology-panel="">
      <h2 className="text-lg font-semibold">Methodology</h2>

      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-700">Nothing has been computed for this render yet.</p>
      ) : (
        <dl className="mt-2 space-y-4">
          {entries.map((entry) => (
            <div key={`${entry.axis}:${entry.methodId}`} className="border-t border-neutral-200 pt-3 first:border-t-0" data-methodology-entry={entry.methodId}>
              <dt className="text-sm font-semibold">
                {entry.title} <span className="font-normal text-neutral-500">v{entry.methodVersion}</span>
              </dt>
              <dd className="text-xs text-neutral-500">
                axis: {entry.axis} · source: {entry.source} · window: {entry.window}
              </dd>
              {entry.thresholds.length === 0 ? null : (
                <dd className="mt-1 text-xs text-neutral-500">
                  thresholds: {entry.thresholds.map((t) => `${t.key}=${t.value}${t.unit === '' ? '' : t.unit}`).join(', ')}
                </dd>
              )}
              {entry.limitations.length === 0 ? null : (
                <dd className="mt-1 space-y-1" data-methodology-limitations="">
                  {entry.limitations.map((limitation, index) => (
                    <p key={index} className="text-xs text-neutral-700">
                      {limitation}
                    </p>
                  ))}
                </dd>
              )}
              {entry.inspectorHref === null ? null : (
                <dd className="mt-1">
                  <a className="text-xs underline decoration-dotted" href={entry.inspectorHref}>
                    How this was calculated
                  </a>
                </dd>
              )}
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
