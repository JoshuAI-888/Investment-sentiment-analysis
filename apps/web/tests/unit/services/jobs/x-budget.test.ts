import { describe, expect, it } from 'vitest';
import { checkXReadBudget } from '../../../../src/services/jobs/x-budget';

describe('checkXReadBudget — D-32', () => {
  it('refuses every positive read request — the ceiling starts at zero', () => {
    expect(checkXReadBudget(1).allowed).toBe(false);
    expect(checkXReadBudget(100).allowed).toBe(false);
    expect(checkXReadBudget(1_000_000).allowed).toBe(false);
  });

  it('names the D-32 reason on refusal', () => {
    const result = checkXReadBudget(100);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toMatch(/D-32/);
    }
  });

  it('rejects a non-positive request as a caller error, not a budget answer', () => {
    expect(() => checkXReadBudget(0)).toThrow(RangeError);
    expect(() => checkXReadBudget(-1)).toThrow(RangeError);
  });
});
