import { z } from 'zod';
import type pg from 'pg';
import Decimal from 'decimal.js';
import { canonicalHash } from '../../../../calc/canonical';
import { getPool, withTransaction, type Queryable } from '../../../../repositories/client';
import {
  rniAiRoute,
  rniAiRouteSetting,
  rniAiRouteSettingUpdateRequest,
  rniAiRouteSettingUpdateResult,
  rniAiBudgetSettingUpdateRequest,
  rniAiBudgetSettingUpdateResult,
  rniModelTask,
  type RniAiRoute,
  type RniAiRouteSetting,
  type RniAiRouteSettingsService,
  type RniAiRouteSettingUpdateResult,
} from '../../../contracts';
import { RniAiRouteSettingsError } from '../errors';

const TASKS = rniModelTask.options;
const unavailable = (): never => {
  throw new RniAiRouteSettingsError('unavailable');
};
const nonempty = z.string().min(1);
const version = z.string().regex(/^[1-9][0-9]*$/u);
const activeSchema = z.object({
  id: version,
  ai_route: rniAiRoute,
  effective_at: nonempty,
  manual_run_hard_usd: nonempty,
  full_universe_hard_usd: nonempty,
  rolling_24h_hard_usd: nonempty,
  monthly_warning_usd: nonempty,
  monthly_hard_usd: nonempty,
  currency: z.literal('USD'),
});
const routeSchema = z.object({
  task: rniModelTask,
  transport: z.literal('openai_responses'),
  primary_provider: z.literal('openai'),
  primary_model: nonempty,
  model_revision: nonempty,
  prompt_version: nonempty,
  canonical_provider_model_id: nonempty,
  ai_route: rniAiRoute,
  enabled: z.literal(true),
  capability_snapshot_id: nonempty,
  reasoning_effort: z.literal('low'),
  policy_version: z.literal('rni-balanced-model-policy-v1'),
  fallback_chain: z.array(z.unknown()).length(0),
});
const capabilitySchema = z.object({
  id: nonempty,
  configured_model_id: nonempty,
  canonical_provider_model_id: nonempty,
  model_revision: nonempty,
  ai_route: rniAiRoute,
});
type Capability = z.infer<typeof capabilitySchema>;
type Active = z.infer<typeof activeSchema>;
type Route = z.infer<typeof routeSchema>;

export type AiRouteSettingsOptions = {
  readonly environment: string;
  readonly actorId: string;
  /** Server-owned boolean authority only; no secret enters storage or a public response. */
  readonly credentialsAvailable: (route: RniAiRoute) => boolean;
  readonly pool?: pg.Pool;
};

function expectedModel(task: string): string {
  return ['rni_discovery', 'rni_relationship', 'rni_classifier'].includes(task)
    ? 'gpt-5.6-terra'
    : 'gpt-5.6-sol';
}

async function active(environment: string, db: Queryable, locking = false): Promise<Active> {
  const { rows } = await db.query(
    `select c.id::text, a.ai_route, a.manual_run_hard_usd::text,
       a.full_universe_hard_usd::text, a.rolling_24h_hard_usd::text,
       a.monthly_warning_usd::text, a.monthly_hard_usd::text, a.currency,
       to_char(c.effective_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as effective_at
     from config_version c join rni_ai_config a on a.config_version=c.id
     where c.environment=$1 and c.status='active' ${locking ? 'for update of c' : ''}`,
    [environment],
  );
  const parsed = z.array(activeSchema).length(1).safeParse(rows);
  return parsed.success ? parsed.data[0]! : unavailable();
}

async function routes(config: Active, db: Queryable): Promise<Route[]> {
  const { rows } = await db.query(
    'select * from model_route where config_version=$1 and task=any($2::text[]) order by array_position($2::text[],task)',
    [config.id, TASKS],
  );
  const parsed = z.array(routeSchema).length(TASKS.length).safeParse(rows);
  if (!parsed.success || new Set(parsed.data.map((r) => r.task)).size !== TASKS.length)
    return unavailable();
  if (
    parsed.data.some(
      (r) =>
        r.ai_route !== config.ai_route ||
        r.canonical_provider_model_id !== expectedModel(r.task) ||
        (r.ai_route === 'openai_direct' && r.primary_model !== r.canonical_provider_model_id),
    )
  )
    return unavailable();
  return parsed.data;
}

