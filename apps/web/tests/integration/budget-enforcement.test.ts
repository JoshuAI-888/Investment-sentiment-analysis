import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import { closePool, getPool } from '../../src/repositories/client';
import { insertCostEvent, spendInWindow } from '../../src/repositories/cost';
import { costBreakdownInWindow } from '../../src/repositories/cost-breakdown';
import { getGlobalBudgetDecision, budgetGateFor, resolveBudgetThresholds } from '../../src/services/budget/policy';
import { checkGlobalBudget } from '../../src/services/dashboard/budget';
import { getCostLedgerView } from '../../src/services/admin/reads';
import { marketauxWrapperDeps } from '../../src/services/dashboard/provider-deps';
import { callProvider } from '../../src/adapters/wrapper';

const url = databaseUrl();

/**
 * F18 §5 integration test plan: "a denied call never reaches the network; the ledger derives
 * from events and matches a hand-computed total; $90 reduce stops optional work while core paths
 * continue; $100 leaves cached reads and admin working" — D-32's real figures ($290/$320/$350)
 * throughout, per this feature's own report on the threshold-figure discrepancy.
 */
describe.skipIf(url === undefined)('F18 — budget enforcement, end to end against real Postgres', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
    getPool(url);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
  });

  afterAll(async () => {
    await closePool();
    await pool?.end();
  });

  const NOW = new Date('2026-09-06T12:00:00.000Z');

  async function spend(amountUsd: string): Promise<void> {
    await insertCostEvent(
      {
        occurredAt: NOW,
        provider: 'fmp',
        service: 'e2e_test',
        operationOrModel: 'test',
        feature: 'f18.integration_test',
        jobRunId: null,
        researchRunId: null,
        userId: null,
        requestId: randomUUID(),
        unitType: 'call',
        requestUnits: '1',
        billableUnits: '1',
        unitPrice: amountUsd,
        currency: 'USD',
        priceBookVersion: null,
        costUsd: amountUsd,
        costStatus: 'actual',
        cacheStatus: 'miss',
        metadata: {},
      },
      pool,
    );
  }

  it('the ledger derives from cost_event and matches a hand-computed total at every tier', async () => {
    await spend('100.00');
    await spend('90.00');
    await spend('130.00'); // 100 + 90 + 130 = 320.00 — the reduce tier, exactly

    const { from, to } = { from: new Date(Date.UTC(2026, 8, 1)), to: new Date(Date.UTC(2026, 9, 1)) };
    const { totalUsd } = await spendInWindow(from, to, pool);
    expect(totalUsd).toBe('320.00');

    const decision = await getGlobalBudgetDecision(NOW, pool);
    expect(decision.tier).toBe('reduce');
    expect(decision.spentUsd).toBe('320'); // canonical form

    // The ledger's own breakdown must sum to the same figure enforcement just used — two reads
    // of the same `cost_event` table (F18 §2 Out: reuses F15's ledger view, never a second one).
    const breakdown = await costBreakdownInWindow(from, to, pool);
    const breakdownTotal = breakdown.reduce((sum, row) => sum + Number(row.pricedUsd), 0);
    expect(breakdownTotal).toBeCloseTo(320, 2);
  });

  it('$290 warn: an admin alert tier, no behaviour change — optional and noncritical work both still allowed', async () => {
    await spend('290.00');
    const decision = await getGlobalBudgetDecision(NOW, pool);
    expect(decision.tier).toBe('warn');

    const optional = await budgetGateFor('optional', pool).check({ estimatedCostUsd: null });
    expect(optional.allowed).toBe(true);
    const noncritical = await budgetGateFor('noncritical', pool).check({ estimatedCostUsd: null });
    expect(noncritical.allowed).toBe(true);
  });

  it('$320 reduce: optional work stops; noncritical (and core) work continues', async () => {
    await spend('320.00');
    const decision = await getGlobalBudgetDecision(NOW, pool);
    expect(decision.tier).toBe('reduce');

    const optional = await budgetGateFor('optional', pool).check({ estimatedCostUsd: null });
    expect(optional.allowed).toBe(false);
    if (!optional.allowed) expect(optional.scope).toBe('global');

    const noncritical = await budgetGateFor('noncritical', pool).check({ estimatedCostUsd: null });
    expect(noncritical.allowed).toBe(true);
  });

  it('$350 hard: all noncritical paid work refused, but cached reads, the ledger and the admin plane keep working', async () => {
    await spend('350.00');
    const decision = await getGlobalBudgetDecision(NOW, pool);
    expect(decision.tier).toBe('block');

    const optional = await budgetGateFor('optional', pool).check({ estimatedCostUsd: null });
    expect(optional.allowed).toBe(false);
    const noncritical = await budgetGateFor('noncritical', pool).check({ estimatedCostUsd: null });
    expect(noncritical.allowed).toBe(false);

    // "the dashboard, stored artifacts and the admin plane all keep working" (F18 §4.1) — the
    // ledger *view* (F15, §2 Out) must still render correctly at exactly the ceiling, never
    // throw, and never silently show $0.00 for what is actually $350 spent.
    const { from, to } = { from: new Date(Date.UTC(2026, 8, 1)), to: new Date(Date.UTC(2026, 9, 1)) };
    const ledger = await getCostLedgerView(from, to);
    expect(ledger.totals.totalUsd).toBe('350.00');
    expect(ledger.totals.totalUsd).not.toBe('0.00');

    // The dashboard refresh's own hard-block gate (`checkGlobalBudget`, live-resolved ceiling)
    // must also refuse at this exact figure — the same tier, read two different ways, must never
    // disagree.
    const { hardUsd } = await resolveBudgetThresholds(pool);
    const refresh = await checkGlobalBudget(NOW, pool, hardUsd);
    expect(refresh.allowed).toBe(false);
  });

  // Marketaux (`dashboard/provider-deps.ts`), not ApeWisdom: this feature's self-review found
  // that ApeWisdom is, today, F08's only running attention *collector* (`attention/
  // collector.ts`) rather than a discretionary cross-check — D-39 dropped the Reddit Data API
  // path the D-12/D-30 "demoted cross-check" ruling assumed — so it is never budget-gated
  // (`attention/provider-deps.ts`'s own corrected doc comment), matching the market-data poll's
  // gate for the identical D-16 corpus-loss reason. Marketaux news enrichment is the real
  // `'optional'`-classified path this feature wired.
  it('a denied call never reaches the network — the fetcher is never invoked', async () => {
    await spend('350.00'); // hard block

    let fetcherCalled = false;
    const deps = marketauxWrapperDeps({ db: pool });
    const result = await callProvider(
      {
        provider: 'marketaux',
        operation: 'news',
        schema: z.object({}).passthrough(),
        request: { url: 'https://marketaux.example/news' },
      },
      {
        ...deps,
        fetcher: async () => {
          fetcherCalled = true;
          throw new Error('the fetcher must never be called for a budget-denied request');
        },
      },
    );

    expect(fetcherCalled).toBe(false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('budget_denied');
      if (result.error.kind === 'budget_denied') expect(result.error.scope).toBe('global');
    }
  });

  it('the same call succeeds and reaches the fetcher when spend is well under every threshold', async () => {
    await spend('5.00');

    let fetcherCalled = false;
    const deps = marketauxWrapperDeps({ db: pool });
    const result = await callProvider(
      {
        provider: 'marketaux',
        operation: 'news',
        schema: z.object({ ok: z.literal(true) }),
        request: { url: 'https://marketaux.example/news' },
      },
      {
        ...deps,
        fetcher: async () => {
          fetcherCalled = true;
          return { status: 200, headers: {}, body: { ok: true } };
        },
      },
    );

    expect(fetcherCalled).toBe(true);
    expect(result.ok).toBe(true);
  });
});
