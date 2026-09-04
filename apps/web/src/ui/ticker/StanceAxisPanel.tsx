/**
 * F09 §4.2 / D-14: "there is no longer one sampled-evidence disclosure but **three** ... They
 * have different selection mechanics, so one blended sentence would be false; each frame renders
 * its own." Three independent cards — never merged into one stance number — one per social axis
 * (source §6.1's product invariant: the three sampling frames are never interchangeable).
 */
import { AxisMetricCard } from './AxisMetricCard';
import type { StanceFrameView } from './types';

export type StanceAxisPanelProps = { readonly frames: readonly StanceFrameView[] };

export function StanceAxisPanel({ frames }: StanceAxisPanelProps) {
  return (
    <section className="rounded border border-neutral-200 p-6" data-axis="sampled-stance">
      <h2 className="text-lg font-semibold">Sampled stance</h2>
      <p className="mt-1 text-sm text-neutral-700">
        Three independently sampled frames. They are never combined into one number.
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {frames.map((frame) => (
          <div
            key={frame.axis}
            className="rounded border border-neutral-200 p-4"
            data-stance-frame={frame.axis}
          >
            <h3 className="text-sm font-semibold">{frame.label}</h3>

            {frame.metric === null ? (
              <p className="mt-2 text-sm text-neutral-700" data-stance-not-computed="">
                Not yet computed for this render.
              </p>
            ) : (
              <div className="mt-2">
                <AxisMetricCard metric={frame.metric} />
              </div>
            )}

            <p className="mt-2 text-xs text-neutral-500" data-stance-sample-adequacy={frame.sampleAdequacy ?? 'null'}>
              sample_adequacy: {frame.sampleAdequacy ?? 'n/a'}
            </p>
            <p className="text-xs text-neutral-500" data-stance-counts="">
              retrieved {frame.retrievedCount}, used {frame.usedCount} · window: {frame.window}
            </p>

            {/* F-03 / D-14: the selection-bias disclosure, one sentence per frame. */}
            <p className="mt-2 text-xs text-neutral-700" data-selection-bias-note="">
              {frame.disclosure}
            </p>

            {/*
             * Round-3 lane-review finding 6: `selectionBiasNotes` — the method registry's own
             * `limitations[]` for this frame's method (contract.ts's own doc: "reproduced, not
             * paraphrased") — was computed, contracted and asserted in tests, but no component
             * ever rendered it; `data-selection-bias-note` above renders a different field
             * (`disclosure`, the D-14 per-frame sampling-mechanics sentence). Distinct data, so a
             * distinct element.
             */}
            {frame.selectionBiasNotes.length === 0 ? null : (
              <ul className="mt-2 space-y-1 text-xs text-neutral-500" data-method-limitations="">
                {frame.selectionBiasNotes.map((note) => (
                  <li key={note} data-method-limitation="">
                    {note}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
