import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { databaseUrl, makePool, resetSchema, truncateAll } from '../helpers/db';
import {
  assertRniAiInvocationEffect,
  reserveRniAiInvocation,
} from '../../../src/repositories/versions';
import { rniModelTask } from '../../../src/rni/contracts';
import { RniRefreshService, validateRniExecution } from '../../../src/rni/orchestration/refresh';
import { RniPlatformExecutionService } from '../../../src/rni/orchestration/execution';
import { RniCombinedExecutionService } from '../../../src/rni/orchestration/combined';
import { hashRniWorkerSnapshotValue } from '../../../src/rni/orchestration/worker-manifest';
import type { RniExecutionRecord } from '../../../src/rni/orchestration/types';
import {
  ensureRniJobDefinitions,
  PostgresRniOrchestrationStore,
} from '../../../src/rni/repositories/orchestration';
import { seedTestWorkerAuthorities } from './helpers/worker-authorities';

const HASH = 'a'.repeat(64);
const PRICE_BOOK = 'rni-fence-price-v1';
const BUILD = {
  deploymentId: 'rni-fence-deployment',
  commitSha: '5'.repeat(40),
  artifactHash: '6'.repeat(64),
  sourceAdapterVersions: { reddit: 'reddit-fence-v1', x: 'x-fence-v1' },
  semanticCodeVersion: 'semantic-fence-v1',
  analyticsCodeVersion: 'analytics-fence-v1',
  convergenceCodeVersion: 'convergence-fence-v1',
  citedSynthesisCodeVersion: 'synthesis-fence-v1',
} as const;
type PublicationProof = NonNullable<RniExecutionRecord['combined']['publication']>;

