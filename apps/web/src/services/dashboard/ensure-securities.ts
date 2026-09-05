/**
 * Idempotently ensures the market proxy and the 11 sector proxy ETFs exist as `security` rows.
 *
 * **Consumes, does not add, repository functions.** `findSecurityBySymbol`/`insertSecurity`
 * (`repositories/security.ts`) already exist — this file only calls them. `MEMORY.md` B-20
 * excluded ETFs from the 100-symbol seed universe by owner decision, so these proxies are a
 * disjoint, fixed set this feature is responsible for seeding on first use, not part of
 * `migrations/seed/universe-v1.json`.
 */
import type { Security } from '@/contracts/security';
import { findSecurityBySymbol, insertSecurity } from '@/repositories/security';
import type { Queryable } from '@/repositories/client';
import { MARKET_PROXY_EXCHANGE, MARKET_PROXY_SYMBOL, SECTOR_PROXIES, SECTOR_PROXY_EXCHANGE } from './sector-proxies';

async function ensure(symbol: string, exchange: string, name: string, db?: Queryable): Promise<Security> {
  const existing = await findSecurityBySymbol(symbol, exchange, db);
  if (existing !== null) return existing;

  return insertSecurity(
    {
      symbol,
      name,
      exchange,
      assetType: 'etf',
      sector: null,
      industry: null,
      cik: null,
      currency: 'USD',
      active: true,
      // **Workaround for a real bug in `insertSecurity` (`repositories/security.ts`), reported
      // under this feature's `CONTRACTS`.** `insertClause` (`repositories/rows.ts`) passes a
      // JS value straight through as a query parameter with no JSON serialization —
      // `insertCalculationSnapshot` (`repositories/calculations.ts`) works around this itself
      // by `JSON.stringify`-ing every jsonb column before calling `insertClause`;
      // `insertSecurity` does not do the same for `aliases`.
      //
      // **This is not only an empty-array bug.** node-postgres serializes *any* plain JS array
      // — empty or not — using Postgres's own array-literal text form, never JSON, because the
      // driver has no idea the target column is `jsonb`; it only sees a JS array. For `[]` that
      // form happens to be the two characters `{}`, which is valid Postgres array syntax and,
      // coincidentally, also valid JSON — for an *empty object* — so an empty `aliases` fails
      // quietly (reads back as `{}`, not `[]`). For a **non-empty** array, e.g. `['ACME']`, the
      // same serialization produces `{"ACME"}` (a one-element Postgres array literal), which is
      // not valid JSON at all — cast to `aliases jsonb`, Postgres raises `ERROR: invalid input
      // syntax for type json` directly (reproduced against a real database). So `insertSecurity`
      // fails on an empty aliases array **and** on every non-empty one, by two different
      // mechanisms with two different symptoms — a fix that only handles the empty case would
      // still leave the non-empty one broken. `insertSecurity` is SPINE's to fix (this lane may
      // not edit `repositories/`) — passing the JSON text directly, rather than the array, is
      // the narrowest fix reachable from this file alone, and only works here because this
      // feature always passes an empty list.
      aliases: [],
    },
    db,
  );
}

export async function ensureMarketProxySecurity(db?: Queryable): Promise<Security> {
  return ensure(MARKET_PROXY_SYMBOL, MARKET_PROXY_EXCHANGE, 'SPDR S&P 500 ETF Trust (market proxy)', db);
}

export async function ensureSectorProxySecurities(db?: Queryable): Promise<readonly (Security & { readonly sectorKey: string; readonly sectorLabel: string })[]> {
  const results = [];
  for (const proxy of SECTOR_PROXIES) {
    // Sequential, not `Promise.all` — `insertSecurity` has no upsert semantics, and two
    // concurrent first-ever refreshes racing on the same symbol would otherwise both pass the
    // `findSecurityBySymbol` check and both attempt an insert, one of which would then fail
    // `security_symbol_exchange_unique`.
    const record = await ensure(proxy.tickerSymbol, SECTOR_PROXY_EXCHANGE, `${proxy.sectorLabel} Select Sector SPDR (sector proxy)`, db);
    results.push({ ...record, sectorKey: proxy.sectorKey, sectorLabel: proxy.sectorLabel });
  }
  return results;
}
