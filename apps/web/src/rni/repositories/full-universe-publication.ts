import { z } from 'zod';

import { canonicalInstant } from '@/calc/canonical';
import type { Queryable } from '@/repositories/client';
import { hashRniModelInput } from '@/rni/agents/model-input';
import {
  rniFullUniversePublication,
  type RniFullUniversePublication,
} from '@/rni/orchestration/full-universe-publication';
import {
  combinedArtifact,
  digest,
  type RniCombinedArtifact,
  type RniCombinedFence,
} from '@/rni/orchestration/types';

const uuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const instant = z
  .string()
  .datetime({ offset: true })
  .transform((value) => canonicalInstant(value));
const fenceSchema = z
  .object({
    stage: z.literal('combined'),
    runId: uuid,
    planHash: digest,
    attempt: z.number().int().min(1).max(3),
    token: uuid,
    acquiredAt: instant,
    expiresAt: instant,
    deadline: instant,
  })
  .strict()
  .superRefine((fence, context) => {
    if (
      Date.parse(fence.acquiredAt) >= Date.parse(fence.expiresAt) ||
      Date.parse(fence.expiresAt) > Date.parse(fence.deadline)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Combined publication fence has an invalid authority window',
      });
    }
  });

type PublicationMember = RniFullUniversePublication['members'][number];
type Disposition = 'inserted' | 'duplicate';

export type RniFullUniverseStagingResult = Readonly<{
  disposition: Disposition;
  member: PublicationMember;
}>;

export type RniFullUniverseReleaseResult = Readonly<{
  disposition: Disposition;
  publication: RniFullUniversePublication;
  artifact: RniCombinedArtifact;
  releasedAt: string;
}>;

type StagedRow = {
  readonly run_id: string;
  readonly ordinal: number;
  readonly security_id: string;
  readonly plan_hash: string;
  readonly run_manifest_hash: string;
  readonly universe_version: string;
  readonly assessment_cutoff_at: Date | string;
  readonly member_set_hash: string;
  readonly cited_synthesis_id: string;
  readonly cited_synthesis_result_hash: string;
  readonly convergence_artifact_id: string;
  readonly convergence_artifact_hash: string;
  readonly status: PublicationMember['status'];
  readonly stage_attempt: number;
  readonly stage_token: string;
  readonly stage_acquired_at: Date | string;
  readonly stage_expires_at: Date | string;
};

type ReleaseRow = {
  readonly run_id: string;
  readonly plan_hash: string;
  readonly run_manifest_hash: string;
  readonly universe_version: string;
  readonly assessment_cutoff_at: Date | string;
  readonly expected_member_count: number;
  readonly member_set_hash: string;
  readonly member_index_hash: string;
  readonly reddit_slice_id: string;
  readonly reddit_status: RniFullUniversePublication['platforms']['reddit']['status'];
  readonly reddit_outcome_hash: string;
  readonly x_slice_id: string;
  readonly x_status: RniFullUniversePublication['platforms']['x']['status'];
  readonly x_outcome_hash: string;
  readonly complete_count: number;
  readonly partial_count: number;
  readonly insufficient_count: number;
  readonly status: RniFullUniversePublication['status'];
  readonly aggregate_hash: string;
  readonly aggregate_json: unknown;
  readonly combined_attempt: number;
  readonly combined_token: string;
  readonly combined_acquired_at: Date | string;
  readonly combined_expires_at: Date | string;
  readonly released_at: Date | string;
};

const STAGED_COLUMNS =
  'run_id,ordinal,security_id,plan_hash,run_manifest_hash,universe_version::text as universe_version,' +
  'assessment_cutoff_at,member_set_hash,cited_synthesis_id,cited_synthesis_result_hash,' +
  'convergence_artifact_id,convergence_artifact_hash,status,stage_attempt,stage_token,' +
  'stage_acquired_at,stage_expires_at';

const RELEASE_COLUMNS =
  'run_id,plan_hash,run_manifest_hash,universe_version::text as universe_version,' +
  'assessment_cutoff_at,expected_member_count,member_set_hash,member_index_hash,' +
  'reddit_slice_id,reddit_status,reddit_outcome_hash,x_slice_id,x_status,x_outcome_hash,' +
  'complete_count,partial_count,insufficient_count,status,aggregate_hash,aggregate_json,' +
  'combined_attempt,combined_token,combined_acquired_at,combined_expires_at,released_at';

function reject(message: string): never {
  throw new Error(`RNI full-universe publication persistence rejected ${message}`);
}

function persistedInstant(value: Date | string): string {
  return canonicalInstant(value instanceof Date ? value : value);
}

