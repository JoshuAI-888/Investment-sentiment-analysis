import { z } from 'zod';

import { canonicalHash, canonicalInstant } from '@/calc/canonical';
import type { Queryable } from '@/repositories/client';
import type { RniCitedSynthesisArtifact } from '@/rni/agents';
import { rniCombinedSummary } from '@/rni/contracts';
import { replayPlatformFacts, type RniConvergenceArtifact } from '@/rni/convergence';
import {
  buildRniFullUniversePublication,
  rniFullUniversePublication,
  rniFullUniversePublicationInput,
  type RniFullUniversePublication,
  type RniFullUniversePublicationAuthority,
  type RniFullUniversePublicationInput,
} from '@/rni/orchestration/full-universe-publication';
import { hashRniModelInput } from '@/rni/agents/model-input';

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const uuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const instant = z
  .string()
  .datetime({ offset: true })
  .transform((value) => canonicalInstant(value));

const selectionRequest = z
  .object({
    runId: uuid,
    planHash: digest,
    runManifestHash: digest,
    universeVersion: z.string().regex(/^[1-9]\d*$/u),
    memberSetHash: digest,
    securityId: uuid,
    assessmentCutoffAt: instant,
    slices: z
      .object({
        reddit: uuid,
        x: uuid,
      })
      .strict(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.slices.reddit === request.slices.x) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['slices'],
        message: 'Reddit and X require distinct platform-slice identities',
      });
    }
  });

export type RniFullUniverseArtifactSelectionRequest = z.input<typeof selectionRequest>;
export type RniFullUniverseArtifactSelection = RniFullUniversePublicationInput['items'][number];

type SelectionRow = {
  readonly manifest_version: string;
  readonly manifest_run_id: string;
  readonly manifest_plan_hash: string;
  readonly run_manifest_hash: string;
  readonly manifest_scope_kind: string;
  readonly manifest_universe_version: string;
  readonly manifest_member_set_hash: string;
  readonly manifest_assessment_cutoff_at: Date | string;
  readonly manifest_rights_policy_version: string;
  readonly member_ordinal: number;
  readonly member_security_id: string;
  readonly execution_version: string | null;
  readonly execution_run_manifest_hash: string | null;
  readonly execution_plan_hash: string;
  readonly run_status: string;
  readonly run_universe_version: string;
  readonly run_window_end: Date | string;
  readonly batch_run_id: string;
  readonly batch_id: string;
  readonly batch_security_id: string;
  readonly batch_assessment_cutoff_at: Date | string;
  readonly batch_rights_policy_version: string;
  readonly cited_synthesis_id: string;
  readonly cited_run_id: string;
  readonly cited_security_id: string;
  readonly cited_convergence_artifact_id: string;
  readonly cited_result_hash: string;
  readonly cited_request_snapshot: RniCitedSynthesisArtifact['requestSnapshot'];
  readonly cited_result_snapshot: RniCitedSynthesisArtifact['result'];
  readonly summary_run_id: string;
  readonly summary_security_id: string;
  readonly summary_reddit_slice_id: string;
  readonly summary_x_slice_id: string;
  readonly summary_status: 'complete' | 'partial' | 'insufficient';
  readonly summary_sections: unknown;
  readonly summary_created_at: Date | string;
  readonly convergence_artifact_id: string;
  readonly convergence_run_id: string;
  readonly convergence_security_id: string;
  readonly convergence_policy_version: string;
  readonly convergence_calculation_code_version: RniConvergenceArtifact['calculationCodeVersion'];
  readonly convergence_input_hash: string;
  readonly convergence_result_hash: string;
  readonly convergence_artifact_hash: string | null;
  readonly convergence_input_snapshot: RniConvergenceArtifact['inputSnapshot'];
  readonly convergence_result_snapshot: RniConvergenceArtifact['result'];
  readonly reddit_analytics_slice_id: string;
  readonly x_analytics_slice_id: string;
  readonly reddit_slice_status: string;
  readonly x_slice_status: string;
  readonly evidence_role_count: number;
  readonly inactive_evidence_count: number;
};

type LockedEvidenceRow = {
  readonly role_id: string;
  readonly source_status: string;
  readonly rights_policy_version: string;
};

