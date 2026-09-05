import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { rniModelTask, type RniSourceItem } from '../../../src/rni/contracts';
import {
  RniPlatformExecutionService,
  type RniExecutionLease,
} from '../../../src/rni/orchestration/execution';
import { RniRefreshService, validateRniExecution } from '../../../src/rni/orchestration/refresh';
import {
  hashRniWorkerSnapshotValue,
} from '../../../src/rni/orchestration/worker-manifest';
import type {
  RniSourceWorkflowAuthorityV2,
  RniSourceWorkflowDeliveryV2,
} from '../../../src/rni/workflow/checkpoint';
import {
  ensureRniJobDefinitions,
  PostgresRniOrchestrationStore,
} from '../../../src/rni/repositories/orchestration';
import {
  PostgresRniSourceWorkflowCheckpointRepository,
  type RniRegisteredSourceWorkflow,
} from '../../../src/rni/repositories/source-workflow-checkpoints';
import { seedTestWorkerAuthorities } from './helpers/worker-authorities';
import { databaseUrl, makePool, resetSchema } from '../helpers/db';

const HASH = 'a'.repeat(64);
const BUILD = {
  deploymentId: 'rni-checkpoint-test-deployment',
  commitSha: '5'.repeat(40),
  artifactHash: '6'.repeat(64),
  sourceAdapterVersions: { reddit: 'reddit-test-v1', x: 'x-test-v1' },
  semanticCodeVersion: 'semantic-test-v1',
  analyticsCodeVersion: 'analytics-test-v1',
  convergenceCodeVersion: 'convergence-test-v1',
  citedSynthesisCodeVersion: 'synthesis-test-v1',
} as const;

type Parent = {
  readonly lease: RniExecutionLease;
  readonly authority: RniSourceWorkflowAuthorityV2;
};

const pause = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

