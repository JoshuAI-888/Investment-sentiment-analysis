import { describe, expect, it } from 'vitest';
import golden from '../../../src/analytics/goldens/price.regime.json';
import { assertLean, buildLean, identityInput, seriesInputs } from './golden-helpers';
import { buildArtifact } from '../../../src/calc/artifact';
import { METHOD_REGISTRY } from '../../../src/services/calculations';

describe('price.regime — golden fixtures', () => {
  it.each(golden.cases.map((c) => [c.name, c] as const))('reproduces the golden for %s', (_name, testCase) => {
    const artifact = buildLean('price.regime', testCase as never);
    assertLean(artifact, testCase.expected as never);
  });

  it('distinguishes "at the clamp bound" from "reached by clamping" via the step status', () => {
    const boundary = golden.cases.find((c) => c.name === 'floor_engaged_at_clamp_bound');
    const clamped = golden.cases.find((c) => c.name === 'exceeds_upper_clamp');
    const boundaryArtifact = buildLean('price.regime', boundary as never);
    const clampedArtifact = buildLean('price.regime', clamped as never);
    expect(boundaryArtifact.steps.find((s) => s.key === 'trend_clamped')?.status).toBe('applied');
    expect(clampedArtifact.steps.find((s) => s.key === 'trend_clamped')?.status).toBe('clamped');
    // Both engaged the volatility floor — the realized volatility in both cases is well under 0.005.
    expect(boundaryArtifact.steps.find((s) => s.key === 'trend_denominator')?.status).toBe('clamped');
    expect(clampedArtifact.steps.find((s) => s.key === 'trend_denominator')?.status).toBe('clamped');
  });
});

describe('price.regime — the branch where realized volatility exceeds the floor', () => {
  // Deliberately not a golden fixture: the denominator is an irrational sqrt() here, so only
  // the *branch taken* and the *sign* are asserted, not an exact digit string.
  it('uses the computed volatility rather than the floor, and the sign follows the move', () => {
    const entry = METHOD_REGISTRY.latest('price.regime');
    const closes = Array.from({ length: 20 }, () => '100');
    closes.push('150'); // a 50% single-session move — unambiguously past the 0.005 floor.

    const inputs = [
      identityInput('quote_kind', 'adjusted_close'),
      ...seriesInputs('close', closes),
    ];

    const artifact = buildArtifact({
      method: {
        methodId: entry.id,
        version: entry.version,
        unit: entry.unit,
        roundingRule: entry.roundingRule,
        workingPrecision: entry.workingPrecision,
        compute: entry.compute,
      },
      subject: { kind: 'security', id: 'sec-vol', label: 'VOL' },
      asOf: '2026-08-30T12:00:00.000Z',
      inputs,
      assumptions: [],
      configVersion: '1',
      scenario: { kind: 'official' },
      calculationId: '00000000-0000-4000-8000-000000000003',
      computedAt: '2026-08-30T12:00:01.000Z',
    });

    expect(artifact.steps.find((s) => s.key === 'trend_denominator')?.status).toBe('applied');
    expect(artifact.result?.exact.startsWith('-')).toBe(false);
    expect(artifact.result?.exact).not.toBe('0');
  });
});

describe('price.regime — a short history abstains, it does not throw (lane-review)', () => {
  it('12 closes — a newly-listed security or a collection gap — abstains rather than crashing', () => {
    // THE REGRESSION. Before this fix, fewer than 21 declared closes made `readSeries` throw
    // `ArtifactBuildError` for an undeclared key — an uncaught exception, not an artifact, for
    // the single most likely real-world input this method will ever see.
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
            'recent 20-session window, no more and no fewer — are required for a regime read; a ' +
            'shorter history has no window to compute the 5- and 20-session returns over, and a ' +
            'longer one would silently compute over a stale window rather than the current one.',
        },
        warnings: [],
      },
    };
    const artifact = buildLean('price.regime', testCase as never);
    // `buildLean` ignores `expected` — it only builds the inputs. `assertLean` is what pins the
    // abstention reason and message; without it, this test only proved the eligibility code and
    // let the exact copy a user reads on this failure path go unchecked. Found by lane-review.
    assertLean(artifact, testCase.expected);
    expect(artifact.steps).toHaveLength(0);
  });

  it('25 closes — more than the 21-session window — abstains rather than silently computing over a stale window', () => {
    // THE OTHER HALF OF THE REGRESSION (lane-review, round 3): `readSeries` reads the *oldest*
    // 21 of however many are declared, not the most recent 21. Reverting the guard to
    // `available < WINDOW` would leave this case silently computing `close_t` as a session days
    // stale rather than abstaining — the exact defect a second lane-review pass found, now pinned
    // so it cannot come back uncaught.
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
            'recent 20-session window, no more and no fewer — are required for a regime read; a ' +
            'shorter history has no window to compute the 5- and 20-session returns over, and a ' +
            'longer one would silently compute over a stale window rather than the current one.',
        },
        warnings: [],
      },
    };
    const artifact = buildLean('price.regime', testCase as never);
    assertLean(artifact, testCase.expected);
    expect(artifact.steps).toHaveLength(0);
  });
});

describe('price.regime — divide-by-zero is refused, not silently produced', () => {
  it('a zero close in the window aborts before division, never renders Infinity', () => {
    // Covered structurally by non_positive_close above; this asserts the guard runs before any
    // step is recorded, which the golden case alone does not show (steps === [] either way).
    const artifact = buildLean('price.regime', {
      name: 'zero_close_direct',
      identityInputs: { quote_kind: 'adjusted_close' },
      seriesInputs: { close: [...Array.from({ length: 20 }, () => '0'), '100'] },
      expected: { eligibility: 'not_applicable', exact: null, display: null, abstention: null, warnings: [] },
    } as never);
    expect(artifact.eligibility).toBe('not_applicable');
    expect(artifact.steps).toHaveLength(0);
  });
});
