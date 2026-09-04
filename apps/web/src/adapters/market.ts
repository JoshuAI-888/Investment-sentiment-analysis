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
