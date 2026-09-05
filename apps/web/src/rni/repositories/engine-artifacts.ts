import { randomUUID } from 'node:crypto';
import type pg from 'pg';

import { canonicalHash, canonicalInstant } from '../../calc/canonical';
import { getPool, withTransaction, type Queryable } from '../../repositories/client';
import { replayPlatformAnalytics, type RniPlatformAnalyticsArtifact } from '../analytics';
import type {
  RniAnalyticsArtifactPersistencePort,
  RniArtifactCommitResult,
} from '../composition';
import { replayPlatformFacts, type RniConvergenceArtifact } from '../convergence';

function reject(message: string): never {
  throw new Error(`RNI analytics artifact persistence rejected ${message}`);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const timestampMicros = (column: string) =>
  `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

async function lock(identity: string, db: Queryable): Promise<void> {
  await db.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [identity]);
}

function validatePlatform(artifact: RniPlatformAnalyticsArtifact): void {
  replayPlatformAnalytics(artifact);
  const { inputSnapshot, result } = artifact;
  if (
    artifact.runId !== inputSnapshot.runId ||
    artifact.runSourceSliceId !== inputSnapshot.runSourceSliceId ||
    artifact.methodologyVersion !== artifact.methodologySnapshot.version ||
    inputSnapshot.platform !== result.platform ||
    inputSnapshot.securityId !== result.securityId ||
    artifact.calculationCodeVersion !== artifact.methodologySnapshot.codeVersion
  ) {
    reject('crossed platform artifact lineage');
  }
}

async function commitPlatform(
  artifact: RniPlatformAnalyticsArtifact,
  db: Queryable,
): Promise<RniArtifactCommitResult> {
  validatePlatform(artifact);
  const platform = artifact.inputSnapshot.platform;
  const securityId = artifact.inputSnapshot.securityId;
  const artifactHash = canonicalHash(artifact);
  await lock(`rni-platform-artifact:${artifact.runId}:${securityId}:${platform}`, db);
  const prior = await db.query<{ artifact_hash: string }>(
    `select artifact_hash from rni_platform_analytics_artifact
      where run_id = $1 and security_id = $2 and platform = $3`,
    [artifact.runId, securityId, platform],
  );
  if (prior.rows.some(({ artifact_hash }) => artifact_hash !== artifactHash)) {
    reject('platform identity reused with different canonical artifact');
  }
  const { rows } = await db.query<{ id: string }>(
    `insert into rni_platform_analytics_artifact (
       id, run_id, platform_slice_id, platform, security_id, methodology_version,
       calculation_code_version, input_hash, result_hash, artifact_hash, input_snapshot,
       result_snapshot, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13)
     on conflict (run_id, security_id, platform, artifact_hash) do nothing returning id`,
    [
      randomUUID(),
      artifact.runId,
      artifact.runSourceSliceId,
      platform,
      securityId,
      artifact.methodologyVersion,
      artifact.calculationCodeVersion,
      artifact.inputSetHash,
      artifact.resultHash,
      artifactHash,
      JSON.stringify({
        input: artifact.inputSnapshot,
        methodology: artifact.methodologySnapshot,
      }),
      JSON.stringify(artifact.result),
      artifact.inputSnapshot.current.windowEnd,
    ],
  );
  if (rows[0] === undefined) {
    const existing = await db.query<{
      platform_slice_id: string;
      methodology_version: string;
      calculation_code_version: string;
      input_hash: string;
      result_hash: string;
      input_snapshot: unknown;
      result_snapshot: unknown;
      created_at: string;
    }>(
      `select platform_slice_id, methodology_version, calculation_code_version, input_hash,
              result_hash, input_snapshot, result_snapshot,
              ${timestampMicros('created_at')} as created_at
         from rni_platform_analytics_artifact
        where run_id = $1 and security_id = $2 and platform = $3 and artifact_hash = $4`,
      [artifact.runId, securityId, platform, artifactHash],
    );
    const row = existing.rows[0];
    if (
      row === undefined ||
      row.platform_slice_id !== artifact.runSourceSliceId ||
      row.methodology_version !== artifact.methodologyVersion ||
      row.calculation_code_version !== artifact.calculationCodeVersion ||
      row.input_hash !== artifact.inputSetHash ||
      row.result_hash !== artifact.resultHash ||
      canonical(row.input_snapshot) !==
        canonical({ input: artifact.inputSnapshot, methodology: artifact.methodologySnapshot }) ||
      canonical(row.result_snapshot) !== canonical(artifact.result) ||
      row.created_at !== canonicalInstant(artifact.inputSnapshot.current.windowEnd)
    ) {
      reject('platform artifact hash reused with different bytes');
    }
  }
  return { disposition: rows[0] === undefined ? 'duplicate' : 'inserted', artifactHash };
}

function validateConvergence(artifact: RniConvergenceArtifact): void {
  replayPlatformFacts(artifact);
  const { reddit, x } = artifact.inputSnapshot;
  if (
    reddit.platform !== 'reddit' ||
    x.platform !== 'x' ||
    reddit.runId !== x.runId ||
    reddit.securityId !== x.securityId ||
    artifact.result.runId !== reddit.runId ||
    artifact.result.securityId !== reddit.securityId ||
    artifact.policyVersion !== artifact.inputSnapshot.policy.version ||
    artifact.calculationCodeVersion !== artifact.inputSnapshot.policy.codeVersion
  ) {
    reject('crossed convergence lineage');
  }
}

async function component(
  runId: string,
  securityId: string,
  platform: 'reddit' | 'x',
  hash: string,
  sliceId: string,
  db: Queryable,
): Promise<string> {
  const { rows } = await db.query<{ id: string; platform_slice_id: string }>(
    `select id, platform_slice_id from rni_platform_analytics_artifact
      where run_id = $1 and security_id = $2 and platform = $3 and artifact_hash = $4`,
    [runId, securityId, platform, hash],
  );
  const row = rows[0];
  if (row === undefined || row.platform_slice_id !== sliceId) {
    reject(`missing exact ${platform} analytics component`);
  }
  return row.id;
}

async function commitConvergence(
  artifact: RniConvergenceArtifact,
  db: Queryable,
): Promise<RniArtifactCommitResult> {
  validateConvergence(artifact);
  const { reddit, x } = artifact.inputSnapshot;
  const runId = reddit.runId;
  const securityId = reddit.securityId;
  const artifactHash = canonicalHash(artifact);
  await lock(`rni-convergence:${runId}:${securityId}`, db);
  const redditId = await component(
    runId,
    securityId,
    'reddit',
    reddit.analyticsArtifactHash,
    reddit.runSourceSliceId,
    db,
  );
  const xId = await component(
    runId,
    securityId,
    'x',
    x.analyticsArtifactHash,
    x.runSourceSliceId,
    db,
  );
  const prior = await db.query<{
    reddit_analytics_id: string;
    reddit_artifact_hash: string;
    x_analytics_id: string;
    x_artifact_hash: string;
    policy_version: string;
    calculation_code_version: string;
    input_hash: string;
    result_hash: string;
    input_snapshot: unknown;
    result_snapshot: unknown;
    created_at: string;
  }>(
    `select reddit_analytics_id, reddit_artifact_hash, x_analytics_id, x_artifact_hash,
            policy_version, calculation_code_version, input_hash, result_hash,
            input_snapshot, result_snapshot, ${timestampMicros('created_at')} as created_at
       from rni_convergence_artifact where run_id = $1 and security_id = $2`,
    [runId, securityId],
  );
  if (
    prior.rows.some(
      (row) =>
        row.reddit_analytics_id !== redditId ||
        row.reddit_artifact_hash !== reddit.analyticsArtifactHash ||
        row.x_analytics_id !== xId ||
        row.x_artifact_hash !== x.analyticsArtifactHash ||
        row.policy_version !== artifact.policyVersion ||
        row.calculation_code_version !== artifact.calculationCodeVersion ||
        row.input_hash !== artifact.inputHash ||
        row.result_hash !== artifact.resultHash ||
        canonical(row.input_snapshot) !== canonical(artifact.inputSnapshot) ||
        canonical(row.result_snapshot) !== canonical(artifact.result) ||
        row.created_at !== canonicalInstant(artifact.inputSnapshot.asOf),
    )
  ) {
    reject('convergence identity reused with different canonical artifact');
  }
  const { rows } = await db.query<{ id: string }>(
    `insert into rni_convergence_artifact (
       id, run_id, security_id, reddit_analytics_id, reddit_artifact_hash,
       x_analytics_id, x_artifact_hash, policy_version, calculation_code_version,
       input_hash, result_hash, input_snapshot, result_snapshot, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14)
     on conflict (run_id, security_id, input_hash) do nothing returning id`,
    [
      randomUUID(),
      runId,
      securityId,
      redditId,
      reddit.analyticsArtifactHash,
      xId,
      x.analyticsArtifactHash,
      artifact.policyVersion,
      artifact.calculationCodeVersion,
      artifact.inputHash,
      artifact.resultHash,
      JSON.stringify(artifact.inputSnapshot),
      JSON.stringify(artifact.result),
      artifact.inputSnapshot.asOf,
    ],
  );
  return { disposition: rows[0] === undefined ? 'duplicate' : 'inserted', artifactHash };
}

export class PostgresRniAnalyticsArtifactPersistence
  implements RniAnalyticsArtifactPersistencePort
{
  constructor(private readonly pool: pg.Pool = getPool()) {}

  commitPlatformAnalytics(
    artifact: RniPlatformAnalyticsArtifact,
  ): Promise<RniArtifactCommitResult> {
    return withTransaction((tx) => commitPlatform(artifact, tx), this.pool);
  }

  commitConvergence(artifact: RniConvergenceArtifact): Promise<RniArtifactCommitResult> {
    return withTransaction((tx) => commitConvergence(artifact, tx), this.pool);
  }
}
