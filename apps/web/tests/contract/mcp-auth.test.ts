import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * F21 §6 DoD: "Server authentication is required; an unauthenticated caller reaches no priced
 * provider and no LLM." §7 review step 4 is about the write path, but the same "rejection
 * precedes any access" discipline `tests/contract/qstash-signature.test.ts` (F16) already applies
 * to its own route belongs here too: mock `requireUser()` to throw, and assert `handleJsonRpc` —
 * the only thing `app/api/mcp/route.ts` calls that can reach a repository, a provider or an LLM —
 * is never invoked on the unauthenticated path.
 */
const requireUserMock = vi.fn();
const handleJsonRpcMock = vi.fn();

vi.mock('@/services/auth', async () => {
  const actual = await vi.importActual('@/services/auth');
  return { ...actual, requireUser: requireUserMock };
});
vi.mock('@/services/mcp/server', () => ({ handleJsonRpc: handleJsonRpcMock }));

describe('POST /api/mcp — authentication ordering', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an unauthenticated request with 401 and never calls handleJsonRpc', async () => {
    const { UnauthenticatedError } = await import('@/services/auth');
    requireUserMock.mockRejectedValueOnce(new UnauthenticatedError());
    const { POST } = await import('../../app/api/mcp/route');

    const response = await POST(
      new Request('https://app.example.com/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    );

    expect(response.status).toBe(401);
    expect(handleJsonRpcMock).not.toHaveBeenCalled();
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/unauthenticated/i);
  });

  it('rejects a session mid-password-change with 401 and never calls handleJsonRpc', async () => {
    const { PasswordChangeRequiredError } = await import('@/services/auth');
    requireUserMock.mockRejectedValueOnce(new PasswordChangeRequiredError());
    const { POST } = await import('../../app/api/mcp/route');

    const response = await POST(
      new Request('https://app.example.com/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    );

    expect(response.status).toBe(401);
    expect(handleJsonRpcMock).not.toHaveBeenCalled();
  });

  it('calls handleJsonRpc only once requireUser resolves', async () => {
    requireUserMock.mockResolvedValueOnce({ userId: 'u1', email: 'owner@example.com', sessionId: 's1', expiresAt: new Date().toISOString(), mustChangePassword: false });
    handleJsonRpcMock.mockResolvedValueOnce({ jsonrpc: '2.0', id: 1, result: { tools: [] } });
    const { POST } = await import('../../app/api/mcp/route');

    const response = await POST(
      new Request('https://app.example.com/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    );

    expect(response.status).toBe(200);
    expect(handleJsonRpcMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-JSON body with a JSON-RPC parse error before ever calling handleJsonRpc', async () => {
    requireUserMock.mockResolvedValueOnce({ userId: 'u1', email: 'owner@example.com', sessionId: 's1', expiresAt: new Date().toISOString(), mustChangePassword: false });
    const { POST } = await import('../../app/api/mcp/route');

    const response = await POST(
      new Request('https://app.example.com/api/mcp', { method: 'POST', body: 'not json' }),
    );

    expect(response.status).toBe(400);
    expect(handleJsonRpcMock).not.toHaveBeenCalled();
  });
});
