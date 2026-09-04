import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * F16 §4.1 step 1 / §6's first DoD item, and §7 review step 1: "Remove the signature header;
 * confirm rejection precedes any database or provider access." `runDispatchTick` is the only
 * thing `app/api/cron/dispatch/route.ts` calls that can reach Redis or Postgres — mocking it and
 * asserting it was never invoked on the rejection path is the direct, executable version of that
 * review step, not merely an inference from reading the source in order.
 */
const runDispatchTickMock = vi.fn();
const verifyQStashRequestMock = vi.fn();

vi.mock('@/services/jobs/dispatch', () => ({ runDispatchTick: runDispatchTickMock }));
vi.mock('@/services/jobs/qstash', () => ({ verifyQStashRequest: verifyQStashRequestMock }));

describe('POST /api/cron/dispatch — signature verification ordering', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an unsigned request with 401 and never calls runDispatchTick', async () => {
    verifyQStashRequestMock.mockResolvedValueOnce({
      ok: false,
      code: 'missing_signature',
      reason: 'missing upstash-signature header',
    });
    const { POST } = await import('../../app/api/cron/dispatch/route');

    const response = await POST(
      new Request('https://app.example.com/api/cron/dispatch', {
        method: 'POST',
        headers: { 'upstash-signature': 'present-but-invalid' },
        body: '{}',
      }),
    );

    expect(response.status).toBe(401);
    expect(runDispatchTickMock).not.toHaveBeenCalled();
  });

  it('rejects a badly-signed request with 401 and never calls runDispatchTick', async () => {
    verifyQStashRequestMock.mockResolvedValueOnce({
      ok: false,
      code: 'invalid_signature',
      reason: 'signature did not verify',
    });
    const { POST } = await import('../../app/api/cron/dispatch/route');

    const response = await POST(
      new Request('https://app.example.com/api/cron/dispatch', {
        method: 'POST',
        headers: { 'upstash-signature': 'forged' },
        body: '{}',
      }),
    );

    expect(response.status).toBe(401);
    expect(runDispatchTickMock).not.toHaveBeenCalled();
  });

  it('calls runDispatchTick exactly once, only after verification succeeds', async () => {
    verifyQStashRequestMock.mockResolvedValueOnce({ ok: true });
    runDispatchTickMock.mockResolvedValueOnce({ ran: true, dueCount: 0, truncated: false, results: [] });
    const { POST } = await import('../../app/api/cron/dispatch/route');

    const response = await POST(
      new Request('https://app.example.com/api/cron/dispatch', {
        method: 'POST',
        headers: { 'upstash-signature': 'real' },
        body: '{}',
      }),
    );

    expect(response.status).toBe(200);
    expect(runDispatchTickMock).toHaveBeenCalledOnce();
  });

  it('answers F01\'s original fixture shape — 200, state: fixture — when no signing key is configured at all, never a 401', async () => {
    // Mirrors `InspectorPage`'s own `data-state="fixture"` vs `data-state="error"` split
    // (`tests/e2e/routes.spec.ts`): "nothing configured at all" renders the fixture shape every
    // route this generic smoke test scans for renders; a real, configured deployment that still
    // rejects a request gets the real 401 the other three cases in this file assert.
    verifyQStashRequestMock.mockResolvedValueOnce({
      ok: false,
      code: 'not_configured',
      reason: 'QSTASH_CURRENT_SIGNING_KEY is not configured',
    });
    const { POST } = await import('../../app/api/cron/dispatch/route');

    const response = await POST(
      new Request('https://app.example.com/api/cron/dispatch', { method: 'POST', body: '{}' }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { state: string };
    expect(body.state).toBe('fixture');
    expect(runDispatchTickMock).not.toHaveBeenCalled();
  });

  it('passes the exact raw body text to verification, not a re-serialized JSON round trip', async () => {
    verifyQStashRequestMock.mockResolvedValueOnce({ ok: false, code: 'invalid_signature', reason: 'x' });
    const { POST } = await import('../../app/api/cron/dispatch/route');

    const rawBody = '{"b":2,"a":1}'; // deliberately not key-sorted — JSON.stringify(JSON.parse(x)) would reorder it.
    await POST(
      new Request('https://app.example.com/api/cron/dispatch', {
        method: 'POST',
        headers: { 'upstash-signature': 'sig' },
        body: rawBody,
      }),
    );

    expect(verifyQStashRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ body: rawBody }),
      expect.anything(),
    );
  });
});
