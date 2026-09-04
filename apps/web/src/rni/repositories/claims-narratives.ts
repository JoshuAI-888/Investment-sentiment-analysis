import {
  rniComparativeRelation,
  rniCitation,
  type RniCitation,
  type RniComparativeRelation,
  type RniStance,
} from '../contracts';
import { getPool, type Queryable } from '../../repositories/client';

export type RniEvidenceClaimInput = {
  readonly id: string;
  readonly sourceItemId: string;
  readonly securityId: string | null;
  readonly observationId: string | null;
  readonly claimText: string;
  readonly claimType: 'fact_assertion' | 'opinion' | 'forecast' | 'position' | 'question' | 'joke';
  readonly epistemicStatus:
    | 'source_claim'
    | 'verified_fact'
    | 'analytical_inference'
    | 'unverified'
    | 'contradicted';
  readonly supportStart: number | null;
  readonly supportEnd: number | null;
  readonly extractorRunId: string;
  readonly inputHash: string;
  readonly createdAt: string;
};

export type RniClaimCitationInput = {
  readonly id: string;
  readonly claimId: string;
  readonly sourceItemId: string;
  readonly evidenceText: string;
  readonly createdAt: string;
};

export type RniThemeDefinitionInput = {
  readonly id: string;
  readonly taxonomyVersion: string;
  readonly stableKey: string;
  readonly name: string;
  readonly description: string;
  readonly parentStableKey: string | null;
  readonly enabled: boolean;
  readonly createdAt: string;
};

export type RniObservationThemeInput = {
  readonly observationId: string;
  readonly themeDefinitionId: string;
  readonly classificationConfidence: string;
  readonly themeStance: RniStance;
  readonly themeScore: string | null;
  readonly createdAt: string;
};

export type RniNarrativeInput = {
  readonly id: string;
  readonly runId: string;
  readonly securityId: string | null;
  readonly canonicalThesis: string;
  readonly direction: RniStance;
  readonly horizon: string | null;
  readonly status: 'candidate' | 'active' | 'fading' | 'resurgent' | 'rejected';
  readonly adjudicatorRunId: string;
  readonly firstSourceAt: string | null;
  readonly lastSourceAt: string | null;
  readonly independentSourceCount: number;
  readonly rawRepetitionCount: number;
  readonly inputHash: string;
  readonly createdAt: string;
};

export type RniNarrativeMembershipInput = {
  readonly narrativeId: string;
  readonly claimId: string;
  readonly similarity: string;
  readonly membershipConfidence: string;
  readonly isIndependent: boolean;
  readonly duplicateGroupHash: string | null;
  readonly adjudicationReason: string;
  readonly createdAt: string;
};

export type RniWriteIdentity = { readonly id: string; readonly inserted: boolean };

async function insertOrReadId(
  insertSql: string,
  insertValues: readonly unknown[],
  readSql: string,
  readValues: readonly unknown[],
  db: Queryable,
): Promise<RniWriteIdentity> {
  const { rows } = await db.query<{ id: string }>(insertSql, insertValues);
  const inserted = rows[0];
  if (inserted !== undefined) return { id: inserted.id, inserted: true };

  const { rows: existingRows } = await db.query<{ id: string }>(readSql, readValues);
  const existing = existingRows[0];
  if (existing === undefined) throw new Error('RNI idempotent write could not read its conflict');
  return { id: existing.id, inserted: false };
}

export async function persistRniEvidenceClaim(
  input: RniEvidenceClaimInput,
  db: Queryable = getPool(),
): Promise<RniWriteIdentity> {
  return insertOrReadId(
    `insert into rni_evidence_claim (
       id, source_item_id, security_id, observation_id, claim_text, claim_type, epistemic_status,
       support_start, support_end, extractor_run_id, input_hash, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (source_item_id, security_id, input_hash) do nothing returning id`,
    [
      input.id,
      input.sourceItemId,
      input.securityId,
      input.observationId,
      input.claimText,
      input.claimType,
      input.epistemicStatus,
      input.supportStart,
      input.supportEnd,
      input.extractorRunId,
      input.inputHash,
      input.createdAt,
    ],
    `select id from rni_evidence_claim
      where source_item_id = $1 and security_id is not distinct from $2 and input_hash = $3`,
    [input.sourceItemId, input.securityId, input.inputHash],
    db,
  );
}

export async function persistRniClaimCitation(
  input: RniClaimCitationInput,
  db: Queryable = getPool(),
): Promise<RniWriteIdentity> {
  return insertOrReadId(
    `insert into rni_claim_citation (id, claim_id, source_item_id, evidence_text, created_at)
     values ($1, $2, $3, $4, $5)
     on conflict (claim_id, source_item_id, evidence_text) do nothing returning id`,
    [input.id, input.claimId, input.sourceItemId, input.evidenceText, input.createdAt],
    `select id from rni_claim_citation
      where claim_id = $1 and source_item_id = $2 and evidence_text = $3`,
    [input.claimId, input.sourceItemId, input.evidenceText],
    db,
  );
}

