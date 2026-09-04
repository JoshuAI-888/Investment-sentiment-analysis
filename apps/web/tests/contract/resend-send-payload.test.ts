import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendAuthEmail } from '@/services/auth/mailer';

// Kept alongside this test rather than under `apps/web/fixtures/` — that directory is COLLECT's
// (provider adapter payloads); Resend is this feature's own mail transport, not a domain
// provider, so its frozen fixture belongs with the test that owns it.
const FIXTURES_ROOT = path.join(import.meta.dirname, 'fixtures', 'resend');

async function loadFixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(FIXTURES_ROOT, name), 'utf8'));
}

describe('sendAuthEmail — Resend contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a request whose payload shape matches the frozen fixture response envelope', async () => {
    const fixture = await loadFixture('send_success.json');
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(fixture), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const url = 'https://accounts.joshuai.nz/api/auth/reset-password/tok_482913';
    const result = await sendAuthEmail(
      { to: 'joshuaifang@gmail.com', url, kind: 'reset-password' },
      { apiKey: 'test-key', from: 'welcome@accounts.joshuai.nz' },
    );

    expect(result).toEqual({ ok: true });

    const [fetchedUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(fetchedUrl).toBe('https://api.resend.com/emails');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      from: 'welcome@accounts.joshuai.nz',
      to: 'joshuaifang@gmail.com',
      subject: expect.any(String),
      text: expect.stringContaining(url),
    });
    // Never logged elsewhere — the link appears exactly once, in the body Resend transmits.
    expect(JSON.stringify(result)).not.toContain(url);
  });

  it('a 429 from Resend surfaces as a typed rate_limit error, never a thrown stack trace', async () => {
    const fixture = await loadFixture('send_rate_limited.json');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(fixture), { status: 429 })),
    );

    const result = await sendAuthEmail(
      { to: 'joshuaifang@gmail.com', url: 'https://accounts.joshuai.nz/x', kind: 'verify-email' },
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
      sendAuthEmail(
        { to: 'joshuaifang@gmail.com', url: 'https://accounts.joshuai.nz/y', kind: 'verify-email' },
        { apiKey: 'test-key', from: 'welcome@accounts.joshuai.nz' },
      ),
    ).resolves.toEqual({ ok: false, error: { kind: 'upstream', status: 500 } });
  });
});
