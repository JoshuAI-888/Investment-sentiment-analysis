import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';

import { closePool, getPool } from '../../../../src/repositories/client';
import { loadMigrations } from '../../../../src/repositories/migrate';
import { databaseUrl, makePool, resetSchema } from '../../helpers/db';

const url = databaseUrl();
const H = (value: string) => value.repeat(64);
const J = (value: unknown) => JSON.stringify(value);

const ids = {
  run: '00000000-0000-4000-8000-000000001901',
  nvda: '00000000-0000-4000-8000-000000001902',
  amd: '00000000-0000-4000-8000-000000001903',
  redditSlice: '00000000-0000-4000-8000-000000001904',
  xSlice: '00000000-0000-4000-8000-000000001905',
  targetSource: '00000000-0000-4000-8000-000000001910',
  supportSource: '00000000-0000-4000-8000-000000001911',
  xSource: '00000000-0000-4000-8000-000000001912',
  unknownSource: '00000000-0000-4000-8000-000000001913',
  lateSource: '00000000-0000-4000-8000-000000001914',
  amdSource: '00000000-0000-4000-8000-000000001915',
  targetObservation: '00000000-0000-4000-8000-000000001920',
  supportObservation: '00000000-0000-4000-8000-000000001921',
  xObservation: '00000000-0000-4000-8000-000000001922',
  unknownObservation: '00000000-0000-4000-8000-000000001923',
  lateObservation: '00000000-0000-4000-8000-000000001924',
  amdObservation: '00000000-0000-4000-8000-000000001925',
  targetClaim: '00000000-0000-4000-8000-000000001930',
  supportClaim: '00000000-0000-4000-8000-000000001931',
  xClaim: '00000000-0000-4000-8000-000000001932',
  unknownClaim: '00000000-0000-4000-8000-000000001933',
  lateClaim: '00000000-0000-4000-8000-000000001934',
  amdClaim: '00000000-0000-4000-8000-000000001935',
  targetCitation: '00000000-0000-4000-8000-000000001940',
  supportCitation: '00000000-0000-4000-8000-000000001941',
  xCitation: '00000000-0000-4000-8000-000000001942',
  unknownCitation: '00000000-0000-4000-8000-000000001943',
  lateCitation: '00000000-0000-4000-8000-000000001944',
  amdCitation: '00000000-0000-4000-8000-000000001945',
  redditAnalytics: '00000000-0000-4000-8000-000000001950',
  xAnalytics: '00000000-0000-4000-8000-000000001951',
  convergence: '00000000-0000-4000-8000-000000001952',
  batch: '00000000-0000-4000-8000-000000001960',
  verifier: '00000000-0000-4000-8000-000000001961',
  challenger: '00000000-0000-4000-8000-000000001962',
  targetRole: '00000000-0000-4000-8000-000000001970',
  supportRole: '00000000-0000-4000-8000-000000001971',
  redditPlatformRole: '00000000-0000-4000-8000-000000001972',
  xPlatformRole: '00000000-0000-4000-8000-000000001973',
  counterCandidateRole: '00000000-0000-4000-8000-000000001974',
  summary: '00000000-0000-4000-8000-000000001980',
  redditStatement: '00000000-0000-4000-8000-000000001981',
  xStatement: '00000000-0000-4000-8000-000000001982',
  combinedStatement: '00000000-0000-4000-8000-000000001983',
  catalystStatement: '00000000-0000-4000-8000-000000001984',
  usageBatch: '00000000-0000-4000-8000-000000001990',
  usageVerifier: '00000000-0000-4000-8000-000000001991',
  usageChallenger: '00000000-0000-4000-8000-000000001992',
} as const;

const cutoff = '2026-09-05T01:00:00.000Z';
const policy = 'rni-cited-synthesis-policy-v1';
const rights = 'rni-source-policy-v1';
const WEB_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const UPGRADE_PATH = path.join(WEB_ROOT, 'migrations/0024_rni_universe_upgrade.sql');

