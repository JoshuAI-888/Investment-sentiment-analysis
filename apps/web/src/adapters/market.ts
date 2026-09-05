/**
 * The market-data adapter — F04 §4.3, `provider: 'market'`.
 *
 * **Resolved by D-31 (`docs/DEPLOY.md` MT-14), not by the vendor named in §4.3's table.** The
 * spec calls this "intraday market data" and names its tier as an open question (MT-14); the
 * owner closed that question with "no new vendor" — this runs on **FMP Starter's daily bars**,
 * already paid for. `docs/MEMORY.md` B-19 records the consequence: **daily resolution cannot
 * catch a spike that reverts intraday**, which is a real trim of D-15's trigger, mitigated by
 * the fact that social reaction lags price by minutes to hours anyway.
 *
 * **`provider: 'market'` stays distinct from `provider: 'fmp'`** even though both call the same
 * vendor's API. `rate-limit.ts`'s `BUCKETS` already gives them separate buckets (`market`:
 * continuous polling, `fmp`: scheduled fundamentals) — one vendor, two call patterns, and
 * collapsing them into one provider tag would let a fundamentals burst starve the trigger's
 * poll, or vice versa.
 */
import { z } from 'zod';
import type { ProviderResult } from '@/contracts/provider';
import { createFetcher } from './fixtures';
import type { WrapperDeps } from './wrapper';
import { callProvider } from './wrapper';

