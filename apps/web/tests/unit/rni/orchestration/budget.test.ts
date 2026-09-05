import { describe, expect, it } from 'vitest';
import { assertRniAggregateBudget, estimateRniRefreshBudget } from '@/rni/orchestration/budget';
import { harness, planFixture, scope } from './fixture';

describe('RNI run and aggregate budget preflight', () => {
  it('prices the complete platform call ceilings from the selected task envelopes using exact decimal arithmetic', () => {
    expect(estimateRniRefreshBudget(planFixture())).toEqual({
      redditUsd: '0.45',
      xUsd: '0.3',
      totalUsd: '0.75',
      runLimitUsd: '2',
    });
  });

  it('permits exactly USD 2 and rejects the next decimal at the ticker boundary', () => {
    const plan = planFixture();
    plan.calls.reddit.rni_discovery = 0;
    plan.calls.x.rni_classifier = 20;
    expect(estimateRniRefreshBudget(plan).totalUsd).toBe('2');
    plan.calls.x.rni_classifier = 21;
    expect(() => estimateRniRefreshBudget(plan)).toThrow('BUDGET_RUN');
  });

  it('uses USD 25 for full-universe work and honors a narrower configured ceiling', () => {
    const plan = planFixture();
    plan.scopePreview = { kind: 'full_universe', universeVersion: '1', securityCount: 501 };
    plan.maxCostUsd = '25';
    plan.calls.reddit.rni_discovery = 0;
    plan.calls.x.rni_classifier = 250;
    expect(estimateRniRefreshBudget(plan).totalUsd).toBe('25');
    plan.maxCostUsd = '24.99';
    expect(() => estimateRniRefreshBudget(plan)).toThrow('BUDGET_RUN');
  });

  it('permits exact 50/500 boundaries and flags the USD 300 warning without changing a hard cap', () => {
    expect(
      assertRniAggregateBudget('0.75', { rollingDayUsd: '49.25', calendarMonthUsd: '499.25' })
        .monthlyWarning,
    ).toBe(true);
    expect(
      assertRniAggregateBudget('0.75', { rollingDayUsd: '0', calendarMonthUsd: '299.25' })
        .monthlyWarning,
    ).toBe(true);
    expect(() =>
      assertRniAggregateBudget('0.750000000001', { rollingDayUsd: '49.25', calendarMonthUsd: '0' }),
    ).toThrow('BUDGET_DAY');
    expect(() =>
      assertRniAggregateBudget('0.750000000001', {
        rollingDayUsd: '0',
        calendarMonthUsd: '499.25',
      }),
    ).toThrow('BUDGET_MONTH');
  });

  it('serializes competing different-scope admissions against aggregate headroom', async () => {
    const h = harness();
    h.store.usage.rollingDayUsd = '49';
    const results = await Promise.allSettled([
      h.service.requestManualRefresh({ idempotencyKey: 'a', scope }),
      h.service.requestManualRefresh({
        idempotencyKey: 'b',
        scope: { kind: 'ticker', ticker: 'AMD' },
      }),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(h.store.data.admissions.size).toBe(1);
    expect(h.store.data.jobs).toHaveLength(1);
  });

  it('does not reserve again on exact replay or coalescing', async () => {
    const h = harness();
    h.store.usage.rollingDayUsd = '49.25';
    const a = await h.service.requestManualRefresh({ idempotencyKey: 'a', scope });
    expect((await h.service.requestManualRefresh({ idempotencyKey: 'a', scope })).runId).toBe(
      a.runId,
    );
    expect((await h.service.requestManualRefresh({ idempotencyKey: 'b', scope })).runId).toBe(
      a.runId,
    );
    expect(h.store.data.admissions.size).toBe(1);
  });

  it.each(['rollingDayUsd', 'calendarMonthUsd'] as const)(
    'fails before jobs/outbox writes when %s is exhausted',
    async (field) => {
      const h = harness();
      h.store.usage[field] = field === 'rollingDayUsd' ? '50' : '500';
      await expect(h.service.requestManualRefresh({ idempotencyKey: 'a', scope })).rejects.toThrow(
        'BUDGET',
      );
      expect(h.store.data.jobs).toHaveLength(0);
      expect(h.store.data.outbox.size).toBe(0);
      expect(h.store.data.commands.size).toBe(0);
    },
  );

  it('rejects missing, crossed or invalid task envelopes and accidental X Web Search plans', () => {
    const missing = planFixture();
    missing.envelopes.pop();
    const duplicate = planFixture();
    duplicate.envelopes[0] = duplicate.envelopes[1]!;
    const crossed = planFixture();
    crossed.envelopes[0]!.maxInputTokensReserved = 1234;
    const xDiscovery = planFixture();
    xDiscovery.calls.x.rni_discovery = 1;
    for (const plan of [missing, duplicate, crossed, xDiscovery])
      expect(() => estimateRniRefreshBudget(plan)).toThrow();
  });
});