describe.skipIf(url === undefined)('D-RNI-19 — durable cited-synthesis schema', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = makePool();
    if (url !== undefined) getPool(url);
  });

  afterAll(async () => {
    await closePool();
    await pool?.end();
  });

  beforeEach(async () => {
    await resetSchema(pool);
  });

  async function seedBase(options: {
    readonly targetCanonicalUrl?: string;
    readonly xCanonicalUrl?: string;
  } = {}): Promise<void> {
    await pool.query('begin');
    try {
      const config = await pool.query<{ id: string }>(
        `insert into config_version
           (environment, status, created_by, change_reason, checksum, activated_at)
         values ('test', 'active', 'owner', 'test', 'checksum', now()) returning id`,
      );
      const universe = await pool.query<{ id: string }>(
        `insert into universe_version
           (environment, config_version, status, selected_count, created_by, change_reason)
         values ('test', $1, 'draft', 0, 'owner', 'test') returning id`,
        [config.rows[0]!.id],
      );
      await pool.query(
        `insert into security (id, symbol, name, exchange, asset_type, currency) values
           ($1, 'NVDA', 'NVIDIA Corporation', 'NASDAQ', 'equity', 'USD'),
           ($2, 'AMD', 'Advanced Micro Devices', 'NASDAQ', 'equity', 'USD')`,
        [ids.nvda, ids.amd],
      );
      await pool.query(
        `insert into rni_run
           (id, idempotency_key, trigger, status, window_start, window_end,
            universe_version, config_version, prompt_version, ai_route, requested_at, created_at)
         values ($1, 'rni-19', 'manual', 'complete', '2026-09-04T00:00:00Z', $2,
                 $3, $4, 'rni-prompts-v1', 'openai_direct', '2026-09-05T00:00:00Z',
                 '2026-09-05T00:00:00Z')`,
        [ids.run, cutoff, universe.rows[0]!.id, config.rows[0]!.id],
      );
      await pool.query(
        `insert into rni_platform_slice
           (id, run_id, platform, status, eligible_source_count, coverage_disclosure, data_through_at)
         values
           ($1, $3, 'reddit', 'complete', 4, 'Sampled Reddit coverage', $4),
           ($2, $3, 'x', 'complete', 1, 'Configured X coverage', $4)`,
        [ids.redditSlice, ids.xSlice, ids.run, cutoff],
      );

      const sources = [
        [ids.targetSource, 'reddit', 'post', 't3_target', options.targetCanonicalUrl ?? 'https://www.reddit.com/r/stocks/comments/target/', 'Target catalyst claim', '2026-09-05T00:00:00Z'],
        [ids.supportSource, 'reddit', 'post', 't3_support', 'https://www.reddit.com/r/stocks/comments/support/', 'Separate social corroboration', '2026-09-05T00:01:00Z'],
        [ids.xSource, 'x', 'x_post', '1900000000000000001', options.xCanonicalUrl ?? 'https://x.com/i/web/status/1900000000000000001', 'X platform observation', '2026-09-05T00:02:00Z'],
        [ids.unknownSource, 'reddit', 'post', 't3_unknown', 'https://www.reddit.com/r/stocks/comments/unknown/', 'Unknown publication time', null],
        [ids.lateSource, 'reddit', 'post', 't3_late', 'https://www.reddit.com/r/stocks/comments/late/', 'Late publication time', '2026-09-05T02:00:00Z'],
        [ids.amdSource, 'reddit', 'post', 't3_amd', 'https://www.reddit.com/r/stocks/comments/amd/', 'AMD evidence', '2026-09-05T00:03:00Z'],
      ] as const;
      for (const [id, platformName, kind, externalId, canonicalUrl, content, publishedAt] of sources) {
        await pool.query(
          `insert into rni_source_item
             (id, platform, source_kind, external_id, canonical_url, original_url,
              subreddit_or_scope, bounded_content, content_sha256, capture_mode, published_at,
              discovered_at, observed_at, rights_policy_version, created_at)
           values ($1, $2, $3, $4, $5, $5, $6, $7, $8, 'excerpt_only', $9,
                   '2026-09-05T00:10:00Z', '2026-09-05T00:11:00Z', $10,
                   '2026-09-05T00:11:01Z')`,
          [
            id,
            platformName,
            kind,
            externalId,
            canonicalUrl,
            platformName === 'reddit' ? 'r/stocks' : 'configured-watch',
            content,
            H('a'),
            publishedAt,
            rights,
          ],
        );
      }

      const evidence = [
        [ids.targetSource, ids.nvda, ids.targetObservation, ids.targetClaim, ids.targetCitation, 'Target catalyst claim'],
        [ids.supportSource, ids.nvda, ids.supportObservation, ids.supportClaim, ids.supportCitation, 'Separate social corroboration'],
        [ids.xSource, ids.nvda, ids.xObservation, ids.xClaim, ids.xCitation, 'X platform observation'],
        [ids.unknownSource, ids.nvda, ids.unknownObservation, ids.unknownClaim, ids.unknownCitation, 'Unknown publication time'],
        [ids.lateSource, ids.nvda, ids.lateObservation, ids.lateClaim, ids.lateCitation, 'Late publication time'],
        [ids.amdSource, ids.amd, ids.amdObservation, ids.amdClaim, ids.amdCitation, 'AMD evidence'],
      ] as const;
      for (const [sourceId, securityId, observationId, claimId, citationId, text] of evidence) {
        await pool.query(
          `insert into rni_security_mention
             (source_item_id, security_id, mention_text, resolution_method, resolution_confidence)
           values ($1, $2, 'ticker', 'exact_ticker', 1)`,
          [sourceId, securityId],
        );
        await pool.query(
          `insert into rni_security_observation
             (id, source_item_id, security_id, stance, stance_score, relevance, claim_summary,
              dimension_assignments, classifier_run_id, prompt_version, model_id, input_hash, created_at)
           values ($1, $2, $3, 'bullish', 0.5, 1, $4, $5, gen_random_uuid(),
                   'rni-classifier-v1', 'fixture-model', $6, '2026-09-05T00:20:00Z')`,
          [
            observationId,
            sourceId,
            securityId,
            text,
            J([{ dimension: 'catalyst_event', stance: 'bullish', score: '0.5', rationale: text }]),
            H(claimId.slice(-1)),
          ],
        );
        await pool.query(
          `insert into rni_evidence_claim
             (id, source_item_id, security_id, observation_id, claim_text, claim_type,
              epistemic_status, extractor_run_id, input_hash, created_at, dimension)
           values ($1, $2, $3, $4, $5, 'opinion', 'source_claim', gen_random_uuid(), $6,
                   '2026-09-05T00:21:00Z', 'catalyst_event')`,
          [claimId, sourceId, securityId, observationId, text, H(citationId.slice(-1))],
        );
        await pool.query(
          `insert into rni_claim_citation (id, claim_id, source_item_id, evidence_text)
           values ($1, $2, $3, $4)`,
          [citationId, claimId, sourceId, text],
        );
        await pool.query(
          `insert into rni_run_observation
             (run_id, observation_id, source_item_id, security_id, semantic_output_hash)
           values ($1, $2, $3, $4, $5)`,
          [ids.run, observationId, sourceId, securityId, H(observationId.slice(-1))],
        );
      }

      await pool.query(
        `insert into rni_platform_analytics_artifact
           (id, run_id, platform_slice_id, platform, security_id, methodology_version,
            calculation_code_version, input_hash, result_hash, artifact_hash,
            input_snapshot, result_snapshot, created_at)
         values
           ($1, $3, $4, 'reddit', $6, 'rni-method-v1', 'rni-platform-analytics-v1',
            $7, $8, $9, '{}', '{}', '2026-09-05T00:30:00Z'),
           ($2, $3, $5, 'x', $6, 'rni-method-v1', 'rni-platform-analytics-v1',
            $10, $11, $12, '{}', '{}', '2026-09-05T00:30:00Z')`,
        [
          ids.redditAnalytics,
          ids.xAnalytics,
          ids.run,
          ids.redditSlice,
          ids.xSlice,
          ids.nvda,
          H('a'), H('b'), H('c'), H('d'), H('e'), H('f'),
        ],
      );
      await pool.query(
        `insert into rni_convergence_artifact
           (id, run_id, security_id, reddit_analytics_id, reddit_artifact_hash,
            x_analytics_id, x_artifact_hash, policy_version, calculation_code_version,
            input_hash, result_hash, input_snapshot, result_snapshot, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, 'rni-convergence-policy-v1',
                 'rni-cross-source-facts-v1', $8, $9, '{}', '{}',
                 '2026-09-05T00:40:00Z')`,
        [
          ids.convergence, ids.run, ids.nvda, ids.redditAnalytics, H('c'),
          ids.xAnalytics, H('f'), H('1'), H('2'),
        ],
      );
      await pool.query('commit');
    } catch (error) {
      await pool.query('rollback');
      throw error;
    }
  }

  async function seedPreparedSynthesis(options: {
    readonly verifier?: 'succeeded' | 'skipped';
    readonly challenger?: 'succeeded' | 'skipped';
    readonly skipReason?: 'no_eligible_claims' | 'no_verified_assessments';
  } = {}): Promise<void> {
    const verifierStatus = options.verifier ?? 'succeeded';
    const challengerStatus = options.challenger ?? 'succeeded';
    const unverified = verifierStatus === 'skipped' || challengerStatus === 'skipped';
    await pool.query(
      `insert into rni_synthesis_batch
         (id, run_id, security_id, assessment_cutoff_at, policy_version,
          rights_policy_version, ordered_citation_ids, reddit_platform_citation_ids,
          x_platform_citation_ids, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, '2026-09-05T01:01:00Z')`,
      [
        ids.batch, ids.run, ids.nvda, cutoff, policy, rights,
        J([ids.targetCitation, ids.supportCitation, ids.xCitation]),
        J([ids.targetCitation]), J([ids.xCitation]),
      ],
    );
    await pool.query(
      `insert into rni_synthesis_claim_input
         (batch_id, run_id, security_id, assessment_cutoff_at, policy_version,
          rights_policy_version, ordinal, claim_id, source_item_id, observation_id,
          platform, source_citation_ids)
       values ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, 'reddit', $10)`,
      [
        ids.batch, ids.run, ids.nvda, cutoff, policy, rights, ids.targetClaim,
        ids.targetSource, ids.targetObservation, J([ids.targetCitation]),
      ],
    );
    const roleSql = `insert into rni_synthesis_citation_role
      (id, batch_id, run_id, security_id, assessment_cutoff_at, policy_version,
       rights_policy_version, target_claim_id, citation_id, evidence_claim_id,
       source_item_id, observation_id, platform, evidence_role,
       analytics_artifact_id, analytics_artifact_hash)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`;
    await pool.query(roleSql, [
      ids.targetRole, ids.batch, ids.run, ids.nvda, cutoff, policy, rights,
      ids.targetClaim, ids.targetCitation, ids.targetClaim, ids.targetSource,
      ids.targetObservation, 'reddit', 'social_claim', null, null,
    ]);
    await pool.query(roleSql, [
      ids.supportRole, ids.batch, ids.run, ids.nvda, cutoff, policy, rights,
      ids.targetClaim, ids.supportCitation, ids.supportClaim, ids.supportSource,
      ids.supportObservation, 'reddit', 'corroborating', null, null,
    ]);
    await pool.query(roleSql, [
      ids.counterCandidateRole, ids.batch, ids.run, ids.nvda, cutoff, policy, rights,
      ids.targetClaim, ids.xCitation, ids.xClaim, ids.xSource,
      ids.xObservation, 'x', 'counterevidence', null, null,
    ]);
    await pool.query(roleSql, [
      ids.redditPlatformRole, ids.batch, ids.run, ids.nvda, cutoff, policy, rights,
      null, ids.targetCitation, ids.targetClaim, ids.targetSource,
      ids.targetObservation, 'reddit', 'social_claim', ids.redditAnalytics, H('c'),
    ]);
    await pool.query(roleSql, [
      ids.xPlatformRole, ids.batch, ids.run, ids.nvda, cutoff, policy, rights,
      null, ids.xCitation, ids.xClaim, ids.xSource,
      ids.xObservation, 'x', 'social_claim', ids.xAnalytics, H('f'),
    ]);

    for (const [invocationId, stage, inputHash] of [
      [ids.verifier, 'verification', H('3')],
      [ids.challenger, 'challenger', H('4')],
    ] as const) {
      await pool.query(
        `insert into rni_synthesis_model_invocation
           (id, batch_id, stage, model_id, model_revision, prompt_version,
            ordered_claim_ids, input_hash, prepared_snapshot, prepared_at)
         values ($1, $2, $3, 'gpt-5.6-sol', '2026-09-01', $4, $5, $6, '{}',
                 '2026-09-05T01:01:00Z')`,
        [invocationId, ids.batch, stage, `rni-${stage}-v2`, J([ids.targetClaim]), inputHash],
      );
      const status = stage === 'verification' ? verifierStatus : challengerStatus;
      await pool.query(
        `update rni_synthesis_model_invocation
            set status = $2, output_hash = $3,
                terminal_metadata = $4, completed_at = '2026-09-05T01:02:00Z'
          where id = $1`,
        status === 'succeeded'
          ? [
              invocationId,
              status,
              stage === 'verification' ? H('5') : H('6'),
              J({ outcome: 'succeeded', responseId: `response-${stage}`, usage: { inputTokens: 10, outputTokens: 4 } }),
            ]
          : [
              invocationId,
              status,
              null,
              J({ outcome: 'skipped', reason: options.skipReason ?? 'no_eligible_claims' }),
            ],
      );
    }
    await pool.query(
      `insert into rni_catalyst_assessment
         (batch_id, run_id, security_id, assessment_cutoff_at, policy_version,
          rights_policy_version, claim_id, verifier_invocation_id, verdict,
          supporting_citation_ids, contradicting_citation_ids, assessment_hash)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '[]', $11)`,
      [
        ids.batch, ids.run, ids.nvda, cutoff, policy, rights, ids.targetClaim,
        ids.verifier,
        unverified ? 'unverified' : 'supported',
        J(unverified ? [] : [ids.supportCitation]),
        H('7'),
      ],
    );
    await pool.query(
      `insert into rni_challenger_selection
         (batch_id, challenger_invocation_id, verdict, challenged_claim_id,
          citation_ids, selection_hash)
       values ($1, $2, $3, null, '[]', $4)`,
      [
        ids.batch,
        ids.challenger,
        unverified ? 'insufficient' : 'no_supported_challenge_found',
        H('8'),
      ],
    );
  }

  async function publishHappy(options: {
    readonly omitRedditEdge?: boolean;
    readonly combinedText?: string;
    readonly combinedStatus?: 'complete' | 'partial' | 'insufficient';
    readonly combinedCitationIds?: readonly string[];
    readonly unverified?: boolean;
  } = {}): Promise<void> {
    const unverified = options.unverified ?? false;
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into rni_combined_summary
           (id, run_id, security_id, reddit_platform_slice_id, x_platform_slice_id,
            status, sections, created_at)
         values ($1, $2, $3, $4, $5, 'complete', $6, '2026-09-05T01:03:00Z')`,
        [
          ids.summary, ids.run, ids.nvda, ids.redditSlice, ids.xSlice,
          J([
            { heading: 'Reddit sentiment', status: 'complete', text: 'Reddit is bullish.', citationIds: [ids.targetCitation] },
            { heading: 'X sentiment', status: 'complete', text: 'X is bullish.', citationIds: [ids.xCitation] },
            {
              heading: 'Combined summary',
              status: options.combinedStatus ?? 'complete',
              text: options.combinedText ?? (unverified
                ? 'The cited platform conclusions align.'
                : 'The cited platform conclusions align. Separate social evidence corroborates the catalyst claim.'),
              citationIds: options.combinedCitationIds ?? (unverified
                ? [ids.targetCitation, ids.xCitation]
                : [ids.targetCitation, ids.supportCitation, ids.xCitation]),
            },
          ]),
        ],
      );
      await client.query(
        `insert into rni_cited_synthesis_artifact
           (id, run_id, security_id, batch_id, convergence_artifact_id,
            verifier_invocation_id, verification_input_hash,
            challenger_invocation_id, challenger_input_hash,
            calculation_code_version, policy_version, input_hash, result_hash,
            request_snapshot, model_input_snapshot, verification_output_snapshot,
            challenger_output_snapshot, result_snapshot, statement_count, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                 'rni-cited-synthesis-v1', $10, $11, $12,
                 '{}', '{}', $13, $14, '{}', $15, '2026-09-05T01:03:00Z')`,
        [
          ids.summary, ids.run, ids.nvda, ids.batch, ids.convergence,
          ids.verifier, H('3'), ids.challenger, H('4'), policy, H('9'), H('a'),
          J([{
            claimId: ids.targetClaim,
            verdict: unverified ? 'unverified' : 'supported',
            supportingCitationIds: unverified ? [] : [ids.supportCitation],
            contradictingCitationIds: [],
          }]),
          J({
            verdict: unverified ? 'insufficient' : 'no_supported_challenge_found',
            challengedClaimId: null,
            citationIds: [],
          }),
          unverified ? 3 : 4,
        ],
      );
      const statements = [
        [ids.redditStatement, 0, 'Reddit sentiment', 'complete', 'platform_conclusion', 'Reddit is bullish.', [ids.targetCitation]],
        [ids.xStatement, 1, 'X sentiment', 'complete', 'platform_conclusion', 'X is bullish.', [ids.xCitation]],
        [ids.combinedStatement, 2, 'Combined summary', 'complete', 'cross_source_fact', 'The cited platform conclusions align.', [ids.targetCitation, ids.xCitation]],
        ...(unverified ? [] : [[ids.catalystStatement, 3, 'Combined summary', 'complete', 'corroborated_catalyst', 'Separate social evidence corroborates the catalyst claim.', [ids.targetCitation, ids.supportCitation]] as const]),
      ] as const;
      for (const [statementId, ordinal, heading, sectionStatus, origin, text, citationIds] of statements) {
        await client.query(
          `insert into rni_publication_statement
             (id, synthesis_id, batch_id, ordinal, heading, section_status, origin,
              statement_text, citation_ids)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            statementId, ids.summary, ids.batch, ordinal, heading, sectionStatus,
            origin, text, J(citationIds),
          ],
        );
      }
      const edges = [
        [ids.redditStatement, 0, ids.redditPlatformRole, ids.targetCitation],
        [ids.xStatement, 0, ids.xPlatformRole, ids.xCitation],
        [ids.combinedStatement, 0, ids.redditPlatformRole, ids.targetCitation],
        [ids.combinedStatement, 1, ids.xPlatformRole, ids.xCitation],
        ...(unverified ? [] : [
          [ids.catalystStatement, 0, ids.targetRole, ids.targetCitation] as const,
          [ids.catalystStatement, 1, ids.supportRole, ids.supportCitation] as const,
        ]),
      ] as const;
      for (const [statementId, ordinal, roleId, citationId] of edges) {
        if (options.omitRedditEdge === true && statementId === ids.redditStatement) continue;
        await client.query(
          `insert into rni_publication_statement_citation
             (statement_id, synthesis_id, batch_id, citation_ordinal,
              citation_role_id, citation_id)
           values ($1, $2, $3, $4, $5, $6)`,
          [statementId, ids.summary, ids.batch, ordinal, roleId, citationId],
        );
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  it('applies on a clean schema with the complete durable artifact graph', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name = any($1) order by table_name`,
      [[
        'rni_catalyst_assessment',
        'rni_challenger_selection',
        'rni_cited_synthesis_artifact',
        'rni_convergence_artifact',
        'rni_platform_analytics_artifact',
        'rni_publication_statement',
        'rni_publication_statement_citation',
        'rni_synthesis_batch',
        'rni_synthesis_citation_role',
        'rni_synthesis_claim_input',
        'rni_synthesis_model_invocation',
      ]],
    );
    expect(rows).toHaveLength(11);
  });

  it('preserves combined summaries that predate the future-insert publication trigger', async () => {
    await pool.query('drop schema public cascade; create schema public;');
    const migrations = await loadMigrations();
    for (const migration of migrations.filter(({ filename }) => filename < '0024_')) {
      await pool.query(migration.sql);
    }
    const config = await pool.query<{ id: string }>(
      `insert into config_version
         (environment, status, created_by, change_reason, checksum, activated_at)
       values ('test', 'active', 'owner', 'historical', 'checksum', now()) returning id`,
    );
    const universe = await pool.query<{ id: string }>(
      `insert into universe_version
         (environment, config_version, status, selected_count, created_by, change_reason)
       values ('test', $1, 'draft', 0, 'owner', 'historical') returning id`,
      [config.rows[0]!.id],
    );
    await pool.query(
      `insert into security (id, symbol, name, exchange, asset_type, currency)
       values ($1, 'NVDA', 'NVIDIA Corporation', 'NASDAQ', 'equity', 'USD')`,
      [ids.nvda],
    );
    await pool.query('begin');
    await pool.query(
      `insert into rni_run
         (id, idempotency_key, trigger, status, window_start, window_end,
          universe_version, config_version, prompt_version, requested_at)
       values ($1, 'historical', 'manual', 'complete', '2026-09-04T00:00:00Z', $2,
               $3, $4, 'prompt-v1', '2026-09-05T00:00:00Z')`,
      [ids.run, cutoff, universe.rows[0]!.id, config.rows[0]!.id],
    );
    await pool.query(
      `insert into rni_platform_slice
         (id, run_id, platform, status, coverage_disclosure)
       values ($1, $3, 'reddit', 'complete', 'Historical Reddit'),
              ($2, $3, 'x', 'complete', 'Historical X')`,
      [ids.redditSlice, ids.xSlice, ids.run],
    );
    await pool.query('commit');
    await pool.query(
      `insert into rni_combined_summary
         (id, run_id, security_id, reddit_platform_slice_id, x_platform_slice_id,
          status, sections, created_at)
       values ($1, $2, $3, $4, $5, 'insufficient', $6, '2026-09-05T00:30:00Z')`,
      [
        ids.summary, ids.run, ids.nvda, ids.redditSlice, ids.xSlice,
        J([
          { heading: 'Reddit sentiment', status: 'insufficient', text: 'Historical.', citationIds: [] },
          { heading: 'X sentiment', status: 'insufficient', text: 'Historical.', citationIds: [] },
          { heading: 'Combined summary', status: 'insufficient', text: 'Historical.', citationIds: [] },
        ]),
      ],
    );
    await pool.query(await readFile(UPGRADE_PATH, 'utf8'));
    const { rows } = await pool.query<{ id: string }>(
      `select id from rni_combined_summary where id = $1`,
      [ids.summary],
    );
    expect(rows).toEqual([{ id: ids.summary }]);
  });

  it('commits selected verifier citations from a larger immutable candidate set', async () => {
    await seedBase();
    await seedPreparedSynthesis();
    await publishHappy();

    const { rows: invocations } = await pool.query(
      `select id, stage, status, ordered_claim_ids from rni_synthesis_model_invocation
        order by stage`,
    );
    expect(invocations).toEqual([
      { id: ids.challenger, stage: 'challenger', status: 'succeeded', ordered_claim_ids: [ids.targetClaim] },
      { id: ids.verifier, stage: 'verification', status: 'succeeded', ordered_claim_ids: [ids.targetClaim] },
    ]);
    const { rows: selections } = await pool.query(
      `select supporting_citation_ids, contradicting_citation_ids
         from rni_catalyst_assessment where batch_id = $1`,
      [ids.batch],
    );
    expect(selections).toEqual([{
      supporting_citation_ids: [ids.supportCitation],
      contradicting_citation_ids: [],
    }]);
    const { rows: edges } = await pool.query(
      `select statement_id, citation_ordinal, citation_id
         from rni_publication_statement_citation
        order by statement_id, citation_ordinal`,
    );
    expect(edges).toEqual([
      { statement_id: ids.redditStatement, citation_ordinal: 0, citation_id: ids.targetCitation },
      { statement_id: ids.xStatement, citation_ordinal: 0, citation_id: ids.xCitation },
      { statement_id: ids.combinedStatement, citation_ordinal: 0, citation_id: ids.targetCitation },
      { statement_id: ids.combinedStatement, citation_ordinal: 1, citation_id: ids.xCitation },
      { statement_id: ids.catalystStatement, citation_ordinal: 0, citation_id: ids.targetCitation },
      { statement_id: ids.catalystStatement, citation_ordinal: 1, citation_id: ids.supportCitation },
    ]);
  });

  it.each([
    ['both no-eligible-claim plans', { verifier: 'skipped', challenger: 'skipped', skipReason: 'no_eligible_claims' }],
    ['the no-verified-assessment challenger plan', { verifier: 'succeeded', challenger: 'skipped', skipReason: 'no_verified_assessments' }],
  ] as const)('publishes deterministic output with %s explicitly skipped', async (_label, options) => {
    await seedBase();
    await seedPreparedSynthesis(options);
    await publishHappy({ unverified: true });

    const { rows } = await pool.query(
      `select stage, status, terminal_metadata from rni_synthesis_model_invocation
        where batch_id = $1 order by stage`,
      [ids.batch],
    );
    expect(rows).toEqual([
      {
        stage: 'challenger',
        status: 'skipped',
        terminal_metadata: { outcome: 'skipped', reason: options.skipReason },
      },
      options.verifier === 'skipped'
        ? {
            stage: 'verification',
            status: 'skipped',
            terminal_metadata: { outcome: 'skipped', reason: 'no_eligible_claims' },
          }
        : expect.objectContaining({ stage: 'verification', status: 'succeeded' }),
    ]);
  });

  it('rejects a skipped challenger reason that contradicts successful all-unverified verification', async () => {
    await seedBase();
    await seedPreparedSynthesis({
      verifier: 'succeeded',
      challenger: 'skipped',
      skipReason: 'no_eligible_claims',
    });
    await expect(publishHappy({ unverified: true })).rejects.toThrow(
      /all-unverified publication requires the challenger plan to be skipped/,
    );
  });

  it('rejects a future combined summary committed without its complete cited artifact graph', async () => {
    await seedBase();
    await expect(
      pool.query(
        `insert into rni_combined_summary
           (id, run_id, security_id, reddit_platform_slice_id, x_platform_slice_id,
            status, sections, created_at)
         values ($1, $2, $3, $4, $5, 'complete', $6, '2026-09-05T01:03:00Z')`,
        [
          ids.summary, ids.run, ids.nvda, ids.redditSlice, ids.xSlice,
          J([
            { heading: 'Reddit sentiment', status: 'complete', text: 'Reddit is bullish.', citationIds: [ids.targetCitation] },
            { heading: 'X sentiment', status: 'complete', text: 'X is bullish.', citationIds: [ids.xCitation] },
            { heading: 'Combined summary', status: 'complete', text: 'Aligned.', citationIds: [ids.targetCitation, ids.xCitation] },
          ]),
        ],
      ),
    ).rejects.toThrow(/requires one complete cited synthesis artifact/);
  });

  it('rejects summary status, text or citation projections that diverge from ordered statements', async () => {
    await seedBase();
    await seedPreparedSynthesis();
    for (const mismatch of [
      { combinedText: 'Caller-authored replacement.' },
      { combinedStatus: 'partial' as const },
      { combinedCitationIds: [ids.targetCitation, ids.xCitation] },
    ]) {
      await expect(publishHappy(mismatch)).rejects.toThrow(
        /exactly project ordered publication statements/,
      );
    }
  });

  it.each([
    ['reddit attacker host', { targetCanonicalUrl: 'https://www.reddit.com.attacker.test/r/stocks/comments/target/' }],
    ['reddit noncanonical form', { targetCanonicalUrl: 'https://www.reddit.com/user/stocks/comments/target/' }],
    ['x attacker host', { xCanonicalUrl: 'https://x.com.attacker.test/i/web/status/1900000000000000001' }],
    ['x noncanonical form', { xCanonicalUrl: 'https://x.com/someone/status/1900000000000000001' }],
  ] as const)('rejects %s at publication time', async (_label, options) => {
    await seedBase(options);
    await expect(seedPreparedSynthesis()).rejects.toThrow(/strict canonical Reddit or X URL/);
  });

  it('rejects unknown nested usage fields and string secrets for successful and failed calls', async () => {
    await seedBase();
    await pool.query(
      `insert into rni_synthesis_batch
         (id, run_id, security_id, assessment_cutoff_at, policy_version,
          rights_policy_version, ordered_citation_ids, reddit_platform_citation_ids,
          x_platform_citation_ids, created_at)
       values ($1, $2, $3, $4, $5, $6, '[]', '[]', '[]', '2026-09-05T01:01:00Z')`,
      [ids.usageBatch, ids.run, ids.nvda, cutoff, policy, rights],
    );
    for (const [invocationId, stage] of [
      [ids.usageVerifier, 'verification'],
      [ids.usageChallenger, 'challenger'],
    ] as const) {
      await pool.query(
        `insert into rni_synthesis_model_invocation
           (id, batch_id, stage, model_id, model_revision, prompt_version,
            ordered_claim_ids, input_hash, prepared_snapshot, prepared_at)
         values ($1, $2, $3, 'gpt-5.6-sol', '2026-09-01', 'prompt-v1',
                 '[]', $4, '{}', '2026-09-05T01:01:00Z')`,
        [invocationId, ids.usageBatch, stage, stage === 'verification' ? H('b') : H('c')],
      );
    }
    await expect(
      pool.query(
        `update rni_synthesis_model_invocation
            set status = 'succeeded', output_hash = $2, terminal_metadata = $3,
                completed_at = '2026-09-05T01:02:00Z'
          where id = $1`,
        [
          ids.usageVerifier,
          H('d'),
          J({ outcome: 'succeeded', usage: { inputTokens: 'secret', hiddenPrompt: 'secret' } }),
        ],
      ),
    ).rejects.toThrow(/terminal_check/);
    await expect(
      pool.query(
        `update rni_synthesis_model_invocation
            set status = 'failed', terminal_metadata = $2,
                completed_at = '2026-09-05T01:02:00Z'
          where id = $1`,
        [
          ids.usageChallenger,
          J({
            outcome: 'failed',
            errorCode: 'provider_failure',
            usage: { outputTokens: 'secret', providerPayload: 'secret' },
          }),
        ],
      ),
    ).rejects.toThrow(/terminal_check/);
  });

  it('rejects a cross-security citation role', async () => {
    await seedBase();
    await pool.query(
      `insert into rni_synthesis_batch
         (id, run_id, security_id, assessment_cutoff_at, policy_version,
          rights_policy_version, ordered_citation_ids, reddit_platform_citation_ids,
          x_platform_citation_ids, created_at)
       values ($1, $2, $3, $4, $5, $6, '[]', '[]', '[]', '2026-09-05T01:01:00Z')`,
      [ids.batch, ids.run, ids.nvda, cutoff, policy, rights],
    );
    await expect(
      pool.query(
        `insert into rni_synthesis_citation_role
           (batch_id, run_id, security_id, assessment_cutoff_at, policy_version,
            rights_policy_version, citation_id, evidence_claim_id, source_item_id,
            observation_id, platform, evidence_role, analytics_artifact_id,
            analytics_artifact_hash)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'reddit',
                 'social_claim', $11, $12)`,
        [
          ids.batch, ids.run, ids.nvda, cutoff, policy, rights, ids.amdCitation,
          ids.amdClaim, ids.amdSource, ids.amdObservation, ids.redditAnalytics, H('c'),
        ],
      ),
    ).rejects.toThrow(/evidence_claim_fk|run_observation_fk/);
  });

  it.each([
    ['unknown', ids.unknownCitation, ids.unknownClaim, ids.unknownSource, ids.unknownObservation],
    ['late', ids.lateCitation, ids.lateClaim, ids.lateSource, ids.lateObservation],
  ] as const)('rejects %s-publication corroboration', async (_label, citationId, claimId, sourceId, observationId) => {
    await seedBase();
    await pool.query(
      `insert into rni_synthesis_batch
         (id, run_id, security_id, assessment_cutoff_at, policy_version,
          rights_policy_version, ordered_citation_ids, reddit_platform_citation_ids,
          x_platform_citation_ids, created_at)
       values ($1, $2, $3, $4, $5, $6, '[]', '[]', '[]', '2026-09-05T01:01:00Z')`,
      [ids.batch, ids.run, ids.nvda, cutoff, policy, rights],
    );
    await pool.query(
      `insert into rni_synthesis_claim_input
         (batch_id, run_id, security_id, assessment_cutoff_at, policy_version,
          rights_policy_version, ordinal, claim_id, source_item_id, observation_id,
          platform, source_citation_ids)
       values ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, 'reddit', $10)`,
      [
        ids.batch, ids.run, ids.nvda, cutoff, policy, rights, ids.targetClaim,
        ids.targetSource, ids.targetObservation, J([ids.targetCitation]),
      ],
    );
    await expect(
      pool.query(
        `insert into rni_synthesis_citation_role
           (batch_id, run_id, security_id, assessment_cutoff_at, policy_version,
            rights_policy_version, target_claim_id, citation_id, evidence_claim_id,
            source_item_id, observation_id, platform, evidence_role)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'reddit', 'corroborating')`,
        [
          ids.batch, ids.run, ids.nvda, cutoff, policy, rights, ids.targetClaim,
          citationId, claimId, sourceId, observationId,
        ],
      ),
    ).rejects.toThrow(/known publication by the cutoff/);
  });

  it('rejects catalyst self-citation under a second role', async () => {
    await seedBase();
    await pool.query(
      `insert into rni_synthesis_batch
         (id, run_id, security_id, assessment_cutoff_at, policy_version,
          rights_policy_version, ordered_citation_ids, reddit_platform_citation_ids,
          x_platform_citation_ids, created_at)
       values ($1, $2, $3, $4, $5, $6, '[]', '[]', '[]', '2026-09-05T01:01:00Z')`,
      [ids.batch, ids.run, ids.nvda, cutoff, policy, rights],
    );
    await pool.query(
      `insert into rni_synthesis_claim_input
         (batch_id, run_id, security_id, assessment_cutoff_at, policy_version,
          rights_policy_version, ordinal, claim_id, source_item_id, observation_id,
          platform, source_citation_ids)
       values ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, 'reddit', $10)`,
      [
        ids.batch, ids.run, ids.nvda, cutoff, policy, rights, ids.targetClaim,
        ids.targetSource, ids.targetObservation, J([ids.targetCitation]),
      ],
    );
    await expect(
      pool.query(
        `insert into rni_synthesis_citation_role
           (batch_id, run_id, security_id, assessment_cutoff_at, policy_version,
            rights_policy_version, target_claim_id, citation_id, evidence_claim_id,
            source_item_id, observation_id, platform, evidence_role)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $7, $9, $10, 'reddit', 'corroborating')`,
        [
          ids.batch, ids.run, ids.nvda, cutoff, policy, rights, ids.targetClaim,
          ids.targetCitation, ids.targetSource, ids.targetObservation,
        ],
      ),
    ).rejects.toThrow(/cannot self-cite/);
  });

  it('rejects wrong-platform and wrong-hash convergence analytics lineage', async () => {
    await seedBase();
    await expect(
      pool.query(
        `insert into rni_convergence_artifact
           (run_id, security_id, reddit_analytics_id, reddit_artifact_hash,
            x_analytics_id, x_artifact_hash, policy_version, calculation_code_version,
            input_hash, result_hash, input_snapshot, result_snapshot, created_at)
         values ($1, $2, $3, $4, $5, $6, 'policy-v2', 'code-v1', $7, $8,
                 '{}', '{}', '2026-09-05T00:41:00Z')`,
        [ids.run, ids.nvda, ids.xAnalytics, H('f'), ids.redditAnalytics, H('0'), H('b'), H('c')],
      ),
    ).rejects.toThrow(/reddit_analytics_fk|x_analytics_fk/);
  });

  it('rejects shared or wrong-stage verifier/challenger lineage', async () => {
    await seedBase();
    await seedPreparedSynthesis();
    const attemptArtifact = async (shared: boolean): Promise<void> => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query(
          `insert into rni_combined_summary
             (id, run_id, security_id, reddit_platform_slice_id, x_platform_slice_id,
              status, sections, created_at)
           values ($1, $2, $3, $4, $5, 'complete', $6, '2026-09-05T01:03:00Z')`,
          [
            ids.summary, ids.run, ids.nvda, ids.redditSlice, ids.xSlice,
            J([
              { heading: 'Reddit sentiment', status: 'complete', text: 'Reddit.', citationIds: [] },
              { heading: 'X sentiment', status: 'complete', text: 'X.', citationIds: [] },
              { heading: 'Combined summary', status: 'complete', text: 'Combined.', citationIds: [] },
            ]),
          ],
        );
        await expect(client.query(
        `insert into rni_cited_synthesis_artifact
           (id, run_id, security_id, batch_id, convergence_artifact_id,
            verifier_invocation_id, verification_input_hash,
            challenger_invocation_id, challenger_input_hash,
            calculation_code_version, policy_version, input_hash, result_hash,
            request_snapshot, model_input_snapshot, verification_output_snapshot,
            challenger_output_snapshot, result_snapshot, statement_count, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'code-v1', $10, $11, $12,
                 '{}', '{}', '[]', '{}', '{}', 3, '2026-09-05T01:03:00Z')`,
        [
          ids.summary, ids.run, ids.nvda, ids.batch, ids.convergence,
          shared ? ids.verifier : ids.challenger,
          shared ? H('3') : H('4'),
          ids.verifier,
          H('3'),
          policy,
          H('d'),
          H('e'),
        ],
        )).rejects.toThrow(
          shared ? /distinct_invocations|challenger_fk/ : /verifier_fk|challenger_fk/,
        );
      } finally {
        await client.query('rollback');
        client.release();
      }
    };
    await attemptArtifact(false);
    await attemptArtifact(true);
  });

  it('rejects a non-coverage statement whose declared citation lacks its deferred edge', async () => {
    await seedBase();
    await seedPreparedSynthesis();
    await expect(publishHappy({ omitRedditEdge: true })).rejects.toThrow(
      /citation edges|requires a citation/,
    );
  });

  it('rejects mutation of immutable artifacts and a second invocation lifecycle change', async () => {
    await seedBase();
    await seedPreparedSynthesis();
    await publishHappy();
    await expect(
      pool.query(`update rni_platform_analytics_artifact set result_snapshot = '{"changed":true}' where id = $1`, [ids.redditAnalytics]),
    ).rejects.toThrow(/append-only/);
    await expect(
      pool.query(`delete from rni_cited_synthesis_artifact where id = $1`, [ids.summary]),
    ).rejects.toThrow(/append-only/);
    await expect(
      pool.query(
        `update rni_synthesis_model_invocation
            set completed_at = '2026-09-05T01:04:00Z' where id = $1`,
        [ids.verifier],
      ),
    ).rejects.toThrow(/one prepared-to-terminal transition/);
  });
});
