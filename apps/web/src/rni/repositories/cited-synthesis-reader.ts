import { z } from 'zod';

import { canonicalInstant, sha256Hex } from '../../calc/canonical';
import { getPool, type Queryable } from '../../repositories/client';
import {
  rniCitation,
  rniIsoTimestamp,
  rniPlatform,
  rniSourceItem,
  type RniCitation,
  type RniSourceItem,
} from '../contracts';
import type {
  RniCitationPublicationLineage,
  RniInferenceInvocationDescriptor,
  RniSynthesisClaim,
  RniSynthesisEvidenceReader,
} from '../agents';
import { canonicalizeRedditUrl } from '../discovery';

const uuid = z.string().uuid();
const ids = z.array(uuid).max(100).refine((values) => new Set(values).size === values.length);
const scopeSchema = z.object({ batchId: uuid, runId: uuid, securityId: uuid }).strict();
const batchSchema = z.object({
  policy_version: z.string().min(1),
  rights_policy_version: z.string().min(1),
  assessment_cutoff_at: rniIsoTimestamp,
});
const instantSql = (column: string) =>
  `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

type BatchScope = z.infer<typeof scopeSchema>;

/**
 * The current rights authority is deliberately supplied by server composition. The frozen
 * source/batch policy is historical lineage and must never be relabelled as the active policy.
 * A publication transaction must pass its own Queryable to both this reader and the authority.
 */
export type RniActiveSynthesisRightsLookup = (
  runId: string,
  db: Queryable,
) => Promise<string>;

function reject(): never {
  throw new Error('RNI cited-synthesis evidence is missing, restricted, or outside its durable batch');
}

function validOriginalUrl(source: RniSourceItem): boolean {
  if (source.platform === 'reddit') {
    const original = canonicalizeRedditUrl(source.originalUrl);
    return original !== null && original.canonicalUrl === source.canonicalUrl &&
      original.externalId === source.externalId && original.sourceKind === source.sourceKind;
  }
  try {
    const original = new URL(source.originalUrl);
    const match = original.pathname.match(/^\/(?:i\/web|[A-Za-z0-9_]+)\/status\/([0-9]+)\/?$/u);
    return original.protocol === 'https:' && original.username === '' && original.password === '' &&
      original.port === '' && ['x.com', 'www.x.com'].includes(original.hostname) &&
      match?.[1] === source.externalId &&
      source.canonicalUrl === `https://x.com/i/web/status/${source.externalId}`;
  } catch {
    return false;
  }
}

/**
 * Internal, batch-scoped D-RNI-19 reader. A claim/citation ID is not itself a run identity:
 * every lookup also requires the exact batch, run and security chosen by trusted composition.
 * This class does not claim, prepare or publish a synthesis command.
 */
export class PostgresRniSynthesisEvidenceReader implements RniSynthesisEvidenceReader {
  private readonly scope: BatchScope;

  constructor(
    scope: BatchScope,
    private readonly activeRights: RniActiveSynthesisRightsLookup,
    private readonly db: Queryable = getPool(),
  ) {
    this.scope = scopeSchema.parse(scope);
  }

  private async batch() {
    const { rows } = await this.db.query(
      `select policy_version, rights_policy_version,
              ${instantSql('assessment_cutoff_at')} as assessment_cutoff_at
         from rni_synthesis_batch where id = $1 and run_id = $2 and security_id = $3`,
      [this.scope.batchId, this.scope.runId, this.scope.securityId],
    );
    if (rows.length !== 1) reject();
    return batchSchema.parse(rows[0]);
  }

  async getActiveRightsPolicyVersion(runId: string): Promise<string> {
    if (uuid.parse(runId) !== this.scope.runId) reject();
    await this.batch();
    return z.string().trim().min(1).parse(await this.activeRights(runId, this.db));
  }

