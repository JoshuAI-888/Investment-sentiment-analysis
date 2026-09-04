import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createFetcher,
  createFixtureFetcher,
  createLiveFetcher,
  DEFAULT_FIXTURE_CASE,
  FIXTURE_CASE_HEADER,
  FixtureNotFoundError,
  readFixture,
} from '@/adapters/fixtures';

async function writeFixture(root: string, provider: string, endpoint: string, fixtureCase: string, file: unknown) {
  const dir = join(root, provider, endpoint);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${fixtureCase}.json`), JSON.stringify(file));
}

function request(overrides: Partial<Parameters<ReturnType<typeof createFixtureFetcher>>[0]> = {}) {
  return {
    url: 'https://example.test/ignored',
    method: 'GET',
    headers: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('F04 §4.2 — the fixture harness', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'fixtures-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads a recorded fixture by provider/endpoint/case', async () => {
    await writeFixture(root, 'substack', 'feed', 'success', {
      status: 200,
      headers: { 'content-type': 'application/rss+xml' },
      body: '<rss></rss>',
    });

    const result = await readFixture('substack', 'feed', 'success', root);

    expect(result).toEqual({
      status: 200,
      headers: { 'content-type': 'application/rss+xml' },
      body: '<rss></rss>',
    });
  });

  it('defaults headers to {} when the fixture omits them', async () => {
    await writeFixture(root, 'fmp', 'quote', 'success', { status: 200, body: { symbol: 'AAPL' } });

    const result = await readFixture('fmp', 'quote', 'success', root);

    expect(result.headers).toEqual({});
  });

  it('throws FixtureNotFoundError rather than inventing a response', async () => {
    await expect(readFixture('reddit', 'listing', 'success', root)).rejects.toThrow(FixtureNotFoundError);
  });

  it('rejects a fixture file missing status or body', async () => {
    await writeFixture(root, 'fmp', 'quote', 'broken', { headers: {} });

    await expect(readFixture('fmp', 'quote', 'broken', root)).rejects.toThrow(/not a valid fixture/);
  });

  describe('createFixtureFetcher', () => {
    it(`serves the "${DEFAULT_FIXTURE_CASE}" case when the caller names none`, async () => {
      await writeFixture(root, 'fmp', 'quote', DEFAULT_FIXTURE_CASE, { status: 200, body: { symbol: 'AAPL' } });
      const fetcher = createFixtureFetcher({ provider: 'fmp', endpoint: 'quote', root });

      const response = await fetcher(request());

      expect(response).toEqual({ status: 200, headers: {}, body: { symbol: 'AAPL' } });
    });

    it('selects the case named on the x-fixture-case header', async () => {
      await writeFixture(root, 'fmp', 'quote', 'rate_limited', {
        status: 429,
        headers: { 'retry-after': '30' },
        body: null,
      });
      const fetcher = createFixtureFetcher({ provider: 'fmp', endpoint: 'quote', root });

      const response = await fetcher(request({ headers: { [FIXTURE_CASE_HEADER]: 'rate_limited' } }));

      expect(response.status).toBe(429);
      expect(response.headers['retry-after']).toBe('30');
    });

    it('never touches the network — a missing fixture fails rather than falling through', async () => {
      const fetcher = createFixtureFetcher({ provider: 'nope', endpoint: 'nope', root });

      await expect(fetcher(request())).rejects.toThrow(FixtureNotFoundError);
    });
  });

  describe('createLiveFetcher', () => {
    it('strips the fixture-case header before building the real request', async () => {
      const originalFetch = globalThis.fetch;
      let seenHeaders: Record<string, string> = {};
      globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        seenHeaders = { ...(init?.headers as Record<string, string>) };
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch;

      try {
        const fetcher = createLiveFetcher();
        const response = await fetcher(
          request({ headers: { [FIXTURE_CASE_HEADER]: 'success', authorization: 'Bearer x' } }),
        );

        expect(seenHeaders).not.toHaveProperty(FIXTURE_CASE_HEADER);
        expect(seenHeaders.authorization).toBe('Bearer x');
        expect(response).toEqual({ status: 200, headers: { 'content-type': 'application/json' }, body: { ok: true } });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('createFetcher', () => {
    it('routes to the fixture fetcher in fixture mode', async () => {
      await writeFixture(root, 'fmp', 'quote', 'success', { status: 200, body: { symbol: 'AAPL' } });

      const fetcher = createFetcher('fixture', { provider: 'fmp', endpoint: 'quote', root });
      const response = await fetcher(request());

      expect(response.body).toEqual({ symbol: 'AAPL' });
    });

    it('routes to a live fetcher in live mode, never reading a fixture file', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ live: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as typeof fetch;

      try {
        // No fixture file exists on disk for this provider/endpoint — live mode must never look.
        const fetcher = createFetcher('live', { provider: 'fmp', endpoint: 'quote', root });
        const response = await fetcher(request());

        expect(response.body).toEqual({ live: true });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
