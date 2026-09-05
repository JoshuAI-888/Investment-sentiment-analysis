import { describe, expect, it } from 'vitest';
import {
  RniPlatformExecutionService,
  type RniExecutionLease,
  type RniPlatformOutcome,
} from '@/rni/orchestration/execution';
import { deliveryFor } from '@/rni/orchestration/refresh';
import type { RniCombinedArtifact } from '@/rni/orchestration/types';
import { harness, scope, START, uuid } from './fixture';

async function setup() {
  const h = harness();
  const result = await h.service.requestManualRefresh({ idempotencyKey: 'request', scope });
  return {
    ...h,
    runId: result.runId,
    delivery: h.record(result.runId).platforms.reddit.delivery,
    xDelivery: h.record(result.runId).platforms.x.delivery,
  };
}

async function acquired(
  h: Awaited<ReturnType<typeof setup>>,
  platform: 'reddit' | 'x' = 'reddit',
): Promise<RniExecutionLease> {
  const result = await h.worker.claim(h.record(h.runId).platforms[platform].delivery);
  if (result.status !== 'acquired') throw new Error('expected a lease');
  return result.lease;
}

const complete: RniPlatformOutcome = {
  status: 'complete',
  eligibleSourceCount: 2,
  dataThroughAt: START,
  computedAt: START,
};
const unavailable: RniPlatformOutcome = {
  status: 'unavailable',
  errorCode: 'PROVIDER_UNAVAILABLE',
};

async function publish(
  h: Awaited<ReturnType<typeof setup>>,
  status: RniCombinedArtifact['status'],
) {
  const claim = await h.combinedWorker.claim(h.record(h.runId).combined.delivery);
  if (claim.status !== 'acquired') throw new Error('expected combined lease');
  const artifact = {
    runId: h.runId,
    planHash: h.record(h.runId).planHash,
    artifactHash: 'a'.repeat(64),
    status,
  };
  await h.combinedWorker.commitPublication(claim.lease, artifact, (tx, _fence, value) =>
    h.store.publish(tx, value),
  );
  await h.combinedWorker.finish(claim.lease, artifact.artifactHash, async () => artifact);
  return { lease: claim.lease, artifact };
}

