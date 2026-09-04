/**
 * The internal job F07 §4.6's `POST /api/dashboard/refresh` calls.
 *
 * F07 §4.6 asks for this to run "through the same internal job service the dispatcher uses
 * (F16 formalises the service; F07 calls it)". **F16a (the job service/dispatcher) does not
 * exist yet** — `docs/progress/collect.md` lists it `blocked` on MT-04 — so there is no shared
 * service to call. This module is F07's own, narrowly-scoped internal job in the meantime;
 * when F16a lands, this is the function it should come to call rather than reimplement.
 * Reported under this feature's `CONTRACTS`/`RISKS`.
 *
 * What it actually recomputes, and why it is bounded to this list: `price.regime` and
 * `news.sentiment` for the market proxy and each of the 11 sector ETF proxies, then
 * `market.sector_breadth` and `market.composite` over the results. `sampled_retail_stance`
 * (the composite's fourth component) is never supplied — there is no social-axis data yet
 * (the collector has not started, `PROGRESS.md`'s "Collector start date: NOT STARTED"), and
 * F06 §4.5's own rule is that an inadequate-coverage component is omitted, never faked as zero.
 */
import { randomUUID } from 'node:crypto';
import { fetchDailyBars } from '@/adapters/market';
import { fetchMarketauxNews } from '@/adapters/marketaux';
import type { CalculationArtifact, Subject } from '@/calc/artifact';
import { env } from '@/env';
import { computeArtifact, persistArtifact } from '@/services/calculations';
import { findActiveConfigVersion } from '@/repositories/versions';
import type { Queryable } from '@/repositories/client';
import { ensureMarketProxySecurity, ensureSectorProxySecurities } from './ensure-securities';
import { marketCompositeInputs, newsSentimentInputs, officialAssumptions, priceRegimeInputs, sectorBreadthInputs } from './inputs';
import { marketWrapperDeps, marketauxWrapperDeps } from './provider-deps';
import type { RedisClient } from './redis';
import { KEYS } from './redis';
import { MARKET_PROXY_SYMBOL } from './sector-proxies';

/** F03/F06's config-version environment key. Not yet operator-selectable — one environment, always. */
export const DASHBOARD_CONFIG_ENVIRONMENT = 'production';

export type RefreshOptions = {
  readonly redis: RedisClient;
  readonly db?: Queryable;
  readonly now?: Date;
  /**
   * F07 review finding 6, unresolved. `route.ts` threads `session.userId` in here specifically
   * so a refresh's audit trail can name who requested it — the same shape `runReplay`
   * (`services/calculations.ts`) already holds itself to, writing an `audit_event` row in the
   * same transaction as the action it audits (`repositories/artifacts.ts#insertReplayAuditEvent`).
   *
   * **No generic `audit_event` repository function exists for this.** Every writer in
   * `repositories/` (`artifacts.ts#insertReplayAuditEvent`, `retention.ts`, `versions.ts`,
   * `universe-seed.ts`) hand-writes its own tailored `insert into audit_event` for its own
   * action — there is nothing this lane can call for a `dashboard_refresh` action without
   * adding a query to `repositories/`, which is SPINE-owned (`CLAUDE.md`); this lane may not add
   * one itself. So `requestedBy` is captured and threaded through, honestly unused below, rather
   * than silently dropped — removing it would erase the one piece of information (who) that a
   * future audit write needs and this call site already has. Reported precisely under this
   * feature's `CONTRACTS`: SPINE needs either a generic `insertAuditEvent`, or a
   * `dashboard_refresh`-specific sibling to `insertReplayAuditEvent`, before this can be wired
   * up for real.
   */
  readonly requestedBy: string;
};

export type RefreshOutcome =
  | { readonly ok: true; readonly computedAt: string; readonly degradedProviders: readonly string[] }
  | { readonly ok: false; readonly reason: 'no_active_config_version' | 'storage_unavailable'; readonly message: string };

