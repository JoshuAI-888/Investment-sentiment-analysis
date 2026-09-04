import { describe, expect, it } from 'vitest';
import {
  checkXReadBudget,
  X_DAILY_READ_CEILING,
  X_MONTHLY_READ_CEILING,
  X_READS_PER_TRIGGER_EVENT,
} from '../../../../src/services/jobs/x-budget';

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

  // F18 — the real ceiling values, sourced from the same catalogue F15 seeded
  // (`settings-catalogue.ts`), not a fourth independently-declared set of numbers.
  describe('the named D-32 ceiling constants', () => {
    it('match the settings-catalogue defaults exactly', () => {
      expect(X_MONTHLY_READ_CEILING).toBe(0);
      expect(X_DAILY_READ_CEILING).toBe(0);
      expect(X_READS_PER_TRIGGER_EVENT).toBe(100);
    });
  });

  describe('real, general ceiling logic — not a bare refusal', () => {
    it('refuses at the per-event ceiling independent of monthly/daily usage', () => {
      const result = checkXReadBudget(X_READS_PER_TRIGGER_EVENT + 1);
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toContain('read-per-trigger-event ceiling');
    });

    it('a request within the per-event ceiling still refuses on the (zero) daily ceiling next', () => {
      const result = checkXReadBudget(X_READS_PER_TRIGGER_EVENT);
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toContain('daily ceiling');
    });

    it('injected usage changes the arithmetic even though the outcome stays "refused" under D-32', () => {
      // Ceilings are 0 today, so any positive `dailyReadsConsumed` still overshoots — this
      // proves the comparison is real arithmetic (0 + N > 0), not a hardcoded `false`, by
      // checking the *reason* names the injected consumption figure.
      const result = checkXReadBudget(10, { dailyReadsConsumed: 5, monthlyReadsConsumed: 200 });
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toContain('5 already spent today');
    });

    it('defaults injected usage to zero — the most permissive assumption, not the least', () => {
      const withDefault = checkXReadBudget(10);
      const withExplicitZero = checkXReadBudget(10, { monthlyReadsConsumed: 0, dailyReadsConsumed: 0 });
      expect(withDefault).toEqual(withExplicitZero);
    });
  });
});
