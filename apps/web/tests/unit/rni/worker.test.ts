import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  getProductionRniWorkerExecutor,
  receiveRniWorkerRequest,
  type RniWorkerExecutor,
  type RniWorkerServices,
} from '../../../src/rni/orchestration/worker';
import { validateRniExecution } from '../../../src/rni/orchestration/refresh';
import { harness, scope } from './orchestration/fixture';

const current = 'worker-test-current';
const next = 'worker-test-next';
const expectedUrl = 'https://app.test/api/internal/rni/worker';

async function setup() {
  const h = harness();
  const { runId } = await h.service.requestManualRefresh({ idempotencyKey: 'worker', scope });
  const platform = vi.fn<RniWorkerExecutor['platform']>(async ({ lease, services }) => {
    await services.platform.finish(lease, {
      status: 'complete',
      eligibleSourceCount: 2,
      dataThroughAt: h.record(runId).plan.windowEnd,
      computedAt: h.deps.now().toISOString(),
    });
  });
  const combined = vi.fn<RniWorkerExecutor['combined']>(async ({ lease, services }) => {
    await services.combined.fail(lease, { errorCode: 'SYNTHESIS_PERMANENT' });
  });
  const executor = { platform, combined };
  const services: RniWorkerServices = {
    platform: h.worker,
    combined: h.combinedWorker,
    readExecution: (id) =>
      h.store.transact(h.deps.partition, async (tx) =>
        validateRniExecution(await tx.getExecution(id), h.deps.partition, id),
      ),
  };
  const createServices = vi.fn(() => services);
  const resolveExecutor = vi.fn<() => RniWorkerExecutor | null>(() => executor);
  const deps = {
    expectedUrl,
    currentSigningKey: current,
    nextSigningKey: next,
    now: h.deps.now,
    resolveExecutor,
    createServices,
  };
  function request(
    rawBody = JSON.stringify(h.record(runId).platforms.reddit.delivery),
    options: {
      key?: string;
      claims?: Record<string, unknown>;
      sentBody?: string;
      signature?: string | null;
    } = {},
  ) {
    const seconds = Math.floor(h.deps.now().getTime() / 1000);
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const header = encode({ alg: 'HS256', typ: 'JWT' });
    const claims = encode({
      iss: 'Upstash',
      sub: expectedUrl,
      exp: seconds + 300,
      nbf: seconds,
      iat: seconds,
      jti: 'worker-test-jwt',
      body: createHash('sha256').update(rawBody).digest('base64url'),
      ...options.claims,
    });
    const signature =
      options.signature === undefined
        ? `${header}.${claims}.${createHmac('sha256', options.key ?? current)
            .update(`${header}.${claims}`)
            .digest('base64url')}`
        : options.signature;
    return new Request(expectedUrl, {
      method: 'POST',
      body: options.sentBody ?? rawBody,
      headers: {
        ...(signature === null ? {} : { 'Upstash-Signature': signature }),
        'Content-Type': 'application/json',
        'X-Request-Id': 'caller-secret-must-not-reflect',
      },
    });
  }
  return {
    ...h,
    runId,
    platform,
    combined,
    executor,
    services,
    deps,
    request,
    createServices,
    resolveExecutor,
    receive: (input = request()) => receiveRniWorkerRequest(input, deps),
  };
}

