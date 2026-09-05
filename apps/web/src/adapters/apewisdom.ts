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

/**
 * Every **equity** board ApeWisdom publishes.
 *
 * The provider also exposes `all`, `all-crypto`, `4chan` and eight crypto-specific boards. They
 * are deliberately absent: nothing in this product scores crypto, so collecting those boards
 * would multiply request volume and storage for rows no aggregate will ever read. The stock
 * boards are the ones where a ticker mention is the signal this product is about.
 *
 * `all-stocks` overlaps the individual boards by construction — it is the union. Both are
 * collected anyway, and the overlap is not deduplicated: `board` is part of the identity, so
 * "AAPL was 3rd on all-stocks and 1st on wallstreetbets" is two facts, not one fact recorded
 * twice. Collapsing them would destroy exactly the per-board distinction this exists to keep.
 */
export const APEWISDOM_STOCK_FILTERS = [
  'all-stocks',
  'wallstreetbets',
  'stocks',
  'investing',
  'options',
  'Daytrading',
  'SPACs',
  'WallStreetbetsELITE',
  'Wallstreetbetsnew',
] as const;

export type ApeWisdomFilter = (typeof APEWISDOM_STOCK_FILTERS)[number];

/** What the provider says about the board as a whole, needed to page through it. */
export type ApeWisdomPageMeta = {
  /** Total entries across every page of this board. */
  count: number;
  /** How many pages there are. ApeWisdom pages at 100 results. */
  pages: number;
  currentPage: number;
};

export type ApeWisdomBoardPage = {
  entries: ApeWisdomEntry[];
  meta: ApeWisdomPageMeta;
};

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

/**
 * The same call as `fetchApeWisdomRanking`, but keeping the board metadata the provider sends
 * alongside the results.
 *
 * `fetchApeWisdomRanking` returns entries only, which is all its caller (the universe-scoped
 * attention collector) has ever needed. Paging through a whole board needs `pages` — without it
 * a caller can only guess when to stop, and guessing means either a truncated capture or a
 * request loop that runs until the provider errors. Kept as a separate function rather than a
 * changed return type so the existing call site and its tests are untouched.
 */
export async function fetchApeWisdomBoardPage(
  options: {
    filter: ApeWisdomFilter;
    page?: number;
    cacheTtlMs?: number;
    maxStaleMs?: number;
    headers?: Readonly<Record<string, string>>;
  },
  providerMode: 'fixture' | 'live',
  deps: Omit<WrapperDeps, 'fetcher'> & { fixturesRoot?: string },
): Promise<ProviderResult<ApeWisdomBoardPage>> {
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
      estimatedCostUsd: null,
      ...(options.cacheTtlMs === undefined ? {} : { cacheTtlMs: options.cacheTtlMs }),
      ...(options.maxStaleMs === undefined ? {} : { maxStaleMs: options.maxStaleMs }),
    },
    { ...deps, fetcher },
  );

  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      entries: result.data.results.map(
        (entry): ApeWisdomEntry => ({
          rank: entry.rank,
          ticker: entry.ticker,
          name: entry.name,
          mentions: entry.mentions,
          upvotes: entry.upvotes,
          rank24hAgo: entry.rank_24h_ago,
          mentions24hAgo: entry.mentions_24h_ago,
        }),
      ),
      meta: {
        count: result.data.count,
        pages: result.data.pages,
        currentPage: result.data.current_page,
      },
    },
    meta: result.meta,
  };
}
