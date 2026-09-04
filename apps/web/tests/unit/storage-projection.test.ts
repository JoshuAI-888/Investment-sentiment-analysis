import { describe, expect, it } from 'vitest';
import { GATE_MB, project, WAVE_1_PROJECTION } from '../../scripts/checks/storage-projection';

describe('storage projection (F03 §4.5, closing F-07)', () => {
  it('sizes artifacts by retention, not by history', () => {
    // F-07: artifacts carry the same 90-day retention as normalized data. Sizing them by the
    // 180 days of history the product *shows* doubles the answer.
    const short = project({ ...WAVE_1_PROJECTION, artifactRetentionDays: 45 });
    const long = project({ ...WAVE_1_PROJECTION, artifactRetentionDays: 90 });
    expect(long.gatedMb).toBeGreaterThan(short.gatedMb * 1.9);
  });

  it('keeps a series as one artifact rather than one per point', () => {
    // The whole of F-07's ruling, as arithmetic. Moving the 180 points of a return series out
    // of `points` and into their own artifacts multiplies that line by roughly 180.
    const asOneArtifact = project({
      ...WAVE_1_PROJECTION,
      methods: [
        { key: 's', subjects: 100, refreshesPerDay: 1, pointsPerArtifact: 180, inputsPerArtifact: 4, stepsPerArtifact: 6 },
      ],
      observations: [],
      corpus: [],
    });
    const asArtifactPerPoint = project({
      ...WAVE_1_PROJECTION,
      methods: [
        { key: 's', subjects: 100 * 180, refreshesPerDay: 1, pointsPerArtifact: 0, inputsPerArtifact: 4, stepsPerArtifact: 6 },
      ],
      observations: [],
      corpus: [],
    });
    // ~56×, not ~180×. The per-point reading pays a full header, four inputs and six steps for
    // every point (≈4,450 B each); the ruling's version pays one header plus a `seriesPoint`
    // per point. The original assertion here said >50 — a guess at the multiple rather than a
    // derivation of it, and wrong. The number that matters is that it is a large multiple, so
    // the bound is stated loosely and the value pinned.
    //
    // **Re-pinned by F05** from 41.1 to 99.5, then again (lane-review finding 5) to 56.2 once
    // `seriesPoint` itself was re-measured against a representative fixture (60 B, not the 20 B
    // an unrepresentative one had produced — see `ROW_BYTES`'s own doc comment). A bigger
    // `seriesPoint` narrows the advantage of packing points into one artifact, which is exactly
    // the direction this multiple should move: the ruling's case is still large, just less
    // dramatically large than an under-measured `seriesPoint` made it look.
    const multiple = asArtifactPerPoint.gatedMb / asOneArtifact.gatedMb;
    expect(multiple).toBeGreaterThan(30);
    expect(multiple).toBeCloseTo(56.2, 0);
  });

  it('reports the permanent corpus separately from the gated pool', () => {
    // §6.8 governs the corpus by a growth rate in MB/month, not by a fixed ceiling. Counting
    // it against F-07's 300 MB gate would compare two things measured on different rulers.
    const projection = project(WAVE_1_PROJECTION);
    expect(projection.corpusMbPerMonth).toBeGreaterThan(0);
    expect(projection.lines.some((line) => line.pool === 'corpus')).toBe(true);
    expect(projection.lines.filter((line) => line.pool === 'corpus').length).toBeGreaterThan(0);
  });

  it('projects corpus growth within the rate D-33 provisioned for', () => {
    // D-33 bought Neon Launch against a projected 120–180 MB/month.
    const projection = project(WAVE_1_PROJECTION);
    expect(projection.corpusMbPerMonth).toBeLessThan(180);
  });

  it('pins the projected figure so a change to it is visible in a diff', () => {
    // Deliberately NOT `toBeLessThan(GATE_MB)`, in either direction. The projection is over
    // F-07's 300 MB figure, and F22 §4.5 then replaced that figure with a measured MB/month
    // rate — "the wrong instrument for a corpus designed to grow forever". So this pins the
    // value rather than judging it: editing the constants until the number looks comfortable
    // is the failure mode either assertion would invite.
    //
    // **Re-pinned by F05** from 485.8 to 539.7, then again (lane-review finding 5) to 673.0
    // once `calculationStep` and `seriesPoint` were re-measured against a fixture that no
    // longer under-states them by repeating 28 dates and small integer values across 180
    // points. That is the pin working, not being worked around: `tests/integration/artifact-
    // storage.test.ts` is the measurement, and it fails if any constant becomes an
    // under-estimate again.
    const projection = project(WAVE_1_PROJECTION);
    expect(projection.gatedMb).toBeGreaterThan(GATE_MB);
    expect(projection.gatedMb).toBeCloseTo(673.0, 0);
  });
});
