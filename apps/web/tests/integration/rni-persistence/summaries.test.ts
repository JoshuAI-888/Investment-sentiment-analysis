import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import type { RniCombinedSummary, RniPlatformSlice, RniRun } from '../../../src/rni/contracts';
import {
  getRniCombinedSummary,
  persistRniCombinedSummary,
} from '../../../src/rni/repositories/summaries';
import { getRniPlatformSlices, persistRniRunWithSlices } from '../../../src/rni/repositories/runs';
import { databaseUrl, makePool, resetSchema, truncateAll } from '../helpers/db';
import { seedRniVersionLineage } from './version-fixtures';

const url = databaseUrl();

describe.skipIf(url === undefined)('RNI D05 cross-source summary persistence', () => {
  let pool: pg.Pool;
  let securityId: string;
  let run: RniRun;
  let slices: readonly [RniPlatformSlice, RniPlatformSlice];

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
    const versions = await seedRniVersionLineage(pool, 'd05');
    const { rows } = await pool.query<{ id: string }>(
      `insert into security (symbol, name, exchange, asset_type, currency)
       values ('NVDA', 'NVIDIA Corporation', 'NASDAQ', 'equity', 'USD') returning id`,
    );
    securityId = rows[0]!.id;
    run = {
      id: randomUUID(),
      idempotencyKey: 'rni-d05-run',
      trigger: 'manual',
      status: 'complete',
      windowStart: '2026-09-04T00:00:00.000Z',
      windowEnd: '2026-09-05T00:00:00.000Z',
      comparisonStart: null,
      comparisonEnd: null,
      universeVersion: versions.universeVersion,
      configVersion: versions.configVersion,
      promptVersion: 'p1',
      aiRoute: 'openai_direct',
      requestedAt: '2026-09-05T00:00:01.000Z',
      completedAt: '2026-09-05T00:08:00.000Z',
    };
    slices = [
      {
        id: randomUUID(),
        runId: run.id,
        platform: 'reddit',
        status: 'complete',
        eligibleSourceCount: 4,
        coverageDisclosure: 'Reddit sampled web discovery.',
        lastAttemptAt: '2026-09-05T00:01:00.000Z',
        lastSuccessfulRefreshAt: '2026-09-05T00:04:00.000Z',
        dataThroughAt: '2026-09-05T00:00:00.000Z',
        computedAt: '2026-09-05T00:05:00.000Z',
        errorCode: null,
      },
      {
        id: randomUUID(),
        runId: run.id,
        platform: 'x',
        status: 'complete',
        eligibleSourceCount: 2,
        coverageDisclosure: 'Configured X sample.',
        lastAttemptAt: '2026-09-05T00:01:00.000Z',
        lastSuccessfulRefreshAt: '2026-09-05T00:04:00.000Z',
        dataThroughAt: '2026-09-05T00:00:00.000Z',
        computedAt: '2026-09-05T00:05:00.000Z',
        errorCode: null,
      },
    ];
    await persistRniRunWithSlices(run, slices, pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  function summary(overrides: Partial<RniCombinedSummary> = {}): RniCombinedSummary {
    return {
      id: randomUUID(),
      runId: run.id,
      securityId,
      status: 'complete',
      sections: [
        {
          heading: 'Reddit sentiment',
          status: 'complete',
          text: 'The Reddit sample is bullish.',
          citationIds: [],
        },
        {
          heading: 'X sentiment',
          status: 'complete',
          text: 'The X sample is bearish.',
          citationIds: [],
        },
        {
          heading: 'Combined summary',
          status: 'complete',
          text: 'The two sources disagree; neither component is changed.',
          citationIds: [],
        },
      ],
      createdAt: '2026-09-05T00:08:00.000Z',
      ...overrides,
    };
  }

  it('fails closed before a standalone summary can bypass cited-synthesis lineage', async () => {
    const before = await getRniPlatformSlices(run.id, pool);
    const input = summary();
    await expect(persistRniCombinedSummary(input, pool)).rejects.toThrow(
      'standalone combined-summary writes are retired',
    );
    const after = await getRniPlatformSlices(run.id, pool);

    expect(after).toEqual(before);
    expect(await getRniCombinedSummary(run.id, securityId, pool)).toBeUndefined();
    expect((await pool.query('select id from rni_combined_summary')).rowCount).toBe(0);
  });

  it('does not mutate an unavailable component slice while refusing a partial standalone write', async () => {
    await pool.query(
      `update rni_platform_slice
          set status = 'unavailable', eligible_source_count = 0, error_code = 'X_UNAVAILABLE'
        where run_id = $1 and platform = 'x'`,
      [run.id],
    );
    const partial = summary({
      status: 'partial',
      sections: [
        {
          heading: 'Reddit sentiment',
          status: 'complete',
          text: 'Reddit remains publishable.',
          citationIds: [],
        },
        {
          heading: 'X sentiment',
          status: 'insufficient',
          text: 'X is unavailable.',
          citationIds: [],
        },
        {
          heading: 'Combined summary',
          status: 'partial',
          text: 'Only Reddit is represented; no fallback is claimed.',
          citationIds: [],
        },
      ],
    });
    const before = await getRniPlatformSlices(run.id, pool);
    await expect(persistRniCombinedSummary(partial, pool)).rejects.toThrow(
      'atomic cited-synthesis persistence adapter',
    );
    expect(await getRniPlatformSlices(run.id, pool)).toEqual(before);
    expect((await getRniPlatformSlices(run.id, pool))[1]).toMatchObject({
      platform: 'x',
      status: 'unavailable',
      errorCode: 'X_UNAVAILABLE',
    });
  });

  it('preserves historical summary reads and their immutable component references', async () => {
    const historical = summary();
    const before = await getRniPlatformSlices(run.id, pool);
    await pool.query('alter table rni_combined_summary disable trigger rni_combined_summary_requires_cited_artifact');
    try {
      await pool.query(
        `insert into rni_combined_summary (
           id, run_id, security_id, reddit_platform_slice_id, x_platform_slice_id, status,
           sections, created_at
         ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
        [
          historical.id,
          historical.runId,
          historical.securityId,
          slices[0].id,
          slices[1].id,
          historical.status,
          JSON.stringify(historical.sections),
          historical.createdAt,
        ],
      );
    } finally {
      await pool.query('alter table rni_combined_summary enable trigger rni_combined_summary_requires_cited_artifact');
    }

    expect(await getRniCombinedSummary(run.id, securityId, pool)).toEqual(historical);
    expect(await getRniPlatformSlices(run.id, pool)).toEqual(before);
    const { rows } = await pool.query<{
      reddit_platform_slice_id: string;
      x_platform_slice_id: string;
    }>(
      'select reddit_platform_slice_id, x_platform_slice_id from rni_combined_summary where id = $1',
      [historical.id],
    );
    expect(rows[0]).toEqual({
      reddit_platform_slice_id: slices[0].id,
      x_platform_slice_id: slices[1].id,
    });
  });
});
