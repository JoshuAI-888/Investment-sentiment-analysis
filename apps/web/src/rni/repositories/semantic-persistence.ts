import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';

import type {
  RniSemanticCommitRequest,
  RniSemanticCommitResult,
  RniSemanticPersistencePort,
} from '../composition';
import type {
  RniClassifiedClaim,
  RniClassifiedTheme,
  RniCitationProposal,
  RniSecurityNoiseAssessment,
} from '../observations';
import { getPool, withTransaction, type Queryable } from '../../repositories/client';
import { persistRniClaimCitation, persistRniObservationTheme } from './claims-narratives';
import { persistRniSecurityObservation } from './observations';

type ClaimRow = {
  readonly id: string;
  readonly source_item_id: string;
  readonly security_id: string;
  readonly observation_id: string;
  readonly dimension: string;
  readonly claim_text: string;
  readonly claim_type: string;
  readonly epistemic_status: string;
  readonly support_start: number;
  readonly support_end: number;
  readonly extractor_run_id: string;
  readonly input_hash: string;
  readonly created_at: Date | string;
};

const CLAIM_COLUMNS = `
  id, source_item_id, security_id, observation_id, dimension, claim_text, claim_type,
  epistemic_status, support_start, support_end, extractor_run_id, input_hash, created_at
`;