describe.skipIf(databaseUrl() === undefined)(
  'I09 — PostgreSQL execution and publication fences',
  () => {
    let pool: pg.Pool;
    let store: PostgresRniOrchestrationStore;
    let service: RniRefreshService;
    let worker: RniPlatformExecutionService;
    let combined: RniCombinedExecutionService;
    let clock: number;

    beforeAll(async () => {
      pool = makePool();
      await resetSchema(pool);
    }, 60_000);

    beforeEach(async () => {
      await truncateAll(pool);
      // Minimal governed setup copied from orchestration-store.test.ts; no fixture service or
      // disabled database guard participates in the production adapters exercised below.
      const configVersion = (
        await pool.query<{ id: string }>(
          `insert into config_version (environment,status,created_by,change_reason,checksum)
         values ('test','draft','coordinator','I09 fencing fixture',$1) returning id::text`,
          [randomUUID()],
        )
      ).rows[0]!.id;
      for (const model of ['gpt-5.6-terra', 'gpt-5.6-sol']) {
        await pool.query(
          `insert into rni_model_capability_snapshot
         (id,ai_route,configured_model_id,provider,canonical_provider_model_id,model_revision,
          response_hash,observed_at,expires_at,available,supports_responses,
          supports_structured_outputs,supports_web_search,reasoning_efforts)
         values ($1,'openai_direct',$1,'openai',$1,'fence-revision',$2,
           now()-interval '1 hour',
           case when $1='gpt-5.6-terra' then now()+interval '30 seconds'
                else now()+interval '1 day' end,
           true,true,true,true,'["low"]')`,
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
         values ($1,$2,'openai_responses','openai',$3,'fence-revision','[]',$2||'-v1',
           'rni-schema-v1','rni-fence-calibration-v1',1024,256,30000,0.1,'openai_direct',$3,'low',$3,
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
         values ('fmp','/stable/sp500-constituent','rni-fence-manifest-fixture',200,1,'miss',501,
           now()-interval '1 hour') returning id`,
        )
      ).rows[0]!.id;
      const universeVersion = (
        await pool.query<{ id: string }>(
          `insert into universe_version
         (environment,config_version,status,selected_count,created_by,change_reason,activated_at,
          source_provider,source_endpoint,source_retrieved_at,source_payload_hash,
          provider_call_id,approved_by)
         values ('test',$1,'active',501,'coordinator','D-RNI-32 fencing fixture',now(),
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
       values ($1,'https://example.test/fence-prices',$2,now()-interval '1 hour',272000)`,
        [PRICE_BOOK, HASH],
      );
      for (const model of ['gpt-5.6-terra', 'gpt-5.6-sol']) {
        for (const unit of ['input_token', 'output_token']) {
          await pool.query(
            `insert into unit_price_book
         (price_book_version,provider,service,operation_or_model,unit_type,unit_price,currency,
          effective_from,source_reference)
         values ($1,'openai','openai_responses',$2,$3,0.00001,'USD',
           now()-interval '1 hour','I09 fencing fixture')`,
            [PRICE_BOOK, model, unit],
          );
        }
      }
      await pool.query(
        `insert into unit_price_book
       (price_book_version,provider,service,operation_or_model,unit_type,unit_price,currency,
        effective_from,source_reference)
       values ($1,'openai','openai_web_search','web_search','search',0.001,'USD',
         now()-interval '1 hour','I09 fencing fixture')`,
        [PRICE_BOOK],
      );
      const definitions = await ensureRniJobDefinitions('test', pool);
      clock = Date.now();
      store = new PostgresRniOrchestrationStore(pool, {
        deploymentId: BUILD.deploymentId,
        commitSha: BUILD.commitSha,
        artifactHash: BUILD.artifactHash,
      });
      const deps = { store, partition: 'test', now: () => new Date(clock), newId: randomUUID };
      service = new RniRefreshService({
        ...deps,
        actor: 'coordinator',
        manualJobId: definitions.manualJobId,
        authorize: async () => {},
      });
      worker = new RniPlatformExecutionService(deps);
      combined = new RniCombinedExecutionService(deps);
    });

    afterAll(async () => {
      await pool?.end();
    });

    async function execution(runId: string) {
      return store.transact('test', async (tx) =>
        validateRniExecution(await tx.getExecution(runId), 'test', runId),
      );
    }

    async function request() {
      const accepted = await service.requestManualRefresh({
        idempotencyKey: randomUUID(),
        scope: { kind: 'ticker', ticker: 'NVDA' },
      });
      return execution(accepted.runId);
    }

    const reservation = (
      runId: string,
      task: 'rni_classifier' | 'rni_discovery' = 'rni_classifier',
      executionAuthority?: {
        stage: 'reddit' | 'x' | 'combined';
        attempt: number;
        token: string;
      },
    ) => ({
      invocationId: randomUUID(),
      runId,
      task,
      requestHash: HASH,
      capabilitySnapshotId: 'gpt-5.6-terra',
      priceBookVersion: PRICE_BOOK,
      ...(executionAuthority === undefined ? {} : { executionAuthority }),
    });

    async function budgetState(runId: string) {
      return (
        await pool.query<{
          remaining: string;
          released_at: Date | null;
          bindings: number;
          costs: number;
        }>(
          `select remaining_admission_usd as remaining,released_at,
         (select count(*)::integer from rni_orchestration_invocation_binding where run_id=$1) as bindings,
         (select count(*)::integer from cost_event) as costs
       from rni_orchestration_execution where run_id=$1`,
          [runId],
        )
      ).rows[0]!;
    }

    async function expectFenceDenial(
      runId: string,
      executionAuthority: {
        stage: 'reddit' | 'x' | 'combined';
        attempt: number;
        token: string;
      } = {
        stage: 'reddit' as const,
        attempt: 1,
        token: randomUUID(),
      },
    ) {
      const before = await budgetState(runId);
      const input = reservation(runId, 'rni_classifier', executionAuthority);
      const denied = await reserveRniAiInvocation(input, pool);
      expect(denied).toMatchObject({ decision: 'denied', denialCode: 'execution_fence_expired' });
      expect(await budgetState(runId)).toEqual(before);
      expect(await reserveRniAiInvocation(input, pool)).toEqual(denied);
      expect(await budgetState(runId)).toEqual(before);
    }

    it('denies a fresh reservation without an active lease and leaves admission unconsumed', async () => {
      const record = await request();
      await expectFenceDenial(record.run.id);
    });

    it('denies an expired execution even when its persisted run still says running', async () => {
      clock -= 20 * 60_000;
      const record = await request();
      const claim = await worker.claim(record.platforms.reddit.delivery);
      if (claim.status !== 'acquired') throw new Error('Expected Reddit lease');
      expect(
        (
          await pool.query(
            `select deadline<clock_timestamp() as expired,record #>> '{run,status}' as status
       from rni_orchestration_execution where run_id=$1`,
            [record.run.id],
          )
        ).rows,
      ).toEqual([{ expired: true, status: 'running' }]);
      await expectFenceDenial(record.run.id, {
        stage: 'reddit',
        attempt: claim.lease.delivery.attempt,
        token: claim.lease.token,
      });
    });

    it('denies an expired lease before the run deadline and leaves admission unconsumed', async () => {
      clock -= 2 * 60_000;
      const record = await request();
      const claim = await worker.claim(record.platforms.reddit.delivery);
      if (claim.status !== 'acquired') throw new Error('Expected Reddit lease');
      expect(
        (
          await pool.query(
            `select deadline>clock_timestamp() as run_live,
         (record #>> '{platforms,reddit,lease,expiresAt}')::timestamptz<clock_timestamp() as lease_expired
       from rni_orchestration_execution where run_id=$1`,
            [record.run.id],
          )
        ).rows,
      ).toEqual([{ run_live: true, lease_expired: true }]);
      await expectFenceDenial(record.run.id, {
        stage: 'reddit',
        attempt: claim.lease.delivery.attempt,
        token: claim.lease.token,
      });
    });

    it('reserves under the exact active run lease and converts admission once on exact replay', async () => {
      const record = await request();
      const claim = await worker.claim(record.platforms.reddit.delivery);
      if (claim.status !== 'acquired') throw new Error('Expected Reddit lease');
      const before = await budgetState(record.run.id);
      const input = reservation(record.run.id, 'rni_classifier', {
        stage: 'reddit',
        attempt: claim.lease.delivery.attempt,
        token: claim.lease.token,
      });
      const accepted = await reserveRniAiInvocation(input, pool);
      expect(accepted).toMatchObject({
        decision: 'reserved',
        denialCode: null,
        dispatchAuthorized: true,
      });
      const after = await budgetState(record.run.id);
      expect(
        new Decimal(before.remaining).minus(after.remaining).eq(accepted.estimatedCostUsd!),
      ).toBe(true);
      expect(after.bindings).toBe(1);
      expect(after.costs).toBe(1);
      expect(await reserveRniAiInvocation(input, pool)).toEqual({
        ...accepted,
        dispatchAuthorized: false,
      });
      expect(await budgetState(record.run.id)).toEqual(after);
    });

    it('bounds provider effect authority by the exact capability expiry', async () => {
      const record = await request();
      const claim = await worker.claim(record.platforms.reddit.delivery);
      if (claim.status !== 'acquired') throw new Error('Expected Reddit lease');
      const input = reservation(record.run.id, 'rni_classifier', {
        stage: 'reddit',
        attempt: claim.lease.delivery.attempt,
        token: claim.lease.token,
      });
      await reserveRniAiInvocation(input, pool);
      const effectExpiry = await assertRniAiInvocationEffect(
        {
          invocationId: input.invocationId,
          runId: input.runId,
          executionAuthority: input.executionAuthority!,
        },
        pool,
      );
      const capabilityExpiry = (
        await pool.query<{ expires_at: Date }>(
          'select expires_at from rni_model_capability_snapshot where id=$1',
          [input.capabilitySnapshotId],
        )
      ).rows[0]!.expires_at.toISOString();

      expect(effectExpiry).toBe(capabilityExpiry);
      expect(Date.parse(effectExpiry)).toBeLessThan(
        Date.parse(claim.record.platforms.reddit.lease!.expiresAt),
      );
    });

    it('binds a valid-authority denial for exact replay and rejects a crossed token', async () => {
      const unpricedBook = 'rni-unpriced-fence-v1';
      await pool.query(
        `insert into rni_price_book_evidence
         (price_book_version,source_url,response_hash,observed_at,first_tier_input_ceiling)
         values ($1,'https://example.test/unpriced',$2,now(),272000)`,
        [unpricedBook, HASH],
      );
      const record = await request();
      const claim = await worker.claim(record.platforms.reddit.delivery);
      if (claim.status !== 'acquired') throw new Error('Expected Reddit lease');
      const input = {
        ...reservation(record.run.id, 'rni_classifier', {
          stage: 'reddit' as const,
          attempt: claim.lease.delivery.attempt,
          token: claim.lease.token,
        }),
        priceBookVersion: unpricedBook,
      };
      const before = await budgetState(record.run.id);
      const denied = await reserveRniAiInvocation(input, pool);
      expect(denied).toMatchObject({
        decision: 'denied',
        denialCode: 'unpriced_component',
        dispatchAuthorized: false,
      });
      expect(await budgetState(record.run.id)).toEqual({ ...before, bindings: 1 });
      expect(await reserveRniAiInvocation(input, pool)).toEqual(denied);
      await expect(
        reserveRniAiInvocation(
          {
            ...input,
            executionAuthority: {
              stage: 'reddit',
              attempt: claim.lease.delivery.attempt,
              token: randomUUID(),
            },
          },
          pool,
        ),
      ).rejects.toThrow(/crossed its execution lease authority/u);
    });

    it('waits for an in-flight lifecycle transition and rejects the superseded effect token', async () => {
      const record = await request();
      const claim = await worker.claim(record.platforms.reddit.delivery);
      if (claim.status !== 'acquired') throw new Error('Expected Reddit lease');
      const input = reservation(record.run.id, 'rni_classifier', {
        stage: 'reddit',
        attempt: claim.lease.delivery.attempt,
        token: claim.lease.token,
      });
      await reserveRniAiInvocation(input, pool);

      const transition = await pool.connect();
      try {
        await transition.query('begin');
        await transition.query(
          `select pg_advisory_xact_lock(hashtextextended('rni-ai-budget:' || $1, 0))`,
          ['test'],
        );
        await transition.query(
          `select pg_advisory_xact_lock(hashtextextended('rni-orchestration:' || $1, 0))`,
          ['test'],
        );
        await transition.query(
          `update rni_orchestration_execution
              set record=jsonb_set(record,'{platforms,reddit,lease,token}',to_jsonb($2::text))
            where run_id=$1`,
          [record.run.id, randomUUID()],
        );

        const effect = assertRniAiInvocationEffect(
          {
            invocationId: input.invocationId,
            runId: input.runId,
            executionAuthority: input.executionAuthority!,
          },
          pool,
        );
        expect(
          await Promise.race([
            effect.then(
              () => 'authorized',
              () => 'rejected',
            ),
            new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 100)),
          ]),
        ).toBe('blocked');
        await transition.query('commit');
        await expect(effect).rejects.toThrow(/exact live execution lease authority/u);
      } finally {
        await transition.query('rollback');
        transition.release();
      }
    });

    it('does not allow an X-only lease to authorize Reddit discovery', async () => {
      const record = await request();
      const claim = await worker.claim(record.platforms.x.delivery);
      if (claim.status !== 'acquired') throw new Error('Expected X lease');
      const before = await budgetState(record.run.id);
      expect(
        await reserveRniAiInvocation(
          reservation(record.run.id, 'rni_discovery', {
            stage: 'x',
            attempt: claim.lease.delivery.attempt,
            token: claim.lease.token,
          }),
          pool,
        ),
      ).toMatchObject({ decision: 'denied', denialCode: 'execution_fence_expired' });
      expect(await budgetState(record.run.id)).toEqual(before);
    });

    it('keeps Reddit and X task-call slots independent', async () => {
      const record = await request();
      const reddit = await worker.claim(record.platforms.reddit.delivery);
      const x = await worker.claim(record.platforms.x.delivery);
      if (reddit.status !== 'acquired' || x.status !== 'acquired') {
        throw new Error('Expected independent Reddit and X leases');
      }
      for (let ordinal = 0; ordinal < 3; ordinal += 1) {
        await expect(
          reserveRniAiInvocation(
            reservation(record.run.id, 'rni_classifier', {
              stage: 'reddit',
              attempt: reddit.lease.delivery.attempt,
              token: reddit.lease.token,
            }),
            pool,
          ),
        ).resolves.toMatchObject({ decision: 'reserved', dispatchAuthorized: true });
      }
      await expect(
        reserveRniAiInvocation(
          reservation(record.run.id, 'rni_classifier', {
            stage: 'reddit',
            attempt: reddit.lease.delivery.attempt,
            token: reddit.lease.token,
          }),
          pool,
        ),
      ).resolves.toMatchObject({ decision: 'denied', denialCode: 'call_limit_exhausted' });
      await expect(
        reserveRniAiInvocation(
          reservation(record.run.id, 'rni_classifier', {
            stage: 'x',
            attempt: x.lease.delivery.attempt,
            token: x.lease.token,
          }),
          pool,
        ),
      ).resolves.toMatchObject({ decision: 'reserved', dispatchAuthorized: true });
    });

    it('rejects a stale Reddit token even while X owns a fresh lease', async () => {
      clock -= 2 * 60_000;
      const record = await request();
      const reddit = await worker.claim(record.platforms.reddit.delivery);
      if (reddit.status !== 'acquired') throw new Error('Expected Reddit lease');
      clock += 2 * 60_000;
      const x = await worker.claim(record.platforms.x.delivery);
      if (x.status !== 'acquired') throw new Error('Expected X lease');
      const before = await budgetState(record.run.id);

      expect(
        await reserveRniAiInvocation(
          reservation(record.run.id, 'rni_classifier', {
            stage: 'reddit',
            attempt: reddit.lease.delivery.attempt,
            token: reddit.lease.token,
          }),
          pool,
        ),
      ).toMatchObject({ decision: 'denied', denialCode: 'execution_fence_expired' });
      expect(await budgetState(record.run.id)).toEqual(before);
      expect(
        await reserveRniAiInvocation(
          reservation(record.run.id, 'rni_classifier', {
            stage: 'x',
            attempt: x.lease.delivery.attempt,
            token: x.lease.token,
          }),
          pool,
        ),
      ).toMatchObject({ decision: 'reserved', dispatchAuthorized: true });
    });

    async function readyPublication() {
      const initial = await request();
      for (const platform of ['reddit', 'x'] as const) {
        const claim = await worker.claim(initial.platforms[platform].delivery);
        if (claim.status !== 'acquired') throw new Error('Expected platform lease');
        await worker.finish(claim.lease, {
          status: 'complete',
          eligibleSourceCount: 0,
          dataThroughAt: null,
          computedAt: new Date(clock).toISOString(),
        });
      }
      const ready = await execution(initial.run.id);
      const claim = await combined.claim(ready.combined.delivery);
      if (claim.status !== 'acquired') throw new Error('Expected combined lease');
      const record = await execution(initial.run.id);
      const proof: PublicationProof = {
        artifact: {
          runId: record.run.id,
          planHash: record.planHash,
          artifactHash: HASH,
          status: 'insufficient',
        },
        token: claim.lease.token,
        attempt: claim.lease.delivery.attempt,
        acquiredAt: record.combined.lastAttemptAt!,
        expiresAt: record.combined.lease!.expiresAt,
        committedAt: new Date(clock).toISOString(),
      };
      return { record, claim, proof };
    }

    async function publicationRows(runId: string) {
      return (
        await pool.query(
          `select e.record,to_jsonb(p) as receipt,r.status,j.status as job_status
       from rni_orchestration_execution e join rni_run r on r.id=e.run_id
       join job_run j on j.id=e.job_run_id
       left join rni_orchestration_publication_receipt p on p.run_id=e.run_id
       where e.run_id=$1`,
          [runId],
        )
      ).rows;
    }

    it.each(['replace', 'remove'] as const)(
      'rejects publication proof %s without changing the saved receipt or projection',
      async (mutation) => {
        const { record, claim, proof } = await readyPublication();
        // This exercises the orchestration transaction callback only. I07's E08 graph verification
        // has its own guarded integration suite; no provider or fake source content is used here.
        expect(
          await combined.commitPublication(claim.lease, proof.artifact, async () => proof.artifact),
        ).toBe('committed');
        const before = await publicationRows(record.run.id);
        await expect(
          store.transact('test', async (tx) => {
            const current = validateRniExecution(
              await tx.getExecution(record.run.id),
              'test',
              record.run.id,
            );
            if (mutation === 'remove') current.combined.publication = null;
            else current.combined.publication!.artifact.artifactHash = 'b'.repeat(64);
            await tx.putExecution(current);
          }),
        ).rejects.toThrow('CONFLICT');
        expect(await publicationRows(record.run.id)).toEqual(before);
      },
    );

    it('rejects a tampered mutable projection on load against its immutable publication receipt', async () => {
      const { record, claim, proof } = await readyPublication();
      await combined.commitPublication(claim.lease, proof.artifact, async () => proof.artifact);
      const before = (await publicationRows(record.run.id))[0]!.receipt;
      await pool.query(
        `update rni_orchestration_execution
       set record=jsonb_set(record,'{combined,publication,artifact,artifactHash}',to_jsonb($2::text))
       where run_id=$1`,
        [record.run.id, 'b'.repeat(64)],
      );
      await expect(execution(record.run.id)).rejects.toThrow('CONFLICT');
      expect((await publicationRows(record.run.id))[0]!.receipt).toEqual(before);
    });

    async function insertReceipt(
      client: pg.PoolClient,
      record: RniExecutionRecord,
      proof: PublicationProof,
    ) {
      await client.query(
        `insert into rni_orchestration_publication_receipt
       (run_id,plan_hash,artifact_hash,status,token,attempt,acquired_at,expires_at,committed_at,artifact)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          record.run.id,
          record.planHash,
          proof.artifact.artifactHash,
          proof.artifact.status,
          proof.token,
          proof.attempt,
          proof.acquiredAt,
          proof.expiresAt,
          proof.committedAt,
          JSON.stringify(proof.artifact),
        ],
      );
    }

    it.each(
      [
        ['combined', 'status'],
        ['combined', 'lease', 'token'],
        ['combined', 'attempt'],
        ['combined', 'lastAttemptAt'],
        ['combined', 'lease', 'expiresAt'],
        ['combined', 'publication', 'token'],
        ['combined', 'publication', 'attempt'],
      ].map((path) => ({ field: path.join('.'), path })),
    )('rejects nullable crossed receipt fields at deferred commit: $field', async ({ path }) => {
      const { record, proof } = await readyPublication();
      const before = await publicationRows(record.run.id);
      record.combined.publication = proof;
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query(
          `update rni_orchestration_execution set record=jsonb_set($2::jsonb,$3::text[],'null'::jsonb)
         where run_id=$1`,
          [record.run.id, JSON.stringify(record), path],
        );
        await insertReceipt(client, record, proof);
        expect(
          (
            await client.query(
              'select count(*)::integer as count from rni_orchestration_publication_receipt',
            )
          ).rows,
        ).toEqual([{ count: 1 }]);
        await expect(client.query('commit')).rejects.toMatchObject({
          constraint: 'rni_orchestration_publication_fence',
        });
      } finally {
        await client.query('rollback');
        client.release();
      }
      expect(await publicationRows(record.run.id)).toEqual(before);
    });

    it('rejects a receipt that expires after insertion but before deferred commit, rolling it back', async () => {
      const { record, proof } = await readyPublication();
      const before = await publicationRows(record.run.id);
      proof.expiresAt = new Date(Date.now() + 250).toISOString();
      record.combined.lease!.expiresAt = proof.expiresAt;
      record.combined.publication = proof;
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query('update rni_orchestration_execution set record=$2 where run_id=$1', [
          record.run.id,
          JSON.stringify(record),
        ]);
        await insertReceipt(client, record, proof);
        await client.query('select pg_sleep(0.35)');
        expect(
          (
            await client.query('select clock_timestamp()>$1::timestamptz as expired', [
              proof.expiresAt,
            ])
          ).rows,
        ).toEqual([{ expired: true }]);
        await expect(client.query('commit')).rejects.toMatchObject({
          constraint: 'rni_orchestration_publication_fence',
        });
      } finally {
        await client.query('rollback');
        client.release();
      }
      expect(await publicationRows(record.run.id)).toEqual(before);
    });
  },
);