export type DailyBar = {
  /** `YYYY-MM-DD`, as FMP returns it — not parsed to a `Date` here; that is the trigger's job. */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const dailyBar = z.object({
  date: z.string().min(1),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
});

/**
 * `.strip()` (zod's object default) is load-bearing, not incidental: FMP's actual payload
 * carries `adjClose`, `change`, `changePercent`, `vwap`, `label` and more. A schema that
 * rejected those would fail the moment the provider added a field nobody asked for — exactly
 * the "field the schema does not expect" case `05-TEST-STRATEGY.md` §2 requires to *pass*, not
 * fail. `null-where-number` is the opposite case: `dailyBar`'s fields are all `z.number()`,
 * so a `null` close fails the whole array, which is the wrapper's stage-8 contract violation.
 */
const historicalPriceFull = z.object({
  symbol: z.string().min(1),
  historical: z.array(dailyBar),
});

export async function fetchDailyBars(
  options: {
    symbol: string;
    /** Required in `live` mode; unused and safely omittable in `fixture` mode. */
    apiKey?: string;
    cacheTtlMs?: number;
    maxStaleMs?: number;
    headers?: Readonly<Record<string, string>>;
  },
  providerMode: 'fixture' | 'live',
  deps: Omit<WrapperDeps, 'fetcher'> & { fixturesRoot?: string },
): Promise<ProviderResult<DailyBar[]>> {
  if (providerMode === 'live' && (options.apiKey === undefined || options.apiKey === '')) {
    // A missing key in live mode is a deployment misconfiguration, not a provider condition
    // the taxonomy models — the same distinction `env.ts` draws between "invalid input" and
    // "the process should not have started this way."
    throw new Error('fetchDailyBars: apiKey is required when providerMode is "live"');
  }

  const fetcher = createFetcher(providerMode, {
    provider: 'market',
    endpoint: 'historical_price_full',
    ...(deps.fixturesRoot === undefined ? {} : { root: deps.fixturesRoot }),
  });

  const url = new URL(`https://financialmodelingprep.com/api/v3/historical-price-full/${options.symbol}`);
  if (options.apiKey !== undefined) url.searchParams.set('apikey', options.apiKey);

  const result = await callProvider(
    {
      provider: 'market',
      operation: 'historical_price_full',
      segments: [options.symbol],
      schema: historicalPriceFull,
      request: {
        url: url.toString(),
        ...(options.headers === undefined ? {} : { headers: options.headers }),
      },
      // Flat-tier subscription (source §4.3's cost-shape table): free at the margin per call.
      estimatedCostUsd: null,
      ...(options.cacheTtlMs === undefined ? {} : { cacheTtlMs: options.cacheTtlMs }),
      ...(options.maxStaleMs === undefined ? {} : { maxStaleMs: options.maxStaleMs }),
    },
    { ...deps, fetcher },
  );

  if (!result.ok) return result;
  return { ok: true, data: result.data.historical, meta: result.meta };
}

/**
 * A company profile — enough to create a `security` row, and no more.
 *
 * **Why this exists.** `repositories/universe-seed.ts` resolves each seeded symbol against the
 * security master and refuses the whole seed if any is missing, but nothing in the product ever
 * *wrote* to that table: `insertSecurity` was reachable only from the `testing.ts` helpers under `services/`. The
 * universe seed had therefore never run anywhere except a test database that its own helpers had
 * already populated, and `docs/DEPLOY.md`'s "the only remaining step is executing `pnpm
 * seed:universe`" was wrong on a fresh production database. `migrations/seed/universe-v1.json`
 * carries only `symbol` and `exchange`, while `security.name`, `asset_type` and `currency` are
 * all `not null` — so the missing data is real and has to come from somewhere real.
 *
 * **`provider: 'fmp'`, not `'market'`.** §4.3's own split, and `rate-limit.ts`'s `BUCKETS`
 * already separates them: this is a one-shot bootstrap of ~100 symbols, not the trigger's
 * continuous poll, and it must not be able to starve that poll's bucket.
 */
export type CompanyProfile = {
  symbol: string;
  companyName: string;
  exchangeShortName: string;
  currency: string;
  sector: string | null;
  industry: string | null;
  cik: string | null;
  isEtf: boolean;
};

/**
 * Only the fields a `security` row needs are required. Everything else FMP returns is stripped
 * by zod's object default, per `historicalPriceFull`'s reasoning above — a provider adding a
 * field must not fail this call.
 *
 * `sector`, `industry` and `cik` are `.nullable()` because FMP genuinely returns empty strings
 * or nulls for them on some listings (ADRs and recent IPOs especially), and those columns are
 * nullable in `security` for exactly that reason. `companyName`, `currency` and
 * `exchangeShortName` are **not** optional: a profile missing any of them cannot produce a legal
 * row, and failing here names the symbol rather than writing a placeholder that would be
 * indistinguishable from real data later.
 */
const companyProfile = z.object({
  symbol: z.string().min(1),
  companyName: z.string().min(1),
  exchangeShortName: z.string().min(1),
  currency: z.string().min(1),
  sector: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  cik: z.string().nullable().optional(),
  isEtf: z.boolean().optional(),
});

const companyProfiles = z.array(companyProfile);

/**
 * FMP's profile endpoint accepts a comma-separated batch, which is why this takes `symbols`
 * rather than one symbol: 100 symbols is one call, not 100 against a rate-limited bucket.
 *
 * **A symbol FMP does not know is simply absent from the response**, not an error and not a
 * null entry — so the caller must compare what it asked for against what came back. That is
 * deliberate here rather than thrown: which of the seeded tickers FMP cannot resolve is
 * information the operator needs to see in full, not one symbol at a time.
 */
export async function fetchCompanyProfiles(
  options: {
    symbols: readonly string[];
    /** Required in `live` mode; unused and safely omittable in `fixture` mode. */
    apiKey?: string;
    cacheTtlMs?: number;
    maxStaleMs?: number;
    headers?: Readonly<Record<string, string>>;
  },
  providerMode: 'fixture' | 'live',
  deps: Omit<WrapperDeps, 'fetcher'> & { fixturesRoot?: string },
): Promise<ProviderResult<CompanyProfile[]>> {
  if (providerMode === 'live' && (options.apiKey === undefined || options.apiKey === '')) {
    throw new Error('fetchCompanyProfiles: apiKey is required when providerMode is "live"');
  }
  if (options.symbols.length === 0) {
    throw new Error('fetchCompanyProfiles: symbols must not be empty');
  }

  const fetcher = createFetcher(providerMode, {
    provider: 'fmp',
    endpoint: 'profile',
    ...(deps.fixturesRoot === undefined ? {} : { root: deps.fixturesRoot }),
  });

  const joined = options.symbols.join(',');
  const url = new URL(`https://financialmodelingprep.com/api/v3/profile/${joined}`);
  if (options.apiKey !== undefined) url.searchParams.set('apikey', options.apiKey);

  const result = await callProvider(
    {
      provider: 'fmp',
      operation: 'profile',
      segments: [...options.symbols],
      schema: companyProfiles,
      request: {
        url: url.toString(),
        ...(options.headers === undefined ? {} : { headers: options.headers }),
      },
      estimatedCostUsd: null,
      ...(options.cacheTtlMs === undefined ? {} : { cacheTtlMs: options.cacheTtlMs }),
      ...(options.maxStaleMs === undefined ? {} : { maxStaleMs: options.maxStaleMs }),
    },
    { ...deps, fetcher },
  );

  if (!result.ok) return result;
  return {
    ok: true,
    data: result.data.map((profile) => ({
      symbol: profile.symbol,
      companyName: profile.companyName,
      exchangeShortName: profile.exchangeShortName,
      currency: profile.currency,
      sector: profile.sector === undefined || profile.sector === '' ? null : profile.sector,
      industry: profile.industry === undefined || profile.industry === '' ? null : profile.industry,
      cik: profile.cik === undefined || profile.cik === '' ? null : profile.cik,
      isEtf: profile.isEtf ?? false,
    })),
    meta: result.meta,
  };
}
