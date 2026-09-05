import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rniErrorEnvelope } from '../../../src/rni/contracts';
import { RniScheduleSettingsError } from '../../../src/rni/settings/schedule/errors';

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
vi.mock('@/rni/settings/schedule/service', () => ({
  createLiveScheduleSettingsService: mock.create,
}));
import { GET, POST } from '../../../app/api/rni/schedules/route';
import {
  UnauthenticatedError,
  UnauthorizedError,
  PasswordChangeRequiredError,
} from '../../../src/services/auth';

const intent = {
  enabled: true,
  expectedVersion: 1,
  scheduleType: 'interval',
  scheduleExpression: '7200',
  displayTimezone: 'UTC',
  reason: 'change cadence',
};
function request(body: unknown = intent) {
  return new Request('https://app.test/api/rni/schedules', {
    method: 'POST',
    headers: {
      Origin: 'https://app.test',
      'Idempotency-Key': 'save-key',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}
describe('admin schedule settings API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.auth.mockResolvedValue({ userId: 'trusted-admin' });
    mock.create.mockReturnValue({ getCurrentSchedule: mock.get, updateSchedule: mock.update });
    mock.get.mockResolvedValue({ enabled: true });
    mock.update.mockResolvedValue({ disposition: 'accepted' });
  });
  it('authenticates and returns uncached GET data without accepting a client environment', async () => {
    const response = await GET(new Request('https://app.test/api/rni/schedules?environment=other'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mock.create).toHaveBeenCalledExactlyOnceWith('trusted-admin');
    expect(await response.json()).toEqual({ data: { enabled: true } });
  });
  it.each([
    [UnauthenticatedError, 401],
    [PasswordChangeRequiredError, 401],
    [UnauthorizedError, 403],
  ] as const)(
    'rejects unauthorized access before reading intent (%s)',
    async (ErrorType, status) => {
      mock.auth.mockRejectedValue(new ErrorType());
      expect((await GET(new Request('https://app.test/api/rni/schedules'))).status).toBe(status);
      const input = request();
      const read = vi.spyOn(input, 'json');
      expect((await POST(input)).status).toBe(status);
      expect(read).not.toHaveBeenCalled();
      expect(mock.create).not.toHaveBeenCalled();
    },
  );
  it.each([null, 'null', 'https://evil.test', 'https://app.test.evil.test'])(
    'requires same-origin POST: %s',
    async (origin) => {
      const input = request();
      if (origin === null) input.headers.delete('origin');
      else input.headers.set('origin', origin);
      expect((await POST(input)).status).toBe(403);
      expect(mock.create).not.toHaveBeenCalled();
    },
  );
  it.each([null, ' ', 'x'.repeat(201)])('requires a bounded idempotency key: %s', async (key) => {
    const input = request();
    if (key === null) input.headers.delete('idempotency-key');
    else input.headers.set('idempotency-key', key);
    expect((await POST(input)).status).toBe(400);
    expect(mock.create).not.toHaveBeenCalled();
  });
  it.each([
    'jobId',
    'environment',
    'actorId',
    'scope',
    'nextDueAt',
    'configVersion',
    'idempotencyKey',
    'maxCostUsdPerRun',
  ])('rejects server-owned %s', async (field) => {
    expect((await POST(request({ ...intent, [field]: 'injected' }))).status).toBe(400);
    expect(mock.create).not.toHaveBeenCalled();
  });
  it('passes normalized intent only and maps malformed JSON', async () => {
    expect((await POST(request({ ...intent, reason: '  change cadence  ' }))).status).toBe(200);
    expect(mock.update).toHaveBeenCalledExactlyOnceWith({ ...intent, idempotencyKey: 'save-key' });
    const broken = new Request('https://app.test/api/rni/schedules', {
      method: 'POST',
      headers: { Origin: 'https://app.test', 'Idempotency-Key': 'key' },
      body: '{',
    });
    expect((await POST(broken)).status).toBe(400);
  });
  it.each([
    ['invalid', 400, 'INVALID_REQUEST'],
    ['conflict', 409, 'CONFLICT'],
    ['unavailable', 503, 'PROVIDER_UNAVAILABLE'],
  ] as const)('maps safe %s errors', async (kind, status, code) => {
    mock.update.mockRejectedValue(new RniScheduleSettingsError(kind));
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(rniErrorEnvelope.parse(await response.json()).error.code).toBe(code);
  });
  it('never exposes unexpected database or credential details', async () => {
    mock.get.mockRejectedValue(new Error('credential-private-database-url'));
    const response = await GET(new Request('https://app.test/api/rni/schedules'));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('credential-private');
  });
});
