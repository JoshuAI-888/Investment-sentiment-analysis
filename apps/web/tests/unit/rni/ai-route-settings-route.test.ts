import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rniErrorEnvelope } from '../../../src/rni/contracts';
import { RniAiRouteSettingsError } from '../../../src/rni/settings/ai-route/errors';

const mock = vi.hoisted(() => ({ auth: vi.fn(), get: vi.fn(), update: vi.fn(), create: vi.fn() }));
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
import { GET, PATCH } from '../../../app/api/rni/settings/route';
import { UnauthenticatedError, UnauthorizedError } from '../../../src/services/auth';

const request = (
  body: unknown = { aiRoute: 'vercel_ai_gateway', reason: 'Switch approved route' },
  headers: Record<string, string> = {},
) =>
  new Request('https://app.test/api/rni/settings', {
    method: 'PATCH',
    headers: {
      Origin: 'https://app.test',
      'Idempotency-Key': 'settings-key',
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });

describe('live AI route settings API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.auth.mockResolvedValue({ userId: 'operator' });
    mock.create.mockReturnValue({
      getCurrentAiRouteSetting: mock.get,
      updateFutureAiRoute: mock.update,
    });
    mock.get.mockResolvedValue({ selected: 'safe-public-value' });
    mock.update.mockResolvedValue({ disposition: 'accepted' });
  });
  it('authenticates GET and returns uncached safe data', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mock.create).toHaveBeenCalledWith('operator');
    expect(await response.json()).toEqual({ data: { selected: 'safe-public-value' } });
  });
  it.each([
    ['anonymous', 401],
    ['nonadmin', 403],
  ] as const)('rejects %s before service access', async (kind, status) => {
    mock.auth.mockRejectedValue(
      kind === 'anonymous' ? new UnauthenticatedError() : new UnauthorizedError(),
    );
    expect((await GET()).status).toBe(status);
    expect((await PATCH(request())).status).toBe(status);
    expect(mock.create).not.toHaveBeenCalled();
  });
  it('requires same origin and a bounded idempotency header', async () => {
    const missingOrigin = request();
    missingOrigin.headers.delete('Origin');
    expect((await PATCH(missingOrigin)).status).toBe(403);
    expect((await PATCH(request(undefined, { Origin: 'https://evil.test' }))).status).toBe(403);
    expect((await PATCH(request(undefined, { 'Idempotency-Key': '' }))).status).toBe(400);
    expect((await PATCH(request(undefined, { 'Idempotency-Key': 'x'.repeat(201) }))).status).toBe(
      400,
    );
    expect(mock.update).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON without reaching the service', async () => {
    const malformed = new Request('https://app.test/api/rni/settings', {
      method: 'PATCH',
      headers: { Origin: 'https://app.test', 'Idempotency-Key': 'key' },
      body: '{',
    });
    expect((await PATCH(malformed)).status).toBe(400);
    expect(mock.update).not.toHaveBeenCalled();
  });
  it('rejects client-owned model, config, actor or body key fields', async () => {
    for (const extra of ['modelId', 'configVersion', 'actorId', 'idempotencyKey']) {
      expect(
        (
          await PATCH(
            request({ aiRoute: 'vercel_ai_gateway', reason: 'valid', [extra]: 'forbidden' }),
          )
        ).status,
      ).toBe(400);
    }
    expect(mock.update).not.toHaveBeenCalled();
  });
  it('passes only normalized intent and the header key', async () => {
    expect((await PATCH(request({ aiRoute: 'vercel_ai_gateway', reason: ' valid ' }))).status).toBe(
      200,
    );
    expect(mock.update).toHaveBeenCalledWith({
      aiRoute: 'vercel_ai_gateway',
      reason: 'valid',
      idempotencyKey: 'settings-key',
    });
  });
  it('returns frozen safe errors for conflicts and unexpected failures', async () => {
    mock.update.mockRejectedValue(new RniAiRouteSettingsError('conflict'));
    const conflict = await PATCH(request());
    expect(conflict.status).toBe(409);
    expect(rniErrorEnvelope.parse(await conflict.json()).error.retryable).toBe(false);
    mock.get.mockRejectedValue(new Error('secret-token provider-private-capability-id'));
    const failed = await GET();
    expect(failed.status).toBe(503);
    const body = await failed.json();
    expect(rniErrorEnvelope.parse(body).error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(JSON.stringify(body)).not.toContain('secret-token');
  });
});