async function capabilities(route: RniAiRoute, db: Queryable): Promise<Capability[]> {
  // Latest evidence is authoritative, including a newer unavailable/stale observation.
  // Never resurrect an older positive snapshot after a more recent negative capability probe.
  const { rows } = await db.query(
    `select * from (
       select distinct on (canonical_provider_model_id) *
       from rni_model_capability_snapshot
       where ai_route=$1 and provider='openai'
         and canonical_provider_model_id in ('gpt-5.6-terra','gpt-5.6-sol')
         and observed_at <= clock_timestamp()
       order by canonical_provider_model_id, observed_at desc, created_at desc, id desc
     ) c where available and supports_responses and supports_structured_outputs
       and reasoning_efforts ? 'low' and expires_at > clock_timestamp()
       and (canonical_provider_model_id <> 'gpt-5.6-terra' or supports_web_search)
       and (ai_route <> 'openai_direct' or configured_model_id=canonical_provider_model_id)`,
    [route],
  );
  const parsed = z.array(capabilitySchema).safeParse(rows);
  return parsed.success ? parsed.data : [];
}

async function setting(
  config: Active,
  currentRoutes: Route[],
  options: AiRouteSettingsOptions,
  db: Queryable,
): Promise<RniAiRouteSetting> {
  const availableOptions = await Promise.all(
    rniAiRoute.options.map(async (aiRoute) => {
      const fresh = await capabilities(aiRoute, db);
      let available = options.credentialsAvailable(aiRoute) && fresh.length === 2;
      if (aiRoute === config.ai_route) {
        const { rows } = await db.query<{ valid: boolean }>(
          `select count(*)=5 and bool_and(c.available and c.supports_responses and
          c.supports_structured_outputs and c.reasoning_efforts ? 'low' and
          c.observed_at <= clock_timestamp() and c.expires_at > clock_timestamp() and
          (m.task <> 'rni_discovery' or c.supports_web_search)) as valid
         from model_route m join rni_model_capability_snapshot c
           on c.id=m.capability_snapshot_id and c.ai_route=m.ai_route
          and c.provider=m.primary_provider and c.configured_model_id=m.primary_model
          and c.canonical_provider_model_id=m.canonical_provider_model_id
          and c.model_revision=m.model_revision
         where m.config_version=$1 and m.task=any($2::text[])`,
          [config.id, TASKS],
        );
        available = available && rows[0]?.valid === true;
      }
      return {
        aiRoute,
        available,
        unavailableReason: available
          ? null
          : 'Approved route configuration is currently unavailable.',
      };
    }),
  );
  const parsed = rniAiRouteSetting.safeParse({
    configVersion: config.id,
    aiRoute: config.ai_route,
    effectiveAt: config.effective_at,
    resolvedModels: currentRoutes.map((r) => ({
      task: r.task,
      provider: r.primary_provider,
      modelId: r.primary_model,
      modelRevision: r.model_revision,
      promptVersion: r.prompt_version,
    })),
    options: availableOptions,
    budgets: {
      manualRunHardUsd: config.manual_run_hard_usd,
      fullUniverseHardUsd: config.full_universe_hard_usd,
      rolling24hHardUsd: config.rolling_24h_hard_usd,
      monthlyWarningUsd: config.monthly_warning_usd,
      monthlyHardUsd: config.monthly_hard_usd,
      currency: config.currency,
    },
  });
  return parsed.success ? parsed.data : unavailable();
}

const CLONES = {
  app_setting:
    'setting_key,scope_type,scope_id,value,value_type,governance_class,setting_schema_version,method_affecting,sensitive',
  provider_policy:
    'provider,enabled,plan_name,allowed_operations,default_job_id,timeout_ms,retry_count,daily_call_cap,warning_age_seconds,hard_expiry_seconds,retention_days,rights_status,attribution_text',
  budget_policy:
    'environment,scope_type,scope_id,period,soft_limit,hard_limit,currency,actions,enabled',
} as const;
const MODEL_COLUMNS =
  'task,transport,primary_provider,primary_model,model_revision,fallback_chain,prompt_version,schema_version,calibration_version,temperature,max_input_tokens,max_output_tokens,timeout_ms,max_cost_usd,allowed_data_classes,shadow_model,canary_percent,evaluation_run_id,enabled,ai_route,canonical_provider_model_id,reasoning_effort,capability_snapshot_id,policy_version,max_input_bytes,max_tool_calls';
