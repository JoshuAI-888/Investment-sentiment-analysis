/**
 * The Marketaux adapter — F04 §4.3, `provider: 'marketaux'`.
 *
 * Free tier, **100 requests/day** (`docs/DEPLOY.md`'s provider table) — "development shares
 * this quota... F04's ledger and fixture-default mode exist for this reason." Nothing here is
 * priced (`estimatedCostUsd: null`); the constraint that matters is the daily quota, which the
 * wrapper's `QuotaLedger` port enforces, not this adapter.
 *
 * **Schema confidence note, same discipline as `sec-edgar.ts`.** Two independent sources on
 * Marketaux's per-entity sentiment field disagreed during this session's verification pass —
 * one names it `sentiment_score` (a number, filterable via `sentiment_gte`/`sentiment_lte`),
 * a third-party mirror's own worked example called it `score`. `marketauxEntity` below accepts
 * `sentiment_score` as the primary field and keeps most of the article shape optional rather
 * than asserting field names this session could not corroborate twice. F04 §4.4's entitlement
 * probe is what settles this against a real response.
 */
import { z } from 'zod';
import type { ProviderResult } from '@/contracts/provider';
import { createFetcher } from './fixtures';
import type { WrapperDeps } from './wrapper';
import { callProvider } from './wrapper';

export type MarketauxEntity = {
  symbol: string;
  name: string;
  /** `null` when Marketaux has not scored this entity in this article. */
  sentimentScore: number | null;
};

export type MarketauxArticle = {
  uuid: string;
  title: string;
  url: string;
  publishedAt: string;
  entities: MarketauxEntity[];
};

const marketauxEntity = z.object({
  symbol: z.string().min(1),
  name: z.string().min(1),
  sentiment_score: z.number().nullable(),
});

const marketauxArticle = z.object({
  uuid: z.string().min(1),
  title: z.string().min(1),
  url: z.string().min(1),
  published_at: z.string().min(1),
  entities: z.array(marketauxEntity),
});

const marketauxResponse = z.object({
  data: z.array(marketauxArticle),
});

export async function fetchMarketauxNews(
  options: {
    /** Comma-joined server-side; the ledger's 100/day cap is what actually limits this. */
    symbols: string[];
    apiKey?: string;
    limit?: number;
    cacheTtlMs?: number;
    maxStaleMs?: number;
    headers?: Readonly<Record<string, string>>;
  },
  providerMode: 'fixture' | 'live',
  deps: Omit<WrapperDeps, 'fetcher'> & { fixturesRoot?: string },
): Promise<ProviderResult<MarketauxArticle[]>> {
  if (providerMode === 'live' && (options.apiKey === undefined || options.apiKey === '')) {
    throw new Error('fetchMarketauxNews: apiKey is required when providerMode is "live"');
  }

  const fetcher = createFetcher(providerMode, {
    provider: 'marketaux',
    endpoint: 'news_all',
    ...(deps.fixturesRoot === undefined ? {} : { root: deps.fixturesRoot }),
  });

  const url = new URL('https://api.marketaux.com/v1/news/all');
  url.searchParams.set('symbols', options.symbols.join(','));
  if (options.limit !== undefined) url.searchParams.set('limit', String(options.limit));
  if (options.apiKey !== undefined) url.searchParams.set('api_token', options.apiKey);

  const result = await callProvider(
    {
      provider: 'marketaux',
      operation: 'news_all',
      segments: [options.symbols.join(',')],
      schema: marketauxResponse,
      request: {
        url: url.toString(),
        ...(options.headers === undefined ? {} : { headers: options.headers }),
      },
      // Free tier: the daily-count ledger is the real constraint, not a per-call price.
      estimatedCostUsd: null,
      ...(options.cacheTtlMs === undefined ? {} : { cacheTtlMs: options.cacheTtlMs }),
      ...(options.maxStaleMs === undefined ? {} : { maxStaleMs: options.maxStaleMs }),
    },
    { ...deps, fetcher },
  );

  if (!result.ok) return result;
  const articles = result.data.data.map(
    (article): MarketauxArticle => ({
      uuid: article.uuid,
      title: article.title,
      url: article.url,
      publishedAt: article.published_at,
      entities: article.entities.map((entity) => ({
        symbol: entity.symbol,
        name: entity.name,
        sentimentScore: entity.sentiment_score,
      })),
    }),
  );
  return { ok: true, data: articles, meta: result.meta };
}