describe.skipIf(databaseUrl() === undefined)(
  'D-RNI-34 — PostgreSQL source workflow checkpoints',
  () => {
    let pool: pg.Pool;
    let store: PostgresRniOrchestrationStore;
    let refresh: RniRefreshService;
    let worker: RniPlatformExecutionService;
    let repository: PostgresRniSourceWorkflowCheckpointRepository;
    let clock: number;
    let sharedLease: RniExecutionLease | null = null;

    beforeAll(async () => {
      pool = makePool();
      await resetSchema(pool);
      const configVersion = (
        await pool.query<{ id: string }>(
          `insert into config_version (environment,status,created_by,change_reason,checksum)
           values ('test','draft','coordinator','D-RNI-34 PostgreSQL fixture',$1)
           returning id::text`,
          [randomUUID()],
        )
      ).rows[0]!.id;
      for (const model of ['gpt-5.6-terra', 'gpt-5.6-sol']) {
        await pool.query(
          `insert into rni_model_capability_snapshot
           (id,ai_route,configured_model_id,provider,canonical_provider_model_id,model_revision,
            response_hash,observed_at,expires_at,available,supports_responses,
            supports_structured_outputs,supports_web_search,reasoning_efforts)
           values ($1,'openai_direct',$1,'openai',$1,'checkpoint-revision',$2,
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
            max_input_tokens,max_output_tokens,timeout_ms,max_cost_usd,ai_route,
            canonical_provider_model_id,reasoning_effort,capability_snapshot_id,policy_version,
            max_input_bytes,max_tool_calls)
           values ($1,$2,'openai_responses','openai',$3,'checkpoint-revision','[]',$2||'-v1',
             'rni-schema-v1','rni-checkpoint-calibration-v1',1024,256,30000,0.1,
             'openai_direct',$3,'low',$3,'rni-balanced-model-policy-v1',1024,$4)`,
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
           values ('fmp','/stable/sp500-constituent','checkpoint-fixture',200,1,'miss',501,
             now()-interval '1 hour') returning id`,
        )
      ).rows[0]!.id;
      const universeVersion = (
        await pool.query<{ id: string }>(
          `insert into universe_version
           (environment,config_version,status,selected_count,created_by,change_reason,activated_at,
            source_provider,source_endpoint,source_retrieved_at,source_payload_hash,
            provider_call_id,approved_by)
           values ('test',$1,'active',501,'coordinator','D-RNI-34 fixture',now(),
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
         values ('rni-checkpoint-price-v1','https://example.test/approved-prices',$1,
           now()-interval '1 hour',200000)`,
        [HASH],
      );
      await pool.query(
        `insert into unit_price_book
         (price_book_version,provider,service,operation_or_model,unit_type,unit_price,currency,
          effective_from,source_reference)
         values
         ('rni-checkpoint-price-v1','openai','openai_responses','gpt-5.6-sol','input_token',
           0.00001,'USD',now()-interval '1 day','approved fixture'),
         ('rni-checkpoint-price-v1','openai','openai_responses','gpt-5.6-sol','output_token',
           0.00002,'USD',now()-interval '1 day','approved fixture'),
         ('rni-checkpoint-price-v1','openai','openai_responses','gpt-5.6-terra','input_token',
           0.00001,'USD',now()-interval '1 day','approved fixture'),
         ('rni-checkpoint-price-v1','openai','openai_responses','gpt-5.6-terra','output_token',
           0.00002,'USD',now()-interval '1 day','approved fixture'),
         ('rni-checkpoint-price-v1','openai','openai_web_search','web_search','search',
           0.01,'USD',now()-interval '1 day','approved fixture')`,
      );
      const definitions = await ensureRniJobDefinitions('test', pool);
      clock = Date.now();
      store = new PostgresRniOrchestrationStore(pool, BUILD);
      const dependencies = {
        store,
        partition: 'test',
        now: () => new Date(clock),
        newId: randomUUID,
      };
      refresh = new RniRefreshService({
        ...dependencies,
        actor: 'coordinator',
        manualJobId: definitions.manualJobId,
        authorize: async () => undefined,
      });
      worker = new RniPlatformExecutionService(dependencies);
      repository = new PostgresRniSourceWorkflowCheckpointRepository();
    }, 60_000);

    afterAll(async () => {
      await pool?.end();
    });

    async function activeParent(): Promise<Parent> {
      if (sharedLease === null) {
        const accepted = await refresh.requestManualRefresh({
          idempotencyKey: randomUUID(),
          scope: { kind: 'ticker', ticker: 'NVDA' },
        });
        const record = await store.transact('test', async (transaction) =>
          validateRniExecution(
            await transaction.getExecution(accepted.runId),
            'test',
            accepted.runId,
          ),
        );
        const claim = await worker.claim(record.platforms.reddit.delivery);
        if (claim.status !== 'acquired') throw new Error('Expected a fresh Reddit parent lease');
        sharedLease = claim.lease;
      }
      const record = await store.transact('test', async (transaction) =>
        validateRniExecution(
          await transaction.getExecution(sharedLease!.delivery.runId),
          'test',
          sharedLease!.delivery.runId,
        ),
      );
      return { lease: sharedLease, authority: authorityFromClaim(record, sharedLease) };
    }

    function authorityFromClaim(
      record: Awaited<ReturnType<typeof validateRniExecution>>,
      lease: RniExecutionLease,
    ): RniSourceWorkflowAuthorityV2 {
      const state = record.platforms[lease.delivery.platform];
      if (record.version !== 'rni-execution-v2' || state.lease === null) {
        throw new Error('Expected an active v2 parent execution');
      }
      return {
        runId: record.run.id,
        planHash: record.planHash,
        runManifestHash: record.runManifestHash,
        platform: lease.delivery.platform,
        outerAttempt: lease.delivery.attempt,
        outerToken: lease.token,
        deadline: record.deadline,
        workflowPolicy: {
          leaseMs: record.plan.leaseMs,
          baseBackoffMs: record.plan.baseBackoffMs,
          maxBackoffMs: record.plan.maxBackoffMs,
        },
        outerLease: {
          acquiredAt: state.slice.lastAttemptAt!,
          expiresAt: state.lease.expiresAt,
        },
      };
    }

    function source(label: string): RniSourceItem {
      const boundedContent = `NVDA source workflow PostgreSQL evidence ${label}.`;
      const now = new Date(clock).toISOString();
      return {
        id: randomUUID(),
        platform: 'reddit',
        sourceKind: 'post',
        externalId: `checkpoint-${label}-${randomUUID()}`,
        canonicalUrl: `https://www.reddit.com/r/stocks/comments/${label}-${randomUUID()}/`,
        originalUrl: `https://www.reddit.com/r/stocks/comments/${label}-${randomUUID()}/`,
        subredditOrScope: 'r/stocks',
        authorHandleHash: 'b'.repeat(64),
        title: `Checkpoint ${label}`,
        boundedContent,
        contentSha256: createHash('sha256').update(boundedContent, 'utf8').digest('hex'),
        captureMode: 'full_post',
        publishedAt: now,
        discoveredAt: now,
        observedAt: now,
        searchQueryId: randomUUID(),
        providerRequestId: `checkpoint-request-${randomUUID()}`,
        metadata: { fixture: label },
        rightsPolicyVersion: 'rni-source-policy-v1',
        createdAt: now,
      };
    }

    async function register(
      parent: Parent,
      item: RniSourceItem,
      leaseOwner = 'checkpoint-worker',
      leaseToken = randomUUID(),
    ): Promise<RniRegisteredSourceWorkflow> {
      return store.transact('test', (transaction) =>
        repository.registerSourceAndClaim(
          {
            partition: 'test',
            outerLease: parent.lease,
            authority: parent.authority,
            source: item,
            stageVersion: 'rni-interpret-source-v2',
            leaseOwner,
            leaseToken,
          },
          transaction,
        ),
      );
    }

    const mutation = (
      parent: Parent,
      registered: RniRegisteredSourceWorkflow,
      leaseOwner = registered.checkpoint.lease!.owner,
      leaseToken = registered.checkpoint.lease!.token,
    ) => ({
      partition: 'test',
      delivery: registered.checkpoint.delivery,
      authority: parent.authority,
      leaseOwner,
      leaseToken,
    });

    it('claims, extends, completes, loads exact evidence, and replays exact output', async () => {
      let parent = await activeParent();
      const item = source('complete');
      const registered = await register(parent, item);
      expect(registered.claim.kind).toBe('acquired');
      expect(registered.checkpoint).toMatchObject({ status: 'running', attempt: 1 });

      const busy = await store.transact('test', (transaction) =>
        repository.claim(
          { ...mutation(parent, registered), leaseToken: randomUUID() },
          transaction,
        ),
      );
      expect(busy.kind).toBe('busy');

      clock += 5_000;
      await worker.heartbeat(parent.lease);
      const record = await store.transact('test', async (transaction) =>
        validateRniExecution(
          await transaction.getExecution(parent.authority.runId),
          'test',
          parent.authority.runId,
        ),
      );
      parent = { lease: parent.lease, authority: authorityFromClaim(record, parent.lease) };
      const heartbeat = await store.transact('test', (transaction) =>
        repository.heartbeat(mutation(parent, registered), transaction),
      );
      expect(heartbeat).toMatchObject({ revision: 2, checkpoint: { status: 'running' } });
      expect(Date.parse(heartbeat.checkpoint.lease!.expiresAt)).toBeGreaterThan(
        Date.parse(registered.checkpoint.lease!.expiresAt),
      );

      const evidence = await store.transact('test', (transaction) =>
        repository.loadExactEvidence(mutation(parent, registered), transaction),
      );
      expect(evidence).toMatchObject({ source: item, deliveryId: registered.deliveryId });

      await expect(
        store.transact('test', (transaction) =>
          repository.loadExactEvidence(
            { ...mutation(parent, registered), leaseToken: randomUUID() },
            transaction,
          ),
        ),
      ).rejects.toMatchObject({ code: 'STALE_CHILD_LEASE' });

      const semanticOutputHash = 'c'.repeat(64);
      const completed = await store.transact('test', (transaction) =>
        repository.complete(
          { ...mutation(parent, registered), semanticOutputHash },
          transaction,
        ),
      );
      const replay = await store.transact('test', (transaction) =>
        repository.complete(
          { ...mutation(parent, registered), semanticOutputHash },
          transaction,
        ),
      );
      expect(completed).toMatchObject({ revision: 3, checkpoint: { status: 'completed' } });
      expect(replay).toEqual(completed);
      await expect(
        store.transact('test', (transaction) =>
          repository.loadExactEvidence(mutation(parent, registered), transaction),
        ),
      ).rejects.toMatchObject({ code: 'STALE_CHILD_LEASE' });
      expect(
        await store.transact('test', (transaction) =>
          repository.claim(
            { ...mutation(parent, registered), leaseToken: randomUUID() },
            transaction,
          ),
        ),
      ).toMatchObject({ kind: 'duplicate', checkpoint: { status: 'completed' } });
      await expect(
        store.transact('test', (transaction) =>
          repository.complete(
            { ...mutation(parent, registered), semanticOutputHash: 'd'.repeat(64) },
            transaction,
          ),
        ),
      ).rejects.toMatchObject({ code: 'OUTPUT_CONFLICT' });
    });

    it('rejects source persistence outside the exact manifest rights authority', async () => {
      const parent = await activeParent();
      const retired = { ...source('retired-rights'), rightsPolicyVersion: 'retired-rights-v0' };
      await expect(register(parent, retired)).rejects.toMatchObject({
        code: 'RIGHTS_POLICY_CONFLICT',
      });
      expect(
        (
          await pool.query<{ count: string }>(
            `select count(*)::text as count from rni_source_item where id=$1`,
            [retired.id],
          )
        ).rows[0]!.count,
      ).toBe('0');

      const registered = await register(parent, source('crossed-stored-rights'));
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query(`set local session_replication_role='replica'`);
        await client.query(
          `update rni_source_item set rights_policy_version='retired-rights-v0' where id=$1`,
          [registered.source.id],
        );
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
      await expect(
        store.transact('test', (transaction) =>
          repository.loadExactEvidence(mutation(parent, registered), transaction),
        ),
      ).rejects.toMatchObject({ code: 'RIGHTS_POLICY_CONFLICT' });
    });

    it('refuses effect input after the child lease expires by database time', async () => {
      const parent = await activeParent();
      const registered = await register(parent, source('expired-effect-lease'));
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query(`set local session_replication_role='replica'`);
        await client.query(
          `update rni_source_workflow_checkpoint
              set started_at=clock_timestamp()-interval '3 seconds',
                  lease_acquired_at=clock_timestamp()-interval '2 seconds',
                  updated_at=clock_timestamp()-interval '1.5 seconds',
                  lease_expires_at=clock_timestamp()-interval '1 second'
            where delivery_id=$1`,
          [registered.deliveryId],
        );
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
      expect(
        (
          await pool.query<{ session_replication_role: string }>(
            'show session_replication_role',
          )
        ).rows[0]!.session_replication_role,
      ).toBe('origin');
      await expect(
        store.transact('test', (transaction) =>
          repository.loadExactEvidence(mutation(parent, registered), transaction),
        ),
      ).rejects.toMatchObject({ code: 'STALE_CHILD_LEASE' });
    });

    it('persists retry/deferred/reclaim and budget-terminal behavior', async () => {
      const parent = await activeParent();
      const registered = await register(parent, source('retry-budget'));
      const scheduled = await store.transact('test', (transaction) =>
        repository.retry(
          { ...mutation(parent, registered), errorCode: 'PROVIDER_TRANSIENT' },
          transaction,
        ),
      );
      expect(scheduled).toMatchObject({ kind: 'scheduled', checkpoint: { status: 'retry_wait' } });
      expect(scheduled.checkpoint.retry?.delayMs).toBe(1_000);
      expect(
        await store.transact('test', (transaction) =>
          repository.claim(
            { ...mutation(parent, registered), leaseToken: randomUUID() },
            transaction,
          ),
        ),
      ).toMatchObject({ kind: 'deferred', checkpoint: { status: 'retry_wait' } });

      await pause(1_050);
      const nextToken = randomUUID();
      const reclaimed = await store.transact('test', (transaction) =>
        repository.claim(
          { ...mutation(parent, registered), leaseToken: nextToken },
          transaction,
        ),
      );
      expect(reclaimed).toMatchObject({ kind: 'acquired', checkpoint: { attempt: 2 } });
      const stopped = await store.transact('test', (transaction) =>
        repository.stopForBudget(
          {
            ...mutation(parent, registered, 'checkpoint-worker', nextToken),
            reason: 'cost',
          },
          transaction,
        ),
      );
      expect(stopped).toMatchObject({
        checkpoint: { status: 'budget_stopped', terminal: { kind: 'budget_stopped', reason: 'cost' } },
      });
      expect(
        await store.transact('test', (transaction) =>
          repository.claim(
            { ...mutation(parent, registered), leaseToken: randomUUID() },
            transaction,
          ),
        ),
      ).toMatchObject({ kind: 'terminal', checkpoint: { status: 'budget_stopped' } });
    });

    it('persists permanent failure as an immutable terminal checkpoint', async () => {
      const parent = await activeParent();
      const registered = await register(parent, source('failure'));
      const failed = await store.transact('test', (transaction) =>
        repository.fail(
          { ...mutation(parent, registered), errorCode: 'SOURCE_INVALID' },
          transaction,
        ),
      );
      expect(failed).toMatchObject({
        checkpoint: {
          status: 'permanent_failure',
          terminal: { kind: 'permanent_failure', errorCode: 'SOURCE_INVALID' },
        },
      });
      expect(
        await store.transact('test', (transaction) =>
          repository.claim(
            { ...mutation(parent, registered), leaseToken: randomUUID() },
            transaction,
          ),
        ),
      ).toMatchObject({ kind: 'terminal', checkpoint: { status: 'permanent_failure' } });
    });

    it('rejects crossed manifest/retrieval/content/outbox identities and stale source tokens', async () => {
      const parent = await activeParent();
      const registered = await register(parent, source('crossed'));
      const delivery = registered.checkpoint.delivery;
      for (const subjectPatch of [
        { runManifestHash: 'f'.repeat(64) },
        { retrievalId: randomUUID() },
        { contentVersionId: randomUUID() },
        { outboxEventId: randomUUID() },
      ]) {
        const crossed = {
          ...delivery,
          subject: { ...delivery.subject, ...subjectPatch },
        } as RniSourceWorkflowDeliveryV2;
        await expect(
          store.transact('test', (transaction) => repository.load('test', crossed, transaction)),
        ).rejects.toMatchObject({ code: 'DELIVERY_CONFLICT' });
      }
      await expect(
        store.transact('test', (transaction) =>
          repository.heartbeat(
            { ...mutation(parent, registered), leaseToken: randomUUID() },
            transaction,
          ),
        ),
      ).rejects.toMatchObject({ code: 'STALE_LEASE' });
      const stored = await store.transact('test', (transaction) =>
        repository.load('test', delivery, transaction),
      );
      expect(stored).toMatchObject({ revision: 1, checkpoint: { status: 'running' } });
    });

    it('rejects crossed parent authority before persisting the source quartet', async () => {
      const parent = await activeParent();
      const item = source('crossed-parent');
      const crossedToken = randomUUID();
      await expect(
        store.transact('test', (transaction) =>
          repository.registerSourceAndClaim(
            {
              partition: 'test',
              outerLease: { ...parent.lease, token: crossedToken },
              authority: { ...parent.authority, outerToken: crossedToken },
              source: item,
              stageVersion: 'rni-interpret-source-v2',
              leaseOwner: 'checkpoint-worker',
              leaseToken: randomUUID(),
            },
            transaction,
          ),
        ),
      ).rejects.toMatchObject({ code: 'STALE_PARENT_AUTHORITY' });
      expect(
        (
          await pool.query<{ count: string }>(
            `select count(*)::text as count from rni_source_item where id=$1`,
            [item.id],
          )
        ).rows[0]!.count,
      ).toBe('0');
    });

    it('rolls the source quartet, delivery, and checkpoint back with the caller transaction', async () => {
      const parent = await activeParent();
      const item = source('rollback');
      await expect(
        store.transact('test', async (transaction) => {
          await repository.registerSourceAndClaim(
            {
              partition: 'test',
              outerLease: parent.lease,
              authority: parent.authority,
              source: item,
              stageVersion: 'rni-interpret-source-v2',
              leaseOwner: 'checkpoint-worker',
              leaseToken: randomUUID(),
            },
            transaction,
          );
          throw new Error('ROLLBACK_SENTINEL');
        }),
      ).rejects.toThrow('ROLLBACK_SENTINEL');
      const counts = await pool.query<{
        sources: string;
        retrievals: string;
        contents: string;
        events: string;
        deliveries: string;
        checkpoints: string;
      }>(
        `select
           (select count(*) from rni_source_item where id=$1)::text sources,
           (select count(*) from rni_source_retrieval where source_item_id=$1)::text retrievals,
           (select count(*) from rni_source_content_version where source_item_id=$1)::text contents,
           (select count(*) from rni_event_outbox where source_item_id=$1)::text events,
           (select count(*) from rni_source_workflow_delivery where source_item_id=$1)::text deliveries,
           (select count(*) from rni_source_workflow_checkpoint checkpoint
              join rni_source_workflow_delivery delivery on delivery.id=checkpoint.delivery_id
             where delivery.source_item_id=$1)::text checkpoints`,
        [item.id],
      );
      expect(counts.rows).toEqual([
        { sources: '0', retrievals: '0', contents: '0', events: '0', deliveries: '0', checkpoints: '0' },
      ]);
    });

    it('commits a fresh delivery and checkpoint with all origin-mode triggers enabled', async () => {
      const parent = await activeParent();
      const registered = await register(parent, source('origin-registration'));
      expect(registered).toMatchObject({
        revision: 1,
        claim: { kind: 'acquired' },
        checkpoint: { status: 'running', attempt: 1 },
      });
      expect(
        (
          await pool.query<{ count: string }>(
            `select count(*)::text as count
               from rni_source_workflow_delivery delivery
               join rni_source_workflow_checkpoint checkpoint
                 on checkpoint.delivery_id=delivery.id
              where delivery.id=$1`,
            [registered.deliveryId],
          )
        ).rows[0]!.count,
      ).toBe('1');
    });

    it('documents the current identical-content/new-retrieval exact-lineage blocker', async () => {
      const parent = await activeParent();
      const item = source('identical-content');
      await register(parent, item);
      const repeated = {
        ...item,
        id: randomUUID(),
        providerRequestId: `checkpoint-repeat-${randomUUID()}`,
        observedAt: new Date(clock + 1_000).toISOString(),
        createdAt: new Date(clock + 1_000).toISOString(),
      };
      await expect(
        store.transact('test', (transaction) =>
          repository.registerSourceAndClaim(
            {
              partition: 'test',
              outerLease: parent.lease,
              authority: parent.authority,
              source: repeated,
              stageVersion: 'rni-interpret-source-v2',
              leaseOwner: 'checkpoint-worker',
              leaseToken: randomUUID(),
            },
            transaction,
          ),
        ),
      ).rejects.toMatchObject({ code: 'DELIVERY_CONFLICT' });
      expect(
        (
          await pool.query<{ count: string }>(
            `select count(*)::text as count from rni_source_retrieval where source_item_id=$1`,
            [item.id],
          )
        ).rows[0]!.count,
      ).toBe('1');
    });
  },
);
