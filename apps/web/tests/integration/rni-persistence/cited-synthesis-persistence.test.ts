import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';

import { canonicalHash, canonicalInstant, sha256Hex } from '../../../src/calc/canonical';
import {
  replayCitedSynthesis,
  synthesizeCitedNarrative,
  type RniChallengerInferencePort,
  type RniChallengerModelInput,
  type RniCitedSynthesisArtifact,
  type RniVerificationInferencePort,
} from '../../../src/rni/agents';
import {
  loadAndReplayAcceptedCitedSynthesis,
  synthesizeAndCommitCitedNarrative,
  type RniCitedSynthesisPreparationRequest,
} from '../../../src/rni/composition';
import { convergePlatformFacts } from '../../../src/rni/convergence';
import type {
  RniConvergenceDimensionInput,
  RniConvergenceArtifact,
  RniConvergenceRequest,
} from '../../../src/rni/convergence';
import {
  calculatePlatformAnalytics,
  type RniPlatformAnalyticsArtifact,
} from '../../../src/rni/analytics';
import { methodology, platformInput } from '../../unit/rni/analytics/fixtures';
import { PostgresRniCitedSynthesisPersistence } from '../../../src/rni/repositories/cited-synthesis-persistence';
import { PostgresRniSynthesisEvidenceReader } from '../../../src/rni/repositories/cited-synthesis-reader';
import { withTransaction } from '../../../src/repositories/client';
import { databaseUrl, makePool, resetSchema, truncateAll } from '../helpers/db';

const url = databaseUrl();
const H = (value: string) => value.repeat(64);
const indexedHash = (index: number, offset: number) =>
  '0123456789abcdef'[(index + offset) % 16]!.repeat(64);
const J = (value: unknown) => JSON.stringify(value);
const CUTOFF = '2026-09-05T12:00:00.000123Z';
const CREATED_AT = '2026-09-05T12:05:00.654321Z';
const RIGHTS = 'rights-v1';
const POLICY = 'rni-verification-policy-v1';

type Seed = {
  readonly runId: string;
  readonly securityId: string;
  readonly otherSecurityId: string;
  readonly redditSliceId: string;
  readonly xSliceId: string;
  readonly convergenceHash: string;
  readonly targetSourceId: string;
  readonly xSourceId: string;
  readonly supportSourceId: string;
  readonly lateSourceId: string;
  readonly targetClaimId: string;
  readonly targetCitationId: string;
  readonly xCitationId: string;
  readonly supportCitationId: string;
  readonly lateCitationId: string;
};

type SeedOptions = {
  readonly targetLate?: boolean;
  readonly targetStatus?: 'active' | 'tombstoned';
  readonly targetCanonicalUrl?: string;
  readonly xCanonicalUrl?: string;
  readonly omitTargetCitation?: boolean;
  readonly supportAliasesTarget?: boolean;
  readonly lateEligible?: boolean;
  readonly supportPublishedAt?: string | null;
  readonly noCatalyst?: boolean;
  readonly unavailable?: 'reddit' | 'x' | 'both';
  readonly excerptOnly?: boolean;
  readonly supportScore?: string;
  readonly analyticsScopeTamper?: 'security' | 'platform';
  readonly projectionTamper?:
    | 'stance'
    | 'score'
    | 'dimensions'
    | 'attention'
    | 'status'
    | 'freshness';
};

const DIMENSIONS = [
  'company_fundamentals',
  'market_trading',
  'catalyst_event',
  'retail_narrative',
] as const;
const dimensions = (score: string): RniConvergenceDimensionInput[] =>
  DIMENSIONS.map((dimension) => ({
    dimension,
    stance: score.startsWith('-') ? 'bearish' : 'bullish',
    score,
  }));

