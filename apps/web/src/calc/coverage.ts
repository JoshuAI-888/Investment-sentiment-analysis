/**
 * Coverage arithmetic (F22 §4.4). Pure — no I/O, no decimals, no floats.
 *
 * The rules here are what stop a historical view being quietly dishonest. A window reaching
 * before an axis started, or across a hole in it, is not a smaller sample: it is a sample whose
 * frame cannot be stated. Product invariant §6.3 says the answer is a stated abstention, not a
 * number computed over what happens to be there.
 */
import type {
  CoverageAxis,
  CoverageGap,
  CoverageWindow,
  WindowEligibility,
  WindowVerdict,
} from '../contracts/coverage';

/** Two intervals overlap when each starts before the other ends. Touching endpoints do not. */
export function overlaps(
  a: { from: Date; to: Date },
  b: { from: Date; to: Date },
): boolean {
  return a.from < b.to && b.from < a.to;
}

export function gapsOverlapping(
  window: CoverageWindow,
  from: Date,
  to: Date,
): CoverageGap[] {
  return window.gaps.filter((gap) => overlaps({ from, to }, { from: gap.from, to: gap.to }));
}

/** Verbatim per §4.4: every historical view carries its coverage floor. */
export function floorDisclosure(axis: CoverageAxis, startedAt: Date): string {
  return `coverage begins ${startedAt.toISOString().slice(0, 10)} for ${axis}`;
}

/**
 * Whether a metric may be computed over a requested window.
 *
 * Ordering matters. `no_coverage` outranks `below_floor`, which outranks `overlaps_gap`: an axis
 * that never started is a different statement from one that started later than you asked, and
 * both are different from one that has a hole in it. Collapsing them into a single
 * "insufficient_data" would be true but would tell a reader nothing about what to do next.
 */
export function evaluateWindow(
  window: CoverageWindow,
  from: Date,
  to: Date,
): WindowVerdict {
  const overlapping = gapsOverlapping(window, from, to);

  const base = {
    axis: window.axis,
    requestedFrom: from,
    requestedTo: to,
    overlappingGaps: overlapping,
    floor: window.startedAt,
  };

  if (window.lastObservedAt === null) {
    return {
      ...base,
      eligibility: 'no_coverage' satisfies WindowEligibility,
      disclosure: `no coverage for ${window.axis} — nothing has been collected on this axis`,
    };
  }

  if (from < window.startedAt) {
    return {
      ...base,
      eligibility: 'below_floor',
      disclosure: `${floorDisclosure(window.axis, window.startedAt)}; the requested window starts before it and cannot be computed`,
    };
  }

  if (overlapping.length > 0) {
    const reasons = [...new Set(overlapping.map((gap) => gap.reason))].join(', ');
    return {
      ...base,
      eligibility: 'overlaps_gap',
      disclosure: `${floorDisclosure(window.axis, window.startedAt)}; the requested window crosses ${overlapping.length} recorded gap(s) (${reasons}) and is not computed across them`,
    };
  }

  return {
    ...base,
    eligibility: 'eligible',
    disclosure: floorDisclosure(window.axis, window.startedAt),
  };
}

/**
 * The per-axis floors a cross-platform view must render (§4.4).
 *
 * Returning the earliest floor across axes is the specific dishonesty this prevents: X is
 * trigger-sampled and D-32 funds it at zero to begin with, so it starts materially later than
 * Reddit. A comparison drawn from Reddit's floor with X's series inside it looks like a period
 * where X was quiet, when it is a period where X was not being collected.
 */
export function perAxisFloors(
  windows: readonly CoverageWindow[],
): { axis: CoverageAxis; startedAt: Date; disclosure: string }[] {
  return windows.map((window) => ({
    axis: window.axis,
    startedAt: window.startedAt,
    disclosure: floorDisclosure(window.axis, window.startedAt),
  }));
}

/** True when the axes do not share a floor — which is when the view must show all of them. */
export function floorsDiverge(windows: readonly CoverageWindow[]): boolean {
  const distinct = new Set(windows.map((window) => window.startedAt.getTime()));
  return distinct.size > 1;
}

/**
 * Splits a series at every gap it crosses, so a renderer draws separate segments.
 *
 * §4.4: *"A series is never interpolated across a gap."* Returning segments rather than a
 * `hasGap` flag is deliberate — a flag leaves the decision to the renderer, and the renderer's
 * default is to connect the points.
 */
export function segmentAcrossGaps<T extends { at: Date }>(
  points: readonly T[],
  gaps: readonly CoverageGap[],
): T[][] {
  if (points.length === 0) return [];

  const ordered = [...points].sort((a, b) => a.at.getTime() - b.at.getTime());
  const segments: T[][] = [];
  let current: T[] = [];

  for (const point of ordered) {
    // `.at(-1)` rather than `[length - 1]`: no-float-in-analytics forbids arithmetic on a
    // numeric literal in this layer, and it is right to — the exception for index math is
    // exactly the kind that widens until the rule means nothing.
    const previous = current.at(-1);

    const crossed =
      previous !== undefined &&
      gaps.some((gap) => overlaps({ from: previous.at, to: point.at }, { from: gap.from, to: gap.to }));

    if (crossed) {
      segments.push(current);
      current = [];
    }
    current.push(point);
  }

  if (current.length > 0) segments.push(current);
  return segments;
}
