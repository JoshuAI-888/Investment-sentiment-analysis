import { describe, expect, it } from 'vitest';
import twentyGolden from '../../../src/analytics/goldens/technical.moving_average_20.json';
import fiftyGolden from '../../../src/analytics/goldens/technical.moving_average_50.json';
import { assertLean, buildLean } from './golden-helpers';

const SETS = [
  { methodId: 'technical.moving_average_20', golden: twentyGolden, window: 20 },
  { methodId: 'technical.moving_average_50', golden: fiftyGolden, window: 50 },
];

describe.each(SETS)('$methodId — golden fixtures', ({ methodId, golden }) => {
  it.each(golden.cases.map((c) => [c.name, c] as const))('reproduces the golden for %s', (_name, testCase) => {
    const artifact = buildLean(methodId, testCase as never);
    assertLean(artifact, testCase.expected as never);
  });
});

describe.each(SETS)('$methodId — a short history abstains, it does not throw (lane-review)', ({ methodId, window }) => {
  it(`fewer than ${window} closes abstains rather than crashing`, () => {
    const short = window - 5;
    const testCase = {
      name: 'short_history',
      identityInputs: { quote_kind: 'adjusted_close' },
      seriesInputs: { close: Array.from({ length: short }, () => '100') },
      expected: {
        eligibility: 'insufficient_data' as const,
        exact: null,
        display: null,
        abstention: {
          reason: 'below_sample_threshold',
          message:
            `${String(short)} close(s) were found. Exactly ${String(window)} sessions of ` +
            'adjusted daily closes — the most recent window, no more and no fewer — are ' +
            'required for this moving average.',
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

  it(`more than ${window} closes abstains rather than silently averaging a stale window`, () => {
    // `readSeries` reads the *oldest* `window` of however many are declared, not the most
    // recent. Reverting the guard to `available < window` would leave this silently averaging a
    // stale range rather than abstaining (lane-review, round 3).
    const over = window + 5;
    const testCase = {
      name: 'over_window',
      identityInputs: { quote_kind: 'adjusted_close' },
      seriesInputs: { close: Array.from({ length: over }, () => '100') },
      expected: {
        eligibility: 'insufficient_data' as const,
        exact: null,
        display: null,
        abstention: {
          reason: 'below_sample_threshold',
          message:
            `${String(over)} close(s) were found. Exactly ${String(window)} sessions of ` +
            'adjusted daily closes — the most recent window, no more and no fewer — are ' +
            'required for this moving average.',
        },
        warnings: [],
      },
    };
    const artifact = buildLean(methodId, testCase as never);
    assertLean(artifact, testCase.expected);
    expect(artifact.steps).toHaveLength(0);
  });
});