export async function getRniCitationById(
  citationId: string,
  db: Queryable = getPool(),
): Promise<RniCitation | undefined> {
  const { rows } = await db.query<{
    id: string;
    source_item_id: string;
    platform: string;
    original_url: string;
    evidence_text: string;
  }>(
    `select c.id, c.source_item_id, s.platform, s.original_url, c.evidence_text
       from rni_claim_citation c
       join rni_source_item s on s.id = c.source_item_id
      where c.id = $1`,
    [citationId],
  );
  const row = rows[0];
  return row === undefined
    ? undefined
    : rniCitation.parse({
        id: row.id,
        sourceItemId: row.source_item_id,
        platform: row.platform,
        url: row.original_url,
        evidenceText: row.evidence_text,
      });
}

export async function persistRniThemeDefinition(
  input: RniThemeDefinitionInput,
  db: Queryable = getPool(),
): Promise<RniWriteIdentity> {
  return insertOrReadId(
    `insert into rni_theme_definition (
       id, taxonomy_version, stable_key, name, description, parent_stable_key, enabled, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (taxonomy_version, stable_key) do nothing returning id`,
    [
      input.id,
      input.taxonomyVersion,
      input.stableKey,
      input.name,
      input.description,
      input.parentStableKey,
      input.enabled,
      input.createdAt,
    ],
    'select id from rni_theme_definition where taxonomy_version = $1 and stable_key = $2',
    [input.taxonomyVersion, input.stableKey],
    db,
  );
}

export async function persistRniObservationTheme(
  input: RniObservationThemeInput,
  db: Queryable = getPool(),
): Promise<{ readonly inserted: boolean }> {
  const { rowCount } = await db.query(
    `insert into rni_observation_theme (
       observation_id, theme_definition_id, classification_confidence, theme_stance,
       theme_score, created_at
     ) values ($1, $2, $3, $4, $5, $6)
     on conflict (observation_id, theme_definition_id) do nothing`,
    [
      input.observationId,
      input.themeDefinitionId,
      input.classificationConfidence,
      input.themeStance,
      input.themeScore,
      input.createdAt,
    ],
  );
  return { inserted: rowCount === 1 };
}

export async function persistRniNarrative(
  input: RniNarrativeInput,
  db: Queryable = getPool(),
): Promise<RniWriteIdentity> {
  return insertOrReadId(
    `insert into rni_narrative (
       id, run_id, security_id, canonical_thesis, direction, horizon, status,
       adjudicator_run_id, first_source_at, last_source_at, independent_source_count,
       raw_repetition_count, input_hash, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     on conflict do nothing returning id`,
    [
      input.id,
      input.runId,
      input.securityId,
      input.canonicalThesis,
      input.direction,
      input.horizon,
      input.status,
      input.adjudicatorRunId,
      input.firstSourceAt,
      input.lastSourceAt,
      input.independentSourceCount,
      input.rawRepetitionCount,
      input.inputHash,
      input.createdAt,
    ],
    `select id from rni_narrative
      where run_id = $1 and security_id is not distinct from $2 and input_hash = $3`,
    [input.runId, input.securityId, input.inputHash],
    db,
  );
}

export async function persistRniNarrativeMembership(
  input: RniNarrativeMembershipInput,
  db: Queryable = getPool(),
): Promise<{ readonly inserted: boolean }> {
  const { rowCount } = await db.query(
    `insert into rni_narrative_membership (
       narrative_id, claim_id, similarity, membership_confidence, is_independent,
       duplicate_group_hash, adjudication_reason, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (narrative_id, claim_id) do nothing`,
    [
      input.narrativeId,
      input.claimId,
      input.similarity,
      input.membershipConfidence,
      input.isIndependent,
      input.duplicateGroupHash,
      input.adjudicationReason,
      input.createdAt,
    ],
  );
  return { inserted: rowCount === 1 };
}

export async function persistRniComparativeRelation(
  input: RniComparativeRelation,
  db: Queryable = getPool(),
): Promise<{ readonly relation: RniComparativeRelation; readonly inserted: boolean }> {
  const relation = rniComparativeRelation.parse(input);
  const { rows } = await db.query<{
    id: string;
    source_item_id: string;
    subject_security_id: string;
    relation: string;
    object_security_id: string;
    evidence_text: string;
  }>(
    `insert into rni_comparative_relation (
       id, source_item_id, subject_security_id, relation, object_security_id, evidence_text
     ) values ($1, $2, $3, $4, $5, $6)
     on conflict (source_item_id, subject_security_id, relation, object_security_id) do nothing
     returning id, source_item_id, subject_security_id, relation, object_security_id, evidence_text`,
    [
      relation.id,
      relation.sourceItemId,
      relation.subjectSecurityId,
      relation.relation,
      relation.objectSecurityId,
      relation.evidenceText,
    ],
  );
  const inserted = rows[0];
  const row =
    inserted ??
    (
      await db.query<(typeof rows)[number]>(
        `select id, source_item_id, subject_security_id, relation, object_security_id, evidence_text
           from rni_comparative_relation
          where source_item_id = $1 and subject_security_id = $2 and relation = $3
            and object_security_id = $4`,
        [
          relation.sourceItemId,
          relation.subjectSecurityId,
          relation.relation,
          relation.objectSecurityId,
        ],
      )
    ).rows[0];
  if (row === undefined) throw new Error('RNI relation upsert could not read its conflict');
  return {
    relation: rniComparativeRelation.parse({
      id: row.id,
      sourceItemId: row.source_item_id,
      subjectSecurityId: row.subject_security_id,
      relation: row.relation,
      objectSecurityId: row.object_security_id,
      evidenceText: row.evidence_text,
    }),
    inserted: inserted !== undefined,
  };
}
