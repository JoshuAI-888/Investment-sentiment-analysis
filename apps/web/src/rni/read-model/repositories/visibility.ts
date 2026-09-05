import { z } from 'zod';

import { canonicalInstant } from '../../../calc/canonical';
import type { Queryable } from '../../../repositories/client';
import {
  rniFullUniversePublication,
  type RniFullUniversePublication,
} from '../../orchestration/full-universe-publication';
import { RniReadError } from '../errors';

const uuid = z.string().uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const versionId = z.string().regex(/^[1-9]\d*$/u);

export type ReleasedRniResultItem = Readonly<{
  ordinal: number;
  securityId: string;
  citedSynthesisId: string;
  citedSynthesisResultHash: string;
  convergenceArtifactId: string;
  convergenceArtifactHash: string;
  status: 'complete' | 'partial' | 'insufficient';
}>;

export type RniResultVisibility =
  | Readonly<{ kind: 'legacy_or_manual' }>
  | Readonly<{
      kind: 'released_v2_full_universe';
      aggregate: RniFullUniversePublication;
      items: ReadonlyMap<string, ReleasedRniResultItem>;
    }>;

type RunContextRow = {
  scopeKind: string;
  runStatus: string;
  executionRunId: string | null;
  executionVersion: string | null;
  executionPlanHash: string | null;
  executionManifestHash: string | null;
  runUniverseVersion: string;
  combinedStatus: string | null;
  redditSliceId: string | null;
  redditStatus: string | null;
  redditOutcomeHash: string | null;
  xSliceId: string | null;
  xStatus: string | null;
  xOutcomeHash: string | null;
};

type ManifestRow = {
  planHash: string;
  runManifestHash: string;
  universeVersion: string;
  assessmentCutoffAt: string;
  memberSetHash: string;
  memberCount: number;
};

type ReleaseRow = {
  planHash: string;
  runManifestHash: string;
  universeVersion: string;
  assessmentCutoffAt: string;
  expectedMemberCount: number;
  memberSetHash: string;
  memberIndexHash: string;
  redditSliceId: string;
  redditStatus: string;
  redditOutcomeHash: string;
  xSliceId: string;
  xStatus: string;
  xOutcomeHash: string;
  completeCount: number;
  partialCount: number;
  insufficientCount: number;
  status: string;
  aggregateHash: string;
  aggregateJson: unknown;
  storedRedditRunId: string;
  storedRedditPlatform: string;
  storedRedditStatus: string;
  storedXRunId: string;
  storedXPlatform: string;
  storedXStatus: string;
};

type ItemRow = {
  ordinal: number;
  securityId: string;
  planHash: string;
  runManifestHash: string;
  universeVersion: string;
  assessmentCutoffAt: string;
  memberSetHash: string;
  citedSynthesisId: string;
  citedSynthesisResultHash: string;
  storedSynthesisResultHash: string;
  convergenceArtifactId: string;
  synthesisConvergenceArtifactId: string;
  convergenceArtifactHash: string;
  storedConvergenceArtifactHash: string | null;
  status: string;
};

const invalid = (): never => {
  throw new RniReadError('CITATION_INVALID');
};

function sameInstant(left: string, right: string): boolean {
  try {
    return canonicalInstant(left) === canonicalInstant(right);
  } catch {
    return false;
  }
}

/**
 * Proves the result visibility boundary without changing operational run/status reads.
 * Historical executions and ticker-scoped work retain their existing behaviour. A v2
 * full-universe run becomes result-visible only when one exact release covers every member and
 * every release member still names its immutable cited-synthesis and convergence identities.
 */
