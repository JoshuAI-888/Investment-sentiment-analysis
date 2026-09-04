import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  sync: vi.fn(),
}));

vi.mock('@/services/auth', () => {
  class UnauthenticatedError extends Error {}
  class UnauthorizedError extends Error {}
  class PasswordChangeRequiredError extends Error {}
  return {
    requireAdmin: mocks.requireAdmin,
    UnauthenticatedError,
    UnauthorizedError,
    PasswordChangeRequiredError,
  };
});

vi.mock('@/rni/universe/composition', () => ({
  syncFmpUniverseFromEnvironment: mocks.sync,
}));

const { POST } = await import('../../../app/api/rni/universe/sync/route');
const { UnauthenticatedError, UnauthorizedError } = await import('@/services/auth');

function request(headers: Record<string, string> = {}) {
  return new Request('http://localhost:3000/api/rni/universe/sync', {
    method: 'POST',
    headers,
  });
}

describe('POST /api/rni/universe/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ userId: 'joshuai', role: 'admin' });
    mocks.sync.mockResolvedValue({
      ok: true,
      staged: {
        version: { id: '42', status: 'staged' },
        memberCount: 501,
        reused: false,
        impactPreview: { addedSecurityIds: ['new'], removedSecurityIds: ['old'] },
      },
    });
  });

  it('requires same-origin CSRF evidence before synchronization', async () => {
    const response = await POST(request({ 'idempotency-key': 'sync-1' }));
    expect(response.status).toBe(403);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it.each([
    [new UnauthenticatedError(), 401, 'UNAUTHENTICATED'],
    [new UnauthorizedError(), 403, 'FORBIDDEN'],
  ])('maps failed authorization to an error envelope', async (error, status, code) => {
    mocks.requireAdmin.mockRejectedValue(error);
    const response = await POST(
      request({ origin: 'http://localhost:3000', 'idempotency-key': 'sync-auth' }),
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code } });
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('requires an idempotency key', async () => {
    const response = await POST(request({ origin: 'http://localhost:3000' }));
    expect(response.status).toBe(400);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('stages a valid candidate for approval and returns 202', async () => {
    const response = await POST(
      request({
        origin: 'http://localhost:3000',
        'idempotency-key': 'sync-1',
        'x-request-id': 'request-1',
      }),
    );
    expect(response.status).toBe(202);
    expect(mocks.requireAdmin).toHaveBeenCalledOnce();
    expect(mocks.sync).toHaveBeenCalledWith({
      environment: 'development',
      actorId: 'joshuai',
      idempotencyKey: 'sync-1',
      correlationId: 'request-1',
    });
    expect(await response.json()).toMatchObject({
      data: { universeVersion: '42', status: 'staged', memberCount: 501, reused: false },
    });
  });

  it('fails closed with 422 when the provider payload is incomplete', async () => {
    mocks.sync.mockResolvedValue({
      ok: false,
      kind: 'invalid_snapshot',
      issues: [{ code: 'partial_payload', count: 499 }],
    });
    const response = await POST(
      request({ origin: 'http://localhost:3000', 'idempotency-key': 'sync-2' }),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: 'UNIVERSE_SYNC_INVALID', retryable: false },
    });
  });

  it('returns a retryable conflict while the same command key is still running', async () => {
    mocks.sync.mockResolvedValue({
      ok: false,
      kind: 'in_progress',
      retryAt: '2026-09-05T00:02:00.000Z',
    });
    const response = await POST(
      request({ origin: 'http://localhost:3000', 'idempotency-key': 'sync-running' }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'CONFLICT',
        retryable: true,
        details: { retryAt: '2026-09-05T00:02:00.000Z' },
      },
    });
  });

  it('returns a terminal conflict for an abandoned command without leaking its error', async () => {
    mocks.sync.mockResolvedValue({
      ok: false,
      kind: 'command_failed',
      errorCode: 'UNIVERSE_SYNC_COMMAND_ABANDONED',
    });
    const response = await POST(
      request({ origin: 'http://localhost:3000', 'idempotency-key': 'sync-abandoned' }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: 'CONFLICT',
        message: 'This universe synchronization key has a terminal failed outcome.',
        retryable: false,
        requestId: expect.any(String),
        details: { commandState: 'failed' },
      },
    });
  });
});
