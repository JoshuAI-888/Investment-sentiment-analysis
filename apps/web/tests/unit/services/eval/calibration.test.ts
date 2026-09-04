import { describe, expect, it } from 'vitest';
import { sampleForOwner, computeCalibration, pendingCalibrationStatus, CALIBRATION_SAMPLE_SIZE, type CalibrationCandidate } from '@/services/eval/calibration';

function candidate(id: string, mean: number): CalibrationCandidate {
  return { answerId: id, judgeScores: { c1: mean, c2: mean, c3: mean, c4: mean, violations: [], rationale: 'x' } };
}

describe('sampleForOwner', () => {
  it('returns everything when the corpus is at or below the sample size', () => {
    const scored = [candidate('a', 4), candidate('b', 3)];
    expect(sampleForOwner(scored)).toHaveLength(2);
  });

  it(`down-samples to exactly ${String(CALIBRATION_SAMPLE_SIZE)} for a larger corpus, deterministically`, () => {
    const scored = Array.from({ length: 70 }, (_, i) => candidate(`id-${String(i).padStart(2, '0')}`, (i % 5) + 1));
    const first = sampleForOwner(scored);
    const second = sampleForOwner(scored);
    expect(first).toHaveLength(CALIBRATION_SAMPLE_SIZE);
    expect(first.map((c) => c.answerId)).toEqual(second.map((c) => c.answerId));
  });
});

describe('computeCalibration', () => {
  it('reports "pending" — not a fabricated number — when no human scores have been recorded', () => {
    const candidates = [candidate('a', 4), candidate('b', 3)];
    const outcome = computeCalibration(candidates, []);
    expect(outcome.status).toBe('pending');
  });

  it('computes a real Spearman number once human scores exist', () => {
    const candidates = [candidate('a', 5), candidate('b', 3), candidate('c', 1)];
    const outcome = computeCalibration(candidates, [
      { answerId: 'a', c1: 5, c2: 5, c3: 5, c4: 5 },
      { answerId: 'b', c1: 3, c2: 3, c3: 3, c4: 3 },
      { answerId: 'c', c1: 1, c2: 1, c3: 1, c4: 1 },
    ]);
    expect(outcome.status).toBe('measured');
    if (outcome.status === 'measured') {
      expect(outcome.spearmanRho).toBe('1.0000');
      expect(outcome.meetsGate).toBe(true);
      expect(outcome.n).toBe(3);
    }
  });

  it('pendingCalibrationStatus names the sample size and never invents a rho', () => {
    const outcome = pendingCalibrationStatus(20);
    expect(outcome.status).toBe('pending');
    if (outcome.status === 'pending') {
      expect(outcome.sampleSize).toBe(20);
      expect(outcome.reason).toContain('MT-11');
    }
  });
});
