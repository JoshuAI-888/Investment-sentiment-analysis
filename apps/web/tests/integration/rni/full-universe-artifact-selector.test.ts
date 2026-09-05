import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { canonicalHash } from '../../../src/calc/canonical';
import { convergePlatformFacts } from '../../../src/rni/convergence';
import {
  selectRniFullUniversePublicationInput,
  selectRniFullUniversePublicationMember,
  validateRniFullUniversePublicationAtCommit,
} from '../../../src/rni/repositories/full-universe-artifact-selector';
import { buildRniFullUniversePublication } from '../../../src/rni/orchestration/full-universe-publication';
import { tombstoneRniSource } from '../../../src/rni/repositories/source-states';
import {
  REDDIT_SLICE_ID,
  RUN_ID,
  SECURITY_ID,
  X_SLICE_ID,
  convergenceRequest,
} from '../../unit/rni/convergence/fixtures';
import { databaseUrl, makePool, resetSchema, truncateAll } from '../helpers/db';

const PLAN_HASH = 'c'.repeat(64);
const MANIFEST_HASH = 'd'.repeat(64);
const MEMBER_SET_HASH = 'e'.repeat(64);
const UNIVERSE_VERSION = '42';
const CUTOFF = '2026-09-05T12:00:00.000000Z';
const BATCH_ID = '00000000-0000-4000-8000-000000000707';
const CITED_SYNTHESIS_ID = '00000000-0000-4000-8000-000000000705';
const CONVERGENCE_ID = '00000000-0000-4000-8000-000000000706';

const request = {
  runId: RUN_ID,
  planHash: PLAN_HASH,
  runManifestHash: MANIFEST_HASH,
  universeVersion: UNIVERSE_VERSION,
  memberSetHash: MEMBER_SET_HASH,
  securityId: SECURITY_ID,
  assessmentCutoffAt: CUTOFF,
  slices: { reddit: REDDIT_SLICE_ID, x: X_SLICE_ID },
} as const;

type SeedOptions = {
  readonly batchCutoff?: string;
  readonly batchRightsPolicyVersion?: string;
  readonly convergenceArtifactHash?: string | null;
  readonly inactiveEvidence?: boolean;
  readonly activeEvidence?: boolean;
  readonly redditSliceStatus?: 'complete' | 'pending';
  readonly summarySlices?: {
    readonly reddit: string;
    readonly x: string;
  };
};

function summaryFixture() {
  return {
    id: CITED_SYNTHESIS_ID,
    runId: RUN_ID,
    securityId: SECURITY_ID,
    status: 'complete' as const,
    sections: ['Reddit sentiment', 'X sentiment', 'Combined summary'].map((heading) => ({
      heading,
      status: 'complete' as const,
      text: `${heading} coverage.`,
      citationIds: [],
    })),
    createdAt: '2026-09-05T12:01:00.000000Z',
  };
}