  async getEvidence(sourceItemId: string): Promise<RniSourceItem> {
    uuid.parse(sourceItemId);
    const batch = await this.batch();
    const active = await this.getActiveRightsPolicyVersion(this.scope.runId);
    if (active !== batch.rights_policy_version) reject();
    const { rows } = await this.db.query(
      `select s.id, s.platform, s.source_kind as "sourceKind", s.external_id as "externalId",
              s.canonical_url as "canonicalUrl", s.original_url as "originalUrl",
              s.subreddit_or_scope as "subredditOrScope", s.author_handle_hash as "authorHandleHash",
              s.title, s.bounded_content as "boundedContent", s.content_sha256 as "contentSha256",
              s.capture_mode as "captureMode", ${instantSql('s.published_at')} as "publishedAt",
              ${instantSql('s.discovered_at')} as "discoveredAt",
              ${instantSql('s.observed_at')} as "observedAt",
              s.search_query_id as "searchQueryId", s.provider_request_id as "providerRequestId",
              s.metadata_json as metadata, s.rights_policy_version as "rightsPolicyVersion",
              ${instantSql('s.created_at')} as "createdAt"
         from rni_source_item s
        where s.id = $1 and s.source_status = 'active' and s.rights_policy_version = $5
          and s.discovered_at <= $6::timestamptz and s.observed_at <= $6::timestamptz
          and rni_publication_canonical_url_valid(s.platform, s.source_kind, s.external_id, s.canonical_url)
          and exists (
            select 1 from rni_synthesis_citation_role role
             join rni_run_observation membership
               on membership.run_id = role.run_id and membership.observation_id = role.observation_id
              and membership.source_item_id = role.source_item_id and membership.security_id = role.security_id
            where role.batch_id = $2 and role.run_id = $3 and role.security_id = $4
              and role.source_item_id = s.id and role.platform = s.platform
          )`,
      [sourceItemId, this.scope.batchId, this.scope.runId, this.scope.securityId,
        active, batch.assessment_cutoff_at],
    );
    if (rows.length !== 1) reject();
    const source = rniSourceItem.parse(rows[0]);
    if (sha256Hex(source.boundedContent) !== source.contentSha256 || !validOriginalUrl(source)) reject();
    return source;
  }

  async getCitation(citationId: string): Promise<RniCitation> {
    uuid.parse(citationId);
    await this.batch();
    const { rows } = await this.db.query(
      `select c.id, c.source_item_id as "sourceItemId", s.platform,
              s.original_url as url, c.evidence_text as "evidenceText"
         from rni_claim_citation c join rni_source_item s on s.id = c.source_item_id
        where c.id = $1 and exists (
          select 1 from rni_synthesis_citation_role role
           where role.batch_id = $2 and role.run_id = $3 and role.security_id = $4
             and role.citation_id = c.id and role.evidence_claim_id = c.claim_id
             and role.source_item_id = c.source_item_id
        )`,
      [citationId, this.scope.batchId, this.scope.runId, this.scope.securityId],
    );
    if (rows.length !== 1) reject();
    const citation = rniCitation.parse(rows[0]);
    const source = await this.getEvidence(citation.sourceItemId);
    if (citation.platform !== source.platform || !source.boundedContent.includes(citation.evidenceText)) reject();
    return citation;
  }

  async getCitationLineage(
    claimId: string | null,
    citationId: string,
  ): Promise<RniCitationPublicationLineage | null> {
    uuid.nullable().parse(claimId);
    uuid.parse(citationId);
    await this.batch();
    const { rows } = await this.db.query(
      `select role.target_claim_id as "claimId", role.citation_id as "citationId",
              role.run_id as "runId", role.security_id as "securityId",
              role.evidence_role as "evidenceRole", role.analytics_artifact_hash as "analyticsArtifactHash",
              role.rights_policy_version as "rightsPolicyVersion",
              s.published_at is not null and s.published_at <= role.assessment_cutoff_at as published
         from rni_synthesis_citation_role role join rni_source_item s on s.id = role.source_item_id
        where role.batch_id = $1 and role.run_id = $2 and role.security_id = $3
          and role.target_claim_id is not distinct from $4::uuid and role.citation_id = $5`,
      [this.scope.batchId, this.scope.runId, this.scope.securityId, claimId, citationId],
    );
    if (rows.length === 0) return null;
    if (rows.length !== 1) reject();
    const { published, ...lineage } = z.object({
      claimId: uuid.nullable(), citationId: uuid, runId: uuid, securityId: uuid,
      evidenceRole: z.enum(['social_claim', 'corroborating', 'counterevidence']),
      analyticsArtifactHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
      rightsPolicyVersion: z.string().min(1), published: z.boolean(),
    }).strict().parse(rows[0]);
    await this.getCitation(citationId);
    if (lineage.evidenceRole !== 'social_claim' && !published) reject();
    return lineage;
  }

