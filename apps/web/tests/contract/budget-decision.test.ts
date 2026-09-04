import { describe, expect, it } from 'vitest';
import { budgetDecision, budgetThresholds, evaluateBudgetPolicy } from '../../src/services/budget/policy';

const THRESHOLDS = { warnUsd: '290.00', reduceUsd: '320.00', hardUsd: '350.00' };

describe('budgetThresholds — F18 §3 produced contract', () => {
  it('parses D-32\'s real figures', () => {
    expect(() => budgetThresholds.parse(THRESHOLDS)).not.toThrow();
  });

  it('rejects a non-decimal-string threshold value', () => {
    expect(() => budgetThresholds.parse({ ...THRESHOLDS, hardUsd: '350.00.1' })).toThrow();
    expect(() => budgetThresholds.parse({ ...THRESHOLDS, hardUsd: 'three-fifty' })).toThrow();
  });
});

describe('budgetDecision — F18 §3 produced contract', () => {
  it('parses a real decision produced by evaluateBudgetPolicy, at every tier', () => {
    for (const spentUsd of ['0', '290', '320', '350']) {
      const decision = evaluateBudgetPolicy(spentUsd, THRESHOLDS, new Date('2026-09-06T00:00:00.000Z'));
      expect(() => budgetDecision.parse(decision)).not.toThrow();
    }
  });

  it('rejects a tier outside the four D-32 defines', () => {
    expect(() =>
      budgetDecision.parse({
        tier: 'critical',
        spentUsd: '0',
        thresholds: THRESHOLDS,
        asOf: '2026-09-06T00:00:00.000Z',
      }),
    ).toThrow();
  });

  it('rejects a non-ISO asOf timestamp', () => {
    expect(() =>
      budgetDecision.parse({ tier: 'ok', spentUsd: '0', thresholds: THRESHOLDS, asOf: 'yesterday' }),
    ).toThrow();
  });

  it('the canonical spentUsd form round-trips through the schema (exact(), no trailing zeros)', () => {
    const decision = evaluateBudgetPolicy('320.00', THRESHOLDS, new Date('2026-09-06T00:00:00.000Z'));
    const parsed = budgetDecision.parse(decision);
    expect(parsed.spentUsd).toBe('320');
  });
});
