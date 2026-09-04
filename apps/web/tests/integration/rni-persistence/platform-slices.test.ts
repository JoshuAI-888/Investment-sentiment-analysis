import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import type { RniPlatformSlice, RniRun } from '../../../src/rni/contracts';
import {
  getRniPlatformSlices,
  getRniRunById,
  persistRniRunWithSlices,
} from '../../../src/rni/repositories/runs';
import { databaseUrl, makePool, resetSchema, truncateAll } from '../helpers/db';

const url = databaseUrl();

describe.skipIf(url === undefined)('RNI D04 independent platform slices', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  function run(overrides: Partial<RniRun> = {}): RniRun {
    return {
      id: randomUUID(),
      idempotencyKey: 'rni-d04-run',
      trigger: 'manual',
      status: 'running',
      windowStart: '2026-09-04T00:00:00.000Z',
      windowEnd: '2026-09-05T00:00:00.000Z',
      comparisonStart: null,
      comparisonEnd: null,
      universeVersion: 'sp500-2026-09-05',
      configVersion: 'rni-config-v1',
      promptVersion: 'rni-prompts-v1',
      aiRoute: 'openai_direct',
      requestedAt: '2026-09-05T00:00:01.000Z',
      completedAt: null,
      ...overrides,
    };
  }

  function slices(runId: string): readonly [RniPlatformSlice, RniPlatformSlice] {
    return [
      {
        id: randomUUID(),
        runId,
        platform: 'reddit',
        status: 'complete',
        eligibleSourceCount: 3,
        coverageDisclosure: 'Reddit sampled web discovery.',
        lastAttemptAt: '2026-09-05T00:00:02.000Z',
        lastSuccessfulRefreshAt: '2026-09-05T00:00:04.000Z',
        dataThroughAt: '2026-09-05T00:00:00.000Z',
        computedAt: '2026-09-05T00:00:05.000Z',
        errorCode: null,
      },
      {
        id: randomUUID(),
        runId,
        platform: 'x',
        status: 'unavailable',
        eligibleSourceCount: 0,
        coverageDisclosure: 'Configured X sample unavailable; no fallback used.',
        lastAttemptAt: '2026-09-05T00:00:02.000Z',
        lastSuccessfulRefreshAt: null,
        dataThroughAt: null,
        computedAt: null,
        errorCode: 'X_PROVIDER_UNAVAILABLE',
      },
    ];
  }

  it('atomically stores exactly one Reddit and one X slice without fallback mutation', async () => {
    const input = run();
    const result = await persistRniRunWithSlices(input, slices(input.id), pool);

    expect(result.runInserted).toBe(true);
    expect(result.insertedSliceCount).toBe(2);
    expect(result.slices.map((slice) => [slice.platform, slice.status])).toEqual([
      ['reddit', 'complete'],
      ['x', 'unavailable'],
    ]);
    expect(await getRniRunById(input.id, pool)).toEqual(input);
    expect(await getRniPlatformSlices(input.id, pool)).toEqual(result.slices);
  });

  it('returns the original run and slices on idempotent redelivery', async () => {
    const firstInput = run();
    const first = await persistRniRunWithSlices(firstInput, slices(firstInput.id), pool);
    const redeliveredRun = run({ id: randomUUID(), idempotencyKey: firstInput.idempotencyKey });
    const second = await persistRniRunWithSlices(redeliveredRun, slices(redeliveredRun.id), pool);

    expect(second.run.id).toBe(first.run.id);
    expect(second.runInserted).toBe(false);
    expect(second.insertedSliceCount).toBe(0);
    expect(second.slices).toEqual(first.slices);
  });

  it('rejects missing, duplicate, or cross-run platform slices before persistence', async () => {
    const input = run();
    const pair = slices(input.id);
    await expect(persistRniRunWithSlices(input, [pair[0]], pool)).rejects.toThrow(
      'exactly two platform slices',
    );
    await expect(
      persistRniRunWithSlices(input, [pair[0], { ...pair[1], platform: 'reddit' }], pool),
    ).rejects.toThrow('one reddit and one x');
    await expect(
      persistRniRunWithSlices(input, [pair[0], { ...pair[1], runId: randomUUID() }], pool),
    ).rejects.toThrow('must reference the supplied run');

    const { rows } = await pool.query<{ count: string }>(
      'select count(*)::text as count from rni_run',
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('fails a direct transaction that commits a run without both platform slices', async () => {
    const client = await pool.connect();
    const input = run();
    try {
      await client.query('begin');
      await client.query(
        `insert into rni_run (
           id, idempotency_key, trigger, status, window_start, window_end, universe_version,
           config_version, prompt_version, requested_at
         ) values ($1, $2, 'manual', 'running', $3, $4, 'u1', 'c1', 'p1', $5)`,
        [input.id, input.idempotencyKey, input.windowStart, input.windowEnd, input.requestedAt],
      );
      await client.query(
        `insert into rni_platform_slice (
           id, run_id, platform, status, coverage_disclosure
         ) values ($1, $2, 'reddit', 'running', 'sampled')`,
        [randomUUID(), input.id],
      );
      await expect(client.query('commit')).rejects.toMatchObject({ code: '23514' });
      await client.query('rollback');
    } finally {
      client.release();
    }
  });
});
