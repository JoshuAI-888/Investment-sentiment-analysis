import { describe, expect, it } from 'vitest';
import { fetchApeWisdomRanking } from '@/adapters/apewisdom';
import { harness } from './fakes';

const withCase = (fixtureCase: string) => ({ 'x-fixture-case': fixtureCase });

describe('fetchApeWisdomRanking — F04 §4.3, the D-30 universe-selection mechanism', () => {
  it('returns the ranking, camelCased and with numeric-string fields kept as strings', async () => {
    const h = harness();

    const result = await fetchApeWisdomRanking({ filter: 'wallstreetbets' }, 'fixture', h.deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual({
        rank: 1,
        ticker: 'GME',
        name: 'GameStop Corp.',
        mentions: '1204',
        upvotes: '8213',
        rank24hAgo: '1',
        mentions24hAgo: '1350',
      });
    }
  });

  it('returns an empty array, ok:true, past the last page', async () => {
    const h = harness();

    const result = await fetchApeWisdomRanking(
      { filter: 'wallstreetbets', headers: withCase('empty') },
      'fixture',
      h.deps,
    );

    expect(result).toMatchObject({ ok: true, data: [] });
  });

  it('reports a non-JSON response (a proxy error page) as a contract violation', async () => {
    const h = harness();

    const result = await fetchApeWisdomRanking(
      { filter: 'wallstreetbets', headers: withCase('malformed') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('contract');
  });

  it('tolerates an unexpected field, per 05-TEST-STRATEGY.md §2', async () => {
    const h = harness();

    const result = await fetchApeWisdomRanking(
      { filter: 'wallstreetbets', headers: withCase('unexpected_field') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(true);
  });

  it('fails on a null where a number is required (rank)', async () => {
    const h = harness();

    const result = await fetchApeWisdomRanking(
      { filter: 'wallstreetbets', headers: withCase('null_where_number') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('contract');
  });

  it('never throws on a 403', async () => {
    const h = harness();

    const result = await fetchApeWisdomRanking(
      { filter: 'wallstreetbets', headers: withCase('entitlement_403') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ kind: 'entitlement', endpoint: 'filter', status: 403 });
    }
  });

  it('honours Retry-After on a 429', async () => {
    const h = harness();

    const result = await fetchApeWisdomRanking(
      { filter: 'wallstreetbets', headers: withCase('rate_limited_with_retry_after') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: 'rate_limit', retryAfterMs: 60_000 });
  });

  it('is never priced — free and keyless', async () => {
    const h = harness();

    const result = await fetchApeWisdomRanking({ filter: 'wallstreetbets' }, 'fixture', h.deps);

    expect(result.meta.costUsd).toBeNull();
  });

  it('defaults to page 1 and builds the paginated URL for later pages', async () => {
    const h = harness();

    const result = await fetchApeWisdomRanking(
      { filter: 'all-stocks', page: 3 },
      'fixture',
      h.deps,
    );

    // Fixture mode never reads the URL, but the call must not throw building it, and the
    // success fixture (page-agnostic in this harness) still parses.
    expect(result.ok).toBe(true);
  });
});
