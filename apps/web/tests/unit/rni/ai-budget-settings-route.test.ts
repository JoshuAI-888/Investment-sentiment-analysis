import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rniAiRouteSetting, rniErrorEnvelope } from '../../../src/rni/contracts';
import { RniAiRouteSettingsError } from '../../../src/rni/settings/ai-route/errors';

const mock = vi.hoisted(() => ({ auth: vi.fn(), create: vi.fn(), get: vi.fn(), update: vi.fn() }));
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
vi.mock('@/rni/settings/ai-route/service', () => ({
  createLiveAiRouteSettingsService: mock.create,
}));
import { GET, PATCH } from '../../../app/api/rni/settings/budgets/route';
import {
  PasswordChangeRequiredError,
  UnauthenticatedError,
  UnauthorizedError,
} from '../../../src/services/auth';

const budgets = {
  manualRunHardUsd: '1',
  fullUniverseHardUsd: '10',
  rolling24hHardUsd: '20',
  monthlyWarningUsd: '100',
  monthlyHardUsd: '200',
  currency: 'USD',
};
const setting = rniAiRouteSetting.parse({
  configVersion: '2',
  aiRoute: 'openai_direct',
  budgets,
  effectiveAt: '2026-09-05T12:00:00.000Z',
  resolvedModels: [
    {
      task: 'rni_verification',
      provider: 'openai',
      modelId: 'gpt-5.6-sol',
      modelRevision: 'revision-1',
      promptVersion: 'rni-verification-v1',
    },
  ],
  options: [
    { aiRoute: 'openai_direct', available: true, unavailableReason: null },
    { aiRoute: 'vercel_ai_gateway', available: false, unavailableReason: 'Not configured.' },
  ],
});
const receipt = (disposition: 'accepted' | 'duplicate' = 'accepted') => ({
  disposition,
  idempotencyKey: 'budget-key',
  previousConfigVersion: '1',
  setting,
});
function request(body: unknown = { budgets, reason: 'Lower future spending' }) {
  return new Request('https://app.test/api/rni/settings/budgets', {
    method: 'PATCH',
    headers: {
      Origin: 'https://app.test',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'budget-key',
    },
    body: JSON.stringify(body),
  });
}
async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const envelope = rniErrorEnvelope.parse(await response.json());
  expect(envelope.error.code).toBe(code);
  return envelope;
}

