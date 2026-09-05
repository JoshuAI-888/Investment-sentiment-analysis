import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { canonicalHash, sha256Hex } from '../../../src/calc/canonical';
import { withTransaction, type Queryable } from '../../../src/repositories/client';
import {
  RNI_CITED_SYNTHESIS_CODE_VERSION,
  replayCitedSynthesis,
  synthesizeCitedNarrative,
  type RniCitedSynthesisRequest,
} from '../../../src/rni/agents';
import { convergePlatformFacts } from '../../../src/rni/convergence';
import { PostgresRniSynthesisEvidenceReader } from '../../../src/rni/repositories/cited-synthesis-reader';
import { databaseUrl, makePool, resetSchema } from '../helpers/db';
import { convergenceRequest, nonPublishablePlatform, platformInput } from '../../unit/rni/convergence/fixtures';

const cutoff = '2026-09-05T01:00:00.123456Z';
const rights = 'rni-source-policy-v1';
const policy = 'rni-cited-synthesis-policy-v1';
const hash = 'a'.repeat(64);
const json = JSON.stringify;

type Fixture = Awaited<ReturnType<typeof seed>>;

async function seed(pool: pg.Pool, options: {
  originalUrl?: string; contentHash?: string; citationText?: string; noEligibleClaims?: boolean;
  extraCorroboratingCandidate?: boolean;
} = {}) {
  const runId = randomUUID();
  const securityId = randomUUID();
  const batchId = randomUUID();
  const sourceIds = [randomUUID(), randomUUID(), randomUUID()];
  const observationIds = [randomUUID(), randomUUID(), randomUUID()];
  const claimIds = [randomUUID(), randomUUID(), randomUUID()];
  const citationIds = [randomUUID(), randomUUID(), randomUUID()];
  const modelIds = [randomUUID(), randomUUID()];
  const analyticsId = randomUUID();
  const sliceIds = { reddit: randomUUID(), x: randomUUID() };
  const content = ['NVDA catalyst claim.', 'Separate social evidence for NVDA.', 'Persisted but not in the batch.'];
  let configId = '';
  await withTransaction(async (db) => {
    configId = (await db.query<{ id: string }>(
      `insert into config_version (environment, status, created_by, change_reason, checksum)
       values ('test', 'draft', 'owner', 'I07 evidence fixture', $1) returning id`, [randomUUID()],
    )).rows[0]!.id;
    const universe = (await db.query<{ id: string }>(
      `insert into universe_version (environment, config_version, status, selected_count, created_by, change_reason)
       values ('test', $1, 'draft', 0, 'owner', 'I07 evidence fixture') returning id`, [configId],
    )).rows[0]!.id;
    await db.query(
      `insert into security (id, symbol, name, exchange, asset_type, currency)
       values ($1, 'NVDA', 'NVIDIA Corporation', 'NASDAQ', 'equity', 'USD')`, [securityId],
    );
    await db.query(
      `insert into rni_run (id, idempotency_key, trigger, status, window_start, window_end,
        universe_version, config_version, prompt_version, ai_route, requested_at)
       values ($1, $2, 'manual', 'running', '2026-09-04T01:00:00Z', $3,
        $4, $5, 'rni-prompts-v1', 'openai_direct', $3)`,
      [runId, randomUUID(), cutoff, universe, configId],
    );
    await db.query(
      `insert into rni_platform_slice (id, run_id, platform, status, coverage_disclosure)
       values ($2, $1, 'reddit', $4, 'Sampled Reddit'), ($3, $1, 'x', 'unavailable', 'X unavailable')`,
      [runId, sliceIds.reddit, sliceIds.x, options.noEligibleClaims ? 'unavailable' : 'complete'],
    );
    for (const [i, sourceId] of sourceIds.entries()) {
      await db.query(
        `insert into rni_source_item (id, platform, source_kind, external_id, canonical_url,
          original_url, subreddit_or_scope, bounded_content, content_sha256, capture_mode,
          published_at, discovered_at, observed_at, rights_policy_version, created_at)
         values ($1, 'reddit', 'post', $2, $3, $4, 'r/stocks', $5, $6, 'excerpt_only',
          '2026-09-05T00:00:00.123456Z', '2026-09-05T00:01:00.123456Z',
          '2026-09-05T00:02:00.123456Z', $7, '2026-09-05T00:03:00.123456Z')`,
        [sourceId, `t3_evidence${i}`, `https://www.reddit.com/r/stocks/comments/evidence${i}/`,
          i === 0 && options.originalUrl !== undefined ? options.originalUrl :
            `https://www.reddit.com/r/stocks/comments/evidence${i}/example/?utm_source=fixture`,
          content[i], i === 0 && options.contentHash !== undefined ? options.contentHash : sha256Hex(content[i]!), rights],
      );
      await db.query(
        `insert into rni_security_mention (source_item_id, security_id, mention_text, resolution_method, resolution_confidence)
         values ($1, $2, 'NVDA', 'exact_ticker', 1)`, [sourceId, securityId],
      );
      await db.query(
        `insert into rni_security_observation (id, source_item_id, security_id, stance, stance_score,
          relevance, claim_summary, dimension_assignments, classifier_run_id, prompt_version, model_id, input_hash, created_at)
         values ($1, $2, $3, 'bullish', 0.5, 1, $4, $5, $6, 'classifier-v1', 'fixture-model', $7, $8)`,
        [observationIds[i], sourceId, securityId, content[i],
          json([{ dimension: 'catalyst_event', stance: 'bullish', score: '0.5', rationale: content[i] }]),
          randomUUID(), hash, cutoff],
      );
      await db.query(
        `insert into rni_evidence_claim (id, source_item_id, security_id, observation_id, claim_text,
          claim_type, epistemic_status, extractor_run_id, input_hash, dimension, created_at)
         values ($1, $2, $3, $4, $5, 'opinion', 'source_claim', $6, $7, 'catalyst_event', $8)`,
        [claimIds[i], sourceId, securityId, observationIds[i], content[i], randomUUID(), hash, cutoff],
      );
      await db.query(
        `insert into rni_claim_citation (id, claim_id, source_item_id, evidence_text) values ($1, $2, $3, $4)`,
        [citationIds[i], claimIds[i], sourceId, i === 0 && options.citationText !== undefined ? options.citationText : content[i]],
      );
      await db.query(
        `insert into rni_run_observation (run_id, observation_id, source_item_id, security_id, semantic_output_hash)
         values ($1, $2, $3, $4, $5)`, [runId, observationIds[i], sourceId, securityId, hash],
      );
    }
    await db.query(
      `insert into rni_platform_analytics_artifact (id, run_id, platform_slice_id, platform, security_id,
        methodology_version, calculation_code_version, input_hash, result_hash, artifact_hash,
        input_snapshot, result_snapshot, created_at)
       values ($1, $2, $3, 'reddit', $4, 'method-v1', 'rni-platform-analytics-v1', $5, $5, $5, '{}', '{}', $6)`,
      [analyticsId, runId, sliceIds.reddit, securityId, hash, cutoff],
    );
    await db.query(
      `insert into rni_synthesis_batch (id, run_id, security_id, assessment_cutoff_at, policy_version,
        rights_policy_version, ordered_citation_ids, reddit_platform_citation_ids, x_platform_citation_ids, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, '[]', $4)`,
      [batchId, runId, securityId, cutoff, policy, rights,
        json(citationIds.slice(0, options.extraCorroboratingCandidate ? 3 : 2).sort()),
        json(options.noEligibleClaims ? [] : [citationIds[0]])],
    );
    await db.query(
      `insert into rni_synthesis_claim_input (batch_id, run_id, security_id, assessment_cutoff_at,
        policy_version, rights_policy_version, ordinal, claim_id, source_item_id, observation_id,
        platform, source_citation_ids)
       values ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, 'reddit', $10)`,
      [batchId, runId, securityId, cutoff, policy, rights, claimIds[0], sourceIds[0], observationIds[0], json([citationIds[0]])],
    );
    for (const [i, role, target] of [
      [0, 'social_claim', claimIds[0]], [1, 'corroborating', claimIds[0]],
      [2, 'corroborating', claimIds[0]], [0, 'social_claim', null],
    ] as const) {
      if ((target === null && options.noEligibleClaims) || (i === 2 && !options.extraCorroboratingCandidate)) continue;
      await db.query(
        `insert into rni_synthesis_citation_role (batch_id, run_id, security_id, assessment_cutoff_at,
          policy_version, rights_policy_version, target_claim_id, citation_id, evidence_claim_id,
          source_item_id, observation_id, platform, evidence_role, analytics_artifact_id, analytics_artifact_hash)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'reddit', $12, $13, $14)`,
        [batchId, runId, securityId, cutoff, policy, rights, target, citationIds[i], claimIds[i],
          sourceIds[i], observationIds[i], role, target === null ? analyticsId : null, target === null ? hash : null],
      );
    }
    for (const [i, stage] of ['verification', 'challenger'].entries()) {
      await db.query(
        `insert into rni_synthesis_model_invocation (id, batch_id, stage, model_id, model_revision,
          prompt_version, ordered_claim_ids, input_hash, prepared_snapshot, prepared_at)
         values ($1, $2, $3, 'gpt-5.6-sol', 'sol-fixture', $4, $5, $6, '{}', $7)`,
        [modelIds[i], batchId, stage, `rni-${stage}-v2`, json([claimIds[0]]), hash, cutoff],
      );
    }
  }, pool);
  return { runId, securityId, batchId, sourceIds, claimIds, citationIds, modelIds, configId, content,
    sliceIds, noEligibleClaims: options.noEligibleClaims ?? false };
}

