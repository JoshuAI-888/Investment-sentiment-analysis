import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';

import { canonicalHash, canonicalInstant, sha256Hex } from '../../calc/canonical';
import { D } from '../../calc/decimal';
import { getPool, withTransaction, type Queryable } from '../../repositories/client';
import {
  RNI_CITED_SYNTHESIS_CODE_VERSION,
  replayCitedSynthesis,
  synthesizeCitedNarrative,
  type RniChallengerInferencePort,
  type RniChallengerModelInput,
  type RniCitationPublicationLineage,
  type RniCitedSynthesisArtifact,
  type RniCitedSynthesisRequest,
  type RniClaimAssessment,
  type RniInferenceInvocationDescriptor,
  type RniSynthesisClaim,
  type RniVerifiedCitationEvidence,
  type RniVerificationModelInput,
} from '../agents';
import type {
  RniCitedSynthesisCommitResult,
  RniCitedSynthesisPersistencePort,
  RniCitedSynthesisPreparation,
  RniCitedSynthesisPreparationRequest,
  RniStoredCitedSynthesis,
} from '../composition';
import type { RniConvergenceArtifact } from '../convergence';
import { replayPlatformFacts } from '../convergence';
import { replayPlatformAnalytics, type RniPlatformAnalyticsArtifact } from '../analytics';
import {
  rniCitation,
  rniCombinedSummary,
  rniSourceItem,
  type RniCitation,
  type RniPlatform,
  type RniSourceItem,
} from '../contracts';
import {
  PostgresRniSynthesisEvidenceReader,
  type RniActiveSynthesisRightsLookup,
} from './cited-synthesis-reader';

