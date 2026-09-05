import { describe, expect, it } from 'vitest';
import { spearmanCorrelation } from '../../../../src/services/eval/spearman';

describe('spearmanCorrelation', () => {
  it('returns 1 for a perfectly monotonic increasing pair', () => {
    expect(spearmanCorrelation([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])).toBeCloseTo(1, 10);
  });

  it('returns -1 for a perfectly monotonic decreasing pair', () => {
    expect(spearmanCorrelation([1, 2, 3, 4, 5], [10, 8, 6, 4, 2])).toBeCloseTo(-1, 10);
  });

  it('handles ties with fractional (average) ranks', () => {
    // Worked by hand in the module's own comment derivation: two tied 1s share rank 1.5.
    const rho = spearmanCorrelation([1, 1, 2, 3], [1, 2, 3, 4]);
    expect(rho).toBeCloseTo(0.9487, 4);
  });

  it('returns null when one series has zero variance (undefined correlation)', () => {
    expect(spearmanCorrelation([1, 1, 1, 1], [1, 2, 3, 4])).toBeNull();
  });

  it('returns null for fewer than two observations', () => {
    expect(spearmanCorrelation([1], [2])).toBeNull();
    expect(spearmanCorrelation([], [])).toBeNull();
  });

  it('throws when series lengths differ — every human score must pair with exactly one judge score', () => {
    expect(() => spearmanCorrelation([1, 2, 3], [1, 2])).toThrow(/lengths differ/);
  });
});