function parseInputs(
  rawPublication: RniFullUniversePublication,
  rawFence: RniCombinedFence,
): { publication: RniFullUniversePublication; fence: z.output<typeof fenceSchema> } {
  const publication = rniFullUniversePublication.parse(rawPublication);
  const fence = fenceSchema.parse(rawFence);
  if (fence.runId !== publication.runId || fence.planHash !== publication.planHash) {
    reject('crossed publication and combined-fence identity');
  }
  return { publication, fence };
}

function assertStagedRow(
  row: StagedRow | undefined,
  publication: RniFullUniversePublication,
  member: PublicationMember,
  insertionFence: z.output<typeof fenceSchema> | null,
): void {
  if (
    row === undefined ||
    row.run_id !== publication.runId ||
    row.ordinal !== member.ordinal ||
    row.security_id !== member.securityId ||
    row.plan_hash !== publication.planHash ||
    row.run_manifest_hash !== publication.runManifestHash ||
    row.universe_version !== publication.universeVersion ||
    persistedInstant(row.assessment_cutoff_at) !== publication.assessmentCutoffAt ||
    row.member_set_hash !== publication.memberSetHash ||
    row.cited_synthesis_id !== member.citedSynthesisId ||
    row.cited_synthesis_result_hash !== member.citedSynthesisResultHash ||
    row.convergence_artifact_id !== member.convergenceArtifactId ||
    row.convergence_artifact_hash !== member.convergenceArtifactHash ||
    row.status !== member.status
  ) {
    reject('crossed or partial staged member replay');
  }
  if (
    insertionFence !== null &&
    (row.stage_attempt !== insertionFence.attempt ||
      row.stage_token !== insertionFence.token ||
      persistedInstant(row.stage_acquired_at) !== insertionFence.acquiredAt ||
      persistedInstant(row.stage_expires_at) !== insertionFence.expiresAt)
  ) {
    reject('crossed staged member insertion fence');
  }
}

function assertReleaseRow(
  row: ReleaseRow | undefined,
  publication: RniFullUniversePublication,
  fence: z.output<typeof fenceSchema>,
  releasedAt: string,
): void {
  if (
    row === undefined ||
    row.run_id !== publication.runId ||
    row.plan_hash !== publication.planHash ||
    row.run_manifest_hash !== publication.runManifestHash ||
    row.universe_version !== publication.universeVersion ||
    persistedInstant(row.assessment_cutoff_at) !== publication.assessmentCutoffAt ||
    row.expected_member_count !== publication.expectedMemberCount ||
    row.member_set_hash !== publication.memberSetHash ||
    row.member_index_hash !== publication.memberIndexHash ||
    row.reddit_slice_id !== publication.platforms.reddit.sliceId ||
    row.reddit_status !== publication.platforms.reddit.status ||
    row.reddit_outcome_hash !== publication.platforms.reddit.outcomeHash ||
    row.x_slice_id !== publication.platforms.x.sliceId ||
    row.x_status !== publication.platforms.x.status ||
    row.x_outcome_hash !== publication.platforms.x.outcomeHash ||
    row.complete_count !== publication.counts.complete ||
    row.partial_count !== publication.counts.partial ||
    row.insufficient_count !== publication.counts.insufficient ||
    row.status !== publication.status ||
    row.aggregate_hash !== publication.aggregateHash ||
    row.combined_attempt !== fence.attempt ||
    row.combined_token !== fence.token ||
    persistedInstant(row.combined_acquired_at) !== fence.acquiredAt ||
    persistedInstant(row.combined_expires_at) !== fence.expiresAt ||
    persistedInstant(row.released_at) !== releasedAt
  ) {
    reject('crossed or partial aggregate release replay');
  }

  let saved: RniFullUniversePublication;
  try {
    saved = rniFullUniversePublication.parse(row.aggregate_json);
  } catch {
    reject('malformed aggregate release JSON');
  }
  if (hashRniModelInput(saved) !== hashRniModelInput(publication)) {
    reject('crossed aggregate release JSON');
  }
}

/**
 * Stages one invisible member checkpoint under the active combined lease. The supplied database
 * handle must already be inside the orchestration transaction: the deferred database fence is
 * intentionally checked at that transaction's commit. An exact replay is a no-op; every crossed
 * natural-key conflict fails closed.
 */
