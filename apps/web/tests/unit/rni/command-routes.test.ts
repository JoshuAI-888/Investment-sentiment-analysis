import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rniErrorEnvelope, rniManualRefreshResult } from '../../../src/rni/contracts';
import { RniOrchestrationError } from '../../../src/rni/orchestration/budget';

const mock = vi.hoisted(() => ({
  auth: vi.fn(),
  create: vi.fn(),
  refresh: vi.fn(),
  rerun: vi.fn(),
}));
vi.mock('@/env', () => ({ env: { APP_BASE_URL: 'https://app.test' } }));
vi.mock('@/services/auth', () => {
  class UnauthenticatedError extends Error {}
  class UnauthorizedError extends Error {}
  class PasswordChangeRequiredError extends Error {}
  return {
    requireAdmin: mock.auth,
    UnauthenticatedError,
    UnauthorizedError,
    PasswordChangeRequiredError,
  };
});
vi.mock('@/rni/orchestration/composition', () => ({ createLiveRniRefreshService: mock.create }));

import { POST as requestRefresh } from '../../../app/api/rni/runs/route';
import { POST as requestRetry } from '../../../app/api/rni/runs/[runId]/retry/route';
import {
  PasswordChangeRequiredError,
  UnauthenticatedError,
  UnauthorizedError,
} from '../../../src/services/auth';

const RUN_ID = '00000000-0000-4000-8000-000000000901';
const REQUEST_ID = 'rni-command-request';
type Route = 'refresh' | 'retry';
const routes = ['refresh', 'retry'] as const;
const result = (disposition: 'accepted' | 'duplicate' = 'accepted') =>
  rniManualRefreshResult.parse({
    disposition,
    runId: RUN_ID,
    idempotencyKey: 'command-key',
    scopePreview: { kind: 'full_universe', universeVersion: 'universe-v1', securityCount: 2 },
  });

function request(
  route: Route,
  body = route === 'refresh' ? '{"scope":{"kind":"full_universe"}}' : '',
) {
  return new Request(
    `https://app.test/api/rni/runs${route === 'retry' ? `/${RUN_ID}/retry` : ''}`,
    {
      method: 'POST',
      headers: {
        Origin: 'https://app.test',
        'Idempotency-Key': 'command-key',
        'Content-Type': 'application/json',
        'X-Request-Id': REQUEST_ID,
      },
      body,
    },
  );
}

function invoke(route: Route, input = request(route), runId = RUN_ID) {
  return route === 'refresh'
    ? requestRefresh(input)
    : requestRetry(input, { params: Promise.resolve({ runId }) });
}

async function expectError(response: Response, status: number, code: string, retryable = false) {
  expect(response.status).toBe(status);
  const envelope = rniErrorEnvelope.parse(await response.json());
  expect(envelope.error).toMatchObject({ code, retryable, requestId: REQUEST_ID });
  return envelope;
}

