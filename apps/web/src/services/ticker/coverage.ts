/**
 * F22 §4.4 rendered for the first time (`docs/progress/spine.md`: "F09 ... owns the ticker
 * detail surface that renders gaps as holes, and F22's §5 e2e case is executable the moment it
 * exists"). Binds `repositories/coverage.ts`'s stored windows/gaps to `calc/coverage.ts`'s pure
 * arithmetic — this file is the only place those two meet for F09, mirroring how
 * `services/calculations.ts` is the one place `calc/` and `repositories/` meet for artifacts.
 */
import { evaluateWindow, floorDisclosure, gapsOverlapping, segmentAcrossGaps } from '@/calc/coverage';
import type { CoverageAxis, CoverageWindow } from '@/contracts/coverage';
import { coverageWindowFor } from '@/repositories/coverage';
import type { Queryable } from '@/repositories/client';

export type ChartSegmentation<T extends { readonly at: Date }> = {
  readonly segments: readonly (readonly T[])[];
  readonly disclosure: string;
  readonly gapCount: number;
};

/**
 * Splits a series into gap-free segments for one axis and returns the floor disclosure §4.4
 * requires on every historical view. When no `collector_start` row exists yet for this axis
 * (nothing has ever run), the series is rendered as one ungapped segment with a disclosure that
 * says coverage has not started — an honest "no floor recorded", not a fabricated one.
 */
export async function segmentSeriesForAxis<T extends { readonly at: Date }>(
  axis: CoverageAxis,
  points: readonly T[],
  db?: Queryable,
): Promise<ChartSegmentation<T>> {
  const window: CoverageWindow | null = await coverageWindowFor(axis, db);

  if (window === null) {
    // Round-3 lane-review finding 1: callers pass points ordered `observed_at desc` (the
    // repository's own read order); `segmentAcrossGaps` below sorts ascending before charting,
    // but this branch used to pass the array straight through, rendering every history newest-
    // first — a rising trend drawn as a collapsing one.
    const ordered = [...points].sort((a, b) => a.at.getTime() - b.at.getTime());
    return {
      segments: ordered.length === 0 ? [] : [ordered],
      disclosure: `no coverage floor is recorded yet for ${axis} — the collector has not reported a start`,
      gapCount: 0,
    };
  }

  const segments = segmentAcrossGaps(points, window.gaps);

  // Round-4 lane-review finding 6: `window.gaps.length` is every gap `repositories/coverage.ts`
  // has ever recorded for the axis — unbounded history, not the window this chart actually
  // draws. After a year of collection with a dozen recorded outages, a 30-point recent chart
  // would report "12 recorded coverage gaps" beside a line with none of them visible in it: the
  // count and the drawing disagree on the one panel whose purpose is making holes legible.
  // `gapsOverlapping` (already used to decide *whether* a metric window is eligible) is the
  // window-scoped answer — bounded to the actual span of the rendered points, oldest to newest.
  const ordered = [...points].sort((a, b) => a.at.getTime() - b.at.getTime());
  const first = ordered[0];
  const last = ordered.at(-1);
  const gapCount = first === undefined || last === undefined ? 0 : gapsOverlapping(window, first.at, last.at).length;

  return {
    segments,
    disclosure: floorDisclosure(axis, window.startedAt),
    gapCount,
  };
}

export { evaluateWindow };