describe('admin future-run AI budget API', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mock.auth.mockResolvedValue({ userId: 'trusted-admin' });
    mock.create.mockReturnValue({
      getCurrentAiRouteSetting: mock.get,
      updateFutureAiBudgets: mock.update,
    });
    mock.get.mockResolvedValue(setting);
    mock.update.mockResolvedValue(receipt());
  });

  it('reads only authenticated public settings without caching', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ data: setting });
    expect(mock.create).toHaveBeenCalledExactlyOnceWith('trusted-admin');
    expect(mock.auth.mock.invocationCallOrder[0]).toBeLessThan(
      mock.create.mock.invocationCallOrder[0]!,
    );
  });

  it.each([
    [UnauthenticatedError, 401, 'UNAUTHENTICATED'],
    [PasswordChangeRequiredError, 401, 'UNAUTHENTICATED'],
    [UnauthorizedError, 403, 'FORBIDDEN'],
  ] as const)(
    'denies %s before reading the body or constructing storage',
    async (ErrorType, status, code) => {
      mock.auth.mockRejectedValue(new ErrorType());
      const input = request();
      const read = vi.spyOn(input, 'json');
      await error(await GET(), status, code);
      await error(await PATCH(input), status, code);
      expect(read).not.toHaveBeenCalled();
      expect(mock.create).not.toHaveBeenCalled();
    },
  );

  it.each([null, 'https://evil.test', 'http://app.test', 'https://app.test.evil.test'])(
    'rejects origin %s before storage',
    async (origin) => {
      const input = request();
      if (origin === null) input.headers.delete('Origin');
      else input.headers.set('Origin', origin);
      await error(await PATCH(input), 403, 'FORBIDDEN');
      expect(mock.create).not.toHaveBeenCalled();
    },
  );

  it.each([null, '', ' ', 'k'.repeat(201)])(
    'rejects missing or invalid idempotency key %s',
    async (key) => {
      const input = request();
      if (key === null) input.headers.delete('Idempotency-Key');
      else input.headers.set('Idempotency-Key', key);
      await error(await PATCH(input), 400, 'INVALID_REQUEST');
      expect(mock.create).not.toHaveBeenCalled();
    },
  );

  it.each(['accepted', 'duplicate'] as const)(
    'returns the exact %s successor',
    async (disposition) => {
      mock.update.mockResolvedValue(receipt(disposition));
      const response = await PATCH(request({ budgets, reason: '  Lower future spending  ' }));
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ data: receipt(disposition) });
      expect(mock.update).toHaveBeenCalledExactlyOnceWith({
        budgets,
        reason: 'Lower future spending',
        idempotencyKey: 'budget-key',
      });
    },
  );

  it.each([
    ['manualRunHardUsd', '2.01'],
    ['fullUniverseHardUsd', '25.01'],
    ['rolling24hHardUsd', '50.01'],
    ['monthlyWarningUsd', '300.01'],
    ['monthlyHardUsd', '500.01'],
    ['manualRunHardUsd', '0'],
    ['manualRunHardUsd', '-1'],
    ['manualRunHardUsd', '0.001'],
    ['manualRunHardUsd', 'NaN'],
    ['manualRunHardUsd', 'Infinity'],
    ['manualRunHardUsd', '1e0'],
    ['manualRunHardUsd', 1],
    ['fullUniverseHardUsd', '0.50'],
    ['rolling24hHardUsd', '5'],
    ['monthlyWarningUsd', '10'],
    ['monthlyHardUsd', '100'],
    ['currency', 'EUR'],
  ])('rejects invalid, over-ceiling or unordered %s=%s', async (field, value) => {
    await error(
      await PATCH(
        request({ budgets: { ...budgets, [field as string]: value }, reason: 'Invalid change' }),
      ),
      400,
      'INVALID_REQUEST',
    );
    expect(mock.create).not.toHaveBeenCalled();
  });

  it.each([
    {},
    null,
    [],
    { budgets },
    { budgets, reason: ' ' },
    { budgets, reason: 'r'.repeat(501) },
    { budgets: { ...budgets, providerApiKey: 'secret' }, reason: 'Reject unknown field' },
    ...['actorId', 'environment', 'configVersion', 'aiRoute', 'idempotencyKey'].map((field) => ({
      budgets,
      reason: 'Reject client authority',
      [field]: 'caller-owned',
    })),
  ])('rejects incomplete or non-strict intent %j', async (body) => {
    await error(await PATCH(request(body)), 400, 'INVALID_REQUEST');
    expect(mock.create).not.toHaveBeenCalled();
  });

  it('maps malformed JSON to a safe client error', async () => {
    const input = request();
    vi.spyOn(input, 'json').mockRejectedValue(new SyntaxError('private malformed request'));
    await error(await PATCH(input), 400, 'INVALID_REQUEST');
    expect(mock.create).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid', 400, 'INVALID_REQUEST'],
    ['conflict', 409, 'CONFLICT'],
    ['unavailable', 503, 'PROVIDER_UNAVAILABLE'],
  ] as const)('maps service %s safely', async (kind, status, code) => {
    mock.update.mockRejectedValue(new RniAiRouteSettingsError(kind));
    await error(await PATCH(request()), status, code);
  });

  it('never emits credentials from failures or unexpected result fields', async () => {
    mock.get.mockRejectedValue(new Error('secret-provider-token'));
    expect(JSON.stringify(await error(await GET(), 503, 'PROVIDER_UNAVAILABLE'))).not.toContain(
      'secret-provider-token',
    );
    mock.update.mockResolvedValue({ ...receipt(), apiKey: 'secret-provider-token' });
    expect(
      JSON.stringify(await error(await PATCH(request()), 503, 'PROVIDER_UNAVAILABLE')),
    ).not.toContain('secret-provider-token');
  });
});