async function seedAcceptedLineage(pool: pg.Pool, options: SeedOptions = {}): Promise<void> {
  const artifact = convergePlatformFacts(convergenceRequest({ asOf: CUTOFF }));
  const summary = summaryFixture();
  const citedResult = {
    summary,
    platformConclusions: artifact.result.platforms,
    statements: [],
    verification: [],
    challenger: {},
    interpretation: 'deterministic_citation_gated_no_pooled_metric',
  };
  const convergenceHash = canonicalHash(artifact);
  const batchCutoff = options.batchCutoff ?? CUTOFF;
  const batchRights = options.batchRightsPolicyVersion ?? 'rni-source-policy-v1';
  const summarySlices = options.summarySlices ?? {
    reddit: REDDIT_SLICE_ID,
    x: X_SLICE_ID,
  };
  const client = await pool.connect();
  try {
    await client.query('begin');
    // This fixture manufactures already-accepted upstream E07/E08 state. Replica mode is local
    // to this transaction and is reset before the selector performs its real joins and locks.
    await client.query('set local session_replication_role = replica');
    await client.query(
      `insert into rni_run
       (id,idempotency_key,trigger,status,window_start,window_end,comparison_start,
        comparison_end,universe_version,config_version,prompt_version,ai_route,requested_at)
       values ($1,'selector-pg-fixture','manual','running','2026-09-04T12:00:00Z',$2,
        '2026-09-03T12:00:00Z','2026-09-04T12:00:00Z',$3,7,'prompt-set-v1',
        'openai_direct','2026-09-05T11:55:00Z')`,
      [RUN_ID, CUTOFF, UNIVERSE_VERSION],
    );
    await client.query(
      `insert into rni_platform_slice
       (id,run_id,platform,status,coverage_disclosure)
       values ($1,$3,'reddit',$4,'Exact Reddit fixture coverage'),
              ($2,$3,'x','complete','Exact X fixture coverage')`,
      [REDDIT_SLICE_ID, X_SLICE_ID, RUN_ID, options.redditSliceStatus ?? 'complete'],
    );
    await client.query(
      `insert into rni_orchestration_execution
       (run_id,partition,job_run_id,plan_hash,coalesce_key,coalesce_until,deadline,
        admitted_cost_usd,remaining_admission_usd,admitted_at,record)
       values ($1,'test',gen_random_uuid(),$2,$3,'2026-09-05T12:02:00Z',
        '2026-09-05T13:00:00Z',25,25,'2026-09-05T11:55:00Z',$4)`,
      [
        RUN_ID,
        PLAN_HASH,
        'f'.repeat(64),
        JSON.stringify({ version: 'rni-execution-v2', runManifestHash: MANIFEST_HASH }),
      ],
    );
    await client.query(
      `insert into rni_worker_run_manifest
       (run_id,manifest_version,environment,partition,job_run_id,plan_hash,run_manifest_hash,
        member_set_version,member_set_hash,member_count,config_version,universe_version,
        scope_kind,accepted_at,deadline,manifest)
       select $1,'rni-worker-manifest-v2','test','test',execution.job_run_id,$2,$3,
        'rni-worker-member-set-v1',$4,501,7,$5,'full_universe',
        '2026-09-05T11:55:00Z','2026-09-05T13:00:00Z',$6
       from rni_orchestration_execution execution where execution.run_id = $1`,
      [
        RUN_ID,
        PLAN_HASH,
        MANIFEST_HASH,
        MEMBER_SET_HASH,
        UNIVERSE_VERSION,
        JSON.stringify({
          windows: { assessmentCutoffAt: CUTOFF },
          source: { rightsPolicy: { version: 'rni-source-policy-v1' } },
        }),
      ],
    );
    await client.query(
      `insert into rni_worker_run_manifest_member
       (run_id,universe_version,ordinal,security_id,ticker,company_name,exchange,asset_type,
        currency,aliases,selection_source,provider_symbol,provider_company_name)
       values ($1,$2,1,$3,'NVDA','NVIDIA Corporation','NASDAQ','equity','USD','[]',
        'fmp_sp500_constituent','NVDA','NVIDIA Corporation')`,
      [RUN_ID, UNIVERSE_VERSION, SECURITY_ID],
    );
    await client.query(
      `insert into rni_platform_analytics_artifact
       (id,run_id,platform_slice_id,platform,security_id,methodology_version,
        calculation_code_version,input_hash,result_hash,artifact_hash,input_snapshot,
        result_snapshot,created_at)
       values
       ('00000000-0000-4000-8000-000000000711',$1,$2,'reddit',$4,'rni-methodology-v1',
        'analytics-v1',$5,$6,$7,'{}','{}','2026-09-05T12:00:30Z'),
       ('00000000-0000-4000-8000-000000000712',$1,$3,'x',$4,'rni-methodology-v1',
        'analytics-v1',$8,$9,$10,'{}','{}','2026-09-05T12:00:30Z')`,
      [
        RUN_ID,
        REDDIT_SLICE_ID,
        X_SLICE_ID,
        SECURITY_ID,
        '1'.repeat(64),
        '2'.repeat(64),
        artifact.inputSnapshot.reddit.analyticsArtifactHash,
        '3'.repeat(64),
        '4'.repeat(64),
        artifact.inputSnapshot.x.analyticsArtifactHash,
      ],
    );
    await client.query(
      `insert into rni_convergence_artifact
       (id,run_id,security_id,reddit_analytics_id,reddit_artifact_hash,x_analytics_id,
        x_artifact_hash,policy_version,calculation_code_version,input_hash,result_hash,
        input_snapshot,result_snapshot,created_at,artifact_hash)
       values ($1,$2,$3,'00000000-0000-4000-8000-000000000711',$4,
        '00000000-0000-4000-8000-000000000712',$5,$6,$7,$8,$9,$10,$11,
        '2026-09-05T12:00:40Z',$12)`,
      [
        CONVERGENCE_ID,
        RUN_ID,
        SECURITY_ID,
        artifact.inputSnapshot.reddit.analyticsArtifactHash,
        artifact.inputSnapshot.x.analyticsArtifactHash,
        artifact.policyVersion,
        artifact.calculationCodeVersion,
        artifact.inputHash,
        artifact.resultHash,
        JSON.stringify(artifact.inputSnapshot),
        JSON.stringify(artifact.result),
        options.convergenceArtifactHash === undefined
          ? convergenceHash
          : options.convergenceArtifactHash,
      ],
    );
    await client.query(
      `insert into rni_synthesis_batch
       (id,run_id,security_id,assessment_cutoff_at,policy_version,rights_policy_version,
        ordered_citation_ids,reddit_platform_citation_ids,x_platform_citation_ids,created_at)
       values ($1,$2,$3,$4,'rni-cited-synthesis-policy-v1',$5,'[]','[]','[]',
        '2026-09-05T12:01:00Z')`,
      [BATCH_ID, RUN_ID, SECURITY_ID, batchCutoff, batchRights],
    );
    await client.query(
      `insert into rni_combined_summary
       (id,run_id,security_id,reddit_platform_slice_id,x_platform_slice_id,status,sections,
        created_at)
       values ($1,$2,$3,$4,$5,'complete',$6,'2026-09-05T12:01:00Z')`,
      [
        CITED_SYNTHESIS_ID,
        RUN_ID,
        SECURITY_ID,
        summarySlices.reddit,
        summarySlices.x,
        JSON.stringify(summary.sections),
      ],
    );
    await client.query(
      `insert into rni_cited_synthesis_artifact
       (id,run_id,security_id,batch_id,convergence_artifact_id,verifier_invocation_id,
        verification_input_hash,challenger_invocation_id,challenger_input_hash,
        calculation_code_version,policy_version,input_hash,result_hash,request_snapshot,
        model_input_snapshot,verification_output_snapshot,challenger_output_snapshot,
        result_snapshot,statement_count,created_at)
       values ($1,$2,$3,$4,$5,'00000000-0000-4000-8000-000000000713',$6,
        '00000000-0000-4000-8000-000000000714',$7,'rni-cited-synthesis-v1',
        'rni-cited-synthesis-policy-v1',$8,$9,$10,'{}','[]','{}',$11,3,
        '2026-09-05T12:01:00Z')`,
      [
        CITED_SYNTHESIS_ID,
        RUN_ID,
        SECURITY_ID,
        BATCH_ID,
        CONVERGENCE_ID,
        '5'.repeat(64),
        '6'.repeat(64),
        '7'.repeat(64),
        canonicalHash(citedResult),
        JSON.stringify({ convergenceArtifact: artifact }),
        JSON.stringify(citedResult),
      ],
    );
    if (options.inactiveEvidence === true || options.activeEvidence === true) {
      const sourceStatus = options.inactiveEvidence === true ? 'restricted' : 'active';
      await client.query(
        `insert into rni_source_item
         (id,platform,source_kind,external_id,canonical_url,original_url,subreddit_or_scope,
          bounded_content,content_sha256,capture_mode,published_at,discovered_at,observed_at,
          rights_policy_version,source_status,tombstoned_at,tombstone_reason)
         values ('00000000-0000-4000-8000-000000000719','reddit','post','inactive-fixture',
          'https://www.reddit.com/r/stocks/comments/inactive-fixture',
          'https://www.reddit.com/r/stocks/comments/inactive-fixture','r/stocks',
          'Withdrawn fixture evidence.',$1,'full_post','2026-09-05T11:00:00Z',
          '2026-09-05T11:30:00Z','2026-09-05T11:30:00Z',$2,$3,
          case when $3='active' then null else '2026-09-05T12:02:00Z'::timestamptz end,
          case when $3='active' then null else 'fixture rights withdrawal' end)`,
        ['8'.repeat(64), batchRights, sourceStatus],
      );
      await client.query(
        `insert into rni_synthesis_citation_role
         (id,batch_id,run_id,security_id,assessment_cutoff_at,policy_version,
          rights_policy_version,target_claim_id,citation_id,evidence_claim_id,source_item_id,
          observation_id,platform,evidence_role)
         values ('00000000-0000-4000-8000-000000000715',$1,$2,$3,$4,
          'rni-cited-synthesis-policy-v1',$5,'00000000-0000-4000-8000-000000000716',
          '00000000-0000-4000-8000-000000000717',
          '00000000-0000-4000-8000-000000000718',
          '00000000-0000-4000-8000-000000000719',
          '00000000-0000-4000-8000-000000000720','reddit','corroborating')`,
        [BATCH_ID, RUN_ID, SECURITY_ID, batchCutoff, batchRights],
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

describe.skipIf(databaseUrl() === undefined)(
  'D-RNI-33 — PostgreSQL full-universe artifact selector',
  () => {
    let pool: pg.Pool;

    beforeAll(async () => {
      pool = makePool();
      await resetSchema(pool);
    }, 60_000);

    beforeEach(async () => {
      await truncateAll(pool);
      await seedAcceptedLineage(pool);
    });

    afterAll(async () => {
      await pool.end();
    });

    async function reseed(options: SeedOptions): Promise<void> {
      await truncateAll(pool);
      await seedAcceptedLineage(pool, options);
    }

    async function select(
      selectionRequest: Parameters<typeof selectRniFullUniversePublicationMember>[0],
    ) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const selected = await selectRniFullUniversePublicationMember(selectionRequest, client);
        await client.query('commit');
        return selected;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    }

    it('selects one exact accepted v2 E08/E07 lineage through real joins and locks', async () => {
      expect(
        (await pool.query<{ session_replication_role: string }>('show session_replication_role'))
          .rows[0],
      ).toEqual({ session_replication_role: 'origin' });
      await expect(select(request)).resolves.toEqual({
        runId: RUN_ID,
        planHash: PLAN_HASH,
        runManifestHash: MANIFEST_HASH,
        universeVersion: UNIVERSE_VERSION,
        assessmentCutoffAt: CUTOFF,
        memberSetHash: MEMBER_SET_HASH,
        ordinal: 1,
        securityId: SECURITY_ID,
        citedSynthesisId: CITED_SYNTHESIS_ID,
        citedSynthesisResultHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        convergenceArtifactId: CONVERGENCE_ID,
        convergenceArtifactHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        status: 'complete',
      });
    });

    it('fails closed on crossed manifest, slice, and assessment-cutoff requests', async () => {
      await expect(
        select({ ...request, runManifestHash: '0'.repeat(64) }),
      ).rejects.toThrow('crossed manifest, execution, run, member, universe, or cutoff identity');
      await expect(
        select({ ...request, slices: { reddit: X_SLICE_ID, x: REDDIT_SLICE_ID } }),
      ).rejects.toThrow('crossed cited-synthesis, convergence, platform-slice');
      await expect(
        select({ ...request, assessmentCutoffAt: '2026-09-05T12:00:01Z' }),
      ).rejects.toThrow('crossed manifest, execution, run, member, universe, or cutoff identity');
    });

    it('fails closed on crossed batch rights and cutoff lineage', async () => {
      await reseed({ batchRightsPolicyVersion: 'rni-source-policy-v2' });
      await expect(select(request)).rejects.toThrow(
        'crossed cited-synthesis, convergence, platform-slice, rights, or cutoff lineage',
      );

      await reseed({ batchCutoff: '2026-09-05T11:59:59Z' });
      await expect(select(request)).rejects.toThrow(
        'crossed cited-synthesis, convergence, platform-slice, rights, or cutoff lineage',
      );
    });

    it('fails closed when accepted evidence is missing or inactive at selection time', async () => {
      await reseed({ inactiveEvidence: true });
      await expect(select(request)).rejects.toThrow(
        'withdrawn or rights-ineligible publication evidence',
      );
    });

    it('reselects under the final transaction and rejects evidence withdrawn after preparation', async () => {
      await reseed({ activeEvidence: true });
      const authority = {
        manifest: {
          runId: RUN_ID,
          planHash: PLAN_HASH,
          runManifestHash: MANIFEST_HASH,
          universeVersion: UNIVERSE_VERSION,
          assessmentCutoffAt: CUTOFF,
          memberSetHash: MEMBER_SET_HASH,
          members: [{ ordinal: 1, securityId: SECURITY_ID }],
        },
        platforms: {
          reddit: {
            runId: RUN_ID,
            planHash: PLAN_HASH,
            runManifestHash: MANIFEST_HASH,
            universeVersion: UNIVERSE_VERSION,
            assessmentCutoffAt: CUTOFF,
            memberSetHash: MEMBER_SET_HASH,
            platform: 'reddit' as const,
            sliceId: REDDIT_SLICE_ID,
            status: 'complete' as const,
            outcomeHash: '9'.repeat(64),
          },
          x: {
            runId: RUN_ID,
            planHash: PLAN_HASH,
            runManifestHash: MANIFEST_HASH,
            universeVersion: UNIVERSE_VERSION,
            assessmentCutoffAt: CUTOFF,
            memberSetHash: MEMBER_SET_HASH,
            platform: 'x' as const,
            sliceId: X_SLICE_ID,
            status: 'complete' as const,
            outcomeHash: 'a'.repeat(64),
          },
        },
      };
      const preparation = await selectRniFullUniversePublicationInput(authority, pool);
      const publication = buildRniFullUniversePublication(preparation);

      await tombstoneRniSource(
        '00000000-0000-4000-8000-000000000719',
        'restricted',
        'rights withdrawn after preparation',
        '2026-09-05T12:02:00.000Z',
        pool,
      );

      const client = await pool.connect();
      try {
        await client.query('begin');
        await expect(
          validateRniFullUniversePublicationAtCommit(publication, authority, client),
        ).rejects.toThrow('withdrawn or rights-ineligible publication evidence');
        await client.query('rollback');
      } finally {
        client.release();
      }
    });

    it('fails closed on nonterminal slices and unhashed legacy convergence artifacts', async () => {
      await reseed({ redditSliceStatus: 'pending' });
      await expect(select(request)).rejects.toThrow(
        'nonterminal platform-slice data',
      );

      await reseed({ convergenceArtifactHash: null });
      await expect(select(request)).rejects.toThrow(
        'unreleased legacy convergence artifact',
      );
    });

    it('fails closed when the stored combined summary crosses platform slices', async () => {
      await reseed({
        summarySlices: { reddit: X_SLICE_ID, x: REDDIT_SLICE_ID },
      });
      await expect(select(request)).rejects.toThrow(
        'crossed cited-synthesis, convergence, platform-slice, rights, or cutoff lineage',
      );
    });
  },
);
