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
    expect(verdict.overallMean).toBeGreaterThanOrEqual(TIER_C_MEAN_THRESHOLD);
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
    expect(verdict.overallMean).toBeGreaterThanOrEqual(TIER_C_MEAN_THRESHOLD);
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

  it('computes overallMean as the mean of the four per-axis means, not a flat average across all scores', () => {
    // One pack scores c1=5 on every axis, the other scores c1=1 on every axis: flat average
    // and per-axis-mean-of-means agree here (both 3), so use an unbalanced axis pattern instead.
    const results: CorpusJudgeResult[] = [
      { packId: 'a', response: response({ c1: 5, c2: 5, c3: 1, c4: 1 }) },
    ];
    const verdict = evaluateTierCGate(results, 0);
    expect(verdict.perAxisMean).toEqual({ c1: 5, c2: 5, c3: 1, c4: 1 });
    expect(verdict.overallMean).toBeCloseTo((5 + 5 + 1 + 1) / 4, 10);
  });

  it('throws rather than evaluate a gate against zero judged answers', () => {
    expect(() => evaluateTierCGate([], 0)).toThrow(/zero/);
  });
});
