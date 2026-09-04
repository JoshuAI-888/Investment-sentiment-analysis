import { describe, expect, it } from 'vitest';
import {
  evaluateWindow,
  floorsDiverge,
  gapsOverlapping,
  overlaps,
  perAxisFloors,
  segmentAcrossGaps,
} from '../../src/calc/coverage';
import type { CoverageGap, CoverageWindow } from '../../src/contracts/coverage';

const d = (iso: string) => new Date(iso);

const gap = (from: string, to: string, reason: CoverageGap['reason'] = 'collector_down'): CoverageGap => ({
  axis: 'reddit',
  from: d(from),
  to: d(to),
  reason,
  permanent: true,
});

const window = (overrides: Partial<CoverageWindow> = {}): CoverageWindow => ({
  axis: 'reddit',
  startedAt: d('2026-09-01T00:00:00Z'),
  gaps: [],
  lastObservedAt: d('2026-12-01T00:00:00Z'),
  ...overrides,
});

describe('overlaps', () => {
  it('is true when intervals intersect', () => {
    expect(overlaps({ from: d('2026-01-01'), to: d('2026-02-01') }, { from: d('2026-01-15'), to: d('2026-03-01') })).toBe(true);
  });

  it('is false when they merely touch', () => {
    // A gap ending exactly when a window starts is not inside it. Treating touching endpoints
    // as overlap would abstain on every window that begins the moment coverage resumes.
    expect(overlaps({ from: d('2026-01-01'), to: d('2026-02-01') }, { from: d('2026-02-01'), to: d('2026-03-01') })).toBe(false);
  });

  it('is false when disjoint', () => {
    expect(overlaps({ from: d('2026-01-01'), to: d('2026-02-01') }, { from: d('2026-03-01'), to: d('2026-04-01') })).toBe(false);
  });
});

describe('evaluateWindow', () => {
  it('is eligible inside a clean window', () => {
    const verdict = evaluateWindow(window(), d('2026-10-01'), d('2026-11-01'));
    expect(verdict.eligibility).toBe('eligible');
    expect(verdict.disclosure).toContain('coverage begins 2026-09-01');
  });

  it('abstains below the coverage floor', () => {
    const verdict = evaluateWindow(window(), d('2026-08-01'), d('2026-10-01'));
    expect(verdict.eligibility).toBe('below_floor');
    expect(verdict.disclosure).toContain('starts before it');
  });

  it('abstains across a gap rather than computing over the hole', () => {
    // F22 DoD: "a metric whose window overlaps a gap returns insufficient_data, not a value."
    const verdict = evaluateWindow(
      window({ gaps: [gap('2026-10-05T00:00:00Z', '2026-10-09T00:00:00Z')] }),
      d('2026-10-01'),
      d('2026-11-01'),
    );
    expect(verdict.eligibility).toBe('overlaps_gap');
    expect(verdict.overlappingGaps).toHaveLength(1);
    expect(verdict.disclosure).toContain('collector_down');
  });

  it('ignores a gap outside the requested window', () => {
    const verdict = evaluateWindow(
      window({ gaps: [gap('2026-09-05T00:00:00Z', '2026-09-09T00:00:00Z')] }),
      d('2026-10-01'),
      d('2026-11-01'),
    );
    expect(verdict.eligibility).toBe('eligible');
  });

  it('reports no coverage before anything is collected', () => {
    const verdict = evaluateWindow(window({ lastObservedAt: null }), d('2026-10-01'), d('2026-11-01'));
    expect(verdict.eligibility).toBe('no_coverage');
  });

  it('ranks no_coverage above below_floor above overlaps_gap', () => {
    // Three different statements about what a reader should do next. Collapsing them into one
    // "insufficient_data" would be true and useless.
    const gaps = [gap('2026-08-05T00:00:00Z', '2026-10-09T00:00:00Z')];
    expect(evaluateWindow(window({ gaps, lastObservedAt: null }), d('2026-08-01'), d('2026-11-01')).eligibility)
      .toBe('no_coverage');
    expect(evaluateWindow(window({ gaps }), d('2026-08-01'), d('2026-11-01')).eligibility)
      .toBe('below_floor');
    expect(evaluateWindow(window({ gaps }), d('2026-10-01'), d('2026-11-01')).eligibility)
      .toBe('overlaps_gap');
  });

  it('names every distinct reason when several gaps are crossed', () => {
    const verdict = evaluateWindow(
      window({
        gaps: [
          gap('2026-10-05T00:00:00Z', '2026-10-06T00:00:00Z', 'provider_outage'),
          gap('2026-10-10T00:00:00Z', '2026-10-11T00:00:00Z', 'budget_denied'),
        ],
      }),
      d('2026-10-01'),
      d('2026-11-01'),
    );
    expect(verdict.overlappingGaps).toHaveLength(2);
    expect(verdict.disclosure).toContain('provider_outage');
    expect(verdict.disclosure).toContain('budget_denied');
  });
});

