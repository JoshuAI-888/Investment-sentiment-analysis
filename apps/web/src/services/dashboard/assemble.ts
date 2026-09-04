/**
 * `assembleDashboard` — F07's read path. F07 §6 DoD: "renders live normalized data from storage
 * with **no provider call in the read path**."
 *
 * Every call this function makes is either a Redis `GET` (the calculationId pointer
 * `refresh.ts` wrote) or `loadArtifact` (`src/services/calculations.ts`, an existing,
 * already-reviewed Postgres read with no adapter import anywhere in its module graph). Nothing
 * here imports `src/adapters/`, which `tests/integration/dashboard.test.ts` asserts on the
 * module graph, not by inspection alone.
 */
import type { CalculationArtifact } from '@/calc/artifact';
import { env } from '@/env';
import type { Queryable } from '@/repositories/client';
import { loadArtifact } from '@/services/calculations';
import type { DashboardResponse, MarketCompositeView, SectorTile } from './contract';
import { pageState, renormalizedComponentWeight, toDashboardMetric } from './metrics';
import { KEYS, type RedisClient } from './redis';
import { SECTOR_PROXIES } from './sector-proxies';

const COMPOSITE_COMPONENTS = [
  { key: 'news_sentiment' as const, label: 'News sentiment', officialWeight: '0.35', pointerKey: KEYS.marketProxyMetric('news.sentiment') },
  { key: 'price_regime' as const, label: 'Price regime (trend strength)', officialWeight: '0.30', pointerKey: KEYS.marketProxyMetric('price.regime') },
  { key: 'sector_breadth_score' as const, label: 'Sector breadth', officialWeight: '0.25', pointerKey: KEYS.marketSectorBreadth() },
  { key: 'sampled_retail_stance' as const, label: 'Sampled retail stance', officialWeight: '0.10', pointerKey: null },
];

/**
 * `null` both when nothing has been computed yet (no pointer) *and* when storage could not be
 * reached — the two are told apart by `assembleDashboard`'s own `storageUnavailable` flag, not
 * by this function's return type, so a database outage renders F07 §4.5's "Degraded" state
 * (naming `database`) rather than crashing the whole page into a 500. `getPool()`
 * (`repositories/client.ts`) throws synchronously when `DATABASE_URL` is unset; this is the one
 * place that catch has to live, since every other function in this module assumes storage is
 * simply either populated or empty.
 */
/**
 * The full artifact, not just its `DashboardMetric` projection — `assembleMarketComposite` needs
 * `market.composite`'s own step trace (`renormalizedComponentWeight`, F07 review finding 2), not
 * only the number `toDashboardMetric` renders. `loadPointer` below is this plus the projection,
 * for every caller that only needs the number.
 */
async function loadPointerArtifact(
  redis: RedisClient,
  key: string,
  db: Queryable | undefined,
  onStorageError: (error: unknown) => void,
): Promise<CalculationArtifact | null> {
  const calculationId = await redis.get(key);
  if (calculationId === null) return null;
  try {
    return await loadArtifact(calculationId, db);
  } catch (error) {
    onStorageError(error);
    return null;
  }
}

async function loadPointer(
  redis: RedisClient,
  key: string,
  db: Queryable | undefined,
  label: string,
  onStorageError: (error: unknown) => void,
) {
  const artifact = await loadPointerArtifact(redis, key, db, onStorageError);
  return artifact === null ? null : toDashboardMetric(artifact, label);
}

async function assembleMarketComposite(
  redis: RedisClient,
  db: Queryable | undefined,
  onStorageError: (error: unknown) => void,
): Promise<MarketCompositeView> {
  const compositeArtifact = await loadPointerArtifact(redis, KEYS.marketComposite(), db, onStorageError);
  const composite = compositeArtifact === null ? null : toDashboardMetric(compositeArtifact, 'Market composite');

  const components = await Promise.all(
    COMPOSITE_COMPONENTS.map(async (component) => {
      const metric =
        component.pointerKey === null ? null : await loadPointer(redis, component.pointerKey, db, component.label, onStorageError);

      return {
        key: component.key,
        label: component.label,
        officialWeight: component.officialWeight,
        renormalizedWeight: compositeArtifact === null ? null : renormalizedComponentWeight(compositeArtifact, component.key),
        participated: metric !== null && metric.eligibility === 'ok',
        metric,
      };
    }),
  );

  return { composite, components };
}

async function assembleSectorTiles(
  redis: RedisClient,
  db: Queryable | undefined,
  onStorageError: (error: unknown) => void,
): Promise<SectorTile[]> {
  return Promise.all(
    SECTOR_PROXIES.map(async (proxy) => {
      const [newsSentiment, priceRegime] = await Promise.all([
        loadPointer(redis, KEYS.sectorMetric(proxy.sectorKey, 'news.sentiment'), db, `${proxy.sectorLabel} — news sentiment`, onStorageError),
        loadPointer(redis, KEYS.sectorMetric(proxy.sectorKey, 'price.regime'), db, `${proxy.sectorLabel} — price regime`, onStorageError),
      ]);
      return {
        sectorKey: proxy.sectorKey,
        sectorLabel: proxy.sectorLabel,
        tickerSymbol: proxy.tickerSymbol,
        newsSentiment,
        priceRegime,
      };
    }),
  );
}

export async function assembleDashboard(options: { readonly redis: RedisClient; readonly db?: Queryable }): Promise<DashboardResponse> {
  let storageUnavailable = false;
  const onStorageError = (error: unknown) => {
    storageUnavailable = true;
    console.error('[dashboard] storage read failed', error);
  };

  const [marketComposite, sectorTiles, computedDepthRaw, degradedProvidersRaw, lastRefusalRaw] = await Promise.all([
    assembleMarketComposite(options.redis, options.db, onStorageError),
    assembleSectorTiles(options.redis, options.db, onStorageError),
    options.redis.get(KEYS.computedDepth()),
    options.redis.get(KEYS.degradedProviders()),
    options.redis.get(KEYS.lastRefusal()),
  ]);

  const computedDepth = computedDepthRaw === null ? 0 : Number(computedDepthRaw);
  const degradedProviders: string[] = degradedProvidersRaw === null ? [] : (JSON.parse(degradedProvidersRaw) as string[]);
  const lastRefusal = lastRefusalRaw === null ? null : (JSON.parse(lastRefusalRaw) as DashboardResponse['lastRefusal']);
  const allDegradedProviders = storageUnavailable ? [...new Set([...degradedProviders, 'database'])] : degradedProviders;

  const allMetrics = [
    marketComposite.composite,
    ...marketComposite.components.map((c) => c.metric),
    ...sectorTiles.flatMap((tile) => [tile.newsSentiment, tile.priceRegime]),
  ].filter((metric): metric is NonNullable<typeof metric> => metric !== null);

  const state = pageState({
    hasEverComputed: computedDepth > 0,
    degradedProviders: allDegradedProviders,
    metrics: allMetrics,
  });

  return {
    state,
    computedDepth,
    marketComposite,
    sectorTiles,
    degradedProviders: allDegradedProviders,
    lastRefusal,
    providerMode: env.PROVIDER_MODE,
  };
}
