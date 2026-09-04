import { describe, expect, it } from 'vitest';
import { spearman, meetsCalibrationGate, InsufficientDataError, CALIBRATION_GATE } from '@/services/eval/spearman';

describe('spearman', () => {
  it('is 1.0000 for two perfectly rank-agreeing series', () => {
    const rho = spearman([
      { id: 'a', human: 1, judge: 10 },
      { id: 'b', human: 2, judge: 20 },
      { id: 'c', human: 3, judge: 30 },
      { id: 'd', human: 4, judge: 40 },
    ]);
    expect(rho).toBe('1.0000');
  });

  it('is -1.0000 for two perfectly rank-opposed series', () => {
    const rho = spearman([
      { id: 'a', human: 1, judge: 40 },
      { id: 'b', human: 2, judge: 30 },
      { id: 'c', human: 3, judge: 20 },
      { id: 'd', human: 4, judge: 10 },
    ]);
    expect(rho).toBe('-1.0000');
  });

  it('is 0.0000 for the one 4-item permutation with zero rank correlation (Σd² = n(n²-1)/6 = 10)', () => {
    const rho = spearman([
      { id: 'a', human: 1, judge: 3 },
      { id: 'b', human: 2, judge: 1 },
      { id: 'c', human: 3, judge: 4 },
      { id: 'd', human: 4, judge: 2 },
    ]);
    expect(rho).toBe('0.0000');
  });

  it('handles tied ranks via average-rank, without throwing', () => {
    const rho = spearman([
      { id: 'a', human: 3, judge: 3 },
      { id: 'b', human: 3, judge: 4 },
      { id: 'c', human: 5, judge: 5 },
      { id: 'd', human: 1, judge: 2 },
    ]);
    expect(Number(rho)).toBeGreaterThan(0);
  });

  it('throws InsufficientDataError below two pairs', () => {
    expect(() => spearman([{ id: 'a', human: 1, judge: 1 }])).toThrow(InsufficientDataError);
    expect(() => spearman([])).toThrow(InsufficientDataError);
  });

  it('throws InsufficientDataError when one series has zero variance (every score identical)', () => {
    expect(() =>
      spearman([
        { id: 'a', human: 3, judge: 1 },
        { id: 'b', human: 3, judge: 2 },
        { id: 'c', human: 3, judge: 3 },
      ]),
    ).toThrow(InsufficientDataError);
  });
});

describe('meetsCalibrationGate', () => {
  it(`passes at and above ${CALIBRATION_GATE}, fails below it`, () => {
    expect(meetsCalibrationGate('0.7000')).toBe(true);
    expect(meetsCalibrationGate('0.9000')).toBe(true);
    expect(meetsCalibrationGate('0.6999')).toBe(false);
  });
});