describe('signed RNI worker receiver', () => {
  it('has no production fixture fallback or no-op executor', () => {
    expect(getProductionRniWorkerExecutor()).toBeNull();
  });

  it.each([current, next])(
    'authenticates %s then finishes exactly once under its durable lease',
    async (key) => {
      const h = await setup();
      const response = await h.receive(h.request(undefined, { key }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: { status: 'processed', runId: h.runId } });
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(h.platform).toHaveBeenCalledOnce();
      expect(h.combined).not.toHaveBeenCalled();
      expect(h.record(h.runId).platforms.reddit.slice.status).toBe('complete');
      expect((await h.receive()).status).toBe(200);
      expect(h.platform).toHaveBeenCalledOnce();
      expect(h.resolveExecutor.mock.invocationCallOrder[0]).toBeLessThan(
        h.createServices.mock.invocationCallOrder[0]!,
      );
    },
  );

  it.each([
    { signature: null },
    { key: 'unknown-signing-secret' },
    { sentBody: '{"tampered":true}' },
    { claims: { sub: 'https://evil.test/api/internal/rni/worker' } },
    { claims: { exp: 0 } },
  ])('rejects invalid authority before constructing executor or storage: %j', async (options) => {
    const h = await setup();
    const before = structuredClone(h.store.data);
    const response = await h.receive(h.request(undefined, options));
    expect(response.status).toBe(403);
    expect(await response.text()).not.toMatch(
      /worker-test-current|worker-test-next|unknown-signing-secret|caller-secret/,
    );
    expect(h.resolveExecutor).not.toHaveBeenCalled();
    expect(h.createServices).not.toHaveBeenCalled();
    expect(h.store.data).toEqual(before);
  });

  it.each(['{', 'null', '{}', '{"version":"arbitrary"}'])(
    'rejects authenticated invalid payload %s before storage',
    async (body) => {
      const h = await setup();
      expect((await h.receive(h.request(body))).status).toBe(400);
      expect(h.resolveExecutor).not.toHaveBeenCalled();
      expect(h.createServices).not.toHaveBeenCalled();
    },
  );

  it.each(['partition', 'leaseToken', 'modelId'])(
    'rejects authenticated extra field %s',
    async (field) => {
      const h = await setup();
      const body = JSON.stringify({
        ...h.record(h.runId).platforms.reddit.delivery,
        [field]: 'attacker',
      });
      expect((await h.receive(h.request(body))).status).toBe(400);
      expect(h.resolveExecutor).not.toHaveBeenCalled();
      expect(h.createServices).not.toHaveBeenCalled();
    },
  );

  it('bounds streamed body bytes and rejects invalid UTF-8 without replacing signed bytes', async () => {
    const h = await setup();
    expect((await h.receive(h.request('é'.repeat(16_385)))).status).toBe(413);
    const invalid = new Request(expectedUrl, {
      method: 'POST',
      body: new Uint8Array([0xc3, 0x28]),
    });
    expect((await h.receive(invalid)).status).toBe(400);
    expect(h.createServices).not.toHaveBeenCalled();
    expect(h.resolveExecutor).not.toHaveBeenCalled();
  });

  it('preserves a signed UTF-8 BOM for authentication instead of silently stripping bytes', async () => {
    const h = await setup();
    const body = `\uFEFF${JSON.stringify(h.record(h.runId).platforms.reddit.delivery)}`;
    // Its exact signature is valid, but BOM-prefixed JSON is not an accepted delivery payload.
    expect((await h.receive(h.request(body))).status).toBe(400);
    expect(h.resolveExecutor).not.toHaveBeenCalled();
    expect(h.createServices).not.toHaveBeenCalled();
  });

  it('fails closed on absent signing configuration or production executor without claiming or changing outboxes', async () => {
    const h = await setup();
    const before = structuredClone(h.store.data);
    expect(
      (await receiveRniWorkerRequest(h.request(), { ...h.deps, nextSigningKey: '' })).status,
    ).toBe(503);
    expect(h.resolveExecutor).not.toHaveBeenCalled();
    h.resolveExecutor.mockReturnValue(null);
    expect((await h.receive()).status).toBe(503);
    expect(h.resolveExecutor).toHaveBeenCalledOnce();
    expect(h.createServices).not.toHaveBeenCalled();
    expect(h.store.data).toEqual(before);
  });

  it('does not acknowledge a no-op or expose executor errors', async () => {
    const h = await setup();
    h.platform.mockResolvedValue(undefined);
    const outbox = structuredClone(h.store.data.outbox);
    expect((await h.receive()).status).toBe(503);
    expect(h.record(h.runId).platforms.reddit.slice.status).toBe('running');
    expect(h.store.data.outbox).toEqual(outbox);
    const other = await setup();
    other.platform.mockRejectedValue(new Error('provider-secret database-password'));
    const failed = await other.receive();
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toMatch(/provider-secret|database-password|caller-secret/);
  });

  it('returns retryable busy/deferred responses without executing or acknowledging unfinished work', async () => {
    const h = await setup();
    const claim = await h.worker.claim(h.record(h.runId).platforms.reddit.delivery);
    if (claim.status !== 'acquired') throw new Error('Expected acquired lease');
    const busy = await h.receive();
    expect(busy.status).toBe(503);
    expect(Number(busy.headers.get('retry-after'))).toBeGreaterThan(0);
    await h.worker.finish(claim.lease, { status: 'failed', errorCode: 'PROVIDER_TRANSIENT' });
    const deferred = await h.receive();
    expect(deferred.status).toBe(503);
    expect(Number(deferred.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(h.platform).not.toHaveBeenCalled();
  });

  it('acknowledges a durably enqueued retry and subsequently recognizes the superseded delivery', async () => {
    const h = await setup();
    const original = JSON.stringify(h.record(h.runId).platforms.reddit.delivery);
    h.platform.mockImplementation(async ({ lease, services }) => {
      await services.platform.finish(lease, { status: 'failed', errorCode: 'PROVIDER_TRANSIENT' });
    });
    expect((await h.receive(h.request(original))).status).toBe(200);
    expect(h.store.data.outbox.size).toBe(3);
    const stale = await h.receive(h.request(original));
    expect(stale.status).toBe(200);
    expect(await stale.json()).toEqual({ data: { status: 'stale', runId: h.runId } });
    expect(h.platform).toHaveBeenCalledOnce();
  });

  it('routes the strict combined delivery only after both independent platforms are terminal', async () => {
    const h = await setup();
    for (const platform of ['reddit', 'x'] as const) {
      const claim = await h.worker.claim(h.record(h.runId).platforms[platform].delivery);
      if (claim.status !== 'acquired') throw new Error('Expected platform lease');
      await h.worker.finish(claim.lease, {
        status: 'unavailable',
        errorCode: 'PROVIDER_UNAVAILABLE',
      });
    }
    const body = JSON.stringify(h.record(h.runId).combined.delivery);
    expect((await h.receive(h.request(body))).status).toBe(200);
    expect(h.combined).toHaveBeenCalledOnce();
    expect(h.platform).not.toHaveBeenCalled();
    expect(h.record(h.runId).run.status).toBe('failed');
    expect((await h.receive(h.request(body))).status).toBe(200);
    expect(h.combined).toHaveBeenCalledOnce();
  });

  it('requires a real combined publication receipt and finish rather than an executor return', async () => {
    const h = await setup();
    for (const platform of ['reddit', 'x'] as const) {
      const claim = await h.worker.claim(h.record(h.runId).platforms[platform].delivery);
      if (claim.status !== 'acquired') throw new Error('Expected platform lease');
      await h.worker.finish(claim.lease, {
        status: 'complete',
        eligibleSourceCount: 2,
        dataThroughAt: h.record(h.runId).plan.windowEnd,
        computedAt: h.deps.now().toISOString(),
      });
    }
    h.combined.mockImplementation(async ({ lease, record, services }) => {
      const artifact = {
        runId: record.run.id,
        planHash: record.planHash,
        artifactHash: 'a'.repeat(64),
        status: 'complete' as const,
      };
      await services.combined.commitPublication(lease, artifact, (tx, _fence, output) =>
        h.store.publish(tx, output),
      );
      await services.combined.finish(lease, artifact.artifactHash, async () => artifact);
    });
    const response = await h.receive(
      h.request(JSON.stringify(h.record(h.runId).combined.delivery)),
    );
    expect(response.status).toBe(200);
    expect(h.record(h.runId).run.status).toBe('complete');
    expect(h.store.data.publications.size).toBe(1);
  });
});