describe('RNI manual refresh and retry command HTTP routes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mock.auth.mockResolvedValue({ userId: 'trusted-admin' });
    mock.create.mockResolvedValue({ requestManualRefresh: mock.refresh, rerun: mock.rerun });
    mock.refresh.mockResolvedValue(result());
    mock.rerun.mockResolvedValue(result());
  });

  describe.each(routes)('%s command', (route) => {
    it.each([
      ['anonymous', 401, 'UNAUTHENTICATED'],
      ['password-change-required', 401, 'UNAUTHENTICATED'],
      ['non-admin', 403, 'FORBIDDEN'],
    ] as const)(
      'rejects %s before body parsing or storage construction',
      async (kind, status, code) => {
        mock.auth.mockRejectedValue(
          kind === 'anonymous'
            ? new UnauthenticatedError()
            : kind === 'non-admin'
              ? new UnauthorizedError()
              : new PasswordChangeRequiredError(),
        );
        const input = request(route, 'not-json');
        input.headers.delete('Origin');
        const bodyRead = vi.spyOn(input, route === 'refresh' ? 'json' : 'text');
        await expectError(await invoke(route, input), status, code);
        expect(bodyRead).not.toHaveBeenCalled();
        expect(mock.create).not.toHaveBeenCalled();
        expect(mock.refresh).not.toHaveBeenCalled();
        expect(mock.rerun).not.toHaveBeenCalled();
      },
    );

    it.each([null, 'https://evil.test', 'http://app.test', 'https://app.test.evil.test', 'null'])(
      'rejects origin %s before storage',
      async (origin) => {
        const input = request(route);
        if (origin === null) input.headers.delete('Origin');
        else input.headers.set('Origin', origin);
        await expectError(await invoke(route, input), 403, 'FORBIDDEN');
        expect(mock.auth).toHaveBeenCalledOnce();
        expect(mock.create).not.toHaveBeenCalled();
      },
    );

    it.each([null, '', '   ', 'x'.repeat(201)])(
      'rejects missing, blank, or oversized key %s before storage',
      async (key) => {
        const input = request(route);
        if (key === null) input.headers.delete('Idempotency-Key');
        else input.headers.set('Idempotency-Key', key);
        await expectError(await invoke(route, input), 400, 'INVALID_REQUEST');
        expect(mock.create).not.toHaveBeenCalled();
      },
    );

    it.each(['accepted', 'duplicate'] as const)(
      'maps %s with unchanged identity and no-store',
      async (disposition) => {
        const output = result(disposition);
        mock.refresh.mockResolvedValue(output);
        mock.rerun.mockResolvedValue(output);
        const response = await invoke(route);
        expect(response.status).toBe(disposition === 'accepted' ? 202 : 200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.json()).toEqual({ data: output });
        expect(mock.create).toHaveBeenCalledExactlyOnceWith('trusted-admin');
        expect(mock.auth.mock.invocationCallOrder[0]).toBeLessThan(
          mock.create.mock.invocationCallOrder[0]!,
        );
      },
    );

    it('passes a trimmed header key, including the exact maximum length', async () => {
      const key = 'k'.repeat(200);
      const input = request(route);
      input.headers.set('Idempotency-Key', ` ${key} `);
      expect((await invoke(route, input)).status).toBe(202);
      expect(route === 'refresh' ? mock.refresh : mock.rerun).toHaveBeenCalledWith(
        route === 'refresh'
          ? { idempotencyKey: key, scope: { kind: 'full_universe' } }
          : { idempotencyKey: key, runId: RUN_ID },
      );
    });

    it.each([
      ['NOT_FOUND', 404, 'RUN_NOT_FOUND', false],
      ['INVALID_PLAN', 400, 'INVALID_REQUEST', false],
      ['BUDGET_RUN', 429, 'BUDGET_EXHAUSTED', false],
      ['BUDGET_DAY', 429, 'BUDGET_EXHAUSTED', false],
      ['BUDGET_MONTH', 429, 'BUDGET_EXHAUSTED', false],
      ['CONFLICT', 409, 'CONFLICT', false],
      ['STALE_EXECUTION', 409, 'CONFLICT', true],
      ['NOT_DUE', 409, 'CONFLICT', true],
    ] as const)(
      'maps %s to its safe public error',
      async (internalCode, status, publicCode, retryable) => {
        const error = new RniOrchestrationError(internalCode);
        mock.refresh.mockRejectedValue(error);
        mock.rerun.mockRejectedValue(error);
        await expectError(await invoke(route), status, publicCode, retryable);
      },
    );

    it.each(['construction', 'command'] as const)(
      'sanitizes unexpected %s failures',
      async (stage) => {
        const error = new Error('secret-token postgres-password provider-private-response');
        if (stage === 'construction') mock.create.mockRejectedValue(error);
        else {
          mock.refresh.mockRejectedValue(error);
          mock.rerun.mockRejectedValue(error);
        }
        const envelope = await expectError(await invoke(route), 503, 'PROVIDER_UNAVAILABLE', true);
        expect(JSON.stringify(envelope)).not.toMatch(
          /secret-token|postgres-password|provider-private-response/,
        );
      },
    );
  });

  it.each([{ kind: 'ticker', ticker: 'NVDA' }, { kind: 'full_universe' }])(
    'passes only valid scope %j and header intent',
    async (scope) => {
      expect((await invoke('refresh', request('refresh', JSON.stringify({ scope })))).status).toBe(
        202,
      );
      expect(mock.refresh).toHaveBeenCalledExactlyOnceWith({
        scope,
        idempotencyKey: 'command-key',
      });
      expect(mock.rerun).not.toHaveBeenCalled();
    },
  );

  it.each([
    {},
    null,
    [],
    { scope: { kind: 'ticker', ticker: 'nvda' } },
    { scope: { kind: 'ticker', ticker: 'NVDA', securityId: RUN_ID } },
    { scope: { kind: 'full_universe', tickers: ['NVDA'] } },
    ...['actorId', 'configVersion', 'universeVersion', 'modelId', 'idempotencyKey'].map((key) => ({
      scope: { kind: 'full_universe' },
      [key]: 'caller-owned',
    })),
  ])('rejects non-strict manual intent %j before storage', async (body) => {
    await expectError(
      await invoke('refresh', request('refresh', JSON.stringify(body))),
      400,
      'INVALID_REQUEST',
    );
    expect(mock.create).not.toHaveBeenCalled();
  });

  it.each(['', '{', 'not-json'])(
    'maps malformed manual JSON %j to a client error before storage',
    async (body) => {
      await expectError(await invoke('refresh', request('refresh', body)), 400, 'INVALID_REQUEST');
      expect(mock.create).not.toHaveBeenCalled();
    },
  );

  it.each(['', ' \n ', '{}', ' {} \n'])(
    'accepts empty retry body %j with the path UUID only',
    async (body) => {
      expect((await invoke('retry', request('retry', body))).status).toBe(202);
      expect(mock.rerun).toHaveBeenCalledExactlyOnceWith({
        runId: RUN_ID,
        idempotencyKey: 'command-key',
      });
      expect(mock.refresh).not.toHaveBeenCalled();
    },
  );

  it.each([
    'null',
    '[]',
    '{',
    '{"runId":"crossed"}',
    '{"scope":{"kind":"full_universe"}}',
    '{"actorId":"caller"}',
  ])('rejects non-empty retry body %j before storage', async (body) => {
    await expectError(await invoke('retry', request('retry', body)), 400, 'INVALID_REQUEST');
    expect(mock.create).not.toHaveBeenCalled();
  });

  it.each(['not-a-uuid', '', '00000000-0000-4000-8000-00000000090z'])(
    'rejects malformed retry UUID %j before storage',
    async (runId) => {
      await expectError(await invoke('retry', request('retry'), runId), 400, 'INVALID_REQUEST');
      expect(mock.create).not.toHaveBeenCalled();
    },
  );
});
