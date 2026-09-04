import { describe, expect, it } from 'vitest';
import { fetchMarketauxNews } from '@/adapters/marketaux';
import { harness } from './fakes';

const withCase = (fixtureCase: string) => ({ headers: { 'x-fixture-case': fixtureCase } });

describe('fetchMarketauxNews — F04 §4.3, Marketaux (100 req/day free tier)', () => {
  it('returns articles with entities, keeping a null sentiment score as null', async () => {
    const h = harness();

    const result = await fetchMarketauxNews({ symbols: ['AAPL'] }, 'fixture', h.deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0]?.entities[0]).toEqual({
        symbol: 'AAPL',
        name: 'Apple Inc.',
        sentimentScore: 0.42,
      });
      expect(result.data[1]?.entities[0]?.sentimentScore).toBeNull();
    }
  });

  it('returns an empty array, ok:true, when nothing matches', async () => {
    const h = harness();

    const result = await fetchMarketauxNews(
      { symbols: ['ZZZZ'], ...withCase('empty') },
      'fixture',
      h.deps,
    );

    expect(result).toMatchObject({ ok: true, data: [] });
  });

  it("reports a quota-exceeded error envelope (200, no 'data') as a contract violation", async () => {
    const h = harness();

    const result = await fetchMarketauxNews(
      { symbols: ['AAPL'], ...withCase('malformed') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('contract');
  });

  it('tolerates fields the schema does not expect', async () => {
    const h = harness();

    const result = await fetchMarketauxNews(
      { symbols: ['AAPL'], ...withCase('unexpected_field') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(true);
  });

  it('fails the batch on a null where a required string is expected (entity symbol)', async () => {
    const h = harness();

    const result = await fetchMarketauxNews(
      { symbols: ['AAPL'], ...withCase('null_required_field') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('contract');
  });

  it('never throws on a 403', async () => {
    const h = harness();

    const result = await fetchMarketauxNews(
      { symbols: ['AAPL'], ...withCase('entitlement_403') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ kind: 'entitlement', endpoint: 'news_all', status: 403 });
    }
  });

  it('honours Retry-After on a 429', async () => {
    const h = harness();

    const result = await fetchMarketauxNews(
      { symbols: ['AAPL'], ...withCase('rate_limited_with_retry_after') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: 'rate_limit', retryAfterMs: 3_600_000 });
  });

  it('is never priced — the daily-count ledger is the constraint, not a per-call price', async () => {
    const h = harness();

    const result = await fetchMarketauxNews({ symbols: ['AAPL'] }, 'fixture', h.deps);

    expect(result.meta.costUsd).toBeNull();
  });

  it('throws fast in live mode with no apiKey', async () => {
    const h = harness();

    await expect(fetchMarketauxNews({ symbols: ['AAPL'] }, 'live', h.deps)).rejects.toThrow(
      /apiKey is required/,
    );
  });
});
