import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendOtpEmail } from '@/services/auth/mailer';

// Kept alongside this test rather than under `apps/web/fixtures/` — that directory is COLLECT's
// (provider adapter payloads); Resend is this feature's own mail transport, not a domain
// provider, so its frozen fixture belongs with the test that owns it.
const FIXTURES_ROOT = path.join(import.meta.dirname, 'fixtures', 'resend');

async function loadFixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(FIXTURES_ROOT, name), 'utf8'));
}

describe('sendOtpEmail — Resend contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a request whose payload shape matches the frozen fixture response envelope', async () => {
    const fixture = await loadFixture('send_success.json');
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(fixture), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendOtpEmail(
      { to: 'joshuaifang@gmail.com', otp: '482913', type: 'sign-in' },
      { apiKey: 'test-key', from: 'welcome@accounts.joshuai.nz' },
    );

    expect(result).toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      from: 'welcome@accounts.joshuai.nz',
      to: 'joshuaifang@gmail.com',
      subject: expect.any(String),
      text: expect.stringContaining('482913'),
    });
    // Never a plaintext label, never logged elsewhere — the code appears exactly once, in the
    // body Resend transmits, and nowhere in `result`.
    expect(JSON.stringify(result)).not.toContain('482913');
  });

  it('a 429 from Resend surfaces as a typed rate_limit error, never a thrown stack trace', async () => {
    const fixture = await loadFixture('send_rate_limited.json');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(fixture), { status: 429 })),
    );

    const result = await sendOtpEmail(
      { to: 'joshuaifang@gmail.com', otp: '111111', type: 'sign-in' },
      { apiKey: 'test-key', from: 'welcome@accounts.joshuai.nz' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'rate_limit', retryAfterMs: expect.any(Number) });
  });

  it('never throws for an upstream failure — the caller always gets a typed result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'nope', statusCode: 500, name: 'application_error' }), { status: 500 })),
    );

    await expect(
      sendOtpEmail(
        { to: 'joshuaifang@gmail.com', otp: '222222', type: 'sign-in' },
        { apiKey: 'test-key', from: 'welcome@accounts.joshuai.nz' },
      ),
    ).resolves.toEqual({ ok: false, error: { kind: 'upstream', status: 500 } });
  });
});