export async function stageRniFullUniversePublicationMember(
  rawPublication: RniFullUniversePublication,
  rawSecurityId: string,
  rawFence: RniCombinedFence,
  db: Queryable,
): Promise<RniFullUniverseStagingResult> {
  const { publication, fence } = parseInputs(rawPublication, rawFence);
  const securityId = uuid.parse(rawSecurityId);
  const member = publication.members.find((candidate) => candidate.securityId === securityId);
  if (member === undefined) reject('security is not in the exact release member index');

  const values = [
    publication.runId,
    member.ordinal,
    member.securityId,
    publication.planHash,
    publication.runManifestHash,
    publication.universeVersion,
    publication.assessmentCutoffAt,
    publication.memberSetHash,
    member.citedSynthesisId,
    member.citedSynthesisResultHash,
    member.convergenceArtifactId,
    member.convergenceArtifactHash,
    member.status,
    fence.attempt,
    fence.token,
    fence.acquiredAt,
    fence.expiresAt,
  ] as const;
  const inserted = await db.query<StagedRow>(
    `insert into rni_full_universe_publication_item (
       run_id,ordinal,security_id,plan_hash,run_manifest_hash,universe_version,
       assessment_cutoff_at,member_set_hash,cited_synthesis_id,cited_synthesis_result_hash,
       convergence_artifact_id,convergence_artifact_hash,status,stage_attempt,stage_token,
       stage_acquired_at,stage_expires_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     on conflict do nothing returning ${STAGED_COLUMNS}`,
    values,
  );
  const disposition: Disposition = inserted.rowCount === 1 ? 'inserted' : 'duplicate';
  const row =
    inserted.rows[0] ??
    (
      await db.query<StagedRow>(
        `select ${STAGED_COLUMNS} from rni_full_universe_publication_item
          where run_id=$1 and security_id=$2 for share`,
        [publication.runId, member.securityId],
      )
    ).rows[0];
  // A committed staged row remains valid after its original lease expires. On retry the current
  // fence authorizes only a possible insert; an exact immutable member replay reuses the earlier
  // row whose own fence was already checked by the deferred constraint at its original commit.
  assertStagedRow(row, publication, member, disposition === 'inserted' ? fence : null);
  return { disposition, member };
}

/**
 * Inserts the one visibility-changing release row and returns the exact combined artifact that
 * the orchestration receipt must record. This function deliberately neither opens nor commits a
 * transaction: the caller must insert the receipt and terminal execution/run/job projections on
 * this same `Queryable` before commit, where Migration 0024's deferred constraints validate the
 * complete atomic state.
 */
export async function finalizeRniFullUniversePublication(
  rawPublication: RniFullUniversePublication,
  rawFence: RniCombinedFence,
  rawReleasedAt: string,
  db: Queryable,
): Promise<RniFullUniverseReleaseResult> {
  const { publication, fence } = parseInputs(rawPublication, rawFence);
  const releasedAt = instant.parse(rawReleasedAt);
  if (
    Date.parse(releasedAt) < Date.parse(fence.acquiredAt) ||
    Date.parse(releasedAt) >= Date.parse(fence.expiresAt) ||
    Date.parse(releasedAt) >= Date.parse(fence.deadline)
  ) {
    reject('release time is outside the combined authority window');
  }

  const values = [
    publication.runId,
    publication.planHash,
    publication.runManifestHash,
    publication.universeVersion,
    publication.assessmentCutoffAt,
    publication.expectedMemberCount,
    publication.memberSetHash,
    publication.memberIndexHash,
    publication.platforms.reddit.sliceId,
    publication.platforms.reddit.status,
    publication.platforms.reddit.outcomeHash,
    publication.platforms.x.sliceId,
    publication.platforms.x.status,
    publication.platforms.x.outcomeHash,
    publication.counts.complete,
    publication.counts.partial,
    publication.counts.insufficient,
    publication.status,
    publication.aggregateHash,
    JSON.stringify(publication),
    fence.attempt,
    fence.token,
    fence.acquiredAt,
    fence.expiresAt,
    releasedAt,
  ] as const;
  const inserted = await db.query<ReleaseRow>(
    `insert into rni_full_universe_publication_release (
       run_id,plan_hash,run_manifest_hash,universe_version,assessment_cutoff_at,
       expected_member_count,member_set_hash,member_index_hash,reddit_slice_id,reddit_status,
       reddit_outcome_hash,x_slice_id,x_status,x_outcome_hash,complete_count,partial_count,
       insufficient_count,status,aggregate_hash,aggregate_json,combined_attempt,combined_token,
       combined_acquired_at,combined_expires_at,released_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
       $21,$22,$23,$24,$25)
     on conflict (run_id) do nothing returning ${RELEASE_COLUMNS}`,
    values,
  );
  const disposition: Disposition = inserted.rowCount === 1 ? 'inserted' : 'duplicate';
  const row =
    inserted.rows[0] ??
    (
      await db.query<ReleaseRow>(
        `select ${RELEASE_COLUMNS} from rni_full_universe_publication_release
          where run_id=$1 for share`,
        [publication.runId],
      )
    ).rows[0];
  assertReleaseRow(row, publication, fence, releasedAt);

  const artifact = combinedArtifact.parse({
    runId: publication.runId,
    planHash: publication.planHash,
    artifactHash: publication.aggregateHash,
    status: publication.status,
  });
  return { disposition, publication, artifact, releasedAt };
}
