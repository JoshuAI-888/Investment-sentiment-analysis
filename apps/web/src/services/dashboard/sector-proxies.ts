/**
 * F07 §4.3 — the 11 US sector ETF proxies, plus the one broad-market proxy the market composite's
 * `news_sentiment`/`price_regime` components are computed against.
 *
 * **These are not in the seed universe.** `MEMORY.md` B-20 records that ApeWisdom's ranking
 * excludes ETFs from the 100-symbol universe by owner decision — sector and market proxies are
 * a different, fixed list this feature owns, seeded on demand by `ensureProxySecurities`
 * (`security.ts`) via `insertSecurity`/`findSecurityBySymbol`, both already-exported repository
 * functions. Nothing here adds a migration or a repository function.
 *
 * The eleven are the standard SPDR Select Sector ETFs, GICS-aligned — the same instrument
 * class F07 §4.3's tooltip names: "an ETF is a proxy for its sector, not a population of its
 * constituents."
 */

export type SectorProxy = {
  readonly sectorKey: string;
  readonly sectorLabel: string;
  readonly tickerSymbol: string;
};

export const SECTOR_PROXIES: readonly SectorProxy[] = [
  { sectorKey: 'technology', sectorLabel: 'Technology', tickerSymbol: 'XLK' },
  { sectorKey: 'financials', sectorLabel: 'Financials', tickerSymbol: 'XLF' },
  { sectorKey: 'energy', sectorLabel: 'Energy', tickerSymbol: 'XLE' },
  { sectorKey: 'health_care', sectorLabel: 'Health care', tickerSymbol: 'XLV' },
  { sectorKey: 'consumer_discretionary', sectorLabel: 'Consumer discretionary', tickerSymbol: 'XLY' },
  { sectorKey: 'consumer_staples', sectorLabel: 'Consumer staples', tickerSymbol: 'XLP' },
  { sectorKey: 'industrials', sectorLabel: 'Industrials', tickerSymbol: 'XLI' },
  { sectorKey: 'materials', sectorLabel: 'Materials', tickerSymbol: 'XLB' },
  { sectorKey: 'utilities', sectorLabel: 'Utilities', tickerSymbol: 'XLU' },
  { sectorKey: 'real_estate', sectorLabel: 'Real estate', tickerSymbol: 'XLRE' },
  { sectorKey: 'communication_services', sectorLabel: 'Communication services', tickerSymbol: 'XLC' },
];

/**
 * The broad-market proxy `market.composite`'s own `news_sentiment`/`price_regime` components
 * are computed against — those two registry methods are `subjectKind: 'security'`, so the
 * market-level reading needs a single representative security rather than an unsupported
 * "aggregate across the universe" subject.
 */
export const MARKET_PROXY_SYMBOL = 'SPY';
export const MARKET_PROXY_EXCHANGE = 'NYSEARCA';
export const SECTOR_PROXY_EXCHANGE = 'NYSEARCA';
