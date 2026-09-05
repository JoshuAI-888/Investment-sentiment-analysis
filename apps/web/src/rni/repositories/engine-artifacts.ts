import { randomUUID } from 'node:crypto';
import type pg from 'pg';

import { canonicalHash, canonicalInstant } from '../../calc/canonical';
import { D, exact } from '../../calc/decimal';
import { getPool, withTransaction, type Queryable } from '../../repositories/client';
import {
  replayPlatformAnalytics,
  type RniAnalyticsMethodology,
  type RniPlatformAnalyticsArtifact,
  type RniPlatformAnalyticsInput,
  type RniPlatformAnalyticsResult,
} from '../analytics';
import type { RniAnalyticsArtifactPersistencePort, RniArtifactCommitResult } from '../composition';
import {
  replayPlatformFacts,
  type RniConvergenceArtifact,
  type RniConvergencePlatformInput,
} from '../convergence';

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

function observationSourceIds(artifact: RniPlatformAnalyticsArtifact): string[] {
  return [
    ...artifact.inputSnapshot.current.observations,
    ...(artifact.inputSnapshot.comparison?.observations ?? []),
  ]
    .map(({ sourceItemId }) => sourceItemId)
    .filter((sourceItemId, index, sourceItemIds) => sourceItemIds.indexOf(sourceItemId) === index)
    .sort();
}

