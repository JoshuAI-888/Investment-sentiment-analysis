/** FMP current S&P 500 constituent adapter for RNI universe synchronization (D-RNI-06). */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ProviderResult } from '@/contracts/provider';
import { createFetcher } from './fixtures';
import type { Fetcher } from './ports';
import type { WrapperDeps } from './wrapper';
import { callProvider } from './wrapper';

export const fmpSp500Constituent = z
  .object({
    symbol: z.string().min(1),
    name: z.string().min(1),
    sector: z.string().nullable().optional(),
    subSector: z.string().nullable().optional(),
    headQuarter: z.string().nullable().optional(),
    dateFirstAdded: z.string().nullable().optional(),
    cik: z.string().nullable().optional(),
    founded: z.string().nullable().optional(),
  })
  .passthrough();

const fmpSp500Response = z.array(fmpSp500Constituent);
export type FmpSp500Constituent = z.infer<typeof fmpSp500Constituent>;

export type FmpSp500Payload = {
  readonly constituents: readonly FmpSp500Constituent[];
  readonly payloadSha256: string;
};

type FmpUniverseDeps = Omit<WrapperDeps, 'fetcher'> & {
  readonly fixturesRoot?: string;
  /** Test-only override; production leaves this undefined and uses the selected provider mode. */
  readonly fetcher?: Fetcher;
};

export async function fetchFmpSp500Constituents(
  options: {
    readonly apiKey?: string;
    readonly headers?: Readonly<Record<string, string>>;
  },
  providerMode: 'fixture' | 'live',
  deps: FmpUniverseDeps,
): Promise<ProviderResult<FmpSp500Payload>> {
  if (providerMode === 'live' && (options.apiKey === undefined || options.apiKey === '')) {
    throw new Error('fetchFmpSp500Constituents: apiKey is required when providerMode is "live"');
  }

  const fetcher =
    deps.fetcher ??
    createFetcher(providerMode, {
      provider: 'fmp',
      endpoint: 'sp500_constituent',
      ...(deps.fixturesRoot === undefined ? {} : { root: deps.fixturesRoot }),
    });
  const url = new URL('https://financialmodelingprep.com/stable/sp500-constituent');
  if (options.apiKey !== undefined) url.searchParams.set('apikey', options.apiKey);

  const result = await callProvider(
    {
      provider: 'fmp',
      operation: 'sp500_constituent',
      schema: fmpSp500Response,
      request: {
        url: url.toString(),
        ...(options.headers === undefined ? {} : { headers: options.headers }),
      },
      estimatedCostUsd: null,
    },
    { ...deps, fetcher },
  );

  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      constituents: result.data,
      payloadSha256: createHash('sha256').update(JSON.stringify(result.data)).digest('hex'),
    },
    meta: result.meta,
  };
}
