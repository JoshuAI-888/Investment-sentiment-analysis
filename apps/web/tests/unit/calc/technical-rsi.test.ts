import { describe, expect, it } from 'vitest';
import golden from '../../../src/analytics/goldens/technical.rsi_14.json';
import { assertLean, buildLean } from './golden-helpers';

describe('technical.rsi_14 — golden fixtures', () => {
  it.each(golden.cases.map((c) => [c.name, c] as const))('reproduces the golden for %s', (_name, testCase) => {
    const artifact = buildLean('technical.rsi_14', testCase as never);
    assertLean(artifact, testCase.expected as never);
  });
});

describe('technical.rsi_14 — a short history abstains, it does not throw (lane-review)', () => {
  it('10 closes (fewer than the 15 RSI(14) needs) abstains rather than crashing', () => {
    const testCase = {
      name: 'short_history',
      identityInputs: { quote_kind: 'adjusted_close' },
      seriesInputs: { close: Array.from({ length: 10 }, () => '100') },
      expected: {
        eligibility: 'insufficient_data' as const,
        exact: null,
        display: null,
        abstention: {
          reason: 'below_sample_threshold',
          message:
            '10 close(s) were found. Exactly 15 sessions of adjusted daily closes — the most ' +
            'recent window, no more and no fewer — are required for RSI(14).',
        },
        warnings: [],
      },
    };
    const artifact = buildLean('technical.rsi_14', testCase as never);
    // `buildLean` ignores `expected` — without `assertLean`, this test only proved the
    // eligibility code and left the abstention reason and message unchecked. Found by
    // lane-review.
    assertLean(artifact, testCase.expected);
    expect(artifact.steps).toHaveLength(0);
  });

  it('20 closes — more than the 15-session window — abstains rather than silently computing over a stale window', () => {
    // `readSeries` reads the *oldest* 15 of however many are declared, not the most recent 15.
    // Reverting the guard to `available < WINDOW` would leave this silently computing RSI over a
    // stale window rather than abstaining (lane-review, round 3).
    const testCase = {
      name: 'over_window',
      identityInputs: { quote_kind: 'adjusted_close' },
      seriesInputs: { close: Array.from({ length: 20 }, () => '100') },
      expected: {
        eligibility: 'insufficient_data' as const,
        exact: null,
        display: null,
        abstention: {
          reason: 'below_sample_threshold',
          message:
            '20 close(s) were found. Exactly 15 sessions of adjusted daily closes — the most ' +
            'recent window, no more and no fewer — are required for RSI(14).',
        },
        warnings: [],
      },
    };
    const artifact = buildLean('technical.rsi_14', testCase as never);
    assertLean(artifact, testCase.expected);
    expect(artifact.steps).toHaveLength(0);
  });
});

describe('technical.rsi_14 — the zero-loss and flat-window substitutions are marked as clamps', () => {
  // Finding 2 (lane-review, round 3): RSI=100 (no losing session) and RSI=50 (a flat window) are
  // substitutions for a division by zero the real formula cannot perform, not ordinarily-computed
  // values — the registry documents this as `clamp`, and the step itself must say so too, or the
  // Inspector renders a substituted number as though it were a normal read. The lean golden
  // format pins `warnings` but not step `status`, so this is asserted directly here.
  it('marks the no-losing-session RSI=100 substitution as clamped, not applied', () => {
    const golden14Up = golden.cases.find((c) => c.name === 'all_up_no_losses');
    const artifact = buildLean('technical.rsi_14', golden14Up as never);
    expect(artifact.steps.find((s) => s.key === 'rsi_14')?.status).toBe('clamped');
  });

  it('marks the flat-window RSI=50 substitution as clamped, not applied', () => {
    const flat = golden.cases.find((c) => c.name === 'flat_neutral');
    const artifact = buildLean('technical.rsi_14', flat as never);
    expect(artifact.steps.find((s) => s.key === 'rsi_14')?.status).toBe('clamped');
  });

  it('does not mark a genuinely computed RSI as clamped', () => {
    const mixed = golden.cases.find((c) => c.name === 'mixed_rs_three');
    const artifact = buildLean('technical.rsi_14', mixed as never);
    expect(artifact.steps.find((s) => s.key === 'rsi_14')?.status).toBe('applied');
  });
});