const MODEL_REPLACEMENTS: Readonly<Record<string, string>> = {
  primary_provider: "'openai'",
  primary_model: '$4',
  model_revision: '$5',
  ai_route: '$6',
  capability_snapshot_id: '$7',
};

/** Atomic, future-config-only service. Existing runs, jobs and model invocations are never rewritten. */
export class PostgresRniAiRouteSettingsService implements RniAiRouteSettingsService {
  private readonly pool: pg.Pool;
  constructor(private readonly options: AiRouteSettingsOptions) {
    if (!options.environment.trim() || !options.actorId.trim())
      throw new RniAiRouteSettingsError('invalid');
    this.pool = options.pool ?? getPool();
  }

  getCurrentAiRouteSetting(): Promise<RniAiRouteSetting> {
    return withTransaction(async (tx) => {
      await tx.query('set transaction isolation level repeatable read read only');
      const config = await active(this.options.environment, tx);
      return setting(config, await routes(config, tx), this.options, tx);
    }, this.pool);
  }

  async updateFutureAiRoute(raw: Parameters<RniAiRouteSettingsService['updateFutureAiRoute']>[0]) {
    const parsed = rniAiRouteSettingUpdateRequest.safeParse(raw);
    if (
      !parsed.success ||
      !parsed.data.idempotencyKey.trim() ||
      parsed.data.idempotencyKey.length > 200
    )
      throw new RniAiRouteSettingsError('invalid');
    const request = parsed.data;
    const hash = canonicalHash({
      ...request,
      actorId: this.options.actorId,
      environment: this.options.environment,
    });
    return withTransaction(async (tx) => {
      // Same lock as the repository's other environment configuration activations.
      await tx.query('select pg_advisory_xact_lock(hashtext($1))', [
        `config:${this.options.environment}`,
      ]);
      const replay = await tx.query<{ after_value: unknown }>(
        `select after_value from audit_event where environment=$1 and request_id=$2
           and object_type='rni_ai_route_setting' and action='activate'`,
        [this.options.environment, request.idempotencyKey],
      );
      if (replay.rows.length) {
        const receipt = z
          .object({ requestHash: nonempty, result: rniAiRouteSettingUpdateResult })
          .strict()
          .safeParse(replay.rows[0]!.after_value);
        if (replay.rows.length !== 1 || !receipt.success) return unavailable();
        if (receipt.data.requestHash !== hash) throw new RniAiRouteSettingsError('conflict');
        return { ...receipt.data.result, disposition: 'duplicate' as const };
      }
      const previous = await active(this.options.environment, tx, true);
      // Target validation does not depend on the current route's credentials or freshness.
      const priorRoutes = await routes(previous, tx);
      const target = await capabilities(request.aiRoute, tx);
      if (!this.options.credentialsAvailable(request.aiRoute) || target.length !== 2)
        return unavailable();
      const byModel = new Map(target.map((c) => [c.canonical_provider_model_id, c]));
      const created = await tx.query<{ id: string }>(
        `insert into config_version (environment,status,parent_version,created_by,change_reason,checksum,effective_at)
         values ($1,'draft',$2,$3,$4,$5,clock_timestamp()) returning id::text`,
        [this.options.environment, previous.id, this.options.actorId, request.reason, hash],
      );
      const nextId = created.rows[0]!.id;
      for (const [table, columns] of Object.entries(CLONES)) {
        await tx.query(
          `insert into ${table} (config_version,${columns})
          select $1,${columns} from ${table} where config_version=$2`,
          [nextId, previous.id],
        );
      }
      await tx.query(
        `insert into rni_worker_config_authority
           (config_version,authority_kind,authority_key,version,snapshot_hash)
         select $1,authority_kind,authority_key,version,snapshot_hash
           from rni_worker_config_authority where config_version=$2`,
        [nextId, previous.id],
      );
      await tx.query(
        `insert into rni_ai_config (config_version,ai_route,model_policy_version,
        budget_policy_version,manual_run_hard_usd,full_universe_hard_usd,rolling_24h_hard_usd,
        monthly_warning_usd,monthly_hard_usd,currency)
        select $1,$3,model_policy_version,budget_policy_version,manual_run_hard_usd,
          full_universe_hard_usd,rolling_24h_hard_usd,monthly_warning_usd,monthly_hard_usd,currency
        from rni_ai_config where config_version=$2`,
        [nextId, previous.id, request.aiRoute],
      );
      await tx.query(
        `insert into model_route (config_version,${MODEL_COLUMNS})
        select $1,${MODEL_COLUMNS} from model_route where config_version=$2 and task<>all($3::text[])`,
        [nextId, previous.id, TASKS],
      );
      for (const route of priorRoutes) {
        const cap = byModel.get(route.canonical_provider_model_id);
        if (!cap) return unavailable();
        const projection = MODEL_COLUMNS.split(',')
          .map((column) => MODEL_REPLACEMENTS[column] ?? column)
          .join(',');
        await tx.query(
          `insert into model_route (config_version,${MODEL_COLUMNS})
          select $1,${projection} from model_route where config_version=$2 and task=$3`,
          [
            nextId,
            previous.id,
            route.task,
            cap.configured_model_id,
            cap.model_revision,
            request.aiRoute,
            cap.id,
          ],
        );
      }
      await tx.query(
        "update config_version set status='superseded' where id=$1 and status='active'",
        [previous.id],
      );
      await tx.query(
        "update config_version set status='active',activated_at=clock_timestamp() where id=$1",
        [nextId],
      );
      const current = await active(this.options.environment, tx);
      const result: RniAiRouteSettingUpdateResult = rniAiRouteSettingUpdateResult.parse({
        disposition: 'accepted',
        idempotencyKey: request.idempotencyKey,
        previousConfigVersion: previous.id,
        setting: await setting(current, await routes(current, tx), this.options, tx),
      });
      await tx.query(
        `insert into audit_event (actor_id,actor_role,action,object_type,object_id,
        environment,reason,before_value,after_value,result,request_id,correlation_id)
        values ($1,'admin','activate','rni_ai_route_setting',$2,$3,$4,$5::jsonb,$6::jsonb,'success',$7,$7)`,
        [
          this.options.actorId,
          nextId,
          this.options.environment,
          request.reason,
          JSON.stringify({ configVersion: previous.id, aiRoute: previous.ai_route }),
          JSON.stringify({ requestHash: hash, result }),
          request.idempotencyKey,
        ],
      );
      return result;
    }, this.pool);
  }