describe.skipIf(url === undefined)('RNI cited-synthesis PostgreSQL persistence', () => {
  let pool: pg.Pool;
  let adapter: PostgresRniCitedSynthesisPersistence;
  let activeRightsPolicy: string;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
  }, 60_000);

  beforeEach(async () => {
    activeRightsPolicy = RIGHTS;
    await truncateAll(pool);
  });

  afterEach(async () => {
    await pool.query(
      'drop trigger if exists rni_test_fail_late_edge on rni_publication_statement_citation',
    );
    await pool.query('drop function if exists rni_test_fail_late_edge()');
  });

  afterAll(async () => {
    await pool?.end();
  });

  function crossAnalyticsScope(
    artifact: RniPlatformAnalyticsArtifact,
    scope: 'security' | 'platform',
  ): RniPlatformAnalyticsArtifact {
    const input = artifact.inputSnapshot;
    const securityId = scope === 'security' ? randomUUID() : input.securityId;
    const platform =
      scope === 'platform' ? (input.platform === 'reddit' ? 'x' : 'reddit') : input.platform;
    return calculatePlatformAnalytics(
      {
        ...input,
        securityId,
        platform,
        current: {
          ...input.current,
          observations: input.current.observations.map((observation) => ({
            ...observation,
            securityId,
            platform,
          })),
        },
      },
      artifact.methodologySnapshot,
    );
  }

  async function persistAnalytics(input: {
    id: string;
    runId: string;
    securityId: string;
    sliceId: string;
    sourceId: string;
    platform: 'reddit' | 'x';
    score: string;
    unavailable?: boolean;
    scopeTamper?: 'security' | 'platform';
  }) {
    const template = platformInput(input.platform);
    const source = await pool.query<{
      published_at: string;
      observed_at: string;
      subreddit_or_scope: string;
    }>(
      `select to_char(published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as published_at,
              to_char(observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as observed_at,
              subreddit_or_scope from rni_source_item where id = $1`,
      [input.sourceId],
    );
    const mention = await pool.query<{ id: string }>(
      'select id from rni_security_mention where source_item_id = $1 and security_id = $2',
      [input.sourceId, input.securityId],
    );
    let artifact = calculatePlatformAnalytics(
      {
        ...template,
        runId: input.runId,
        runSourceSliceId: input.sliceId,
        securityId: input.securityId,
        current: {
          ...template.current,
          windowStart: '2026-09-04T12:00:00.000123Z',
          windowEnd: CUTOFF,
          observations: [
            {
              ...template.current.observations[0]!,
              sourceItemId: input.sourceId,
              mentionIds: mention.rows.map(({ id }) => id),
              securityId: input.securityId,
              duplicateGroupKey: input.sourceId,
              authorHash: null,
              narrativeId: null,
              communityOrScope: source.rows[0]!.subreddit_or_scope,
              analyticalCluster: source.rows[0]!.subreddit_or_scope,
              publishedAt: source.rows[0]!.published_at,
              observedAt: source.rows[0]!.observed_at,
              dimensions: DIMENSIONS.map((dimension) => ({ dimension, score: input.score })),
            },
          ],
        },
        comparison: null,
        baseline: [],
        ...(input.unavailable === true
          ? {
              sliceStatus: 'unavailable' as const,
              current: {
                ...template.current,
                windowStart: '2026-09-04T12:00:00.000123Z',
                windowEnd: CUTOFF,
                observations: [],
              },
              confidenceComponents: Object.fromEntries(
                Object.keys(template.confidenceComponents).map((key) => [key, '0']),
              ) as typeof template.confidenceComponents,
              confidencePenalties: Object.fromEntries(
                Object.keys(template.confidencePenalties).map((key) => [key, '0']),
              ) as typeof template.confidencePenalties,
              confidenceReadiness: { narrativeStageTerminal: true, catalystStageTerminal: true },
            }
          : {}),
      },
      {
        ...methodology('rni-methodology-v1'),
        minimumIndependentSources: '1',
        minimumEffectiveAttention: '0.1',
        halfLifeHours: '24',
      },
    );
    if (input.scopeTamper !== undefined)
      artifact = crossAnalyticsScope(artifact, input.scopeTamper);
    await pool.query(
      `insert into rni_platform_analytics_artifact (
         id, run_id, platform_slice_id, platform, security_id, methodology_version,
         calculation_code_version, input_hash, result_hash, artifact_hash, input_snapshot, result_snapshot, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13)`,
      [
        input.id,
        input.runId,
        input.sliceId,
        input.platform,
        input.securityId,
        artifact.methodologyVersion,
        artifact.calculationCodeVersion,
        artifact.inputSetHash,
        artifact.resultHash,
        canonicalHash(artifact),
        J({ input: artifact.inputSnapshot, methodology: artifact.methodologySnapshot }),
        J(artifact.result),
        CUTOFF,
      ],
    );
    return artifact;
  }

  async function seed(options: SeedOptions = {}): Promise<Seed> {
    const runId = randomUUID();
    const securityId = randomUUID();
    const otherSecurityId = randomUUID();
    const redditSliceId = randomUUID();
    const xSliceId = randomUUID();
    const redditAnalyticsId = randomUUID();
    const xAnalyticsId = randomUUID();
    const convergenceId = randomUUID();
    const targetSourceId = randomUUID();
    const xSourceId = randomUUID();
    const supportSourceId = options.supportAliasesTarget === true ? targetSourceId : randomUUID();
    const lateSourceId = randomUUID();
    const targetObservationId = randomUUID();
    const xObservationId = randomUUID();
    const supportObservationId =
      options.supportAliasesTarget === true ? targetObservationId : randomUUID();
    const lateObservationId = randomUUID();
    const targetClaimId = randomUUID();
    const xClaimId = randomUUID();
    const supportClaimId = options.supportAliasesTarget === true ? targetClaimId : randomUUID();
    const lateClaimId = randomUUID();
    const targetCitationId = randomUUID();
    const xCitationId = randomUUID();
    const supportCitationId =
      options.supportAliasesTarget === true ? targetCitationId : randomUUID();
    const lateCitationId = randomUUID();
    const narrativeId = randomUUID();

    const config = await pool.query<{ id: string }>(
      `insert into config_version
         (environment, status, created_by, change_reason, checksum)
       values ('test', 'draft', 'owner', 'cited synthesis', $1) returning id::text as id`,
      [H('1')],
    );
    const configVersion = config.rows[0]!.id;
    for (const [model, webSearch, suffix] of [
      ['gpt-5.6-terra', true, 'terra'],
      ['gpt-5.6-sol', false, 'sol'],
    ] as const) {
      await pool.query(
        `insert into rni_model_capability_snapshot (
           id, ai_route, configured_model_id, provider, canonical_provider_model_id,
           model_revision, response_hash, observed_at, expires_at, available,
           supports_responses, supports_structured_outputs, supports_web_search,
           reasoning_efforts
         ) values ($1, 'openai_direct', $2, 'openai', $2, $3, $4,
                   now() - interval '1 hour', now() + interval '1 day', true, true, true,
                   $5, '["low"]'::jsonb)`,
        [
          `direct-${suffix}`,
          model,
          `${model}-2026-09-01`,
          H(suffix === 'terra' ? '2' : '3'),
          webSearch,
        ],
      );
    }
    await pool.query(
      `insert into rni_ai_config (
         config_version, ai_route, model_policy_version, budget_policy_version,
         manual_run_hard_usd, full_universe_hard_usd, rolling_24h_hard_usd,
         monthly_warning_usd, monthly_hard_usd
       ) values ($1, 'openai_direct', 'rni-balanced-model-policy-v1',
                 'rni-ai-budget-policy-v1', 2, 25, 50, 300, 500)`,
      [configVersion],
    );
    for (const task of [
      'rni_discovery',
      'rni_relationship',
      'rni_classifier',
      'rni_verification',
      'rni_challenger',
    ] as const) {
      const terra = task !== 'rni_verification' && task !== 'rni_challenger';
      const model = terra ? 'gpt-5.6-terra' : 'gpt-5.6-sol';
      const suffix = terra ? 'terra' : 'sol';
      await pool.query(
        `insert into model_route (
           config_version, task, transport, primary_provider, primary_model,
           model_revision, fallback_chain, prompt_version, schema_version, temperature,
           max_input_tokens, max_output_tokens, timeout_ms, max_cost_usd,
           allowed_data_classes, canary_percent, ai_route,
           canonical_provider_model_id, reasoning_effort, capability_snapshot_id,
           policy_version, max_input_bytes, max_tool_calls
         ) values ($1, $2, 'openai_responses', 'openai', $3, $4, '[]'::jsonb,
                   $5, 'schema-v1', 0, $6, $7, 30000, $8, '["public_forum_content"]'::jsonb,
                   0, 'openai_direct', $3, 'low', $9, 'rni-balanced-model-policy-v1',
                   $6, $10)`,
        [
          configVersion,
          task,
          model,
          `${model}-2026-09-01`,
          task === 'rni_verification'
            ? 'rni-verification-v2'
            : task === 'rni_challenger'
              ? 'rni-challenger-v2'
              : `${task}-v1`,
          terra ? 16_000 : 64_000,
          task === 'rni_challenger' ? 1_000 : 2_000,
          terra ? '0.10' : '0.20',
          `direct-${suffix}`,
          task === 'rni_discovery' ? 3 : 0,
        ],
      );
    }
    await pool.query(
      `update config_version set status = 'active', activated_at = now(), approved_by = 'owner'
        where id = $1`,
      [configVersion],
    );
    const universe = await pool.query<{ id: string }>(
      `insert into universe_version
         (environment, config_version, status, selected_count, created_by, change_reason)
       values ('test', $1, 'draft', 0, 'owner', 'fixture') returning id::text as id`,
      [configVersion],
    );
    await pool.query(
      `insert into security (id, symbol, name, exchange, asset_type, currency) values
         ($1, 'NVDA', 'NVIDIA Corporation', 'NASDAQ', 'equity', 'USD'),
         ($2, 'AMD', 'Advanced Micro Devices', 'NASDAQ', 'equity', 'USD')`,
      [securityId, otherSecurityId],
    );
    await pool.query(
      `with inserted_run as (
         insert into rni_run (
           id, idempotency_key, trigger, status, window_start, window_end,
           universe_version, config_version, prompt_version, ai_route, requested_at, created_at
         ) values ($1, $2, 'manual', 'running', '2026-09-04T12:00:00Z', $3, $4, $5,
                   $6, 'openai_direct', '2026-09-05T11:00:00Z', '2026-09-05T11:00:00Z')
         returning id
       )
       insert into rni_platform_slice (
         id, run_id, platform, status, eligible_source_count, coverage_disclosure,
         data_through_at, computed_at
       )
       select $7::uuid, id, 'reddit', $10, case when $10 = 'unavailable' then 0 else 2 end, 'Sampled Reddit coverage',
              case when $10 = 'unavailable' then null else $9::timestamptz end, $9::timestamptz
         from inserted_run
       union all
       select $8::uuid, id, 'x', $11, case when $11 = 'unavailable' then 0 else 1 end, 'Configured X coverage',
              case when $11 = 'unavailable' then null else $9::timestamptz end, $9::timestamptz
         from inserted_run`,
      [
        runId,
        `run-${runId}`,
        CUTOFF,
        universe.rows[0]!.id,
        configVersion,
        POLICY,
        redditSliceId,
        xSliceId,
        '2026-09-05T11:30:00Z',
        options.unavailable === 'reddit' || options.unavailable === 'both'
          ? 'unavailable'
          : 'complete',
        options.unavailable === 'x' || options.unavailable === 'both' ? 'unavailable' : 'complete',
      ],
    );

    const targetCanonical =
      options.targetCanonicalUrl ?? 'https://www.reddit.com/r/stocks/comments/target/';
    const xCanonical = options.xCanonicalUrl ?? 'https://x.com/i/web/status/1000000000000000001';
    const sourceRows = [
      {
        id: targetSourceId,
        platform: 'reddit',
        kind: 'post',
        externalId: 't3_target',
        canonical: targetCanonical,
        scope: 'stocks',
        content: 'NVDA demand may support the next quarter while AMD execution faces risk.',
        published: '2026-09-05T10:00:00Z',
        discovered:
          options.targetLate === true
            ? '2026-09-05T12:00:00.000124Z'
            : '2026-09-05T10:05:00.123456Z',
        status: options.targetStatus ?? 'active',
      },
      {
        id: xSourceId,
        platform: 'x',
        kind: 'x_post',
        externalId: '1000000000000000001',
        canonical: xCanonical,
        scope: 'x-query',
        content: 'NVDA execution remains constructive while AMD execution faces risk.',
        published: '2026-09-05T10:01:00Z',
        discovered: '2026-09-05T10:06:00Z',
        status: 'active',
      },
      ...(options.supportAliasesTarget === true
        ? []
        : [
            {
              id: supportSourceId,
              platform: 'reddit',
              kind: 'post',
              externalId: 't3_support',
              canonical: 'https://www.reddit.com/r/stocks/comments/support/',
              scope: 'stocks',
              content:
                options.supportScore?.startsWith('-') === true
                  ? 'Separate NVDA demand evidence challenges the next quarter.'
                  : 'Separate NVDA demand evidence supports the next quarter.',
              published:
                options.supportPublishedAt === undefined
                  ? '2026-09-05T10:02:00Z'
                  : options.supportPublishedAt,
              discovered: '2026-09-05T10:07:00Z',
              status: 'active',
            },
          ]),
      {
        id: lateSourceId,
        platform: 'reddit',
        kind: 'post',
        externalId: 't3_late',
        canonical: 'https://www.reddit.com/r/stocks/comments/late/',
        scope: 'stocks',
        content: 'Late NVDA demand evidence supports the next quarter.',
        published: options.lateEligible === true ? '2026-09-05T10:02:00Z' : '2026-09-05T12:01:00Z',
        discovered: options.lateEligible === true ? '2026-09-05T10:07:00Z' : '2026-09-05T12:01:00Z',
        status: 'active',
      },
    ] as const;
    for (const source of sourceRows) {
      await pool.query(
        `insert into rni_source_item (
           id, platform, source_kind, external_id, canonical_url, original_url,
           subreddit_or_scope, bounded_content, content_sha256, capture_mode, published_at,
           discovered_at, observed_at, metadata_json, rights_policy_version, source_status,
           tombstoned_at, tombstone_reason, created_at
         ) values ($1, $2, $3, $4, $5, $5, $6, $7, $8, $13, $9, $10, $10,
                   '{}'::jsonb, $11, $12,
                   case when $12 = 'active' then null else $10::timestamptz end,
                   case when $12 = 'active' then null else 'test terminal source' end, $10)`,
        [
          source.id,
          source.platform,
          source.kind,
          source.externalId,
          source.canonical,
          source.scope,
          source.content,
          sha256Hex(source.content),
          source.published,
          source.discovered,
          RIGHTS,
          source.status,
          options.excerptOnly === true ? 'excerpt_only' : 'full_post',
        ],
      );
    }

    const semanticRows = [
      {
        sourceId: targetSourceId,
        observationId: targetObservationId,
        claimId: targetClaimId,
        citationId: targetCitationId,
        text: 'NVDA demand may support the next quarter.',
        evidence: 'demand may support the next quarter',
        dimension: options.noCatalyst === true ? 'market_trading' : 'catalyst_event',
        score: '0.7',
      },
      {
        sourceId: xSourceId,
        observationId: xObservationId,
        claimId: xClaimId,
        citationId: xCitationId,
        text: 'NVDA execution remains constructive.',
        evidence: 'execution remains constructive',
        dimension: 'market_trading',
        score: '0.5',
      },
      ...(options.supportAliasesTarget === true
        ? []
        : [
            {
              sourceId: supportSourceId,
              observationId: supportObservationId,
              claimId: supportClaimId,
              citationId: supportCitationId,
              text:
                options.supportScore?.startsWith('-') === true
                  ? 'NVDA demand may disappoint next quarter.'
                  : 'NVDA demand may support the next quarter.',
              evidence:
                options.supportScore?.startsWith('-') === true
                  ? 'demand evidence challenges the next quarter'
                  : 'demand evidence supports the next quarter',
              dimension: 'catalyst_event',
              score: options.supportScore ?? '0.6',
            },
          ]),
      {
        sourceId: lateSourceId,
        observationId: lateObservationId,
        claimId: lateClaimId,
        citationId: lateCitationId,
        text: 'NVDA demand may support the next quarter.',
        evidence: 'Late NVDA demand evidence',
        dimension: 'catalyst_event',
        score: '0.6',
      },
    ] as const;
    for (const [index, semantic] of semanticRows.entries()) {
      await pool.query(
        `insert into rni_security_mention (
           source_item_id, security_id, mention_text, resolution_method, resolution_confidence
         ) values ($1, $2, 'NVDA', 'exact_ticker', 1)`,
        [semantic.sourceId, securityId],
      );
      await pool.query(
        `insert into rni_security_observation (
           id, source_item_id, security_id, stance, stance_score, relevance, claim_summary,
           dimension_assignments, classifier_run_id, prompt_version, model_id, input_hash,
           created_at
         ) values ($1, $2, $3, 'bullish', $4, 1, $5, $6::jsonb, $7,
                   'rni-classifier-v1', 'gpt-5.6-terra', $8, '2026-09-05T11:00:00Z')`,
        [
          semantic.observationId,
          semantic.sourceId,
          securityId,
          semantic.score,
          semantic.text,
          J(dimensions(semantic.score)),
          randomUUID(),
          indexedHash(index, 8),
        ],
      );
      await pool.query(
        `insert into rni_evidence_claim (
           id, source_item_id, security_id, observation_id, claim_text, claim_type,
           epistemic_status, extractor_run_id, input_hash, created_at, dimension
         ) values ($1, $2, $3, $4, $5, 'forecast', 'source_claim', $6, $7,
                   '2026-09-05T11:01:00Z', $8)`,
        [
          semantic.claimId,
          semantic.sourceId,
          securityId,
          semantic.observationId,
          semantic.text,
          randomUUID(),
          indexedHash(index, 12),
          semantic.dimension,
        ],
      );
      if (!(options.omitTargetCitation === true && semantic.claimId === targetClaimId)) {
        await pool.query(
          `insert into rni_claim_citation (
             id, claim_id, source_item_id, evidence_text, created_at
           ) values ($1, $2, $3, $4, '2026-09-05T11:01:00Z')`,
          [semantic.citationId, semantic.claimId, semantic.sourceId, semantic.evidence],
        );
      }
      await pool.query(
        `insert into rni_run_observation (
           run_id, observation_id, source_item_id, security_id, semantic_output_hash
         ) values ($1, $2, $3, $4, $5)`,
        [runId, semantic.observationId, semantic.sourceId, securityId, indexedHash(index, 0)],
      );
    }
    await pool.query(
      `insert into rni_narrative (
         id, run_id, security_id, canonical_thesis, direction, status,
         adjudicator_run_id, independent_source_count, raw_repetition_count, input_hash,
         created_at
       ) values ($1, $2, $3, 'NVDA demand next quarter', 'bullish', 'active', $4,
                 2, 2, $5, '2026-09-05T11:02:00Z')`,
      [narrativeId, runId, securityId, randomUUID(), H('f')],
    );
    for (const claimId of sortedUnique([targetClaimId, supportClaimId, lateClaimId])) {
      await pool.query(
        `insert into rni_narrative_membership (
           narrative_id, claim_id, similarity, membership_confidence, is_independent,
           adjudication_reason
         ) values ($1, $2, 1, 1, true, 'persisted shared catalyst narrative')`,
        [narrativeId, claimId],
      );
    }

    const redditArtifact = await persistAnalytics({
      id: redditAnalyticsId,
      runId,
      securityId,
      sliceId: redditSliceId,
      sourceId: targetSourceId,
      platform: 'reddit',
      score: '0.7',
      unavailable: options.unavailable === 'reddit' || options.unavailable === 'both',
      ...(options.analyticsScopeTamper === undefined
        ? {}
        : { scopeTamper: options.analyticsScopeTamper }),
    });
    const xArtifact = await persistAnalytics({
      id: xAnalyticsId,
      runId,
      securityId,
      sliceId: xSliceId,
      sourceId: xSourceId,
      platform: 'x',
      score: '0.5',
      unavailable: options.unavailable === 'x' || options.unavailable === 'both',
    });
    let convergenceArtifact = convergePlatformFacts({
      asOf: CUTOFF,
      reddit: {
        platform: 'reddit',
        runId,
        runSourceSliceId: redditSliceId,
        securityId,
        methodologyVersion: 'rni-methodology-v1',
        windowStart: redditArtifact.inputSnapshot.current.windowStart,
        windowEnd: CUTOFF,
        status: 'complete',
        stance: 'bullish',
        stanceScore: '0.7',
        dimensions: dimensions('0.7'),
        effectiveAttention: redditArtifact.result.effectiveAttention,
        dataThroughAt: '2026-09-05T11:30:00.000Z',
        analyticsArtifactHash: canonicalHash(redditArtifact),
        ...(options.unavailable === 'reddit' || options.unavailable === 'both'
          ? {
              status: 'unavailable' as const,
              stance: 'insufficient' as const,
              stanceScore: null,
              dimensions: DIMENSIONS.map((dimension) => ({
                dimension,
                stance: 'insufficient' as const,
                score: null,
              })),
              effectiveAttention: '0',
              dataThroughAt: null,
            }
          : {}),
      },
      x: {
        platform: 'x',
        runId,
        runSourceSliceId: xSliceId,
        securityId,
        methodologyVersion: 'rni-methodology-v1',
        windowStart: xArtifact.inputSnapshot.current.windowStart,
        windowEnd: CUTOFF,
        status: 'complete',
        stance: 'bullish',
        stanceScore: '0.5',
        dimensions: dimensions('0.5'),
        effectiveAttention: xArtifact.result.effectiveAttention,
        dataThroughAt: '2026-09-05T11:30:00.000Z',
        analyticsArtifactHash: canonicalHash(xArtifact),
        ...(options.unavailable === 'x' || options.unavailable === 'both'
          ? {
              status: 'unavailable' as const,
              stance: 'insufficient' as const,
              stanceScore: null,
              dimensions: DIMENSIONS.map((dimension) => ({
                dimension,
                stance: 'insufficient' as const,
                score: null,
              })),
              effectiveAttention: '0',
              dataThroughAt: null,
            }
          : {}),
      },
      policy: {
        version: 'rni-convergence-policy-v1',
        codeVersion: 'rni-cross-source-facts-v1',
        dimensionDivergenceMinimum: '0.4',
        scaleImbalanceRatioThreshold: '3',
        staleAfterHours: '24',
      },
    });
    if (options.projectionTamper !== undefined) {
      const original = convergenceArtifact.inputSnapshot;
      const changes: Partial<RniConvergenceRequest['reddit']> =
        options.projectionTamper === 'stance'
          ? { stance: 'bearish', stanceScore: '-0.9' }
          : options.projectionTamper === 'score'
            ? { stanceScore: '0.9' }
            : options.projectionTamper === 'dimensions'
              ? { dimensions: dimensions('-0.9') }
              : options.projectionTamper === 'attention'
                ? { effectiveAttention: '99' }
                : options.projectionTamper === 'status'
                  ? { status: 'partial' }
                  : { dataThroughAt: '2026-09-05T11:29:59.999999Z' };
      convergenceArtifact = convergePlatformFacts({
        ...original,
        reddit: { ...original.reddit, ...changes },
      });
    }
    await pool.query(
      `insert into rni_convergence_artifact (
         id, run_id, security_id, reddit_analytics_id, reddit_artifact_hash,
         x_analytics_id, x_artifact_hash, policy_version, calculation_code_version,
         input_hash, result_hash, input_snapshot, result_snapshot, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb,
                 $13::jsonb, $14)`,
      [
        convergenceId,
        runId,
        securityId,
        redditAnalyticsId,
        canonicalHash(redditArtifact),
        xAnalyticsId,
        canonicalHash(xArtifact),
        convergenceArtifact.policyVersion,
        convergenceArtifact.calculationCodeVersion,
        convergenceArtifact.inputHash,
        convergenceArtifact.resultHash,
        J(convergenceArtifact.inputSnapshot),
        J(convergenceArtifact.result),
        CUTOFF,
      ],
    );
    const fixture = {
      runId,
      securityId,
      otherSecurityId,
      redditSliceId,
      xSliceId,
      convergenceHash: canonicalHash(convergenceArtifact),
      targetSourceId,
      xSourceId,
      supportSourceId,
      lateSourceId,
      targetClaimId,
      targetCitationId,
      xCitationId,
      supportCitationId,
      lateCitationId,
    };
    adapter = new PostgresRniCitedSynthesisPersistence(
      intent(fixture),
      async () => activeRightsPolicy,
      pool,
    );
    return fixture;
  }

  function sortedUnique(values: readonly string[]): string[] {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
  }

  function intent(
    seedValue: Seed,
    key = `synthesis-${seedValue.runId}-${seedValue.securityId}`,
  ): RniCitedSynthesisPreparationRequest {
    return {
      runId: seedValue.runId,
      securityId: seedValue.securityId,
      convergenceArtifactHash: seedValue.convergenceHash,
      idempotencyKey: key,
      createdAt: CREATED_AT,
    };
  }

  function ports(
    seedValue: Seed,
    failures: { verifier?: boolean; challenger?: boolean } = {},
  ): {
    readonly verifier: RniVerificationInferencePort;
    readonly challenger: RniChallengerInferencePort;
  } {
    return {
      verifier: {
        verify: vi.fn(async () => {
          if (failures.verifier === true) throw new Error('verifier failed');
          return {
            assessments: [
              {
                claimId: seedValue.targetClaimId,
                verdict: 'supported',
                supportingCitationIds: [seedValue.supportCitationId],
                contradictingCitationIds: [],
              },
            ],
          };
        }),
      },
      challenger: adapter.wrapChallenger({
        challenge: vi.fn(async () => {
          if (failures.challenger === true) throw new Error('challenger failed');
          return {
            verdict: 'no_supported_challenge_found',
            challengedClaimId: null,
            citationIds: [],
          };
        }),
      }),
    };
  }

  async function publicationCount(): Promise<number> {
    const { rows } = await pool.query<{ count: string }>(
      'select count(*)::text as count from rni_cited_synthesis_artifact',
    );
    return Number(rows[0]!.count);
  }

  async function unhydratedArtifact(fixture: Seed) {
    const preparation = await adapter.prepare(intent(fixture));
    if (preparation.status !== 'ready') throw new Error('Expected ready preparation');
    let challengerInput: RniChallengerModelInput | undefined;
    const inference = ports(fixture);
    const artifact = await synthesizeCitedNarrative(
      preparation.request,
      adapter,
      inference.verifier,
      {
        challenge: async (input) => {
          challengerInput = input;
          return {
            verdict: 'no_supported_challenge_found',
            challengedClaimId: null,
            citationIds: [],
          };
        },
      },
    );
    if (challengerInput === undefined) throw new Error('Expected eligible challenger input');
    return { preparation, artifact, challengerInput };
  }

  it.each(['stance', 'score', 'dimensions', 'attention', 'status', 'freshness'] as const)(
    'rejects self-consistent E07 %s tampering against exact durable E06/E05 before preparation',
    async (projectionTamper) => {
      const fixture = await seed({ projectionTamper });
      await expect(adapter.prepare(intent(fixture))).rejects.toThrow(/projection/);
      expect(await publicationCount()).toBe(0);
      const { rows } = await pool.query<{ batches: string; invocations: string }>(
        `select (select count(*) from rni_synthesis_batch)::text as batches,
                (select count(*) from rni_synthesis_model_invocation)::text as invocations`,
      );
      expect(rows[0]).toEqual({ batches: '0', invocations: '0' });
    },
  );

  it.each(['security', 'platform'] as const)(
    'rejects self-consistent crossed E06 %s snapshots before preparation with every guard enabled',
    async (analyticsScopeTamper) => {
      const fixture = await seed({ analyticsScopeTamper });
      await expect(adapter.prepare(intent(fixture))).rejects.toThrow(
        /convergence\/component projection/,
      );
      expect(await publicationCount()).toBe(0);
      expect(
        (await pool.query<{ count: string }>('select count(*)::text from rni_synthesis_batch'))
          .rows[0]!.count,
      ).toBe('0');
    },
  );

  async function rejectsHistoricalCrossing(tamper: 'stance' | 'security' | 'platform') {
    const fixture = await seed();
    const calls = ports(fixture);
    const published = await synthesizeAndCommitCitedNarrative(
      intent(fixture),
      adapter,
      calls.verifier,
      calls.challenger,
    );
    const prior = published.artifact;
    const { rows: analyticsRows } = await pool.query<{ row: Record<string, unknown> }>(
      `select to_jsonb(stored) as row from rni_platform_analytics_artifact stored where platform = 'reddit'`,
    );
    const analyticsRow = analyticsRows[0]!.row;
    const snapshot = analyticsRow['input_snapshot'] as {
      input: RniPlatformAnalyticsArtifact['inputSnapshot'];
      methodology: RniPlatformAnalyticsArtifact['methodologySnapshot'];
    };
    const analytics = calculatePlatformAnalytics(snapshot.input, snapshot.methodology);
    expect(canonicalHash(analytics)).toBe(analyticsRow['artifact_hash']);
    const crossedAnalytics =
      tamper === 'stance' ? analytics : crossAnalyticsScope(analytics, tamper);
    const convergence: RniConvergenceArtifact = convergePlatformFacts({
      ...prior.requestSnapshot.convergenceArtifact.inputSnapshot,
      reddit: {
        ...prior.requestSnapshot.convergenceArtifact.inputSnapshot.reddit,
        ...(tamper === 'stance' ? { stance: 'bearish' as const, stanceScore: '-0.9' } : {}),
        analyticsArtifactHash: canonicalHash(crossedAnalytics),
      },
    });
    const { rows: batchRows } = await pool.query<{ id: string }>(
      'select id from rni_synthesis_batch',
    );
    const reader = new PostgresRniSynthesisEvidenceReader(
      { batchId: batchRows[0]!.id, runId: fixture.runId, securityId: fixture.securityId },
      async () => activeRightsPolicy,
      pool,
    );
    // Rehash every affected snapshot as a historical buggy writer would. The scope cases
    // keep numerical facts unchanged; after guarded reconstruction, public E08 replay
    // below proves the entire publication remains internally self-consistent.
    const crossedRequest = { ...prior.requestSnapshot, convergenceArtifact: convergence };
    const crossedModelInput = {
      ...prior.modelInputSnapshot,
      convergenceFacts: convergence.result,
    };
    const crossedResult = { ...prior.result, platformConclusions: convergence.result.platforms };
    const crossed: RniCitedSynthesisArtifact =
      tamper === 'stance'
        ? await synthesizeCitedNarrative(
            { ...prior.requestSnapshot, convergenceArtifact: convergence },
            reader,
            { verify: async () => ({ assessments: prior.verificationOutputSnapshot }) },
            { challenge: async () => prior.challengerOutputSnapshot },
          )
        : {
            ...prior,
            requestSnapshot: crossedRequest,
            modelInputSnapshot: crossedModelInput,
            result: crossedResult,
            inputHash: canonicalHash(crossedRequest),
            verificationInputHash: canonicalHash(crossedModelInput),
            challengerInputHash: canonicalHash({
              ...crossedModelInput,
              invocation: crossedRequest.challengerInvocation,
              verification: prior.verificationOutputSnapshot,
            }),
            resultHash: canonicalHash(crossedResult),
          };
    expect(crossed.result.platformConclusions.reddit.stance).toBe(
      tamper === 'stance' ? 'bearish' : 'bullish',
    );
    expect(
      crossed.requestSnapshot.convergenceArtifact.inputSnapshot.reddit.analyticsArtifactHash,
    ).toBe(canonicalHash(crossedAnalytics));
    if (tamper === 'security') {
      expect(crossedAnalytics.inputSnapshot.securityId).not.toBe(fixture.securityId);
      expect(crossedAnalytics.result.securityId).not.toBe(fixture.securityId);
    } else if (tamper === 'platform') {
      expect(crossedAnalytics.inputSnapshot.platform).toBe('x');
      expect(crossedAnalytics.result.platform).toBe('x');
    }

    // Snapshot and rebuild only this fixture's publication graph, following real INSERT,
    // hydration and terminal transitions. No trigger or constraint is disabled, and the
    // writer/validator is not mocked. This models a publication accepted by the old writer.
    const tables = [
      'rni_platform_analytics_artifact',
      'rni_convergence_artifact',
      'rni_synthesis_batch',
      'rni_synthesis_claim_input',
      'rni_synthesis_citation_role',
      'rni_synthesis_model_invocation',
      'rni_catalyst_assessment',
      'rni_challenger_selection',
      'rni_combined_summary',
      'rni_cited_synthesis_artifact',
      'rni_publication_statement',
      'rni_publication_statement_citation',
    ] as const;
    const graph = new Map<(typeof tables)[number], Record<string, unknown>[]>();
    for (const table of tables) {
      const { rows } = await pool.query<{ row: Record<string, unknown> }>(
        `select to_jsonb(stored) as row from ${table} stored`,
      );
      graph.set(
        table,
        rows.map(({ row }) => row),
      );
    }
    Object.assign(
      graph.get('rni_platform_analytics_artifact')!.find((row) => row['platform'] === 'reddit')!,
      {
        input_hash: crossedAnalytics.inputSetHash,
        result_hash: crossedAnalytics.resultHash,
        artifact_hash: canonicalHash(crossedAnalytics),
        input_snapshot: {
          input: crossedAnalytics.inputSnapshot,
          methodology: crossedAnalytics.methodologySnapshot,
        },
        result_snapshot: crossedAnalytics.result,
      },
    );
    for (const row of graph.get('rni_synthesis_citation_role')!) {
      if (row['platform'] === 'reddit' && row['analytics_artifact_hash'] !== null) {
        row['analytics_artifact_hash'] = canonicalHash(crossedAnalytics);
      }
    }
    Object.assign(graph.get('rni_convergence_artifact')![0]!, {
      reddit_artifact_hash: canonicalHash(crossedAnalytics),
      input_hash: convergence.inputHash,
      result_hash: convergence.resultHash,
      input_snapshot: convergence.inputSnapshot,
      result_snapshot: convergence.result,
    });
    Object.assign(graph.get('rni_combined_summary')![0]!, {
      status: crossed.result.summary.status,
      sections: crossed.result.summary.sections,
    });
    Object.assign(graph.get('rni_cited_synthesis_artifact')![0]!, {
      verification_input_hash: crossed.verificationInputHash,
      challenger_input_hash: crossed.challengerInputHash,
      input_hash: crossed.inputHash,
      result_hash: crossed.resultHash,
      request_snapshot: crossed.requestSnapshot,
      model_input_snapshot: crossed.modelInputSnapshot,
      verification_output_snapshot: crossed.verificationOutputSnapshot,
      challenger_output_snapshot: crossed.challengerOutputSnapshot,
      result_snapshot: crossed.result,
      statement_count: crossed.result.statements.length,
    });
    expect(crossed.result.statements).toHaveLength(prior.result.statements.length);
    for (const row of graph.get('rni_publication_statement')!) {
      const statement = crossed.result.statements[Number(row['ordinal'])]!;
      expect(statement.citationIds).toEqual(row['citation_ids']);
      Object.assign(row, {
        heading: statement.heading,
        origin: statement.origin,
        statement_text: statement.text,
        section_status: crossed.result.summary.sections.find(
          ({ heading }) => heading === statement.heading,
        )!.status,
      });
    }
    await withTransaction(async (tx) => {
      await tx.query(
        'truncate rni_platform_analytics_artifact, rni_synthesis_batch, rni_combined_summary cascade',
      );
      for (const table of tables) {
        for (const row of graph.get(table)!) {
          let inserted = row;
          let snapshot: Record<string, unknown> | undefined;
          let modelInput: unknown;
          if (table === 'rni_synthesis_model_invocation') {
            modelInput =
              row['stage'] === 'verification'
                ? crossed.modelInputSnapshot
                : {
                    ...crossed.modelInputSnapshot,
                    invocation: crossed.requestSnapshot.challengerInvocation,
                    verification: crossed.verificationOutputSnapshot,
                  };
            snapshot = {
              ...(row['prepared_snapshot'] as Record<string, unknown>),
              convergenceArtifactHash: canonicalHash(convergence),
            };
            delete snapshot['modelInput'];
            inserted = {
              ...row,
              status: 'prepared',
              output_hash: null,
              terminal_metadata: null,
              completed_at: null,
              input_hash: row['stage'] === 'verification' ? canonicalHash(modelInput) : null,
              prepared_snapshot:
                row['stage'] === 'verification' ? { ...snapshot, modelInput } : snapshot,
            };
          }
          await tx.query(
            `insert into ${table} select * from jsonb_populate_record(null::${table}, $1::jsonb)`,
            [J(inserted)],
          );
          if (table === 'rni_synthesis_model_invocation') {
            if (row['stage'] === 'challenger') {
              await tx.query(
                'update rni_synthesis_model_invocation set input_hash = $2, prepared_snapshot = $3::jsonb where id = $1',
                [row['id'], canonicalHash(modelInput), J({ ...snapshot, modelInput })],
              );
            }
            await tx.query(
              `update rni_synthesis_model_invocation set status = $2, output_hash = $3,
                 terminal_metadata = $4::jsonb, completed_at = $5 where id = $1`,
              [
                row['id'],
                row['status'],
                row['output_hash'],
                J(row['terminal_metadata']),
                row['completed_at'],
              ],
            );
          }
        }
      }
    }, pool);
    expect(await publicationCount()).toBe(1);
    expect((await pool.query<{ role: string }>('show session_replication_role')).rows[0]).toEqual({
      session_replication_role: 'origin',
    });
    const guards = await pool.query<{ disabled: string }>(
      `select count(*)::text as disabled from pg_trigger
        where tgrelid = any($1::regclass[]) and tgenabled <> 'O'`,
      [[...tables]],
    );
    expect(guards.rows[0]!.disabled).toBe('0');
    expect(await replayCitedSynthesis(crossed, reader)).toEqual(crossed);
    const historical = new PostgresRniCitedSynthesisPersistence(
      { ...intent(fixture), convergenceArtifactHash: canonicalHash(convergence) },
      async () => activeRightsPolicy,
      pool,
    );
    await expect(historical.loadAccepted(crossed.result.summary.id)).rejects.toThrow(
      tamper === 'stance' ? /overall stance projection/ : /convergence\/component projection/,
    );
  }

  it.each(['stance', 'security', 'platform'] as const)(
    'rejects a fully hash-consistent historical %s crossing on accepted load, with every database guard enabled',
    rejectsHistoricalCrossing,
  );

  it('persists selected verifier subsets and hydrates exactly the dispatched challenger input', async () => {
    const fixture = await seed({ lateEligible: true, excerptOnly: true });
    const preparation = await adapter.prepare(intent(fixture));
    if (preparation.status !== 'ready') throw new Error('Expected ready preparation');
    const planned = await pool.query<{
      stage: string;
      input_hash: string | null;
      has_input: boolean;
    }>(
      `select stage, input_hash, prepared_snapshot ? 'modelInput' as has_input
         from rni_synthesis_model_invocation order by stage`,
    );
    expect(planned.rows[0]).toEqual({ stage: 'challenger', input_hash: null, has_input: false });
    expect(planned.rows[1]).toMatchObject({ stage: 'verification', has_input: true });
    expect(preparation.request.citationIds).toContain(fixture.lateCitationId);
    const calls = ports(fixture);
    const downstream = vi.fn(async (input: RniChallengerModelInput) => {
      const { rows } = await pool.query<{ input_hash: string; model_input: unknown }>(
        `select input_hash, prepared_snapshot -> 'modelInput' as model_input
           from rni_synthesis_model_invocation where id = $1`,
        [input.invocation.modelRunId],
      );
      expect(rows[0]).toEqual({ input_hash: canonicalHash(input), model_input: input });
      expect(input.verification[0]!.supportingCitationIds).toEqual([fixture.supportCitationId]);
      return { verdict: 'no_supported_challenge_found', challengedClaimId: null, citationIds: [] };
    });
    const verifier = {
      verify: vi.fn(async (input: Parameters<RniVerificationInferencePort['verify']>[0]) => {
        const { rows } = await pool.query<{ input_hash: string; model_input: unknown }>(
          `select input_hash, prepared_snapshot -> 'modelInput' as model_input
           from rni_synthesis_model_invocation where id = $1`,
          [input.invocation.modelRunId],
        );
        expect(rows[0]).toEqual({ input_hash: canonicalHash(input), model_input: input });
        return calls.verifier.verify(input);
      }),
    };
    const result = await synthesizeAndCommitCitedNarrative(
      intent(fixture),
      adapter,
      verifier,
      adapter.wrapChallenger({ challenge: downstream }),
    );
    expect(downstream).toHaveBeenCalledTimes(1);
    expect(
      result.artifact.modelInputSnapshot.claimInputs[0]!.evidence.every(
        ({ source }) => source.captureMode === 'excerpt_only',
      ),
    ).toBe(true);
    expect(
      await loadAndReplayAcceptedCitedSynthesis(result.persistence.summaryId, adapter),
    ).toEqual(result.artifact);
    const { rows } = await pool.query<{ candidates: string; selected: string }>(
      `select (select count(*) from rni_synthesis_citation_role where evidence_role = 'corroborating')::text as candidates,
              (select jsonb_array_length(supporting_citation_ids) from rni_catalyst_assessment)::text as selected`,
    );
    expect(rows[0]).toEqual({ candidates: '2', selected: '1' });
  });

  it('binds a material challenge and all sentence edges to the selected claim-specific counterevidence', async () => {
    const fixture = await seed({ supportScore: '-0.6', lateEligible: true });
    const selected = {
      claimId: fixture.targetClaimId,
      verdict: 'contradicted',
      supportingCitationIds: [],
      contradictingCitationIds: [fixture.supportCitationId],
    };
    const accepted = await synthesizeAndCommitCitedNarrative(
      intent(fixture),
      adapter,
      { verify: async () => ({ assessments: [selected] }) },
      adapter.wrapChallenger({
        challenge: async (input) => {
          expect(input.verification).toEqual([selected]);
          return {
            verdict: 'material_challenge',
            challengedClaimId: fixture.targetClaimId,
            citationIds: [fixture.supportCitationId],
          };
        },
      }),
    );
    const { rows } = await pool.query<{
      target_claim_id: string;
      evidence_role: string;
      citation_id: string;
    }>(
      `select role.target_claim_id, role.evidence_role, edge.citation_id
         from rni_publication_statement statement
         join rni_publication_statement_citation edge on edge.statement_id = statement.id
         join rni_synthesis_citation_role role on role.id = edge.citation_role_id
        where statement.origin = 'challenged_catalyst' order by role.evidence_role`,
    );
    expect(rows).toEqual([
      {
        target_claim_id: fixture.targetClaimId,
        evidence_role: 'counterevidence',
        citation_id: fixture.supportCitationId,
      },
      {
        target_claim_id: fixture.targetClaimId,
        evidence_role: 'social_claim',
        citation_id: fixture.targetCitationId,
      },
    ]);
    expect(accepted.artifact.result.summary.sections[2]!.citationIds).not.toContain(
      fixture.lateCitationId,
    );
    expect((await adapter.loadAccepted(accepted.persistence.summaryId)).artifact).toEqual(
      accepted.artifact,
    );
  });

  it.each(['invented_claim', 'self_source', 'wrong_role', 'duplicate_selection'] as const)(
    'rejects %s verifier selection before challenger hydration or publication',
    async (kind) => {
      const fixture = await seed();
      const selected = {
        claimId: kind === 'invented_claim' ? randomUUID() : fixture.targetClaimId,
        verdict: kind === 'wrong_role' ? 'contradicted' : 'supported',
        supportingCitationIds:
          kind === 'wrong_role'
            ? []
            : kind === 'self_source'
              ? [fixture.targetCitationId]
              : kind === 'duplicate_selection'
                ? [fixture.supportCitationId, fixture.supportCitationId]
                : [fixture.supportCitationId],
        contradictingCitationIds: kind === 'wrong_role' ? [fixture.supportCitationId] : [],
      };
      const challenger = { challenge: vi.fn() };
      await expect(
        synthesizeAndCommitCitedNarrative(
          intent(fixture),
          adapter,
          { verify: async () => ({ assessments: [selected] }) },
          adapter.wrapChallenger(challenger),
        ),
      ).rejects.toThrow();
      expect(challenger.challenge).not.toHaveBeenCalled();
      expect(await publicationCount()).toBe(0);
      const { rows } = await pool.query<{ input_hash: string | null; status: string }>(
        `select input_hash, status from rni_synthesis_model_invocation where stage = 'challenger'`,
      );
      expect(rows[0]).toEqual({ input_hash: null, status: 'prepared' });
    },
  );

  it.each(['empty_claims', 'unavailable', 'unverified'] as const)(
    'publishes and replays the %s guard without invented calls or ledger rows',
    async (scenario) => {
      const fixture = await seed(
        scenario === 'empty_claims'
          ? { noCatalyst: true }
          : scenario === 'unavailable'
            ? { unavailable: 'both' }
            : {},
      );
      const verifier = {
        verify: vi.fn(async () => ({
          assessments: [
            {
              claimId: fixture.targetClaimId,
              verdict: 'unverified',
              supportingCitationIds: [],
              contradictingCitationIds: [],
            },
          ],
        })),
      };
      const challenger = { challenge: vi.fn() };
      const accepted = await synthesizeAndCommitCitedNarrative(
        intent(fixture),
        adapter,
        verifier,
        adapter.wrapChallenger(challenger),
      );
      expect(verifier.verify).toHaveBeenCalledTimes(scenario === 'unverified' ? 1 : 0);
      expect(challenger.challenge).not.toHaveBeenCalled();
      const { rows } = await pool.query<{
        stage: string;
        status: string;
        output_hash: string | null;
        terminal_metadata: unknown;
        input_hash: string;
      }>(
        `select stage, status, output_hash, terminal_metadata, input_hash from rni_synthesis_model_invocation order by stage`,
      );
      expect(rows[0]).toMatchObject({
        stage: 'challenger',
        status: 'skipped',
        output_hash: null,
        terminal_metadata: {
          outcome: 'skipped',
          reason: scenario === 'unverified' ? 'no_verified_assessments' : 'no_eligible_claims',
        },
      });
      expect(rows[0]!.input_hash).toBe(accepted.artifact.challengerInputHash);
      expect(rows[1]!.status).toBe(scenario === 'unverified' ? 'succeeded' : 'skipped');
      const ledger = await pool.query<{ count: string }>(
        'select count(*)::text as count from rni_ai_model_invocation',
      );
      expect(ledger.rows[0]!.count).toBe('0');
      expect(
        await loadAndReplayAcceptedCitedSynthesis(accepted.persistence.summaryId, adapter),
      ).toEqual(accepted.artifact);
      const repeated = await synthesizeAndCommitCitedNarrative(
        intent(fixture),
        adapter,
        { verify: vi.fn() },
        { challenge: vi.fn() },
      );
      expect(repeated.persistence.disposition).toBe('duplicate');
    },
  );

  it.each(['reddit', 'x'] as const)(
    'retains independent conclusions when %s is unavailable',
    async (platform) => {
      const fixture = await seed({ unavailable: platform });
      const inference = ports(fixture);
      const result = await synthesizeAndCommitCitedNarrative(
        intent(fixture),
        adapter,
        inference.verifier,
        inference.challenger,
      );
      expect(result.artifact.result.summary.status).toBe('partial');
      expect(result.artifact.result.platformConclusions[platform].status).toBe('unavailable');
      expect(result.artifact.requestSnapshot.platformCitationIds[platform]).toEqual([]);
      expect(
        result.artifact.requestSnapshot.platformCitationIds[platform === 'reddit' ? 'x' : 'reddit'],
      ).not.toEqual([]);
    },
  );

  it('preserves microseconds and excludes unknown or one-microsecond-late corroboration', async () => {
    const fixture = await seed({ supportPublishedAt: '2026-09-05T12:00:00.000124Z' });
    const preparation = await adapter.prepare(intent(fixture));
    if (preparation.status !== 'ready') throw new Error('Expected ready preparation');
    expect(preparation.request.createdAt).toBe(CREATED_AT);
    expect(preparation.request.claims[0]!.verificationCutoffAt).toBe(CUTOFF);
    expect(preparation.request.citationIds).not.toContain(fixture.supportCitationId);
    expect((await adapter.getEvidence(fixture.targetSourceId)).discoveredAt).toBe(
      '2026-09-05T10:05:00.123456Z',
    );
    await truncateAll(pool);
    const unknown = await seed({ supportPublishedAt: null });
    const unknownPreparation = await adapter.prepare(intent(unknown));
    if (unknownPreparation.status !== 'ready') throw new Error('Expected ready preparation');
    expect(unknownPreparation.request.citationIds).not.toContain(unknown.supportCitationId);
  });

  it('requires hydration before publication and treats concurrent exact hydration as one fill', async () => {
    const fixture = await seed();
    const { preparation, artifact, challengerInput } = await unhydratedArtifact(fixture);
    await expect(
      adapter.commitAccepted({ preparationId: preparation.preparationId, artifact }),
    ).rejects.toThrow(/prior exact input hydration/);
    await expect(
      adapter.hydrateChallengerInput({ ...challengerInput, securityId: fixture.otherSecurityId }),
    ).rejects.toThrow(/differs from validated E08/);
    await Promise.all([
      adapter.hydrateChallengerInput(challengerInput),
      adapter.hydrateChallengerInput(challengerInput),
    ]);
    await expect(
      adapter.hydrateChallengerInput({
        ...challengerInput,
        invocation: { ...challengerInput.invocation, modelId: 'crossed-model' },
      }),
    ).rejects.toThrow(/differs from validated E08/);
    const result = await adapter.commitAccepted({
      preparationId: preparation.preparationId,
      artifact,
    });
    expect(result.disposition).toBe('inserted');
    await expect(adapter.hydrateChallengerInput(challengerInput)).rejects.toThrow(
      /terminal preparation/,
    );
  });

  it('retries a challenger transport failure after hydration without another hydration update', async () => {
    const fixture = await seed();
    const first = ports(fixture, { challenger: true });
    await expect(
      synthesizeAndCommitCitedNarrative(intent(fixture), adapter, first.verifier, first.challenger),
    ).rejects.toThrow('challenger failed');
    const before = await pool.query<{ xmin: string; prepared_snapshot: unknown }>(
      `select xmin::text, prepared_snapshot from rni_synthesis_model_invocation where stage = 'challenger'`,
    );
    const preparation = await adapter.prepare(intent(fixture));
    if (preparation.status !== 'ready') throw new Error('Expected ready preparation');
    const calls = ports(fixture);
    const artifact = await synthesizeCitedNarrative(
      preparation.request,
      adapter,
      calls.verifier,
      calls.challenger,
    );
    const after = await pool.query<{ xmin: string; prepared_snapshot: unknown }>(
      `select xmin::text, prepared_snapshot from rni_synthesis_model_invocation where stage = 'challenger'`,
    );
    expect(after.rows).toEqual(before.rows);
    await adapter.commitAccepted({ preparationId: preparation.preparationId, artifact });
    expect(await publicationCount()).toBe(1);
  });

  it('rechecks active rights after inference before any publication writes', async () => {
    const fixture = await seed();
    const { preparation, artifact, challengerInput } = await unhydratedArtifact(fixture);
    await adapter.hydrateChallengerInput(challengerInput);
    activeRightsPolicy = 'rights-v2';
    await expect(
      adapter.commitAccepted({ preparationId: preparation.preparationId, artifact }),
    ).rejects.toThrow(/active rights policy/);
    expect(await publicationCount()).toBe(0);
    expect(
      (
        await pool.query<{ status: string }>('select status from rni_synthesis_model_invocation')
      ).rows.every(({ status }) => status === 'prepared'),
    ).toBe(true);
  });

  it('shares the coordinator transaction for atomic receipt/run completion and rollback', async () => {
    const fixture = await seed();
    const { preparation, artifact, challengerInput } = await unhydratedArtifact(fixture);
    await adapter.hydrateChallengerInput(challengerInput);
    await expect(
      withTransaction(async (tx) => {
        await adapter.commitAcceptedInTransaction(
          { preparationId: preparation.preparationId, artifact },
          tx,
        );
        expect(
          (await adapter.loadAcceptedInTransaction(artifact.result.summary.id, tx)).artifact,
        ).toEqual(artifact);
        await tx.query(`update rni_run set status = 'complete', completed_at = $2 where id = $1`, [
          fixture.runId,
          CREATED_AT,
        ]);
        throw new Error('combined lease expired before commit');
      }, pool),
    ).rejects.toThrow('combined lease expired');
    expect(await publicationCount()).toBe(0);
    expect(
      (
        await pool.query<{ status: string }>('select status from rni_run where id = $1', [
          fixture.runId,
        ])
      ).rows[0]!.status,
    ).toBe('running');
    await withTransaction(async (tx) => {
      await adapter.commitAcceptedInTransaction(
        { preparationId: preparation.preparationId, artifact },
        tx,
      );
      await tx.query(`update rni_run set status = 'complete', completed_at = $2 where id = $1`, [
        fixture.runId,
        CREATED_AT,
      ]);
    }, pool);
    expect(await publicationCount()).toBe(1);
    expect((await adapter.loadAccepted(artifact.result.summary.id)).artifact).toEqual(artifact);
  });

  it('publishes opposing securities from the same source independently and denies every crossed batch read', async () => {
    const fixture = await seed();
    const nvda = adapter;
    const calls = ports(fixture);
    const first = await synthesizeAndCommitCitedNarrative(
      intent(fixture),
      nvda,
      calls.verifier,
      calls.challenger,
    );
    const amdCitationIds: string[] = [];
    for (const sourceId of [fixture.targetSourceId, fixture.xSourceId]) {
      const observationId = randomUUID();
      const claimId = randomUUID();
      const citationId = randomUUID();
      amdCitationIds.push(citationId);
      await pool.query(
        `insert into rni_security_mention (source_item_id, security_id, mention_text, resolution_method, resolution_confidence)
         values ($1, $2, 'AMD', 'exact_ticker', 1)`,
        [sourceId, fixture.otherSecurityId],
      );
      await pool.query(
        `insert into rni_security_observation (
           id, source_item_id, security_id, stance, stance_score, relevance, claim_summary, dimension_assignments,
           classifier_run_id, prompt_version, model_id, input_hash, created_at
         ) values ($1, $2, $3, 'bearish', -0.6, 1, 'AMD execution faces risk', $4::jsonb,
                   $5, 'rni-classifier-v1', 'gpt-5.6-terra', $6, '2026-09-05T11:00:00Z')`,
        [
          observationId,
          sourceId,
          fixture.otherSecurityId,
          J(dimensions('-0.6')),
          randomUUID(),
          H('1'),
        ],
      );
      await pool.query(
        `insert into rni_evidence_claim (
           id, source_item_id, security_id, observation_id, claim_text, claim_type, epistemic_status,
           extractor_run_id, input_hash, created_at, dimension
         ) values ($1, $2, $3, $4, 'AMD execution faces risk', 'forecast', 'source_claim', $5, $6,
                   '2026-09-05T11:01:00Z', 'market_trading')`,
        [claimId, sourceId, fixture.otherSecurityId, observationId, randomUUID(), H('2')],
      );
      await pool.query(
        `insert into rni_claim_citation (id, claim_id, source_item_id, evidence_text)
         values ($1, $2, $3, 'AMD execution faces risk')`,
        [citationId, claimId, sourceId],
      );
      await pool.query(
        `insert into rni_run_observation (run_id, observation_id, source_item_id, security_id, semantic_output_hash)
         values ($1, $2, $3, $4, $5)`,
        [fixture.runId, observationId, sourceId, fixture.otherSecurityId, H('3')],
      );
    }
    const redditId = randomUUID();
    const xId = randomUUID();
    const reddit = await persistAnalytics({
      id: redditId,
      runId: fixture.runId,
      securityId: fixture.otherSecurityId,
      sliceId: fixture.redditSliceId,
      sourceId: fixture.targetSourceId,
      platform: 'reddit',
      score: '-0.6',
    });
    const x = await persistAnalytics({
      id: xId,
      runId: fixture.runId,
      securityId: fixture.otherSecurityId,
      sliceId: fixture.xSliceId,
      sourceId: fixture.xSourceId,
      platform: 'x',
      score: '-0.6',
    });
    const { rows } = await pool.query<{ input_snapshot: RniConvergenceRequest }>(
      'select input_snapshot from rni_convergence_artifact where run_id = $1 and security_id = $2',
      [fixture.runId, fixture.securityId],
    );
    const input = rows[0]!.input_snapshot;
    const convergence = convergePlatformFacts({
      ...input,
      reddit: {
        ...input.reddit,
        securityId: fixture.otherSecurityId,
        stance: 'bearish',
        stanceScore: '-0.6',
        dimensions: dimensions('-0.6'),
        analyticsArtifactHash: canonicalHash(reddit),
        effectiveAttention: reddit.result.effectiveAttention,
      },
      x: {
        ...input.x,
        securityId: fixture.otherSecurityId,
        stance: 'bearish',
        stanceScore: '-0.6',
        dimensions: dimensions('-0.6'),
        analyticsArtifactHash: canonicalHash(x),
        effectiveAttention: x.result.effectiveAttention,
      },
    });
    await pool.query(
      `insert into rni_convergence_artifact (
         run_id, security_id, reddit_analytics_id, reddit_artifact_hash, x_analytics_id, x_artifact_hash,
         policy_version, calculation_code_version, input_hash, result_hash, input_snapshot, result_snapshot, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13)`,
      [
        fixture.runId,
        fixture.otherSecurityId,
        redditId,
        canonicalHash(reddit),
        xId,
        canonicalHash(x),
        convergence.policyVersion,
        convergence.calculationCodeVersion,
        convergence.inputHash,
        convergence.resultHash,
        J(convergence.inputSnapshot),
        J(convergence.result),
        CUTOFF,
      ],
    );
    const amdIntent = {
      ...intent(fixture),
      securityId: fixture.otherSecurityId,
      convergenceArtifactHash: canonicalHash(convergence),
      idempotencyKey: `amd-${fixture.runId}`,
    };
    const amd = new PostgresRniCitedSynthesisPersistence(
      amdIntent,
      async () => activeRightsPolicy,
      pool,
    );
    const second = await synthesizeAndCommitCitedNarrative(
      amdIntent,
      amd,
      { verify: vi.fn() },
      { challenge: vi.fn() },
    );
    expect(first.artifact.result.platformConclusions.reddit.stance).toBe('bullish');
    expect(second.artifact.result.platformConclusions.reddit.stance).toBe('bearish');
    expect((await amd.getCitation(amdCitationIds[0]!)).sourceItemId).toBe(fixture.targetSourceId);
    await expect(amd.getCitation(fixture.targetCitationId)).rejects.toThrow(
      /outside its durable batch/,
    );
    await expect(nvda.getCitation(amdCitationIds[0]!)).rejects.toThrow(/outside its durable batch/);
    await expect(amd.getSynthesisClaim(fixture.targetClaimId)).rejects.toThrow(
      /outside its durable batch/,
    );
    await expect(
      amd.getModelInvocation(first.artifact.requestSnapshot.verificationInvocation.modelRunId),
    ).rejects.toThrow(/outside its durable batch/);
    await expect(amd.getEvidence(fixture.supportSourceId)).rejects.toThrow(
      /outside its durable batch/,
    );
    expect(
      await amd.getCitationLineage(fixture.targetClaimId, fixture.targetCitationId),
    ).toBeNull();
    await expect(amd.loadAccepted(first.persistence.summaryId)).rejects.toThrow(
      /crossed summary scope/,
    );
    await expect(amd.getActiveRightsPolicyVersion(randomUUID())).rejects.toThrow(
      /outside its durable batch/,
    );
    expect((await nvda.loadAccepted(first.persistence.summaryId)).artifact).toEqual(first.artifact);
    expect((await amd.loadAccepted(second.persistence.summaryId)).artifact).toEqual(
      second.artifact,
    );
    expect(
      (await pool.query<{ count: string }>('select count(*)::text as count from rni_source_item'))
        .rows[0]!.count,
    ).toBe('4');
    expect(await publicationCount()).toBe(2);
  });

  it.each(['input', 'edge', 'assessment', 'terminal', 'analytics'] as const)(
    'rejects accepted replay after %s relational storage drift',
    async (kind) => {
      const fixture = await seed();
      const calls = ports(fixture);
      const accepted = await synthesizeAndCommitCitedNarrative(
        intent(fixture),
        adapter,
        calls.verifier,
        calls.challenger,
      );
      await withTransaction(async (tx) => {
        await tx.query('set local session_replication_role = replica');
        if (kind === 'input')
          await tx.query(
            `update rni_synthesis_model_invocation set prepared_snapshot = jsonb_set(prepared_snapshot, '{modelInput,securityId}', to_jsonb($1::text)) where stage = 'challenger'`,
            [fixture.otherSecurityId],
          );
        if (kind === 'edge')
          await tx.query(
            `update rni_publication_statement_citation set citation_role_id = (
             select id from rni_synthesis_citation_role where citation_id = $1 and target_claim_id is not null
           ) where citation_id = $1 and statement_id in (
             select id from rni_publication_statement where origin = 'platform_conclusion')`,
            [fixture.targetCitationId],
          );
        if (kind === 'assessment')
          await tx.query(
            `update rni_catalyst_assessment set verifier_invocation_id = (
             select id from rni_synthesis_model_invocation where stage = 'challenger')`,
          );
        if (kind === 'terminal')
          await tx.query(
            `update rni_synthesis_model_invocation set completed_at = completed_at + interval '1 microsecond' where stage = 'verification'`,
          );
        if (kind === 'analytics')
          await tx.query(
            `update rni_platform_analytics_artifact set result_snapshot = jsonb_set(result_snapshot, '{effectiveAttention}', '"99"'::jsonb) where platform = 'reddit'`,
          );
      }, pool);
      await expect(adapter.loadAccepted(accepted.persistence.summaryId)).rejects.toThrow(
        /drift|invalid durable .* analytics/,
      );
      expect(canonicalInstant(accepted.artifact.result.summary.createdAt)).toBe(CREATED_AT);
    },
  );

  it('prepares only persisted lineage and atomically commits the complete accepted graph', async () => {
    const fixture = await seed();
    const preparation = await adapter.prepare(intent(fixture));
    expect(preparation.status).toBe('ready');
    if (preparation.status !== 'ready') return;
    expect(preparation.request.convergenceArtifact.result.runId).toBe(fixture.runId);
    expect(preparation.request.claims.map(({ id }) => id)).toEqual([fixture.targetClaimId]);
    expect(preparation.request.platformCitationIds).toEqual({
      reddit: [fixture.targetCitationId],
      x: [fixture.xCitationId],
    });
    expect(preparation.request.citationIds).toEqual(
      sortedUnique([fixture.targetCitationId, fixture.xCitationId, fixture.supportCitationId]),
    );
    expect(preparation.request.citationIds).not.toContain(fixture.lateCitationId);
    expect(preparation.request.verificationInvocation.modelId).toBe('gpt-5.6-sol');
    expect(preparation.request.challengerInvocation.modelId).toBe('gpt-5.6-sol');
    expect(preparation.request.verificationInvocation.modelRunId).not.toBe(
      preparation.request.challengerInvocation.modelRunId,
    );
    const preparedRows = await pool.query<{ stage: string; status: string }>(
      `select stage, status from rni_synthesis_model_invocation
        where batch_id = $1 order by stage`,
      [preparation.preparationId],
    );
    expect(preparedRows.rows).toEqual([
      { stage: 'challenger', status: 'prepared' },
      { stage: 'verification', status: 'prepared' },
    ]);

    const inference = ports(fixture);
    const accepted = await synthesizeAndCommitCitedNarrative(
      intent(fixture),
      adapter,
      inference.verifier,
      inference.challenger,
    );
    expect(accepted.persistence.disposition).toBe('inserted');
    expect(accepted.persistence.summaryId).toBe(accepted.artifact.result.summary.id);
    expect(accepted.persistence.artifactHash).toBe(canonicalHash(accepted.artifact));
    const counts = await pool.query<{
      summaries: string;
      assessments: string;
      selections: string;
      statements: string;
      edges: string;
    }>(
      `select
         (select count(*) from rni_combined_summary)::text as summaries,
         (select count(*) from rni_catalyst_assessment)::text as assessments,
         (select count(*) from rni_challenger_selection)::text as selections,
         (select count(*) from rni_publication_statement)::text as statements,
         (select count(*) from rni_publication_statement_citation)::text as edges`,
    );
    expect(counts.rows[0]).toMatchObject({ summaries: '1', assessments: '1', selections: '1' });
    expect(Number(counts.rows[0]!.statements)).toBe(accepted.artifact.result.statements.length);
    expect(Number(counts.rows[0]!.edges)).toBeGreaterThan(0);
  });

  it('returns exact sequential replay and canonical load without another model call', async () => {
    const fixture = await seed();
    const firstPorts = ports(fixture);
    const first = await synthesizeAndCommitCitedNarrative(
      intent(fixture),
      adapter,
      firstPorts.verifier,
      firstPorts.challenger,
    );
    const replayPorts = { verifier: { verify: vi.fn() }, challenger: { challenge: vi.fn() } };
    const replay = await synthesizeAndCommitCitedNarrative(
      intent(fixture),
      adapter,
      replayPorts.verifier,
      replayPorts.challenger,
    );
    const loaded = await loadAndReplayAcceptedCitedSynthesis(first.persistence.summaryId, adapter);
    expect(replay.persistence).toEqual({
      disposition: 'duplicate',
      summaryId: first.persistence.summaryId,
      artifactHash: first.persistence.artifactHash,
    });
    expect(replay.artifact).toEqual(first.artifact);
    expect(loaded).toEqual(first.artifact);
    expect(canonicalHash(loaded)).toBe(first.persistence.artifactHash);
    expect(replayPorts.verifier.verify).not.toHaveBeenCalled();
    expect(replayPorts.challenger.challenge).not.toHaveBeenCalled();
  });

  it('rejects accepted replay after any cited source loses current publication rights', async () => {
    const fixture = await seed();
    const firstPorts = ports(fixture);
    await synthesizeAndCommitCitedNarrative(
      intent(fixture),
      adapter,
      firstPorts.verifier,
      firstPorts.challenger,
    );
    await pool.query(
      `update rni_source_item
          set source_status = 'tombstoned', tombstoned_at = $2,
              tombstone_reason = 'rights withdrawn after acceptance'
        where id = $1`,
      [fixture.supportSourceId, CREATED_AT],
    );
    const replayPorts = { verifier: { verify: vi.fn() }, challenger: { challenge: vi.fn() } };
    await expect(
      synthesizeAndCommitCitedNarrative(
        intent(fixture),
        adapter,
        replayPorts.verifier,
        replayPorts.challenger,
      ),
    ).rejects.toThrow(/active rights policy|missing, restricted/);
    expect(replayPorts.verifier.verify).not.toHaveBeenCalled();
    expect(replayPorts.challenger.challenge).not.toHaveBeenCalled();
  });

  it('rejects accepted replay when the current rights authority advances', async () => {
    const fixture = await seed();
    const firstPorts = ports(fixture);
    await synthesizeAndCommitCitedNarrative(
      intent(fixture),
      adapter,
      firstPorts.verifier,
      firstPorts.challenger,
    );
    activeRightsPolicy = 'rights-v2';
    const replayPorts = { verifier: { verify: vi.fn() }, challenger: { challenge: vi.fn() } };
    await expect(
      synthesizeAndCommitCitedNarrative(
        intent(fixture),
        adapter,
        replayPorts.verifier,
        replayPorts.challenger,
      ),
    ).rejects.toThrow(/active rights policy/);
    expect(replayPorts.verifier.verify).not.toHaveBeenCalled();
    expect(replayPorts.challenger.challenge).not.toHaveBeenCalled();
  });

  it('converges concurrent exact requests on one accepted graph', async () => {
    const fixture = await seed();
    const preparations = await Promise.all([
      adapter.prepare(intent(fixture)),
      adapter.prepare(intent(fixture)),
    ]);
    expect(preparations[0]).toEqual(preparations[1]);
    const preparation = preparations[0]!;
    if (preparation.status !== 'ready') throw new Error('Expected ready preparation');
    const firstPorts = ports(fixture);
    const artifact = await synthesizeCitedNarrative(
      preparation.request,
      adapter,
      firstPorts.verifier,
      firstPorts.challenger,
    );
    const results = await Promise.all([
      adapter.commitAccepted({ preparationId: preparation.preparationId, artifact }),
      adapter.commitAccepted({ preparationId: preparation.preparationId, artifact }),
    ]);
    expect(results.map((persistence) => persistence.disposition).sort()).toEqual([
      'duplicate',
      'inserted',
    ]);
    expect(new Set(results.map((persistence) => persistence.summaryId))).toHaveLength(1);
    expect(new Set(results.map((persistence) => persistence.artifactHash))).toHaveLength(1);
    expect(await publicationCount()).toBe(1);
  });

  it('fails closed when one idempotency identity is reused for crossed intent', async () => {
    const fixture = await seed();
    const request = intent(fixture, 'fixed-key');
    adapter = new PostgresRniCitedSynthesisPersistence(
      request,
      async () => activeRightsPolicy,
      pool,
    );
    await adapter.prepare(request);
    await expect(adapter.prepare({ ...request, runId: randomUUID() })).rejects.toThrow(
      /idempotency identity reused with different intent/,
    );
    await expect(
      adapter.prepare({ ...request, securityId: fixture.otherSecurityId }),
    ).rejects.toThrow(/idempotency identity reused with different intent/);
    await expect(adapter.prepare({ ...request, convergenceArtifactHash: H('0') })).rejects.toThrow(
      /idempotency identity reused with different intent/,
    );
    expect(await publicationCount()).toBe(0);
  });

  it('rejects a wrong convergence hash before preparing invocations', async () => {
    const fixture = await seed();
    const invalid = { ...intent(fixture), convergenceArtifactHash: H('0') };
    adapter = new PostgresRniCitedSynthesisPersistence(
      invalid,
      async () => activeRightsPolicy,
      pool,
    );
    await expect(adapter.prepare(invalid)).rejects.toThrow(/exact convergence lineage/);
    const { rows } = await pool.query<{ count: string }>(
      'select count(*)::text as count from rni_synthesis_model_invocation',
    );
    expect(rows[0]!.count).toBe('0');
  });

  it('rejects crossed durable intent across fresh adapter instances and competing keys', async () => {
    const fixture = await seed();
    const request = intent(fixture);
    await adapter.prepare(request);
    for (const crossed of [
      { ...request, securityId: fixture.otherSecurityId },
      { ...request, convergenceArtifactHash: H('0') },
      { ...request, createdAt: '2026-09-05T12:05:00.654322Z' },
    ]) {
      const other = new PostgresRniCitedSynthesisPersistence(
        crossed,
        async () => activeRightsPolicy,
        pool,
      );
      await expect(other.prepare(crossed)).rejects.toThrow(
        /idempotency identity reused with different intent/,
      );
    }
    const competing = { ...request, idempotencyKey: 'different-key-same-publication' };
    const other = new PostgresRniCitedSynthesisPersistence(
      competing,
      async () => activeRightsPolicy,
      pool,
    );
    await expect(other.prepare(competing)).rejects.toThrow(/different idempotency identity/);
    expect(
      (
        await pool.query<{ count: string }>(
          'select count(*)::text as count from rni_synthesis_batch',
        )
      ).rows[0]!.count,
    ).toBe('1');
  });

  it('rejects missing active rights authority before a durable inference plan is created', async () => {
    const fixture = await seed();
    activeRightsPolicy = ' ';
    await expect(adapter.prepare(intent(fixture))).rejects.toThrow(
      /missing active rights-policy authority/,
    );
    expect(
      (
        await pool.query<{ count: string }>(
          'select count(*)::text as count from rni_synthesis_model_invocation',
        )
      ).rows[0]!.count,
    ).toBe('0');
  });

  it('rejects late platform evidence and excludes late corroboration', async () => {
    const lateTarget = await seed({ targetLate: true });
    await expect(adapter.prepare(intent(lateTarget))).rejects.toThrow(
      /reddit publication eligibility does not match convergence/,
    );
    await truncateAll(pool);
    const fixture = await seed();
    const preparation = await adapter.prepare(intent(fixture));
    expect(preparation.status).toBe('ready');
    if (preparation.status === 'ready') {
      expect(preparation.request.citationIds).not.toContain(fixture.lateCitationId);
    }
  });

  it.each([
    ['inactive rights', { targetStatus: 'tombstoned' as const }, /inactive publication-rights/],
    [
      'noncanonical Reddit URL',
      { targetCanonicalUrl: 'https://www.reddit.com.attacker.test/r/stocks/comments/target/' },
      /noncanonical Reddit or X/,
    ],
    [
      'noncanonical X URL',
      { xCanonicalUrl: 'https://x.com/someone/status/1000000000000000001' },
      /noncanonical Reddit or X/,
    ],
  ] as const)('rejects %s before model dispatch', async (_label, options, pattern) => {
    const fixture = await seed(options);
    await expect(adapter.prepare(intent(fixture))).rejects.toThrow(pattern);
  });

  it('rejects missing citations and never promotes a self-source as corroboration', async () => {
    const missing = await seed({ omitTargetCitation: true });
    await expect(adapter.prepare(intent(missing))).rejects.toThrow(
      /reddit publication eligibility does not match convergence/,
    );
    await truncateAll(pool);
    const self = await seed({ supportAliasesTarget: true });
    const preparation = await adapter.prepare(intent(self));
    expect(preparation.status).toBe('ready');
    if (preparation.status === 'ready') {
      expect(preparation.request.citationIds).toEqual(
        sortedUnique([self.targetCitationId, self.xCitationId]),
      );
    }
  });

  it.each(['verifier', 'challenger'] as const)(
    'leaves no publication when the %s fails',
    async (failure) => {
      const fixture = await seed();
      const inference = ports(fixture, { [failure]: true });
      await expect(
        synthesizeAndCommitCitedNarrative(
          intent(fixture),
          adapter,
          inference.verifier,
          inference.challenger,
        ),
      ).rejects.toThrow(`${failure} failed`);
      expect(await publicationCount()).toBe(0);
      const { rows } = await pool.query<{ status: string }>(
        'select status from rni_synthesis_model_invocation order by stage',
      );
      expect(rows).toEqual([{ status: 'prepared' }, { status: 'prepared' }]);
    },
  );

  it('rolls back a late statement-citation failure without a partially publishable graph', async () => {
    const fixture = await seed();
    const preparation = await adapter.prepare(intent(fixture));
    expect(preparation.status).toBe('ready');
    if (preparation.status !== 'ready') return;
    const inference = ports(fixture);
    const artifact = await synthesizeCitedNarrative(
      preparation.request,
      adapter,
      inference.verifier,
      inference.challenger,
    );
    await pool.query(`
      create function rni_test_fail_late_edge() returns trigger language plpgsql as $$
      begin
        if new.citation_ordinal = 1 then raise exception 'forced late edge failure'; end if;
        return new;
      end $$;
      create trigger rni_test_fail_late_edge
        before insert on rni_publication_statement_citation
        for each row execute function rni_test_fail_late_edge();
    `);
    await expect(
      adapter.commitAccepted({ preparationId: preparation.preparationId, artifact }),
    ).rejects.toThrow(/forced late edge failure/);
    expect(await publicationCount()).toBe(0);
    const { rows } = await pool.query<{
      summaries: string;
      assessments: string;
      statements: string;
      edges: string;
      terminal: string;
    }>(
      `select
         (select count(*) from rni_combined_summary)::text as summaries,
         (select count(*) from rni_catalyst_assessment)::text as assessments,
         (select count(*) from rni_publication_statement)::text as statements,
         (select count(*) from rni_publication_statement_citation)::text as edges,
         (select count(*) from rni_synthesis_model_invocation where status <> 'prepared')::text
           as terminal`,
    );
    expect(rows[0]).toEqual({
      summaries: '0',
      assessments: '0',
      statements: '0',
      edges: '0',
      terminal: '0',
    });
  });

  it('rejects crossed model storage and accepted-artifact drift', async () => {
    const fixture = await seed();
    const preparation = await adapter.prepare(intent(fixture));
    expect(preparation.status).toBe('ready');
    if (preparation.status !== 'ready') return;
    await pool.query(
      'alter table rni_synthesis_model_invocation disable trigger rni_synthesis_model_invocation_content_immutable',
    );
    await pool.query(
      'alter table rni_synthesis_model_invocation disable trigger rni_synthesis_model_invocation_transition',
    );
    await pool.query(
      `update rni_synthesis_model_invocation set model_id = 'crossed-model' where stage = 'verification'`,
    );
    await expect(
      adapter.getModelInvocation(preparation.request.verificationInvocation.modelRunId),
    ).rejects.toThrow(/model invocation descriptor|model invocation storage drift/);
    await pool.query(
      `update rni_synthesis_model_invocation set model_id = 'gpt-5.6-sol' where stage = 'verification'`,
    );
    await pool.query(
      'alter table rni_synthesis_model_invocation enable trigger rni_synthesis_model_invocation_transition',
    );
    await pool.query(
      'alter table rni_synthesis_model_invocation enable trigger rni_synthesis_model_invocation_content_immutable',
    );
    const inference = ports(fixture);
    const accepted = await synthesizeAndCommitCitedNarrative(
      intent(fixture),
      adapter,
      inference.verifier,
      inference.challenger,
    );
    await pool.query(
      'alter table rni_cited_synthesis_artifact disable trigger rni_cited_synthesis_artifact_append_only',
    );
    await pool.query(
      `update rni_cited_synthesis_artifact set result_snapshot = '{}'::jsonb where id = $1`,
      [accepted.persistence.summaryId],
    );
    await expect(adapter.loadAccepted(accepted.persistence.summaryId)).rejects.toThrow(
      /accepted artifact storage drift|combined summary storage drift/,
    );
  });
});
