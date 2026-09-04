/**
 * F09 §4.2's attention axis: "mentions, Δmentions, rank, Δrank, chart over available history,
 * `observed_at`". `mentions`/`rank` are raw stored facts (see `TickerHeaderCard`'s doc comment
 * for the same reasoning) rendered plainly; `Δmentions`/`Δrank` are registered methods
 * (`attention.mention_delta`, `attention.rank_change`) and are `InspectableMetric`s.
 *
 * The chart renders F22 §4.4's rule structurally: **a gap is never interpolated across.** Each
 * gap-free run of points is its own `data-chart-segment`, with nothing drawn between segments —
 * there is no charting library in this project's dependencies (`package.json`), so the "chart" is
 * a lightweight, DOM-testable bar list rather than an SVG/canvas rendering. Adding a charting
 * dependency was judged out of this feature's scope; see this feature's RISKS note.
 */
import { AxisMetricCard } from './AxisMetricCard';
import type { AttentionAxisView } from './types';

export type AttentionAxisPanelProps = { readonly attention: AttentionAxisView };

function barHeight(mentions: number, max: number): number {
  if (max <= 0) return 4;
  const ratio = mentions / max;
  return Math.max(4, Math.round(ratio * 48));
}

export function AttentionAxisPanel({ attention }: AttentionAxisPanelProps) {
  const allPoints = attention.chartSegments.flat();
  const max = allPoints.reduce((best, point) => Math.max(best, point.mentions), 0);

  return (
    <section className="rounded border border-neutral-200 p-6" data-axis="attention">
      <h2 className="text-lg font-semibold">Attention</h2>

      {attention.mentions === null ? (
        <p className="mt-2 text-sm text-neutral-700" data-attention-empty="">
          No attention observation is on record for this security yet.
        </p>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-4">
          <div data-attention-mentions={String(attention.mentions)}>
            <p className="text-xs uppercase tracking-wide text-neutral-500">Mentions</p>
            <p className="text-lg font-semibold tabular-nums">{attention.mentions}</p>
          </div>
          <div data-attention-rank={attention.rank === null ? 'null' : String(attention.rank)}>
            <p className="text-xs uppercase tracking-wide text-neutral-500">Rank</p>
            <p className="text-lg font-semibold tabular-nums">{attention.rank ?? 'not on the board'}</p>
          </div>
          {attention.mentionDelta === null ? null : (
            <AxisMetricCard metric={attention.mentionDelta} label="Δ mentions" />
          )}
          {attention.rankChange === null ? null : <AxisMetricCard metric={attention.rankChange} label="Δ rank (24h)" />}
        </div>
      )}

      <div className="mt-4" data-attention-chart="" data-gap-count={String(attention.gapCount)}>
        <p className="text-xs uppercase tracking-wide text-neutral-500">History</p>
        {allPoints.length === 0 ? (
          <p className="mt-1 text-sm text-neutral-700">No history to chart yet.</p>
        ) : (
          <div className="mt-1 flex items-end gap-3">
            {attention.chartSegments.map((segment, segmentIndex) => (
              <div
                key={segmentIndex}
                className="flex items-end gap-0.5 border-l-2 border-dashed border-neutral-200 pl-1 first:border-l-0 first:pl-0"
                data-chart-segment={segmentIndex}
                data-segment-length={segment.length}
              >
                {segment.map((point, pointIndex) => (
                  <div
                    key={pointIndex}
                    className="w-1.5 bg-neutral-400"
                    style={{ height: `${String(barHeight(point.mentions, max))}px` }}
                    data-chart-point={point.observedAt.toISOString()}
                    title={`${point.observedAt.toISOString()}: ${String(point.mentions)} mentions`}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-neutral-500" data-coverage-disclosure="">
          {attention.coverageDisclosure}
        </p>
        {attention.gapCount > 0 ? (
          <p className="text-xs text-amber-700" data-gap-disclosure="">
            {attention.gapCount} recorded coverage {attention.gapCount === 1 ? 'gap' : 'gaps'} — never
            interpolated across; each break above is a real hole in collection, not a quiet period.
          </p>
        ) : null}
      </div>
    </section>
  );
}
