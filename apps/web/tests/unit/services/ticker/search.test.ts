import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecuritySearchResult } from '@/repositories/security';

const searchSecuritiesMock = vi.fn<() => Promise<SecuritySearchResult[]>>();
vi.mock('@/repositories/security', () => ({ searchSecurities: searchSecuritiesMock }));

const { searchTickers } = await import('@/services/ticker/search');

const NOW = new Date('2026-09-01T00:00:00.000Z');

describe('searchTickers', () => {
  beforeEach(() => {
    searchSecuritiesMock.mockClear();
  });

  it('projects repository results onto the search response contract', async () => {
    searchSecuritiesMock.mockResolvedValueOnce([
      {
        id: '00000000-0000-4000-8000-000000000001',
        symbol: 'GME',
        name: 'GameStop',
        exchange: 'NYSE',
        assetType: 'equity',
        eligibilityState: 'ready',
      },
    ]);

    const response = await searchTickers('GME', NOW);
    expect(response.query).toBe('GME');
    expect(response.results).toHaveLength(1);
    expect(response.results[0]).toMatchObject({ symbol: 'GME', eligibilityState: 'ready' });
  });

  it('never calls a provider — it is a thin projection over the repository read', async () => {
    searchSecuritiesMock.mockResolvedValueOnce([]);
    await searchTickers('', NOW);
    expect(searchSecuritiesMock).toHaveBeenCalledTimes(1);
  });
});
