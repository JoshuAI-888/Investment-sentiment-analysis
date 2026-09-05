import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from '../helpers/db';
import { PostgresRniAiRouteSettingsService } from '../../../src/rni/settings/ai-route/repositories/store';
import { rniModelTask, type RniAiRoute } from '../../../src/rni/contracts';
import {
  activateConfigVersion,
  findActiveConfigVersion,
  findRniModelRunRoutes,
} from '../../../src/repositories/versions';
import { seedTestWorkerAuthorities } from './helpers/worker-authorities';

describe.skipIf(!databaseUrl())('live AI-route settings', () => {
  let pool: pg.Pool;
  let original: string;
  let credentials: Record<RniAiRoute, boolean>;
  const service = (environment = 'test', actorId = 'admin') =>
    new PostgresRniAiRouteSettingsService({
      environment,
      actorId,
      pool,
      credentialsAvailable: (route) => credentials[route],
    });
  const request = (idempotencyKey = randomUUID(), aiRoute: RniAiRoute = 'vercel_ai_gateway') => ({
    idempotencyKey,
    aiRoute,
    reason: 'Use the approved future route',
  });
  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
  }, 60_000);
  beforeEach(async () => {
    await truncateAll(pool);
    credentials = { openai_direct: true, vercel_ai_gateway: true };
    original = (
      await pool.query<{ id: string }>(`insert into config_version
      (environment,status,created_by,change_reason,checksum) values ('test','draft','admin','fixture','seed') returning id::text`)
    ).rows[0]!.id;
    for (const aiRoute of ['openai_direct', 'vercel_ai_gateway'] as const) {
      for (const model of ['gpt-5.6-terra', 'gpt-5.6-sol']) {
        await pool.query(
          `insert into rni_model_capability_snapshot
          (id,ai_route,configured_model_id,provider,canonical_provider_model_id,model_revision,response_hash,
           observed_at,expires_at,available,supports_responses,supports_structured_outputs,supports_web_search,reasoning_efforts)
          values ($1,$2,$3,'openai',$4,'revision-1',$5,now()-interval '1 hour',now()+interval '1 day',true,true,true,true,'["low"]')`,
          [
            `${aiRoute}-${model}`,
            aiRoute,
            aiRoute === 'openai_direct' ? model : `openai/${model}`,
            model,
            'a'.repeat(64),
          ],
        );
      }
    }
    await pool.query(
      `insert into rni_ai_config (config_version,ai_route,model_policy_version,budget_policy_version,
      manual_run_hard_usd,full_universe_hard_usd,rolling_24h_hard_usd,monthly_warning_usd,monthly_hard_usd)
      values ($1,'openai_direct','rni-balanced-model-policy-v1','rni-ai-budget-policy-v1',2,25,50,300,500)`,
      [original],
    );
    for (const task of rniModelTask.options) {
      const model = ['rni_verification', 'rni_challenger'].includes(task)
        ? 'gpt-5.6-sol'
        : 'gpt-5.6-terra';
      await pool.query(
        `insert into model_route (config_version,task,transport,primary_provider,primary_model,model_revision,
        fallback_chain,prompt_version,schema_version,max_input_tokens,max_output_tokens,timeout_ms,max_cost_usd,
        ai_route,canonical_provider_model_id,reasoning_effort,capability_snapshot_id,policy_version,max_input_bytes,max_tool_calls)
        values ($1,$2,'openai_responses','openai',$3,'revision-1','[]','prompt-custom','schema-custom',2048,768,45000,0.18,
        'openai_direct',$3,'low',$4,'rni-balanced-model-policy-v1',2048,$5)`,
        [original, task, model, `openai_direct-${model}`, task === 'rni_discovery' ? 2 : 0],
      );
    }
    await pool.query(
      `insert into model_route (config_version,task,transport,primary_provider,primary_model,model_revision,
        prompt_version,schema_version,max_input_tokens,max_output_tokens,timeout_ms,max_cost_usd)
       values ($1,'legacy-summary','openai_responses','openai','legacy-model','legacy-revision',
        'legacy-prompt','legacy-schema',1024,128,30000,0.1)`,
      [original],
    );
    await pool.query(
      `insert into app_setting (config_version,setting_key,scope_type,scope_id,value,value_type,
      governance_class,setting_schema_version) values ($1,'sample','global','*','{"safe":true}','object','operational','v1')`,
      [original],
    );
    await pool.query(
      `insert into provider_policy (config_version,provider,plan_name,timeout_ms,warning_age_seconds,
        hard_expiry_seconds,retention_days,rights_status,allowed_operations,daily_call_cap)
       values ($1,'fixture-provider','fixture-plan',12345,3600,7200,30,'internal_only','["fixture"]',7)`,
      [original],
    );
    await pool.query(
      `insert into budget_policy (config_version,environment,scope_type,scope_id,period,soft_limit,hard_limit,actions)
       values ($1,'test','global','*','monthly',123,234,'{"block":true}')`,
      [original],
    );
    await seedTestWorkerAuthorities(pool, original);
    await pool.query(`update config_version set status='active',activated_at=now() where id=$1`, [
      original,
    ]);
  });
  afterEach(async () => {
    await pool.query('drop trigger if exists ai_route_test_failure on audit_event');
    await pool.query('drop function if exists ai_route_test_failure()');
  });
  afterAll(async () => {
    await pool.end();
  });

  it('reads exact five-task active lineage and safe route availability', async () => {
    const current = await service().getCurrentAiRouteSetting();
    expect(current.configVersion).toBe(original);
    expect(current.aiRoute).toBe('openai_direct');
    expect(current.resolvedModels.map((r) => r.task)).toEqual(rniModelTask.options);
    expect(current.options.every((r) => r.available && r.unavailableReason === null)).toBe(true);
    expect(JSON.stringify(current)).not.toMatch(/api.key|response_hash|capability_snapshot/iu);
    credentials.vercel_ai_gateway = false;
    expect((await service().getCurrentAiRouteSetting()).options[1]!.available).toBe(false);
  });

  it('atomically activates a successor, preserves limits/settings and changes only future run resolution', async () => {
    const universe = (
      await pool.query<{ id: string }>(
        `insert into universe_version
      (environment,config_version,status,selected_count,created_by,change_reason) values ('test',$1,'draft',0,'admin','fixture') returning id::text`,
        [original],
      )
    ).rows[0]!.id;
    const oldRun = randomUUID();
    const addRun = (id: string, config: string, aiRoute: RniAiRoute) =>
      pool.query(
        `with inserted as (insert into rni_run
      (id,idempotency_key,trigger,requested_at,window_start,window_end,universe_version,config_version,prompt_version,ai_route,status)
      values ($1::uuid,$1::text,'manual',now(),now()-interval '1 day',now(),$2,$3,'prompt-custom',$4,'running') returning id)
      insert into rni_platform_slice (run_id,platform,status,coverage_disclosure)
      select id,platform,'pending','Fixture pending collection' from inserted
      cross join (values ('reddit'),('x')) platforms(platform)`,
        [id, universe, config, aiRoute],
      );
    await addRun(oldRun, original, 'openai_direct');
    const oldRoutes = await findRniModelRunRoutes(oldRun, pool);
    const changed = await service().updateFutureAiRoute(request());
    const next = changed.setting.configVersion;
    expect(next).not.toBe(original);
    expect((await findActiveConfigVersion('test', pool))!.id).toBe(next);
    // Resolution time is read-time metadata; immutable task/config/capability lineage is stable.
    expect(
      (await findRniModelRunRoutes(oldRun, pool)).map((r) => ({ ...r, resolved_at: null })),
    ).toEqual(oldRoutes.map((r) => ({ ...r, resolved_at: null })));
    const newRun = randomUUID();
    await addRun(newRun, next, 'vercel_ai_gateway');
    expect(
      (await findRniModelRunRoutes(newRun, pool)).every((r) => r.ai_route === 'vercel_ai_gateway'),
    ).toBe(true);
    expect(
      (
        await pool.query(
          'select max_input_bytes,max_output_tokens,timeout_ms,max_cost_usd,prompt_version from model_route where config_version=$1 order by task',
          [next],
        )
      ).rows,
    ).toEqual(
      (
        await pool.query(
          'select max_input_bytes,max_output_tokens,timeout_ms,max_cost_usd,prompt_version from model_route where config_version=$1 order by task',
          [original],
        )
      ).rows,
    );
    expect(
      (await pool.query('select value from app_setting where config_version=$1', [next])).rows,
    ).toEqual([{ value: { safe: true } }]);
    for (const table of ['provider_policy', 'budget_policy']) {
      const unchanged = await pool.query<{ same: boolean }>(
        `select (select jsonb_agg(to_jsonb(p)-'config_version'-'created_at'-'id') from ${table} p where config_version=$1)
          = (select jsonb_agg(to_jsonb(p)-'config_version'-'created_at'-'id') from ${table} p where config_version=$2) as same`,
        [original, next],
      );
      expect(unchanged.rows[0]!.same).toBe(true);
    }
    const aiConfigs = await pool.query(
      `select to_jsonb(a)-'config_version'-'created_at'-'ai_route' as limits
        from rni_ai_config a order by config_version`,
    );
    expect(aiConfigs.rows).toHaveLength(2);
    expect(aiConfigs.rows[0]).toEqual(aiConfigs.rows[1]);
    const legacyRoutes = await pool.query(
      `select to_jsonb(m)-'config_version'-'created_at' as route
        from model_route m where task='legacy-summary' order by config_version`,
    );
    expect(legacyRoutes.rows).toHaveLength(2);
    expect(legacyRoutes.rows[0]).toEqual(legacyRoutes.rows[1]);
    expect(changed.setting.resolvedModels.every((r) => r.modelId.startsWith('openai/'))).toBe(true);
    expect((await pool.query('select actor_id,actor_role,result from audit_event')).rows).toEqual([
      { actor_id: 'admin', actor_role: 'admin', result: 'success' },
    ]);
  });

  it('activates bounded aggregate budgets for future runs and route changes preserve them', async () => {
    const input = {
      idempotencyKey: randomUUID(),
      reason: 'Lower the future-run demo spend boundary',
      budgets: {
        manualRunHardUsd: '1',
        fullUniverseHardUsd: '10',
        rolling24hHardUsd: '20',
        monthlyWarningUsd: '30',
        monthlyHardUsd: '40',
        currency: 'USD' as const,
      },
    };
    const first = await service().updateFutureAiBudgets(input);
    expect(first.setting.budgets).toEqual(input.budgets);
    expect(first.setting.aiRoute).toBe('openai_direct');
    expect(await service().updateFutureAiBudgets(input)).toEqual({
      ...first,
      disposition: 'duplicate',
    });
    await expect(
      service().updateFutureAiBudgets({
        ...input,
        budgets: { ...input.budgets, manualRunHardUsd: '0.5' },
      }),
    ).rejects.toMatchObject({ kind: 'conflict' });
    await expect(
      service().updateFutureAiBudgets({
        ...input,
        idempotencyKey: randomUUID(),
        budgets: { ...input.budgets, manualRunHardUsd: '1.5' },
      }),
    ).rejects.toMatchObject({ kind: 'invalid' });
    expect(
      (
        await pool.query(
          `select config_version::text,manual_run_hard_usd::text,full_universe_hard_usd::text,
                  rolling_24h_hard_usd::text,monthly_warning_usd::text,monthly_hard_usd::text
             from rni_ai_config order by config_version`,
        )
      ).rows,
    ).toEqual([
      {
        config_version: original,
        manual_run_hard_usd: '2',
        full_universe_hard_usd: '25',
        rolling_24h_hard_usd: '50',
        monthly_warning_usd: '300',
        monthly_hard_usd: '500',
      },
      {
        config_version: first.setting.configVersion,
        manual_run_hard_usd: '1',
        full_universe_hard_usd: '10',
        rolling_24h_hard_usd: '20',
        monthly_warning_usd: '30',
        monthly_hard_usd: '40',
      },
    ]);
    const routeChanged = await service().updateFutureAiRoute(request());
    expect(routeChanged.setting.budgets).toEqual(input.budgets);
  });

  it('rejects an older RNI successor after the active budget chain advances', async () => {
    const stale = (
      await pool.query<{ id: string }>(
        `insert into config_version
           (environment,status,parent_version,created_by,change_reason,checksum)
         values ('test','draft',$1,'admin','Stale successor fixture',$2) returning id::text`,
        [original, randomUUID()],
      )
    ).rows[0]!.id;
    await pool.query(
      `insert into rni_ai_config
         (config_version,ai_route,model_policy_version,budget_policy_version,
          manual_run_hard_usd,full_universe_hard_usd,rolling_24h_hard_usd,
          monthly_warning_usd,monthly_hard_usd,currency)
       select $1,ai_route,model_policy_version,budget_policy_version,
          manual_run_hard_usd,full_universe_hard_usd,rolling_24h_hard_usd,
          monthly_warning_usd,monthly_hard_usd,currency
         from rni_ai_config where config_version=$2`,
      [stale, original],
    );
    const lowered = await service().updateFutureAiBudgets({
      idempotencyKey: randomUUID(),
      reason: 'Advance the active downward-only chain',
      budgets: {
        manualRunHardUsd: '1',
        fullUniverseHardUsd: '10',
        rolling24hHardUsd: '20',
        monthlyWarningUsd: '30',
        monthlyHardUsd: '40',
        currency: 'USD',
      },
    });

    await expect(
      activateConfigVersion(
        'test',
        stale,
        {
          actorId: 'admin',
          actorRole: 'admin',
          reason: 'Attempt stale activation',
          requestId: randomUUID(),
          correlationId: randomUUID(),
        },
        pool,
      ),
    ).rejects.toThrow(/direct active parent/u);
    expect((await findActiveConfigVersion('test', pool))!.id).toBe(lowered.setting.configVersion);
  });

  it('cannot escape the RNI budget chain through a non-RNI configuration gap', async () => {
    const lowered = await service().updateFutureAiBudgets({
      idempotencyKey: randomUUID(),
      reason: 'Lower before attempting a non-RNI gap',
      budgets: {
        manualRunHardUsd: '1',
        fullUniverseHardUsd: '10',
        rolling24hHardUsd: '20',
        monthlyWarningUsd: '30',
        monthlyHardUsd: '40',
        currency: 'USD',
      },
    });
    const nonRni = (
      await pool.query<{ id: string }>(
        `insert into config_version
           (environment,status,parent_version,created_by,change_reason,checksum)
         values ('test','draft',$1,'admin','Non-RNI gap fixture',$2) returning id::text`,
        [lowered.setting.configVersion, randomUUID()],
      )
    ).rows[0]!.id;
    const staleRaised = (
      await pool.query<{ id: string }>(
        `insert into config_version
           (environment,status,parent_version,created_by,change_reason,checksum)
         values ('test','draft',$1,'admin','Raised RNI after gap fixture',$2) returning id::text`,
        [nonRni, randomUUID()],
      )
    ).rows[0]!.id;
    await pool.query(
      `insert into rni_ai_config
         (config_version,ai_route,model_policy_version,budget_policy_version,
          manual_run_hard_usd,full_universe_hard_usd,rolling_24h_hard_usd,
          monthly_warning_usd,monthly_hard_usd,currency)
       values ($1,'openai_direct','rni-balanced-model-policy-v1','rni-ai-budget-policy-v1',
               2,25,50,300,500,'USD')`,
      [staleRaised],
    );

    for (const target of [nonRni, staleRaised]) {
      await expect(
        activateConfigVersion(
          'test',
          target,
          {
            actorId: 'admin',
            actorRole: 'admin',
            reason: 'Attempt RNI chain escape',
            requestId: randomUUID(),
            correlationId: randomUUID(),
          },
          pool,
        ),
      ).rejects.toThrow(/direct active parent|cannot raise aggregate budgets/u);
      expect((await findActiveConfigVersion('test', pool))!.id).toBe(
        lowered.setting.configVersion,
      );
    }
  });

  it('rejects unsafe budget limits before writing a successor', async () => {
    await expect(
      service().updateFutureAiBudgets({
        idempotencyKey: randomUUID(),
        reason: 'Attempt an unsafe increase',
        budgets: {
          manualRunHardUsd: '3',
          fullUniverseHardUsd: '25',
          rolling24hHardUsd: '50',
          monthlyWarningUsd: '300',
          monthlyHardUsd: '500',
          currency: 'USD',
        },
      }),
    ).rejects.toMatchObject({ kind: 'invalid' });
    expect((await pool.query('select count(*)::text from config_version')).rows[0]!.count).toBe(
      '1',
    );
  });

  it('returns exact replay even after another activation or later credential loss', async () => {
    const input = request();
    const first = await service().updateFutureAiRoute(input);
    await service().updateFutureAiRoute(request(randomUUID(), 'openai_direct'));
    credentials.vercel_ai_gateway = false;
    expect(await service().updateFutureAiRoute(input)).toEqual({
      ...first,
      disposition: 'duplicate',
    });
    await expect(
      service().updateFutureAiRoute({ ...input, reason: 'crossed reason' }),
    ).rejects.toMatchObject({ kind: 'conflict' });
    await expect(service('test', 'another-admin').updateFutureAiRoute(input)).rejects.toMatchObject(
      { kind: 'conflict' },
    );
  });

  it('serializes concurrent redelivery without duplicate successors', async () => {
    const input = request();
    const results = await Promise.all([
      service().updateFutureAiRoute(input),
      service().updateFutureAiRoute(input),
    ]);
    expect(results.map((r) => r.disposition).sort()).toEqual(['accepted', 'duplicate']);
    expect(new Set(results.map((r) => r.setting.configVersion)).size).toBe(1);
    expect((await pool.query('select count(*)::text from config_version')).rows[0]!.count).toBe(
      '2',
    );
  });

  it('serializes distinct concurrent commands into a single active successor chain', async () => {
    const results = await Promise.all([
      service().updateFutureAiRoute(request()),
      service().updateFutureAiRoute(request()),
    ]);
    const ids = results.map((r) => r.setting.configVersion);
    expect(new Set(ids).size).toBe(2);
    expect(results.filter((r) => r.previousConfigVersion === original)).toHaveLength(1);
    expect(results.some((r) => ids.includes(r.previousConfigVersion))).toBe(true);
    expect(
      (await pool.query("select count(*)::text from config_version where status='active'")).rows[0]!
        .count,
    ).toBe('1');
  });

  it('rejects unavailable targets and permits recovery without a successful current GET', async () => {
    credentials.vercel_ai_gateway = false;
    await expect(service().updateFutureAiRoute(request())).rejects.toMatchObject({
      kind: 'unavailable',
    });
    credentials.vercel_ai_gateway = true;
    credentials.openai_direct = false;
    await expect(service().getCurrentAiRouteSetting()).rejects.toMatchObject({
      kind: 'unavailable',
    });
    expect((await service().updateFutureAiRoute(request())).setting.aiRoute).toBe(
      'vercel_ai_gateway',
    );
  });

  it('does not resurrect older positive capabilities after a new negative probe', async () => {
    await pool.query(`insert into rni_model_capability_snapshot
      select 'new-denial',ai_route,configured_model_id,provider,canonical_provider_model_id,model_revision,response_hash,
        now(),now()+interval '1 day',false,supports_responses,supports_structured_outputs,supports_web_search,reasoning_efforts,now()
      from rni_model_capability_snapshot where id='vercel_ai_gateway-gpt-5.6-terra'`);
    expect((await service().getCurrentAiRouteSetting()).options[1]!.available).toBe(false);
    await expect(service().updateFutureAiRoute(request())).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  it('fails closed on newest expired evidence and permits current-route recovery', async () => {
    await pool.query(`insert into rni_model_capability_snapshot
      select 'new-expired',ai_route,configured_model_id,provider,canonical_provider_model_id,model_revision,response_hash,
        now()-interval '10 minutes',now()-interval '1 minute',true,supports_responses,supports_structured_outputs,supports_web_search,reasoning_efforts,now()
      from rni_model_capability_snapshot where id='openai_direct-gpt-5.6-terra'`);
    await expect(service().getCurrentAiRouteSetting()).rejects.toMatchObject({
      kind: 'unavailable',
    });
    await expect(
      service().updateFutureAiRoute(request(randomUUID(), 'openai_direct')),
    ).rejects.toMatchObject({ kind: 'unavailable' });
    expect((await service().updateFutureAiRoute(request())).setting.aiRoute).toBe(
      'vercel_ai_gateway',
    );
  });

  it('fails closed for missing environments and rejects non-intent input', async () => {
    await expect(service('production').getCurrentAiRouteSetting()).rejects.toMatchObject({
      kind: 'unavailable',
    });
    await expect(
      service().updateFutureAiRoute({ ...request(), modelId: 'attacker-model' } as never),
    ).rejects.toMatchObject({ kind: 'invalid' });
    await expect(
      service().updateFutureAiRoute({ ...request(), idempotencyKey: ' ' }),
    ).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('rolls back activation, clones and receipt together on a late audit failure', async () => {
    await pool.query(`create function ai_route_test_failure() returns trigger language plpgsql as $$
      begin raise exception 'forced audit failure'; end $$;
      create trigger ai_route_test_failure before insert on audit_event for each row execute function ai_route_test_failure()`);
    await expect(service().updateFutureAiRoute(request())).rejects.toThrow('forced audit failure');
    expect((await findActiveConfigVersion('test', pool))!.id).toBe(original);
    expect((await pool.query('select count(*)::text from config_version')).rows[0]!.count).toBe(
      '1',
    );
    expect((await pool.query('select count(*)::text from audit_event')).rows[0]!.count).toBe('0');
  });
});