async function requireDurableObservations(
  artifact: RniPlatformAnalyticsArtifact,
  db: Queryable,
): Promise<void> {
  const sourceItemIds = observationSourceIds(artifact);
  if (sourceItemIds.length === 0) return;
  const { rows } = await db.query<{ source_item_id: string; platform: string }>(
    `select membership.source_item_id, source.platform
       from rni_run_observation membership
       join rni_source_item source on source.id = membership.source_item_id
      where membership.run_id = $1 and membership.security_id = $2
        and membership.source_item_id = any($3::uuid[])
      order by membership.source_item_id`,
    [artifact.runId, artifact.inputSnapshot.securityId, sourceItemIds],
  );
  if (
    rows.length !== sourceItemIds.length ||
    rows.some(
      (row, index) =>
        row.source_item_id !== sourceItemIds[index] ||
        row.platform !== artifact.inputSnapshot.platform,
    )
  ) {
    reject('analytics inputs without exact durable run/source/security/platform observations');
  }
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
  await requireDurableObservations(artifact, db);
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

type StoredPlatformSnapshot = {
  readonly input: RniPlatformAnalyticsInput;
  readonly methodology: RniAnalyticsMethodology;
};

function stanceMatchesScore(
  stance: RniConvergencePlatformInput['stance'],
  score: string | null,
): boolean {
  if (score === null) return stance === 'insufficient';
  if (/^-?0(?:\.0+)?$/u.test(score)) return stance === 'neutral';
  if (score.startsWith('-')) return stance === 'bearish' || stance === 'strong_bearish';
  return stance === 'bullish' || stance === 'strong_bullish';
}

async function requireOverallProjection(
  fact: RniConvergencePlatformInput,
  artifact: RniPlatformAnalyticsArtifact,
  db: Queryable,
): Promise<void> {
  const positiveTraces = artifact.result.weightTrace.filter(({ weight }) =>
    new D(weight).greaterThan('0'),
  );
  const sourceItemIds = positiveTraces.map(({ sourceItemId }) => sourceItemId).sort();
  const { rows } = await db.query<{ source_item_id: string; stance_score: string | null }>(
    `select membership.source_item_id, observation.stance_score::text as stance_score
       from rni_run_observation membership
       join rni_security_observation observation
         on observation.id = membership.observation_id
        and observation.source_item_id = membership.source_item_id
        and observation.security_id = membership.security_id
       join rni_source_item source on source.id = membership.source_item_id
      where membership.run_id = $1 and membership.security_id = $2
        and source.platform = $3 and membership.source_item_id = any($4::uuid[])
      order by membership.source_item_id`,
    [fact.runId, fact.securityId, fact.platform, sourceItemIds],
  );
  if (
    rows.length !== sourceItemIds.length ||
    rows.some((row, index) => row.source_item_id !== sourceItemIds[index])
  ) {
    reject(`missing exact ${fact.platform} overall-stance observation lineage`);
  }
  const scoreBySource = new Map(rows.map((row) => [row.source_item_id, row.stance_score]));
  const eligible = positiveTraces.flatMap((trace) => {
    const score = scoreBySource.get(trace.sourceItemId);
    return score === null || score === undefined
      ? []
      : [{ sourceItemId: trace.sourceItemId, score: new D(score), weight: new D(trace.weight) }];
  });
  const effectiveAttention = eligible.reduce((total, item) => total.plus(item.weight), new D('0'));
  const duplicateGroupBySource = new Map(
    artifact.inputSnapshot.current.observations.map((observation) => [
      observation.sourceItemId,
      observation.duplicateGroupKey,
    ]),
  );
  const independentSources = new Set(
    eligible.map((item) => duplicateGroupBySource.get(item.sourceItemId)),
  ).size;
  const sufficient =
    effectiveAttention.greaterThanOrEqualTo(
      artifact.methodologySnapshot.minimumEffectiveAttention,
    ) &&
    new D(String(independentSources)).greaterThanOrEqualTo(
      artifact.methodologySnapshot.minimumIndependentSources,
    );
  if (!sufficient || effectiveAttention.equals('0')) {
    if (fact.stance !== 'insufficient' || fact.stanceScore !== null) {
      reject(`crossed ${fact.platform} overall stance projection`);
    }
    return;
  }
  const score = exact(
    eligible
      .reduce((total, item) => total.plus(item.weight.times(item.score)), new D('0'))
      .div(effectiveAttention),
  );
  const expectedStance = new D(score).equals('0')
    ? 'neutral'
    : new D(score).isNegative()
      ? 'bearish'
      : 'bullish';
  if (fact.stance !== expectedStance || fact.stanceScore !== score) {
    reject(`crossed ${fact.platform} overall stance projection`);
  }
}

async function component(
  fact: RniConvergencePlatformInput,
  db: Queryable,
): Promise<{ readonly id: string; readonly artifact: RniPlatformAnalyticsArtifact }> {
  const { rows } = await db.query<{
    id: string;
    platform_slice_id: string;
    methodology_version: string;
    calculation_code_version: RniPlatformAnalyticsArtifact['calculationCodeVersion'];
    input_hash: string;
    result_hash: string;
    input_snapshot: StoredPlatformSnapshot;
    result_snapshot: RniPlatformAnalyticsResult;
    slice_status: string;
    data_through_at: string | null;
  }>(
    `select artifact.id, artifact.platform_slice_id, artifact.methodology_version,
            artifact.calculation_code_version, artifact.input_hash, artifact.result_hash,
            artifact.input_snapshot, artifact.result_snapshot, slice.status as slice_status,
            ${timestampMicros('slice.data_through_at')} as data_through_at
      from rni_platform_analytics_artifact artifact
       join rni_platform_slice slice on slice.id = artifact.platform_slice_id
      where artifact.run_id = $1 and artifact.security_id = $2 and artifact.platform = $3
        and artifact.artifact_hash = $4
      for update of slice`,
    [fact.runId, fact.securityId, fact.platform, fact.analyticsArtifactHash],
  );
  const row = rows[0];
  if (row === undefined || row.platform_slice_id !== fact.runSourceSliceId) {
    reject(`missing exact ${fact.platform} analytics component`);
  }
  const storedArtifact: RniPlatformAnalyticsArtifact = {
    runId: fact.runId,
    runSourceSliceId: row.platform_slice_id,
    methodologyVersion: row.methodology_version,
    calculationCodeVersion: row.calculation_code_version,
    inputSetHash: row.input_hash,
    resultHash: row.result_hash,
    inputSnapshot: row.input_snapshot.input,
    methodologySnapshot: row.input_snapshot.methodology,
    result: row.result_snapshot,
  };
  try {
    replayPlatformAnalytics(storedArtifact);
  } catch {
    reject(`invalid durable ${fact.platform} analytics component`);
  }
  if (canonicalHash(storedArtifact) !== fact.analyticsArtifactHash) {
    reject(`crossed durable ${fact.platform} analytics component hash`);
  }
  const dimensionsMatch = fact.dimensions.every((dimension, index) => {
    const metric = storedArtifact.result.sentimentByDimension[index];
    return (
      metric !== undefined &&
      dimension.dimension === metric.dimension &&
      dimension.score === metric.meanDirection &&
      stanceMatchesScore(dimension.stance, metric.meanDirection)
    );
  });
  if (
    storedArtifact.inputSnapshot.platform !== fact.platform ||
    storedArtifact.result.platform !== fact.platform ||
    storedArtifact.inputSnapshot.securityId !== fact.securityId ||
    storedArtifact.result.securityId !== fact.securityId ||
    fact.methodologyVersion !== storedArtifact.methodologyVersion ||
    canonicalInstant(fact.windowStart) !==
      canonicalInstant(storedArtifact.inputSnapshot.current.windowStart) ||
    canonicalInstant(fact.windowEnd) !==
      canonicalInstant(storedArtifact.inputSnapshot.current.windowEnd) ||
    fact.status !== storedArtifact.inputSnapshot.sliceStatus ||
    fact.status !== row.slice_status ||
    fact.effectiveAttention !== storedArtifact.result.effectiveAttention ||
    (fact.dataThroughAt === null
      ? row.data_through_at !== null
      : row.data_through_at !== canonicalInstant(fact.dataThroughAt)) ||
    fact.dimensions.length !== storedArtifact.result.sentimentByDimension.length ||
    !dimensionsMatch
  ) {
    reject(`crossed ${fact.platform} convergence/component projection`);
  }
  await requireOverallProjection(fact, storedArtifact, db);
  return { id: row.id, artifact: storedArtifact };
}

/**
 * Revalidate an E07 artifact against both exact durable E06 components and their E05-weighted
 * overall projections. Cited publication uses this shared read-only seam so DATA and I07 cannot
 * drift into two different definitions of a valid convergence component.
 */
export async function validateRniConvergenceComponents(
  artifact: RniConvergenceArtifact,
  db: Queryable = getPool(),
): Promise<{
  readonly reddit: { readonly id: string; readonly artifact: RniPlatformAnalyticsArtifact };
  readonly x: { readonly id: string; readonly artifact: RniPlatformAnalyticsArtifact };
}> {
  validateConvergence(artifact);
  const reddit = await component(artifact.inputSnapshot.reddit, db);
  const x = await component(artifact.inputSnapshot.x, db);
  if (
    canonical(reddit.artifact.methodologySnapshot) !== canonical(x.artifact.methodologySnapshot)
  ) {
    reject('crossed Reddit/X analytics methodology snapshots');
  }
  return { reddit, x };
}

async function commitConvergence(
  artifact: RniConvergenceArtifact,
  db: Queryable,
): Promise<RniArtifactCommitResult> {
  const { reddit, x } = artifact.inputSnapshot;
  const runId = reddit.runId;
  const securityId = reddit.securityId;
  const artifactHash = canonicalHash(artifact);
  await lock(`rni-convergence:${runId}:${securityId}`, db);
  const { reddit: redditComponent, x: xComponent } = await validateRniConvergenceComponents(
    artifact,
    db,
  );
  const redditId = redditComponent.id;
  const xId = xComponent.id;
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
