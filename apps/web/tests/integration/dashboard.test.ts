import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import { closePool, getPool } from '../../src/repositories/client';
import { activateConfigVersion, insertConfigVersion } from '../../src/repositories/versions';
import { computeArtifact, persistArtifact } from '../../src/services/calculations';
import { assembleDashboard } from '../../src/services/dashboard/assemble';
import { DASHBOARD_CONFIG_ENVIRONMENT, runDashboardRefresh } from '../../src/services/dashboard/refresh';
import { inMemoryRedisClient, KEYS } from '../../src/services/dashboard/redis';

const url = databaseUrl();

const AUDIT = { actorId: 'owner', actorRole: 'admin', reason: 'test', requestId: 'req-1', correlationId: 'corr-1' };

const WEB_ROOT = fileURLToPath(new URL('../../', import.meta.url));

describe.skipIf(url === undefined)('F07 — the dashboard read and refresh paths, end to end', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
    getPool(url);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
  });

  afterAll(async () => {
    await closePool();
    await pool?.end();
  });

  describe('assembleDashboard — read path', () => {
    it('is empty (cold start) when nothing has ever been computed', async () => {
      const redis = inMemoryRedisClient();
      const dashboard = await assembleDashboard({ redis });
      expect(dashboard.state).toBe('empty');
      expect(dashboard.computedDepth).toBe(0);
      expect(dashboard.marketComposite.composite).toBeNull();
      expect(dashboard.sectorTiles).toHaveLength(11);
      expect(dashboard.sectorTiles.every((tile) => tile.newsSentiment === null && tile.priceRegime === null)).toBe(true);
    });

    it('assembles entirely from a stored artifact reached through its Redis pointer', async () => {
      const redis = inMemoryRedisClient();
      const artifact = computeArtifact({
        methodId: 'price.regime',
        subject: { kind: 'security', id: '00000000-0000-4000-8000-000000000099', label: 'SPY' },
        asOf: '2026-08-30T12:00:00.000Z',
        inputs: [
          {
            key: 'quote_kind',
            value: 'close_unadjusted',
            unit: null,
            dataType: 'identity',
            source: 'test',
            quality: 'ok',
            freshness: 'fresh',
            provenance: {
              provider: 'test',
              providerField: null,
              sourceUrl: null,
              observedAt: null,
              availableAt: null,
              ingestedAt: null,
              rawPayloadId: null,
              licenseClass: 'internal_fixture',
              redactionClass: 'public',
            },
          },
        ],
        assumptions: [],
        configVersion: '1',
        calculationId: '00000000-0000-4000-8000-000000000001',
      });
      // A `quote_kind` other than `adjusted_close` abstains `not_applicable` — a real state,
      // and exactly what this read-path test needs: it proves the *pointer round trip*, not
      // the arithmetic (already golden-tested in `tests/unit/calc/`).
      await persistArtifact(artifact);
      await redis.set(KEYS.marketProxyMetric('price.regime'), artifact.calculationId);
      await redis.set(KEYS.computedDepth(), '1');

      const dashboard = await assembleDashboard({ redis });
      expect(dashboard.state).toBe('insufficient');
      const component = dashboard.marketComposite.components.find((c) => c.key === 'price_regime');
      expect(component?.metric?.calculationId).toBe(artifact.calculationId);
      expect(component?.metric?.eligibility).toBe('not_applicable');
      expect(component?.participated).toBe(false);
    });

    it('renders degraded, naming the provider, when storage cannot be reached', async () => {
      const redis = inMemoryRedisClient();
      await redis.set(KEYS.marketComposite(), '00000000-0000-4000-8000-00000000dead');
      await redis.set(KEYS.computedDepth(), '1');

      // `db: {}` is not a real `pg.Pool` — `loadArtifact`'s own query call throws, which is
      // exactly the "storage unreachable" condition this test exercises without needing to
      // actually unset `DATABASE_URL` (a process-wide env var no other test in this file could
      // then safely share).
      const brokenDb = { query: async () => { throw new Error('connection refused'); } };
      const dashboard = await assembleDashboard({ redis, db: brokenDb as never });

      expect(dashboard.state).toBe('degraded');
      expect(dashboard.degradedProviders).toContain('database');
    });

    it('the read path imports no adapter — no provider call is reachable from it', () => {
      const assembleSource = readFileSync(path.join(WEB_ROOT, 'src/services/dashboard/assemble.ts'), 'utf8');
      const metricsSource = readFileSync(path.join(WEB_ROOT, 'src/services/dashboard/metrics.ts'), 'utf8');
      expect(assembleSource).not.toMatch(/from ['"]@\/adapters|from ['"]\.\.\/\.\.\/adapters/);
      expect(metricsSource).not.toMatch(/from ['"]@\/adapters|from ['"]\.\.\/\.\.\/adapters/);
    });
  });

  describe('runDashboardRefresh — the internal job', () => {
    it('refuses cleanly with no active config_version, and computes nothing', async () => {
      const redis = inMemoryRedisClient();
      const outcome = await runDashboardRefresh({ redis, requestedBy: 'test' });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.reason).toBe('no_active_config_version');

      const dashboard = await assembleDashboard({ redis });
      expect(dashboard.state).toBe('empty');
    });

    it(
      'against the committed fixtures, computes and persists a full cycle — insufficient, not crashed',
      async () => {
        const draft = await insertConfigVersion({
          environment: DASHBOARD_CONFIG_ENVIRONMENT,
          createdBy: 'owner',
          changeReason: 'test',
          checksum: 'sum-1',
        });
        await activateConfigVersion(DASHBOARD_CONFIG_ENVIRONMENT, draft.id, AUDIT);

        const redis = inMemoryRedisClient();
        const outcome = await runDashboardRefresh({ redis, requestedBy: 'test' });
        expect(outcome.ok).toBe(true);

        const dashboard = await assembleDashboard({ redis });
        expect(dashboard.computedDepth).toBe(1);
        // Real, honest arithmetic on the committed fixtures (2 daily bars against a 21-bar
        // floor; 2 articles against a 3-article floor): every component abstains, so the
        // composite abstains too — `no_coverage_in_window`, not a crash and not a fabricated
        // zero.
        expect(dashboard.state).toBe('insufficient');
        expect(dashboard.marketComposite.composite?.eligibility).toBe('insufficient_data');
        expect(dashboard.marketComposite.components.every((c) => !c.participated)).toBe(true);
        expect(dashboard.sectorTiles).toHaveLength(11);
        for (const tile of dashboard.sectorTiles) {
          expect(tile.priceRegime?.eligibility).toBe('not_applicable');
        }
      },
      30_000,
    );
  });
});