function fail(message: string): never {
  throw new Error(`RNI semantic persistence rejected ${message}`);
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function decimal(value: string | null): string | null {
  if (value === null) return null;
  const [integer = '0', fraction = ''] = value.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  const normalizedInteger = integer === '-0' && trimmed === '' ? '0' : integer;
  return trimmed === '' ? normalizedInteger : `${normalizedInteger}.${trimmed}`;
}

function storageDecimal(value: string | null): string | null {
  if (value === null) return null;
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integer = '0', fraction = ''] = unsigned.split('.');
  const digits = fraction.padEnd(5, '0');
  let scaled = BigInt(integer) * 10_000n + BigInt(digits.slice(0, 4));
  if (digits[4]! >= '5') scaled += 1n;
  if (negative) scaled = -scaled;
  const sign = scaled < 0n ? '-' : '';
  const absolute = scaled < 0n ? -scaled : scaled;
  const whole = absolute / 10_000n;
  const remainder = (absolute % 10_000n).toString().padStart(4, '0').replace(/0+$/, '');
  return remainder === '' ? `${sign}${whole}` : `${sign}${whole}.${remainder}`;
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

function claimKey(claim: RniClassifiedClaim): string {
  return canonical([
    claim.sourceItemId,
    claim.securityId,
    claim.dimension,
    claim.claimText,
    claim.claimType,
    claim.epistemicStatus,
    claim.startOffset,
    claim.endOffset,
    claim.evidenceText,
  ]);
}

function citationKey(citation: RniCitationProposal): string {
  return canonical([
    citation.sourceItemId,
    citation.securityId,
    citation.dimension,
    citation.claimText,
    citation.claimType,
    citation.epistemicStatus,
    citation.startOffset,
    citation.endOffset,
    citation.evidenceText,
  ]);
}

function claimInputHash(
  observationInputHash: string,
  semanticBundle: string,
  claim: RniClassifiedClaim,
): string {
  return createHash('sha256')
    .update(
      canonical(['rni-e05-claim-v2', observationInputHash, semanticBundle, claimKey(claim)]),
    )
    .digest('hex');
}

function semanticBundle(
  classification: RniSemanticCommitRequest['classification'],
  securityId: string,
): string {
  const claims = classification.claims
    .filter((value) => value.securityId === securityId)
    .sort((left, right) => claimKey(left).localeCompare(claimKey(right)));
  const citations = classification.citationProposals
    .filter((value) => value.securityId === securityId)
    .sort((left, right) => citationKey(left).localeCompare(citationKey(right)));
  const themes = classification.themes
    .filter((value) => value.securityId === securityId)
    .sort((left, right) => canonical(left).localeCompare(canonical(right)));
  const noise = classification.noise.find((value) => value.securityId === securityId);
  return canonical({ claims, citations, themes, noise });
}

function semanticOutputHash(
  classification: RniSemanticCommitRequest['classification'],
  securityId: string,
): string {
  const observation = classification.observations.find(
    (value) => value.securityId === securityId,
  );
  if (observation === undefined) fail('missing semantic-output observation');
  return createHash('sha256')
    .update(
      canonical({
        observation,
        inputHash: classification.inputHashesBySecurity[securityId],
        semantic: semanticBundle(classification, securityId),
      }),
    )
    .digest('hex');
}

function assertUnique<T>(values: readonly T[], key: (value: T) => string, label: string): void {
  const keys = values.map(key);
  if (new Set(keys).size !== keys.length) fail(`duplicate ${label}`);
}

function observationContent(observation: RniSemanticCommitRequest['classification']['observations'][number]) {
  return {
    id: observation.id,
    sourceItemId: observation.sourceItemId,
    securityId: observation.securityId,
    stance: observation.stance,
    stanceScore: storageDecimal(observation.stanceScore),
    relevance: storageDecimal(observation.relevance),
    claimSummary: observation.claimSummary,
    timeHorizon: observation.timeHorizon,
    dimensions: observation.dimensions.map((assignment) => ({
      ...assignment,
      score: decimal(assignment.score),
    })),
    classifierRunId: observation.classifierRunId,
    promptVersion: observation.promptVersion,
    modelId: observation.modelId,
    inputHash: observation.inputHash,
    createdAt: iso(observation.createdAt),
  };
}

function claimContent(row: ClaimRow) {
  return {
    sourceItemId: row.source_item_id,
    securityId: row.security_id,
    observationId: row.observation_id,
    dimension: row.dimension,
    claimText: row.claim_text,
    claimType: row.claim_type,
    epistemicStatus: row.epistemic_status,
    supportStart: row.support_start,
    supportEnd: row.support_end,
    extractorRunId: row.extractor_run_id,
    inputHash: row.input_hash,
    createdAt: iso(row.created_at),
  };
}

async function insertClaim(
  claim: RniClassifiedClaim,
  observationId: string,
  extractorRunId: string,
  observationInputHash: string,
  bundle: string,
  createdAt: string,
  db: Queryable,
): Promise<{ readonly id: string; readonly inserted: boolean }> {
  const inputHash = claimInputHash(observationInputHash, bundle, claim);
  const expected = {
    sourceItemId: claim.sourceItemId,
    securityId: claim.securityId,
    observationId,
    dimension: claim.dimension,
    claimText: claim.claimText,
    claimType: claim.claimType,
    epistemicStatus: claim.epistemicStatus,
    supportStart: claim.startOffset,
    supportEnd: claim.endOffset,
    extractorRunId,
    inputHash,
    createdAt: iso(createdAt),
  };
  const { rows } = await db.query<ClaimRow>(
    `insert into rni_evidence_claim (
       id, source_item_id, security_id, observation_id, dimension, claim_text, claim_type,
       epistemic_status, support_start, support_end, extractor_run_id, input_hash, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     on conflict (source_item_id, security_id, input_hash) do nothing
     returning ${CLAIM_COLUMNS}`,
    [
      randomUUID(),
      expected.sourceItemId,
      expected.securityId,
      expected.observationId,
      expected.dimension,
      expected.claimText,
      expected.claimType,
      expected.epistemicStatus,
      expected.supportStart,
      expected.supportEnd,
      expected.extractorRunId,
      expected.inputHash,
      expected.createdAt,
    ],
  );
  let row = rows[0];
  const inserted = row !== undefined;
  if (row === undefined) {
    const existing = await db.query<ClaimRow>(
      `select ${CLAIM_COLUMNS} from rni_evidence_claim
        where source_item_id = $1 and security_id = $2 and input_hash = $3`,
      [expected.sourceItemId, expected.securityId, expected.inputHash],
    );
    row = existing.rows[0];
  }
  if (row === undefined) fail('claim identity conflict without a durable row');
  if (canonical(claimContent(row)) !== canonical(expected)) fail('claim identity reused with different content');
  return { id: row.id, inserted };
}

async function insertRunObservation(
  runId: string,
  observationId: string,
  sourceItemId: string,
  securityId: string,
  outputHash: string,
  createdAt: string,
  db: Queryable,
): Promise<boolean> {
  const { rows } = await db.query<{
    observation_id: string;
    source_item_id: string;
    security_id: string;
    semantic_output_hash: string;
  }>(
    `insert into rni_run_observation (
       run_id, observation_id, source_item_id, security_id, semantic_output_hash, created_at
     ) values ($1, $2, $3, $4, $5, $6)
     on conflict (run_id, observation_id) do nothing
     returning observation_id, source_item_id, security_id, semantic_output_hash`,
    [runId, observationId, sourceItemId, securityId, outputHash, createdAt],
  );
  if (rows[0] !== undefined) return true;
  const existing = await db.query<{
    observation_id: string;
    source_item_id: string;
    security_id: string;
    semantic_output_hash: string;
  }>(
    `select observation_id, source_item_id, security_id, semantic_output_hash
       from rni_run_observation
      where run_id = $1 and observation_id = $2`,
    [runId, observationId],
  );
  const row = existing.rows[0];
  if (row === undefined) fail('run-observation identity conflict without a durable row');
  if (
    row.source_item_id !== sourceItemId ||
    row.security_id !== securityId ||
    row.semantic_output_hash !== outputHash
  ) {
    fail('run-observation identity reused with different lineage');
  }
  return false;
}

function noiseContent(noise: RniSecurityNoiseAssessment) {
  return {
    sourceItemId: noise.sourceItemId,
    securityId: noise.securityId,
    supportStart: noise.startOffset,
    supportEnd: noise.endOffset,
    evidenceText: noise.evidenceText,
    isSarcastic: noise.isSarcastic,
    sarcasmProbability: storageDecimal(noise.sarcasmProbability),
    isMeme: noise.isMeme,
    memeProbability: storageDecimal(noise.memeProbability),
    isSpam: noise.isSpam,
    spamProbability: storageDecimal(noise.spamProbability),
    informationValue: storageDecimal(noise.informationValue),
    assertionStrength: storageDecimal(noise.assertionStrength),
    evidenceQuality: storageDecimal(noise.evidenceQuality),
    uncertainty: storageDecimal(noise.uncertainty),
    exclusionReason: noise.exclusionReason,
  };
}

async function insertNoise(
  observationId: string,
  noise: RniSecurityNoiseAssessment,
  createdAt: string,
  db: Queryable,
): Promise<boolean> {
  const expected = noiseContent(noise);
  const { rows } = await db.query<{ observation_id: string }>(
    `insert into rni_observation_semantic_quality (
       observation_id, source_item_id, security_id, support_start, support_end, evidence_text,
       is_sarcastic, sarcasm_probability, is_meme, meme_probability, is_spam, spam_probability,
       information_value, assertion_strength, evidence_quality, uncertainty, exclusion_reason,
       created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     on conflict (observation_id) do nothing returning observation_id`,
    [
      observationId,
      noise.sourceItemId,
      noise.securityId,
      noise.startOffset,
      noise.endOffset,
      noise.evidenceText,
      noise.isSarcastic,
      noise.sarcasmProbability,
      noise.isMeme,
      noise.memeProbability,
      noise.isSpam,
      noise.spamProbability,
      noise.informationValue,
      noise.assertionStrength,
      noise.evidenceQuality,
      noise.uncertainty,
      noise.exclusionReason,
      createdAt,
    ],
  );
  if (rows[0] !== undefined) return true;
  const existing = await db.query<Record<string, unknown>>(
    `select source_item_id as "sourceItemId", security_id as "securityId",
            support_start as "supportStart", support_end as "supportEnd", evidence_text as "evidenceText",
            is_sarcastic as "isSarcastic", sarcasm_probability as "sarcasmProbability",
            is_meme as "isMeme", meme_probability as "memeProbability", is_spam as "isSpam",
            spam_probability as "spamProbability", information_value as "informationValue",
            assertion_strength as "assertionStrength", evidence_quality as "evidenceQuality",
            uncertainty, exclusion_reason as "exclusionReason"
       from rni_observation_semantic_quality where observation_id = $1`,
    [observationId],
  );
  const row = existing.rows[0];
  if (row === undefined) fail('semantic-quality conflict without a durable row');
  const normalized = {
    ...row,
    sarcasmProbability: decimal(String(row['sarcasmProbability'])),
    memeProbability: decimal(String(row['memeProbability'])),
    spamProbability: decimal(String(row['spamProbability'])),
    informationValue: decimal(String(row['informationValue'])),
    assertionStrength: decimal(String(row['assertionStrength'])),
    evidenceQuality: decimal(String(row['evidenceQuality'])),
    uncertainty: decimal(String(row['uncertainty'])),
  };
  if (canonical(normalized) !== canonical(expected)) fail('semantic-quality identity reused with different content');
  return false;
}

async function assertThemeDefinition(theme: RniClassifiedTheme, db: Queryable): Promise<void> {
  const { rows } = await db.query<{ taxonomy_version: string; stable_key: string }>(
    'select taxonomy_version, stable_key from rni_theme_definition where id = $1',
    [theme.themeDefinitionId],
  );
  const row = rows[0];
  if (row === undefined) fail('missing theme-definition lineage');
  if (row.taxonomy_version !== theme.taxonomyVersion || row.stable_key !== theme.stableKey) {
    fail('theme-definition identity reused with different taxonomy content');
  }
}

async function assertThemeAssignment(
  observationId: string,
  theme: RniClassifiedTheme,
  inserted: boolean,
  db: Queryable,
): Promise<void> {
  if (inserted) return;
  const { rows } = await db.query<{
    classification_confidence: string;
    theme_stance: string;
    theme_score: string | null;
  }>(
    `select classification_confidence, theme_stance, theme_score from rni_observation_theme
      where observation_id = $1 and theme_definition_id = $2`,
    [observationId, theme.themeDefinitionId],
  );
  const row = rows[0];
  if (
    row === undefined ||
    decimal(row.classification_confidence) !== storageDecimal(theme.classificationConfidence) ||
    row.theme_stance !== theme.stance ||
    decimal(row.theme_score) !== storageDecimal(theme.score)
  ) {
    fail('observation-theme identity reused with different content');
  }
}

async function assertExistingSemanticSet(
  input: RniSemanticCommitRequest,
  db: Queryable,
): Promise<void> {
  const { rows: memberships } = await db.query<{
    observation_id: string;
    security_id: string;
    semantic_output_hash: string;
  }>(
    `select observation_id, security_id, semantic_output_hash from rni_run_observation
      where run_id = $1 and source_item_id = $2 order by security_id, observation_id`,
    [input.runId, input.sourceItemId],
  );
  if (memberships.length === 0) return;

  const expectedMemberships = [...input.classification.observations]
    .sort((left, right) => left.securityId.localeCompare(right.securityId))
    .map(({ id: observation_id, securityId: security_id }) => ({
      observation_id,
      security_id,
      semantic_output_hash: semanticOutputHash(input.classification, security_id),
    }));
  if (canonical(memberships) !== canonical(expectedMemberships)) {
    fail('durable observation set differs from replay');
  }

  const expectedHashes = input.classification.claims
    .map((claim) => {
      const observation = input.classification.observations.find(
        ({ securityId }) => securityId === claim.securityId,
      );
      if (observation === undefined) fail('missing claim observation lineage');
      return claimInputHash(
        observation.inputHash,
        semanticBundle(input.classification, claim.securityId),
        claim,
      );
    })
    .sort();
  const { rows: storedClaims } = await db.query<{ input_hash: string }>(
    `select claim.input_hash
       from rni_evidence_claim claim
       join rni_run_observation membership on membership.observation_id = claim.observation_id
      where membership.run_id = $1 and membership.source_item_id = $2
      order by claim.input_hash`,
    [input.runId, input.sourceItemId],
  );
  if (canonical(storedClaims.map(({ input_hash }) => input_hash)) !== canonical(expectedHashes)) {
    fail('durable claim set differs from replay');
  }

  const expectedThemes = input.classification.themes
    .map(({ securityId, themeDefinitionId }) => `${securityId}:${themeDefinitionId}`)
    .sort();
  const { rows: storedThemes } = await db.query<{
    security_id: string;
    theme_definition_id: string;
  }>(
    `select membership.security_id, assignment.theme_definition_id
       from rni_observation_theme assignment
       join rni_run_observation membership on membership.observation_id = assignment.observation_id
      where membership.run_id = $1 and membership.source_item_id = $2
      order by membership.security_id, assignment.theme_definition_id`,
    [input.runId, input.sourceItemId],
  );
  const actualThemes = storedThemes.map(
    ({ security_id, theme_definition_id }) => `${security_id}:${theme_definition_id}`,
  );
  if (canonical(actualThemes) !== canonical(expectedThemes)) {
    fail('durable theme set differs from replay');
  }
}

function validateRequest(input: RniSemanticCommitRequest): void {
  const { classification } = input;
  const requiredDimensions = [
    'company_fundamentals',
    'market_trading',
    'catalyst_event',
    'retail_narrative',
  ];
  if (classification.observations.length === 0) fail('empty observation set');
  assertUnique(classification.observations, ({ securityId }) => securityId, 'observation security');
  assertUnique(classification.claims, claimKey, 'claim');
  assertUnique(classification.citationProposals, citationKey, 'citation proposal');
  assertUnique(classification.noise, ({ securityId }) => securityId, 'noise assessment');
  assertUnique(
    classification.themes,
    ({ securityId, themeDefinitionId }) => `${securityId}:${themeDefinitionId}`,
    'theme assignment',
  );

  const observationBySecurity = new Map(
    classification.observations.map((observation) => [observation.securityId, observation]),
  );
  const sourceBound = [
    ...classification.observations,
    ...classification.claims,
    ...classification.citationProposals,
    ...classification.themes,
    ...classification.noise,
  ];
  if (sourceBound.some(({ sourceItemId }) => sourceItemId !== input.sourceItemId)) {
    fail('crossed source binding');
  }
  for (const observation of classification.observations) {
    const dimensions = observation.dimensions.map(({ dimension }) => dimension).sort();
    if (
      dimensions.length !== requiredDimensions.length ||
      canonical(dimensions) !== canonical([...requiredDimensions].sort())
    ) {
      fail('observation must contain each frozen dimension exactly once');
    }
    if (classification.inputHashesBySecurity[observation.securityId] !== observation.inputHash) {
      fail('observation input-hash lineage mismatch');
    }
    if (classification.noise.filter(({ securityId }) => securityId === observation.securityId).length !== 1) {
      fail('missing per-security noise assessment');
    }
  }
  const observationSecurityIds = [...observationBySecurity.keys()].sort();
  const inputHashSecurityIds = Object.keys(classification.inputHashesBySecurity).sort();
  if (canonical(observationSecurityIds) !== canonical(inputHashSecurityIds)) {
    fail('input-hash security keys differ from the observation set');
  }
  for (const value of [
    ...classification.claims,
    ...classification.citationProposals,
    ...classification.themes,
    ...classification.noise,
  ]) {
    if (!observationBySecurity.has(value.securityId)) fail('missing per-security observation');
  }
  const citationKeys = new Set(classification.citationProposals.map(citationKey));
  if (
    citationKeys.size !== classification.claims.length ||
    classification.claims.some((claim) => !citationKeys.has(claimKey(claim)))
  ) {
    fail('missing claim citation proposal');
  }
}

async function commit(
  input: RniSemanticCommitRequest,
  db: Queryable,
): Promise<RniSemanticCommitResult> {
  validateRequest(input);
  await db.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `${input.runId}:${input.sourceItemId}`,
  ]);
  const source = await db.query<{ platform: string; original_url: string }>(
    'select platform, original_url from rni_source_item where id = $1',
    [input.sourceItemId],
  );
  if (source.rows[0] === undefined) fail('missing source lineage');
  const run = await db.query('select id from rni_run where id = $1', [input.runId]);
  if (run.rows[0] === undefined) fail('missing run lineage');

  const sortedObservations = [...input.classification.observations].sort((a, b) =>
    a.securityId.localeCompare(b.securityId),
  );
  await assertExistingSemanticSet(input, db);
  const observationIds: string[] = [];
  const claimIds: string[] = [];
  const citationIds: string[] = [];
  const insertions: boolean[] = [];
  const observationIdBySecurity = new Map<string, string>();

  for (const observation of sortedObservations) {
    const stored = await persistRniSecurityObservation(observation, db);
    if (canonical(observationContent(stored.observation)) !== canonical(observationContent(observation))) {
      fail('observation identity reused with different content');
    }
    observationIds.push(stored.observation.id);
    observationIdBySecurity.set(observation.securityId, stored.observation.id);
    insertions.push(stored.inserted);
    insertions.push(
      await insertRunObservation(
        input.runId,
        stored.observation.id,
        observation.sourceItemId,
        observation.securityId,
        semanticOutputHash(input.classification, observation.securityId),
        observation.createdAt,
        db,
      ),
    );
    const noise = input.classification.noise.find(
      ({ securityId }) => securityId === observation.securityId,
    );
    if (noise === undefined) fail('missing per-security noise assessment');
    insertions.push(await insertNoise(stored.observation.id, noise, observation.createdAt, db));
  }

  const sortedThemes = [...input.classification.themes].sort((a, b) =>
    `${a.securityId}:${a.themeDefinitionId}`.localeCompare(`${b.securityId}:${b.themeDefinitionId}`),
  );
  for (const theme of sortedThemes) {
    await assertThemeDefinition(theme, db);
    const observationId = observationIdBySecurity.get(theme.securityId);
    if (observationId === undefined) fail('missing theme observation lineage');
    const write = await persistRniObservationTheme(
      {
        observationId,
        themeDefinitionId: theme.themeDefinitionId,
        classificationConfidence: theme.classificationConfidence,
        themeStance: theme.stance,
        themeScore: theme.score,
        createdAt: sortedObservations.find(({ securityId }) => securityId === theme.securityId)!.createdAt,
      },
      db,
    );
    await assertThemeAssignment(observationId, theme, write.inserted, db);
    insertions.push(write.inserted);
  }

  const citationsByKey = new Map(input.classification.citationProposals.map((value) => [citationKey(value), value]));
  const sortedClaims = [...input.classification.claims].sort((a, b) => claimKey(a).localeCompare(claimKey(b)));
  for (const claim of sortedClaims) {
    const observation = sortedObservations.find(({ securityId }) => securityId === claim.securityId);
    const observationId = observationIdBySecurity.get(claim.securityId);
    if (observation === undefined || observationId === undefined) fail('missing claim observation lineage');
    const storedClaim = await insertClaim(
      claim,
      observationId,
      observation.classifierRunId,
      observation.inputHash,
      semanticBundle(input.classification, claim.securityId),
      observation.createdAt,
      db,
    );
    claimIds.push(storedClaim.id);
    insertions.push(storedClaim.inserted);

    const proposal = citationsByKey.get(claimKey(claim));
    if (proposal === undefined) fail('missing claim citation proposal');
    const persistedSource = source.rows[0]!;
    if (proposal.platform !== persistedSource.platform || proposal.url !== persistedSource.original_url) {
      fail('citation provenance does not match the persisted original source');
    }
    const prior = await db.query<{ id: string; evidence_text: string }>(
      'select id, evidence_text from rni_claim_citation where claim_id = $1 and source_item_id = $2',
      [storedClaim.id, input.sourceItemId],
    );
    if (prior.rows.length > 1) fail('claim identity has multiple citation rows');
    if (prior.rows[0] !== undefined && prior.rows[0].evidence_text !== proposal.evidenceText) {
      fail('citation identity reused with different content');
    }
    const storedCitation = await persistRniClaimCitation(
      {
        id: randomUUID(),
        claimId: storedClaim.id,
        sourceItemId: input.sourceItemId,
        evidenceText: proposal.evidenceText,
        createdAt: observation.createdAt,
      },
      db,
    );
    citationIds.push(storedCitation.id);
    insertions.push(storedCitation.inserted);
  }

  return {
    disposition: insertions.some(Boolean) ? 'inserted' : 'duplicate',
    observationIds: [...new Set(observationIds)],
    claimIds: [...new Set(claimIds)],
    citationIds: [...new Set(citationIds)],
  };
}

export class PostgresRniSemanticPersistence implements RniSemanticPersistencePort {
  constructor(private readonly pool: pg.Pool = getPool()) {}

  commitClassification(input: RniSemanticCommitRequest): Promise<RniSemanticCommitResult> {
    return withTransaction((tx) => commit(input, tx), this.pool);
  }
}
