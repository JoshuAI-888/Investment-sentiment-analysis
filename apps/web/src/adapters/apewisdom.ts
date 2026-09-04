/**
 * The ApeWisdom adapter — F04 §4.3, `provider: 'apewisdom'`.
 *
 * **The mechanism that actually completes MT-07.** D-30 answers "which 100 symbols" with *the
 * ranking ApeWisdom produces on the seed date* — free, keyless, and the only source that can
 * rank Reddit mentions today, since the Reddit Data API itself is unapproved (MT-13). This
 * adapter is what F03's seed step (`repositories/universe-seed.ts`) will eventually be run
 * against to pull that ranking; today the seed file is still owner-provided per `DEPLOY.md`
 * MT-07, and this module does not populate it — see "What it deliberately does not do" below.
 *
 * **No longer an independent cross-check** (D-30, superseding D-12/R-03): an instrument that
 * *selected* the universe cannot then validate attention rank on it. This adapter exists to
 * produce the ranking, not to confirm anything about it.
 */
import { z } from 'zod';
import type { ProviderResult } from '@/contracts/provider';
import { createFetcher } from './fixtures';
import type { WrapperDeps } from './wrapper';
import { callProvider } from './wrapper';

export type ApeWisdomEntry = {
  rank: number;
  ticker: string;
  name: string;
  /**
   * ApeWisdom returns these as numeric strings, not numbers — kept as-is rather than coerced.
   * Coercing at the adapter boundary would hide a shape change (a provider that started
   * sending real numbers) behind a value that still looks right; the schema below only accepts
   * what's actually observed, so a change here is a contract violation, not a silent parse.
   */
  mentions: string;
  upvotes: string;
  rank24hAgo: string;
  mentions24hAgo: string;
};

const apeWisdomEntry = z.object({
  rank: z.number(),
  ticker: z.string().min(1),
  name: z.string().min(1),
  mentions: z.string(),
  upvotes: z.string(),
  rank_24h_ago: z.string(),
  mentions_24h_ago: z.string(),
});

const apeWisdomPage = z.object({
  count: z.number(),
  pages: z.number(),
  current_page: z.number(),
  results: z.array(apeWisdomEntry),
});

/** Every board this product cross-checks or seeds against (source §4.3's Wave 1–2 scope). */
export type ApeWisdomFilter = 'all-stocks' | 'wallstreetbets';

export async function fetchApeWisdomRanking(
  options: {
    filter: ApeWisdomFilter;
    page?: number;
    cacheTtlMs?: number;
    maxStaleMs?: number;
    headers?: Readonly<Record<string, string>>;
  },
  providerMode: 'fixture' | 'live',
  deps: Omit<WrapperDeps, 'fetcher'> & { fixturesRoot?: string },
): Promise<ProviderResult<ApeWisdomEntry[]>> {
  const page = options.page ?? 1;
  const fetcher = createFetcher(providerMode, {
    provider: 'apewisdom',
    endpoint: 'filter',
    ...(deps.fixturesRoot === undefined ? {} : { root: deps.fixturesRoot }),
  });

  const result = await callProvider(
    {
      provider: 'apewisdom',
      operation: 'filter',
      segments: [options.filter, String(page)],
      schema: apeWisdomPage,
      request: {
        url: `https://apewisdom.io/api/v1.0/filter/${options.filter}/page/${page}`,
        ...(options.headers === undefined ? {} : { headers: options.headers }),
      },
      // Free and keyless (source §4.3's cost-shape table).
      estimatedCostUsd: null,
      ...(options.cacheTtlMs === undefined ? {} : { cacheTtlMs: options.cacheTtlMs }),
      ...(options.maxStaleMs === undefined ? {} : { maxStaleMs: options.maxStaleMs }),
    },
    { ...deps, fetcher },
  );

  if (!result.ok) return result;
  const entries = result.data.results.map(
    (entry): ApeWisdomEntry => ({
      rank: entry.rank,
      ticker: entry.ticker,
      name: entry.name,
      mentions: entry.mentions,
      upvotes: entry.upvotes,
      rank24hAgo: entry.rank_24h_ago,
      mentions24hAgo: entry.mentions_24h_ago,
    }),
  );
  return { ok: true, data: entries, meta: result.meta };
}
