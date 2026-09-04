/**
 * Test-only dashboard state seeding. **Never reachable outside `PROVIDER_MODE=fixture`** —
 * the route that calls this (`app/api/dashboard/e2e-seed/route.ts`) 404s in every other
 * mode, the identical guard `api/auth/fixture-otp/route.ts` (F02) already established.
 *
 * **Why this exists at all.** F07's e2e suite needs to drive all five §4.5 states (fresh,
 * stale, degraded, insufficient, empty) deterministically. Doing that through the real
 * `POST /api/dashboard/refresh` pipeline is only possible for the states the *committed*
 * fixtures happen to produce — today that is `insufficient` only, since `fixtures/market/
 * historical_price_full/success.json` carries 2 daily bars against `price.regime`'s 21-bar
 * requirement and `fixtures/marketaux/news_all/success.json` carries 2 articles against
 * `news.sentiment`'s 3-article floor (both COLLECT-owned fixtures this lane may not edit).
 * This seeds a `CalculationArtifact` directly, bypassing `computeArtifact`'s registry
 * arithmetic entirely — the arithmetic itself is already golden-tested in `tests/unit/calc/`;
 * what this needs to prove is that the *read path* and the *five renderings* are correct given
 * a state, not that the math produced it.
 */
import { randomUUID } from 'node:crypto';
import type { CalculationArtifact, Eligibility, Subject } from '@/calc/artifact';
import { insertCostEvent } from '@/repositories/cost';
import { persistArtifact } from '@/services/calculations';
import { GLOBAL_BUDGET_CEILING_USD } from './budget';
import { KEYS, type RedisClient } from './redis';
import { SECTOR_PROXIES } from './sector-proxies';

export type SeedState = 'fresh' | 'stale' | 'insufficient' | 'degraded' | 'empty';

function seedArtifact(args: {
  readonly methodId: string;
  readonly subject: Subject;
  readonly eligibility: Eligibility;
  readonly display: string;
  readonly unit: string;
  readonly asOf: string;
}): CalculationArtifact {
  const ok = args.eligibility === 'ok' || args.eligibility === 'stale';
  return {
    calculationId: randomUUID(),
    methodId: args.methodId,
    methodVersion: '1.0.0',
    subject: args.subject,
    asOf: args.asOf,
    inputs: [
      {
        key: 'seed_value',
        value: args.display,
        unit: args.unit,
        dataType: 'decimal',
        source: 'test_seed',
        quality: 'ok',
        freshness: 'fresh',
        provenance: {
          provider: 'test_seed',
          providerField: null,
          sourceUrl: null,
          observedAt: args.asOf,
          availableAt: args.asOf,
          ingestedAt: args.asOf,
          rawPayloadId: null,
          licenseClass: 'internal_fixture',
          redactionClass: 'public',
        },
      },
    ],
    assumptions: [],
    steps: [],
    result: ok ? { exact: args.display, display: args.display, roundingRule: 'ratio_6dp_half_even', unit: args.unit } : null,
    abstention: ok
      ? null
      : { reason: 'below_sample_threshold', message: 'Seeded for an e2e test: not enough observations to state a value.' },
    eligibility: args.eligibility,
    // Unique per call, not a constant: `calculation_snapshot_identity_unique` covers
    // `(metric_key, subject_type, subject_id, ..., config_version, input_hash)`, and a fixed
    // `'seed'` collided the moment an e2e run seeded the same (method, subject) pair twice —
    // exactly what happens across this suite's five states. Found running the suite for real.
    inputHash: randomUUID(),
    resultHash: randomUUID(),
    configVersion: '1',
    scenario: { kind: 'official' },
    points: null,
    warnings: [],
    retentionClass: 'standard',
    computedAt: args.asOf,
  };
}

async function persistAndPoint(redis: RedisClient, key: string, artifact: CalculationArtifact): Promise<void> {
  await persistArtifact(artifact);
  await redis.set(key, artifact.calculationId);
}

async function clearAll(redis: RedisClient): Promise<void> {
  await redis.del(KEYS.marketComposite());
  await redis.del(KEYS.marketSectorBreadth());
  await redis.del(KEYS.marketProxyMetric('news.sentiment'));
  await redis.del(KEYS.marketProxyMetric('price.regime'));
  for (const proxy of SECTOR_PROXIES) {
    await redis.del(KEYS.sectorMetric(proxy.sectorKey, 'news.sentiment'));
    await redis.del(KEYS.sectorMetric(proxy.sectorKey, 'price.regime'));
  }
  await redis.set(KEYS.computedDepth(), '0');
  await redis.set(KEYS.degradedProviders(), '[]');
  await redis.del(KEYS.lastRefusal());
}

