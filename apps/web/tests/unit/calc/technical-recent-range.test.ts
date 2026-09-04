import { describe, expect, it } from 'vitest';
import highGolden from '../../../src/analytics/goldens/technical.recent_high_20.json';
import lowGolden from '../../../src/analytics/goldens/technical.recent_low_20.json';
import { assertLean, buildLean } from './golden-helpers';

const SETS = [
  { methodId: 'technical.recent_high_20', golden: highGolden, kind: 'high' },
  { methodId: 'technical.recent_low_20', golden: lowGolden, kind: 'low' },
];

describe.each(SETS)('$methodId — golden fixtures', ({ methodId, golden }) => {
  it.each(golden.cases.map((c) => [c.name, c] as const))('reproduces the golden for %s', (_name, testCase) => {
    const artifact = buildLean(methodId, testCase as never);
    assertLean(artifact, testCase.expected as never);
  });
});

describe.each(SETS)('$methodId — a short history abstains, it does not throw (lane-review)', ({ methodId, kind }) => {
  it('12 closes abstains rather than crashing', () => {
    const testCase = {
      name: 'short_history',
      identityInputs: { quote_kind: 'adjusted_close' },
      seriesInputs: { close: Array.from({ length: 12 }, () => '100') },
      expected: {
        eligibility: 'insufficient_data' as const,
        exact: null,
        display: null,
        abstention: {
          reason: 'below_sample_threshold',
          message:
            `12 close(s) were found. Exactly 20 sessions of adjusted daily closes — the most ` +
            `recent window, no more and no fewer — are required for the recent ${kind}.`,
        },
        warnings: [],
      },
    };
    const artifact = buildLean(methodId, testCase as never);
    // `buildLean` ignores `expected` — without `assertLean`, this test only proved the
    // eligibility code and left the abstention reason and message unchecked. Found by
    // lane-review.
    assertLean(artifact, testCase.expected);
    expect(artifact.steps).toHaveLength(0);
  });

  it('25 closes — more than the 20-session window — abstains rather than silently reporting a stale range', () => {
    // `readSeries` reads the *oldest* 20 of however many are declared, not the most recent 20.
    // Reverting the guard to `available < WINDOW` would leave this silently reporting the
    // high/low of a stale range (lane-review, round 3).
    const testCase = {
      name: 'over_window',
      identityInputs: { quote_kind: 'adjusted_close' },
      seriesInputs: { close: Array.from({ length: 25 }, () => '100') },
      expected: {
        eligibility: 'insufficient_data' as const,
        exact: null,
        display: null,
        abstention: {
          reason: 'below_sample_threshold',
          message:
            `25 close(s) were found. Exactly 20 sessions of adjusted daily closes — the most ` +
            `recent window, no more and no fewer — are required for the recent ${kind}.`,
        },
        warnings: [],
      },
    };
    const artifact = buildLean(methodId, testCase as never);
    assertLean(artifact, testCase.expected);
    expect(artifact.steps).toHaveLength(0);
  });
});
