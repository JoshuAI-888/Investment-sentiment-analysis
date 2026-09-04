import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from '../integration/helpers/db';
import { closePool, getPool } from '../../src/repositories/client';
import { insertCostEvent } from '../../src/repositories/cost';
import { callProvider } from '../../src/adapters/wrapper';
import { apewisdomWrapperDeps } from '../../src/services/attention/provider-deps';
import { marketauxWrapperDeps } from '../../src/services/dashboard/provider-deps';
import { findDegradationEntry } from '../../src/services/degradation/catalogue';

const url = databaseUrl();

/**
 * F18 §4.5 — "disables each noncritical provider in turn and asserts: the page renders, the
 * degraded state is explicit and named, no invented content appears, no unhandled error reaches
 * the user." Driven at the wrapper level (`adapters/wrapper.ts`'s `callProvider`, the real
 * pre-dispatch/retry/breaker path every adapter goes through) rather than through a full page
 * render, for the two providers this feature has a real, deterministic seam to fail on demand
 * (a fake `fetcher`) without live-mode HTTP mocking infrastructure this session does not build.
 * Every assertion here is cross-checked against `services/degradation/catalogue.ts` — the single
 * source of truth this feature and `/admin/data-sources` both read — so the two can never
 * silently disagree about what a given outage is supposed to do.
 *
 * **ApeWisdom is included here as a *collector* case, not a "noncritical provider" case** — a
 * self-review correction caught while running this feature's own e2e gate: ApeWisdom is F08's
 * only running attention collector (D-39 dropped the Reddit Data API path D-12/D-30's "demoted
 * cross-check" ruling assumed), so it is never budget-gated, matching the market-data poll. Its
 * chaos coverage here proves an upstream outage still resolves honestly — it does *not* prove a
 * budget-denied case, because there is no such case for this provider any more.
 *
 * **Not covered here, disclosed rather than silently skipped:** F20 scorer, X, FMP fundamentals,
 * SEC/FRED and the LLM methods each have their own dedicated failure-mode test coverage in their
 * own feature's suite (`adapters/scorer.test.ts`, `evidence/availability.test.ts`, etc.) — this
 * file does not re-derive that coverage.
 */
describe.skipIf(url === undefined)('F18 chaos suite — per-provider degradation, no invented content', () => {
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

  describe('ApeWisdom disabled (upstream 500, then exhausted retries)', () => {
    it('the call resolves honestly — no unhandled error, no fabricated ranking data', async () => {
      const deps = apewisdomWrapperDeps({ db: pool });
      const result = await callProvider(
        {
          provider: 'apewisdom',
          operation: 'rankings',
          schema: z.object({}).passthrough(),
          request: { url: 'https://apewisdom.example/rankings' },
          timeoutMs: 50,
        },
        {
          ...deps,
          fetcher: async () => ({ status: 500, headers: {}, body: { error: 'internal' } }),
        },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        // An honest, named failure kind — never a thrown exception, never a fabricated 200.
        expect(['upstream', 'timeout', 'circuit_open']).toContain(result.error.kind);
      }

      const catalogued = findDegradationEntry('ApeWisdom');
      expect(catalogued).toBeDefined();
      expect(catalogued?.severity).toBe('critical');
      expect(catalogued?.behavior).toContain('only running attention collector');
    });

    it('is never budget-denied, even at the hard-block tier — it is a collector, never gated (like market data)', async () => {
      await insertCostEvent(
        {
          occurredAt: new Date('2026-09-01T00:00:00Z'),
          provider: 'fmp',
          service: 'chaos_test',
          operationOrModel: 'test',
          feature: 'f18.chaos_suite',
          jobRunId: null,
          researchRunId: null,
          userId: null,
          requestId: randomUUID(),
          unitType: 'call',
          requestUnits: '1',
          billableUnits: '1',
          unitPrice: '350.00',
          currency: 'USD',
          priceBookVersion: null,
          costUsd: '350.00',
          costStatus: 'actual',
          cacheStatus: 'miss',
          metadata: {},
        },
        pool,
      );

      let fetcherCalled = false;
      const deps = apewisdomWrapperDeps({ db: pool });
      const result = await callProvider(
        {
          provider: 'apewisdom',
          operation: 'rankings',
          schema: z.object({ ok: z.literal(true) }),
          request: { url: 'https://apewisdom.example/rankings' },
        },
        {
          ...deps,
          fetcher: async () => {
            fetcherCalled = true;
            return { status: 200, headers: {}, body: { ok: true } };
          },
        },
      );

      expect(fetcherCalled).toBe(true); // reached the network — never budget-denied
      expect(result.ok).toBe(true);
    });
  });

  describe('Marketaux disabled (timeout)', () => {
    it('the call resolves honestly — no unhandled error, no fabricated news sentiment', async () => {
      const deps = marketauxWrapperDeps({ db: pool });
      const result = await callProvider(
        {
          provider: 'marketaux',
          operation: 'news',
          schema: z.object({}).passthrough(),
          request: { url: 'https://marketaux.example/news' },
          timeoutMs: 10,
        },
        {
          ...deps,
          // A well-behaved fetcher respects the abort signal `callProvider` fires at its own
          // deadline (`adapters/wrapper.ts` stage 5) rather than hanging forever — this mirrors
          // what a real `fetch()` does, and is what actually exercises the timeout classification
          // (`classifyThrown`) rather than leaving the test itself hanging.
          fetcher: ({ signal }) =>
            new Promise((_resolve, reject) => {
              if (signal.aborted) {
                reject(signal.reason);
                return;
              }
              signal.addEventListener('abort', () => reject(signal.reason));
            }),
        },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('timeout');

      const catalogued = findDegradationEntry('Marketaux');
      expect(catalogued).toBeDefined();
      expect(catalogued?.severity).toBe('low');
      expect(catalogued?.behavior).toContain('renormalizes');
    });
  });

  describe('Marketaux, budget-denied rather than upstream-failed', () => {
    it('a budget-denied optional call is equally honest — never invented content either', async () => {
      // Drive spend to the reduce tier so the optional gate (`dashboard/provider-deps.ts`'s
      // Marketaux gate) refuses before dispatch — a second, distinct way this provider goes
      // "unavailable" from the reader's point of view, that must be exactly as honest as an
      // upstream failure.
      await insertCostEvent(
        {
          occurredAt: new Date('2026-09-01T00:00:00Z'),
          provider: 'fmp',
          service: 'chaos_test',
          operationOrModel: 'test',
          feature: 'f18.chaos_suite',
          jobRunId: null,
          researchRunId: null,
          userId: null,
          requestId: randomUUID(),
          unitType: 'call',
          requestUnits: '1',
          billableUnits: '1',
          unitPrice: '320.00',
          currency: 'USD',
          priceBookVersion: null,
          costUsd: '320.00',
          costStatus: 'actual',
          cacheStatus: 'miss',
          metadata: {},
        },
        pool,
      );

      let fetcherCalled = false;
      const deps = marketauxWrapperDeps({ db: pool });
      const result = await callProvider(
        {
          provider: 'marketaux',
          operation: 'news',
          schema: z.object({}).passthrough(),
          request: { url: 'https://marketaux.example/news' },
        },
        {
          ...deps,
          fetcher: async () => {
            fetcherCalled = true;
            return { status: 200, headers: {}, body: {} };
          },
        },
      );

      expect(fetcherCalled).toBe(false); // the network was never reached
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('budget_denied');
    });
  });
});