const PLATFORM_ORDER = ['reddit', 'x'] as const;
const SYNTHESIS_ID_NAMESPACE = 'rni-cited-synthesis-persistence-v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const instantSql = (column: string) =>
  `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

function fail(message: string): never {
  throw new Error(`RNI cited-synthesis persistence rejected ${message}`);
}

function iso(value: Date | string): string {
  return canonicalInstant(value instanceof Date ? value.toISOString() : value);
}

function same(left: unknown, right: unknown): boolean {
  return canonicalHash(left) === canonicalHash(right);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function deterministicUuid(identity: string): string {
  const bytes = Buffer.from(
    createHash('sha256').update(`${SYNTHESIS_ID_NAMESPACE}:${identity}`).digest('hex').slice(0, 32),
    'hex',
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function assertIntent(input: RniCitedSynthesisPreparationRequest): void {
  if (!UUID_PATTERN.test(input.runId) || !UUID_PATTERN.test(input.securityId)) {
    fail('invalid run or security identity');
  }
  if (!HASH_PATTERN.test(input.convergenceArtifactHash)) {
    fail('invalid convergence artifact hash');
  }
  if (input.idempotencyKey.trim() === '' || input.idempotencyKey.length > 500) {
    fail('invalid idempotency identity');
  }
  try {
    canonicalInstant(input.createdAt);
  } catch {
    fail('invalid preparation time');
  }
}

async function lock(identity: string, db: Queryable): Promise<void> {
  await db.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [identity]);
}

type ConvergenceRow = {
  readonly id: string;
  readonly run_id: string;
  readonly security_id: string;
  readonly reddit_analytics_id: string;
  readonly reddit_artifact_hash: string;
  readonly x_analytics_id: string;
  readonly x_artifact_hash: string;
  readonly policy_version: string;
  readonly calculation_code_version: RniConvergenceArtifact['calculationCodeVersion'];
  readonly input_hash: string;
  readonly result_hash: string;
  readonly input_snapshot: RniConvergenceArtifact['inputSnapshot'];
  readonly result_snapshot: RniConvergenceArtifact['result'];
  readonly created_at: Date | string;
  readonly prompt_version: string;
  readonly config_version: string;
  readonly ai_route: string;
  readonly run_status: string;
};

function convergenceFromRow(row: ConvergenceRow): RniConvergenceArtifact {
  const artifact: RniConvergenceArtifact = {
    calculationCodeVersion: row.calculation_code_version,
    policyVersion: row.policy_version,
    inputHash: row.input_hash,
    resultHash: row.result_hash,
    inputSnapshot: row.input_snapshot,
    result: row.result_snapshot,
  };
  try {
    replayPlatformFacts(artifact);
  } catch {
    fail('invalid durable convergence artifact');
  }
  return artifact;
}

async function loadConvergence(
  runId: string,
  securityId: string,
  expectedHash: string | null,
  db: Queryable,
): Promise<{ readonly row: ConvergenceRow; readonly artifact: RniConvergenceArtifact }> {
  const { rows } = await db.query<ConvergenceRow>(
    `select convergence.id, convergence.run_id, convergence.security_id,
            convergence.reddit_analytics_id, convergence.reddit_artifact_hash,
            convergence.x_analytics_id, convergence.x_artifact_hash,
            convergence.policy_version, convergence.calculation_code_version,
            convergence.input_hash, convergence.result_hash, convergence.input_snapshot,
            convergence.result_snapshot, ${instantSql('convergence.created_at')} as created_at, run.prompt_version,
            run.config_version::text as config_version, run.ai_route,
            run.status as run_status
       from rni_convergence_artifact convergence
       join rni_run run on run.id = convergence.run_id
       join security on security.id = convergence.security_id
      where convergence.run_id = $1 and convergence.security_id = $2
      order by convergence.created_at, convergence.id
      for share of convergence, run, security`,
    [runId, securityId],
  );
  const matches = rows.flatMap((row) => {
    const artifact = convergenceFromRow(row);
    const artifactHash = canonicalHash(artifact);
    return expectedHash === null || artifactHash === expectedHash ? [{ row, artifact }] : [];
  });
  if (matches.length !== 1) fail('missing or ambiguous exact convergence lineage');
  const match = matches[0]!;
  if (
    match.artifact.result.runId !== runId ||
    match.artifact.result.securityId !== securityId ||
    match.artifact.inputSnapshot.asOf !== match.artifact.result.platforms.reddit.windowEnd ||
    match.artifact.inputSnapshot.asOf !== match.artifact.result.platforms.x.windowEnd
  ) {
    fail('crossed run, security, or assessment cutoff');
  }
  if (!['running', 'complete'].includes(match.row.run_status)) {
    fail('run is not eligible for synthesis');
  }
  return match;
}

type ModelRouteRow = {
  readonly task: 'rni_verification' | 'rni_challenger';
  readonly primary_provider: string;
  readonly primary_model: string;
  readonly canonical_provider_model_id: string;
  readonly model_revision: string;
  readonly prompt_version: string;
  readonly policy_version: string;
  readonly reasoning_effort: string;
  readonly ai_route: string;
  readonly enabled: boolean;
  readonly fallback_chain: unknown;
  readonly capability_snapshot_id: string;
  readonly capability_available: boolean;
  readonly capability_expires_at: Date | string;
  readonly config_status: string;
  readonly model_policy_version: string;
};

async function loadModelRoutes(
  context: ConvergenceRow,
  preparedAt: string,
  db: Queryable,
): Promise<ReadonlyMap<ModelRouteRow['task'], ModelRouteRow>> {
  const { rows } = await db.query<ModelRouteRow>(
    `select route.task, route.primary_provider, route.primary_model,
            route.canonical_provider_model_id, route.model_revision,
            route.prompt_version, route.policy_version, route.reasoning_effort,
            route.ai_route, route.enabled, route.fallback_chain,
            route.capability_snapshot_id, capability.available as capability_available,
            ${instantSql('capability.expires_at')} as capability_expires_at, config.status as config_status,
            ai.model_policy_version
       from model_route route
       join config_version config on config.id = route.config_version
       join rni_ai_config ai
         on ai.config_version = route.config_version and ai.ai_route = route.ai_route
       join rni_model_capability_snapshot capability
         on capability.id = route.capability_snapshot_id
        and capability.ai_route = route.ai_route
        and capability.configured_model_id = route.primary_model
        and capability.provider = route.primary_provider
        and capability.canonical_provider_model_id = route.canonical_provider_model_id
        and capability.model_revision = route.model_revision
      where route.config_version = $1 and route.ai_route = $2
        and route.task in ('rni_verification', 'rni_challenger')
      order by route.task
      for share of route, config, ai, capability`,
    [context.config_version, context.ai_route],
  );
  if (rows.length !== 2 || new Set(rows.map(({ task }) => task)).size !== 2) {
    fail('missing immutable verifier or challenger route lineage');
  }
  for (const route of rows) {
    if (
      route.primary_provider !== 'openai' ||
      route.canonical_provider_model_id !== 'gpt-5.6-sol' ||
      route.reasoning_effort !== 'low' ||
      route.ai_route !== context.ai_route ||
      route.policy_version !== route.model_policy_version ||
      route.policy_version !== 'rni-balanced-model-policy-v1' ||
      route.enabled !== true ||
      !same(route.fallback_chain, []) ||
      route.capability_available !== true ||
      iso(route.capability_expires_at) <= preparedAt ||
      !['active', 'superseded'].includes(route.config_status)
    ) {
      fail('inactive or crossed immutable model-route lineage');
    }
  }
  return new Map(rows.map((row) => [row.task, row]));
}

type PlatformArtifactRow = {
  readonly id: string;
  readonly run_id: string;
  readonly security_id: string;
  readonly platform_slice_id: string;
  readonly methodology_version: string;
  readonly calculation_code_version: RniPlatformAnalyticsArtifact['calculationCodeVersion'];
  readonly input_hash: string;
  readonly result_hash: string;
  readonly platform: RniPlatform;
  readonly artifact_hash: string;
  readonly input_snapshot: {
    readonly input: RniPlatformAnalyticsArtifact['inputSnapshot'];
    readonly methodology: RniPlatformAnalyticsArtifact['methodologySnapshot'];
  };
  readonly result_snapshot: RniPlatformAnalyticsArtifact['result'];
};

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function positiveWeightSourceIds(row: PlatformArtifactRow): string[] {
  const result = record(row.result_snapshot);
  const trace = result?.['weightTrace'];
  if (!Array.isArray(trace)) fail(`invalid durable ${row.platform} analytics weight trace`);
  const sourceIds: string[] = [];
  for (const entry of trace) {
    const item = record(entry);
    const sourceItemId = item?.['sourceItemId'];
    const weight = item?.['weight'];
    if (typeof sourceItemId !== 'string' || typeof weight !== 'string') {
      fail(`invalid durable ${row.platform} analytics weight trace`);
    }
    try {
      if (new D(weight).greaterThan('0')) sourceIds.push(sourceItemId);
    } catch {
      fail(`invalid durable ${row.platform} analytics weight`);
    }
  }
  return sortedUnique(sourceIds);
}

async function loadPlatformSourceIds(
  convergence: { readonly row: ConvergenceRow; readonly artifact: RniConvergenceArtifact },
  db: Queryable,
): Promise<ReadonlyMap<RniPlatform, readonly string[]>> {
  const ids = [convergence.row.reddit_analytics_id, convergence.row.x_analytics_id];
  const { rows } = await db.query<PlatformArtifactRow>(
    `select id, run_id, security_id, platform_slice_id, methodology_version, calculation_code_version,
            input_hash, result_hash, platform, artifact_hash, input_snapshot, result_snapshot
       from rni_platform_analytics_artifact where id = any($1::uuid[])
       order by platform for share`,
    [ids],
  );
  if (rows.length !== 2) fail('missing separate Reddit or X analytics lineage');
  const byPlatform = new Map(rows.map((row) => [row.platform, row]));
  for (const platform of PLATFORM_ORDER) {
    const row = byPlatform.get(platform);
    const fact = convergence.artifact.result.platforms[platform];
    if (
      row === undefined ||
      row.id !==
        (platform === 'reddit'
          ? convergence.row.reddit_analytics_id
          : convergence.row.x_analytics_id) ||
      row.artifact_hash !== fact.analyticsArtifactHash
    ) {
      fail(`crossed ${platform} analytics identity`);
    }
    const artifact: RniPlatformAnalyticsArtifact = {
      runId: row.run_id,
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
      replayPlatformAnalytics(artifact);
    } catch {
      fail(`invalid durable ${platform} analytics snapshot`);
    }
    if (
      canonicalHash(artifact) !== row.artifact_hash ||
      row.run_id !== fact.runId ||
      row.security_id !== fact.securityId ||
      row.platform_slice_id !== fact.runSourceSliceId ||
      artifact.inputSnapshot.platform !== platform ||
      artifact.inputSnapshot.securityId !== fact.securityId ||
      artifact.inputSnapshot.runId !== fact.runId ||
      artifact.inputSnapshot.runSourceSliceId !== fact.runSourceSliceId ||
      artifact.methodologyVersion !== fact.methodologyVersion ||
      iso(artifact.inputSnapshot.current.windowStart) !== iso(fact.windowStart) ||
      iso(artifact.inputSnapshot.current.windowEnd) !== iso(fact.windowEnd)
    ) {
      fail(`crossed ${platform} analytics snapshot/hash lineage`);
    }
  }
  return new Map(
    PLATFORM_ORDER.map((platform) => [
      platform,
      positiveWeightSourceIds(byPlatform.get(platform)!),
    ]),
  );
}

type EvidenceRow = {
  readonly claim_id: string;
  readonly claim_text: string;
  readonly claim_dimension: string | null;
  readonly claim_type: string;
  readonly epistemic_status: string;
  readonly observation_id: string;
  readonly observation_stance: string;
  readonly dimension_assignments: unknown;
  readonly source_item_id: string;
  readonly citation_id: string;
  readonly evidence_text: string;
  readonly platform: RniPlatform;
  readonly source_kind: string;
  readonly external_id: string | null;
  readonly canonical_url: string;
  readonly original_url: string;
  readonly subreddit_or_scope: string;
  readonly author_handle_hash: string | null;
  readonly title: string | null;
  readonly bounded_content: string;
  readonly content_sha256: string;
  readonly capture_mode: string;
  readonly published_at: Date | string | null;
  readonly discovered_at: Date | string;
  readonly observed_at: Date | string;
  readonly search_query_id: string | null;
  readonly provider_request_id: string | null;
  readonly metadata_json: unknown;
  readonly rights_policy_version: string;
  readonly source_created_at: Date | string;
  readonly source_status: string;
  readonly canonical_url_valid: boolean;
  readonly narrative_ids: string[];
};

type SourceRow = Pick<
  EvidenceRow,
  | 'source_item_id'
  | 'platform'
  | 'source_kind'
  | 'external_id'
  | 'canonical_url'
  | 'original_url'
  | 'subreddit_or_scope'
  | 'author_handle_hash'
  | 'title'
  | 'bounded_content'
  | 'content_sha256'
  | 'capture_mode'
  | 'published_at'
  | 'discovered_at'
  | 'observed_at'
  | 'search_query_id'
  | 'provider_request_id'
  | 'metadata_json'
  | 'rights_policy_version'
  | 'source_created_at'
  | 'source_status'
  | 'canonical_url_valid'
>;

async function loadEvidenceRows(
  runId: string,
  securityId: string,
  db: Queryable,
): Promise<readonly EvidenceRow[]> {
  const { rows } = await db.query<EvidenceRow>(
    `select claim.id as claim_id, claim.claim_text,
            claim.dimension as claim_dimension, claim.claim_type, claim.epistemic_status,
            observation.id as observation_id, observation.stance as observation_stance,
            observation.dimension_assignments, source.id as source_item_id,
            citation.id as citation_id, citation.evidence_text, source.platform,
            source.source_kind, source.external_id, source.canonical_url, source.original_url,
            source.subreddit_or_scope, source.author_handle_hash, source.title,
            source.bounded_content, source.content_sha256, source.capture_mode,
            ${instantSql('source.published_at')} as published_at,
            ${instantSql('source.discovered_at')} as discovered_at,
            ${instantSql('source.observed_at')} as observed_at,
            source.search_query_id, source.provider_request_id, source.metadata_json,
            source.rights_policy_version, ${instantSql('source.created_at')} as source_created_at,
            source.source_status,
            rni_publication_canonical_url_valid(
              source.platform, source.source_kind, source.external_id, source.canonical_url
            ) as canonical_url_valid,
            coalesce(array_agg(distinct narrative.id) filter (where narrative.id is not null), '{}')
              as narrative_ids
       from rni_run_observation membership
       join rni_security_observation observation
         on observation.id = membership.observation_id
        and observation.source_item_id = membership.source_item_id
        and observation.security_id = membership.security_id
       join rni_evidence_claim claim
         on claim.observation_id = observation.id
        and claim.source_item_id = observation.source_item_id
        and claim.security_id = observation.security_id
       join rni_claim_citation citation
         on citation.claim_id = claim.id and citation.source_item_id = claim.source_item_id
       join rni_source_item source on source.id = membership.source_item_id
       left join rni_narrative_membership narrative_member on narrative_member.claim_id = claim.id
       left join rni_narrative narrative
         on narrative.id = narrative_member.narrative_id
        and narrative.run_id = membership.run_id
        and narrative.security_id = membership.security_id
      where membership.run_id = $1 and membership.security_id = $2
      group by claim.id, observation.id, source.id, citation.id
      order by source.platform, claim.id, citation.id`,
    [runId, securityId],
  );
  return rows;
}

function sourceFromEvidence(row: SourceRow): RniSourceItem {
  if (
    row.source_status !== 'active' ||
    !row.canonical_url_valid ||
    sha256Hex(row.bounded_content) !== row.content_sha256
  ) {
    fail('inactive, noncanonical, or content-drifted evidence source');
  }
  return rniSourceItem.parse({
    id: row.source_item_id,
    platform: row.platform,
    sourceKind: row.source_kind,
    externalId: row.external_id,
    canonicalUrl: row.canonical_url,
    originalUrl: row.original_url,
    subredditOrScope: row.subreddit_or_scope,
    authorHandleHash: row.author_handle_hash,
    title: row.title,
    boundedContent: row.bounded_content,
    contentSha256: row.content_sha256,
    captureMode: row.capture_mode,
    publishedAt: row.published_at === null ? null : iso(row.published_at),
    discoveredAt: iso(row.discovered_at),
    observedAt: iso(row.observed_at),
    searchQueryId: row.search_query_id,
    providerRequestId: row.provider_request_id,
    metadata: row.metadata_json,
    rightsPolicyVersion: row.rights_policy_version,
    createdAt: iso(row.source_created_at),
  });
}

function citationFromEvidence(row: EvidenceRow): RniCitation {
  return rniCitation.parse({
    id: row.citation_id,
    sourceItemId: row.source_item_id,
    platform: row.platform,
    url: row.original_url,
    evidenceText: row.evidence_text,
  });
}

function catalystScore(row: EvidenceRow): ReturnType<typeof D> | null {
  if (!Array.isArray(row.dimension_assignments)) return null;
  const assignments = row.dimension_assignments.filter(
    (value) => record(value)?.['dimension'] === 'catalyst_event',
  );
  if (assignments.length !== 1) return null;
  const score = record(assignments[0])?.['score'];
  if (typeof score !== 'string' && typeof score !== 'number') return null;
  try {
    return new D(String(score));
  } catch {
    return null;
  }
}

function direction(row: EvidenceRow): -1 | 0 | 1 | null {
  const score = catalystScore(row);
  if (score === null) return null;
  if (score.isZero()) return 0;
  return score.isNegative() ? -1 : 1;
}

type PreparedRole = {
  readonly targetClaimId: string | null;
  readonly evidence: EvidenceRow;
  readonly evidenceRole: RniCitationPublicationLineage['evidenceRole'];
  readonly analyticsArtifactId: string | null;
  readonly analyticsArtifactHash: string | null;
};

type PreparedMaterial = {
  readonly request: RniCitedSynthesisRequest;
  readonly roles: readonly PreparedRole[];
  readonly verificationModelInput: RniVerificationModelInput;
  readonly routeByTask: ReadonlyMap<ModelRouteRow['task'], ModelRouteRow>;
  readonly convergenceId: string;
};

function isPublishable(artifact: RniConvergenceArtifact, platform: RniPlatform): boolean {
  const facts = artifact.result.platforms[platform];
  return (
    (facts.status === 'complete' || facts.status === 'partial') &&
    artifact.result.facts.freshness[platform] === 'fresh' &&
    facts.stance !== 'insufficient' &&
    facts.stanceScore !== null
  );
}

function validateEvidenceForPublication(
  row: EvidenceRow,
  rightsPolicyVersion: string,
  cutoff: string,
  requirePublishedAt: boolean,
): boolean {
  const byCutoff = iso(row.discovered_at) <= iso(cutoff) && iso(row.observed_at) <= iso(cutoff);
  const publishedByCutoff = row.published_at !== null && iso(row.published_at) <= iso(cutoff);
  if (row.source_status !== 'active') fail('inactive publication-rights source');
  if (row.rights_policy_version !== rightsPolicyVersion) fail('crossed rights-policy identity');
  if (!row.canonical_url_valid) fail('noncanonical Reddit or X publication URL');
  if (!byCutoff) return false;
  return !requirePublishedAt || publishedByCutoff;
}

function claimFromRows(
  rows: readonly EvidenceRow[],
  runId: string,
  securityId: string,
  cutoff: string,
): RniSynthesisClaim {
  const first = rows[0];
  if (first === undefined) fail('empty catalyst claim evidence');
  if (
    rows.some(
      (row) =>
        row.claim_id !== first.claim_id ||
        row.claim_text !== first.claim_text ||
        row.platform !== first.platform,
    )
  ) {
    fail('crossed persisted catalyst claim identity');
  }
  return {
    id: first.claim_id,
    runId,
    securityId,
    platform: first.platform,
    kind: 'catalyst',
    claimText: first.claim_text.trim(),
    sourceCitationIds: sortedUnique(rows.map(({ citation_id }) => citation_id)),
    verificationCutoffAt: cutoff,
  };
}

function buildVerificationInput(
  request: RniCitedSynthesisRequest,
  roles: readonly PreparedRole[],
): RniVerificationModelInput {
  const evidenceByCitation = new Map<string, Omit<RniVerifiedCitationEvidence, 'lineage'>>();
  for (const role of roles) {
    evidenceByCitation.set(role.evidence.citation_id, {
      citation: citationFromEvidence(role.evidence),
      source: sourceFromEvidence(role.evidence),
    });
  }
  return {
    policy: {
      version: request.policyVersion,
      sourceContentTreatment: 'untrusted_data',
      allowedTools: [],
      outputTextPublication: 'forbidden_structured_verdicts_only',
    },
    invocation: request.verificationInvocation,
    runId: request.convergenceArtifact.result.runId,
    securityId: request.convergenceArtifact.result.securityId,
    convergenceFacts: request.convergenceArtifact.result,
    claimInputs: request.claims.map((claim) => ({
      claim,
      evidence: request.citationIds.flatMap((citationId) => {
        const role = roles.find(
          (candidate) =>
            candidate.targetClaimId === claim.id && candidate.evidence.citation_id === citationId,
        );
        const evidence = evidenceByCitation.get(citationId);
        if (role === undefined || evidence === undefined) return [];
        return [
          {
            ...evidence,
            lineage: {
              claimId: claim.id,
              citationId,
              runId: request.convergenceArtifact.result.runId,
              securityId: request.convergenceArtifact.result.securityId,
              evidenceRole: role.evidenceRole,
              analyticsArtifactHash: null,
              rightsPolicyVersion: request.rightsPolicyVersion,
            },
          },
        ];
      }),
    })),
  };
}

async function buildFreshMaterial(
  input: RniCitedSynthesisPreparationRequest,
  batchId: string,
  activeRights: RniActiveSynthesisRightsLookup,
  db: Queryable,
): Promise<PreparedMaterial> {
  const preparedAt = iso(input.createdAt);
  const convergence = await loadConvergence(
    input.runId,
    input.securityId,
    input.convergenceArtifactHash,
    db,
  );
  const cutoff = convergence.artifact.inputSnapshot.asOf;
  if (preparedAt < iso(cutoff)) fail('preparation precedes its cutoff');
  const routeByTask = await loadModelRoutes(convergence.row, preparedAt, db);
  const sourceIds = await loadPlatformSourceIds(convergence, db);
  const evidenceRows = await loadEvidenceRows(input.runId, input.securityId, db);
  const rightsPolicyVersion = (await activeRights(input.runId, db)).trim();
  if (rightsPolicyVersion === '') fail('missing active rights-policy authority');

  const platformRows = new Map<RniPlatform, EvidenceRow[]>();
  for (const platform of PLATFORM_ORDER) {
    const weightedSourceIds = new Set(sourceIds.get(platform) ?? []);
    const rows = evidenceRows.filter(
      (row) => row.platform === platform && weightedSourceIds.has(row.source_item_id),
    );
    const eligible = rows.filter((row) =>
      validateEvidenceForPublication(row, rightsPolicyVersion, cutoff, false),
    );
    if (isPublishable(convergence.artifact, platform) && eligible.length === 0) {
      fail(`${platform} publication eligibility does not match convergence`);
    }
    platformRows.set(platform, isPublishable(convergence.artifact, platform) ? eligible : []);
  }

  const targetClaimRows = evidenceRows.filter((row) => {
    const weightedSourceIds = new Set(sourceIds.get(row.platform) ?? []);
    return (
      row.claim_dimension === 'catalyst_event' &&
      isPublishable(convergence.artifact, row.platform) &&
      weightedSourceIds.has(row.source_item_id) &&
      validateEvidenceForPublication(row, rightsPolicyVersion, cutoff, false)
    );
  });
  const targetClaimIds = sortedUnique(targetClaimRows.map(({ claim_id }) => claim_id));
  const claims = targetClaimIds
    .map((claimId) =>
      claimFromRows(
        targetClaimRows.filter((row) => row.claim_id === claimId),
        input.runId,
        input.securityId,
        cutoff,
      ),
    )
    .sort(
      (left, right) =>
        PLATFORM_ORDER.indexOf(left.platform) - PLATFORM_ORDER.indexOf(right.platform) ||
        left.id.localeCompare(right.id),
    );

  const roles: PreparedRole[] = [];
  for (const platform of PLATFORM_ORDER) {
    const analyticsArtifactId =
      platform === 'reddit' ? convergence.row.reddit_analytics_id : convergence.row.x_analytics_id;
    const analyticsArtifactHash =
      platform === 'reddit'
        ? convergence.row.reddit_artifact_hash
        : convergence.row.x_artifact_hash;
    for (const evidence of platformRows.get(platform) ?? []) {
      roles.push({
        targetClaimId: null,
        evidence,
        evidenceRole: 'social_claim',
        analyticsArtifactId,
        analyticsArtifactHash,
      });
    }
  }
  for (const claim of claims) {
    const ownRows = targetClaimRows.filter(({ claim_id }) => claim_id === claim.id);
    for (const evidence of ownRows) {
      roles.push({
        targetClaimId: claim.id,
        evidence,
        evidenceRole: 'social_claim',
        analyticsArtifactId: null,
        analyticsArtifactHash: null,
      });
    }
    const targetNarratives = new Set(ownRows.flatMap(({ narrative_ids }) => narrative_ids));
    const targetDirection = direction(ownRows[0]!);
    if (targetNarratives.size === 0 || targetDirection === null || targetDirection === 0) continue;
    for (const evidence of evidenceRows) {
      if (
        evidence.claim_dimension !== 'catalyst_event' ||
        evidence.source_item_id === ownRows[0]!.source_item_id ||
        !evidence.narrative_ids.some((id) => targetNarratives.has(id))
      ) {
        continue;
      }
      if (!validateEvidenceForPublication(evidence, rightsPolicyVersion, cutoff, true)) continue;
      const evidenceDirection = direction(evidence);
      if (evidenceDirection === null || evidenceDirection === 0) continue;
      roles.push({
        targetClaimId: claim.id,
        evidence,
        evidenceRole: evidenceDirection === targetDirection ? 'corroborating' : 'counterevidence',
        analyticsArtifactId: null,
        analyticsArtifactHash: null,
      });
    }
  }
  const roleKeys = roles.map(
    ({ targetClaimId, evidence }) => `${targetClaimId ?? 'platform'}:${evidence.citation_id}`,
  );
  if (new Set(roleKeys).size !== roleKeys.length) fail('duplicated citation role identity');

  const claimIds = claims.map(({ id }) => id);
  const verificationRoute = routeByTask.get('rni_verification')!;
  const challengerRoute = routeByTask.get('rni_challenger')!;
  const verificationInvocation: RniInferenceInvocationDescriptor<'verification'> = {
    modelRunId: deterministicUuid(`${batchId}:verification`),
    stage: 'verification',
    runId: input.runId,
    securityId: input.securityId,
    modelId: verificationRoute.primary_model,
    promptVersion: verificationRoute.prompt_version,
    policyVersion: convergence.row.prompt_version,
    rightsPolicyVersion,
    claimIds,
    assessmentCutoffAt: cutoff,
  };
  const challengerInvocation: RniInferenceInvocationDescriptor<'challenger'> = {
    modelRunId: deterministicUuid(`${batchId}:challenger`),
    stage: 'challenger',
    runId: input.runId,
    securityId: input.securityId,
    modelId: challengerRoute.primary_model,
    promptVersion: challengerRoute.prompt_version,
    policyVersion: convergence.row.prompt_version,
    rightsPolicyVersion,
    claimIds,
    assessmentCutoffAt: cutoff,
  };
  const request: RniCitedSynthesisRequest = {
    codeVersion: RNI_CITED_SYNTHESIS_CODE_VERSION,
    policyVersion: convergence.row.prompt_version,
    rightsPolicyVersion,
    summaryId: deterministicUuid(`${batchId}:summary`),
    verificationInvocation,
    challengerInvocation,
    createdAt: preparedAt,
    convergenceArtifact: convergence.artifact,
    claims,
    platformCitationIds: {
      reddit: sortedUnique(
        (platformRows.get('reddit') ?? []).map(({ citation_id }) => citation_id),
      ),
      x: sortedUnique((platformRows.get('x') ?? []).map(({ citation_id }) => citation_id)),
    },
    citationIds: sortedUnique(roles.map(({ evidence }) => evidence.citation_id)),
  };
  const verificationModelInput = buildVerificationInput(request, roles);
  return {
    request,
    roles,
    verificationModelInput,
    routeByTask,
    convergenceId: convergence.row.id,
  };
}

function invocationPreparedSnapshot(input: {
  readonly descriptor: RniInferenceInvocationDescriptor;
  readonly idempotencyIdentityHash: string;
  readonly createdAt: string;
  readonly convergenceArtifactId: string;
  readonly convergenceArtifactHash: string;
  readonly summaryId: string;
}): Readonly<Record<string, unknown>> {
  return input;
}

async function insertPreparation(
  input: RniCitedSynthesisPreparationRequest,
  batchId: string,
  material: PreparedMaterial,
  db: Queryable,
): Promise<void> {
  const request = material.request;
  await db.query(
    `insert into rni_synthesis_batch (
       id, run_id, security_id, assessment_cutoff_at, policy_version,
       rights_policy_version, ordered_citation_ids, reddit_platform_citation_ids,
       x_platform_citation_ids, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10)`,
    [
      batchId,
      input.runId,
      input.securityId,
      request.convergenceArtifact.inputSnapshot.asOf,
      request.policyVersion,
      request.rightsPolicyVersion,
      JSON.stringify(request.citationIds),
      JSON.stringify(request.platformCitationIds.reddit),
      JSON.stringify(request.platformCitationIds.x),
      request.createdAt,
    ],
  );
  const rowByClaim = new Map(material.roles.map(({ evidence }) => [evidence.claim_id, evidence]));
  for (const [ordinal, claim] of request.claims.entries()) {
    const row = rowByClaim.get(claim.id);
    if (row === undefined) fail('missing catalyst claim row during preparation');
    await db.query(
      `insert into rni_synthesis_claim_input (
         batch_id, run_id, security_id, assessment_cutoff_at, policy_version,
         rights_policy_version, ordinal, claim_id, source_item_id, observation_id,
         platform, source_citation_ids, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)`,
      [
        batchId,
        input.runId,
        input.securityId,
        claim.verificationCutoffAt,
        request.policyVersion,
        request.rightsPolicyVersion,
        ordinal,
        claim.id,
        row.source_item_id,
        row.observation_id,
        claim.platform,
        JSON.stringify(claim.sourceCitationIds),
        request.createdAt,
      ],
    );
  }
  for (const role of material.roles) {
    const row = role.evidence;
    await db.query(
      `insert into rni_synthesis_citation_role (
         id, batch_id, run_id, security_id, assessment_cutoff_at, policy_version,
         rights_policy_version, target_claim_id, citation_id, evidence_claim_id,
         source_item_id, observation_id, platform, evidence_role,
         analytics_artifact_id, analytics_artifact_hash, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                 $15, $16, $17)`,
      [
        randomUUID(),
        batchId,
        input.runId,
        input.securityId,
        request.convergenceArtifact.inputSnapshot.asOf,
        request.policyVersion,
        request.rightsPolicyVersion,
        role.targetClaimId,
        row.citation_id,
        row.claim_id,
        row.source_item_id,
        row.observation_id,
        row.platform,
        role.evidenceRole,
        role.analyticsArtifactId,
        role.analyticsArtifactHash,
        request.createdAt,
      ],
    );
  }
  const idempotencyIdentityHash = canonicalHash({ idempotencyKey: input.idempotencyKey });
  for (const [task, descriptor, inputHash, preparedSnapshot] of [
    [
      'rni_verification',
      request.verificationInvocation,
      canonicalHash(material.verificationModelInput),
      material.verificationModelInput,
    ],
    ['rni_challenger', request.challengerInvocation, null, undefined],
  ] as const) {
    const route = material.routeByTask.get(task)!;
    await db.query(
      `insert into rni_synthesis_model_invocation (
         id, batch_id, stage, model_id, model_revision, prompt_version,
         ordered_claim_ids, input_hash, prepared_snapshot, prepared_at
       ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10)`,
      [
        descriptor.modelRunId,
        batchId,
        descriptor.stage,
        descriptor.modelId,
        route.model_revision,
        descriptor.promptVersion,
        JSON.stringify(descriptor.claimIds),
        inputHash,
        JSON.stringify({
          ...invocationPreparedSnapshot({
            descriptor,
            idempotencyIdentityHash,
            createdAt: request.createdAt,
            convergenceArtifactId: material.convergenceId,
            convergenceArtifactHash: input.convergenceArtifactHash,
            summaryId: request.summaryId,
          }),
          ...(preparedSnapshot === undefined ? {} : { modelInput: preparedSnapshot }),
        }),
        request.createdAt,
      ],
    );
  }
}

type BatchRow = {
  readonly id: string;
  readonly run_id: string;
  readonly security_id: string;
  readonly assessment_cutoff_at: Date | string;
  readonly policy_version: string;
  readonly rights_policy_version: string;
  readonly ordered_citation_ids: string[];
  readonly reddit_platform_citation_ids: string[];
  readonly x_platform_citation_ids: string[];
  readonly created_at: Date | string;
};

type InvocationRow = {
  readonly id: string;
  readonly batch_id: string;
  readonly stage: 'verification' | 'challenger';
  readonly status: 'prepared' | 'succeeded' | 'failed' | 'skipped';
  readonly model_id: string;
  readonly model_revision: string;
  readonly prompt_version: string;
  readonly ordered_claim_ids: string[];
  readonly input_hash: string | null;
  readonly prepared_snapshot: {
    readonly descriptor: RniInferenceInvocationDescriptor;
    readonly idempotencyIdentityHash: string;
    readonly createdAt: string;
    readonly convergenceArtifactId: string;
    readonly convergenceArtifactHash: string;
    readonly summaryId: string;
    readonly modelInput?: unknown;
  };
  readonly output_hash: string | null;
  readonly terminal_metadata: unknown;
  readonly prepared_at: string;
  readonly completed_at: string | null;
};

async function loadPreparedRequest(
  batchId: string,
  db: Queryable,
): Promise<{
  readonly batch: BatchRow;
  readonly request: RniCitedSynthesisRequest;
  readonly invocations: readonly [InvocationRow, InvocationRow];
}> {
  const batchResult = await db.query<BatchRow>(
    `select id, run_id, security_id, ${instantSql('assessment_cutoff_at')} as assessment_cutoff_at, policy_version,
            rights_policy_version, ordered_citation_ids, reddit_platform_citation_ids,
            x_platform_citation_ids, ${instantSql('created_at')} as created_at
       from rni_synthesis_batch where id = $1 for share`,
    [batchId],
  );
  const batch = batchResult.rows[0];
  if (batch === undefined) fail('missing durable preparation');
  const invocationResult = await db.query<InvocationRow>(
    `select id, batch_id, stage, status, model_id, model_revision, prompt_version,
            ordered_claim_ids, input_hash, prepared_snapshot, output_hash, terminal_metadata,
            ${instantSql('prepared_at')} as prepared_at, ${instantSql('completed_at')} as completed_at
       from rni_synthesis_model_invocation where batch_id = $1 order by stage for share`,
    [batchId],
  );
  if (invocationResult.rows.length !== 2) fail('missing separate prepared model invocations');
  const challenger = invocationResult.rows.find(({ stage }) => stage === 'challenger');
  const verification = invocationResult.rows.find(({ stage }) => stage === 'verification');
  if (challenger === undefined || verification === undefined) {
    fail('crossed verifier or challenger preparation');
  }
  const verifierSnapshot = verification.prepared_snapshot;
  const challengerSnapshot = challenger.prepared_snapshot;
  if (
    verifierSnapshot.convergenceArtifactId !== challengerSnapshot.convergenceArtifactId ||
    verifierSnapshot.convergenceArtifactHash !== challengerSnapshot.convergenceArtifactHash ||
    verifierSnapshot.idempotencyIdentityHash !== challengerSnapshot.idempotencyIdentityHash ||
    verifierSnapshot.createdAt !== challengerSnapshot.createdAt ||
    verifierSnapshot.summaryId !== challengerSnapshot.summaryId
  ) {
    fail('crossed durable preparation snapshots');
  }
  const convergence = await loadConvergence(
    batch.run_id,
    batch.security_id,
    verifierSnapshot.convergenceArtifactHash,
    db,
  );
  if (convergence.row.id !== verifierSnapshot.convergenceArtifactId) {
    fail('crossed convergence storage identity');
  }
  const routes = await loadModelRoutes(convergence.row, iso(batch.created_at), db);
  await loadPlatformSourceIds(convergence, db);
  const claimResult = await db.query<{
    ordinal: number;
    claim_id: string;
    claim_text: string;
    platform: RniPlatform;
    source_citation_ids: string[];
  }>(
    `select input.ordinal, input.claim_id, claim.claim_text, input.platform,
            input.source_citation_ids
       from rni_synthesis_claim_input input
       join rni_evidence_claim claim on claim.id = input.claim_id
      where input.batch_id = $1 order by input.ordinal`,
    [batchId],
  );
  const claims: RniSynthesisClaim[] = claimResult.rows.map((row, ordinal) => {
    if (row.ordinal !== ordinal) fail('noncanonical catalyst claim order');
    return {
      id: row.claim_id,
      runId: batch.run_id,
      securityId: batch.security_id,
      platform: row.platform,
      kind: 'catalyst',
      claimText: row.claim_text.trim(),
      sourceCitationIds: row.source_citation_ids,
      verificationCutoffAt: convergence.artifact.inputSnapshot.asOf,
    };
  });
  const descriptors = [verification, challenger] as const;
  for (const invocation of descriptors) {
    const descriptor = invocation.prepared_snapshot.descriptor;
    const route = routes.get(
      invocation.stage === 'verification' ? 'rni_verification' : 'rni_challenger',
    )!;
    if (
      descriptor.modelRunId !== invocation.id ||
      descriptor.stage !== invocation.stage ||
      descriptor.runId !== batch.run_id ||
      descriptor.securityId !== batch.security_id ||
      descriptor.modelId !== invocation.model_id ||
      descriptor.promptVersion !== invocation.prompt_version ||
      invocation.model_id !== route.primary_model ||
      invocation.model_revision !== route.model_revision ||
      invocation.prompt_version !== route.prompt_version ||
      descriptor.policyVersion !== batch.policy_version ||
      descriptor.rightsPolicyVersion !== batch.rights_policy_version ||
      iso(descriptor.assessmentCutoffAt) !== iso(batch.assessment_cutoff_at) ||
      !same(descriptor.claimIds, invocation.ordered_claim_ids) ||
      !same(
        descriptor.claimIds,
        claims.map(({ id }) => id),
      )
    ) {
      fail('crossed model invocation descriptor');
    }
    if (
      invocation.batch_id !== batch.id ||
      !same(
        Object.keys(invocation.prepared_snapshot).sort(),
        [
          'descriptor',
          'idempotencyIdentityHash',
          'createdAt',
          'convergenceArtifactId',
          'convergenceArtifactHash',
          'summaryId',
          ...(invocation.input_hash === null ? [] : ['modelInput']),
        ].sort(),
      ) ||
      invocation.prepared_snapshot.summaryId !== deterministicUuid(`${batch.id}:summary`) ||
      iso(invocation.prepared_at) !== iso(batch.created_at) ||
      (invocation.input_hash === null
        ? invocation.stage !== 'challenger' ||
          invocation.status !== 'prepared' ||
          Object.hasOwn(invocation.prepared_snapshot, 'modelInput')
        : record(invocation.prepared_snapshot.modelInput) === null ||
          invocation.input_hash !== canonicalHash(invocation.prepared_snapshot.modelInput))
    )
      fail('model invocation input or preparation storage drift');
  }
  const request: RniCitedSynthesisRequest = {
    codeVersion: RNI_CITED_SYNTHESIS_CODE_VERSION,
    policyVersion: batch.policy_version,
    rightsPolicyVersion: batch.rights_policy_version,
    summaryId: verifierSnapshot.summaryId,
    verificationInvocation: verification.prepared_snapshot
      .descriptor as RniInferenceInvocationDescriptor<'verification'>,
    challengerInvocation: challenger.prepared_snapshot
      .descriptor as RniInferenceInvocationDescriptor<'challenger'>,
    createdAt: iso(batch.created_at),
    convergenceArtifact: convergence.artifact,
    claims,
    platformCitationIds: {
      reddit: batch.reddit_platform_citation_ids,
      x: batch.x_platform_citation_ids,
    },
    citationIds: batch.ordered_citation_ids,
  };
  if (request.createdAt !== verifierSnapshot.createdAt) fail('crossed preparation timestamp');
  return { batch, request, invocations: [verification, challenger] };
}

type PreparedRequest = Awaited<ReturnType<typeof loadPreparedRequest>>;

async function scopedReader(
  prepared: PreparedRequest,
  activeRights: RniActiveSynthesisRightsLookup,
  db: Queryable,
): Promise<PostgresRniSynthesisEvidenceReader> {
  // Prevent a concurrent rights withdrawal from racing the publication/replay transaction.
  await db.query(
    `select source.id from rni_source_item source
      where exists (select 1 from rni_synthesis_citation_role role
                     where role.batch_id = $1 and role.source_item_id = source.id)
      order by source.id for share`,
    [prepared.batch.id],
  );
  const reader = new PostgresRniSynthesisEvidenceReader(
    {
      batchId: prepared.batch.id,
      runId: prepared.batch.run_id,
      securityId: prepared.batch.security_id,
    },
    activeRights,
    db,
  );
  if (
    (await reader.getActiveRightsPolicyVersion(prepared.batch.run_id)) !==
    prepared.batch.rights_policy_version
  ) {
    fail('batch differs from active rights policy');
  }
  return reader;
}

/** Use E08's own deterministic preparation, intercepting before any provider dispatch. */
async function assertVerificationSnapshot(
  prepared: PreparedRequest,
  reader: PostgresRniSynthesisEvidenceReader,
): Promise<void> {
  const boundaryReached = new Error('validated verification boundary');
  let actual: RniVerificationModelInput | undefined;
  try {
    const skipped = await synthesizeCitedNarrative(
      prepared.request,
      reader,
      {
        verify: async (input) => {
          actual = input;
          throw boundaryReached;
        },
      },
      {
        challenge: async () => {
          fail('unexpected challenger during input validation');
        },
      },
    );
    actual = skipped.modelInputSnapshot;
  } catch (error) {
    if (error !== boundaryReached) throw error;
  }
  if (actual === undefined || !same(actual, prepared.invocations[0].prepared_snapshot.modelInput)) {
    fail('verification input differs from current batch evidence');
  }
}

async function hydrateChallenger(
  invocation: InvocationRow,
  input: RniChallengerModelInput,
  db: Queryable,
): Promise<void> {
  if (
    invocation.stage === 'challenger' &&
    invocation.status === 'prepared' &&
    invocation.input_hash !== null &&
    invocation.input_hash === canonicalHash(input) &&
    same(invocation.prepared_snapshot.modelInput, input)
  ) {
    return; // Exact retry observes the first hydration; it never performs a second write.
  }
  if (
    invocation.stage !== 'challenger' ||
    invocation.status !== 'prepared' ||
    invocation.input_hash !== null ||
    Object.hasOwn(invocation.prepared_snapshot, 'modelInput')
  ) {
    fail('challenger input permits exactly one hydration');
  }
  const result = await db.query(
    `update rni_synthesis_model_invocation
        set input_hash = $2, prepared_snapshot = prepared_snapshot || jsonb_build_object('modelInput', $3::jsonb)
      where id = $1 and stage = 'challenger' and status = 'prepared' and input_hash is null`,
    [invocation.id, canonicalHash(input), JSON.stringify(input)],
  );
  if (result.rowCount !== 1) fail('challenger input was concurrently hydrated');
}

function expectedTerminal(artifact: RniCitedSynthesisArtifact, stage: InvocationRow['stage']) {
  const hasEligibleClaim = artifact.modelInputSnapshot.claimInputs.some(({ claim }) =>
    isPublishable(artifact.requestSnapshot.convergenceArtifact, claim.platform),
  );
  const hasVerifiedAssessment = artifact.verificationOutputSnapshot.some(
    ({ verdict }) => verdict !== 'unverified',
  );
  const reason = !hasEligibleClaim
    ? 'no_eligible_claims'
    : stage === 'challenger' && !hasVerifiedAssessment
      ? 'no_verified_assessments'
      : null;
  return reason === null
    ? {
        status: 'succeeded',
        outputHash: canonicalHash(
          stage === 'verification'
            ? artifact.verificationOutputSnapshot
            : artifact.challengerOutputSnapshot,
        ),
        metadata: { outcome: 'succeeded' },
      }
    : { status: 'skipped', outputHash: null, metadata: { outcome: 'skipped', reason } };
}

async function assertIntentMatchesPreparation(
  input: RniCitedSynthesisPreparationRequest,
  batchId: string,
  db: Queryable,
): Promise<ReturnType<typeof loadPreparedRequest> extends Promise<infer T> ? T : never> {
  const prepared = await loadPreparedRequest(batchId, db);
  const snapshot = prepared.invocations[0].prepared_snapshot;
  if (
    prepared.batch.run_id !== input.runId ||
    prepared.batch.security_id !== input.securityId ||
    snapshot.convergenceArtifactHash !== input.convergenceArtifactHash ||
    snapshot.idempotencyIdentityHash !== canonicalHash({ idempotencyKey: input.idempotencyKey }) ||
    snapshot.createdAt !== iso(input.createdAt)
  ) {
    fail('idempotency identity reused with different intent');
  }
  return prepared;
}

async function prepare(
  input: RniCitedSynthesisPreparationRequest,
  activeRights: RniActiveSynthesisRightsLookup,
  db: Queryable,
): Promise<RniCitedSynthesisPreparation> {
  assertIntent(input);
  const batchId = deterministicUuid(`idempotency:${input.idempotencyKey}`);
  await lock(`rni-cited-synthesis:${batchId}`, db);
  const existing = await db.query<{ id: string }>(
    'select id from rni_synthesis_batch where id = $1',
    [batchId],
  );
  if (existing.rows[0] === undefined) {
    const material = await buildFreshMaterial(input, batchId, activeRights, db);
    const conflicting = await db.query<{ id: string }>(
      `select id from rni_synthesis_batch
        where run_id = $1 and security_id = $2 and assessment_cutoff_at = $3
          and policy_version = $4 and rights_policy_version = $5`,
      [
        input.runId,
        input.securityId,
        material.request.convergenceArtifact.inputSnapshot.asOf,
        material.request.policyVersion,
        material.request.rightsPolicyVersion,
      ],
    );
    if (conflicting.rows[0] !== undefined) {
      fail('exact synthesis intent already belongs to a different idempotency identity');
    }
    await insertPreparation(input, batchId, material, db);
  }
  const prepared = await assertIntentMatchesPreparation(input, batchId, db);
  const accepted = await findAcceptedByBatch(batchId, activeRights, db);
  if (accepted !== null) return { status: 'accepted', stored: accepted };
  if (prepared.invocations.some(({ status }) => status !== 'prepared')) {
    fail('partially terminal preparation has no accepted publication');
  }
  await assertVerificationSnapshot(prepared, await scopedReader(prepared, activeRights, db));
  return { status: 'ready', preparationId: batchId, request: prepared.request };
}

type ArtifactRow = {
  readonly id: string;
  readonly run_id: string;
  readonly security_id: string;
  readonly batch_id: string;
  readonly convergence_artifact_id: string;
  readonly verifier_invocation_id: string;
  readonly verification_input_hash: string;
  readonly challenger_invocation_id: string;
  readonly challenger_input_hash: string;
  readonly calculation_code_version: RniCitedSynthesisArtifact['calculationCodeVersion'];
  readonly policy_version: string;
  readonly input_hash: string;
  readonly result_hash: string;
  readonly request_snapshot: RniCitedSynthesisRequest;
  readonly model_input_snapshot: RniCitedSynthesisArtifact['modelInputSnapshot'];
  readonly verification_output_snapshot: RniCitedSynthesisArtifact['verificationOutputSnapshot'];
  readonly challenger_output_snapshot: RniCitedSynthesisArtifact['challengerOutputSnapshot'];
  readonly result_snapshot: RniCitedSynthesisArtifact['result'];
  readonly statement_count: number;
};

function artifactFromRow(row: ArtifactRow): RniCitedSynthesisArtifact {
  return {
    calculationCodeVersion: row.calculation_code_version,
    policyVersion: row.policy_version,
    inputHash: row.input_hash,
    verificationInputHash: row.verification_input_hash,
    challengerInputHash: row.challenger_input_hash,
    resultHash: row.result_hash,
    requestSnapshot: row.request_snapshot,
    modelInputSnapshot: row.model_input_snapshot,
    verificationOutputSnapshot: row.verification_output_snapshot,
    challengerOutputSnapshot: row.challenger_output_snapshot,
    result: row.result_snapshot,
  };
}

async function findAcceptedByBatch(
  batchId: string,
  activeRights: RniActiveSynthesisRightsLookup,
  db: Queryable,
): Promise<RniStoredCitedSynthesis | null> {
  const { rows } = await db.query<ArtifactRow>(
    `select id, run_id, security_id, batch_id, convergence_artifact_id,
            verifier_invocation_id, verification_input_hash,
            challenger_invocation_id, challenger_input_hash,
            calculation_code_version, policy_version, input_hash, result_hash,
            request_snapshot, model_input_snapshot, verification_output_snapshot,
            challenger_output_snapshot, result_snapshot, statement_count
       from rni_cited_synthesis_artifact where batch_id = $1`,
    [batchId],
  );
  if (rows.length === 0) return null;
  if (rows.length !== 1) fail('multiple accepted artifacts for one preparation');
  return loadAcceptedRow(rows[0]!, activeRights, db);
}

async function loadAcceptedRow(
  row: ArtifactRow,
  activeRights: RniActiveSynthesisRightsLookup,
  db: Queryable,
): Promise<RniStoredCitedSynthesis> {
  const artifact = artifactFromRow(row);
  const prepared = await loadPreparedRequest(row.batch_id, db);
  const verificationInvocation = prepared.invocations.find(
    ({ stage }) => stage === 'verification',
  )!;
  const challengerInvocation = prepared.invocations.find(({ stage }) => stage === 'challenger')!;
  const challengerModelInput = record(challengerInvocation.prepared_snapshot.modelInput);
  const resultShape = record(artifact.result);
  const summaryShape = record(resultShape?.['summary']);
  const statementsShape = resultShape?.['statements'];
  if (
    summaryShape === null ||
    typeof summaryShape['id'] !== 'string' ||
    !Array.isArray(statementsShape)
  ) {
    fail('accepted artifact storage drift');
  }
  if (
    row.id !== summaryShape['id'] ||
    row.run_id !== prepared.batch.run_id ||
    row.security_id !== prepared.batch.security_id ||
    row.convergence_artifact_id !==
      prepared.invocations[0].prepared_snapshot.convergenceArtifactId ||
    row.verifier_invocation_id !== prepared.request.verificationInvocation.modelRunId ||
    row.challenger_invocation_id !== prepared.request.challengerInvocation.modelRunId ||
    row.statement_count !== artifact.result.statements.length ||
    !same(artifact.requestSnapshot, prepared.request) ||
    !same(artifact.modelInputSnapshot, verificationInvocation.prepared_snapshot.modelInput) ||
    challengerModelInput === null ||
    !same(challengerModelInput, {
      ...artifact.modelInputSnapshot,
      invocation: prepared.request.challengerInvocation,
      verification: artifact.verificationOutputSnapshot,
    }) ||
    artifact.inputHash !== canonicalHash(artifact.requestSnapshot) ||
    artifact.verificationInputHash !== canonicalHash(artifact.modelInputSnapshot) ||
    artifact.verificationInputHash !== verificationInvocation.input_hash ||
    verificationInvocation.input_hash !==
      canonicalHash(verificationInvocation.prepared_snapshot.modelInput) ||
    artifact.challengerInputHash !== challengerInvocation.input_hash ||
    challengerInvocation.input_hash !==
      canonicalHash(challengerInvocation.prepared_snapshot.modelInput) ||
    artifact.resultHash !== canonicalHash(artifact.result) ||
    artifact.policyVersion !== prepared.request.policyVersion ||
    artifact.calculationCodeVersion !== prepared.request.codeVersion
  ) {
    fail('accepted artifact storage drift');
  }
  const summaryResult = await db.query<{
    id: string;
    run_id: string;
    security_id: string;
    status: string;
    sections: unknown;
    created_at: Date | string;
    reddit_platform_slice_id: string;
    x_platform_slice_id: string;
  }>(
    `select id, run_id, security_id, status, sections, reddit_platform_slice_id, x_platform_slice_id,
            ${instantSql('created_at')} as created_at
       from rni_combined_summary where id = $1`,
    [row.id],
  );
  const summaryRow = summaryResult.rows[0];
  if (summaryRow === undefined) fail('accepted artifact lost its combined summary');
  if (
    summaryRow.reddit_platform_slice_id !==
      artifact.result.platformConclusions.reddit.runSourceSliceId ||
    summaryRow.x_platform_slice_id !== artifact.result.platformConclusions.x.runSourceSliceId
  ) {
    fail('combined summary platform lineage drift');
  }
  const summary = rniCombinedSummary.parse({
    id: summaryRow.id,
    runId: summaryRow.run_id,
    securityId: summaryRow.security_id,
    status: summaryRow.status,
    sections: summaryRow.sections,
    createdAt: iso(summaryRow.created_at),
  });
  if (!same(summary, artifact.result.summary)) fail('combined summary storage drift');

  const assessmentResult = await db.query<{
    claim_id: string;
    verdict: RniClaimAssessment['verdict'];
    supporting_citation_ids: string[];
    contradicting_citation_ids: string[];
    assessment_hash: string;
    run_id: string;
    security_id: string;
    assessment_cutoff_at: string;
    policy_version: string;
    rights_policy_version: string;
    verifier_invocation_id: string;
    created_at: string;
  }>(
    `select claim_id, verdict, supporting_citation_ids, contradicting_citation_ids,
            assessment_hash, run_id, security_id,
            ${instantSql('assessment_cutoff_at')} as assessment_cutoff_at,
            policy_version, rights_policy_version, verifier_invocation_id,
            ${instantSql('created_at')} as created_at from rni_catalyst_assessment
      where batch_id = $1 order by claim_id`,
    [row.batch_id],
  );
  const assessments = assessmentResult.rows.map((assessment) => ({
    claimId: assessment.claim_id,
    verdict: assessment.verdict,
    supportingCitationIds: assessment.supporting_citation_ids,
    contradictingCitationIds: assessment.contradicting_citation_ids,
  }));
  if (
    assessmentResult.rows.some(
      (assessment, index) =>
        assessment.assessment_hash !== canonicalHash(assessments[index]) ||
        assessment.run_id !== prepared.batch.run_id ||
        assessment.security_id !== prepared.batch.security_id ||
        iso(assessment.assessment_cutoff_at) !== iso(prepared.batch.assessment_cutoff_at) ||
        assessment.policy_version !== prepared.batch.policy_version ||
        assessment.rights_policy_version !== prepared.batch.rights_policy_version ||
        assessment.verifier_invocation_id !== verificationInvocation.id ||
        iso(assessment.created_at) !== iso(artifact.result.summary.createdAt),
    ) ||
    !same(assessments, artifact.verificationOutputSnapshot)
  ) {
    fail('catalyst assessment storage drift');
  }
  const challengerResult = await db.query<{
    verdict: RniCitedSynthesisArtifact['challengerOutputSnapshot']['verdict'];
    challenged_claim_id: string | null;
    citation_ids: string[];
    selection_hash: string;
    challenger_invocation_id: string;
    created_at: string;
  }>(
    `select verdict, challenged_claim_id, citation_ids, selection_hash, challenger_invocation_id,
            ${instantSql('created_at')} as created_at
       from rni_challenger_selection where batch_id = $1`,
    [row.batch_id],
  );
  const challengerRow = challengerResult.rows[0];
  if (challengerRow === undefined) fail('accepted artifact lost its challenger selection');
  const challenger = {
    verdict: challengerRow.verdict,
    challengedClaimId: challengerRow.challenged_claim_id,
    citationIds: challengerRow.citation_ids,
  };
  if (
    challengerRow.selection_hash !== canonicalHash(challenger) ||
    challengerResult.rows.length !== 1 ||
    challengerRow.challenger_invocation_id !== challengerInvocation.id ||
    iso(challengerRow.created_at) !== iso(artifact.result.summary.createdAt) ||
    !same(challenger, artifact.challengerOutputSnapshot)
  ) {
    fail('challenger selection storage drift');
  }
  const statementResult = await db.query<{
    id: string;
    ordinal: number;
    heading: RniCitedSynthesisArtifact['result']['statements'][number]['heading'];
    section_status: string;
    origin: RniCitedSynthesisArtifact['result']['statements'][number]['origin'];
    statement_text: string;
    citation_ids: string[];
  }>(
    `select id, ordinal, heading, section_status, origin, statement_text, citation_ids
       from rni_publication_statement where synthesis_id = $1 order by ordinal`,
    [row.id],
  );
  const statements = statementResult.rows.map((statement, ordinal) => {
    if (statement.ordinal !== ordinal) fail('publication statement order drift');
    if (
      statement.section_status !==
      summary.sections.find(({ heading }) => heading === statement.heading)?.status
    ) {
      fail('publication statement section-status drift');
    }
    return {
      heading: statement.heading,
      origin: statement.origin,
      text: statement.statement_text,
      citationIds: statement.citation_ids,
    };
  });
  if (!same(statements, artifact.result.statements)) fail('publication statement storage drift');
  const storedRoles = await db.query<StoredRoleRow>(
    `select id, target_claim_id, citation_id, platform, evidence_role
       from rni_synthesis_citation_role where batch_id = $1`,
    [row.batch_id],
  );
  const catalystClaims = publishedCatalystClaims(artifact);
  let catalystIndex = 0;
  for (const statement of statementResult.rows) {
    const statementValue = {
      heading: statement.heading,
      origin: statement.origin,
      text: statement.statement_text,
      citationIds: statement.citation_ids,
    };
    const targetClaimId =
      statement.origin === 'corroborated_catalyst' || statement.origin === 'challenged_catalyst'
        ? catalystClaims[catalystIndex++]!
        : null;
    const edgeResult = await db.query<{
      citation_ordinal: number;
      citation_id: string;
      citation_role_id: string;
      synthesis_id: string;
      batch_id: string;
    }>(
      `select citation_ordinal, citation_id, citation_role_id, synthesis_id, batch_id
         from rni_publication_statement_citation where statement_id = $1
         order by citation_ordinal`,
      [statement.id],
    );
    if (
      edgeResult.rows.some(
        (edge, ordinal) =>
          edge.citation_ordinal !== ordinal ||
          edge.synthesis_id !== row.id ||
          edge.batch_id !== row.batch_id ||
          edge.citation_role_id !==
            roleForStatement(statementValue, edge.citation_id, storedRoles.rows, targetClaimId).id,
      ) ||
      !same(
        edgeResult.rows.map(({ citation_id }) => citation_id),
        statement.citation_ids,
      )
    ) {
      fail('publication citation-edge storage drift');
    }
  }
  for (const invocation of prepared.invocations) {
    const expected = expectedTerminal(artifact, invocation.stage);
    if (
      invocation.status !== expected.status ||
      invocation.output_hash !== expected.outputHash ||
      !same(invocation.terminal_metadata, expected.metadata) ||
      invocation.completed_at === null ||
      iso(invocation.completed_at) !== iso(artifact.result.summary.createdAt)
    ) {
      fail('terminal model invocation storage drift');
    }
  }
  const replayed = await replayCitedSynthesis(
    artifact,
    await scopedReader(prepared, activeRights, db),
  );
  if (!same(replayed, artifact)) fail('accepted artifact replay drift');
  return { artifact, artifactHash: canonicalHash(artifact) };
}

async function loadAccepted(
  summaryId: string,
  activeRights: RniActiveSynthesisRightsLookup,
  db: Queryable,
): Promise<RniStoredCitedSynthesis> {
  if (!UUID_PATTERN.test(summaryId)) fail('invalid summary identity');
  const { rows } = await db.query<ArtifactRow>(
    `select id, run_id, security_id, batch_id, convergence_artifact_id,
            verifier_invocation_id, verification_input_hash,
            challenger_invocation_id, challenger_input_hash,
            calculation_code_version, policy_version, input_hash, result_hash,
            request_snapshot, model_input_snapshot, verification_output_snapshot,
            challenger_output_snapshot, result_snapshot, statement_count
       from rni_cited_synthesis_artifact where id = $1`,
    [summaryId],
  );
  const row = rows[0];
  if (row === undefined) fail('accepted synthesis not found');
  return loadAcceptedRow(row, activeRights, db);
}

type StoredRoleRow = {
  readonly id: string;
  readonly target_claim_id: string | null;
  readonly citation_id: string;
  readonly platform: RniPlatform;
  readonly evidence_role: RniCitationPublicationLineage['evidenceRole'];
};

function roleForStatement(
  statement: RniCitedSynthesisArtifact['result']['statements'][number],
  citationId: string,
  roles: readonly StoredRoleRow[],
  targetClaimId: string | null,
): StoredRoleRow {
  const candidates = roles.filter(({ citation_id }) => citation_id === citationId);
  const platform =
    statement.heading === 'Reddit sentiment'
      ? 'reddit'
      : statement.heading === 'X sentiment'
        ? 'x'
        : null;
  const selected =
    statement.origin === 'platform_conclusion' || statement.origin === 'cross_source_fact'
      ? candidates.find(
          (role) =>
            role.target_claim_id === null && (platform === null || role.platform === platform),
        )
      : candidates.find((role) => role.target_claim_id === targetClaimId && targetClaimId !== null);
  if (selected === undefined) fail('statement citation lacks an exact persisted role');
  return selected;
}

function publishedCatalystClaims(artifact: RniCitedSynthesisArtifact): readonly string[] {
  return artifact.verificationOutputSnapshot
    .filter(
      (assessment) =>
        assessment.verdict === 'supported' ||
        ((assessment.verdict === 'contradicted' || assessment.verdict === 'contested') &&
          artifact.challengerOutputSnapshot.challengedClaimId === assessment.claimId),
    )
    .map(({ claimId }) => claimId);
}

async function commitAccepted(
  input: { readonly preparationId: string; readonly artifact: RniCitedSynthesisArtifact },
  activeRights: RniActiveSynthesisRightsLookup,
  db: Queryable,
): Promise<RniCitedSynthesisCommitResult> {
  if (!UUID_PATTERN.test(input.preparationId)) fail('invalid preparation identity');
  await lock(`rni-cited-synthesis:${input.preparationId}`, db);
  const existing = await findAcceptedByBatch(input.preparationId, activeRights, db);
  if (existing !== null) {
    if (!same(existing.artifact, input.artifact)) {
      fail('accepted preparation replayed with different artifact bytes');
    }
    return {
      disposition: 'duplicate',
      summaryId: existing.artifact.result.summary.id,
      artifactHash: existing.artifactHash,
    };
  }
  const prepared = await loadPreparedRequest(input.preparationId, db);
  const artifact = input.artifact;
  if (
    !same(artifact.requestSnapshot, prepared.request) ||
    artifact.inputHash !== canonicalHash(artifact.requestSnapshot) ||
    artifact.verificationInputHash !== canonicalHash(artifact.modelInputSnapshot) ||
    artifact.verificationInputHash !==
      prepared.invocations.find(({ stage }) => stage === 'verification')!.input_hash ||
    artifact.resultHash !== canonicalHash(artifact.result) ||
    artifact.result.summary.id !== prepared.request.summaryId ||
    artifact.result.summary.runId !== prepared.batch.run_id ||
    artifact.result.summary.securityId !== prepared.batch.security_id ||
    artifact.calculationCodeVersion !== RNI_CITED_SYNTHESIS_CODE_VERSION ||
    artifact.policyVersion !== prepared.batch.policy_version
  ) {
    fail('crossed accepted artifact identity');
  }
  const reader = await scopedReader(prepared, activeRights, db);
  const replayed = await replayCitedSynthesis(artifact, reader);
  if (
    !same(replayed, artifact) ||
    !same(artifact.modelInputSnapshot, prepared.invocations[0].prepared_snapshot.modelInput)
  ) {
    fail('accepted artifact differs from validated batch replay');
  }
  const challengerInput: RniChallengerModelInput = {
    ...artifact.modelInputSnapshot,
    invocation: prepared.request.challengerInvocation,
    verification: artifact.verificationOutputSnapshot,
  };
  const challengerInvocation = prepared.invocations[1];
  if (expectedTerminal(artifact, 'challenger').status === 'skipped') {
    await hydrateChallenger(challengerInvocation, challengerInput, db);
  } else if (
    challengerInvocation.input_hash === null ||
    !same(challengerInvocation.prepared_snapshot.modelInput, challengerInput)
  ) {
    fail('challenger dispatch requires prior exact input hydration');
  }
  if (artifact.challengerInputHash !== canonicalHash(challengerInput))
    fail('challenger input hash drift');
  const completedAt = artifact.result.summary.createdAt;
  for (const invocation of prepared.invocations) {
    const expected = expectedTerminal(artifact, invocation.stage);
    const result = await db.query(
      `update rni_synthesis_model_invocation
          set status = $5, output_hash = $2,
              terminal_metadata = $3::jsonb, completed_at = $4
        where id = $1 and status = 'prepared'`,
      [
        invocation.id,
        expected.outputHash,
        JSON.stringify(expected.metadata),
        completedAt,
        expected.status,
      ],
    );
    if (result.rowCount !== 1) fail('model invocation was not durably prepared');
  }
  for (const assessment of artifact.verificationOutputSnapshot) {
    await db.query(
      `insert into rni_catalyst_assessment (
         batch_id, run_id, security_id, assessment_cutoff_at, policy_version,
         rights_policy_version, claim_id, verifier_invocation_id, verdict,
         supporting_citation_ids, contradicting_citation_ids, assessment_hash, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13)`,
      [
        prepared.batch.id,
        prepared.batch.run_id,
        prepared.batch.security_id,
        iso(prepared.batch.assessment_cutoff_at),
        prepared.batch.policy_version,
        prepared.batch.rights_policy_version,
        assessment.claimId,
        prepared.request.verificationInvocation.modelRunId,
        assessment.verdict,
        JSON.stringify(assessment.supportingCitationIds),
        JSON.stringify(assessment.contradictingCitationIds),
        canonicalHash(assessment),
        completedAt,
      ],
    );
  }
  const challenger = artifact.challengerOutputSnapshot;
  await db.query(
    `insert into rni_challenger_selection (
       batch_id, challenger_invocation_id, verdict, challenged_claim_id,
       citation_ids, selection_hash, created_at
     ) values ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [
      prepared.batch.id,
      prepared.request.challengerInvocation.modelRunId,
      challenger.verdict,
      challenger.challengedClaimId,
      JSON.stringify(challenger.citationIds),
      canonicalHash(challenger),
      completedAt,
    ],
  );
  const summary = rniCombinedSummary.parse(artifact.result.summary);
  await db.query(
    `insert into rni_combined_summary (
       id, run_id, security_id, reddit_platform_slice_id, x_platform_slice_id,
       status, sections, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [
      summary.id,
      summary.runId,
      summary.securityId,
      artifact.result.platformConclusions.reddit.runSourceSliceId,
      artifact.result.platformConclusions.x.runSourceSliceId,
      summary.status,
      JSON.stringify(summary.sections),
      summary.createdAt,
    ],
  );
  const convergence = await loadConvergence(
    prepared.batch.run_id,
    prepared.batch.security_id,
    canonicalHash(prepared.request.convergenceArtifact),
    db,
  );
  await db.query(
    `insert into rni_cited_synthesis_artifact (
       id, run_id, security_id, batch_id, convergence_artifact_id,
       verifier_invocation_id, verification_input_hash,
       challenger_invocation_id, challenger_input_hash,
       calculation_code_version, policy_version, input_hash, result_hash,
       request_snapshot, model_input_snapshot, verification_output_snapshot,
       challenger_output_snapshot, result_snapshot, statement_count, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               $14::jsonb, $15::jsonb, $16::jsonb, $17::jsonb, $18::jsonb, $19, $20)`,
    [
      summary.id,
      summary.runId,
      summary.securityId,
      prepared.batch.id,
      convergence.row.id,
      prepared.request.verificationInvocation.modelRunId,
      artifact.verificationInputHash,
      prepared.request.challengerInvocation.modelRunId,
      artifact.challengerInputHash,
      artifact.calculationCodeVersion,
      artifact.policyVersion,
      artifact.inputHash,
      artifact.resultHash,
      JSON.stringify(artifact.requestSnapshot),
      JSON.stringify(artifact.modelInputSnapshot),
      JSON.stringify(artifact.verificationOutputSnapshot),
      JSON.stringify(artifact.challengerOutputSnapshot),
      JSON.stringify(artifact.result),
      artifact.result.statements.length,
      summary.createdAt,
    ],
  );
  const roleResult = await db.query<StoredRoleRow>(
    `select id, target_claim_id, citation_id, platform, evidence_role
       from rni_synthesis_citation_role where batch_id = $1`,
    [prepared.batch.id],
  );
  const statusByHeading = new Map(
    summary.sections.map((section) => [section.heading, section.status]),
  );
  const catalystClaims = publishedCatalystClaims(artifact);
  let catalystIndex = 0;
  for (const [ordinal, statement] of artifact.result.statements.entries()) {
    const targetClaimId =
      statement.origin === 'corroborated_catalyst' || statement.origin === 'challenged_catalyst'
        ? catalystClaims[catalystIndex++]!
        : null;
    if (statement.origin !== 'coverage_disclosure' && statement.citationIds.length === 0) {
      fail('non-coverage publication statement lacks citations');
    }
    const statementId = randomUUID();
    await db.query(
      `insert into rni_publication_statement (
         id, synthesis_id, batch_id, ordinal, heading, section_status, origin,
         statement_text, citation_ids, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
      [
        statementId,
        summary.id,
        prepared.batch.id,
        ordinal,
        statement.heading,
        statusByHeading.get(statement.heading),
        statement.origin,
        statement.text,
        JSON.stringify(statement.citationIds),
        summary.createdAt,
      ],
    );
    for (const [citationOrdinal, citationId] of statement.citationIds.entries()) {
      const role = roleForStatement(statement, citationId, roleResult.rows, targetClaimId);
      await db.query(
        `insert into rni_publication_statement_citation (
           statement_id, synthesis_id, batch_id, citation_ordinal,
           citation_role_id, citation_id, created_at
         ) values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          statementId,
          summary.id,
          prepared.batch.id,
          citationOrdinal,
          role.id,
          citationId,
          summary.createdAt,
        ],
      );
    }
  }
  const stored = await findAcceptedByBatch(prepared.batch.id, activeRights, db);
  if (stored === null || !same(stored.artifact, artifact)) {
    fail('atomic commit did not reconstruct the accepted artifact');
  }
  return {
    disposition: 'inserted',
    summaryId: stored.artifact.result.summary.id,
    artifactHash: stored.artifactHash,
  };
}

/**
 * One immutable trusted intent per adapter. IDs obtained from another batch cannot select or
 * change this instance's scope. Server composition supplies current rights authority; evidence
 * rows never authorize themselves. A mutable future authority must acquire its row lock using
 * the Queryable passed to the lookup, retaining that lock through this transaction's commit.
 */
export class PostgresRniCitedSynthesisPersistence implements RniCitedSynthesisPersistencePort {
  private readonly intent: RniCitedSynthesisPreparationRequest;
  private readonly batchId: string;

  constructor(
    intent: RniCitedSynthesisPreparationRequest,
    private readonly activeRights: RniActiveSynthesisRightsLookup,
    private readonly pool: pg.Pool = getPool(),
  ) {
    assertIntent(intent);
    this.intent = Object.freeze({ ...intent, createdAt: iso(intent.createdAt) });
    this.batchId = deterministicUuid(`idempotency:${intent.idempotencyKey}`);
  }

  private assertScope(input: RniCitedSynthesisPreparationRequest): void {
    assertIntent(input);
    if (!same(input, this.intent)) fail('idempotency identity reused with different intent');
  }

  private async reader(db: Queryable): Promise<PostgresRniSynthesisEvidenceReader> {
    const prepared = await assertIntentMatchesPreparation(this.intent, this.batchId, db);
    return scopedReader(prepared, this.activeRights, db);
  }

  async prepare(input: RniCitedSynthesisPreparationRequest): Promise<RniCitedSynthesisPreparation> {
    this.assertScope(input);
    return withTransaction((tx) => prepare(input, this.activeRights, tx), this.pool);
  }

  /** Caller must already own a transaction; coordinator fences its combined lease in that tx. */
  async commitAcceptedInTransaction(
    input: {
      readonly preparationId: string;
      readonly artifact: RniCitedSynthesisArtifact;
    },
    tx: Queryable,
  ): Promise<RniCitedSynthesisCommitResult> {
    if (input.preparationId !== this.batchId) fail('crossed preparation scope');
    await lock(`rni-cited-synthesis:${this.batchId}`, tx);
    await assertIntentMatchesPreparation(this.intent, this.batchId, tx);
    return commitAccepted(input, this.activeRights, tx);
  }

  commitAccepted(input: {
    readonly preparationId: string;
    readonly artifact: RniCitedSynthesisArtifact;
  }): Promise<RniCitedSynthesisCommitResult> {
    return withTransaction((tx) => this.commitAcceptedInTransaction(input, tx), this.pool);
  }

  /** Same transaction seam for coordinator replay/receipt validation. */
  async loadAcceptedInTransaction(
    summaryId: string,
    tx: Queryable,
  ): Promise<RniStoredCitedSynthesis> {
    const prepared = await assertIntentMatchesPreparation(this.intent, this.batchId, tx);
    if (summaryId !== prepared.request.summaryId) fail('crossed summary scope');
    return loadAccepted(summaryId, this.activeRights, tx);
  }

  loadAccepted(summaryId: string): Promise<RniStoredCitedSynthesis> {
    return withTransaction((tx) => this.loadAcceptedInTransaction(summaryId, tx), this.pool);
  }

  /**
   * Hydrate once before a challenger request reaches the governed I10 reservation. E08 validates
   * the verifier's selected subsets against fresh batch-scoped evidence; the intercept below
   * stops at the deterministic challenger boundary and never calls a provider.
   */
  hydrateChallengerInput(input: RniChallengerModelInput): Promise<void> {
    return withTransaction(async (tx) => {
      await lock(`rni-cited-synthesis:${this.batchId}`, tx);
      const prepared = await assertIntentMatchesPreparation(this.intent, this.batchId, tx);
      if (prepared.invocations.some(({ status }) => status !== 'prepared')) {
        fail('cannot hydrate a terminal preparation');
      }
      const reader = await scopedReader(prepared, this.activeRights, tx);
      await assertVerificationSnapshot(prepared, reader);
      const boundaryReached = new Error('validated challenger boundary');
      let expected: RniChallengerModelInput | undefined;
      try {
        await synthesizeCitedNarrative(
          prepared.request,
          reader,
          { verify: async () => ({ assessments: input.verification }) },
          {
            challenge: async (actual) => {
              expected = actual;
              throw boundaryReached;
            },
          },
        );
      } catch (error) {
        if (error !== boundaryReached) throw error;
      }
      if (expected === undefined || !same(expected, input)) {
        fail('challenger input differs from validated E08 selection or dispatch is policy-skipped');
      }
      await hydrateChallenger(prepared.invocations[1], expected, tx);
    }, this.pool);
  }

  /** Wrap I10's challenger port, so hydration commits before reservation or provider access. */
  wrapChallenger(downstream: RniChallengerInferencePort): RniChallengerInferencePort {
    return {
      challenge: async (input) => {
        await this.hydrateChallengerInput(input);
        return downstream.challenge(input);
      },
    };
  }

  getCitation(citationId: string): Promise<RniCitation> {
    return withTransaction(
      async (tx) => (await this.reader(tx)).getCitation(citationId),
      this.pool,
    );
  }

  getEvidence(sourceItemId: string): Promise<RniSourceItem> {
    return withTransaction(
      async (tx) => (await this.reader(tx)).getEvidence(sourceItemId),
      this.pool,
    );
  }

  getCitationLineage(
    claimId: string | null,
    citationId: string,
  ): Promise<RniCitationPublicationLineage | null> {
    return withTransaction(
      async (tx) => (await this.reader(tx)).getCitationLineage(claimId, citationId),
      this.pool,
    );
  }

  getSynthesisClaim(claimId: string): Promise<RniSynthesisClaim> {
    return withTransaction(
      async (tx) => (await this.reader(tx)).getSynthesisClaim(claimId),
      this.pool,
    );
  }

  getModelInvocation(modelRunId: string): Promise<RniInferenceInvocationDescriptor> {
    return withTransaction(
      async (tx) => (await this.reader(tx)).getModelInvocation(modelRunId),
      this.pool,
    );
  }

  getActiveRightsPolicyVersion(runId: string): Promise<string> {
    return withTransaction(
      async (tx) => (await this.reader(tx)).getActiveRightsPolicyVersion(runId),
      this.pool,
    );
  }
}
