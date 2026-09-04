import { describe, expect, it } from 'vitest';
import { fetchFredSeriesObservations } from '@/adapters/fred';
import { harness } from './fakes';

const withCase = (fixtureCase: string) => ({ headers: { 'x-fixture-case': fixtureCase } });

describe('fetchFredSeriesObservations — F04 §4.3, FRED', () => {
  it("maps FRED's '.' missing-value sentinel to null, keeping real values as strings", async () => {
    const h = harness();

    const result = await fetchFredSeriesObservations({ seriesId: 'UNRATE' }, 'fixture', h.deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([
        { date: '2026-06-01', value: '3.1' },
        { date: '2026-07-01', value: null },
        { date: '2026-08-01', value: '2.9' },
      ]);
    }
  });

  it('returns an empty array, ok:true, for a series with no observations in range', async () => {
    const h = harness();

    const result = await fetchFredSeriesObservations(
      { seriesId: 'UNRATE', ...withCase('empty') },
      'fixture',
      h.deps,
    );

    expect(result).toMatchObject({ ok: true, data: [] });
  });

  it('reports a response missing "observations" entirely as a contract violation', async () => {
    const h = harness();

    const result = await fetchFredSeriesObservations(
      { seriesId: 'UNRATE', ...withCase('malformed') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('contract');
  });

  it('tolerates fields the schema does not expect', async () => {
    const h = harness();

    const result = await fetchFredSeriesObservations(
      { seriesId: 'UNRATE', ...withCase('unexpected_field') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(true);
  });

  it('fails the batch on a null where a required string is expected (date)', async () => {
    const h = harness();

    const result = await fetchFredSeriesObservations(
      { seriesId: 'UNRATE', ...withCase('null_required_field') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('contract');
  });

  it('never throws on a 403', async () => {
    const h = harness();

    const result = await fetchFredSeriesObservations(
      { seriesId: 'UNRATE', ...withCase('entitlement_403') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ kind: 'entitlement', endpoint: 'series_observations', status: 403 });
    }
  });

  it('honours Retry-After on a 429', async () => {
    const h = harness();

    const result = await fetchFredSeriesObservations(
      { seriesId: 'UNRATE', ...withCase('rate_limited_with_retry_after') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: 'rate_limit', retryAfterMs: 20_000 });
  });

  it('is never priced — free', async () => {
    const h = harness();

    const result = await fetchFredSeriesObservations({ seriesId: 'UNRATE' }, 'fixture', h.deps);

    expect(result.meta.costUsd).toBeNull();
  });

  it('throws fast in live mode with no apiKey', async () => {
    const h = harness();

    await expect(fetchFredSeriesObservations({ seriesId: 'UNRATE' }, 'live', h.deps)).rejects.toThrow(
      /apiKey is required/,
    );
  });
});
