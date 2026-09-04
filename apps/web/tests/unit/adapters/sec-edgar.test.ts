import { describe, expect, it } from 'vitest';
import { fetchCompanySubmissions, padCik } from '@/adapters/sec-edgar';
import { harness } from './fakes';

const withCase = (fixtureCase: string) => ({ headers: { 'x-fixture-case': fixtureCase } });

describe('padCik', () => {
  it('zero-pads to 10 digits', () => {
    expect(padCik('320193')).toBe('0000320193');
  });

  it('leaves an already-padded CIK alone', () => {
    expect(padCik('0000320193')).toBe('0000320193');
  });
});

describe('fetchCompanySubmissions — F04 §4.3, SEC EDGAR', () => {
  it('zips the column-of-arrays filings shape into one row per filing', async () => {
    const h = harness();

    const result = await fetchCompanySubmissions({ cik: '320193' }, 'fixture', h.deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.name).toBe('Apple Inc.');
      expect(result.data.recentFilings).toEqual([
        {
          accessionNumber: '0000320193-26-000012',
          filingDate: '2026-08-01',
          reportDate: '2026-06-27',
          form: '10-Q',
          primaryDocument: 'aapl-20260627.htm',
        },
        {
          accessionNumber: '0000320193-26-000011',
          filingDate: '2026-05-02',
          reportDate: '2026-03-28',
          form: '10-Q',
          primaryDocument: 'aapl-20260328.htm',
        },
      ]);
    }
  });

  it('returns no filings, ok:true, for a registrant with none yet', async () => {
    const h = harness();

    const result = await fetchCompanySubmissions(
      { cik: '1234567', ...withCase('empty') },
      'fixture',
      h.deps,
    );

    expect(result).toMatchObject({ ok: true, data: { recentFilings: [] } });
  });

  it("reports SEC's undeclared-agent HTML error page as a contract violation, not a crash", async () => {
    const h = harness();

    const result = await fetchCompanySubmissions({ cik: '320193', ...withCase('malformed') }, 'fixture', h.deps);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('contract');
  });

  it('tolerates fields the schema does not expect', async () => {
    const h = harness();

    const result = await fetchCompanySubmissions(
      { cik: '320193', ...withCase('unexpected_field') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(true);
  });

  it('never throws on a 403', async () => {
    const h = harness();

    const result = await fetchCompanySubmissions({ cik: '320193', ...withCase('entitlement_403') }, 'fixture', h.deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ kind: 'entitlement', endpoint: 'submissions', status: 403 });
    }
  });

  it('honours Retry-After on a 429', async () => {
    const h = harness();

    const result = await fetchCompanySubmissions(
      { cik: '320193', ...withCase('rate_limited_with_retry_after') },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: 'rate_limit', retryAfterMs: 5_000 });
  });

  it('is never priced — free (source §4.3)', async () => {
    const h = harness();

    const result = await fetchCompanySubmissions({ cik: '320193' }, 'fixture', h.deps);

    expect(result.meta.costUsd).toBeNull();
  });

  it('throws fast in live mode with no userAgent — SEC blocks generic agents', async () => {
    const h = harness();

    await expect(fetchCompanySubmissions({ cik: '320193' }, 'live', h.deps)).rejects.toThrow(
      /userAgent is required/,
    );
  });
});