async function computeAndStore(args: {
  readonly methodId: string;
  readonly subject: Subject;
  readonly inputs: ReturnType<typeof priceRegimeInputs>;
  readonly configVersion: string;
  readonly asOf: string;
  readonly computedAt: string;
}): Promise<CalculationArtifact> {
  const artifact = computeArtifact({
    methodId: args.methodId,
    subject: args.subject,
    asOf: args.asOf,
    inputs: args.inputs,
    assumptions: officialAssumptions(args.methodId),
    configVersion: args.configVersion,
    calculationId: randomUUID(),
    computedAt: args.computedAt,
  });
  await persistArtifact(artifact);
  return artifact;
}

/**
 * The actual work, separated from `runDashboardRefresh` only so the latter can wrap it in one
 * try/catch — storage unavailability (`getPool()` throwing when `DATABASE_URL` is unset, or a
 * real connection failure) is caught there and reported as a `storage_unavailable` outcome
 * rather than an unhandled rejection reaching the route handler as a 500.
 */
async function runDashboardRefreshUnguarded(options: RefreshOptions, now: Date, asOf: string): Promise<RefreshOutcome> {
  const providerMode = env.PROVIDER_MODE;
  const degraded = new Set<string>();

  const activeConfig = await findActiveConfigVersion(DASHBOARD_CONFIG_ENVIRONMENT, options.db);
  if (activeConfig === null) {
    return {
      ok: false,
      reason: 'no_active_config_version',
      message: `No active config_version row for environment '${DASHBOARD_CONFIG_ENVIRONMENT}'. A calculation cannot be recorded without one to freeze (02-ARCHITECTURE-CONTRACTS.md §6) — this is an infrastructure prerequisite, not a provider outage.`,
    };
  }
  const configVersion = activeConfig.id;

  const marketDeps = marketWrapperDeps({ redis: options.redis, ...(options.db === undefined ? {} : { db: options.db }) });
  const marketauxDeps = marketauxWrapperDeps({ redis: options.redis, ...(options.db === undefined ? {} : { db: options.db }) });

  const marketProxy = await ensureMarketProxySecurity(options.db);
  const sectorProxies = await ensureSectorProxySecurities(options.db);
  const allSymbols = [MARKET_PROXY_SYMBOL, ...sectorProxies.map((sector) => sector.symbol)];

  // **One Marketaux call for every symbol this refresh needs, not one per symbol.**
  // `adapters/rate-limit.ts`'s `marketaux` bucket is sized for its real cadence — capacity 5,
  // refilling at 100/day — because D-15 spends it on triggered X-style sampling, not on a
  // dashboard refresh. Twelve separate calls would exhaust the bucket after the fifth and the
  // wrapper would `sleep()` on a real clock for the rest, in the worst case for minutes. Marketaux's
  // `symbols` param already accepts a comma-joined list (`adapters/marketaux.ts`) for exactly
  // this reason. Found while testing this feature end to end — the first version of this file
  // called it per-symbol and the integration test hung.
  const news = await fetchMarketauxNews(
    { symbols: allSymbols, ...(env.MARKETAUX_API_KEY === undefined ? {} : { apiKey: env.MARKETAUX_API_KEY }) },
    providerMode,
    marketauxDeps,
  );
  if (!news.ok) degraded.add('marketaux');
  const articles = news.ok ? news.data : [];

  async function computeSecurityMetrics(symbol: string, securityId: string) {
    const bars = await fetchDailyBars(
      { symbol, ...(env.FMP_API_KEY === undefined ? {} : { apiKey: env.FMP_API_KEY }) },
      providerMode,
      marketDeps,
    );
    if (!bars.ok) degraded.add('market');

    const priceRegime = await computeAndStore({
      methodId: 'price.regime',
      subject: { kind: 'security', id: securityId, label: symbol },
      inputs: priceRegimeInputs(symbol, bars.ok ? bars.data : []),
      configVersion,
      asOf,
      computedAt: asOf,
    });

    const newsSentiment = await computeAndStore({
      methodId: 'news.sentiment',
      subject: { kind: 'security', id: securityId, label: symbol },
      inputs: newsSentimentInputs(symbol, articles, now),
      configVersion,
      asOf,
      computedAt: asOf,
    });

    return { priceRegime, newsSentiment };
  }

  const marketProxyResult = await computeSecurityMetrics(MARKET_PROXY_SYMBOL, marketProxy.id);
  await options.redis.set(KEYS.marketProxyMetric('price.regime'), marketProxyResult.priceRegime.calculationId);
  await options.redis.set(KEYS.marketProxyMetric('news.sentiment'), marketProxyResult.newsSentiment.calculationId);

  const sectorResults: { readonly sectorKey: string; readonly priceRegime: CalculationArtifact }[] = [];
  for (const sector of sectorProxies) {
    // Sequential: `price.regime`'s own bucket capacity (60) easily covers twelve calls, but
    // keeping this loop sequential rather than `Promise.all` keeps the whole refresh's call
    // ordering easy to reason about and log, and it is not the bottleneck this file's history
    // (above) was actually about.
    const result = await computeSecurityMetrics(sector.symbol, sector.id);
    await options.redis.set(KEYS.sectorMetric(sector.sectorKey, 'price.regime'), result.priceRegime.calculationId);
    await options.redis.set(KEYS.sectorMetric(sector.sectorKey, 'news.sentiment'), result.newsSentiment.calculationId);
    sectorResults.push({ sectorKey: sector.sectorKey, priceRegime: result.priceRegime });
  }

  const sectorBreadth = await computeAndStore({
    methodId: 'market.sector_breadth',
    subject: { kind: 'market', id: 'US', label: 'US market' },
    inputs: sectorBreadthInputs(sectorResults.map((s) => ({ eligibility: s.priceRegime.eligibility, exact: s.priceRegime.result?.exact ?? null }))),
    configVersion,
    asOf,
    computedAt: asOf,
  });
  await options.redis.set(KEYS.marketSectorBreadth(), sectorBreadth.calculationId);

  const compositeCandidates: { readonly key: string; readonly artifact: CalculationArtifact }[] = [
    { key: 'news_sentiment', artifact: marketProxyResult.newsSentiment },
    { key: 'price_regime', artifact: marketProxyResult.priceRegime },
    { key: 'sector_breadth_score', artifact: sectorBreadth },
  ];
  const participating = compositeCandidates.filter((c) => c.artifact.eligibility === 'ok' && c.artifact.result !== null);

  const marketComposite = await computeAndStore({
    methodId: 'market.composite',
    subject: { kind: 'market', id: 'US', label: 'US market' },
    inputs: marketCompositeInputs(participating.map((c) => ({ key: c.key, exact: c.artifact.result?.exact as string }))),
    configVersion,
    asOf,
    computedAt: asOf,
  });
  await options.redis.set(KEYS.marketComposite(), marketComposite.calculationId);

  await options.redis.incr(KEYS.computedDepth());
  await options.redis.set(KEYS.degradedProviders(), JSON.stringify([...degraded]));
  await options.redis.del(KEYS.lastRefusal());

  return { ok: true, computedAt: asOf, degradedProviders: [...degraded] };
}

export async function runDashboardRefresh(options: RefreshOptions): Promise<RefreshOutcome> {
  const now = options.now ?? new Date();
  const asOf = now.toISOString();

  try {
    return await runDashboardRefreshUnguarded(options, now, asOf);
  } catch (error) {
    console.error('[dashboard] refresh failed', error);
    return {
      ok: false,
      reason: 'storage_unavailable',
      message:
        'The refresh could not reach storage. This is an infrastructure outage, not a provider condition — nothing was recomputed and nothing already recorded was touched.',
    };
  }
}