export async function seedDashboardState(state: SeedState, redis: RedisClient): Promise<void> {
  await clearAll(redis);
  if (state === 'empty') return;

  const asOf = new Date().toISOString();
  const eligibility: Eligibility = state === 'stale' ? 'stale' : state === 'insufficient' ? 'insufficient_data' : 'ok';
  const marketSubject: Subject = { kind: 'market', id: 'US', label: 'US market' };

  await persistAndPoint(
    redis,
    KEYS.marketProxyMetric('news.sentiment'),
    seedArtifact({ methodId: 'news.sentiment', subject: marketSubject, eligibility, display: '0.20', unit: 'sentiment_unit', asOf }),
  );
  await persistAndPoint(
    redis,
    KEYS.marketProxyMetric('price.regime'),
    seedArtifact({ methodId: 'price.regime', subject: marketSubject, eligibility, display: '0.50', unit: 'trend_unit', asOf }),
  );
  await persistAndPoint(
    redis,
    KEYS.marketSectorBreadth(),
    seedArtifact({ methodId: 'market.sector_breadth', subject: marketSubject, eligibility, display: '-0.20', unit: 'score_unit', asOf }),
  );
  await persistAndPoint(
    redis,
    KEYS.marketComposite(),
    seedArtifact({ methodId: 'market.composite', subject: marketSubject, eligibility, display: '0.19', unit: 'score_unit', asOf }),
  );

  for (const proxy of SECTOR_PROXIES) {
    const sectorSubject: Subject = { kind: 'security', id: `seed-${proxy.tickerSymbol}`, label: proxy.tickerSymbol };
    await persistAndPoint(
      redis,
      KEYS.sectorMetric(proxy.sectorKey, 'news.sentiment'),
      seedArtifact({ methodId: 'news.sentiment', subject: sectorSubject, eligibility, display: '0.10', unit: 'sentiment_unit', asOf }),
    );
    await persistAndPoint(
      redis,
      KEYS.sectorMetric(proxy.sectorKey, 'price.regime'),
      seedArtifact({ methodId: 'price.regime', subject: sectorSubject, eligibility, display: '0.15', unit: 'trend_unit', asOf }),
    );
  }

  await redis.set(KEYS.computedDepth(), '1');
  await redis.set(KEYS.degradedProviders(), JSON.stringify(state === 'degraded' ? ['market', 'marketaux'] : []));
}

/**
 * Pushes this calendar month's recorded spend to the global ceiling with one real `cost_event`
 * row, so the e2e budget-refusal case exercises the actual `checkGlobalBudget` path
 * (`repositories/cost.ts#spendInWindow`) rather than a seeded marker. The only piece this
 * bypasses is *how* a real dashboard refresh would have spent it — market data and Marketaux
 * are never priced (`costUsd: null` unconditionally), so no combination of real refreshes could
 * ever reach the ceiling on this feature's own calls; something else in the budget (an LLM
 * call, a research run) is what a real deployment would have spent this on.
 */
/**
 * Clears the refresh cooldown and lock keys (`rate-limit.ts`) — both are process-global, not
 * per-session, so an e2e suite that runs the real refresh path more than once (across tests, or
 * across parallel workers sharing the in-memory Redis fallback) needs a way to reset them
 * between cases rather than inherit whichever test happened to run first.
 */
export async function resetRefreshRateLimit(redis: RedisClient): Promise<void> {
  await redis.del(KEYS.refreshCooldown());
  await redis.del(KEYS.refreshLock());
}

export async function seedBudgetExceeded(): Promise<void> {
  await insertCostEvent({
    occurredAt: new Date(),
    provider: 'model',
    service: 'e2e_seed',
    operationOrModel: 'e2e_seed',
    feature: 'dashboard.e2e_seed',
    jobRunId: null,
    researchRunId: null,
    userId: null,
    requestId: randomUUID(),
    unitType: 'call',
    requestUnits: '1',
    billableUnits: '1',
    unitPrice: GLOBAL_BUDGET_CEILING_USD,
    currency: 'USD',
    priceBookVersion: null,
    costUsd: GLOBAL_BUDGET_CEILING_USD,
    costStatus: 'actual',
    cacheStatus: 'miss',
    metadata: { seededFor: 'F07 e2e budget-refusal case' },
  });
}
