/**
 * F09 §4.5 — `GET /api/search?q=` over the local security master. No provider call per keystroke
 * (F03 §4.4): `searchSecurities` (`repositories/security.ts`) is a plain read of stored rows.
 */
import { searchSecurities } from '@/repositories/security';
import type { Queryable } from '@/repositories/client';
import type { SearchResponse } from './contract';

export async function searchTickers(
  query: string,
  asOfInstant: Date,
  db?: Queryable,
): Promise<SearchResponse> {
  const results = await searchSecurities({ q: query, asOfInstant }, db);

  return {
    query,
    results: results.map((result) => ({
      id: result.id,
      symbol: result.symbol,
      name: result.name,
      exchange: result.exchange,
      assetType: result.assetType,
      eligibilityState: result.eligibilityState,
    })),
  };
}
