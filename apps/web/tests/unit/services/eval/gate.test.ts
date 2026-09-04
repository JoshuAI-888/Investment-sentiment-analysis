import { describe, expect, it } from 'vitest';
import {
  TIER_C_C2_FLOOR,
  TIER_C_MEAN_THRESHOLD,
  evaluateTierCGate,
  type CorpusJudgeResult,
} from '../../../../src/services/eval/gate';
import type { JudgeResponse } from '../../../../src/services/eval/contracts';

function response(overrides: Partial<JudgeResponse> = {}): JudgeResponse {
  return { c1: 5, c2: 5, c3: 5, c4: 5, violations: [], rationale: 'well grounded', ...overrides };
}

describe('evaluateTierCGate', () => {
  it('passes a corpus that clears every threshold', () => {
    const results: CorpusJudgeResult[] = [
      { packId: 'a', response: response() },
      { packId: 'b', response: response({ c4: 4 }) },
    ];
    const verdict = evaluateTierCGate(results, 0);
    expect(verdict.passed).toBe(true);
    expect(verdict.reasons).toEqual([]);
    expect(Number(verdict.overallMean)).toBeGreaterThanOrEqual(Number(TIER_C_MEAN_THRESHOLD));
  });

  it('fails on overall mean below the 4.0 threshold', () => {
    const results: CorpusJudgeResult[] = [
      { packId: 'a', response: response({ c1: 3, c2: 3, c3: 3, c4: 3 }) },
    ];
    const verdict = evaluateTierCGate(results, 0);
    expect(verdict.passed).toBe(false);
    expect(verdict.reasons.some((r) => r.includes('overall mean'))).toBe(true);
  });

  it('fails when any single answer scores below 3 on C2, even if the mean is high — "a C2 failure is a defect, not a score to average away"', () => {
    const results: CorpusJudgeResult[] = [
      { packId: 'good-1', response: response() },
      { packId: 'good-2', response: response() },
      { packId: 'good-3', response: response() },
      { packId: 'bad-c2', response: response({ c2: 2 }) },
    ];
    const verdict = evaluateTierCGate(results, 0);
    // The mean is still comfortably above 4.0 with three perfect scores and one c2=2 outlier.
    expect(Number(verdict.overallMean)).toBeGreaterThanOrEqual(Number(TIER_C_MEAN_THRESHOLD));
    expect(verdict.passed).toBe(false);
    expect(verdict.c2Failures).toEqual(['bad-c2']);
    expect(verdict.c2Floor).toBe(TIER_C_C2_FLOOR);
  });

  it('fails on any recorded Tier-B violation, including ones the judge itself reports', () => {
    const results: CorpusJudgeResult[] = [
      { packId: 'a', response: response({ violations: ['unsupported causal claim'] }) },
    ];
    const verdict = evaluateTierCGate(results, 0);
    expect(verdict.passed).toBe(false);
    expect(verdict.tierBViolationCount).toBe(1);
  });

  it('adds externally-measured Tier-B violations to the judge-reported count', () => {
    const results: CorpusJudgeResult[] = [{ packId: 'a', response: response() }];
    const verdict = evaluateTierCGate(results, 2);
    expect(verdict.tierBViolationCount).toBe(2);
    expect(verdict.passed).toBe(false);
  });

  it('computes perAxisMean and overallMean as exact decimal strings, never JS numbers', () => {
    const results: CorpusJudgeResult[] = [
      { packId: 'a', response: response({ c1: 5, c2: 5, c3: 1, c4: 1 }) },
    ];
    const verdict = evaluateTierCGate(results, 0);
    expect(typeof verdict.perAxisMean.c1).toBe('string');
    expect(typeof verdict.overallMean).toBe('string');
    expect(verdict.perAxisMean).toEqual({ c1: '5.0000', c2: '5.0000', c3: '1.0000', c4: '1.0000' });
    expect(Number(verdict.overallMean)).toBeCloseTo((5 + 5 + 1 + 1) / 4, 10);
  });

  /**
   * Lane-review round 1 finding 2's exact repro: three answers whose axis scores are
   * `{4,5,4,4}`, `{4,4,3,4}`, `{4,4,4,4}` have a mathematically *exact* overall mean of 4.0
   * (per-axis means 4, 13/3, 11/3, 4 sum to exactly 16, divided by 4 is exactly 4). A
   * floating-point implementation computes this as `3.9999999999999996` and fails the gate at
   * exactly the threshold; `decimal.js` must not.
   */
  it('does not fail a corpus whose true overall mean sits exactly at the 4.0 threshold — the float-precision repro', () => {
    const results: CorpusJudgeResult[] = [
      { packId: 'a', response: response({ c1: 4, c2: 5, c3: 4, c4: 4 }) },
      { packId: 'b', response: response({ c1: 4, c2: 4, c3: 3, c4: 4 }) },
      { packId: 'c', response: response({ c1: 4, c2: 4, c3: 4, c4: 4 }) },
    ];
    const verdict = evaluateTierCGate(results, 0);
    expect(verdict.overallMean).toBe('4.0000');
    expect(verdict.passed).toBe(true);
    expect(verdict.reasons).toEqual([]);
  });

  it('a report that fails the gate never displays "4.00" next to it (no display/verdict contradiction)', () => {
    // A hair below the threshold: true mean is 3.999... which must both fail AND display as such.
    const results: CorpusJudgeResult[] = [
      { packId: 'a', response: response({ c1: 4, c2: 4, c3: 4, c4: 3 }) },
      { packId: 'b', response: response({ c1: 4, c2: 4, c3: 4, c4: 4 }) },
      { packId: 'c', response: response({ c1: 4, c2: 4, c3: 4, c4: 4 }) },
    ];
    const verdict = evaluateTierCGate(results, 0);
    expect(verdict.passed).toBe(false);
    expect(Number(verdict.overallMean)).toBeLessThan(4.0);
  });

  it('throws rather than evaluate a gate against zero judged answers', () => {
    expect(() => evaluateTierCGate([], 0)).toThrow(/zero/);
  });
});