  async updateFutureAiBudgets(
    raw: Parameters<RniAiRouteSettingsService['updateFutureAiBudgets']>[0],
  ) {
    const parsed = rniAiBudgetSettingUpdateRequest.safeParse(raw);
    if (
      !parsed.success ||
      !parsed.data.idempotencyKey.trim() ||
      parsed.data.idempotencyKey.length > 200
    )
      throw new RniAiRouteSettingsError('invalid');
    const request = parsed.data;
    const hash = canonicalHash({
      ...request,
      actorId: this.options.actorId,
      environment: this.options.environment,
    });
    return withTransaction(async (tx) => {
      await tx.query('select pg_advisory_xact_lock(hashtext($1))', [
        `config:${this.options.environment}`,
      ]);
      const replay = await tx.query<{ after_value: unknown }>(
        `select after_value from audit_event where environment=$1 and request_id=$2
           and object_type='rni_ai_budget_setting' and action='activate'`,
        [this.options.environment, request.idempotencyKey],
      );
      if (replay.rows.length) {
        const receipt = z
          .object({ requestHash: nonempty, result: rniAiBudgetSettingUpdateResult })
          .strict()
          .safeParse(replay.rows[0]!.after_value);
        if (replay.rows.length !== 1 || !receipt.success) return unavailable();
        if (receipt.data.requestHash !== hash) throw new RniAiRouteSettingsError('conflict');
        return { ...receipt.data.result, disposition: 'duplicate' as const };
      }
      const previous = await active(this.options.environment, tx, true);
      const priorRoutes = await routes(previous, tx);
      // Do not activate a successor around an unusable current route.
      await setting(previous, priorRoutes, this.options, tx);
      const budgetChanges = [
        [request.budgets.manualRunHardUsd, previous.manual_run_hard_usd],
        [request.budgets.fullUniverseHardUsd, previous.full_universe_hard_usd],
        [request.budgets.rolling24hHardUsd, previous.rolling_24h_hard_usd],
        [request.budgets.monthlyWarningUsd, previous.monthly_warning_usd],
        [request.budgets.monthlyHardUsd, previous.monthly_hard_usd],
      ] as const;
      if (
        budgetChanges.some(([next, current]) => new Decimal(next).gt(current)) ||
        budgetChanges.every(([next, current]) => new Decimal(next).eq(current))
      ) {
        throw new RniAiRouteSettingsError('invalid');
      }
      const created = await tx.query<{ id: string }>(
        `insert into config_version (environment,status,parent_version,created_by,change_reason,checksum,effective_at)
         values ($1,'draft',$2,$3,$4,$5,clock_timestamp()) returning id::text`,
        [this.options.environment, previous.id, this.options.actorId, request.reason, hash],
      );
      const nextId = created.rows[0]!.id;
      for (const [table, columns] of Object.entries(CLONES)) {
        await tx.query(
          `insert into ${table} (config_version,${columns})
          select $1,${columns} from ${table} where config_version=$2`,
          [nextId, previous.id],
        );
      }
      await tx.query(
        `insert into rni_worker_config_authority
           (config_version,authority_kind,authority_key,version,snapshot_hash)
         select $1,authority_kind,authority_key,version,snapshot_hash
           from rni_worker_config_authority where config_version=$2`,
        [nextId, previous.id],
      );
      await tx.query(
        `insert into rni_ai_config (config_version,ai_route,model_policy_version,
        budget_policy_version,manual_run_hard_usd,full_universe_hard_usd,rolling_24h_hard_usd,
        monthly_warning_usd,monthly_hard_usd,currency)
        select $1,ai_route,model_policy_version,budget_policy_version,$3,$4,$5,$6,$7,currency
          from rni_ai_config where config_version=$2`,
        [
          nextId,
          previous.id,
          request.budgets.manualRunHardUsd,
          request.budgets.fullUniverseHardUsd,
          request.budgets.rolling24hHardUsd,
          request.budgets.monthlyWarningUsd,
          request.budgets.monthlyHardUsd,
        ],
      );
      await tx.query(
        `insert into model_route (config_version,${MODEL_COLUMNS})
        select $1,${MODEL_COLUMNS} from model_route where config_version=$2`,
        [nextId, previous.id],
      );
      await tx.query(
        "update config_version set status='superseded' where id=$1 and status='active'",
        [previous.id],
      );
      await tx.query(
        "update config_version set status='active',activated_at=clock_timestamp() where id=$1",
        [nextId],
      );
      const current = await active(this.options.environment, tx);
      const result = rniAiBudgetSettingUpdateResult.parse({
        disposition: 'accepted',
        idempotencyKey: request.idempotencyKey,
        previousConfigVersion: previous.id,
        setting: await setting(current, await routes(current, tx), this.options, tx),
      });
      await tx.query(
        `insert into audit_event (actor_id,actor_role,action,object_type,object_id,
        environment,reason,before_value,after_value,result,request_id,correlation_id)
        values ($1,'admin','activate','rni_ai_budget_setting',$2,$3,$4,$5::jsonb,$6::jsonb,'success',$7,$7)`,
        [
          this.options.actorId,
          nextId,
          this.options.environment,
          request.reason,
          JSON.stringify({
            configVersion: previous.id,
            budgets: {
              manualRunHardUsd: previous.manual_run_hard_usd,
              fullUniverseHardUsd: previous.full_universe_hard_usd,
              rolling24hHardUsd: previous.rolling_24h_hard_usd,
              monthlyWarningUsd: previous.monthly_warning_usd,
              monthlyHardUsd: previous.monthly_hard_usd,
              currency: previous.currency,
            },
          }),
          JSON.stringify({ requestHash: hash, result }),
          request.idempotencyKey,
        ],
      );
      return result;
    }, this.pool);
  }
}
