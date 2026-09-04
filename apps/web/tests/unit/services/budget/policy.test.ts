import { describe, expect, it } from 'vitest';
import type { Queryable } from '../../../../src/repositories/client';
import {
  budgetGateFor,
  classifyBudgetTier,
  evaluateBudgetPolicy,
  getGlobalBudgetDecision,
  isWorkAllowed,
  resolveBudgetThresholds,
  type BudgetThresholds,
} from '../../../../src/services/budget/policy';

const THRESHOLDS: BudgetThresholds = { warnUsd: '290.00', reduceUsd: '320.00', hardUsd: '350.00' };

describe('classifyBudgetTier — D-32 threshold behaviour', () => {
  it('is "ok" comfortably under every threshold', () => {
    expect(classifyBudgetTier('10', THRESHOLDS)).toBe('ok');
  });

  it('is "ok" just below warn, "warn" exactly at warn', () => {
    expect(classifyBudgetTier('289.99', THRESHOLDS)).toBe('ok');
    expect(classifyBudgetTier('290.00', THRESHOLDS)).toBe('warn');
    expect(classifyBudgetTier('290', THRESHOLDS)).toBe('warn');
  });

  it('is "warn" just below reduce, "reduce" exactly at reduce', () => {
    expect(classifyBudgetTier('319.99', THRESHOLDS)).toBe('warn');
    expect(classifyBudgetTier('320.00', THRESHOLDS)).toBe('reduce');
  });

  it('is "reduce" just below hard, "block" exactly at hard and beyond', () => {
    expect(classifyBudgetTier('349.99', THRESHOLDS)).toBe('reduce');
    expect(classifyBudgetTier('350.00', THRESHOLDS)).toBe('block');
    expect(classifyBudgetTier('999999.99', THRESHOLDS)).toBe('block');
  });

  it('is decimal-safe at the exact float/decimal disagreement point (F07 review finding precedent)', () => {
    // '319.99999999999999999999' >= '320' is false in decimal, and `Number()` cannot even
    // represent the difference — this is the case a raw JS number comparison gets wrong.
    expect(classifyBudgetTier('319.99999999999999999999', THRESHOLDS)).toBe('warn');
    expect(classifyBudgetTier('320.00000000000000000001', THRESHOLDS)).toBe('reduce');
  });
});

describe('evaluateBudgetPolicy', () => {
  it('returns a BudgetDecision carrying the tier, canonical spend, thresholds and timestamp', () => {
    const now = new Date('2026-09-06T12:00:00.000Z');
    const decision = evaluateBudgetPolicy('320.00', THRESHOLDS, now);
    expect(decision.tier).toBe('reduce');
    expect(decision.spentUsd).toBe('320'); // canonical (exact()) form, no trailing zeros
    expect(decision.thresholds).toEqual(THRESHOLDS);
    expect(decision.asOf).toBe(now.toISOString());
  });
});

describe('isWorkAllowed', () => {
  const at = (tier: 'ok' | 'warn' | 'reduce' | 'block') =>
    evaluateBudgetPolicy(
      tier === 'ok' ? '0' : tier === 'warn' ? '290' : tier === 'reduce' ? '320' : '350',
      THRESHOLDS,
    );

  it('"optional" work continues at ok/warn, stops at reduce and block', () => {
    expect(isWorkAllowed('optional', at('ok'))).toBe(true);
    expect(isWorkAllowed('optional', at('warn'))).toBe(true);
    expect(isWorkAllowed('optional', at('reduce'))).toBe(false);
    expect(isWorkAllowed('optional', at('block'))).toBe(false);
  });

  it('"noncritical" work continues through reduce, stops only at block', () => {
    expect(isWorkAllowed('noncritical', at('ok'))).toBe(true);
    expect(isWorkAllowed('noncritical', at('warn'))).toBe(true);
    expect(isWorkAllowed('noncritical', at('reduce'))).toBe(true);
    expect(isWorkAllowed('noncritical', at('block'))).toBe(false);
  });
});

// ── A fake `Queryable` distinguishing the two real queries this module issues ───────────────────
function fakeDb(options: { totalUsd: string; settings?: Partial<Record<string, string>> }): Queryable {
  return {
    query: async (sql: string, params?: readonly unknown[]) => {
      if (sql.includes('from cost_event')) {
        return { rows: [{ total: options.totalUsd, unpriced: '0', priced: '1' }] } as never;
      }
      if (sql.includes('from app_setting')) {
        const key = params?.[1] as string | undefined;
        const value = key === undefined ? undefined : options.settings?.[key];
        if (value === undefined) return { rows: [] } as never;
        return {
          rows: [
            {
              config_version: '1',
              setting_key: key,
              scope_type: 'global',
              scope_id: 'global',
              // Real jsonb columns arrive from `pg` already parsed to a JS value, never a JSON
              // string — matching that here, not `JSON.stringify`-ing it, is what makes this
              // fake a faithful stand-in for `insertAppSetting`'s own `JSON.stringify` (write
              // side only) round-tripping correctly.
              value,
              value_type: 'decimal',
              governance_class: 'budget',
              setting_schema_version: '1',
              method_affecting: false,
              sensitive: false,
            },
          ],
        } as never;
      }
      throw new Error(`fakeDb: unexpected query — ${sql}`);
    },
  };
}

describe('resolveBudgetThresholds', () => {
  it('falls back to the settings-catalogue default when no active config_version carries the key', async () => {
    const thresholds = await resolveBudgetThresholds(fakeDb({ totalUsd: '0' }));
    // Same figures F15 seeded (D-32) — never a fourth, independently-invented set of numbers.
    expect(thresholds).toEqual({ warnUsd: '290.00', reduceUsd: '320.00', hardUsd: '350.00' });
  });

  it('prefers a live, operator-set value over the catalogue default', async () => {
    const thresholds = await resolveBudgetThresholds(
      fakeDb({ totalUsd: '0', settings: { 'budget.hard_usd': '400.00' } }),
    );
    expect(thresholds.hardUsd).toBe('400.00');
    // The other two keys were not overridden — still the catalogue default.
    expect(thresholds.warnUsd).toBe('290.00');
  });
});

describe('getGlobalBudgetDecision', () => {
  it('reads this month\'s spend and the live thresholds together into one decision', async () => {
    const decision = await getGlobalBudgetDecision(new Date('2026-09-06T00:00:00.000Z'), fakeDb({ totalUsd: '320' }));
    expect(decision.tier).toBe('reduce');
    expect(decision.spentUsd).toBe('320');
  });
});

describe('budgetGateFor — the real BudgetGate F04\'s wrapper stage 1 calls', () => {
  it('allows an "optional" gate when spend is under reduce', async () => {
    const gate = budgetGateFor('optional', fakeDb({ totalUsd: '10' }));
    const result = await gate.check({ estimatedCostUsd: null });
    expect(result.allowed).toBe(true);
  });

  it('refuses an "optional" gate at reduce, with scope "global"', async () => {
    const gate = budgetGateFor('optional', fakeDb({ totalUsd: '320' }));
    const result = await gate.check({ estimatedCostUsd: null });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.scope).toBe('global');
  });

  it('a "noncritical" gate still allows at reduce, refuses only at block', async () => {
    const atReduce = await budgetGateFor('noncritical', fakeDb({ totalUsd: '320' })).check({ estimatedCostUsd: null });
    expect(atReduce.allowed).toBe(true);
    const atBlock = await budgetGateFor('noncritical', fakeDb({ totalUsd: '350' })).check({ estimatedCostUsd: null });
    expect(atBlock.allowed).toBe(false);
  });
});