export async function loadRniResultVisibility(
  runId: string,
  environment: string,
  db: Queryable,
): Promise<RniResultVisibility> {
  if (!uuid.safeParse(runId).success) throw new RniReadError('INVALID_REQUEST');
  const parsedEnvironment = z.string().min(1).parse(environment);
  const { rows: contexts } = await db.query<RunContextRow>(
    `select scope.scope_kind as "scopeKind",
            run.status as "runStatus",
            execution.run_id as "executionRunId",
            execution.record ->> 'version' as "executionVersion",
            execution.plan_hash as "executionPlanHash",
            execution.record ->> 'runManifestHash' as "executionManifestHash",
            run.universe_version::text as "runUniverseVersion",
            execution.record #>> '{combined,status}' as "combinedStatus",
            execution.record #>> '{platforms,reddit,slice,id}' as "redditSliceId",
            execution.record #>> '{platforms,reddit,slice,status}' as "redditStatus",
            execution.record #>> '{platforms,reddit,outcomeHash}' as "redditOutcomeHash",
            execution.record #>> '{platforms,x,slice,id}' as "xSliceId",
            execution.record #>> '{platforms,x,slice,status}' as "xStatus",
            execution.record #>> '{platforms,x,outcomeHash}' as "xOutcomeHash"
       from rni_run run
       join config_version config on config.id = run.config_version
       join universe_version universe on universe.id = run.universe_version
       join rni_run_execution_scope scope on scope.run_id = run.id
       left join rni_orchestration_execution execution on execution.run_id = run.id
      where run.id = $1 and config.environment = $2 and universe.environment = $2`,
    [runId, parsedEnvironment],
  );
  if (contexts.length !== 1) invalid();
  const context = contexts[0]!;
  if (context.scopeKind === 'manual_ticker') return { kind: 'legacy_or_manual' };
  if (context.scopeKind !== 'full_universe') invalid();
  if (context.executionRunId === null || context.executionVersion === 'rni-execution-v1') {
    return { kind: 'legacy_or_manual' };
  }
  if (
    context.executionVersion !== 'rni-execution-v2' ||
    !digest.safeParse(context.executionPlanHash).success ||
    !digest.safeParse(context.executionManifestHash).success ||
    !versionId.safeParse(context.runUniverseVersion).success
  )
    invalid();

  const { rows: manifests } = await db.query<ManifestRow>(
    `select manifest.plan_hash as "planHash",
            manifest.run_manifest_hash as "runManifestHash",
            manifest.universe_version::text as "universeVersion",
            manifest.manifest #>> '{windows,assessmentCutoffAt}' as "assessmentCutoffAt",
            manifest.member_set_hash as "memberSetHash",
            manifest.member_count as "memberCount"
       from rni_worker_run_manifest manifest
      where manifest.run_id = $1 and manifest.scope_kind = 'full_universe'`,
    [runId],
  );
  if (manifests.length !== 1) invalid();
  const manifest = manifests[0]!;
  if (
    manifest.planHash !== context.executionPlanHash ||
    manifest.runManifestHash !== context.executionManifestHash ||
    manifest.universeVersion !== context.runUniverseVersion ||
    !digest.safeParse(manifest.memberSetHash).success ||
    !Number.isSafeInteger(manifest.memberCount) ||
    manifest.memberCount < 1 ||
    manifest.memberCount > 600
  )
    invalid();

  const { rows: releases } = await db.query<ReleaseRow>(
    `select release.plan_hash as "planHash",
            release.run_manifest_hash as "runManifestHash",
            release.universe_version::text as "universeVersion",
            to_char(release.assessment_cutoff_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "assessmentCutoffAt",
            release.expected_member_count as "expectedMemberCount",
            release.member_set_hash as "memberSetHash",
            release.member_index_hash as "memberIndexHash",
            release.reddit_slice_id as "redditSliceId",
            release.reddit_status as "redditStatus",
            release.reddit_outcome_hash as "redditOutcomeHash",
            release.x_slice_id as "xSliceId",
            release.x_status as "xStatus",
            release.x_outcome_hash as "xOutcomeHash",
            release.complete_count as "completeCount",
            release.partial_count as "partialCount",
            release.insufficient_count as "insufficientCount",
            release.status,
            release.aggregate_hash as "aggregateHash",
            release.aggregate_json as "aggregateJson",
            reddit.run_id as "storedRedditRunId",
            reddit.platform as "storedRedditPlatform",
            reddit.status as "storedRedditStatus",
            x.run_id as "storedXRunId",
            x.platform as "storedXPlatform",
            x.status as "storedXStatus"
       from rni_full_universe_publication_release release
       join rni_platform_slice reddit on reddit.id = release.reddit_slice_id
       join rni_platform_slice x on x.id = release.x_slice_id
      where release.run_id = $1`,
    [runId],
  );
  if (releases.length === 0) throw new RniReadError('CONFLICT');
  if (releases.length !== 1) invalid();
  const release = releases[0]!;

  let aggregate: RniFullUniversePublication;
  try {
    aggregate = rniFullUniversePublication.parse(release.aggregateJson);
  } catch {
    return invalid();
  }
  if (
    aggregate.runId !== runId ||
    aggregate.planHash !== context.executionPlanHash ||
    aggregate.planHash !== manifest.planHash ||
    aggregate.planHash !== release.planHash ||
    aggregate.runManifestHash !== context.executionManifestHash ||
    aggregate.runManifestHash !== manifest.runManifestHash ||
    aggregate.runManifestHash !== release.runManifestHash ||
    aggregate.universeVersion !== context.runUniverseVersion ||
    aggregate.universeVersion !== manifest.universeVersion ||
    aggregate.universeVersion !== release.universeVersion ||
    !sameInstant(aggregate.assessmentCutoffAt, manifest.assessmentCutoffAt) ||
    !sameInstant(aggregate.assessmentCutoffAt, release.assessmentCutoffAt) ||
    aggregate.expectedMemberCount !== manifest.memberCount ||
    aggregate.expectedMemberCount !== release.expectedMemberCount ||
    aggregate.memberSetHash !== manifest.memberSetHash ||
    aggregate.memberSetHash !== release.memberSetHash ||
    aggregate.memberIndexHash !== release.memberIndexHash ||
    aggregate.platforms.reddit.sliceId !== release.redditSliceId ||
    aggregate.platforms.reddit.sliceId !== context.redditSliceId ||
    aggregate.platforms.reddit.status !== release.redditStatus ||
    aggregate.platforms.reddit.status !== context.redditStatus ||
    aggregate.platforms.reddit.outcomeHash !== release.redditOutcomeHash ||
    aggregate.platforms.reddit.outcomeHash !== context.redditOutcomeHash ||
    aggregate.platforms.x.sliceId !== release.xSliceId ||
    aggregate.platforms.x.sliceId !== context.xSliceId ||
    aggregate.platforms.x.status !== release.xStatus ||
    aggregate.platforms.x.status !== context.xStatus ||
    aggregate.platforms.x.outcomeHash !== release.xOutcomeHash ||
    aggregate.platforms.x.outcomeHash !== context.xOutcomeHash ||
    context.combinedStatus !== 'complete' ||
    context.runStatus !== (aggregate.status === 'insufficient' ? 'failed' : aggregate.status) ||
    release.storedRedditRunId !== runId ||
    release.storedRedditPlatform !== 'reddit' ||
    release.storedRedditStatus !== aggregate.platforms.reddit.status ||
    release.storedXRunId !== runId ||
    release.storedXPlatform !== 'x' ||
    release.storedXStatus !== aggregate.platforms.x.status ||
    aggregate.counts.complete !== release.completeCount ||
    aggregate.counts.partial !== release.partialCount ||
    aggregate.counts.insufficient !== release.insufficientCount ||
    aggregate.status !== release.status ||
    aggregate.aggregateHash !== release.aggregateHash
  )
    invalid();

  const { rows } = await db.query<ItemRow>(
    `select item.ordinal,
            item.security_id as "securityId",
            item.plan_hash as "planHash",
            item.run_manifest_hash as "runManifestHash",
            item.universe_version::text as "universeVersion",
            to_char(item.assessment_cutoff_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "assessmentCutoffAt",
            item.member_set_hash as "memberSetHash",
            item.cited_synthesis_id as "citedSynthesisId",
            item.cited_synthesis_result_hash as "citedSynthesisResultHash",
            synthesis.result_hash as "storedSynthesisResultHash",
            item.convergence_artifact_id as "convergenceArtifactId",
            synthesis.convergence_artifact_id as "synthesisConvergenceArtifactId",
            item.convergence_artifact_hash as "convergenceArtifactHash",
            convergence.artifact_hash as "storedConvergenceArtifactHash",
            item.status
       from rni_full_universe_publication_item item
       join rni_cited_synthesis_artifact synthesis
         on synthesis.id = item.cited_synthesis_id
        and synthesis.run_id = item.run_id
        and synthesis.security_id = item.security_id
       join rni_convergence_artifact convergence
         on convergence.id = item.convergence_artifact_id
        and convergence.run_id = item.run_id
        and convergence.security_id = item.security_id
      where item.run_id = $1
      order by item.ordinal`,
    [runId],
  );
  if (rows.length !== aggregate.expectedMemberCount) invalid();
  const items = new Map<string, ReleasedRniResultItem>();
  for (const [index, member] of aggregate.members.entries()) {
    const row = rows[index];
    if (!row) throw new RniReadError('CITATION_INVALID');
    if (
      row.ordinal !== member.ordinal ||
      row.securityId !== member.securityId ||
      row.planHash !== aggregate.planHash ||
      row.runManifestHash !== aggregate.runManifestHash ||
      row.universeVersion !== aggregate.universeVersion ||
      !sameInstant(row.assessmentCutoffAt, aggregate.assessmentCutoffAt) ||
      row.memberSetHash !== aggregate.memberSetHash ||
      row.citedSynthesisId !== member.citedSynthesisId ||
      row.citedSynthesisResultHash !== member.citedSynthesisResultHash ||
      row.storedSynthesisResultHash !== member.citedSynthesisResultHash ||
      row.convergenceArtifactId !== member.convergenceArtifactId ||
      row.synthesisConvergenceArtifactId !== member.convergenceArtifactId ||
      row.convergenceArtifactHash !== member.convergenceArtifactHash ||
      row.storedConvergenceArtifactHash !== member.convergenceArtifactHash ||
      row.status !== member.status ||
      items.has(row.securityId)
    )
      invalid();
    items.set(row.securityId, {
      ordinal: member.ordinal,
      securityId: member.securityId,
      citedSynthesisId: member.citedSynthesisId,
      citedSynthesisResultHash: member.citedSynthesisResultHash,
      convergenceArtifactId: member.convergenceArtifactId,
      convergenceArtifactHash: member.convergenceArtifactHash,
      status: member.status,
    });
  }
  return { kind: 'released_v2_full_universe', aggregate, items };
}
