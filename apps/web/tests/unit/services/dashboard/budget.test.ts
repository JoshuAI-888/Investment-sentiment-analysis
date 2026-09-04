import { describe, expect, it } from 'vitest';
import type { Queryable } from '../../../../src/repositories/client';
import { checkGlobalBudget, GLOBAL_BUDGET_CEILING_USD } from '../../../../src/services/dashboard/budget';

function fakeDb(totalUsd: string): Queryable {
  return {
    query: async () =>
      ({
        rows: [{ total: totalUsd, unpriced: '0', priced: '1' }],
      }) as never,
  };
}

describe('checkGlobalBudget', () => {
  it('allows a refresh when this month is well under the ceiling', async () => {
    const result = await checkGlobalBudget(new Date('2026-08-15T00:00:00.000Z'), fakeDb('10'));
    expect(result.allowed).toBe(true);
  });

  it('refuses once spend reaches the ceiling, and names both figures', async () => {
    const result = await checkGlobalBudget(new Date('2026-08-15T00:00:00.000Z'), fakeDb(GLOBAL_BUDGET_CEILING_USD));
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.message).toContain(GLOBAL_BUDGET_CEILING_USD);
      expect(result.message).toContain('global ceiling');
    }
  });

  it('refuses when spend has already exceeded the ceiling', async () => {
    const result = await checkGlobalBudget(new Date('2026-08-15T00:00:00.000Z'), fakeDb('999'));
    expect(result.allowed).toBe(false);
  });

  it('respects a caller-supplied ceiling, for a test that does not want to hardcode D-20', async () => {
    const result = await checkGlobalBudget(new Date('2026-08-15T00:00:00.000Z'), fakeDb('50'), '40');
    expect(result.allowed).toBe(false);
  });
});
