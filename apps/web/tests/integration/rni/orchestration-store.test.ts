import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { databaseUrl, makePool, resetSchema, truncateAll } from '../helpers/db';
import { reserveRniAiInvocation, settleRniAiInvocation } from '../../../src/repositories/versions';
import { rniModelTask } from '../../../src/rni/contracts';
import { hashRniModelInput } from '../../../src/rni/agents/model-input';
import {
  hashRniWorkerManifest,
  hashRniWorkerSnapshotValue,
} from '../../../src/rni/orchestration/worker-manifest';
import {
  buildRniFullUniversePublication,
  type RniFullUniversePublication,
} from '../../../src/rni/orchestration/full-universe-publication';
import { RniRefreshService, validateRniExecution } from '../../../src/rni/orchestration/refresh';
import { RniPlatformExecutionService } from '../../../src/rni/orchestration/execution';
import { RniCombinedExecutionService } from '../../../src/rni/orchestration/combined';
import {
  ensureRniJobDefinitions,
  findRniJobRun,
  PostgresRniOrchestrationStore,
  PostgresRniOutbox,
  queryableForRniOrchestrationTransaction,
} from '../../../src/rni/repositories/orchestration';
import {
  finalizeRniFullUniversePublication,
  stageRniFullUniversePublicationMember,
} from '../../../src/rni/repositories/full-universe-publication';
import { loadRniWorkerManifest } from '../../../src/rni/repositories/worker-manifest';
import { loadRniResultVisibility } from '../../../src/rni/read-model/repositories/visibility';
import { PostgresRniAiRouteSettingsService } from '../../../src/rni/settings/ai-route/repositories/store';
import { seedTestWorkerAuthorities } from './helpers/worker-authorities';

const TABLES = [
  'job_run',
  'rni_run',
  'rni_platform_slice',
  'rni_run_execution_scope',
  'rni_orchestration_execution',
  'rni_orchestration_command',
  'rni_orchestration_outbox',
  'audit_event',
] as const;
const HASH = 'a'.repeat(64);