async function requestFromReader(
  fixture: Fixture,
  reader: PostgresRniSynthesisEvidenceReader,
): Promise<RniCitedSynthesisRequest> {
  const verificationInvocation = await reader.getModelInvocation(fixture.modelIds[0]!);
  const challengerInvocation = await reader.getModelInvocation(fixture.modelIds[1]!);
  if (verificationInvocation.stage !== 'verification' || challengerInvocation.stage !== 'challenger') {
    throw new Error('Crossed fixture invocation stages');
  }
  const platform = (name: 'reddit' | 'x') => ({
    ...(name === 'x' || fixture.noEligibleClaims
      ? nonPublishablePlatform(name, 'unavailable') : platformInput(name)),
    runId: fixture.runId,
    securityId: fixture.securityId,
    runSourceSliceId: fixture.sliceIds[name],
    windowStart: '2026-09-04T01:00:00Z',
    windowEnd: cutoff,
    dataThroughAt: name === 'x' || fixture.noEligibleClaims ? null : '2026-09-05T00:02:00.123456Z',
  });
  return {
    codeVersion: RNI_CITED_SYNTHESIS_CODE_VERSION, policyVersion: policy, rightsPolicyVersion: rights,
    summaryId: randomUUID(), createdAt: cutoff,
    verificationInvocation: { ...verificationInvocation, stage: 'verification' },
    challengerInvocation: { ...challengerInvocation, stage: 'challenger' },
    convergenceArtifact: convergePlatformFacts(convergenceRequest({
      asOf: cutoff, reddit: platform('reddit'), x: platform('x'),
    })),
    claims: [await reader.getSynthesisClaim(fixture.claimIds[0]!)],
    citationIds: fixture.citationIds.slice(0, 2).sort(),
    platformCitationIds: { reddit: fixture.noEligibleClaims ? [] : [fixture.citationIds[0]!], x: [] },
  };
}