describe('per-axis coverage floors', () => {
  const windows: CoverageWindow[] = [
    window(),
    window({ axis: 'x', startedAt: d('2026-11-15T00:00:00Z') }),
  ];

  it('returns a floor for every axis, not the earliest', () => {
    // The dishonesty this prevents: X is trigger-sampled and D-32 funds it at zero, so it
    // starts materially later. Drawing a comparison from Reddit's floor makes the months before
    // X started look like months when X was quiet.
    const floors = perAxisFloors(windows);
    expect(floors).toHaveLength(2);
    expect(floors.map((f) => f.axis).sort()).toEqual(['reddit', 'x']);
    expect(floors.find((f) => f.axis === 'x')?.disclosure).toContain('2026-11-15');
  });

  it('detects divergent floors', () => {
    expect(floorsDiverge(windows)).toBe(true);
    expect(floorsDiverge([window(), window({ axis: 'substack' })])).toBe(false);
  });
});

describe('segmentAcrossGaps', () => {
  const points = [
    { at: d('2026-10-01T00:00:00Z'), v: 1 },
    { at: d('2026-10-02T00:00:00Z'), v: 2 },
    { at: d('2026-10-20T00:00:00Z'), v: 3 },
    { at: d('2026-10-21T00:00:00Z'), v: 4 },
  ];

  it('returns one segment when nothing is crossed', () => {
    expect(segmentAcrossGaps(points, [])).toHaveLength(1);
  });

  it('splits the series at a gap rather than connecting across it', () => {
    // §4.4: "a series is never interpolated across a gap". Segments rather than a hasGap flag,
    // because a flag leaves the decision to the renderer and the renderer's default is to join
    // the points.
    const segments = segmentAcrossGaps(points, [gap('2026-10-05T00:00:00Z', '2026-10-15T00:00:00Z')]);
    expect(segments).toHaveLength(2);
    expect(segments[0]?.map((p) => p.v)).toEqual([1, 2]);
    expect(segments[1]?.map((p) => p.v)).toEqual([3, 4]);
  });

  it('handles an empty series', () => {
    expect(segmentAcrossGaps([], [gap('2026-10-05T00:00:00Z', '2026-10-15T00:00:00Z')])).toEqual([]);
  });

  it('orders points before segmenting', () => {
    const shuffled = [points[2]!, points[0]!, points[3]!, points[1]!];
    const segments = segmentAcrossGaps(shuffled, [gap('2026-10-05T00:00:00Z', '2026-10-15T00:00:00Z')]);
    expect(segments[0]?.map((p) => p.v)).toEqual([1, 2]);
  });
});

describe('gapsOverlapping', () => {
  it('returns only the gaps the window touches', () => {
    const found = gapsOverlapping(
      window({
        gaps: [
          gap('2026-09-05T00:00:00Z', '2026-09-06T00:00:00Z'),
          gap('2026-10-05T00:00:00Z', '2026-10-06T00:00:00Z'),
        ],
      }),
      d('2026-10-01'),
      d('2026-11-01'),
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.from.toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });
});
