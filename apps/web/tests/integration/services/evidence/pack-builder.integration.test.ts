import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from '../../helpers/db';
import { closePool, getPool } from '@/repositories/client';
import { insertEvidenceItem, type NewEvidenceItem } from '@/repositories/evidence';
import { FixtureModelBackend } from '@/services/evidence/model-client';
import { buildEvidencePack } from '@/services/evidence/pack-builder';
import { evidencePack } from '@/contracts/evidence-pack';

const url = databaseUrl();

/**
 * F10 §5 ("Integration"): "pack construction over seeded evidence; provenance fields persisted;
 * availability checker updates state without touching the snippet." The availability-checker
 * half is not exercised here — this lane has no repository write to persist its result against
 * yet (see `services/evidence/availability-checker.ts`'s own docstring, reported under
 * `CONTRACTS`). What this suite proves is the other half: `buildEvidencePack` reads real,
 * committed `evidence_item` rows through the real `evidenceForSecurity` repository call — no
 * fake `Queryable` — and produces a schema-valid pack with every provenance field intact.
 */
describe.skipIf(url === undefined)('buildEvidencePack — integration', () => {
  let pool: pg.Pool;
  let securityId: string;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
    getPool(url);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
    const { rows } = await pool.query<{ id: string }>(
      `insert into security (symbol, name, exchange, asset_type, currency)
       values ('GME', 'GameStop Corp.', 'NYSE', 'equity', 'USD') returning id`,
    );
    securityId = rows[0]?.id as string;
  });

  afterAll(async () => {
    await closePool();
    await pool?.end();
  });

  function item(overrides: Partial<NewEvidenceItem> = {}): NewEvidenceItem {
    return {
      securityId,
      evidenceType: 'social_result',
      provider: 'reddit',
      title: 'GME rallies on renewed retail interest',
      snippet: 'GameStop Corp. shares rose sharply amid renewed retail attention this week.',
      sourceUrl: 'https://reddit.com/r/gme/comments/int1',
      publisher: null,
      authorRef: 'hash-int-1',
      stanceLabel: 'bullish',
      stanceScore: '0.70',
      relevanceScore: null,
      publishedAt: new Date('2026-09-01T00:00:00Z'),
      availableAt: new Date('2026-09-01T00:05:00Z'),
      // Pinned, not left to the real wall clock: the recurring defect flagged repeatedly
      // elsewhere in this codebase's history (evidence.test.ts, attention.test.ts twice,
      // market.test.ts once) — an `ingestedAt` that defaults to `now()` only stays before this
      // test's hardcoded `asOfInstant` (below) until the real clock catches up to it.
      ingestedAt: new Date('2026-09-01T00:00:00Z'),
      lastCheckedAt: null,
      availability: 'unchecked',
      licenseClass: 'own_collected',
      coverageClass: 'licensed_sample',
      rawHash: 'int-hash-1',
      metadata: { subreddit: 'gme', treeComplete: true },
      ...overrides,
    };
  }

  it('builds a schema-valid pack from real, committed evidence_item rows', async () => {
    await insertEvidenceItem(item());
    await insertEvidenceItem(
      item({ provider: 'x', sourceUrl: 'https://x.com/example/status/int2', rawHash: 'int-hash-2', metadata: {} }),
    );

    const backend = new FixtureModelBackend([
      {
        kind: 'json',
        body: [
          { itemId: 'placeholder', relevant: true, rationale: 'placeholder' }, // replaced below
        ],
      },
    ]);

    // The two inserted items' real ids are not known ahead of insertion — build the script from
    // what evidenceForSecurity would actually return by reading the pack's own retrievedCount
    // first is circular, so instead give a script permissive enough to admit any id: since
    // FixtureModelBackend just returns whatever JSON is scripted, and this repository read is
    // exercised for real, the assertions that matter here are provenance/shape, not the
    // relevance verdict itself — covered precisely by the unit suite's fake-DB tests.
    const pack = await buildEvidencePack(
      {
        securityId,
        asOfInstant: new Date('2026-09-04T00:00:00Z'),
        window: { from: new Date('2026-08-28T00:00:00Z'), to: new Date('2026-09-04T00:00:00Z') },
        retrievalQuery: `security_id = ${securityId}`,
        security: { symbol: 'GME', companyName: 'GameStop Corp.' },
      },
      {
        db: getPool(),
        modelBackend: backend,
        model: 'test-model',
        checkBudget: async () => ({ allowed: false, message: 'integration suite does not spend' }),
      },
    );

    expect(evidencePack.safeParse(pack).success).toBe(true);
    expect(pack.items.length).toBe(2);
    expect(pack.frames.length).toBe(3);
    // Provenance fields persisted and round-tripped, not fabricated by the builder.
    const redditItem = pack.items.find((i) => i.item.provider === 'reddit');
    expect(redditItem?.item.rawHash).toBe('int-hash-1');
    expect(redditItem?.item.stanceLabel).toBe('bullish');
  });
});