  async getSynthesisClaim(claimId: string): Promise<RniSynthesisClaim> {
    uuid.parse(claimId);
    await this.batch();
    const { rows } = await this.db.query(
      `select claim.id, input.run_id as "runId", input.security_id as "securityId", input.platform,
              'catalyst' as kind, claim.claim_text as "claimText", input.source_citation_ids as "sourceCitationIds",
              ${instantSql('input.assessment_cutoff_at')} as "verificationCutoffAt"
         from rni_synthesis_claim_input input join rni_evidence_claim claim
           on claim.id = input.claim_id and claim.source_item_id = input.source_item_id
          and claim.security_id = input.security_id and claim.observation_id = input.observation_id
        where input.batch_id = $1 and input.run_id = $2 and input.security_id = $3
          and input.claim_id = $4 and claim.dimension = 'catalyst_event'`,
      [this.scope.batchId, this.scope.runId, this.scope.securityId, claimId],
    );
    if (rows.length !== 1) reject();
    const claim = z.object({
      id: uuid, runId: uuid, securityId: uuid, platform: rniPlatform, kind: z.literal('catalyst'),
      claimText: z.string().min(1).max(2_000), sourceCitationIds: ids.refine((values) => values.length > 0),
      verificationCutoffAt: rniIsoTimestamp,
    }).strict().parse(rows[0]);
    for (const citationId of claim.sourceCitationIds) {
      const lineage = await this.getCitationLineage(claimId, citationId);
      if (lineage?.evidenceRole !== 'social_claim') reject();
    }
    return claim;
  }

  async getModelInvocation(modelRunId: string): Promise<RniInferenceInvocationDescriptor> {
    uuid.parse(modelRunId);
    const batch = await this.batch();
    const { rows } = await this.db.query(
      `select id as "modelRunId", stage, model_id as "modelId", prompt_version as "promptVersion",
              ordered_claim_ids as "claimIds", status, output_hash as "outputHash",
              terminal_metadata as "terminalMetadata",
              ${instantSql('prepared_at')} as "preparedAt",
              ${instantSql('completed_at')} as "completedAt"
         from rni_synthesis_model_invocation
        where id = $1 and batch_id = $2 and status in ('prepared', 'succeeded', 'skipped')`,
      [modelRunId, this.scope.batchId],
    );
    if (rows.length !== 1) reject();
    const { status, outputHash, terminalMetadata, preparedAt, completedAt, ...invocation } = z.object({
      modelRunId: uuid, stage: z.enum(['verification', 'challenger']), modelId: z.string().min(1),
      promptVersion: z.string().min(1), claimIds: ids,
      status: z.enum(['prepared', 'succeeded', 'skipped']), outputHash: z.string().nullable(),
      terminalMetadata: z.unknown(), preparedAt: rniIsoTimestamp, completedAt: rniIsoTimestamp.nullable(),
    }).strict().parse(rows[0]);
    if (status === 'skipped') {
      const metadata = z.object({
        outcome: z.literal('skipped'),
        reason: z.enum(['no_eligible_claims', 'no_verified_assessments']),
      }).strict().parse(terminalMetadata);
      if (outputHash !== null || completedAt === null ||
          canonicalInstant(completedAt) < canonicalInstant(preparedAt) ||
          (invocation.stage === 'verification' && metadata.reason !== 'no_eligible_claims')) reject();
    }
    const claims = await this.db.query<{ claim_id: string }>(
      `select claim_id from rni_synthesis_claim_input where batch_id = $1 order by ordinal`,
      [this.scope.batchId],
    );
    if (JSON.stringify(invocation.claimIds) !== JSON.stringify(claims.rows.map((row) => row.claim_id))) reject();
    return {
      ...invocation,
      runId: this.scope.runId,
      securityId: this.scope.securityId,
      policyVersion: batch.policy_version,
      rightsPolicyVersion: batch.rights_policy_version,
      assessmentCutoffAt: canonicalInstant(batch.assessment_cutoff_at),
    };
  }
}