async function insertAssessment(
  db: Queryable,
  fixture: Fixture,
  verdict: 'supported' | 'contradicted' | 'unverified',
  supporting: readonly string[] = [],
  contradicting: readonly string[] = [],
) {
  await db.query(
    `insert into rni_catalyst_assessment (batch_id, run_id, security_id, assessment_cutoff_at,
      policy_version, rights_policy_version, claim_id, verifier_invocation_id, verdict,
      supporting_citation_ids, contradicting_citation_ids, assessment_hash)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [fixture.batchId, fixture.runId, fixture.securityId, cutoff, policy, rights,
      fixture.claimIds[0], fixture.modelIds[0], verdict, json(supporting), json(contradicting), hash],
  );
}

async function seedGovernedVerification(pool: pg.Pool, fixture: Fixture) {
  await withTransaction(async (db) => {
    await db.query(
      `insert into universe_member (universe_version, security_id, added_by, selection_source)
       select universe_version, $2, 'owner', 'preset' from rni_run where id = $1`,
      [fixture.runId, fixture.securityId],
    );
    await db.query(
      `insert into rni_run_execution_scope (run_id, scope_kind, security_id)
       values ($1, 'manual_ticker', $2)`, [fixture.runId, fixture.securityId],
    );
    await db.query(
      `insert into rni_model_capability_snapshot (id, ai_route, configured_model_id, provider,
        canonical_provider_model_id, model_revision, response_hash, observed_at, expires_at,
        available, supports_responses, supports_structured_outputs, supports_web_search, reasoning_efforts)
       values ('sol-capability', 'openai_direct', 'gpt-5.6-sol', 'openai', 'gpt-5.6-sol',
        'sol-fixture', $1, '2026-09-01T00:00:00Z', '2099-01-01T00:00:00Z', true, true, true, false, '["low"]')`,
      [hash],
    );
    await db.query(
      `insert into rni_ai_config (config_version, ai_route, model_policy_version, budget_policy_version,
        manual_run_hard_usd, full_universe_hard_usd, rolling_24h_hard_usd, monthly_warning_usd, monthly_hard_usd)
       values ($1, 'openai_direct', 'rni-balanced-model-policy-v1', 'rni-ai-budget-policy-v1', 2, 25, 50, 300, 500)`,
      [fixture.configId],
    );
    for (const task of ['rni_verification', 'rni_challenger']) {
      await db.query(
        `insert into model_route (config_version, task, transport, primary_provider, primary_model,
          model_revision, fallback_chain, prompt_version, schema_version, temperature, max_input_tokens,
          max_output_tokens, timeout_ms, max_cost_usd, allowed_data_classes, canary_percent, ai_route,
          canonical_provider_model_id, reasoning_effort, capability_snapshot_id, policy_version,
          max_input_bytes, max_tool_calls)
         values ($1, $2, 'openai_responses', 'openai', 'gpt-5.6-sol', 'sol-fixture', '[]',
          $2 || '-v2', 'rni-schema-v1', 0, 1024, 256, 30000, 2, '[]', 0, 'openai_direct',
          'gpt-5.6-sol', 'low', 'sol-capability', 'rni-balanced-model-policy-v1', 1024, 0)`,
        [fixture.configId, task],
      );
    }
  }, pool);
}

describe.skipIf(databaseUrl() === undefined)('I07 batch-scoped cited-synthesis evidence reader', () => {
  let pool: pg.Pool;
  let fixture: Fixture;
  let reader: PostgresRniSynthesisEvidenceReader;
  let activePolicy: string;

  beforeAll(() => { pool = makePool(); });
  beforeEach(async () => {
    await resetSchema(pool);
    fixture = await seed(pool);
    activePolicy = rights;
    reader = new PostgresRniSynthesisEvidenceReader(
      { batchId: fixture.batchId, runId: fixture.runId, securityId: fixture.securityId },
      async () => activePolicy,
      pool,
    );
  }, 60_000);
  afterAll(async () => { await pool?.end(); });

  it('reads persisted claim/source/citation lineage with original URL and lossless cutoff times', async () => {
    const claim = await reader.getSynthesisClaim(fixture.claimIds[0]!);
    const citation = await reader.getCitation(fixture.citationIds[0]!);
    const source = await reader.getEvidence(citation.sourceItemId);
    expect(claim).toMatchObject({ runId: fixture.runId, securityId: fixture.securityId,
      claimText: fixture.content[0], verificationCutoffAt: cutoff, sourceCitationIds: [citation.id] });
    expect(source.observedAt).toBe('2026-09-05T00:02:00.123456Z');
    expect(citation.url).toBe(source.originalUrl);
    expect(citation.url).toContain('?utm_source=fixture');
    expect(source.canonicalUrl).toBe('https://www.reddit.com/r/stocks/comments/evidence0/');
  });

  it('retains claim-specific roles and separate platform analytics lineage', async () => {
    expect(await reader.getCitationLineage(fixture.claimIds[0]!, fixture.citationIds[1]!))
      .toMatchObject({ evidenceRole: 'corroborating', analyticsArtifactHash: null });
    expect(await reader.getCitationLineage(null, fixture.citationIds[0]!))
      .toMatchObject({ evidenceRole: 'social_claim', analyticsArtifactHash: hash });
    expect(await reader.getCitationLineage(fixture.claimIds[1]!, fixture.citationIds[1]!)).toBeNull();
  });

  it('resolves two distinct persisted model descriptors with the exact ordered claim batch', async () => {
    const verifier = await reader.getModelInvocation(fixture.modelIds[0]!);
    const challenger = await reader.getModelInvocation(fixture.modelIds[1]!);
    expect(verifier).toMatchObject({ stage: 'verification', modelRunId: fixture.modelIds[0],
      claimIds: [fixture.claimIds[0]], assessmentCutoffAt: cutoff, policyVersion: policy, rightsPolicyVersion: rights });
    expect(challenger).toMatchObject({ stage: 'challenger', modelRunId: fixture.modelIds[1] });
    expect(verifier.modelRunId).not.toBe(challenger.modelRunId);
  });

  it.each(['batchId', 'runId', 'securityId'] as const)('rejects crossed %s on every lookup', async (key) => {
    const scoped = new PostgresRniSynthesisEvidenceReader(
      { batchId: fixture.batchId, runId: fixture.runId, securityId: fixture.securityId, [key]: randomUUID() },
      async () => rights, pool,
    );
    await expect(scoped.getEvidence(fixture.sourceIds[0]!)).rejects.toThrow('outside its durable batch');
    await expect(scoped.getCitation(fixture.citationIds[0]!)).rejects.toThrow();
    await expect(scoped.getSynthesisClaim(fixture.claimIds[0]!)).rejects.toThrow();
    await expect(scoped.getModelInvocation(fixture.modelIds[0]!)).rejects.toThrow();
    await expect(scoped.getCitationLineage(null, fixture.citationIds[0]!)).rejects.toThrow();
  });

  it('does not expose persisted or guessed evidence outside the batch manifest', async () => {
    await expect(reader.getSynthesisClaim(fixture.claimIds[1]!)).rejects.toThrow();
    await expect(reader.getSynthesisClaim(fixture.claimIds[2]!)).rejects.toThrow();
    await expect(reader.getEvidence(fixture.sourceIds[2]!)).rejects.toThrow();
    await expect(reader.getCitation(fixture.citationIds[2]!)).rejects.toThrow();
    await expect(reader.getEvidence(randomUUID())).rejects.toThrow();
    await expect(reader.getCitation(randomUUID())).rejects.toThrow();
    await expect(reader.getModelInvocation(randomUUID())).rejects.toThrow();
  });

  it.each([
    ['original source URL/native identity', { originalUrl: 'https://www.reddit.com/r/stocks/comments/otherpost/' }],
    ['bounded content hash', { contentHash: 'b'.repeat(64) }],
    ['citation span', { citationText: 'Text not present in original evidence.' }],
  ] as const)('rejects invalid persisted %s even if the frozen SQL graph accepted it', async (_name, options) => {
    await resetSchema(pool);
    const invalid = await seed(pool, options);
    const scoped = new PostgresRniSynthesisEvidenceReader(
      { batchId: invalid.batchId, runId: invalid.runId, securityId: invalid.securityId }, async () => rights, pool,
    );
    await expect(scoped.getCitation(invalid.citationIds[0]!)).rejects.toThrow('outside its durable batch');
    await expect(scoped.getSynthesisClaim(invalid.claimIds[0]!)).rejects.toThrow();
  });

  it('rechecks current rights and never substitutes the batch’s historical rights', async () => {
    expect(await reader.getActiveRightsPolicyVersion(fixture.runId)).toBe(rights);
    activePolicy = 'rni-source-policy-v2';
    expect(await reader.getActiveRightsPolicyVersion(fixture.runId)).toBe(activePolicy);
    await expect(reader.getEvidence(fixture.sourceIds[0]!)).rejects.toThrow();
    await expect(reader.getCitation(fixture.citationIds[0]!)).rejects.toThrow();
    await expect(reader.getSynthesisClaim(fixture.claimIds[0]!)).rejects.toThrow();
    await expect(reader.getActiveRightsPolicyVersion(randomUUID())).rejects.toThrow();
  });

  it('fails closed if the trusted active-rights authority is unavailable or empty', async () => {
    activePolicy = '';
    await expect(reader.getEvidence(fixture.sourceIds[0]!)).rejects.toThrow();
    const unavailable = new PostgresRniSynthesisEvidenceReader(
      { batchId: fixture.batchId, runId: fixture.runId, securityId: fixture.securityId },
      async () => { throw new Error('Rights authority unavailable'); }, pool,
    );
    await expect(unavailable.getCitation(fixture.citationIds[0]!)).rejects.toThrow('Rights authority unavailable');
  });

  it('rechecks source restrictions after the citation graph has already committed', async () => {
    await reader.getCitation(fixture.citationIds[0]!);
    await pool.query(
      `update rni_source_item set source_status = 'tombstoned', tombstoned_at = now(),
        tombstone_reason = 'fixture rights withdrawal' where id = $1`, [fixture.sourceIds[0]],
    );
    await expect(reader.getCitation(fixture.citationIds[0]!)).rejects.toThrow();
    await expect(reader.getSynthesisClaim(fixture.claimIds[0]!)).rejects.toThrow();
  });

  it('refuses failed model descriptors without changing prepared evidence or publishing a result', async () => {
    await pool.query(
      `update rni_synthesis_model_invocation set status = 'failed', completed_at = now(),
        terminal_metadata = '{"outcome":"failed","errorCode":"provider_failure"}' where id = $1`,
      [fixture.modelIds[0]],
    );
    await expect(reader.getModelInvocation(fixture.modelIds[0]!)).rejects.toThrow();
    expect((await pool.query('select id from rni_combined_summary')).rowCount).toBe(0);
    expect((await pool.query('select id from rni_cited_synthesis_artifact')).rowCount).toBe(0);
  });

  it('uses the supplied transaction for rights checks as well as evidence reads', async () => {
    await withTransaction(async (db) => {
      const lookup = vi.fn(async () => rights);
      const transactionReader = new PostgresRniSynthesisEvidenceReader(
        { batchId: fixture.batchId, runId: fixture.runId, securityId: fixture.securityId }, lookup, db,
      );
      await transactionReader.getEvidence(fixture.sourceIds[0]!);
      expect(lookup).toHaveBeenCalledWith(fixture.runId, db);
    }, pool);
  });

  it('accepts canonical verification and challenger stages in governed invocation records', async () => {
    await seedGovernedVerification(pool, fixture);
    const recordDenied = (modelId: string, task: string) => pool.query(
      `insert into rni_ai_model_invocation (id, run_id, config_version, task, ai_route,
        capability_snapshot_id, request_hash, decision, denial_code, price_book_version,
        synthesis_invocation_id, created_at)
       values ($1, $2, $3, $4, 'openai_direct', 'sol-capability', $5, 'denied',
        'budget_exceeded', 'fixture-prices-v1', $1, $6)`,
      [modelId, fixture.runId, fixture.configId, task, hash, cutoff],
    );
    await expect(recordDenied(fixture.modelIds[0]!, 'rni_challenger')).rejects.toMatchObject({
      code: '23514', constraint: 'rni_ai_invocation_synthesis_stage',
      message: 'RNI synthesis invocation stage does not match its governed model task',
    });
    await expect(recordDenied(fixture.modelIds[1]!, 'rni_verification')).rejects.toMatchObject({
      code: '23514', constraint: 'rni_ai_invocation_synthesis_stage',
    });
    await recordDenied(fixture.modelIds[0]!, 'rni_verification');
    await recordDenied(fixture.modelIds[1]!, 'rni_challenger');
    expect((await pool.query('select id from rni_ai_model_invocation')).rows)
      .toEqual(expect.arrayContaining(fixture.modelIds.map((id) => ({ id }))));
    expect((await pool.query('select id from rni_ai_model_invocation')).rowCount).toBe(2);
  });

  it.each([true, false])('replays with durable skipped plans when noEligibleClaims=%s', async (noEligibleClaims) => {
    if (noEligibleClaims) {
      await resetSchema(pool);
      fixture = await seed(pool, { noEligibleClaims });
      reader = new PostgresRniSynthesisEvidenceReader(
        { batchId: fixture.batchId, runId: fixture.runId, securityId: fixture.securityId }, async () => rights, pool,
      );
    }
    const request = await requestFromReader(fixture, reader);
    const verifier = { verify: vi.fn(async () => ({ assessments: [{
      claimId: fixture.claimIds[0], verdict: 'unverified', supportingCitationIds: [], contradictingCitationIds: [],
    }] })) };
    const challenger = { challenge: vi.fn(async () => { throw new Error('No challenger call expected'); }) };
    const artifact = await synthesizeCitedNarrative(request, reader, verifier, challenger);
    await withTransaction(async (db) => {
      for (const [index, id] of fixture.modelIds.entries()) {
        const skipped = noEligibleClaims || index === 1;
        await db.query(
          `update rni_synthesis_model_invocation set status = $2, output_hash = $3,
            completed_at = $4, terminal_metadata = $5 where id = $1`,
          [id, skipped ? 'skipped' : 'succeeded', skipped ? null : canonicalHash(artifact.verificationOutputSnapshot),
            cutoff, json(skipped ? {
              outcome: 'skipped', reason: noEligibleClaims ? 'no_eligible_claims' : 'no_verified_assessments',
            } : { outcome: 'succeeded' })],
        );
      }
    });
    expect(await reader.getModelInvocation(fixture.modelIds[0]!)).toEqual(request.verificationInvocation);
    expect(await reader.getModelInvocation(fixture.modelIds[1]!)).toEqual(request.challengerInvocation);
    const replayed = await replayCitedSynthesis(artifact, reader);
    const repeated = await replayCitedSynthesis(replayed, reader);
    expect(canonicalHash(replayed)).toBe(canonicalHash(artifact));
    expect(canonicalHash(repeated)).toBe(canonicalHash(artifact));
    expect(verifier.verify).toHaveBeenCalledTimes(noEligibleClaims ? 0 : 1);
    expect(challenger.challenge).not.toHaveBeenCalled();
    expect((await pool.query('select id from rni_ai_model_invocation')).rowCount).toBe(0);
    expect((await pool.query('select id from rni_cited_synthesis_artifact')).rowCount).toBe(0);
  });

  it.each([
    ['verification cannot skip for a challenger-only reason', 0, { outcome: 'skipped', reason: 'no_verified_assessments' }],
    ['unknown reason', 1, { outcome: 'skipped', reason: 'budget_exceeded' }],
    ['provider output on a no-call plan', 1, { outcome: 'skipped', reason: 'no_eligible_claims', responseId: 'fake' }],
  ] as const)('rejects invalid skipped plan: %s', async (_label, index, metadata) => {
    await expect(pool.query(
      `update rni_synthesis_model_invocation set status = 'skipped', completed_at = $2,
        terminal_metadata = $3 where id = $1`, [fixture.modelIds[index], cutoff, json(metadata)],
    )).rejects.toMatchObject({ code: '23514', constraint: 'rni_synthesis_model_invocation_terminal_check' });
    expect((await pool.query('select status from rni_synthesis_model_invocation where id = $1',
      [fixture.modelIds[index]])).rows).toEqual([{ status: 'prepared' }]);
  });

  it.each(['unverified', 'supported'] as const)('accepts verifier-selected %s evidence without requiring every candidate', async (verdict) => {
    await resetSchema(pool);
    fixture = await seed(pool, { extraCorroboratingCandidate: true });
    await withTransaction(async (db) => {
      await db.query(
        `update rni_synthesis_model_invocation set status = 'succeeded', output_hash = $2,
          completed_at = $3, terminal_metadata = '{"outcome":"succeeded"}' where id = $1`,
        [fixture.modelIds[0], hash, cutoff],
      );
      await insertAssessment(db, fixture, verdict, verdict === 'supported' ? [fixture.citationIds[1]!] : []);
    }, pool);
    expect((await pool.query('select verdict, supporting_citation_ids from rni_catalyst_assessment')).rows)
      .toEqual([{ verdict, supporting_citation_ids: verdict === 'supported' ? [fixture.citationIds[1]] : [] }]);
    expect((await pool.query(
      `select citation_id from rni_synthesis_citation_role where evidence_role = 'corroborating'`,
    )).rowCount).toBe(2);
  });

  it.each(['crossed_role', 'unlisted_candidate', 'social_claim'] as const)(
    'rejects %s selections and rolls back the attempted assessment', async (invalid) => {
      await expect(withTransaction(async (db) => {
        await db.query(
          `update rni_synthesis_model_invocation set status = 'succeeded', output_hash = $2,
            completed_at = $3, terminal_metadata = '{"outcome":"succeeded"}' where id = $1`,
          [fixture.modelIds[0], hash, cutoff],
        );
        await insertAssessment(db, fixture, invalid === 'crossed_role' ? 'contradicted' : 'supported',
          invalid === 'unlisted_candidate' ? [fixture.citationIds[2]!] :
            invalid === 'social_claim' ? [fixture.citationIds[0]!] : [],
          invalid === 'crossed_role' ? [fixture.citationIds[1]!] : []);
      }, pool)).rejects.toMatchObject({
        code: '23514', constraint: 'rni_catalyst_assessment_exact_citations',
        message: 'RNI catalyst assessment citations must be selected from exact same-claim role candidates',
      });
      expect((await pool.query('select claim_id from rni_catalyst_assessment')).rowCount).toBe(0);
      expect((await pool.query('select id from rni_combined_summary')).rowCount).toBe(0);
      expect((await pool.query('select id from rni_cited_synthesis_artifact')).rowCount).toBe(0);
      expect((await pool.query('select status from rni_synthesis_model_invocation where id = $1',
        [fixture.modelIds[0]])).rows).toEqual([{ status: 'prepared' }]);
      expect((await pool.query('select status from rni_run where id = $1', [fixture.runId])).rows)
        .toEqual([{ status: 'running' }]);
    },
  );
});
