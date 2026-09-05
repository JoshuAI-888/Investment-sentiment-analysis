import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';

import { canonicalHash } from '../../../src/calc/canonical';
import { calculatePlatformAnalytics } from '../../../src/rni/analytics';
import type { RniPlatformSlice, RniRun } from '../../../src/rni/contracts';
import { convergePlatformFacts } from '../../../src/rni/convergence';
import { PostgresRniAnalyticsArtifactPersistence } from '../../../src/rni/repositories/engine-artifacts';
import { persistRniRunWithSlices } from '../../../src/rni/repositories/runs';
import { methodology, platformInput as analyticsInput } from '../../unit/rni/analytics/fixtures';
import {
  convergenceRequest,
  platformInput as convergencePlatformInput,
} from '../../unit/rni/convergence/fixtures';
import { databaseUrl, makePool, resetSchema, truncateAll } from '../helpers/db';
import { seedRniVersionLineage } from './version-fixtures';

const url = databaseUrl();

describe.skipIf(url === undefined)('RNI D12 ENGINE artifact persistence', () => {
  let pool: pg.Pool;
  let adapter: PostgresRniAnalyticsArtifactPersistence;
  let runId: string;
  let securityId: string;
  let redditSliceId: string;
  let xSliceId: string;

  beforeAll(async () => {
    pool = makePool();
    adapter = new PostgresRniAnalyticsArtifactPersistence(pool);
    await resetSchema(pool);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
    const versions = await seedRniVersionLineage(pool, 'd12');
    runId = randomUUID();
    securityId = randomUUID();
    redditSliceId = randomUUID();
    xSliceId = randomUUID();
    await pool.query(
      `insert into security (id, symbol, name, exchange, asset_type, currency)
       values ($1, 'NVDA', 'NVIDIA Corporation', 'NASDAQ', 'equity', 'USD')`,
      [securityId],
    );
    const run: RniRun = {
      id: runId,
      idempotencyKey: `d12-${runId}`,
      trigger: 'manual',
      status: 'running',
      windowStart: '2026-09-04T00:00:00.000Z',
      windowEnd: '2026-09-05T12:00:00.000Z',
      comparisonStart: null,
      comparisonEnd: null,
      universeVersion: versions.universeVersion,
      configVersion: versions.configVersion,
      promptVersion: 'p1',
      aiRoute: 'openai_direct',
      requestedAt: '2026-09-05T00:00:00.000Z',
      completedAt: null,
    };
    const slices: readonly [RniPlatformSlice, RniPlatformSlice] = [
      slice('reddit', redditSliceId),
      slice('x', xSliceId),
    ];
    await persistRniRunWithSlices(run, slices, pool);
  });

  afterAll(async () => pool?.end());

  function slice(platform: 'reddit' | 'x', id: string): RniPlatformSlice {
    return {
      id,
      runId,
      platform,
      status: 'complete',
      eligibleSourceCount: 2,
      coverageDisclosure: `${platform} fixture`,
      lastAttemptAt: null,
      lastSuccessfulRefreshAt: null,
      dataThroughAt: null,
      computedAt: null,
      errorCode: null,
    };
  }

  function analytics(
    platform: 'reddit' | 'x',
    sliceId: string,
    version = 'methodology-v1',
    identity: { readonly runId?: string; readonly securityId?: string } = {},
  ) {
    const input = analyticsInput(platform);
    const artifactRunId = identity.runId ?? runId;
    const artifactSecurityId = identity.securityId ?? securityId;
    return calculatePlatformAnalytics(
      {
        ...input,
        runId: artifactRunId,
        runSourceSliceId: sliceId,
        securityId: artifactSecurityId,
        current: {
          ...input.current,
          observations: input.current.observations.map((observation) => ({
            ...observation,
            platform,
            securityId: artifactSecurityId,
          })),
        },
        comparison:
          input.comparison === null
            ? null
            : {
                ...input.comparison,
                observations: input.comparison.observations.map((observation) => ({
                  ...observation,
                  platform,
                  securityId: artifactSecurityId,
                })),
              },
        baseline: input.baseline.map((entry) => ({
          ...entry,
          platform,
          securityId: artifactSecurityId,
          methodologyVersion: version,
        })),
      },
      methodology(version),
    );
  }

  function convergence(
    redditHash: string,
    xHash: string,
    policyVersion = 'rni-convergence-policy-v1',
  ) {
    const request = convergenceRequest({
      reddit: convergencePlatformInput('reddit', {
        runId,
        runSourceSliceId: redditSliceId,
        securityId,
        analyticsArtifactHash: redditHash,
      }),
      x: convergencePlatformInput('x', {
        runId,
        runSourceSliceId: xSliceId,
        securityId,
        analyticsArtifactHash: xHash,
      }),
    });
    return convergePlatformFacts({
      ...request,
      policy: { ...request.policy, version: policyVersion },
    });
  }

  it('persists Reddit and X independently, then binds exact convergence components', async () => {
    const reddit = analytics('reddit', redditSliceId);
    const x = analytics('x', xSliceId);
    const redditCommit = await adapter.commitPlatformAnalytics(reddit);
    const xCommit = await adapter.commitPlatformAnalytics(x);
    expect(redditCommit.artifactHash).toBe(canonicalHash(reddit));
    expect(xCommit.artifactHash).toBe(canonicalHash(x));
    const artifact = convergence(redditCommit.artifactHash, xCommit.artifactHash);
    const convergenceCommits = await Promise.all([
      adapter.commitConvergence(artifact),
      adapter.commitConvergence(artifact),
    ]);
    expect(convergenceCommits.map(({ disposition }) => disposition).sort()).toEqual([
      'duplicate',
      'inserted',
    ]);
    expect(convergenceCommits[0]?.artifactHash).toBe(canonicalHash(artifact));
    const platformRows = await pool.query<{
      id: string;
      platform: 'reddit' | 'x';
      artifact_hash: string;
      input_hash: string;
      result_hash: string;
      input_snapshot: unknown;
      result_snapshot: unknown;
    }>('select * from rni_platform_analytics_artifact order by platform');
    expect(platformRows.rows).toHaveLength(2);
    const redditRow = platformRows.rows.find(({ platform }) => platform === 'reddit');
    const xRow = platformRows.rows.find(({ platform }) => platform === 'x');
    expect(redditRow).toMatchObject({
      artifact_hash: canonicalHash(reddit),
      input_hash: reddit.inputSetHash,
      result_hash: reddit.resultHash,
      input_snapshot: { input: reddit.inputSnapshot, methodology: reddit.methodologySnapshot },
      result_snapshot: reddit.result,
    });
    expect(xRow).toMatchObject({
      artifact_hash: canonicalHash(x),
      input_hash: x.inputSetHash,
      result_hash: x.resultHash,
      input_snapshot: { input: x.inputSnapshot, methodology: x.methodologySnapshot },
      result_snapshot: x.result,
    });
    const convergenceRows = await pool.query<{
      reddit_analytics_id: string;
      reddit_artifact_hash: string;
      x_analytics_id: string;
      x_artifact_hash: string;
    }>('select * from rni_convergence_artifact');
    expect(convergenceRows.rows).toEqual([
      expect.objectContaining({
        reddit_analytics_id: redditRow?.id,
        reddit_artifact_hash: redditCommit.artifactHash,
        x_analytics_id: xRow?.id,
        x_artifact_hash: xCommit.artifactHash,
      }),
    ]);
    await expect(
      adapter.commitConvergence(
        convergence(redditCommit.artifactHash, xCommit.artifactHash, 'rni-convergence-policy-v2'),
      ),
    ).rejects.toThrow('convergence identity reused');
  });

  it('rejects crossed platform bytes and slice ownership', async () => {
    await adapter.commitPlatformAnalytics(analytics('reddit', redditSliceId));
    await expect(adapter.commitPlatformAnalytics(analytics('reddit', redditSliceId, 'methodology-v2'))).rejects.toThrow(
      'platform identity reused',
    );
    await expect(adapter.commitPlatformAnalytics(analytics('x', redditSliceId))).rejects.toMatchObject({
      constraint: 'rni_platform_analytics_slice_fk',
    });
    await expect(
      adapter.commitPlatformAnalytics(
        analytics('reddit', redditSliceId, 'methodology-v1', { runId: randomUUID() }),
      ),
    ).rejects.toMatchObject({ constraint: 'rni_platform_analytics_artifact_run_id_fkey' });
    await expect(
      adapter.commitPlatformAnalytics(
        analytics('reddit', redditSliceId, 'methodology-v1', { securityId: randomUUID() }),
      ),
    ).rejects.toMatchObject({ constraint: 'rni_platform_analytics_artifact_security_id_fkey' });
  });

  it('rejects convergence with wrong component hashes', async () => {
    const reddit = analytics('reddit', redditSliceId);
    const x = analytics('x', xSliceId);
    const redditCommit = await adapter.commitPlatformAnalytics(reddit);
    await adapter.commitPlatformAnalytics(x);
    await expect(
      adapter.commitConvergence(convergence(redditCommit.artifactHash, 'c'.repeat(64))),
    ).rejects.toThrow('missing exact x analytics component');
    expect((await pool.query('select id from rni_convergence_artifact')).rowCount).toBe(0);
  });

  it('rejects a schema-valid convergence replay with crossed durable component binding', async () => {
    const reddit = analytics('reddit', redditSliceId);
    const x = analytics('x', xSliceId);
    const redditCommit = await adapter.commitPlatformAnalytics(reddit);
    const xCommit = await adapter.commitPlatformAnalytics(x);
    const alternateRedditId = randomUUID();
    const alternateRedditHash = 'd'.repeat(64);
    await pool.query(
      `insert into rni_platform_analytics_artifact (
         id, run_id, platform_slice_id, platform, security_id, methodology_version,
         calculation_code_version, input_hash, result_hash, artifact_hash, input_snapshot,
         result_snapshot, created_at
       ) select $1, run_id, platform_slice_id, platform, security_id, methodology_version,
                calculation_code_version, input_hash, result_hash, $2, input_snapshot,
                result_snapshot, created_at
           from rni_platform_analytics_artifact where artifact_hash = $3`,
      [alternateRedditId, alternateRedditHash, redditCommit.artifactHash],
    );
    const { rows: xRows } = await pool.query<{ id: string }>(
      'select id from rni_platform_analytics_artifact where artifact_hash = $1',
      [xCommit.artifactHash],
    );
    const artifact = convergence(redditCommit.artifactHash, xCommit.artifactHash);
    await pool.query(
      `insert into rni_convergence_artifact (
         id, run_id, security_id, reddit_analytics_id, reddit_artifact_hash,
         x_analytics_id, x_artifact_hash, policy_version, calculation_code_version,
         input_hash, result_hash, input_snapshot, result_snapshot, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14)`,
      [
        randomUUID(),
        runId,
        securityId,
        alternateRedditId,
        alternateRedditHash,
        xRows[0]?.id,
        xCommit.artifactHash,
        artifact.policyVersion,
        artifact.calculationCodeVersion,
        artifact.inputHash,
        artifact.resultHash,
        JSON.stringify(artifact.inputSnapshot),
        JSON.stringify(artifact.result),
        artifact.inputSnapshot.asOf,
      ],
    );
    await expect(adapter.commitConvergence(artifact)).rejects.toThrow(
      'convergence identity reused with different canonical artifact',
    );
  });

  it('serializes concurrent exact replay to one durable platform artifact', async () => {
    const artifact = analytics('reddit', redditSliceId);
    const results = await Promise.all([
      adapter.commitPlatformAnalytics(artifact),
      adapter.commitPlatformAnalytics(artifact),
    ]);
    expect(results.map(({ disposition }) => disposition).sort()).toEqual(['duplicate', 'inserted']);
    expect((await pool.query('select id from rni_platform_analytics_artifact')).rowCount).toBe(1);
  });

  it('rejects replay when durable creation time differs only below millisecond precision', async () => {
    const artifact = analytics('reddit', redditSliceId);
    const artifactHash = canonicalHash(artifact);
    await pool.query(
      `insert into rni_platform_analytics_artifact (
         id, run_id, platform_slice_id, platform, security_id, methodology_version,
         calculation_code_version, input_hash, result_hash, artifact_hash, input_snapshot,
         result_snapshot, created_at
       ) values ($1, $2, $3, 'reddit', $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb,
                 '2026-09-05T12:00:00.000123Z')`,
      [
        randomUUID(),
        runId,
        redditSliceId,
        securityId,
        artifact.methodologyVersion,
        artifact.calculationCodeVersion,
        artifact.inputSetHash,
        artifact.resultHash,
        artifactHash,
        JSON.stringify({ input: artifact.inputSnapshot, methodology: artifact.methodologySnapshot }),
        JSON.stringify(artifact.result),
      ],
    );
    await expect(adapter.commitPlatformAnalytics(artifact)).rejects.toThrow(
      'platform artifact hash reused with different bytes',
    );
  });

  it('rolls back a platform artifact when a child write fails', async () => {
    await pool.query(`create function fail_d12_artifact() returns trigger language plpgsql as $$
      begin raise exception 'forced D12 failure'; end $$`);
    await pool.query(`create trigger fail_d12_artifact before insert on rni_platform_analytics_artifact
      for each row execute function fail_d12_artifact()`);
    try {
      await expect(adapter.commitPlatformAnalytics(analytics('reddit', redditSliceId))).rejects.toThrow(
        'forced D12 failure',
      );
      expect((await pool.query('select id from rni_platform_analytics_artifact')).rowCount).toBe(0);
    } finally {
      await pool.query('drop trigger fail_d12_artifact on rni_platform_analytics_artifact');
      await pool.query('drop function fail_d12_artifact()');
    }
  });
});
