/**
 * The FRED adapter — F04 §4.3, `provider: 'fred'`.
 *
 * Free, keyed (`FRED_API_KEY`), attribution required (source §4.3's cost-shape table). Unlike
 * the other adapters built this session, the response shape here is corroborated against the
 * **official** FRED documentation's own worked example (`realtime_start`/`observations[]`/
 * `date`/`value`), not a third-party mirror — the highest confidence of any schema in this
 * build so far.
 *
 * **`value` is kept as a string, deliberately, for two reasons.** First, the usual one: a raw
 * JS `number` at a boundary that eventually reaches an analytics module is the defect
 * `no-float-in-analytics` exists to prevent, and converting here would just move the float
 * upstream of that lint rule instead of avoiding it. Second, FRED-specific: a missing
 * observation is not absent from the array, it is present with **`value: "."`** — a sentinel
 * that is not a number at all. `null` is what `fetchFredSeriesObservations` maps that sentinel
 * to; anything else risks a `parseFloat('.')` landing as `NaN` three layers downstream where
 * nobody is looking for it.
 */
import { z } from 'zod';
import type { ProviderResult } from '@/contracts/provider';
import { createFetcher } from './fixtures';
import type { WrapperDeps } from './wrapper';
import { callProvider } from './wrapper';

export type FredObservation = {
  date: string;
  /** `null` when FRED's own "." missing-value sentinel is what was returned. */
  value: string | null;
};

/** FRED's sentinel for "no observation at this date" — never a number, never absent. */
const MISSING_VALUE_SENTINEL = '.';

const fredObservation = z.object({
  date: z.string().min(1),
  value: z.string().min(1),
});

const fredResponse = z.object({
  observations: z.array(fredObservation),
});

export async function fetchFredSeriesObservations(
  options: {
    seriesId: string;
    apiKey?: string;
    cacheTtlMs?: number;
    maxStaleMs?: number;
    headers?: Readonly<Record<string, string>>;
  },
  providerMode: 'fixture' | 'live',
  deps: Omit<WrapperDeps, 'fetcher'> & { fixturesRoot?: string },
): Promise<ProviderResult<FredObservation[]>> {
  if (providerMode === 'live' && (options.apiKey === undefined || options.apiKey === '')) {
    throw new Error('fetchFredSeriesObservations: apiKey is required when providerMode is "live"');
  }

  const fetcher = createFetcher(providerMode, {
    provider: 'fred',
    endpoint: 'series_observations',
    ...(deps.fixturesRoot === undefined ? {} : { root: deps.fixturesRoot }),
  });

  const url = new URL('https://api.stlouisfed.org/fred/series/observations');
  url.searchParams.set('series_id', options.seriesId);
  url.searchParams.set('file_type', 'json');
  if (options.apiKey !== undefined) url.searchParams.set('api_key', options.apiKey);

  const result = await callProvider(
    {
      provider: 'fred',
      operation: 'series_observations',
      segments: [options.seriesId],
      schema: fredResponse,
      request: {
        url: url.toString(),
        ...(options.headers === undefined ? {} : { headers: options.headers }),
      },
      // Free (source §4.3's cost-shape table); attribution is a display-layer obligation.
      estimatedCostUsd: null,
      ...(options.cacheTtlMs === undefined ? {} : { cacheTtlMs: options.cacheTtlMs }),
      ...(options.maxStaleMs === undefined ? {} : { maxStaleMs: options.maxStaleMs }),
    },
    { ...deps, fetcher },
  );

  if (!result.ok) return result;
  const observations = result.data.observations.map(
    (observation): FredObservation => ({
      date: observation.date,
      value: observation.value === MISSING_VALUE_SENTINEL ? null : observation.value,
    }),
  );
  return { ok: true, data: observations, meta: result.meta };
}
