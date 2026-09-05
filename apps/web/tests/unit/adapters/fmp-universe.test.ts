import { describe, expect, it } from 'vitest';
import { fetchFmpSp500Constituents } from '@/adapters/fmp-universe';
import { harness, ok } from './fakes';

function members(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    symbol: index === 0 ? 'NVDA' : `T${String(index).padStart(3, '0')}`,
    name: index === 0 ? 'NVIDIA Corporation' : `Company ${index}`,
    sector: 'Information Technology',
    subSector: 'Semiconductors',
    headQuarter: 'Fixture City',
    dateFirstAdded: '2020-01-01',
    cik: String(index),
    founded: '2000',
    futureProviderField: 'tolerated',
  }));
}

describe('fetchFmpSp500Constituents', () => {
  it('accepts a complete response above 500 rows and records a payload hash', async () => {
    const response = members(501);
    const h = harness({ responses: [ok(response)] });

    const result = await fetchFmpSp500Constituents(
      { apiKey: 'test-only' },
      'live',
      h.deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.constituents).toHaveLength(501);
    expect(result.data.constituents[0]?.futureProviderField).toBe('tolerated');
    expect(result.data.payloadSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(h.logs[0]).toMatchObject({ provider: 'fmp', operation: 'sp500_constituent' });
  });

  it('fails closed on a malformed constituent row', async () => {
    const h = harness({ responses: [ok([{ symbol: 'NVDA', name: null }])] });
    const result = await fetchFmpSp500Constituents(
      { apiKey: 'test-only' },
      'live',
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('contract');
  });

  it('requires a key before a live request is attempted', async () => {
    const h = harness({ responses: [ok(members(501))] });
    await expect(fetchFmpSp500Constituents({}, 'live', h.deps)).rejects.toThrow(
      /apiKey is required/u,
    );
    expect(h.calls()).toBe(0);
  });
});
