import { describe, expect, it } from 'vitest';
import golden from '../../../src/analytics/goldens/price.volatility_20.json';
import { assertLean, buildLean } from './golden-helpers';

describe('price.volatility_20 — golden fixtures', () => {
  it.each(golden.cases.map((c) => [c.name, c] as const))('reproduces the golden for %s', (_name, testCase) => {
    const artifact = buildLean('price.volatility_20', testCase as never);
    assertLean(artifact, testCase.expected as never);
  });
});

describe('price.volatility_20 — a short history abstains, it does not throw (lane-review)', () => {
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
            '12 close(s) were found. Exactly 21 sessions of adjusted daily closes — the most ' +
            'recent 20-session window, no more and no fewer — are required for a volatility ' +
            'read.',
        },
        warnings: [],
      },
    };
    const artifact = buildLean('price.volatility_20', testCase as never);
    // `buildLean` ignores `expected` — without `assertLean`, this test only proved the
    // eligibility code and left the abstention reason and message unchecked. Found by
    // lane-review.
    assertLean(artifact, testCase.expected);
    expect(artifact.steps).toHaveLength(0);
  });

  it('25 closes — more than the 21-session window — abstains rather than silently computing over a stale window', () => {
    // `readSeries` reads the *oldest* 21 of however many are declared, not the most recent 21.
    // Reverting the guard to `available < WINDOW` would leave this silently computing volatility
    // over a stale window (lane-review, round 3).
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
            '25 close(s) were found. Exactly 21 sessions of adjusted daily closes — the most ' +
            'recent 20-session window, no more and no fewer — are required for a volatility ' +
            'read.',
        },
        warnings: [],
      },
    };
    const artifact = buildLean('price.volatility_20', testCase as never);
    assertLean(artifact, testCase.expected);
    expect(artifact.steps).toHaveLength(0);
  });
});

describe('price.volatility_20 — a genuinely varying series', () => {
  // A nonzero result is irrational (· sqrt(252)); asserted structurally, not as an exact string.
  it('reports a positive, nonzero figure for a series with real dispersion', () => {
    const closes = ['100'];
    for (let index = 0; index < 20; index += 1) {
      closes.push(index % 2 === 0 ? '101' : '99');
    }
    const artifact = buildLean('price.volatility_20', {
      name: 'varying',
      identityInputs: { quote_kind: 'adjusted_close' },
      seriesInputs: { close: closes },
      expected: { eligibility: 'ok', exact: null, display: null, abstention: null, warnings: [] },
    } as never);
    expect(artifact.eligibility).toBe('ok');
    expect(artifact.result?.exact).not.toBe('0');
    expect(artifact.result?.exact.startsWith('-')).toBe(false);
  });
});
