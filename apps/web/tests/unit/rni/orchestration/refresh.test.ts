import { describe, expect, it } from 'vitest';
import { RniRefreshService } from '@/rni/orchestration/refresh';
import { harness, scope, START, uuid } from './fixture';

describe('RNI durable refresh command primitives', () => {
  it('atomically accepts one run, two platform deliveries and one normal job under eight concurrent exact requests', async () => {
    const h = harness();
    const replies = await Promise.all(
      Array.from({ length: 8 }, () =>
        h.service.requestManualRefresh({ idempotencyKey: 'double-click', scope }),
      ),
    );
    expect(replies.filter((reply) => reply.disposition === 'accepted')).toHaveLength(1);
    expect(new Set(replies.map((reply) => reply.runId)).size).toBe(1);
    expect(h.store.data.jobs).toHaveLength(1);
    expect(h.store.data.executions.size).toBe(1);
    expect(h.store.data.outbox.size).toBe(2);
    expect(h.store.data.admissions.size).toBe(1);
    expect(h.store.planReads).toBe(1);
    const record = h.record(replies[0]!.runId);
    expect(record.platforms.reddit.slice.platform).toBe('reddit');
    expect(record.platforms.x.slice.platform).toBe('x');
    expect(record.platforms.x.slice.id).not.toBe(record.platforms.reddit.slice.id);
    expect(h.store.data.audits.map((event) => event.event)).toEqual(['accepted']);
  });

  it('replays the original durable identity and snapshot after service reconstruction and configuration activation', async () => {
    const h = harness();
    const first = await h.service.requestManualRefresh({ idempotencyKey: 'persisted-key', scope });
    const original = h.record(first.runId);
    h.store.activePlan.configVersion = '2';
    h.store.activePlan.aiRoute = 'vercel_ai_gateway';
    h.store.activePlan.envelopes[0]!.maxInputBytes = 12_000;
    h.store.activePlan.envelopes[0]!.maxInputTokensReserved = 12_000;
    h.store.activePlan.envelopes[0]!.maxCostUsd = '0.12';
    h.advance(6000);
    const recreated = new RniRefreshService(h.deps);
    const replay = await recreated.requestManualRefresh({ idempotencyKey: 'persisted-key', scope });
    expect(replay).toEqual({ ...first, disposition: 'duplicate' });
    const later = await recreated.requestManualRefresh({ idempotencyKey: 'new-intent', scope });
    expect(h.record(later.runId).plan.configVersion).toBe('2');
    expect(h.record(later.runId).plan.aiRoute).toBe('vercel_ai_gateway');
    expect(h.record(later.runId).plan.envelopes[0]!.maxInputBytes).toBe(12_000);
    expect(h.record(later.runId).reservedCostUsd).toBe('0.66');
    expect(h.record(first.runId)).toEqual(original);
    expect(h.store.planReads).toBe(2);
  });

  it('rejects a crossed same key and rejects manual-to-rerun key reuse', async () => {
    const h = harness();
    const first = await h.service.requestManualRefresh({ idempotencyKey: 'same', scope });
    await expect(
      h.service.requestManualRefresh({
        idempotencyKey: 'same',
        scope: { kind: 'ticker', ticker: 'AMD' },
      }),
    ).rejects.toThrow('CONFLICT');
    await expect(h.service.rerun({ idempotencyKey: 'same', runId: first.runId })).rejects.toThrow(
      'CONFLICT',
    );
    expect(h.store.data.jobs).toHaveLength(1);
  });

  it('coalesces different rapid-click keys but permits intentional work after the bounded interval', async () => {
    const h = harness();
    const replies = await Promise.all(
      ['a', 'b'].map((idempotencyKey) => h.service.requestManualRefresh({ idempotencyKey, scope })),
    );
    expect(replies[0]!.runId).toBe(replies[1]!.runId);
    expect(replies.map((reply) => reply.disposition)).toEqual(['accepted', 'duplicate']);
    expect(h.store.data.commands.size).toBe(2);
    h.advance(5000);
    const next = await h.service.requestManualRefresh({ idempotencyKey: 'c', scope });
    expect(next.runId).not.toBe(replies[0]!.runId);
    expect((await h.service.requestManualRefresh({ idempotencyKey: 'b', scope })).runId).toBe(
      replies[0]!.runId,
    );
  });

  it('does not coalesce ticker and full-universe work or changed configuration', async () => {
    const h = harness();
    const a = await h.service.requestManualRefresh({ idempotencyKey: 'a', scope });
    const b = await h.service.requestManualRefresh({
      idempotencyKey: 'b',
      scope: { kind: 'full_universe' },
    });
    h.store.activePlan.configVersion = '2';
    const c = await h.service.requestManualRefresh({ idempotencyKey: 'c', scope });
    expect(new Set([a.runId, b.runId, c.runId]).size).toBe(3);
    expect(b.scopePreview).toEqual({
      kind: 'full_universe',
      universeVersion: '1',
      securityCount: 501,
    });
  });

  it.each(['failEnqueue', 'failAudit'] as const)(
    'rolls back command, budget admission, job, run, schedule and deliveries after %s',
    async (failure) => {
      const h = harness();
      h.store[failure] = true;
      await expect(h.service.schedule({ jobId: uuid(800), dueAt: START })).rejects.toThrow(
        'simulated',
      );
      expect(h.store.data.commands.size).toBe(0);
      expect(h.store.data.executions.size).toBe(0);
      expect(h.store.data.jobs).toHaveLength(0);
      expect(h.store.data.admissions.size).toBe(0);
      expect(h.store.data.outbox.size).toBe(0);
      expect(h.store.data.definition.nextDueAt.toISOString()).toBe(START);
      h.store[failure] = false;
      expect((await h.service.schedule({ jobId: uuid(800), dueAt: START })).disposition).toBe(
        'accepted',
      );
    },
  );

  it('validates role before reading a replay or any storage', async () => {
    const h = harness();
    h.deps.authorize = async () => {
      throw new Error('FORBIDDEN');
    };
    await expect(h.service.requestManualRefresh({ idempotencyKey: 'a', scope })).rejects.toThrow(
      'FORBIDDEN',
    );
    expect(h.store.transactions).toBe(0);
  });

  it('rejects client configuration/window fields and oversized keys before storage', async () => {
    const h = harness();
    await expect(
      h.service.requestManualRefresh({ idempotencyKey: 'a', scope, configVersion: '2' } as never),
    ).rejects.toThrow();
    await expect(
      h.service.requestManualRefresh({ idempotencyKey: 'a'.repeat(201), scope }),
    ).rejects.toThrow();
    expect(h.store.transactions).toBe(0);
  });

  it('rejects a crossed job identity and a corrupted persisted plan before any new dispatch', async () => {
    const h = harness();
    h.store.crossedJob = true;
    await expect(h.service.requestManualRefresh({ idempotencyKey: 'a', scope })).rejects.toThrow(
      'CONFLICT',
    );
    expect(h.store.data.jobs).toHaveLength(0);
    h.store.crossedJob = false;
    const first = await h.service.requestManualRefresh({ idempotencyKey: 'a', scope });
    h.store.data.executions.get(first.runId)!.plan.configVersion = '999';
    await expect(h.service.requestManualRefresh({ idempotencyKey: 'a', scope })).rejects.toThrow(
      'CONFLICT',
    );
    expect(h.store.data.outbox.size).toBe(2);
  });

  it('rejects cross-partition guessed run identities', async () => {
    const h = harness();
    const first = await h.service.requestManualRefresh({ idempotencyKey: 'a', scope });
    const crossed = new RniRefreshService({ ...h.deps, partition: 'other' });
    await expect(crossed.rerun({ idempotencyKey: 'b', runId: first.runId })).rejects.toThrow(
      'CONFLICT',
    );
  });

  it('skips a due schedule while Run now is active, then replays that skip after advancement', async () => {
    const h = harness();
    const manual = await h.service.requestManualRefresh({ idempotencyKey: 'run-now', scope });
    const results = await Promise.all(
      Array.from({ length: 3 }, () => h.service.schedule({ jobId: uuid(800), dueAt: START })),
    );
    expect(results.every((result) => result.disposition === 'skipped')).toBe(true);
    expect(h.store.data.executions.has(manual.runId)).toBe(true);
    expect(h.store.planReads).toBe(1);
    expect(h.store.data.audits.filter((event) => event.event === 'schedule_skipped')).toHaveLength(
      1,
    );
    expect(h.store.data.jobs).toHaveLength(1);
    expect(h.store.data.definition.nextDueAt.toISOString()).toBe('2026-09-05T00:05:00.000Z');
    expect(h.store.data.definition.version).toBe(2);
    expect(h.store.data.outbox.size).toBe(2);
  });

  it('a scheduled execution uses the common path, advances once and does not catch up missed fires', async () => {
    const h = harness();
    h.advance(3600_000);
    const first = await h.service.schedule({ jobId: uuid(800), dueAt: START });
    if (first.disposition === 'skipped') throw new Error('unexpected skip');
    const record = h.record(first.runId);
    expect(record.run.trigger).toBe('schedule');
    expect(h.store.data.jobs[0]!.triggerType).toBe('scheduled');
    expect(h.store.data.definition.nextDueAt.toISOString()).toBe('2026-09-05T01:05:00.000Z');
    expect(h.store.data.executions.size).toBe(1);
    await expect(
      h.service.schedule({ jobId: uuid(800), dueAt: '2026-09-05T01:05:00.000Z' }),
    ).rejects.toThrow('NOT_DUE');
    await expect(
      h.service.schedule({ jobId: uuid(800), dueAt: '2026-09-05T00:05:00.000Z' }),
    ).rejects.toThrow('NOT_DUE');
  });

  it('atomically records and replays a busy skip after rapid-click coalescing has expired', async () => {
    const h = harness();
    await h.service.requestManualRefresh({ idempotencyKey: 'manual', scope });
    h.advance(6000);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => h.service.schedule({ jobId: uuid(800), dueAt: START })),
    );
    expect(results.every((result) => result.disposition === 'skipped')).toBe(true);
    expect(new Set(results.map((result) => JSON.stringify(result))).size).toBe(1);
    expect(h.store.data.jobs).toHaveLength(1);
    expect(h.store.data.outbox.size).toBe(2);
    expect(h.store.data.admissions.size).toBe(1);
    expect(h.store.data.definition.nextDueAt.toISOString()).toBe('2026-09-05T00:05:06.000Z');
    expect(h.store.data.definition.version).toBe(2);
    expect(h.store.data.audits.filter((event) => event.event === 'schedule_skipped')).toHaveLength(
      1,
    );
    expect(h.store.data.commands.size).toBe(2);
  });

  it('rolls back busy skip, audit and advancement together, then succeeds once on replay', async () => {
    const h = harness();
    await h.service.requestManualRefresh({ idempotencyKey: 'manual', scope });
    h.advance(6000);
    h.store.failAudit = true;
    await expect(h.service.schedule({ jobId: uuid(800), dueAt: START })).rejects.toThrow(
      'simulated audit',
    );
    expect(h.store.data.definition.nextDueAt.toISOString()).toBe(START);
    expect(h.store.data.commands.size).toBe(1);
    h.store.failAudit = false;
    expect((await h.service.schedule({ jobId: uuid(800), dueAt: START })).disposition).toBe(
      'skipped',
    );
  });

  it.each(['invalid', 'unavailable'] as const)(
    'skips a locked busy job without resolving its %s active plan',
    async (mode) => {
      const h = harness();
      await h.service.requestManualRefresh({ idempotencyKey: 'manual', scope });
      h.advance(6000);
      if (mode === 'invalid') h.store.activePlan.maxAttempts = 99;
      else h.store.failPlanResolution = true;
      const beforePlanReads = h.store.planReads;
      const requests = await Promise.all(
        Array.from({ length: 3 }, () => h.service.schedule({ jobId: uuid(800), dueAt: START })),
      );
      expect(requests.every((result) => result.disposition === 'skipped')).toBe(true);
      expect(new Set(requests.map((result) => JSON.stringify(result))).size).toBe(1);
      expect(h.store.planReads).toBe(beforePlanReads);
      expect(h.store.data.definition.nextDueAt.toISOString()).toBe('2026-09-05T00:05:06.000Z');
      expect(h.store.data.definition.version).toBe(2);
      expect(
        h.store.data.audits.filter((event) => event.event === 'schedule_skipped'),
      ).toHaveLength(1);
      expect(h.store.data.jobs).toHaveLength(1);
      expect(h.store.data.admissions.size).toBe(1);
      expect(h.store.data.outbox.size).toBe(2);
    },
  );
});
