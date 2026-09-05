import { describe, expect, it, vi } from 'vitest';
import { RniCombinedExecutionService, type RniCombinedLease } from '@/rni/orchestration/combined';
import { combinedDeliveryFor, deliveryFor } from '@/rni/orchestration/refresh';
import { relayRniCombinedOutbox } from '@/rni/orchestration/outbox';
import type { RniCombinedArtifact } from '@/rni/orchestration/types';
import { harness, scope, START, uuid } from './fixture';

async function ready() {
  const h = harness();
  const { runId } = await h.service.requestManualRefresh({ idempotencyKey: 'combined', scope });
  for (const platform of ['reddit', 'x'] as const) {
    const claim = await h.worker.claim(h.record(runId).platforms[platform].delivery);
    if (claim.status !== 'acquired') throw new Error('platform lease');
    await h.worker.finish(claim.lease, {
      status: 'complete',
      eligibleSourceCount: 2,
      dataThroughAt: START,
      computedAt: START,
    });
  }
  const artifact: RniCombinedArtifact = {
    runId,
    planHash: h.record(runId).planHash,
    artifactHash: 'a'.repeat(64),
    status: 'complete',
  };
  return { ...h, runId, artifact, delivery: h.record(runId).combined.delivery };
}
type Harness = Awaited<ReturnType<typeof ready>>;
async function acquired(h: Harness): Promise<RniCombinedLease> {
  const claim = await h.combinedWorker.claim(h.record(h.runId).combined.delivery);
  if (claim.status !== 'acquired') throw new Error('combined lease');
  return claim.lease;
}

async function readyFullUniverseV2() {
  const h = harness();
  const { runId } = await h.service.requestManualRefresh({
    idempotencyKey: 'combined-full-v2',
    scope: { kind: 'full_universe' },
  });
  for (const platform of ['reddit', 'x'] as const) {
    const claim = await h.worker.claim(h.record(runId).platforms[platform].delivery);
    if (claim.status !== 'acquired') throw new Error('platform lease');
    await h.worker.finish(claim.lease, {
      status: 'complete',
      eligibleSourceCount: 2,
      dataThroughAt: START,
      computedAt: START,
    });
  }
  const previous = h.record(runId);
  const runManifestHash = 'f'.repeat(64);
  const next = {
    ...previous,
    version: 'rni-execution-v2' as const,
    runManifestHash,
    platforms: {
      reddit: {
        ...previous.platforms.reddit,
        delivery: deliveryFor(runId, 'reddit', previous.planHash, 1, runManifestHash),
      },
      x: {
        ...previous.platforms.x,
        delivery: deliveryFor(runId, 'x', previous.planHash, 1, runManifestHash),
      },
    },
    combined: {
      ...previous.combined,
      delivery: combinedDeliveryFor(runId, previous.planHash, 1, runManifestHash),
    },
  };
  h.store.data.executions.set(runId, next);
  const artifact: RniCombinedArtifact = {
    runId,
    planHash: next.planHash,
    artifactHash: 'a'.repeat(64),
    status: 'complete',
  };
  return { ...h, runId, artifact, delivery: next.combined.delivery };
}
const publish = (h: Harness, lease: RniCombinedLease) =>
  h.combinedWorker.commitPublication(lease, h.artifact, (tx, _fence, artifact) =>
    h.store.publish(tx, artifact),
  );