const SELECT_ACCEPTED_MEMBER = `select
       manifest.manifest_version,
       manifest.run_id as manifest_run_id,
       manifest.plan_hash as manifest_plan_hash,
       manifest.run_manifest_hash,
       manifest.scope_kind as manifest_scope_kind,
       manifest.universe_version::text as manifest_universe_version,
       manifest.member_set_hash as manifest_member_set_hash,
       manifest.manifest #>> '{windows,assessmentCutoffAt}' as manifest_assessment_cutoff_at,
       manifest.manifest #>> '{source,rightsPolicy,version}' as manifest_rights_policy_version,
       member.ordinal as member_ordinal,
       member.security_id as member_security_id,
       execution.record ->> 'version' as execution_version,
       execution.record ->> 'runManifestHash' as execution_run_manifest_hash,
       execution.plan_hash as execution_plan_hash,
       run.status as run_status,
       run.universe_version::text as run_universe_version,
       run.window_end as run_window_end,
       batch.id as batch_id,
       batch.run_id as batch_run_id,
       batch.security_id as batch_security_id,
       batch.assessment_cutoff_at as batch_assessment_cutoff_at,
       batch.rights_policy_version as batch_rights_policy_version,
       cited.id as cited_synthesis_id,
       cited.run_id as cited_run_id,
       cited.security_id as cited_security_id,
       cited.convergence_artifact_id as cited_convergence_artifact_id,
       cited.result_hash as cited_result_hash,
       cited.request_snapshot as cited_request_snapshot,
       cited.result_snapshot as cited_result_snapshot,
       summary.run_id as summary_run_id,
       summary.security_id as summary_security_id,
       summary.reddit_platform_slice_id as summary_reddit_slice_id,
       summary.x_platform_slice_id as summary_x_slice_id,
       summary.status as summary_status,
       summary.sections as summary_sections,
       summary.created_at as summary_created_at,
       convergence.id as convergence_artifact_id,
       convergence.run_id as convergence_run_id,
       convergence.security_id as convergence_security_id,
       convergence.policy_version as convergence_policy_version,
       convergence.calculation_code_version as convergence_calculation_code_version,
       convergence.input_hash as convergence_input_hash,
       convergence.result_hash as convergence_result_hash,
       convergence.artifact_hash as convergence_artifact_hash,
       convergence.input_snapshot as convergence_input_snapshot,
       convergence.result_snapshot as convergence_result_snapshot,
       reddit_analytics.platform_slice_id as reddit_analytics_slice_id,
       x_analytics.platform_slice_id as x_analytics_slice_id,
       reddit_slice.status as reddit_slice_status,
       x_slice.status as x_slice_status,
       (select count(*)::integer
          from rni_synthesis_citation_role role
         where role.batch_id = batch.id) as evidence_role_count,
       (select count(*)::integer
          from rni_synthesis_citation_role role
          left join rni_source_item source on source.id = role.source_item_id
         where role.batch_id = batch.id
           and (source.id is null or source.source_status <> 'active'
             or source.rights_policy_version <> batch.rights_policy_version))
         as inactive_evidence_count
  from rni_worker_run_manifest manifest
  join rni_orchestration_execution execution on execution.run_id = manifest.run_id
  join rni_run run on run.id = manifest.run_id
  join rni_worker_run_manifest_member member on member.run_id = manifest.run_id
  join rni_cited_synthesis_artifact cited
    on cited.run_id = manifest.run_id and cited.security_id = member.security_id
  join rni_synthesis_batch batch on batch.id = cited.batch_id
  join rni_combined_summary summary on summary.id = cited.id
  join rni_convergence_artifact convergence on convergence.id = cited.convergence_artifact_id
  join rni_platform_analytics_artifact reddit_analytics
    on reddit_analytics.id = convergence.reddit_analytics_id
  join rni_platform_analytics_artifact x_analytics
    on x_analytics.id = convergence.x_analytics_id
  join rni_platform_slice reddit_slice on reddit_slice.id = reddit_analytics.platform_slice_id
  join rni_platform_slice x_slice on x_slice.id = x_analytics.platform_slice_id
 where manifest.run_id = $1 and member.security_id = $2
 order by cited.id
 for share of manifest, execution, run, member, cited, batch, summary, convergence,
              reddit_analytics, x_analytics, reddit_slice, x_slice`;

const LOCK_ACCEPTED_EVIDENCE = `select role.id as role_id, source.source_status,
       source.rights_policy_version
  from rni_synthesis_citation_role role
  join rni_source_item source on source.id = role.source_item_id
 where role.batch_id = $1
 order by role.id
 for share of role, source`;

function reject(message: string): never {
  throw new Error(`RNI full-universe artifact selection rejected ${message}`);
}