async function seedFullUniversePublicationPrerequisites(
  pool: pg.Pool,
  publication: RniFullUniversePublication,
  createdAt: string,
): Promise<void> {
  const securityIds = publication.members.map(({ securityId }) => securityId);
  const synthesisIds = publication.members.map(({ citedSynthesisId }) => citedSynthesisId);
  const synthesisHashes = publication.members.map(
    ({ citedSynthesisResultHash }) => citedSynthesisResultHash,
  );
  const convergenceIds = publication.members.map(
    ({ convergenceArtifactId }) => convergenceArtifactId,
  );
  const convergenceHashes = publication.members.map(
    ({ convergenceArtifactHash }) => convergenceArtifactHash,
  );
  const sections = JSON.stringify([
    {
      heading: 'Reddit sentiment',
      status: 'complete',
      text: 'Exact fixture Reddit result.',
      citationIds: [],
    },
    {
      heading: 'X sentiment',
      status: 'complete',
      text: 'Exact fixture X result.',
      citationIds: [],
    },
    {
      heading: 'Combined summary',
      status: 'complete',
      text: 'Exact fixture combined result.',
      citationIds: [],
    },
  ]);
  const client = await pool.connect();
  try {
    await client.query('begin');
    // D-RNI-33 is the subject of this test. Replica mode is confined to manufacturing the 501
    // already-published upstream synthesis/convergence prerequisites; it is reset before any
    // staging, release, receipt, orchestration, or read-gate operation under test.
    await client.query('set local session_replication_role = replica');
    await client.query(
      `insert into rni_combined_summary
       (id,run_id,security_id,reddit_platform_slice_id,x_platform_slice_id,status,sections,created_at)
       select input.synthesis_id,$1,input.security_id,$2,$3,'complete',$4::jsonb,$5
         from unnest($6::uuid[],$7::uuid[]) input(security_id,synthesis_id)`,
      [
        publication.runId,
        publication.platforms.reddit.sliceId,
        publication.platforms.x.sliceId,
        sections,
        createdAt,
        securityIds,
        synthesisIds,
      ],
    );
    await client.query(
      `insert into rni_convergence_artifact
       (id,run_id,security_id,reddit_analytics_id,reddit_artifact_hash,x_analytics_id,
        x_artifact_hash,policy_version,calculation_code_version,input_hash,result_hash,
        input_snapshot,result_snapshot,created_at,artifact_hash)
       select input.convergence_id,$1,input.security_id,gen_random_uuid(),$2,gen_random_uuid(),$3,
         'release-fixture-policy','release-fixture-convergence-v1',$4,$5,'{}'::jsonb,'{}'::jsonb,
         $6,input.convergence_hash
       from unnest($7::uuid[],$8::uuid[],$9::text[]) input(
         security_id,convergence_id,convergence_hash
       )`,
      [
        publication.runId,
        hashRniModelInput({ platform: 'reddit', runId: publication.runId }),
        hashRniModelInput({ platform: 'x', runId: publication.runId }),
        hashRniModelInput({ kind: 'convergence-input', runId: publication.runId }),
        hashRniModelInput({ kind: 'convergence-result', runId: publication.runId }),
        createdAt,
        securityIds,
        convergenceIds,
        convergenceHashes,
      ],
    );
    await client.query(
      `insert into rni_cited_synthesis_artifact
       (id,run_id,security_id,batch_id,convergence_artifact_id,verifier_invocation_id,
        verification_input_hash,challenger_invocation_id,challenger_input_hash,
        calculation_code_version,policy_version,input_hash,result_hash,request_snapshot,
        model_input_snapshot,verification_output_snapshot,challenger_output_snapshot,
        result_snapshot,statement_count,created_at)
       select input.synthesis_id,$1,input.security_id,gen_random_uuid(),input.convergence_id,
         gen_random_uuid(),$2,gen_random_uuid(),$3,'release-fixture-synthesis-v1',
         'release-fixture-policy',$4,input.synthesis_hash,'{}'::jsonb,'{}'::jsonb,'[]'::jsonb,
         '{}'::jsonb,'{}'::jsonb,3,$5
       from unnest($6::uuid[],$7::uuid[],$8::uuid[],$9::text[]) input(
         security_id,synthesis_id,convergence_id,synthesis_hash
       )`,
      [
        publication.runId,
        hashRniModelInput({ kind: 'verification-input', runId: publication.runId }),
        hashRniModelInput({ kind: 'challenger-input', runId: publication.runId }),
        hashRniModelInput({ kind: 'synthesis-input', runId: publication.runId }),
        createdAt,
        securityIds,
        synthesisIds,
        convergenceIds,
        synthesisHashes,
      ],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
const BUILD = {
  deploymentId: 'rni-test-deployment',
  commitSha: '5'.repeat(40),
  artifactHash: '6'.repeat(64),
  sourceAdapterVersions: { reddit: 'reddit-test-v1', x: 'x-test-v1' },
  semanticCodeVersion: 'semantic-test-v1',
  analyticsCodeVersion: 'analytics-test-v1',
  convergenceCodeVersion: 'convergence-test-v1',
  citedSynthesisCodeVersion: 'synthesis-test-v1',
} as const;

describe.skipIf(databaseUrl() === undefined)('I09 — PostgreSQL orchestration store', () => {
  let pool: pg.Pool;
  let store: PostgresRniOrchestrationStore;
  let service: RniRefreshService;
  let worker: RniPlatformExecutionService;
  let combined: RniCombinedExecutionService;
  let definitions: Awaited<ReturnType<typeof ensureRniJobDefinitions>>;
  let configVersion: string;
  let universeVersion: string;
  let securityId: string;
  let clock: number;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
    configVersion = (
      await pool.query<{ id: string }>(
        `insert into config_version (environment,status,created_by,change_reason,checksum)
         values ('test','draft','coordinator','I09 integration fixture',$1) returning id::text`,
        [randomUUID()],
      )
    ).rows[0]!.id;
    for (const model of ['gpt-5.6-terra', 'gpt-5.6-sol']) {
      await pool.query(
        `insert into rni_model_capability_snapshot
         (id,ai_route,configured_model_id,provider,canonical_provider_model_id,model_revision,
          response_hash,observed_at,expires_at,available,supports_responses,
          supports_structured_outputs,supports_web_search,reasoning_efforts)
         values ($1,'openai_direct',$1,'openai',$1,'i09-revision',$2,
           now()-interval '1 hour',now()+interval '1 day',true,true,true,true,'["low"]')`,
        [model, HASH],
      );
    }
    await pool.query(
      `insert into rni_ai_config
       (config_version,ai_route,model_policy_version,budget_policy_version,manual_run_hard_usd,
        full_universe_hard_usd,rolling_24h_hard_usd,monthly_warning_usd,monthly_hard_usd)
       values ($1,'openai_direct','rni-balanced-model-policy-v1',
         'rni-ai-budget-policy-v1',2,25,50,300,500)`,
      [configVersion],
    );
    for (const task of rniModelTask.options) {
      const model = ['rni_verification', 'rni_challenger'].includes(task)
        ? 'gpt-5.6-sol'
        : 'gpt-5.6-terra';
      await pool.query(
        `insert into model_route
         (config_version,task,transport,primary_provider,primary_model,model_revision,
          fallback_chain,prompt_version,schema_version,calibration_version,
          max_input_tokens,max_output_tokens,
          timeout_ms,max_cost_usd,ai_route,canonical_provider_model_id,reasoning_effort,
          capability_snapshot_id,policy_version,max_input_bytes,max_tool_calls)
         values ($1,$2,'openai_responses','openai',$3,'i09-revision','[]',$2||'-v1',
           'rni-schema-v1','rni-i09-calibration-v1',1024,256,30000,0.1,'openai_direct',$3,'low',$3,
           'rni-balanced-model-policy-v1',1024,$4)`,
        [configVersion, task, model, task === 'rni_discovery' ? 3 : 0],
      );
    }
    await seedTestWorkerAuthorities(pool, configVersion);
    for (const task of rniModelTask.options) {
      const prompt = {
        version: `${task}-v1`,
        contentHash: '1'.repeat(64),
        inputSchemaVersion: `${task}-input-v1`,
        inputSchemaHash: '2'.repeat(64),
        outputSchemaVersion: `${task}-output-v1`,
        outputSchemaHash: '3'.repeat(64),
        toolVersion: `${task}-tools-v1`,
        toolHash: '4'.repeat(64),
      };
      await pool.query(
        `insert into rni_worker_manifest_authority
         (authority_kind,authority_key,version,snapshot_hash,value)
         values ('prompt',$1,$2,$3,$4)`,
        [task, prompt.version, hashRniWorkerSnapshotValue(prompt), JSON.stringify(prompt)],
      );
    }
    await pool.query(
      `insert into rni_worker_manifest_authority
       (authority_kind,authority_key,version,snapshot_hash,value)
       values ('build','default',$1,$2,$3)`,
      [BUILD.deploymentId, hashRniWorkerSnapshotValue(BUILD), JSON.stringify(BUILD)],
    );
    await pool.query(`update config_version set status='active',activated_at=now() where id=$1`, [
      configVersion,
    ]);
    const providerCallId = (
      await pool.query<{ id: string }>(
        `insert into provider_call_log
         (provider,operation,request_fingerprint,status_code,latency_ms,cache_status,
          items_returned,started_at)
         values ('fmp','/stable/sp500-constituent','rni-manifest-fixture',200,1,'miss',501,
           now()-interval '1 hour') returning id`,
      )
    ).rows[0]!.id;
    universeVersion = (
      await pool.query<{ id: string }>(
        `insert into universe_version
         (environment,config_version,status,selected_count,created_by,change_reason,activated_at,
          source_provider,source_endpoint,source_retrieved_at,source_payload_hash,
          provider_call_id,approved_by)
         values ('test',$1,'active',501,'coordinator','D-RNI-32 admission fixture',now(),
           'fmp','/stable/sp500-constituent',now()-interval '1 hour',$2,$3,'coordinator')
         returning id::text`,
        [configVersion, HASH, providerCallId],
      )
    ).rows[0]!.id;
    await pool.query(
      `with inserted as (
         insert into security (symbol,name,exchange,asset_type,currency,aliases)
         select case when n=1 then 'NVDA' else 'T'||lpad(n::text,3,'0') end,
           case when n=1 then 'NVIDIA Corporation' else 'Fixture company '||n::text end,
           'NASDAQ','equity','USD',jsonb_build_array(
             case when n=1 then 'NVDA' else 'T'||lpad(n::text,3,'0') end
           ) from generate_series(1,501) n returning id,symbol,name
       ) insert into universe_member
         (universe_version,security_id,added_by,selection_source,provider_symbol,
          provider_company_name,constituent_first_added_at)
         select $1,id,'coordinator','fmp_sp500',symbol,name,'2020-01-01T00:00:00Z'
           from inserted`,
      [universeVersion],
    );
    await pool.query(
      `insert into rni_price_book_evidence
       (price_book_version,source_url,response_hash,observed_at,first_tier_input_ceiling)
       values ('rni-manifest-price-v1','https://example.test/approved-prices',$1,
         now()-interval '1 hour',200000)`,
      [HASH],
    );
    await pool.query(
      `insert into unit_price_book
       (price_book_version,provider,service,operation_or_model,unit_type,unit_price,currency,
        effective_from,source_reference)
       values
       ('rni-manifest-price-v1','openai','openai_responses','gpt-5.6-sol','input_token',
         0.00001,'USD',now()-interval '1 day','approved fixture'),
       ('rni-manifest-price-v1','openai','openai_responses','gpt-5.6-sol','output_token',
         0.00002,'USD',now()-interval '1 day','approved fixture'),
       ('rni-manifest-price-v1','openai','openai_responses','gpt-5.6-terra','input_token',
         0.00001,'USD',now()-interval '1 day','approved fixture'),
       ('rni-manifest-price-v1','openai','openai_responses','gpt-5.6-terra','output_token',
         0.00002,'USD',now()-interval '1 day','approved fixture'),
       ('rni-manifest-price-v1','openai','openai_web_search','web_search','search',
         0.01,'USD',now()-interval '1 day','approved fixture')`,
    );
    securityId = (await pool.query<{ id: string }>(`select id from security where symbol='NVDA'`))
      .rows[0]!.id;
    definitions = await ensureRniJobDefinitions('test', pool);
    clock = Date.now();
    store = new PostgresRniOrchestrationStore(pool, {
      deploymentId: BUILD.deploymentId,
      commitSha: BUILD.commitSha,
      artifactHash: BUILD.artifactHash,
    });
    const dependencies = {
      store,
      partition: 'test',
      now: () => new Date(clock),
      newId: randomUUID,
    };
    service = new RniRefreshService({
      ...dependencies,
      actor: 'coordinator',
      manualJobId: definitions.manualJobId,
      authorize: async () => {},
    });
    worker = new RniPlatformExecutionService(dependencies);
    combined = new RniCombinedExecutionService(dependencies);
  });

  afterEach(async () => {
    await pool.query('drop trigger if exists rni_i09_test_fail_audit on audit_event');
    await pool.query('drop function if exists rni_i09_test_fail_audit()');
  });
  afterAll(async () => {
    await pool?.end();
  });

  const request = (idempotencyKey = randomUUID()) => ({
    idempotencyKey,
    scope: { kind: 'ticker' as const, ticker: 'NVDA' },
  });
  async function execution(runId: string) {
    return store.transact('test', async (tx) =>
      validateRniExecution(await tx.getExecution(runId), 'test', runId),
    );
  }
  async function snapshot() {
    const entries = await Promise.all(
      TABLES.map(
        async (table) =>
          [
            table,
            (
              await pool.query(
                `select to_jsonb(t) as row from ${table} t order by to_jsonb(t)::text`,
              )
            ).rows,
          ] as const,
      ),
    );
    return Object.fromEntries(entries);
  }

  it('ensures exactly two definitions without resetting their existing cadence or settings', async () => {
    await pool.query(
      `update job_definition set next_due_at='2030-01-02T03:04:05Z',version=7,
         enabled=false,schedule_expression='7200' where id=$1`,
      [definitions.scheduledJobId],
    );
    const before = (await pool.query('select * from job_definition order by job_key')).rows;
    expect(await ensureRniJobDefinitions('test', pool)).toEqual(definitions);
    expect((await pool.query('select * from job_definition order by job_key')).rows).toEqual(
      before,
    );
    expect(before).toHaveLength(2);
    expect(before.map((row) => row.job_key)).toEqual(['rni-manual:test', 'rni-scheduled:test']);
    await expect(ensureRniJobDefinitions('missing-environment', pool)).rejects.toThrow(
      'INVALID_PLAN',
    );
    expect(
      (await pool.query('select count(*)::integer as count from job_definition')).rows[0]!.count,
    ).toBe(2);
  });

  it('atomically accepts a manual run with its existing job, two slices, scope, admission and outboxes', async () => {
    const accepted = await service.requestManualRefresh(request());
    expect(accepted.disposition).toBe('accepted');
    expect(accepted.scopePreview).toEqual({
      kind: 'ticker',
      ticker: 'NVDA',
      securityId,
      companyName: 'NVIDIA Corporation',
      exchange: 'NASDAQ',
      universeVersion,
    });
    const record = await execution(accepted.runId);
    expect(record.version).toBe('rni-execution-v2');
    if (record.version !== 'rni-execution-v2') throw new Error('Expected v2 execution');
    expect(record.run).toMatchObject({ status: 'requested', configVersion, universeVersion });
    expect(record.platforms.reddit.delivery).toMatchObject({
      version: 'rni-platform-v2',
      runManifestHash: record.runManifestHash,
    });
    expect(record.platforms.x.delivery).toMatchObject({
      version: 'rni-platform-v2',
      runManifestHash: record.runManifestHash,
    });
    const workerManifest = await loadRniWorkerManifest(record.run.id, record.runManifestHash, pool);
    expect(workerManifest.scope).toEqual({
      kind: 'manual_ticker',
      selectedSecurityId: securityId,
    });
    expect(workerManifest.members).toHaveLength(1);
    expect(workerManifest.members[0]).toMatchObject({ securityId, ticker: 'NVDA', ordinal: 1 });
    expect(await findRniJobRun(record.jobRunId, pool)).toMatchObject({
      id: record.jobRunId,
      jobId: definitions.manualJobId,
      status: 'queued',
      configVersion,
      universeVersion,
      metrics: { rniRunId: accepted.runId, planHash: record.planHash },
    });
    const rows = await snapshot();
    expect(
      Object.fromEntries(Object.entries(rows).map(([table, values]) => [table, values.length])),
    ).toEqual({
      job_run: 1,
      rni_run: 1,
      rni_platform_slice: 2,
      rni_run_execution_scope: 1,
      rni_orchestration_execution: 1,
      rni_orchestration_command: 1,
      rni_orchestration_outbox: 2,
      audit_event: 1,
    });
    const admission = (
      await pool.query(
        'select admitted_cost_usd,remaining_admission_usd,released_at from rni_orchestration_execution',
      )
    ).rows[0]!;
    expect(new Decimal(admission.admitted_cost_usd).eq(record.reservedCostUsd)).toBe(true);
    expect(new Decimal(admission.remaining_admission_usd).eq(record.reservedCostUsd)).toBe(true);
    expect(admission.released_at).toBeNull();
    const outbox = new PostgresRniOutbox('test', 'platform', pool);
    expect(await outbox.pending(new Date(clock).toISOString(), 10)).toEqual(
      expect.arrayContaining(
        Object.values(record.platforms).map(({ delivery }) => ({
          delivery,
          notBefore: record.run.requestedAt,
        })),
      ),
    );
    expect(
      (await pool.query('select scope_kind,security_id from rni_run_execution_scope')).rows,
    ).toEqual([{ scope_kind: 'manual_ticker', security_id: securityId }]);
  });

  it('atomically admits a complete FMP universe as one v2 manifest and enqueues only its v2 deliveries', async () => {
    const accepted = await service.requestManualRefresh({
      idempotencyKey: randomUUID(),
      scope: { kind: 'full_universe' },
    });
    const record = await execution(accepted.runId);
    expect(record.version).toBe('rni-execution-v2');
    if (record.version !== 'rni-execution-v2') throw new Error('Expected v2 execution');
    expect(record.plan.scopePreview).toEqual({
      kind: 'full_universe',
      universeVersion,
      securityCount: 501,
    });
    expect(record.platforms.reddit.delivery).toMatchObject({
      version: 'rni-platform-v2',
      runManifestHash: record.runManifestHash,
    });
    expect(record.platforms.x.delivery).toMatchObject({
      version: 'rni-platform-v2',
      runManifestHash: record.runManifestHash,
    });
    const manifest = await loadRniWorkerManifest(record.run.id, record.runManifestHash, pool);
    expect(manifest.members).toHaveLength(501);
    expect(manifest.universe).toEqual({ version: universeVersion, snapshotHash: HASH });
    expect(hashRniWorkerManifest(manifest)).toBe(record.runManifestHash);
    expect(
      (
        await pool.query<{ count: number }>(
          `select count(*)::integer as count from rni_worker_run_manifest_authority
            where run_id=$1`,
          [record.run.id],
        )
      ).rows[0]!.count,
    ).toBe(16);
    expect(
      (await new PostgresRniOutbox('test', 'platform', pool).pending(record.run.requestedAt, 10))
        .map((entry) =>
          typeof entry === 'object' && entry !== null && 'delivery' in entry
            ? entry.delivery
            : null,
        )
        .every(
          (delivery) =>
            typeof delivery === 'object' &&
            delivery !== null &&
            'version' in delivery &&
            delivery.version === 'rni-platform-v2',
        ),
    ).toBe(true);

    const redditClaim = await worker.claim(record.platforms.reddit.delivery);
    if (redditClaim.status !== 'acquired') throw new Error('Expected Reddit v2 lease');
    clock += 1;
    await worker.finish(redditClaim.lease, {
      status: 'complete',
      eligibleSourceCount: 501,
      dataThroughAt: record.plan.windowEnd,
      computedAt: new Date(clock).toISOString(),
    });
    const xClaim = await worker.claim(record.platforms.x.delivery);
    if (xClaim.status !== 'acquired') throw new Error('Expected X v2 lease');
    clock += 1;
    await worker.finish(xClaim.lease, {
      status: 'complete',
      eligibleSourceCount: 501,
      dataThroughAt: record.plan.windowEnd,
      computedAt: new Date(clock).toISOString(),
    });
    const ready = await execution(record.run.id);
    if (
      ready.version !== 'rni-execution-v2' ||
      ready.plan.scopePreview.kind !== 'full_universe' ||
      ready.platforms.reddit.outcomeHash === null ||
      ready.platforms.x.outcomeHash === null
    ) {
      throw new Error('Expected terminal v2 platform slices');
    }
    const redditStatus = ready.platforms.reddit.slice.status;
    const xStatus = ready.platforms.x.slice.status;
    if (
      redditStatus === 'pending' ||
      redditStatus === 'running' ||
      xStatus === 'pending' ||
      xStatus === 'running'
    ) {
      throw new Error('Expected terminal platform statuses');
    }
    const release = buildRniFullUniversePublication({
      manifest: {
        runId: ready.run.id,
        planHash: ready.planHash,
        runManifestHash: ready.runManifestHash,
        universeVersion: manifest.universe.version,
        assessmentCutoffAt: manifest.windows.assessmentCutoffAt,
        memberSetHash: manifest.memberSetHash,
        members: manifest.members.map(({ ordinal, securityId: memberSecurityId }) => ({
          ordinal,
          securityId: memberSecurityId,
        })),
      },
      platforms: {
        reddit: {
          runId: ready.run.id,
          planHash: ready.planHash,
          runManifestHash: ready.runManifestHash,
          universeVersion: manifest.universe.version,
          assessmentCutoffAt: manifest.windows.assessmentCutoffAt,
          memberSetHash: manifest.memberSetHash,
          platform: 'reddit',
          sliceId: ready.platforms.reddit.slice.id,
          status: redditStatus,
          outcomeHash: ready.platforms.reddit.outcomeHash,
        },
        x: {
          runId: ready.run.id,
          planHash: ready.planHash,
          runManifestHash: ready.runManifestHash,
          universeVersion: manifest.universe.version,
          assessmentCutoffAt: manifest.windows.assessmentCutoffAt,
          memberSetHash: manifest.memberSetHash,
          platform: 'x',
          sliceId: ready.platforms.x.slice.id,
          status: xStatus,
          outcomeHash: ready.platforms.x.outcomeHash,
        },
      },
      items: manifest.members.map(({ ordinal, securityId: memberSecurityId }) => ({
        runId: ready.run.id,
        planHash: ready.planHash,
        runManifestHash: ready.runManifestHash,
        universeVersion: manifest.universe.version,
        assessmentCutoffAt: manifest.windows.assessmentCutoffAt,
        memberSetHash: manifest.memberSetHash,
        ordinal,
        securityId: memberSecurityId,
        citedSynthesisId: randomUUID(),
        citedSynthesisResultHash: hashRniModelInput({
          kind: 'cited-synthesis',
          ordinal,
          runId: ready.run.id,
        }),
        convergenceArtifactId: randomUUID(),
        convergenceArtifactHash: hashRniModelInput({
          kind: 'convergence',
          ordinal,
          runId: ready.run.id,
        }),
        status: 'complete',
      })),
    });
    expect(release.expectedMemberCount).toBe(501);
    await seedFullUniversePublicationPrerequisites(pool, release, new Date(clock).toISOString());
    expect(
      (await pool.query<{ session_replication_role: string }>('show session_replication_role'))
        .rows[0],
    ).toEqual({ session_replication_role: 'origin' });

    const combinedClaim = await combined.claim(ready.combined.delivery);
    if (combinedClaim.status !== 'acquired') throw new Error('Expected combined v2 lease');
    const fence = await combined.effectFence(combinedClaim.lease);
    const artifact = {
      runId: release.runId,
      planHash: release.planHash,
      artifactHash: release.aggregateHash,
      status: release.status,
    } as const;
    const stageMembers = async (members: readonly RniFullUniversePublication['members'][number][]) =>
      store.transact('test', async (tx) => {
        const db = queryableForRniOrchestrationTransaction(tx);
        for (const member of members) {
          await stageRniFullUniversePublicationMember(release, member.securityId, fence, db);
        }
      });
    await stageMembers(release.members.slice(0, 500));
    await expect(loadRniResultVisibility(release.runId, 'test', pool)).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    const counts = async () =>
      (
        await pool.query<{
          staged: number;
          releases: number;
          receipts: number;
          remaining: string;
          released_at: Date | null;
          combined_status: string;
        }>(
          `select
             (select count(*)::integer from rni_full_universe_publication_item where run_id=$1) staged,
             (select count(*)::integer from rni_full_universe_publication_release where run_id=$1) releases,
             (select count(*)::integer from rni_orchestration_publication_receipt where run_id=$1) receipts,
             remaining_admission_usd::text remaining,released_at,
             record #>> '{combined,status}' combined_status
           from rni_orchestration_execution where run_id=$1`,
          [release.runId],
        )
      ).rows[0]!;
    expect(await counts()).toMatchObject({
      staged: 500,
      releases: 0,
      receipts: 0,
      combined_status: 'running',
      released_at: null,
    });
    await expect(
      combined.commitFullUniversePublication(
        combinedClaim.lease,
        artifact,
        async (tx, activeFence, _expected, committedAt) =>
          (
            await finalizeRniFullUniversePublication(
              release,
              activeFence,
              committedAt,
              queryableForRniOrchestrationTransaction(tx),
            )
          ).artifact,
      ),
    ).rejects.toThrow(/one exact atomic visible set/u);
    expect(await counts()).toMatchObject({
      staged: 500,
      releases: 0,
      receipts: 0,
      combined_status: 'running',
      released_at: null,
    });

    await stageMembers(release.members.slice(500));
    await expect(
      combined.commitFullUniversePublication(
        combinedClaim.lease,
        artifact,
        async (tx, activeFence, _expected, committedAt) => {
          const finalized = await finalizeRniFullUniversePublication(
            release,
            activeFence,
            committedAt,
            queryableForRniOrchestrationTransaction(tx),
          );
          return { ...finalized.artifact, artifactHash: 'f'.repeat(64) };
        },
      ),
    ).rejects.toThrow('CONFLICT');
    expect(await counts()).toMatchObject({
      staged: 501,
      releases: 0,
      receipts: 0,
      combined_status: 'running',
      released_at: null,
    });

    await expect(
      combined.commitFullUniversePublication(
        combinedClaim.lease,
        artifact,
        async (tx, activeFence, _expected, committedAt) =>
          (
            await finalizeRniFullUniversePublication(
              release,
              activeFence,
              committedAt,
              queryableForRniOrchestrationTransaction(tx),
            )
          ).artifact,
      ),
    ).resolves.toBe('committed');
    expect(await counts()).toMatchObject({
      staged: 501,
      releases: 1,
      receipts: 1,
      remaining: '0',
      combined_status: 'complete',
    });
    expect((await execution(release.runId)).run).toMatchObject({ status: 'complete' });
    expect(await findRniJobRun(ready.jobRunId, pool)).toMatchObject({ status: 'succeeded' });
    const visible = await loadRniResultVisibility(release.runId, 'test', pool);
    expect(visible.kind).toBe('released_v2_full_universe');
    if (visible.kind !== 'released_v2_full_universe') throw new Error('Expected released result');
    expect(visible.aggregate.aggregateHash).toBe(release.aggregateHash);
    expect(visible.items.size).toBe(501);
    expect(visible.items.get(release.members[500]!.securityId)).toEqual(
      expect.objectContaining({ ordinal: 501, status: 'complete' }),
    );
    await expect(
      combined.commitFullUniversePublication(
        combinedClaim.lease,
        artifact,
        async () => {
          throw new Error('Duplicate release must not invoke publisher');
        },
      ),
    ).resolves.toBe('duplicate');
  }, 120_000);
  it('records both internal orchestration principals as services', async () => {
    await store.transact('test', async (tx) => {
      await tx.audit({
        event: 'schedule_skipped',
        runId: null,
        actor: 'rni-scheduler',
        at: new Date(clock).toISOString(),
        jobId: definitions.scheduledJobId,
        dueAt: new Date(clock).toISOString(),
      });
    });
    expect(
      (
        await pool.query(
          `select actor_id,actor_role from audit_event where actor_id='rni-scheduler'`,
        )
      ).rows,
    ).toEqual([{ actor_id: 'rni-scheduler', actor_role: 'service' }]);
  });

  it('snapshots and enforces an admin-lowered aggregate budget on the next run', async () => {
    const settings = new PostgresRniAiRouteSettingsService({
      environment: 'test',
      actorId: 'coordinator',
      pool,
      credentialsAvailable: (route) => route === 'openai_direct',
    });
    const changed = await settings.updateFutureAiBudgets({
      idempotencyKey: randomUUID(),
      reason: 'Bound the next orchestration admission',
      budgets: {
        manualRunHardUsd: '1.2',
        fullUniverseHardUsd: '10',
        rolling24hHardUsd: '20',
        monthlyWarningUsd: '30',
        monthlyHardUsd: '40',
        currency: 'USD',
      },
    });
    await ensureRniJobDefinitions('test', pool);
    await expect(service.requestManualRefresh(request())).rejects.toThrow('BUDGET_RUN');
    expect((await pool.query('select count(*)::integer as count from rni_run')).rows).toEqual([
      { count: 0 },
    ]);
    expect(
      (
        await pool.query<{ current: string }>(
          `select cv.id::text as current from config_version cv
            where cv.environment='test' and cv.status='active'`,
        )
      ).rows,
    ).toEqual([{ current: changed.setting.configVersion }]);
  });

  it('serializes exact concurrent replay and rejects crossed intent without changing any durable row', async () => {
    const input = request();
    const results = await Promise.all([
      service.requestManualRefresh(input),
      service.requestManualRefresh(input),
    ]);
    expect(results.map((result) => result.disposition).sort()).toEqual(['accepted', 'duplicate']);
    expect(new Set(results.map((result) => result.runId)).size).toBe(1);
    const before = await snapshot();
    expect(await service.requestManualRefresh(input)).toEqual({
      ...results[0],
      disposition: 'duplicate',
    });
    await expect(
      service.requestManualRefresh({
        idempotencyKey: input.idempotencyKey,
        scope: { kind: 'full_universe' },
      }),
    ).rejects.toThrow('CONFLICT');
    expect(await snapshot()).toEqual(before);
  });

  it('rolls back job, run, slices, admission, command and both outboxes when the final audit fails', async () => {
    await pool.query(`create function rni_i09_test_fail_audit() returns trigger language plpgsql as $$
      begin raise exception 'I09 injected audit failure'; end; $$`);
    await pool.query(`create trigger rni_i09_test_fail_audit before insert on audit_event
      for each row execute function rni_i09_test_fail_audit()`);
    const before = await snapshot();
    await expect(service.requestManualRefresh(request())).rejects.toThrow(
      'I09 injected audit failure',
    );
    expect(await snapshot()).toEqual(before);
  });

  it('coalesces distinct concurrent keys to one execution while preserving both command receipts', async () => {
    const results = await Promise.all([
      service.requestManualRefresh(request()),
      service.requestManualRefresh(request()),
    ]);
    expect(results.map((result) => result.disposition).sort()).toEqual(['accepted', 'duplicate']);
    expect(new Set(results.map((result) => result.runId)).size).toBe(1);
    const rows = await snapshot();
    expect(rows.job_run).toHaveLength(1);
    expect(rows.rni_run).toHaveLength(1);
    expect(rows.rni_orchestration_execution).toHaveLength(1);
    expect(rows.rni_orchestration_command).toHaveLength(2);
    expect(rows.rni_orchestration_outbox).toHaveLength(2);
    expect((await pool.query('select action from audit_event order by action')).rows).toEqual([
      { action: 'accepted' },
      { action: 'coalesced' },
    ]);
  });

  it('projects independent platform lifecycle and keeps the job running until combined termination', async () => {
    const { runId } = await service.requestManualRefresh(request());
    const initial = await execution(runId);
    const reddit = await worker.claim(initial.platforms.reddit.delivery);
    expect(reddit.status).toBe('acquired');
    if (reddit.status !== 'acquired') throw new Error('Expected Reddit lease');
    expect(await findRniJobRun(initial.jobRunId, pool)).toMatchObject({
      status: 'running',
      completedAt: null,
    });
    expect(
      (await pool.query('select platform,status from rni_platform_slice order by platform')).rows,
    ).toEqual([
      { platform: 'reddit', status: 'running' },
      { platform: 'x', status: 'pending' },
    ]);
    clock += 1000;
    const computedAt = new Date(clock).toISOString();
    await worker.finish(reddit.lease, {
      status: 'complete',
      eligibleSourceCount: 3,
      dataThroughAt: initial.plan.windowEnd,
      computedAt,
    });
    const x = await worker.claim(initial.platforms.x.delivery);
    expect(x.status).toBe('acquired');
    if (x.status !== 'acquired') throw new Error('Expected X lease');
    await worker.finish(x.lease, { status: 'unavailable', errorCode: 'PROVIDER_UNAVAILABLE' });
    const ready = await execution(runId);
    expect(ready.combined.status).toBe('pending');
    expect(ready.run.status).toBe('running');
    expect(await findRniJobRun(initial.jobRunId, pool)).toMatchObject({
      status: 'running',
      completedAt: null,
    });
    const slices = (
      await pool.query(
        `select platform,status,eligible_source_count,last_successful_refresh_at,computed_at,error_code
       from rni_platform_slice order by platform`,
      )
    ).rows;
    expect(slices).toEqual([
      {
        platform: 'reddit',
        status: 'complete',
        eligible_source_count: 3,
        last_successful_refresh_at: new Date(computedAt),
        computed_at: new Date(computedAt),
        error_code: null,
      },
      {
        platform: 'x',
        status: 'unavailable',
        eligible_source_count: 0,
        last_successful_refresh_at: null,
        computed_at: null,
        error_code: 'PROVIDER_UNAVAILABLE',
      },
    ]);
    expect(await new PostgresRniOutbox('test', 'combined', pool).pending(computedAt, 10)).toEqual([
      { delivery: ready.combined.delivery, notBefore: computedAt },
    ]);
    const claim = await combined.claim(ready.combined.delivery);
    if (claim.status !== 'acquired') throw new Error('Expected combined lease');
    expect(await combined.fail(claim.lease, { errorCode: 'SYNTHESIS_PERMANENT' })).toBe('failed');
    expect(await findRniJobRun(initial.jobRunId, pool)).toMatchObject({
      status: 'failed',
      completedAt: new Date(computedAt),
    });
    expect((await pool.query('select status,completed_at from rni_run')).rows).toEqual([
      { status: 'failed', completed_at: new Date(computedAt) },
    ]);
    const terminalRows = await snapshot();
    expect(await combined.fail(claim.lease, { errorCode: 'SYNTHESIS_PERMANENT' })).toBe(
      'duplicate',
    );
    expect(await snapshot()).toEqual(terminalRows);
  });

  it('acknowledges only the exact outbox payload and preserves the first publication receipt', async () => {
    const { runId } = await service.requestManualRefresh(request());
    const { delivery } = (await execution(runId)).platforms.reddit;
    const outbox = new PostgresRniOutbox('test', 'platform', pool);
    const input = {
      deliveryKey: delivery.deliveryKey,
      payloadHash: hashRniModelInput(delivery),
      messageId: 'qstash-first',
    };
    const before = await snapshot();
    await expect(outbox.markPublished({ ...input, payloadHash: 'b'.repeat(64) })).rejects.toThrow(
      'CONFLICT',
    );
    await expect(
      new PostgresRniOutbox('other', 'platform', pool).markPublished(input),
    ).rejects.toThrow('CONFLICT');
    expect(await snapshot()).toEqual(before);
    await outbox.markPublished(input);
    const acknowledged = (
      await pool.query('select * from rni_orchestration_outbox where delivery_key=$1', [
        delivery.deliveryKey,
      ])
    ).rows[0]!;
    expect(acknowledged.message_id).toBe('qstash-first');
    expect(acknowledged.published_at).toBeInstanceOf(Date);
    await outbox.markPublished({ ...input, messageId: 'qstash-redelivery' });
    expect(
      (
        await pool.query('select * from rni_orchestration_outbox where delivery_key=$1', [
          delivery.deliveryKey,
        ])
      ).rows[0],
    ).toEqual(acknowledged);
    expect(await outbox.pending(new Date(clock).toISOString(), 10)).toHaveLength(1);
    await expect(
      pool.query(`update rni_orchestration_outbox set payload_hash=$2 where delivery_key=$1`, [
        delivery.deliveryKey,
        'b'.repeat(64),
      ]),
    ).rejects.toThrow();
    expect(
      (
        await pool.query('select * from rni_orchestration_outbox where delivery_key=$1', [
          delivery.deliveryKey,
        ])
      ).rows[0],
    ).toEqual(acknowledged);
  });

  it('converts admission to one I10 reservation exactly once and retains only actual settled exposure', async () => {
    await pool.query(
      `insert into rni_price_book_evidence
       (price_book_version,source_url,response_hash,observed_at,first_tier_input_ceiling)
       values ('rni-i09-price-v1','https://example.test/i09-prices',$1,now()-interval '1 hour',272000)`,
      [HASH],
    );
    for (const unit of ['input_token', 'output_token']) {
      await pool.query(
        `insert into unit_price_book
         (price_book_version,provider,service,operation_or_model,unit_type,unit_price,currency,
          effective_from,source_reference)
         values ('rni-i09-price-v1','openai','openai_responses','gpt-5.6-terra',$1,0.00001,'USD',
           now()-interval '1 hour','I09 deterministic fixture')`,
        [unit],
      );
    }
    const { runId } = await service.requestManualRefresh(request());
    const record = await execution(runId);
    const claim = await worker.claim(record.platforms.reddit.delivery);
    if (claim.status !== 'acquired') throw new Error('Expected Reddit lease');
    const reservationInput = {
      invocationId: randomUUID(),
      runId,
      task: 'rni_classifier' as const,
      requestHash: HASH,
      capabilitySnapshotId: 'gpt-5.6-terra',
      priceBookVersion: 'rni-i09-price-v1',
      executionAuthority: {
        stage: 'reddit' as const,
        attempt: claim.lease.delivery.attempt,
        token: claim.lease.token,
      },
    };
    const reserved = await reserveRniAiInvocation(reservationInput, pool);
    expect(reserved).toMatchObject({
      decision: 'reserved',
      denialCode: null,
      dispatchAuthorized: true,
    });
    expect(new Decimal(reserved.estimatedCostUsd!).eq('0.0128')).toBe(true);
    const exposure = async () =>
      (
        await pool.query<{ remaining: string; spend: string }>(
          `select remaining_admission_usd as remaining,
         rni_ai_effective_spend('test','-infinity','infinity',$1) as spend
       from rni_orchestration_execution where run_id=$1`,
          [runId],
        )
      ).rows[0]!;
    const first = await exposure();
    expect(new Decimal(first.remaining).plus(first.spend).eq(record.reservedCostUsd)).toBe(true);
    expect(await reserveRniAiInvocation(reservationInput, pool)).toEqual({
      ...reserved,
      dispatchAuthorized: false,
    });
    expect(await exposure()).toEqual(first);
    expect(
      (await pool.query('select count(*)::integer as count from rni_ai_model_invocation')).rows,
    ).toEqual([{ count: 1 }]);
    const settlement = {
      invocationId: reservationInput.invocationId,
      requestHash: HASH,
      providerRequestId: 'i09-response',
      outcome: 'succeeded' as const,
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 20,
      webSearchCalls: 0,
    };
    expect(new Decimal(await settleRniAiInvocation(settlement, pool)).eq('0.0012')).toBe(true);
    const settled = await exposure();
    expect(settled.remaining).toBe(first.remaining);
    expect(new Decimal(settled.spend).eq('0.0012')).toBe(true);
    const expectedSettledExposure = new Decimal(record.reservedCostUsd)
      .minus(reserved.estimatedCostUsd!)
      .plus('0.0012');
    expect(new Decimal(settled.remaining).plus(settled.spend).eq(expectedSettledExposure)).toBe(
      true,
    );
    await settleRniAiInvocation(settlement, pool);
    expect(await exposure()).toEqual(settled);
    expect((await pool.query('select count(*)::integer as count from cost_event')).rows).toEqual([
      { count: 2 },
    ]);
  });
});
