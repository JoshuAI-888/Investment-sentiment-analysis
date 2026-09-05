import { createHash, createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as WorkerModule from '../../../src/rni/orchestration/worker';
import type * as CompositionModule from '../../../src/rni/orchestration/composition';
import type * as RefreshModule from '../../../src/rni/orchestration/refresh';

const mock = vi.hoisted(() => ({
  services: vi.fn(),
  executor: vi.fn(),
  store: vi.fn(),
  ensure: vi.fn(),
  environment: vi.fn(),
  publisher: vi.fn(),
  relayPlatform: vi.fn(),
  relayCombined: vi.fn(),
  definition: vi.fn(),
  refreshService: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock('@/env', () => ({
  env: {
    PROVIDER_MODE: 'live',
    DATABASE_URL: 'postgresql://unused.test/never-connect',
    APP_BASE_URL: 'https://configured.test',
    QSTASH_CURRENT_SIGNING_KEY: 'route-current',
    QSTASH_NEXT_SIGNING_KEY: 'route-next',
    QSTASH_TOKEN: 'private-publisher-token',
    INTERNAL_DISPATCH_SECRET: 'ascii-secret-at-least-16',
  },
}));
vi.mock('@/rni/read-model', () => ({ rniEnvironment: mock.environment }));
vi.mock('@/rni/repositories/orchestration', () => ({
  PostgresRniOrchestrationStore: mock.store,
  PostgresRniOutbox: vi.fn(),
  ensureRniJobDefinitions: mock.ensure,
}));
vi.mock('@/repositories/jobs', () => ({ findTriggerEligibleJobDefinition: mock.definition }));
vi.mock('@/rni/orchestration/refresh', async (importOriginal) => ({
  ...(await importOriginal<typeof RefreshModule>()),
  RniRefreshService: mock.refreshService,
}));
vi.mock('@/rni/orchestration/qstash-publisher', () => ({ RniQstashPublisher: mock.publisher }));
vi.mock('@/rni/orchestration/outbox', () => ({
  relayRniPlatformOutbox: mock.relayPlatform,
  relayRniCombinedOutbox: mock.relayCombined,
}));
vi.mock('@/rni/orchestration/composition', () => ({
  createLiveRniExecutionServices: mock.services,
  dispatchLiveRniSchedule: mock.dispatch,
}));
vi.mock('@/rni/orchestration/worker', async (importOriginal) => ({
  ...(await importOriginal<typeof WorkerModule>()),
  getProductionRniWorkerExecutor: mock.executor,
}));

import { POST as dispatchSchedule } from '../../../app/api/internal/rni/dispatch/route';
import { POST as dispatchWorker } from '../../../app/api/internal/rni/worker/route';
import { deliveryFor } from '../../../src/rni/orchestration/refresh';

function request(
  key = 'route-current',
  subject = 'https://configured.test/api/internal/rni/worker',
) {
  const body = JSON.stringify(
    deliveryFor('00000000-0000-4000-8000-000000000901', 'reddit', 'a'.repeat(64), 1),
  );
  const seconds = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256' });
  const claims = encode({
    iss: 'Upstash',
    sub: subject,
    exp: seconds + 60,
    nbf: seconds - 1,
    iat: seconds - 1,
    jti: 'route-jwt',
    body: createHash('sha256').update(body).digest('base64url'),
  });
  const signature = createHmac('sha256', key).update(`${header}.${claims}`).digest('base64url');
  // Request/forwarded hosts are deliberately not the server-configured verification subject.
  return new Request('https://untrusted-host.test/api/internal/rni/worker', {
    method: 'POST',
    body,
    headers: {
      'Upstash-Signature': `${header}.${claims}.${signature}`,
      Host: 'evil.test',
      'X-Forwarded-Host': 'evil.test',
    },
  });
}

describe('internal RNI worker HTTP route and production readiness guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.executor.mockReturnValue(null);
    mock.refreshService.mockImplementation(() => ({ schedule: vi.fn() }));
  });

  it.each(['route-current', 'route-next'])(
    'verifies %s before failing closed without storage',
    async (key) => {
      const response = await dispatchWorker(request(key));
      expect(response.status).toBe(503);
      expect(mock.executor).toHaveBeenCalledOnce();
      expect(mock.services).not.toHaveBeenCalled();
      expect(await response.text()).not.toMatch(/route-current|route-next|private-publisher-token/);
    },
  );

  it('never trusts request Host, forwarded Host or a signature for another endpoint', async () => {
    expect(
      (await dispatchWorker(request('route-current', 'https://evil.test/api/internal/rni/worker')))
        .status,
    ).toBe(403);
    expect(mock.executor).not.toHaveBeenCalled();
    expect(mock.services).not.toHaveBeenCalled();
  });

  it('rejects missing signatures before executor or service construction', async () => {
    const unsigned = request();
    unsigned.headers.delete('Upstash-Signature');
    expect((await dispatchWorker(unsigned)).status).toBe(403);
    expect(mock.executor).not.toHaveBeenCalled();
    expect(mock.services).not.toHaveBeenCalled();
  });

  it('blocks manual/rerun service construction and schedule/relay before any durable or external effect', async () => {
    const composition = await vi.importActual<typeof CompositionModule>(
      '../../../src/rni/orchestration/composition',
    );
    await expect(composition.createLiveRniRefreshService('admin')).rejects.toThrow(
      'not configured',
    );
    await expect(composition.dispatchLiveRniSchedule()).rejects.toThrow('not configured');
    expect(mock.environment).not.toHaveBeenCalled();
    expect(mock.store).not.toHaveBeenCalled();
    expect(mock.ensure).not.toHaveBeenCalled();
    expect(mock.definition).not.toHaveBeenCalled();
    expect(mock.publisher).not.toHaveBeenCalled();
    expect(mock.relayPlatform).not.toHaveBeenCalled();
    expect(mock.relayCombined).not.toHaveBeenCalled();
  });

  it('does not create scheduled work when the registered job is not trigger-eligible', async () => {
    mock.executor.mockReturnValue({ platform: vi.fn(), combined: vi.fn() });
    mock.environment.mockReturnValue('test');
    mock.ensure.mockResolvedValue({
      manualJobId: '00000000-0000-4000-8000-000000000911',
      scheduledJobId: '00000000-0000-4000-8000-000000000912',
    });
    mock.definition.mockResolvedValue(null);
    mock.relayPlatform.mockResolvedValue(0);
    mock.relayCombined.mockResolvedValue(0);
    const composition = await vi.importActual<typeof CompositionModule>(
      '../../../src/rni/orchestration/composition',
    );

    await expect(composition.dispatchLiveRniSchedule()).resolves.toEqual({
      schedule: null,
      platformPublished: 0,
      combinedPublished: 0,
    });
    expect(mock.definition).toHaveBeenCalledWith('rni-scheduled:test');
  });

  it('drains committed outboxes even when due-run scheduling fails', async () => {
    const scheduledJobId = '00000000-0000-4000-8000-000000000912';
    const schedule = vi.fn(async () => {
      throw new Error('schedule plan unavailable');
    });
    mock.executor.mockReturnValue({ platform: vi.fn(), combined: vi.fn() });
    mock.environment.mockReturnValue('test');
    mock.ensure.mockResolvedValue({
      manualJobId: '00000000-0000-4000-8000-000000000911',
      scheduledJobId,
    });
    mock.definition.mockResolvedValue({ id: scheduledJobId, nextDueAt: new Date(0) });
    mock.refreshService.mockImplementation(() => ({ schedule }));
    mock.relayPlatform.mockResolvedValue(2);
    mock.relayCombined.mockResolvedValue(1);
    const composition = await vi.importActual<typeof CompositionModule>(
      '../../../src/rni/orchestration/composition',
    );

    await expect(composition.dispatchLiveRniSchedule()).rejects.toThrow(
      'schedule plan unavailable',
    );
    expect(mock.relayPlatform).toHaveBeenCalledOnce();
    expect(mock.relayCombined).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledOnce();
  });

  it('publishes a newly committed due run in the same scheduler dispatch', async () => {
    const order: string[] = [];
    const schedule = vi.fn(async () => {
      order.push('schedule-commit');
      return { disposition: 'accepted', runId: '00000000-0000-4000-8000-000000000913' };
    });
    mock.executor.mockReturnValue({ platform: vi.fn(), combined: vi.fn() });
    mock.environment.mockReturnValue('test');
    mock.ensure.mockResolvedValue({
      manualJobId: '00000000-0000-4000-8000-000000000911',
      scheduledJobId: '00000000-0000-4000-8000-000000000912',
    });
    mock.definition.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000912',
      nextDueAt: new Date(0),
    });
    mock.refreshService.mockImplementation(() => ({ schedule }));
    mock.relayPlatform.mockImplementation(async () => {
      order.push('platform-relay');
      return 2;
    });
    mock.relayCombined.mockImplementation(async () => {
      order.push('combined-relay');
      return 0;
    });
    const composition = await vi.importActual<typeof CompositionModule>(
      '../../../src/rni/orchestration/composition',
    );

    await expect(composition.dispatchLiveRniSchedule()).resolves.toMatchObject({
      platformPublished: 2,
    });
    expect(order[0]).toBe('schedule-commit');
    expect(order.slice(1).sort()).toEqual(['combined-relay', 'platform-relay']);
  });

  it('awaits the sibling relay even when the first relay fails', async () => {
    let combinedFinished = false;
    mock.executor.mockReturnValue({ platform: vi.fn(), combined: vi.fn() });
    mock.environment.mockReturnValue('test');
    mock.ensure.mockResolvedValue({
      manualJobId: '00000000-0000-4000-8000-000000000911',
      scheduledJobId: '00000000-0000-4000-8000-000000000912',
    });
    mock.definition.mockResolvedValue(null);
    mock.relayPlatform.mockRejectedValue(new Error('platform relay unavailable'));
    mock.relayCombined.mockImplementation(async () => {
      await Promise.resolve();
      combinedFinished = true;
      return 1;
    });
    const composition = await vi.importActual<typeof CompositionModule>(
      '../../../src/rni/orchestration/composition',
    );

    await expect(composition.dispatchLiveRniSchedule()).rejects.toThrow('RNI outbox relay failed');
    expect(combinedFinished).toBe(true);
  });

  it('rejects a non-ASCII bearer of equal character length without throwing', async () => {
    const supplied = 'é'.repeat('ascii-secret-at-least-16'.length);
    const response = await dispatchSchedule(
      new Request('https://configured.test/api/internal/rni/dispatch', {
        method: 'POST',
        headers: { authorization: `Bearer ${supplied}` },
      }),
    );
    expect(response.status).toBe(403);
    expect(mock.dispatch).not.toHaveBeenCalled();
  });
});