describe('RNI platform execution primitives', () => {
  it('gives one current lease under concurrent redelivery and preserves it across service reconstruction', async () => {
    const h = await setup();
    const results = await Promise.all(Array.from({ length: 8 }, () => h.worker.claim(h.delivery)));
    expect(results.filter((result) => result.status === 'acquired')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'busy')).toHaveLength(7);
    const recreated = new RniPlatformExecutionService(h.deps);
    expect((await recreated.claim(h.delivery)).status).toBe('busy');
    expect(h.record(h.runId).platforms.reddit.attempt).toBe(1);
    expect(h.record(h.runId).platforms.x.slice.status).toBe('pending');
  });

  it.each(['reddit', 'x'] as const)(
    'keeps %s failure independent while the other platform completes and combines only after both terminal',
    async (failed) => {
      const h = await setup();
      const success = failed === 'reddit' ? 'x' : 'reddit';
      await h.worker.finish(await acquired(h, success), complete);
      const saved = h.record(h.runId).platforms[success];
      expect(h.store.data.combined.size).toBe(0);
      await h.worker.finish(await acquired(h, failed), unavailable);
      const record = h.record(h.runId);
      expect(record.platforms[success]).toEqual(saved);
      expect(record.platforms[failed].slice.lastSuccessfulRefreshAt).toBeNull();
      expect(record.platforms[failed].slice.dataThroughAt).toBeNull();
      expect(record.platforms[failed].slice.lastAttemptAt).toBe(START);
      expect(record.combined.status).toBe('pending');
      expect(record.run.status).toBe('running');
      expect(h.store.data.combined.size).toBe(1);
      const { lease, artifact } = await publish(h, 'partial');
      expect(h.record(h.runId).run.status).toBe('partial');
      await h.combinedWorker.finish(lease, artifact.artifactHash, async () => artifact);
      await expect(
        h.combinedWorker.commitPublication(
          lease,
          { ...artifact, status: 'complete' },
          async () => artifact,
        ),
      ).rejects.toThrow('CONFLICT');
    },
  );

  it('replays a completed delivery without provider work, and rejects altered outcome or completion token', async () => {
    const h = await setup();
    const lease = await acquired(h);
    await h.worker.finish(lease, complete);
    expect((await h.worker.claim(h.delivery)).status).toBe('duplicate');
    expect(await h.worker.finish(lease, complete)).toBe('duplicate');
    await expect(h.worker.finish(lease, { ...complete, eligibleSourceCount: 3 })).rejects.toThrow(
      'CONFLICT',
    );
    await expect(h.worker.finish({ ...lease, token: uuid(999) }, complete)).rejects.toThrow(
      'CONFLICT',
    );
  });

  it('rejects crossed platform, key, config and run payloads before acquisition', async () => {
    const h = await setup();
    const inputs = [
      { ...h.delivery, platform: 'x' as const },
      { ...h.delivery, deliveryKey: 'crossed' },
      { ...h.delivery, planHash: 'b'.repeat(64) },
      { ...h.delivery, runId: uuid(999) },
      { ...h.delivery, attempt: 2 },
    ];
    for (const input of inputs) await expect(h.worker.claim(input)).rejects.toThrow();
    expect(h.record(h.runId).platforms.reddit.attempt).toBe(0);
  });

  it('rejects a crossed lease token without changing either platform', async () => {
    const h = await setup();
    const lease = await acquired(h);
    const before = h.record(h.runId);
    await expect(h.worker.finish({ ...lease, token: uuid(999) }, complete)).rejects.toThrow(
      'STALE_EXECUTION',
    );
    await expect(h.worker.heartbeat({ ...lease, token: uuid(999) })).rejects.toThrow(
      'STALE_EXECUTION',
    );
    expect(h.record(h.runId)).toEqual(before);
  });

  it('fences stale workers and terminalizes abandoned unknown outcomes without redispatching', async () => {
    const h = await setup();
    const lease = await acquired(h);
    h.advance(10_000);
    await expect(h.worker.finish(lease, complete)).rejects.toThrow('STALE_EXECUTION');
    expect((await h.worker.claim(h.delivery)).status).toBe('expired');
    expect((await h.worker.claim(h.delivery)).status).toBe('duplicate');
    await expect(h.worker.heartbeat(lease)).rejects.toThrow('STALE_EXECUTION');
    expect(h.record(h.runId).platforms.reddit.slice.errorCode).toBe('LEASE_EXPIRED');
    expect(h.record(h.runId).platforms.x.slice.status).toBe('pending');
    expect(h.store.data.admissions.size).toBe(1);
    expect(h.store.data.outbox.size).toBe(2);
  });

  it('renews a valid lease but never extends the original cumulative deadline', async () => {
    const h = await setup();
    const lease = await acquired(h);
    for (let step = 0; step < 23; step++) {
      h.advance(5000);
      await h.worker.heartbeat(lease);
    }
    expect(h.record(h.runId).platforms.reddit.lease!.expiresAt).toBe(h.record(h.runId).deadline);
    h.advance(5000);
    await expect(h.worker.heartbeat(lease)).rejects.toThrow('STALE_EXECUTION');
    expect((await h.worker.claim(h.delivery)).status).toBe('expired');
  });

  it('does no platform work when a queued delivery has passed its durable deadline', async () => {
    const h = await setup();
    h.advance(120_000);
    expect((await h.worker.claim(h.delivery)).status).toBe('expired');
    expect(h.record(h.runId).platforms.reddit.attempt).toBe(0);
    expect(h.record(h.runId).platforms.reddit.slice.errorCode).toBe('DEADLINE_EXCEEDED');
  });

  it('persists retry not-before, absorbs old redelivery and stops at three known transient attempts', async () => {
    const h = await setup();
    await h.worker.finish(await acquired(h, 'x'), complete);
    const x = h.record(h.runId).platforms.x;
    const first = await acquired(h);
    expect(
      await h.worker.finish(first, { status: 'failed', errorCode: 'PROVIDER_TRANSIENT' }),
    ).toBe('retry');
    const secondPayload = h.record(h.runId).platforms.reddit.delivery;
    expect((await h.worker.claim(secondPayload)).status).toBe('deferred');
    expect((await h.worker.claim(h.delivery)).status).toBe('stale');
    h.advance(500);
    const second = await acquired(h);
    await expect(h.worker.finish(first, complete)).rejects.toThrow('STALE_EXECUTION');
    expect(
      await h.worker.finish(second, { status: 'failed', errorCode: 'PROVIDER_TRANSIENT' }),
    ).toBe('retry');
    h.advance(1000);
    expect(
      await h.worker.finish(await acquired(h), {
        status: 'failed',
        errorCode: 'PROVIDER_TRANSIENT',
      }),
    ).toBe('complete');
    expect(h.record(h.runId).platforms.reddit.attempt).toBe(3);
    expect(h.record(h.runId).platforms.reddit.slice.status).toBe('failed');
    expect(h.record(h.runId).platforms.x).toEqual(x);
    expect(h.store.data.outbox.size).toBe(4);
    expect(h.store.data.admissions.size).toBe(1);
    expect(h.store.data.combined.size).toBe(1);
  });

  it.each(['PROVIDER_PERMANENT', 'BUDGET_STOPPED', 'VALIDATION_FAILED'] as const)(
    'does not retry %s or expose raw exception text',
    async (errorCode) => {
      const h = await setup();
      expect(await h.worker.finish(await acquired(h), { status: 'failed', errorCode })).toBe(
        'complete',
      );
      expect(h.store.data.outbox.size).toBe(2);
      expect(h.record(h.runId).platforms.reddit.slice.errorCode).toBe(errorCode);
      await expect(
        h.worker.finish({ delivery: h.delivery, token: uuid(999) }, {
          status: 'failed',
          errorCode: 'TOKEN_SECRET: hostile data',
        } as never),
      ).rejects.toThrow();
    },
  );

  it('rejects future freshness and early computed timestamps and does not alter a running slice', async () => {
    const h = await setup();
    const lease = await acquired(h);
    await expect(
      h.worker.finish(lease, { ...complete, computedAt: '2026-09-05T00:00:01.000Z' }),
    ).rejects.toThrow('INVALID_PLAN');
    await expect(
      h.worker.finish(lease, { ...complete, computedAt: '2026-09-04T23:59:59.000Z' }),
    ).rejects.toThrow('INVALID_PLAN');
    await expect(
      h.worker.finish(lease, { ...complete, dataThroughAt: '2026-09-05T00:00:01.000Z' }),
    ).rejects.toThrow('INVALID_PLAN');
    expect(h.record(h.runId).platforms.reddit.slice.status).toBe('running');
  });

  it('allows a terminal run to be rerun with a new immutable identity and activated settings through the common path', async () => {
    const h = await setup();
    await expect(h.service.rerun({ idempotencyKey: 'rerun', runId: h.runId })).rejects.toThrow(
      'CONFLICT',
    );
    await h.worker.finish(await acquired(h), unavailable);
    await h.worker.finish(await acquired(h, 'x'), unavailable);
    await publish(h, 'insufficient');
    const historical = h.record(h.runId);
    h.store.activePlan.configVersion = '2';
    const next = await h.service.rerun({ idempotencyKey: 'rerun', runId: h.runId });
    expect(next.runId).not.toBe(h.runId);
    expect(h.record(next.runId).rerunOf).toBe(h.runId);
    expect(h.record(next.runId).plan.configVersion).toBe('2');
    expect(h.record(h.runId)).toEqual(historical);
    expect(h.store.data.jobs.at(-1)!.triggerType).toBe('retry');
    expect((await h.service.rerun({ idempotencyKey: 'rerun', runId: h.runId })).disposition).toBe(
      'duplicate',
    );
    expect(h.store.data.jobs).toHaveLength(2);
  });

  it('requires both slices before accepting combined publication and rejects a crossed accepted artifact', async () => {
    const h = await setup();
    const value = {
      runId: h.runId,
      planHash: h.record(h.runId).planHash,
      artifactHash: 'a'.repeat(64),
      status: 'complete' as const,
    };
    await expect(h.combinedWorker.claim(h.record(h.runId).combined.delivery)).rejects.toThrow(
      'CONFLICT',
    );
    await Promise.all(
      ['reddit', 'x'].map(async (platform) =>
        h.worker.finish(await acquired(h, platform as 'reddit' | 'x'), complete),
      ),
    );
    const claim = await h.combinedWorker.claim(h.record(h.runId).combined.delivery);
    if (claim.status !== 'acquired') throw new Error('lease');
    await expect(
      h.combinedWorker.commitPublication(
        claim.lease,
        { ...value, runId: uuid(999) },
        async () => value,
      ),
    ).rejects.toThrow('CONFLICT');
    await h.combinedWorker.commitPublication(claim.lease, value, (tx, _fence, artifact) =>
      h.store.publish(tx, artifact),
    );
    await h.combinedWorker.finish(claim.lease, value.artifactHash, async () => value);
    expect(h.record(h.runId).run.status).toBe('complete');
    expect(h.record(h.runId).run.completedAt).toBe(START);
  });

  it('uses stable derivation for retry delivery keys and never lets a future attempt bypass backoff', async () => {
    const h = await setup();
    const future = deliveryFor(h.runId, 'reddit', h.delivery.planHash, 2);
    await expect(h.worker.claim(future)).rejects.toThrow('CONFLICT');
  });

  it.each(
    (['complete', 'retry', 'heartbeat'] as const).flatMap((operation) =>
      [10_000, 120_000].map((elapsed) => ({ operation, elapsed })),
    ),
  )(
    'rolls back $operation when the final awaited write reaches $elapsed ms',
    async ({ operation, elapsed }) => {
      const h = await setup();
      await h.worker.finish(await acquired(h, 'x'), complete);
      const lease = await acquired(h);
      const before = structuredClone(h.store.data);
      if (operation === 'heartbeat') h.store.afterPutExecution = () => h.advance(elapsed);
      else h.store.afterAudit = () => h.advance(elapsed);
      const action =
        operation === 'heartbeat'
          ? h.worker.heartbeat(lease)
          : h.worker.finish(
              lease,
              operation === 'complete'
                ? complete
                : { status: 'failed', errorCode: 'PROVIDER_TRANSIENT' },
            );
      await expect(action).rejects.toThrow('STALE_EXECUTION');
      // Includes both slices, the combined/retry outboxes, audit, and existing admission/job state.
      expect(h.store.data).toEqual(before);
    },
  );

  it('cannot renew a lease whose original authority expires during the heartbeat write', async () => {
    const h = await setup(),
      lease = await acquired(h);
    h.advance(5000);
    const before = structuredClone(h.store.data);
    h.store.afterPutExecution = () => h.advance(5000);
    await expect(h.worker.heartbeat(lease)).rejects.toThrow('STALE_EXECUTION');
    expect(h.store.data).toEqual(before);
  });
});