describe('D-RNI-27 combined publication lifecycle', () => {
  it('does not acquire combined work until both platform slices are terminal', async () => {
    const h = harness();
    const { runId } = await h.service.requestManualRefresh({ idempotencyKey: 'a', scope });
    await expect(h.combinedWorker.claim(h.record(runId).combined.delivery)).rejects.toThrow(
      'CONFLICT',
    );
    expect(h.store.data.combined.size).toBe(0);
  });

  it('coalesces concurrent delivery and retains the lease after worker reconstruction', async () => {
    const h = await ready();
    const claims = await Promise.all(
      Array.from({ length: 8 }, () => h.combinedWorker.claim(h.delivery)),
    );
    expect(claims.filter((c) => c.status === 'acquired')).toHaveLength(1);
    expect(claims.filter((c) => c.status === 'busy')).toHaveLength(7);
    expect((await new RniCombinedExecutionService(h.deps).claim(h.delivery)).status).toBe('busy');
    expect(h.record(h.runId).combined.attempt).toBe(1);
  });

  it('passes the exact lease to provider and atomic I07 commit boundaries, then finishes once', async () => {
    const h = await ready(),
      lease = await acquired(h);
    const before = h.record(h.runId).platforms;
    const fence = await h.combinedWorker.effectFence(lease);
    expect(fence).toMatchObject({
      token: lease.token,
      stage: 'combined',
      attempt: 1,
      runId: h.runId,
      deadline: h.record(h.runId).deadline,
      planHash: h.artifact.planHash,
    });
    const commit = vi.fn(async (tx, actualFence, artifact) => {
      expect(actualFence).toEqual(fence);
      return h.store.publish(tx, artifact);
    });
    expect(
      await Promise.all(
        Array.from({ length: 4 }, () =>
          h.combinedWorker.commitPublication(lease, h.artifact, commit),
        ),
      ),
    ).toEqual(['committed', 'duplicate', 'duplicate', 'duplicate']);
    expect(commit).toHaveBeenCalledOnce();
    expect(h.record(h.runId).run.status).toBe('running');
    const read = vi.fn(async (actual) => {
      expect(actual).toEqual(fence);
      return h.artifact;
    });
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        h.combinedWorker.finish(lease, h.artifact.artifactHash, read),
      ),
    );
    expect(results.filter((r) => r === 'complete')).toHaveLength(1);
    expect(h.record(h.runId).run.status).toBe('complete');
    expect(h.record(h.runId).platforms).toEqual(before);
    expect(h.store.data.publications.size).toBe(1);
    expect(h.store.data.audits.filter((e) => e.event === 'combined_terminal')).toHaveLength(1);
  });

  it('commits a v2 full-universe release and terminal projections in one transaction', async () => {
    const h = await readyFullUniverseV2();
    const lease = await acquired(h);
    const publishFull = vi.fn(async (tx, fence, artifact, committedAt) => {
      expect(committedAt).toBe(START);
      expect(fence.token).toBe(lease.token);
      return h.store.publish(tx, artifact);
    });
    expect(
      await h.combinedWorker.commitFullUniversePublication(lease, h.artifact, publishFull),
    ).toBe('committed');
    expect(h.record(h.runId).run).toMatchObject({ status: 'complete', completedAt: START });
    expect(h.record(h.runId).combined).toMatchObject({
      status: 'complete',
      lease: null,
      outcomeToken: lease.token,
      publication: { committedAt: START },
    });
    expect(h.store.data.publications.size).toBe(1);
    expect(h.store.data.audits.filter(({ event }) => event === 'combined_committed')).toHaveLength(1);
    expect(h.store.data.audits.filter(({ event }) => event === 'combined_terminal')).toHaveLength(1);
    expect(
      await h.combinedWorker.commitFullUniversePublication(lease, h.artifact, publishFull),
    ).toBe('duplicate');
    expect(publishFull).toHaveBeenCalledOnce();
  });

  it('rejects crossed payloads and tokens before any publishing effect', async () => {
    const h = await ready(),
      lease = await acquired(h),
      callback = vi.fn(async () => h.artifact);
    for (const delivery of [
      { ...h.delivery, deliveryKey: 'crossed' },
      { ...h.delivery, planHash: 'b'.repeat(64) },
      { ...h.delivery, runId: uuid(999) },
      combinedDeliveryFor(h.runId, h.artifact.planHash, 2),
    ]) {
      await expect(h.combinedWorker.claim(delivery)).rejects.toThrow();
    }
    await expect(h.combinedWorker.effectFence({ ...lease, token: uuid(999) })).rejects.toThrow(
      'STALE_EXECUTION',
    );
    await expect(
      h.combinedWorker.commitPublication({ ...lease, token: uuid(999) }, h.artifact, callback),
    ).rejects.toThrow('STALE_EXECUTION');
    await expect(
      h.combinedWorker.finish({ ...lease, token: uuid(999) }, h.artifact.artifactHash, callback),
    ).rejects.toThrow('STALE_EXECUTION');
    expect(callback).not.toHaveBeenCalled();
  });

  it.each([10_000, 120_000])(
    'rejects unproven expired completion at %i ms BEFORE trusted reads or writes',
    async (ms) => {
      const h = await ready(),
        lease = await acquired(h),
        callback = vi.fn(async () => h.artifact);
      h.advance(ms);
      await expect(
        h.combinedWorker.finish(lease, h.artifact.artifactHash, callback),
      ).rejects.toThrow('STALE_EXECUTION');
      await expect(h.combinedWorker.commitPublication(lease, h.artifact, callback)).rejects.toThrow(
        'STALE_EXECUTION',
      );
      await expect(h.combinedWorker.effectFence(lease)).rejects.toThrow('STALE_EXECUTION');
      await expect(
        h.combinedWorker.fail(lease, { errorCode: 'SYNTHESIS_TRANSIENT' }),
      ).rejects.toThrow('STALE_EXECUTION');
      expect(callback).not.toHaveBeenCalled();
      expect((await h.combinedWorker.claim(h.delivery)).status).toBe('expired');
      expect((await h.combinedWorker.claim(h.delivery)).status).toBe('duplicate');
      expect(h.record(h.runId).combined.errorCode).toBe('LEASE_EXPIRED');
      expect(h.record(h.runId).run.status).toBe('failed');
      expect(h.store.data.admissions.size).toBe(1);
      expect(h.store.data.combined.size).toBe(1);
      expect(h.store.data.publications.size).toBe(0);
    },
  );

  it('fails queued combined work at the original deadline without an attempt', async () => {
    const h = await ready();
    h.advance(120_000);
    expect((await h.combinedWorker.claim(h.delivery)).status).toBe('expired');
    expect(h.record(h.runId).combined).toMatchObject({
      attempt: 0,
      status: 'failed',
      errorCode: 'DEADLINE_EXCEEDED',
    });
  });

  it('heartbeats cannot extend the immutable run deadline or resurrect an expired lease', async () => {
    const h = await ready(),
      lease = await acquired(h);
    for (let step = 0; step < 23; step++) {
      h.advance(5000);
      await h.combinedWorker.heartbeat(lease);
    }
    expect(h.record(h.runId).combined.lease!.expiresAt).toBe(h.record(h.runId).deadline);
    h.advance(5000);
    await expect(h.combinedWorker.heartbeat(lease)).rejects.toThrow('STALE_EXECUTION');
    await expect(h.combinedWorker.effectFence(lease)).rejects.toThrow('STALE_EXECUTION');
  });

  it.each(['lease', 'deadline'] as const)(
    'rolls back I07 publication and its proof if the %s expires during commit',
    async (bound) => {
      const h = await ready(),
        lease = await acquired(h);
      if (bound === 'deadline') {
        for (let step = 0; step < 23; step++) {
          h.advance(5000);
          await h.combinedWorker.heartbeat(lease);
        }
        h.advance(4000);
      }
      const before = h.record(h.runId);
      await expect(
        h.combinedWorker.commitPublication(lease, h.artifact, async (tx, _fence, artifact) => {
          await h.store.publish(tx, artifact);
          h.advance(bound === 'lease' ? 10_000 : 1000);
          return artifact;
        }),
      ).rejects.toThrow('STALE_EXECUTION');
      expect(h.record(h.runId)).toEqual(before);
      expect(h.store.data.publications.size).toBe(0);
      expect(h.store.data.audits.filter((e) => e.event === 'combined_committed')).toHaveLength(0);
    },
  );

  it('rolls back a heartbeat write that reaches the original lease expiry before the extension commits', async () => {
    const h = await ready(),
      lease = await acquired(h);
    h.advance(5000);
    const before = structuredClone(h.store.data);
    h.store.afterPutExecution = () => h.advance(5000);
    await expect(h.combinedWorker.heartbeat(lease)).rejects.toThrow('STALE_EXECUTION');
    expect(h.store.data).toEqual(before);
  });

  it('rolls back a publication and receipt if the audit fails', async () => {
    const h = await ready(),
      lease = await acquired(h);
    h.store.failAudit = true;
    await expect(publish(h, lease)).rejects.toThrow('simulated audit');
    expect(h.store.data.publications.size).toBe(0);
    expect(h.record(h.runId).combined.publication).toBeNull();
    h.store.failAudit = false;
    expect(await publish(h, lease)).toBe('committed');
  });

  it('rechecks expiry after the final awaited write, before transaction commit', async () => {
    const h = await ready(),
      lease = await acquired(h);
    h.store.afterAudit = () => h.advance(120_000);
    await expect(publish(h, lease)).rejects.toThrow('STALE_EXECUTION');
    expect(h.store.data.publications.size).toBe(0);
    expect(h.record(h.runId).combined.publication).toBeNull();
  });

  it.each([10_000, 120_000])(
    'allows exact post-expiry recovery at %i ms only from an atomic valid-lease receipt',
    async (ms) => {
      const h = await ready(),
        lease = await acquired(h);
      await publish(h, lease);
      const proof = h.record(h.runId).combined.publication;
      h.advance(ms);
      const forbidden = vi.fn(async () => {
        throw new Error('must not read or publish after expiry');
      });
      expect(await h.combinedWorker.commitPublication(lease, h.artifact, forbidden)).toBe(
        'duplicate',
      );
      expect(await h.combinedWorker.finish(lease, h.artifact.artifactHash, forbidden)).toBe(
        'duplicate',
      );
      expect(forbidden).not.toHaveBeenCalled();
      expect(h.record(h.runId).combined.publication).toEqual(proof);
      expect(h.record(h.runId).run.completedAt).toBe(START);
      await expect(h.combinedWorker.finish(lease, 'b'.repeat(64), forbidden)).rejects.toThrow(
        'CONFLICT',
      );
      await expect(
        h.combinedWorker.finish({ ...lease, token: uuid(999) }, h.artifact.artifactHash, forbidden),
      ).rejects.toThrow('CONFLICT');
    },
  );

  it('recovers a committed artifact on queue redelivery after the publishing worker disappears', async () => {
    const h = await ready(),
      lease = await acquired(h);
    await publish(h, lease);
    h.advance(120_000);
    const recreated = new RniCombinedExecutionService(h.deps);
    expect((await recreated.claim(h.delivery)).status).toBe('duplicate');
    expect(h.record(h.runId).run.status).toBe('complete');
    expect(h.record(h.runId).combined.status).toBe('complete');
    expect(h.store.data.publications.size).toBe(1);
  });

  it('rejects a read callback claiming success without a fenced commit receipt', async () => {
    const h = await ready(),
      lease = await acquired(h),
      read = vi.fn(async () => h.artifact);
    await expect(h.combinedWorker.finish(lease, h.artifact.artifactHash, read)).rejects.toThrow(
      'CONFLICT',
    );
    expect(read).toHaveBeenCalledOnce();
    expect(h.record(h.runId).combined.publication).toBeNull();
    expect(h.record(h.runId).run.status).toBe('running');
  });

  it('checks the deadline again after a trusted read and does not convert an unproven late artifact into success', async () => {
    const h = await ready(),
      lease = await acquired(h);
    await expect(
      h.combinedWorker.finish(lease, h.artifact.artifactHash, async () => {
        h.advance(120_000);
        return h.artifact;
      }),
    ).rejects.toThrow('STALE_EXECUTION');
    expect(h.record(h.runId).combined.publication).toBeNull();
  });

  it('permits a read finishing late only when it matches the already-committed artifact exactly', async () => {
    const h = await ready(),
      lease = await acquired(h);
    await publish(h, lease);
    await expect(
      h.combinedWorker.finish(lease, h.artifact.artifactHash, async () => {
        h.advance(120_000);
        return { ...h.artifact, artifactHash: 'b'.repeat(64) };
      }),
    ).rejects.toThrow('CONFLICT');
    expect(h.record(h.runId).run.status).toBe('running');
    expect(
      await h.combinedWorker.finish(lease, h.artifact.artifactHash, async () => h.artifact),
    ).toBe('duplicate');
    expect(h.record(h.runId).run.status).toBe('complete');
  });

  it.each(['token', 'committedAt', 'artifact'] as const)(
    'rejects a crossed or invalid durable %s proof',
    async (field) => {
      const h = await ready(),
        lease = await acquired(h);
      await publish(h, lease);
      const proof = h.store.data.executions.get(h.runId)!.combined.publication!;
      if (field === 'token') proof.token = uuid(999);
      if (field === 'committedAt') proof.committedAt = h.record(h.runId).deadline;
      if (field === 'artifact') proof.artifact.planHash = 'b'.repeat(64);
      h.advance(120_000);
      await expect(h.combinedWorker.claim(h.delivery)).rejects.toThrow('CONFLICT');
      await expect(
        h.combinedWorker.finish(lease, h.artifact.artifactHash, async () => h.artifact),
      ).rejects.toThrow('CONFLICT');
    },
  );

  it('rejects crossed I07 commit outputs and never persists their publication or proof', async () => {
    const h = await ready(),
      lease = await acquired(h);
    await expect(
      h.combinedWorker.commitPublication(lease, h.artifact, async (tx, _fence, artifact) => {
        await h.store.publish(tx, artifact);
        return { ...artifact, artifactHash: 'b'.repeat(64) };
      }),
    ).rejects.toThrow('CONFLICT');
    expect(h.store.data.publications.size).toBe(0);
    expect(h.record(h.runId).combined.publication).toBeNull();
  });

  it('retries only known synthesis transients, persists backoff, fences old tokens and stops at three attempts', async () => {
    const h = await ready(),
      originalPlatforms = h.record(h.runId).platforms;
    let previous: RniCombinedLease | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const lease = await acquired(h);
      if (previous) {
        await expect(publish(h, previous)).rejects.toThrow('STALE_EXECUTION');
        await expect(h.combinedWorker.heartbeat(previous)).rejects.toThrow('STALE_EXECUTION');
      }
      const result = await h.combinedWorker.fail(lease, { errorCode: 'SYNTHESIS_TRANSIENT' });
      expect(result).toBe(attempt < 3 ? 'retry' : 'failed');
      expect(await h.combinedWorker.fail(lease, { errorCode: 'SYNTHESIS_TRANSIENT' })).toBe(
        'duplicate',
      );
      if (attempt < 3) {
        expect((await h.combinedWorker.claim(h.record(h.runId).combined.delivery)).status).toBe(
          'deferred',
        );
        expect((await h.combinedWorker.claim(lease.delivery)).status).toBe('stale');
        h.advance(attempt === 1 ? 500 : 1000);
      }
      previous = lease;
    }
    expect(h.record(h.runId).combined.attempt).toBe(3);
    expect(h.record(h.runId).run.status).toBe('failed');
    expect(h.record(h.runId).platforms).toEqual(originalPlatforms);
    expect(h.store.data.combined.size).toBe(3);
    expect(h.store.data.admissions.size).toBe(1);
  });

  it.each(['SYNTHESIS_PERMANENT', 'VALIDATION_FAILED', 'BUDGET_STOPPED'] as const)(
    'makes %s terminal without another model attempt',
    async (errorCode) => {
      const h = await ready(),
        lease = await acquired(h);
      expect(await h.combinedWorker.fail(lease, { errorCode })).toBe('failed');
      expect(h.record(h.runId).run.status).toBe('failed');
      expect(h.store.data.combined.size).toBe(1);
      await expect(
        h.combinedWorker.fail(lease, { errorCode: 'secret provider message' } as never),
      ).rejects.toThrow();
    },
  );

  it('rolls back retry state and outbox if enqueue fails', async () => {
    const h = await ready(),
      lease = await acquired(h),
      before = h.record(h.runId);
    h.store.failEnqueue = true;
    await expect(
      h.combinedWorker.fail(lease, { errorCode: 'SYNTHESIS_TRANSIENT' }),
    ).rejects.toThrow('simulated outbox');
    expect(h.record(h.runId)).toEqual(before);
    expect(h.store.data.combined.size).toBe(1);
  });

  it('does not schedule a transient retry beyond the immutable deadline', async () => {
    const h = await ready(),
      lease = await acquired(h);
    for (let step = 0; step < 23; step++) {
      h.advance(5000);
      await h.combinedWorker.heartbeat(lease);
    }
    h.advance(4800);
    expect(await h.combinedWorker.fail(lease, { errorCode: 'SYNTHESIS_TRANSIENT' })).toBe('failed');
    expect(h.record(h.runId).combined.attempt).toBe(1);
    expect(h.store.data.combined.size).toBe(1);
    expect(h.record(h.runId).run.status).toBe('failed');
  });

  it('recovers from synthesis/read failure without repeating a committed artifact', async () => {
    const h = await ready(),
      lease = await acquired(h);
    await expect(
      h.combinedWorker.commitPublication(lease, h.artifact, async () => {
        throw new Error('inference/validation failure');
      }),
    ).rejects.toThrow();
    expect(h.store.data.publications.size).toBe(0);
    await publish(h, lease);
    await expect(
      h.combinedWorker.finish(lease, h.artifact.artifactHash, async () => {
        throw new Error('read unavailable');
      }),
    ).rejects.toThrow();
    await expect(
      h.combinedWorker.fail(lease, { errorCode: 'SYNTHESIS_TRANSIENT' }),
    ).rejects.toThrow('CONFLICT');
    h.advance(10_000);
    expect((await h.combinedWorker.claim(h.delivery)).status).toBe('duplicate');
    expect(h.store.data.publications.size).toBe(1);
  });

  it('relays ambiguous combined outbox deliveries with the same key and one acquired lease', async () => {
    const h = await ready(),
      claims: string[] = [],
      keys: string[] = [];
    let acknowledged = false,
      failAck = true;
    const deps = {
      now: new Date(START),
      outbox: {
        pending: async () => (acknowledged ? [] : [...h.store.data.combined.values()]),
        markPublished: async () => {
          if (failAck) throw new Error('lost acknowledgment');
          acknowledged = true;
        },
      },
      publisher: {
        publish: async ({
          payload,
          idempotencyKey,
        }: {
          payload: typeof h.delivery;
          idempotencyKey: string;
        }) => {
          keys.push(idempotencyKey);
          claims.push((await h.combinedWorker.claim(payload)).status);
          return { messageId: 'message' };
        },
      },
    };
    await expect(relayRniCombinedOutbox(deps)).rejects.toThrow('lost acknowledgment');
    failAck = false;
    expect(await relayRniCombinedOutbox(deps)).toBe(1);
    expect(keys).toEqual([h.delivery.deliveryKey, h.delivery.deliveryKey]);
    expect(claims).toEqual(['acquired', 'busy']);
    expect(await relayRniCombinedOutbox(deps)).toBe(0);
  });
});