function persistedInstant(value: Date | string): string {
  return canonicalInstant(value instanceof Date ? value : value);
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function deriveStatus(
  status: RniConvergenceArtifact['result']['status'],
): 'complete' | 'partial' | 'insufficient' {
  switch (status) {
    case 'COMPLETE_CROSS_SOURCE':
    case 'DIVERGENT_CROSS_SOURCE':
      return 'complete';
    case 'PARTIAL_CROSS_SOURCE':
      return 'partial';
    case 'INSUFFICIENT_CROSS_SOURCE':
      return 'insufficient';
    case 'PENDING_CROSS_SOURCE':
      reject('nonterminal convergence data');
  }
}

/**
 * Selects one release-eligible E08/E07 lineage for one exact D-RNI-32 member. The caller owns
 * the surrounding transaction and combined lease; this function performs no mutable-config read
 * and no write. Legacy E07 rows without their canonical artifact hash are deliberately ineligible.
 */
export async function selectRniFullUniversePublicationMember(
  rawRequest: RniFullUniverseArtifactSelectionRequest,
  db: Queryable,
): Promise<RniFullUniverseArtifactSelection> {
  const request = selectionRequest.parse(rawRequest);
  const { rows } = await db.query<SelectionRow>(SELECT_ACCEPTED_MEMBER, [
    request.runId,
    request.securityId,
  ]);
  if (rows.length === 0) reject('missing accepted cited-synthesis lineage');
  if (rows.length !== 1) reject('duplicate accepted cited-synthesis lineage');
  const row = rows[0]!;

  const cutoff = request.assessmentCutoffAt;
  if (
    row.manifest_version !== 'rni-worker-manifest-v2' ||
    row.manifest_scope_kind !== 'full_universe' ||
    row.manifest_run_id !== request.runId ||
    row.manifest_plan_hash !== request.planHash ||
    row.run_manifest_hash !== request.runManifestHash ||
    row.manifest_universe_version !== request.universeVersion ||
    row.manifest_member_set_hash !== request.memberSetHash ||
    persistedInstant(row.manifest_assessment_cutoff_at) !== cutoff ||
    row.member_security_id !== request.securityId ||
    row.execution_version !== 'rni-execution-v2' ||
    row.execution_run_manifest_hash !== request.runManifestHash ||
    row.execution_plan_hash !== request.planHash ||
    row.run_status !== 'running' ||
    row.run_universe_version !== request.universeVersion ||
    persistedInstant(row.run_window_end) !== cutoff
  ) {
    reject('crossed manifest, execution, run, member, universe, or cutoff identity');
  }

  if (
    row.batch_run_id !== request.runId ||
    row.batch_security_id !== request.securityId ||
    persistedInstant(row.batch_assessment_cutoff_at) !== cutoff ||
    row.batch_rights_policy_version !== row.manifest_rights_policy_version ||
    row.cited_run_id !== request.runId ||
    row.cited_security_id !== request.securityId ||
    row.summary_run_id !== request.runId ||
    row.summary_security_id !== request.securityId ||
    row.summary_reddit_slice_id !== request.slices.reddit ||
    row.summary_x_slice_id !== request.slices.x ||
    row.convergence_run_id !== request.runId ||
    row.convergence_security_id !== request.securityId ||
    row.cited_convergence_artifact_id !== row.convergence_artifact_id ||
    row.reddit_analytics_slice_id !== request.slices.reddit ||
    row.x_analytics_slice_id !== request.slices.x
  ) {
    reject('crossed cited-synthesis, convergence, platform-slice, rights, or cutoff lineage');
  }

  if (row.inactive_evidence_count !== 0) {
    reject('withdrawn or rights-ineligible publication evidence');
  }
  const lockedEvidence = await db.query<LockedEvidenceRow>(LOCK_ACCEPTED_EVIDENCE, [row.batch_id]);
  if (
    lockedEvidence.rows.length !== row.evidence_role_count ||
    lockedEvidence.rows.some(
      (evidence) =>
        evidence.source_status !== 'active' ||
        evidence.rights_policy_version !== row.batch_rights_policy_version,
    )
  ) {
    reject('withdrawn or rights-ineligible publication evidence');
  }
  if (row.convergence_artifact_hash === null) {
    reject('unreleased legacy convergence artifact');
  }
  if (!digest.safeParse(row.convergence_artifact_hash).success) {
    reject('invalid convergence artifact hash');
  }
  if (
    !['complete', 'partial', 'failed', 'unavailable'].includes(row.reddit_slice_status) ||
    !['complete', 'partial', 'failed', 'unavailable'].includes(row.x_slice_status)
  ) {
    reject('nonterminal platform-slice data');
  }

  const convergence: RniConvergenceArtifact = {
    calculationCodeVersion: row.convergence_calculation_code_version,
    policyVersion: row.convergence_policy_version,
    inputHash: row.convergence_input_hash,
    resultHash: row.convergence_result_hash,
    inputSnapshot: row.convergence_input_snapshot,
    result: row.convergence_result_snapshot,
  };
  try {
    replayPlatformFacts(convergence);
  } catch {
    reject('non-replayable convergence artifact');
  }
  if (
    canonicalHash(convergence) !== row.convergence_artifact_hash ||
    canonicalInstant(convergence.inputSnapshot.asOf) !== cutoff ||
    convergence.result.runId !== request.runId ||
    convergence.result.securityId !== request.securityId ||
    convergence.result.platforms.reddit.runSourceSliceId !== request.slices.reddit ||
    convergence.result.platforms.x.runSourceSliceId !== request.slices.x ||
    convergence.result.platforms.reddit.status !== row.reddit_slice_status ||
    convergence.result.platforms.x.status !== row.x_slice_status
  ) {
    reject('crossed or hash-drifted convergence artifact');
  }

  const summary = rniCombinedSummary.parse({
    id: row.cited_synthesis_id,
    runId: row.summary_run_id,
    securityId: row.summary_security_id,
    status: row.summary_status,
    sections: row.summary_sections,
    createdAt: persistedInstant(row.summary_created_at),
  });
  const citedRequest = record(row.cited_request_snapshot);
  const citedResult = record(row.cited_result_snapshot);
  const citedConvergence = citedRequest?.['convergenceArtifact'];
  if (
    canonicalHash(row.cited_result_snapshot) !== row.cited_result_hash ||
    canonicalHash(citedConvergence) !== row.convergence_artifact_hash ||
    canonicalHash(citedResult?.['summary']) !== canonicalHash(summary) ||
    canonicalHash(citedResult?.['platformConclusions']) !==
      canonicalHash(convergence.result.platforms)
  ) {
    reject('crossed or hash-drifted cited-synthesis artifact');
  }

  const status = deriveStatus(convergence.result.status);
  if (summary.status !== status) reject('summary status differs from deterministic convergence');

  return {
    runId: request.runId,
    planHash: request.planHash,
    runManifestHash: request.runManifestHash,
    universeVersion: request.universeVersion,
    assessmentCutoffAt: cutoff,
    memberSetHash: request.memberSetHash,
    ordinal: row.member_ordinal,
    securityId: request.securityId,
    citedSynthesisId: row.cited_synthesis_id,
    citedSynthesisResultHash: row.cited_result_hash,
    convergenceArtifactId: row.convergence_artifact_id,
    convergenceArtifactHash: row.convergence_artifact_hash,
    status,
  };
}

/**
 * Assembles the complete release input by selecting every exact manifest member against the
 * supplied persisted Reddit/X slice IDs. `db` must be a caller-owned transaction-scoped
 * Queryable: this helper intentionally opens and commits no transaction, and its share locks are
 * selection-time consistency only—not commit-time publication authority.
 */
export async function selectRniFullUniversePublicationInput(
  authority: RniFullUniversePublicationAuthority,
  db: Queryable,
): Promise<RniFullUniversePublicationInput> {
  const items: RniFullUniversePublicationInput['items'] = [];
  for (const member of authority.manifest.members) {
    items.push(
      await selectRniFullUniversePublicationMember(
        {
          runId: authority.manifest.runId,
          planHash: authority.manifest.planHash,
          runManifestHash: authority.manifest.runManifestHash,
          universeVersion: authority.manifest.universeVersion,
          memberSetHash: authority.manifest.memberSetHash,
          securityId: member.securityId,
          assessmentCutoffAt: authority.manifest.assessmentCutoffAt,
          slices: {
            reddit: authority.platforms.reddit.sliceId,
            x: authority.platforms.x.sliceId,
          },
        },
        db,
      ),
    );
  }
  return rniFullUniversePublicationInput.parse({ ...authority, items });
}

/**
 * Re-selects and compares the complete persisted release set while the caller still owns the
 * final publication transaction. The selector's SHARE locks then remain held through release,
 * so a rights withdrawal or lineage mutation cannot race between preparation and visibility.
 */
export async function validateRniFullUniversePublicationAtCommit(
  rawPublication: RniFullUniversePublication,
  authority: RniFullUniversePublicationAuthority,
  db: Queryable,
): Promise<void> {
  const publication = rniFullUniversePublication.parse(rawPublication);
  const selected = buildRniFullUniversePublication(
    await selectRniFullUniversePublicationInput(authority, db),
  );
  if (hashRniModelInput(selected) !== hashRniModelInput(publication)) {
    reject('prepared release differs from the exact persisted commit-time member set');
  }
}
