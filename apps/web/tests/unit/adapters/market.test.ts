import { describe, expect, it } from 'vitest';
import { fetchDailyBars } from '@/adapters/market';
import { harness } from './fakes';

const withCase = (fixtureCase: string) => ({ 'x-fixture-case': fixtureCase });

describe('fetchDailyBars — F04 §4.3, market data (MT-14 / D-31: FMP Starter daily bars)', () => {
  it('returns parsed daily bars for the success fixture', async () => {
    const h = harness();

    const result = await fetchDailyBars({ symbol: 'AAPL' }, 'fixture', h.deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual({
        date: '2026-08-28',
        open: 230.12,
        high: 233.4,
        low: 229.8,
        close: 232.1,
        volume: 54321000,
      });
    }
  });

  it('returns an empty array, ok:true, for a symbol with no history', async () => {
    const h = harness();

    const result = await fetchDailyBars(
      { symbol: 'ZZZZ', headers: withCase('empty') },
      'fixture',
      h.deps,
    );

    expect(result).toMatchObject({ ok: true, data: [] });
  });

  it("reports FMP's 200-with-an-error-body quirk as a contract violation, not a crash", async () => {
    const h = harness();

    const result = await fetchDailyBars(
      { symbol: 'AAPL', headers: withCase('malformed') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('contract');
  });

  it('tolerates a field the schema does not expect — passes, per 05-TEST-STRATEGY.md §2', async () => {
    const h = harness();

    const result = await fetchDailyBars(
      { symbol: 'AAPL', headers: withCase('unexpected_field') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toHaveLength(1);
  });

  it('fails the whole batch on a null where a number is required, per the same policy', async () => {
    const h = harness();

    const result = await fetchDailyBars(
      { symbol: 'AAPL', headers: withCase('null_where_number') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('contract');
  });

  it('never throws on a 403', async () => {
    const h = harness();

    const result = await fetchDailyBars(
      { symbol: 'AAPL', headers: withCase('entitlement_403') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ kind: 'entitlement', endpoint: 'historical_price_full', status: 403 });
    }
  });

  it('honours Retry-After on a 429', async () => {
    const h = harness();

    const result = await fetchDailyBars(
      { symbol: 'AAPL', headers: withCase('rate_limited_with_retry_after') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: 'rate_limit', retryAfterMs: 10_000 });
  });

  it('is never priced — costUsd stays null (flat-tier subscription, source §4.3)', async () => {
    const h = harness();

    const result = await fetchDailyBars({ symbol: 'AAPL' }, 'fixture', h.deps);

    expect(result.meta.costUsd).toBeNull();
  });

  it('throws fast in live mode with no apiKey, rather than sending an unauthenticated request', async () => {
    const h = harness();

    await expect(fetchDailyBars({ symbol: 'AAPL' }, 'live', h.deps)).rejects.toThrow(/apiKey is required/);
  });
});
