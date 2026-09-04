import { describe, expect, it } from 'vitest';
import {
  CALIBRATION_SAMPLE_SIZE,
  computeCalibration,
  sampleForCalibration,
} from '../../../../src/services/eval/calibration';

describe('sampleForCalibration', () => {
  it('never mutates the input pool', () => {
    const pool = [1, 2, 3, 4, 5];
    const copy = [...pool];
    sampleForCalibration(pool, 3, () => 0.5);
    expect(pool).toEqual(copy);
  });

  it('caps the sample at the pool size when the pool is smaller than the requested size', () => {
    const sample = sampleForCalibration([1, 2, 3], 20, () => 0.5);
    expect(sample).toHaveLength(3);
  });

  it('defaults to the 20-answer sample size from MT-11', () => {
    const pool = Array.from({ length: 100 }, (_, i) => i);
    const sample = sampleForCalibration(pool, undefined, () => 0.5);
    expect(sample).toHaveLength(CALIBRATION_SAMPLE_SIZE);
  });

  it('is deterministic for an injected rng, so tests never depend on Math.random', () => {
    const pool = [1, 2, 3, 4, 5];
    const rngValues = [0.1, 0.2, 0.3, 0.4, 0.5];
    let i = 0;
    const rng = () => rngValues[i++ % rngValues.length]!;
    const a = sampleForCalibration(pool, 5, rng);
    i = 0;
    const b = sampleForCalibration(pool, 5, rng);
    expect(a).toEqual(b);
  });
});

describe('computeCalibration', () => {
  it('reports pending — MT-11 is a one-off manual owner task, not a fabricated correlation — when there are no hand-scores yet', () => {
    const result = computeCalibration([]);
    expect(result.status).toBe('pending');
    if (result.status === 'pending') {
      expect(result.reason).toMatch(/MT-11/);
    }
  });

  it('reports pending when the sample has zero variance (undefined Spearman)', () => {
    const result = computeCalibration([
      { id: 'a', humanScore: 4, judgeScore: 4 },
      { id: 'b', humanScore: 4, judgeScore: 5 },
    ]);
    expect(result.status).toBe('pending');
  });

  it('reports a trusted result when judge and human scores correlate at or above 0.7', () => {
    const samples = [
      { id: 'a', humanScore: 5, judgeScore: 5 },
      { id: 'b', humanScore: 4, judgeScore: 4 },
      { id: 'c', humanScore: 3, judgeScore: 3 },
      { id: 'd', humanScore: 2, judgeScore: 2 },
      { id: 'e', humanScore: 1, judgeScore: 1 },
    ];
    const result = computeCalibration(samples);
    expect(result.status).toBe('complete');
    if (result.status === 'complete') {
      expect(result.spearman).toBeCloseTo(1, 5);
      expect(result.trusted).toBe(true);
      expect(result.n).toBe(5);
    }
  });

  it('reports an untrusted result — "the thresholds are raised rather than trusted" — below 0.7', () => {
    const samples = [
      { id: 'a', humanScore: 5, judgeScore: 1 },
      { id: 'b', humanScore: 4, judgeScore: 5 },
      { id: 'c', humanScore: 3, judgeScore: 2 },
      { id: 'd', humanScore: 2, judgeScore: 4 },
      { id: 'e', humanScore: 1, judgeScore: 3 },
    ];
    const result = computeCalibration(samples);
    expect(result.status).toBe('complete');
    if (result.status === 'complete') {
      expect(result.trusted).toBe(false);
    }
  });
});
