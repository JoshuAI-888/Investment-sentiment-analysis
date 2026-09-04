import { describe, expect, it, vi } from 'vitest';
import type { CoverageWindow } from '@/contracts/coverage';

const coverageWindowForMock = vi.fn<() => Promise<CoverageWindow | null>>();
vi.mock('@/repositories/coverage', () => ({ coverageWindowFor: coverageWindowForMock }));

const { segmentSeriesForAxis } = await import('@/services/ticker/coverage');

describe('segmentSeriesForAxis', () => {
  it('renders one ungapped segment and an honest "no floor recorded" disclosure when the collector has never started', async () => {
    coverageWindowForMock.mockResolvedValueOnce(null);
    const points = [{ at: new Date('2026-09-01T00:00:00.000Z') }, { at: new Date('2026-09-02T00:00:00.000Z') }];
    const result = await segmentSeriesForAxis('reddit', points);
    expect(result.segments).toEqual([points]);
    expect(result.disclosure).toContain('no coverage floor is recorded yet');
    expect(result.gapCount).toBe(0);
  });

  /**
   * Round-3 lane-review finding 1: the `window === null` branch used to pass its input straight
   * through with no sort. Every real caller passes points ordered `observed_at desc` (the
   * repository's own read order); this fixture pins that real order, not an already-ascending
   * one that a reversal bug could pass unnoticed.
   */
  it('sorts a newest-first input to oldest-first before charting, matching the gapped branch below', async () => {
    coverageWindowForMock.mockResolvedValueOnce(null);
    const newest = { at: new Date('2026-09-03T00:00:00.000Z') };
    const middle = { at: new Date('2026-09-02T00:00:00.000Z') };
    const oldest = { at: new Date('2026-09-01T00:00:00.000Z') };
    const result = await segmentSeriesForAxis('reddit', [newest, middle, oldest]);
    expect(result.segments).toEqual([[oldest, middle, newest]]);
  });

  it('splits a series at a recorded gap into two segments, never interpolating across it', async () => {
    coverageWindowForMock.mockResolvedValueOnce({
      axis: 'reddit',
      startedAt: new Date('2026-08-01T00:00:00.000Z'),
      lastObservedAt: new Date('2026-09-03T00:00:00.000Z'),
      gaps: [
        {
          axis: 'reddit',
          from: new Date('2026-09-01T12:00:00.000Z'),
          to: new Date('2026-09-02T12:00:00.000Z'),
          reason: 'collector_down',
          permanent: true,
        },
      ],
    });

    const points = [
      { at: new Date('2026-09-01T00:00:00.000Z') },
      { at: new Date('2026-09-03T00:00:00.000Z') },
    ];
    const result = await segmentSeriesForAxis('reddit', points);
    expect(result.segments).toHaveLength(2);
    expect(result.gapCount).toBe(1);
    expect(result.disclosure).toContain('coverage begins 2026-08-01');
  });

  /**
   * Round-4 lane-review finding 6: `gapCount` used to be `window.gaps.length` — every gap ever
   * recorded for the axis, unbounded history, not the window this chart actually draws. A gap
   * recorded long before the rendered points' own range must not inflate the count next to a
   * chart with no visible break in it.
   */
  it('excludes a recorded gap that falls entirely outside the rendered points\' own range', async () => {
    coverageWindowForMock.mockResolvedValueOnce({
      axis: 'reddit',
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
      lastObservedAt: new Date('2026-09-03T00:00:00.000Z'),
      gaps: [
        {
          axis: 'reddit',
          from: new Date('2026-02-01T00:00:00.000Z'),
          to: new Date('2026-02-02T00:00:00.000Z'),
          reason: 'collector_down',
          permanent: true,
        },
      ],
    });

    const points = [
      { at: new Date('2026-09-01T00:00:00.000Z') },
      { at: new Date('2026-09-02T00:00:00.000Z') },
      { at: new Date('2026-09-03T00:00:00.000Z') },
    ];
    const result = await segmentSeriesForAxis('reddit', points);
    expect(result.segments).toHaveLength(1);
    expect(result.gapCount).toBe(0);
  });

  it('renders zero segments for an empty series', async () => {
    coverageWindowForMock.mockResolvedValueOnce(null);
    const result = await segmentSeriesForAxis('x', []);
    expect(result.segments).toEqual([]);
  });
});
