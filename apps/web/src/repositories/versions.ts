/**
 * Config and universe versions, and the activation transaction (F03 §4.3).
 *
 * **The constraint is the partial unique index, not this file.** `config_version_single_active`
 * and `universe_version_single_active` are what make "at most one active version" true under a
 * concurrent activation — which is the only moment the rule matters. The transaction below
 * orders the work and writes the audit trail; it is not the guarantee.
 */
import {
  configVersion,
  universeVersion,
  type ConfigVersion,
  type UniverseVersion,
  UNIVERSE_MAX_SYMBOLS,
} from '../contracts/config';
import type { RniModelCapability } from '../rni/config';
import type {
  RniAiRoute,
  RniTaskEnvelope,
  RniTaskEnvelopeSetting,
  RniTaskEnvelopeUpdateResult,
} from '../rni/contracts';
import { camelizeRow, insertClause } from './rows';
import { getPool, withTransaction, type Queryable } from './client';
import type { Pool } from 'pg';

const CONFIG_COLUMNS =
  'id, environment, status, parent_version, created_by, change_reason, created_at, effective_at, activated_at, approved_by, checksum';

const UNIVERSE_COLUMNS =
  'id, environment, config_version, status, parent_version, selected_count, selection_query, impact_preview, source_provider, source_endpoint, source_retrieved_at, source_payload_hash, provider_call_id, created_by, change_reason, created_at, activated_at, approved_by';
const QUALIFIED_UNIVERSE_COLUMNS = UNIVERSE_COLUMNS.split(', ')
  .map((column) => `uv.${column}`)
  .join(', ');

export type NewConfigVersion = {
  environment: string;
  status?: 'draft' | 'staged' | 'active';
  parentVersion?: string | null;
  createdBy: string;
  changeReason: string;
  checksum: string;
};

export async function insertConfigVersion(
  input: NewConfigVersion,
  db: Queryable = getPool(),
): Promise<ConfigVersion> {
  const { columns, placeholders, values } = insertClause({ status: 'draft', ...input });
  const { rows } = await db.query(
    `insert into config_version (${columns}) values (${placeholders}) returning ${CONFIG_COLUMNS}`,
    values,
  );
  return configVersion.parse(camelizeRow(rows[0] as Record<string, unknown>));
}

export async function findActiveConfigVersion(
  environment: string,
  db: Queryable = getPool(),
): Promise<ConfigVersion | null> {
  const { rows } = await db.query(
    `select ${CONFIG_COLUMNS} from config_version where environment = $1 and status = 'active'`,
    [environment],
  );
  const row = rows[0];
  return row === undefined
    ? null
    : configVersion.parse(camelizeRow(row as Record<string, unknown>));
}

export type RniModelRunRouteRow = {
  readonly run_id: string;
  readonly config_version: string;
  readonly ai_route: 'openai_direct' | 'vercel_ai_gateway';
  readonly resolved_at: Date;
  readonly task:
    | 'rni_discovery'
    | 'rni_relationship'
    | 'rni_classifier'
    | 'rni_verification'
    | 'rni_challenger';
  readonly provider: string;
  readonly configured_model_id: string;
  readonly canonical_provider_model_id: string;
  readonly model_revision: string;
  readonly reasoning_effort: string;
  readonly prompt_version: string;
  readonly policy_version: string;
  readonly capability_snapshot_id: string;
  readonly capability_response_hash: string;
  readonly capability_observed_at: Date;
  readonly capability_expires_at: Date;
  readonly supports_responses: boolean;
  readonly supports_structured_outputs: boolean;
  readonly supports_web_search: boolean;
  readonly max_input_bytes: number;
  readonly max_input_tokens: number;
  readonly max_output_tokens: number;
  readonly max_tool_calls: number;
  readonly timeout_ms: number;
  readonly max_cost_usd: string;
};

/**
 * Load one run's immutable task mapping while selecting the newest still-fresh capability
 * evidence for each exact route identity. Capability refreshes are append-only and intentionally
 * do not rewrite the activated config; each call records the fresh snapshot it actually used.
 */
export async function findRniModelRunRoutes(
  runId: string,
  db: Queryable = getPool(),
): Promise<readonly RniModelRunRouteRow[]> {
  const { rows } = await db.query<RniModelRunRouteRow>(
    `select r.id as run_id, r.config_version::text as config_version, r.ai_route,
            statement_timestamp() as resolved_at, mr.task, mr.primary_provider as provider,
            mr.primary_model as configured_model_id,
            mr.canonical_provider_model_id, mr.model_revision, mr.reasoning_effort,
            mr.prompt_version, mr.policy_version,
            capability.id as capability_snapshot_id,
            capability.response_hash as capability_response_hash,
            capability.observed_at as capability_observed_at,
            capability.expires_at as capability_expires_at,
            capability.supports_responses, capability.supports_structured_outputs,
            capability.supports_web_search, mr.max_input_bytes, mr.max_input_tokens,
            mr.max_output_tokens, mr.max_tool_calls, mr.timeout_ms, mr.max_cost_usd
       from rni_run r
       join config_version cv
         on cv.id = r.config_version and cv.status in ('active', 'superseded')
       join model_route mr
         on mr.config_version = r.config_version and mr.ai_route = r.ai_route
       join lateral (
         select c.*
           from rni_model_capability_snapshot c
          where c.ai_route = mr.ai_route
            and c.configured_model_id = mr.primary_model
            and c.provider = mr.primary_provider
            and c.canonical_provider_model_id = mr.canonical_provider_model_id
            and c.model_revision = mr.model_revision
            and c.available and c.supports_responses and c.supports_structured_outputs
            and c.reasoning_efforts ? mr.reasoning_effort
            and (mr.task <> 'rni_discovery' or c.supports_web_search)
            and c.observed_at <= statement_timestamp()
            and c.expires_at > statement_timestamp()
          order by c.observed_at desc, c.id desc
          limit 1
       ) capability on true
      where r.id = $1 and r.status in ('requested', 'running')
        and mr.task in (
          'rni_discovery', 'rni_relationship', 'rni_classifier',
          'rni_verification', 'rni_challenger'
        )
      order by mr.task`,
    [runId],
  );
  return rows;
}

/** Pick the newest complete, currently effective OpenAI RNI price-book version. */
export async function findCurrentRniPriceBookVersion(db: Queryable = getPool()): Promise<string> {
  const { rows } = await db.query<{ price_book_version: string }>(
    `select p.price_book_version
       from unit_price_book p
       join rni_price_book_evidence e on e.price_book_version = p.price_book_version
      where p.provider = 'openai' and p.currency = 'USD'
        and p.effective_from <= clock_timestamp()
        and (p.effective_until is null or p.effective_until > clock_timestamp())
        and (
          (p.service = 'openai_responses'
            and p.operation_or_model in ('gpt-5.6-terra', 'gpt-5.6-sol')
            and p.unit_type in ('input_token', 'output_token'))
          or (p.service = 'openai_web_search' and p.operation_or_model = 'web_search'
            and p.unit_type = 'search')
        )
      group by p.price_book_version
     having count(*) = 5
      order by max(p.effective_from) desc, p.price_book_version desc
      limit 1`,
  );
  const version = rows[0]?.price_book_version;
  if (version === undefined) {
    throw new Error('No complete currently effective RNI OpenAI price book is available');
  }
  return version;
}

export type RniPriceBookEvidence = {
  readonly priceBookVersion: string;
  readonly effectiveFrom: string;
  readonly sourceUrl: string;
  readonly responseHash: string;
  readonly sourceReference: string;
  readonly terraInputTokenUsd: string;
  readonly terraOutputTokenUsd: string;
  readonly solInputTokenUsd: string;
  readonly solOutputTokenUsd: string;
  readonly webSearchUsd: string;
  readonly firstTierInputCeiling: number;
};

/** Persist catalogue facts append-only; exact replay is a no-op and crossed IDs fail closed. */
export async function recordRniModelCatalogueEvidence(
  input: {
    readonly capabilities: readonly RniModelCapability[];
    readonly priceBook: RniPriceBookEvidence;
  },
  poolOverride?: Pool,
): Promise<{ readonly capabilityCount: number; readonly priceComponentCount: number }> {
  const capabilityKeys = new Set(
    input.capabilities.map(({ route, providerModelId }) => `${route}:${providerModelId}`),
  );
  const expectedKeys = [
    'openai_direct:gpt-5.6-terra',
    'openai_direct:gpt-5.6-sol',
    'vercel_ai_gateway:gpt-5.6-terra',
    'vercel_ai_gateway:gpt-5.6-sol',
  ];
  if (
    input.capabilities.length !== 4 ||
    new Set(input.capabilities.map(({ capabilitySnapshotId }) => capabilitySnapshotId)).size !==
      4 ||
    expectedKeys.some((key) => !capabilityKeys.has(key))
  ) {
    throw new Error('RNI catalogue evidence requires four distinct Direct/Gateway model snapshots');
  }
  return withTransaction(async (tx) => {
    for (const capability of input.capabilities) {
      await tx.query(
        `insert into rni_model_capability_snapshot (
           id, ai_route, configured_model_id, provider, canonical_provider_model_id,
           model_revision, response_hash, observed_at, expires_at, available,
           supports_responses, supports_structured_outputs, supports_web_search, reasoning_efforts
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         on conflict (id) do nothing`,
        [
          capability.capabilitySnapshotId,
          capability.route,
          capability.configuredModelId,
          capability.provider,
          capability.providerModelId,
          capability.modelRevision,
          capability.capabilityResponseHash,
          capability.observedAt,
          capability.expiresAt,
          capability.available,
          capability.supportsResponses,
          capability.supportsStructuredOutputs,
          capability.supportsWebSearch,
          JSON.stringify(capability.reasoningEfforts),
        ],
      );
      const { rows } = await tx.query<{
        ai_route: string;
        configured_model_id: string;
        provider: string;
        canonical_provider_model_id: string;
        model_revision: string;
        response_hash: string;
        observed_at: Date;
        expires_at: Date;
        available: boolean;
        supports_responses: boolean;
        supports_structured_outputs: boolean;
        supports_web_search: boolean;
        reasoning_efforts: unknown;
      }>(
        `select ai_route, configured_model_id, provider, canonical_provider_model_id,
                model_revision, response_hash, observed_at, expires_at, available,
                supports_responses, supports_structured_outputs, supports_web_search,
                reasoning_efforts
           from rni_model_capability_snapshot where id = $1`,
        [capability.capabilitySnapshotId],
      );
      const row = rows[0];
      if (
        row === undefined ||
        row.ai_route !== capability.route ||
        row.configured_model_id !== capability.configuredModelId ||
        row.provider !== capability.provider ||
        row.canonical_provider_model_id !== capability.providerModelId ||
        row.model_revision !== capability.modelRevision ||
        row.response_hash !== capability.capabilityResponseHash ||
        row.observed_at.toISOString() !== new Date(capability.observedAt).toISOString() ||
        row.expires_at.toISOString() !== new Date(capability.expiresAt).toISOString() ||
        row.available !== capability.available ||
        row.supports_responses !== capability.supportsResponses ||
        row.supports_structured_outputs !== capability.supportsStructuredOutputs ||
        row.supports_web_search !== capability.supportsWebSearch ||
        JSON.stringify(row.reasoning_efforts) !== JSON.stringify(capability.reasoningEfforts)
      ) {
        throw new Error(
          `RNI capability replay crossed immutable snapshot ${capability.capabilitySnapshotId}`,
        );
      }
    }

    await tx.query(
      `insert into rni_price_book_evidence (
         price_book_version, source_url, response_hash, observed_at, first_tier_input_ceiling
       ) values ($1, $2, $3, $4, $5)
       on conflict (price_book_version) do nothing`,
      [
        input.priceBook.priceBookVersion,
        input.priceBook.sourceUrl,
        input.priceBook.responseHash,
        input.priceBook.effectiveFrom,
        input.priceBook.firstTierInputCeiling,
      ],
    );
    const evidence = await tx.query<{
      source_url: string;
      response_hash: string;
      observed_at: Date;
      first_tier_input_ceiling: number;
    }>(
      `select source_url, response_hash, observed_at, first_tier_input_ceiling
         from rni_price_book_evidence where price_book_version = $1`,
      [input.priceBook.priceBookVersion],
    );
    const evidenceRow = evidence.rows[0];
    if (
      evidenceRow === undefined ||
      evidenceRow.source_url !== input.priceBook.sourceUrl ||
      evidenceRow.response_hash !== input.priceBook.responseHash ||
      evidenceRow.observed_at.toISOString() !==
        new Date(input.priceBook.effectiveFrom).toISOString() ||
      evidenceRow.first_tier_input_ceiling !== input.priceBook.firstTierInputCeiling
    ) {
      throw new Error(
        `RNI price-book replay crossed immutable ${input.priceBook.priceBookVersion}`,
      );
    }

    const prices = [
      ['openai_responses', 'gpt-5.6-terra', 'input_token', input.priceBook.terraInputTokenUsd],
      ['openai_responses', 'gpt-5.6-terra', 'output_token', input.priceBook.terraOutputTokenUsd],
      ['openai_responses', 'gpt-5.6-sol', 'input_token', input.priceBook.solInputTokenUsd],
      ['openai_responses', 'gpt-5.6-sol', 'output_token', input.priceBook.solOutputTokenUsd],
      ['openai_web_search', 'web_search', 'search', input.priceBook.webSearchUsd],
    ] as const;
    for (const [service, operationOrModel, unitType, unitPrice] of prices) {
      await tx.query(
        `insert into unit_price_book (
           price_book_version, provider, service, operation_or_model, unit_type, unit_price,
           currency, effective_from, source_reference
         ) values ($1, 'openai', $2, $3, $4, $5, 'USD', $6, $7)
         on conflict (price_book_version, provider, service, operation_or_model, unit_type)
         do nothing`,
        [
          input.priceBook.priceBookVersion,
          service,
          operationOrModel,
          unitType,
          unitPrice,
          input.priceBook.effectiveFrom,
          input.priceBook.sourceReference,
        ],
      );
      const { rows } = await tx.query<{
        unit_price: string;
        effective_from: Date;
        source_reference: string;
      }>(
        `select unit_price, effective_from, source_reference from unit_price_book
          where price_book_version = $1 and provider = 'openai' and service = $2
            and operation_or_model = $3 and unit_type = $4`,
        [input.priceBook.priceBookVersion, service, operationOrModel, unitType],
      );
      const row = rows[0];
      if (
        row === undefined ||
        row.unit_price !== unitPrice ||
        row.effective_from.toISOString() !==
          new Date(input.priceBook.effectiveFrom).toISOString() ||
        row.source_reference !== input.priceBook.sourceReference
      ) {
        throw new Error(`RNI price-book replay crossed immutable ${operationOrModel}/${unitType}`);
      }
    }
    return { capabilityCount: input.capabilities.length, priceComponentCount: prices.length };
  }, poolOverride);
}

const RNI_TASKS = [
  'rni_discovery',
  'rni_relationship',
  'rni_classifier',
  'rni_verification',
  'rni_challenger',
] as const;

type RniEnvelopeRouteRow = {
  readonly config_version: string;
  readonly status: 'active' | 'staged';
  readonly effective_at: Date;
  readonly task: RniTaskEnvelope['task'];
  readonly max_input_bytes: number;
  readonly max_input_tokens: number;
  readonly max_output_tokens: number;
  readonly max_tool_calls: number;
  readonly timeout_ms: number;
  readonly max_cost_usd: string;
};

const envelopeSettingFromRows = (rows: readonly RniEnvelopeRouteRow[]): RniTaskEnvelopeSetting => {
  const first = rows[0];
  if (first === undefined || rows.length !== RNI_TASKS.length) {
    throw new Error('RNI configuration does not contain exactly five task envelopes');
  }
  return {
    configVersion: first.config_version,
    status: first.status,
    effectiveAt: first.effective_at.toISOString(),
    envelopes: rows.map((row) => ({
      task: row.task,
      maxInputBytes: row.max_input_bytes,
      maxInputTokensReserved: row.max_input_tokens,
      maxOutputTokens: row.max_output_tokens,
      maxToolCalls: row.max_tool_calls,
      timeoutMs: row.timeout_ms,
      maxCostUsd: row.max_cost_usd,
    })),
  };
};

const selectRniTaskEnvelopeSetting = async (
  configVersion: string,
  db: Queryable,
): Promise<RniTaskEnvelopeSetting> => {
  const { rows } = await db.query<RniEnvelopeRouteRow>(
    `select cv.id::text as config_version, cv.status, cv.effective_at, mr.task,
            mr.max_input_bytes, mr.max_input_tokens, mr.max_output_tokens,
            mr.max_tool_calls, mr.timeout_ms, mr.max_cost_usd
       from config_version cv
       join model_route mr on mr.config_version = cv.id
      where cv.id = $1 and cv.status in ('active', 'staged')
        and mr.task = any($2::text[])
      order by array_position($2::text[], mr.task)`,
    [configVersion, RNI_TASKS],
  );
  return envelopeSettingFromRows(rows);
};

export async function findActiveRniTaskEnvelopeSetting(
  environment: string,
  db: Queryable = getPool(),
): Promise<RniTaskEnvelopeSetting | null> {
  const { rows } = await db.query<{ id: string }>(
    `select cv.id::text as id from config_version cv
       join rni_ai_config rc on rc.config_version = cv.id
      where cv.environment = $1 and cv.status = 'active'`,
    [environment],
  );
  return rows[0] === undefined ? null : selectRniTaskEnvelopeSetting(rows[0].id, db);
}

export type RniTaskEnvelopeStageRoute = RniTaskEnvelope & {
  readonly promptVersion: string;
  readonly schemaVersion: string;
};

export async function stageRniTaskEnvelopeSuccessor(
  input: {
    readonly environment: string;
    readonly actorId: string;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly reason: string;
    readonly routes: readonly RniTaskEnvelopeStageRoute[];
  },
  poolOverride?: Pool,
): Promise<RniTaskEnvelopeUpdateResult> {
  return withTransaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [
      `rni-envelope:${input.environment}:${input.idempotencyKey}`,
    ]);
    const replay = await tx.query<{
      object_id: string;
      after_value: { requestHash?: string };
    }>(
      `select object_id, after_value from audit_event
        where environment = $1 and action = 'stage' and object_type = 'rni_ai_config'
          and request_id = $2
        order by occurred_at desc limit 1`,
      [input.environment, input.idempotencyKey],
    );
    const replayRow = replay.rows[0];
    if (replayRow !== undefined) {
      if (replayRow.after_value.requestHash !== input.requestHash) {
        throw new Error('RNI task-envelope idempotency key was reused for different intent');
      }
      const replaySetting = await selectRniTaskEnvelopeSetting(replayRow.object_id, tx);
      return {
        disposition: 'duplicate',
        idempotencyKey: input.idempotencyKey,
        previousConfigVersion: String(
          (
            await tx.query<{ parent_version: string }>(
              `select parent_version::text as parent_version from config_version where id = $1`,
              [replayRow.object_id],
            )
          ).rows[0]!.parent_version,
        ),
        setting: { ...replaySetting, status: 'staged' },
      };
    }
    if (input.routes.length !== 5 || new Set(input.routes.map(({ task }) => task)).size !== 5) {
      throw new Error('RNI successor requires exactly five distinct task envelopes');
    }

    const active = await tx.query<{
      id: string;
      ai_route: RniAiRoute | null;
      manual_run_hard_usd: string | null;
      full_universe_hard_usd: string | null;
      rolling_24h_hard_usd: string | null;
      monthly_warning_usd: string | null;
      monthly_hard_usd: string | null;
    }>(
      `select cv.id::text as id, rc.ai_route, rc.manual_run_hard_usd,
              rc.full_universe_hard_usd, rc.rolling_24h_hard_usd,
              rc.monthly_warning_usd, rc.monthly_hard_usd
         from config_version cv
         left join rni_ai_config rc on rc.config_version = cv.id
        where cv.environment = $1 and cv.status = 'active'
        for share of cv`,
      [input.environment],
    );
    const activeRow = active.rows[0];
    if (activeRow === undefined)
      throw new Error(`No active config_version in ${input.environment}`);
    const aiRoute = activeRow.ai_route ?? 'openai_direct';
    if (
      activeRow.manual_run_hard_usd === null ||
      activeRow.full_universe_hard_usd === null ||
      activeRow.rolling_24h_hard_usd === null ||
      activeRow.monthly_warning_usd === null ||
      activeRow.monthly_hard_usd === null
    ) {
      throw new Error('Active RNI configuration is missing aggregate AI budget limits');
    }

    const price = await tx.query<{ first_tier_input_ceiling: number }>(
      `select e.first_tier_input_ceiling
         from rni_price_book_evidence e
         join unit_price_book p on p.price_book_version = e.price_book_version
        where p.provider = 'openai' and p.effective_from <= clock_timestamp()
          and (p.effective_until is null or p.effective_until > clock_timestamp())
        group by e.price_book_version, e.first_tier_input_ceiling, e.observed_at
       having count(*) filter (
         where (p.service = 'openai_responses' and p.operation_or_model in ('gpt-5.6-terra', 'gpt-5.6-sol')
                and p.unit_type in ('input_token', 'output_token'))
            or (p.service = 'openai_web_search' and p.operation_or_model = 'web_search'
                and p.unit_type = 'search')
       ) = 5
        order by e.observed_at desc limit 1`,
    );
    const tierCeiling = price.rows[0]?.first_tier_input_ceiling;
    if (
      tierCeiling === undefined ||
      input.routes.some(({ maxInputTokensReserved }) => maxInputTokensReserved >= tierCeiling)
    ) {
      throw new Error('RNI task envelope lacks compatible current first-tier price evidence');
    }

    const capabilities = await tx.query<{
      id: string;
      configured_model_id: string;
      canonical_provider_model_id: 'gpt-5.6-terra' | 'gpt-5.6-sol';
      model_revision: string;
    }>(
      `select distinct on (canonical_provider_model_id)
              id, configured_model_id, canonical_provider_model_id, model_revision
         from rni_model_capability_snapshot
        where ai_route = $1 and provider = 'openai' and available
          and supports_responses and supports_structured_outputs
          and (canonical_provider_model_id <> 'gpt-5.6-terra' or supports_web_search)
          and reasoning_efforts ? 'low' and observed_at <= clock_timestamp()
          and expires_at > clock_timestamp()
        order by canonical_provider_model_id, observed_at desc, id desc`,
      [aiRoute],
    );
    if (
      capabilities.rows.length !== 2 ||
      !capabilities.rows.some(
        ({ canonical_provider_model_id }) => canonical_provider_model_id === 'gpt-5.6-terra',
      ) ||
      !capabilities.rows.some(
        ({ canonical_provider_model_id }) => canonical_provider_model_id === 'gpt-5.6-sol',
      )
    ) {
      throw new Error(`RNI ${aiRoute} lacks fresh approved Terra/Sol capability evidence`);
    }
    const byModel = new Map(capabilities.rows.map((row) => [row.canonical_provider_model_id, row]));
    const created = await tx.query<{ id: string }>(
      `insert into config_version (
         environment, status, parent_version, created_by, change_reason, checksum
       ) values ($1, 'draft', $2, $3, $4, $5) returning id::text as id`,
      [input.environment, activeRow.id, input.actorId, input.reason, input.requestHash],
    );
    const successorId = created.rows[0]!.id;

    await tx.query(
      `insert into app_setting (
         config_version, setting_key, scope_type, scope_id, value, value_type,
         governance_class, setting_schema_version, method_affecting, sensitive
       ) select $1, setting_key, scope_type, scope_id, value, value_type,
                governance_class, setting_schema_version, method_affecting, sensitive
           from app_setting where config_version = $2`,
      [successorId, activeRow.id],
    );
    await tx.query(
      `insert into provider_policy (
         config_version, provider, enabled, plan_name, allowed_operations, default_job_id,
         timeout_ms, retry_count, daily_call_cap, warning_age_seconds, hard_expiry_seconds,
         retention_days, rights_status, attribution_text
       ) select $1, provider, enabled, plan_name, allowed_operations, default_job_id,
                timeout_ms, retry_count, daily_call_cap, warning_age_seconds, hard_expiry_seconds,
                retention_days, rights_status, attribution_text
           from provider_policy where config_version = $2`,
      [successorId, activeRow.id],
    );
    await tx.query(
      `insert into budget_policy (
         environment, scope_type, scope_id, period, soft_limit, hard_limit,
         currency, actions, enabled, config_version
       ) select environment, scope_type, scope_id, period, soft_limit, hard_limit,
                currency, actions, enabled, $1
           from budget_policy where config_version = $2`,
      [successorId, activeRow.id],
    );
    await tx.query(
      `insert into model_route (
         config_version, task, transport, primary_provider, primary_model, model_revision,
         fallback_chain, prompt_version, schema_version, calibration_version, temperature,
         max_input_tokens, max_output_tokens, timeout_ms, max_cost_usd, allowed_data_classes,
         shadow_model, canary_percent, evaluation_run_id, enabled, ai_route,
         canonical_provider_model_id, reasoning_effort, capability_snapshot_id, policy_version,
         max_input_bytes, max_tool_calls
       ) select $1, task, transport, primary_provider, primary_model, model_revision,
                fallback_chain, prompt_version, schema_version, calibration_version, temperature,
                max_input_tokens, max_output_tokens, timeout_ms, max_cost_usd, allowed_data_classes,
                shadow_model, canary_percent, evaluation_run_id, enabled, ai_route,
                canonical_provider_model_id, reasoning_effort, capability_snapshot_id,
                policy_version, max_input_bytes, max_tool_calls
           from model_route where config_version = $2 and task <> all($3::text[])`,
      [successorId, activeRow.id, RNI_TASKS],
    );
    await tx.query(
      `insert into rni_ai_config (
         config_version, ai_route, model_policy_version, budget_policy_version,
         manual_run_hard_usd, full_universe_hard_usd, rolling_24h_hard_usd,
         monthly_warning_usd, monthly_hard_usd
       ) values ($1, $2, 'rni-balanced-model-policy-v1', 'rni-ai-budget-policy-v1',
                 $3, $4, $5, $6, $7)`,
      [
        successorId,
        aiRoute,
        activeRow.manual_run_hard_usd,
        activeRow.full_universe_hard_usd,
        activeRow.rolling_24h_hard_usd,
        activeRow.monthly_warning_usd,
        activeRow.monthly_hard_usd,
      ],
    );
    for (const route of input.routes) {
      const canonicalModel = ['rni_discovery', 'rni_relationship', 'rni_classifier'].includes(
        route.task,
      )
        ? 'gpt-5.6-terra'
        : 'gpt-5.6-sol';
      const model = byModel.get(canonicalModel)!;
      await tx.query(
        `insert into model_route (
           config_version, task, transport, primary_provider, primary_model, model_revision,
           fallback_chain, prompt_version, schema_version, temperature, max_input_tokens,
           max_output_tokens, timeout_ms, max_cost_usd, allowed_data_classes, canary_percent,
           ai_route, canonical_provider_model_id, reasoning_effort, capability_snapshot_id,
           policy_version, max_input_bytes, max_tool_calls
         ) values ($1, $2, 'openai_responses', 'openai', $3, $4, '[]', $5, $6, 0,
                   $7, $8, $9, $10, '["public_forum_content"]', 0, $11, $12, 'low', $13,
                   'rni-balanced-model-policy-v1', $14, $15)`,
        [
          successorId,
          route.task,
          model.configured_model_id,
          model.model_revision,
          route.promptVersion,
          route.schemaVersion,
          route.maxInputTokensReserved,
          route.maxOutputTokens,
          route.timeoutMs,
          route.maxCostUsd,
          aiRoute,
          model.canonical_provider_model_id,
          model.id,
          route.maxInputBytes,
          route.maxToolCalls,
        ],
      );
    }
    await tx.query(`update config_version set status = 'staged' where id = $1`, [successorId]);
    const setting = await selectRniTaskEnvelopeSetting(successorId, tx);
    await tx.query(
      `insert into audit_event (
         actor_id, actor_role, action, object_type, object_id, environment, reason,
         before_value, after_value, result, request_id, correlation_id
       ) values ($1, 'admin', 'stage', 'rni_ai_config', $2, $3, $4, $5, $6,
                 'success', $7, $7)`,
      [
        input.actorId,
        successorId,
        input.environment,
        input.reason,
        JSON.stringify({ configVersion: activeRow.id }),
        JSON.stringify({ requestHash: input.requestHash, setting }),
        input.idempotencyKey,
      ],
    );
    return {
      disposition: 'accepted',
      idempotencyKey: input.idempotencyKey,
      previousConfigVersion: activeRow.id,
      setting: { ...setting, status: 'staged' },
    };
  }, poolOverride);
}

export type RniAiReservation = {
  readonly invocationId: string;
  readonly decision: 'reserved' | 'denied';
  readonly estimatedCostUsd: string | null;
  readonly denialCode: string | null;
  readonly warningEmitted: boolean;
  /** True only for the transaction that created this reservation and may dispatch the provider. */
  readonly dispatchAuthorized: boolean;
};

export type RniAiExecutionAuthority = {
  readonly stage: 'reddit' | 'x' | 'combined';
  readonly attempt: number;
  readonly token: string;
};

export async function reserveRniAiInvocation(
  input: {
    readonly invocationId: string;
    readonly runId: string;
    readonly task: RniModelRunRouteRow['task'];
    readonly requestHash: string;
    readonly capabilitySnapshotId: string;
    readonly priceBookVersion: string;
    /** Required for every I09-orchestrated provider dispatch. */
    readonly executionAuthority?: RniAiExecutionAuthority;
  },
  db: Queryable = getPool(),
): Promise<RniAiReservation> {
  const { rows } = await db.query<{
    invocation_id: string;
    decision: 'reserved' | 'denied';
    estimated_cost_usd: string | null;
    denial_code: string | null;
    warning_emitted: boolean;
    dispatch_authorized: boolean;
  }>(`select * from rni_reserve_ai_invocation($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
    input.invocationId,
    input.runId,
    input.task,
    input.requestHash,
    input.capabilitySnapshotId,
    input.priceBookVersion,
    input.executionAuthority?.stage ?? null,
    input.executionAuthority?.attempt ?? null,
    input.executionAuthority?.token ?? null,
  ]);
  const row = rows[0];
  if (row === undefined) throw new Error('RNI AI reservation returned no decision');
  return {
    invocationId: row.invocation_id,
    decision: row.decision,
    estimatedCostUsd: row.estimated_cost_usd,
    denialCode: row.denial_code,
    warningEmitted: row.warning_emitted,
    dispatchAuthorized: row.dispatch_authorized,
  };
}

export async function assertRniAiInvocationEffect(
  input: {
    readonly invocationId: string;
    readonly runId: string;
    readonly executionAuthority: RniAiExecutionAuthority;
  },
  db: Queryable = getPool(),
): Promise<string> {
  const { rows } = await db.query<{ effect_expires_at: Date | string }>(
    `select rni_assert_ai_invocation_effect($1, $2, $3, $4, $5) as effect_expires_at`,
    [
      input.invocationId,
      input.runId,
      input.executionAuthority.stage,
      input.executionAuthority.attempt,
      input.executionAuthority.token,
    ],
  );
  const expiresAt = rows[0]?.effect_expires_at;
  if (expiresAt === undefined) throw new Error('RNI provider effect fence returned no expiry');
  return (expiresAt instanceof Date ? expiresAt : new Date(expiresAt)).toISOString();
}

export async function settleRniAiInvocation(
  input: {
    readonly invocationId: string;
    readonly requestHash: string;
    readonly providerRequestId: string;
    readonly outcome: 'succeeded' | 'failed';
    readonly inputTokens: number;
    readonly cachedInputTokens: number;
    readonly outputTokens: number;
    readonly webSearchCalls: number;
  },
  db: Queryable = getPool(),
): Promise<string> {
  const { rows } = await db.query<{ actual_cost_usd: string }>(
    `select rni_settle_ai_invocation($1, $2, $3, $4, $5, $6, $7, $8)
       as actual_cost_usd`,
    [
      input.invocationId,
      input.requestHash,
      input.providerRequestId,
      input.outcome,
      input.inputTokens,
      input.cachedInputTokens,
      input.outputTokens,
      input.webSearchCalls,
    ],
  );
  const cost = rows[0]?.actual_cost_usd;
  if (cost === undefined) throw new Error('RNI AI settlement returned no cost');
  return cost;
}

export type ActivationAudit = {
  actorId: string;
  actorRole: string;
  reason: string;
  requestId: string;
  correlationId: string;
};

/**
 * Deactivate the current version, activate the successor, write the audit event — one
 * transaction. A failure at any point leaves the previous version active, which is the
 * property F03 §4.3 actually asks for and the reason this is not three statements at a call
 * site.
 */
export async function activateConfigVersion(
  environment: string,
  versionId: string,
  audit: ActivationAudit,
  poolOverride?: Pool,
): Promise<ConfigVersion> {
  return withTransaction(async (tx) => {
    // Serialise concurrent activations for this environment. Without the lock, two callers
    // both pass the "is there an active one?" read and the second fails on the unique index —
    // correct, but as a constraint violation rather than as a wait.
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`config:${environment}`]);

    const previous = await tx.query(
      `select ${CONFIG_COLUMNS} from config_version where environment = $1 and status = 'active'`,
      [environment],
    );
    const previousId = (previous.rows[0] as { id?: string } | undefined)?.id ?? null;
    if (previousId !== null) {
      const rniSuccessor = await tx.query<{
        parent_version: string | null;
        current_rni: boolean;
        target_rni: boolean;
        raises_budget: boolean;
      }>(
        `select target.parent_version,
                current_ai.config_version is not null as current_rni,
                next_ai.config_version is not null as target_rni,
                coalesce(
                  next_ai.manual_run_hard_usd > current_ai.manual_run_hard_usd
                  or next_ai.full_universe_hard_usd > current_ai.full_universe_hard_usd
                  or next_ai.rolling_24h_hard_usd > current_ai.rolling_24h_hard_usd
                  or next_ai.monthly_warning_usd > current_ai.monthly_warning_usd
                  or next_ai.monthly_hard_usd > current_ai.monthly_hard_usd,
                  false
                ) as raises_budget
           from config_version target
           left join rni_ai_config next_ai on next_ai.config_version=target.id
           left join rni_ai_config current_ai on current_ai.config_version=$3
          where target.id=$1 and target.environment=$2 and target.status in ('draft','staged')`,
        [versionId, environment, previousId],
      );
      const guarded = rniSuccessor.rows[0];
      if (
        guarded?.current_rni === true &&
        (!guarded.target_rni || guarded.parent_version !== previousId || guarded.raises_budget)
      ) {
        throw new Error(
          'RNI configuration activation requires the direct active parent and cannot raise aggregate budgets',
        );
      }
    }

    await tx.query(
      `update config_version set status = 'superseded' where environment = $1 and status = 'active'`,
      [environment],
    );

    const { rows } = await tx.query(
      `update config_version
          set status = 'active', activated_at = now()
        where id = $1 and environment = $2 and status in ('draft', 'staged')
      returning ${CONFIG_COLUMNS}`,
      [versionId, environment],
    );

    const activated = rows[0];
    if (activated === undefined) {
      throw new Error(
        `config_version ${versionId} is not a draft or staged version in ${environment}. Activating an already-superseded version would resurrect configuration that artifacts have already recorded as retired.`,
      );
    }

    await tx.query(
      `insert into audit_event
         (actor_id, actor_role, action, object_type, object_id, environment, reason,
          before_value, after_value, result, request_id, correlation_id)
       values ($1, $2, 'activate', 'config_version', $3, $4, $5, $6, $7, 'success', $8, $9)`,
      [
        audit.actorId,
        audit.actorRole,
        versionId,
        environment,
        audit.reason,
        JSON.stringify(previous.rows[0] ?? null),
        JSON.stringify(activated),
        audit.requestId,
        audit.correlationId,
      ],
    );

    return configVersion.parse(camelizeRow(activated as Record<string, unknown>));
  }, poolOverride);
}

export type NewUniverseVersion = {
  environment: string;
  configVersion: string;
  createdBy: string;
  changeReason: string;
  status?: 'draft' | 'staged';
  parentVersion?: string | null;
  selectionQuery?: unknown;
  /** FMP versions must use stageFmpUniverseVersion so required lineage cannot be omitted. */
  sourceProvider?: null;
  sourceEndpoint?: null;
  sourceRetrievedAt?: null;
  sourcePayloadHash?: null;
  providerCallId?: null;
  approvedBy?: null;
};

export async function insertUniverseVersion(
  input: NewUniverseVersion,
  db: Queryable = getPool(),
): Promise<UniverseVersion> {
  const { columns, placeholders, values } = insertClause({ status: 'draft', ...input });
  const { rows } = await db.query(
    `insert into universe_version (${columns}) values (${placeholders}) returning ${UNIVERSE_COLUMNS}`,
    values,
  );
  return universeVersion.parse(camelizeRow(rows[0] as Record<string, unknown>));
}

export async function findActiveUniverseVersion(
  environment: string,
  db: Queryable = getPool(),
): Promise<UniverseVersion | null> {
  const { rows } = await db.query(
    `select ${UNIVERSE_COLUMNS} from universe_version where environment = $1 and status = 'active'`,
    [environment],
  );
  const row = rows[0];
  return row === undefined
    ? null
    : universeVersion.parse(camelizeRow(row as Record<string, unknown>));
}

export async function countUniverseVersions(
  environment: string,
  db: Queryable = getPool(),
): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    'select count(*)::text as count from universe_version where environment = $1',
    [environment],
  );
  return Number(rows[0]?.count ?? '0');
}

export type UniverseProviderCallInput = {
  readonly operation: string;
  readonly requestFingerprint: string;
  readonly statusCode: number | null;
  readonly latencyMs: number;
  readonly cacheStatus: string;
  readonly itemsReturned: number | null;
  readonly estimatedCostUsd: string;
  readonly startedAt: Date;
  readonly errorClass: string | null;
};

export async function insertUniverseProviderCall(
  input: UniverseProviderCallInput,
  db: Queryable = getPool(),
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into provider_call_log
       (provider, operation, request_fingerprint, status_code, latency_ms, cache_status,
        items_returned, estimated_cost_usd, started_at, error_class)
     values ('fmp', $1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning id`,
    [
      input.operation,
      input.requestFingerprint,
      input.statusCode,
      input.latencyMs,
      input.cacheStatus,
      input.itemsReturned,
      input.estimatedCostUsd,
      input.startedAt,
      input.errorClass,
    ],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('provider_call_log insert returned no row');
  return id;
}

/** Persist an FMP attempt and attach it to its claimed command before control returns. */
export async function insertAndBindUniverseProviderCall(input: {
  readonly command: UniverseSyncCommandInput;
  readonly call: UniverseProviderCallInput;
}): Promise<string> {
  return withTransaction(async (tx) => {
    const providerCallId = await insertUniverseProviderCall(input.call, tx);
    const { rowCount } = await tx.query(
      `update rni_universe_sync_command
          set provider_call_id = $3
        where environment = $1 and idempotency_key = $2 and status = 'running'`,
      [input.command.environment, input.command.idempotencyKey, providerCallId],
    );
    if (rowCount !== 1) {
      throw new Error('Universe sync command was not running when its provider call was logged');
    }
    return providerCallId;
  });
}

export type UniverseSyncCommandInput = {
  readonly environment: string;
  readonly idempotencyKey: string;
  readonly actorId: string;
  readonly correlationId: string;
};

export type UniverseSyncCommandClaim =
  | { readonly state: 'claimed' }
  | { readonly state: 'running'; readonly retryAt: string }
  | { readonly state: 'completed'; readonly result: unknown }
  | { readonly state: 'failed'; readonly errorMessage: string };

type UniverseSyncCommandRow = {
  readonly status: 'running' | 'completed' | 'failed';
  readonly result_payload: unknown | null;
  readonly error_message: string | null;
  readonly lease_expires_at: Date | null;
};

function universeSyncCommandObjectId(input: UniverseSyncCommandInput): string {
  return `${input.environment}:${input.idempotencyKey}`;
}

function commandClaimFromRow(row: UniverseSyncCommandRow): UniverseSyncCommandClaim {
  if (row.status === 'running') {
    if (row.lease_expires_at === null) {
      throw new Error('Running universe sync command has no lease expiry');
    }
    return { state: 'running', retryAt: row.lease_expires_at.toISOString() };
  }
  if (row.status === 'failed') {
    if (row.error_message === null) throw new Error('Failed universe sync command has no error');
    return { state: 'failed', errorMessage: row.error_message };
  }
  if (row.result_payload === null) throw new Error('Completed universe sync command has no result');
  return { state: 'completed', result: row.result_payload };
}

/** Claim and commit the idempotency key before any FMP request is allowed to start. */
export async function claimUniverseSyncCommand(
  input: UniverseSyncCommandInput,
): Promise<UniverseSyncCommandClaim> {
  return withTransaction(async (tx) => {
    const { rows: inserted } = await tx.query<UniverseSyncCommandRow>(
      `insert into rni_universe_sync_command
         (environment, idempotency_key, actor_id, correlation_id)
       values ($1, $2, $3, $4)
       on conflict (environment, idempotency_key) do nothing
       returning status, result_payload, error_message, lease_expires_at`,
      [input.environment, input.idempotencyKey, input.actorId, input.correlationId],
    );
    if (inserted[0] !== undefined) {
      await tx.query(
        `insert into audit_event
           (actor_id, actor_role, action, object_type, object_id, environment, reason,
            result, request_id, correlation_id)
         values ($1, 'admin', 'request', 'rni_universe_sync_command', $2, $3,
                 'Claim FMP universe synchronization before provider dispatch',
                 'success', $4, $5)`,
        [
          input.actorId,
          universeSyncCommandObjectId(input),
          input.environment,
          input.idempotencyKey,
          input.correlationId,
        ],
      );
      return { state: 'claimed' };
    }

    const { rows } = await tx.query<UniverseSyncCommandRow>(
      `select status, result_payload, error_message, lease_expires_at
         from rni_universe_sync_command
        where environment = $1 and idempotency_key = $2`,
      [input.environment, input.idempotencyKey],
    );
    let row = rows[0];
    if (row === undefined) throw new Error('Universe sync command conflict could not be read');
    if (row.status === 'running') {
      const { rows: abandoned } = await tx.query<UniverseSyncCommandRow>(
        `update rni_universe_sync_command
            set status = 'failed', error_message = 'UNIVERSE_SYNC_COMMAND_ABANDONED',
                lease_expires_at = null, completed_at = now()
          where environment = $1 and idempotency_key = $2 and status = 'running'
            and lease_expires_at <= now()
        returning status, result_payload, error_message, lease_expires_at`,
        [input.environment, input.idempotencyKey],
      );
      if (abandoned[0] !== undefined) {
        row = abandoned[0];
        await tx.query(
          `insert into audit_event
             (actor_id, actor_role, action, object_type, object_id, environment, reason,
              result, request_id, correlation_id, after_value)
           values ($1, 'admin', 'fail', 'rni_universe_sync_command', $2, $3,
                   'Terminalize abandoned FMP universe synchronization without redispatch',
                   'failure', $4, $5, $6)`,
          [
            input.actorId,
            universeSyncCommandObjectId(input),
            input.environment,
            input.idempotencyKey,
            input.correlationId,
            JSON.stringify({ errorMessage: 'UNIVERSE_SYNC_COMMAND_ABANDONED' }),
          ],
        );
      }
    }
    const claim = commandClaimFromRow(row);
    await tx.query(
      `insert into audit_event
         (actor_id, actor_role, action, object_type, object_id, environment, reason,
          result, request_id, correlation_id, after_value)
       values ($1, 'admin', 'replay', 'rni_universe_sync_command', $2, $3,
               'Replay existing FMP universe synchronization command', $4, $5, $6, $7)`,
      [
        input.actorId,
        universeSyncCommandObjectId(input),
        input.environment,
        claim.state === 'failed' ? 'failure' : 'success',
        input.idempotencyKey,
        input.correlationId,
        JSON.stringify({ state: claim.state }),
      ],
    );
    return claim;
  });
}

export async function readUniverseSyncCommand(
  input: Pick<UniverseSyncCommandInput, 'environment' | 'idempotencyKey'>,
  db: Queryable = getPool(),
): Promise<UniverseSyncCommandClaim> {
  const { rows } = await db.query<UniverseSyncCommandRow>(
    `select status, result_payload, error_message, lease_expires_at
       from rni_universe_sync_command
      where environment = $1 and idempotency_key = $2`,
    [input.environment, input.idempotencyKey],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('Universe sync command was not found');
  return commandClaimFromRow(row);
}

type CompleteUniverseSyncCommandInput = {
  readonly command: UniverseSyncCommandInput;
  readonly result: unknown;
  readonly auditResult: 'success' | 'failure';
  readonly providerCallId: string;
  readonly sourcePayloadHash: string | null;
  readonly universeVersionId: string | null;
};

async function completeUniverseSyncCommandInTransaction(
  input: CompleteUniverseSyncCommandInput,
  tx: Queryable,
): Promise<void> {
  const { rowCount } = await tx.query(
    `update rni_universe_sync_command
          set status = 'completed', result_payload = $3, provider_call_id = $4,
              source_payload_hash = $5, universe_version = $6, lease_expires_at = null,
              completed_at = now()
        where environment = $1 and idempotency_key = $2 and status = 'running'`,
    [
      input.command.environment,
      input.command.idempotencyKey,
      JSON.stringify(input.result),
      input.providerCallId,
      input.sourcePayloadHash,
      input.universeVersionId,
    ],
  );
  if (rowCount !== 1) throw new Error('Universe sync command was not running at completion');
  await tx.query(
    `insert into audit_event
         (actor_id, actor_role, action, object_type, object_id, environment, reason,
          result, request_id, correlation_id, after_value)
       values ($1, 'admin', 'complete', 'rni_universe_sync_command', $2, $3,
               'Persist terminal FMP universe synchronization outcome',
               $4, $5, $6, $7)`,
    [
      input.command.actorId,
      universeSyncCommandObjectId(input.command),
      input.command.environment,
      input.auditResult,
      input.command.idempotencyKey,
      input.command.correlationId,
      JSON.stringify({
        providerCallId: input.providerCallId,
        sourcePayloadHash: input.sourcePayloadHash,
        universeVersionId: input.universeVersionId,
      }),
    ],
  );
}

export async function completeUniverseSyncCommand(
  input: CompleteUniverseSyncCommandInput,
): Promise<void> {
  await withTransaction(async (tx) => completeUniverseSyncCommandInTransaction(input, tx));
}

export async function failUniverseSyncCommand(input: {
  readonly command: UniverseSyncCommandInput;
  readonly errorMessage: string;
  readonly providerCallId: string | null;
  readonly sourcePayloadHash: string | null;
}): Promise<void> {
  await withTransaction(async (tx) => {
    const { rowCount } = await tx.query(
      `update rni_universe_sync_command
          set status = 'failed', error_message = $3, provider_call_id = $4,
              source_payload_hash = $5, lease_expires_at = null, completed_at = now()
        where environment = $1 and idempotency_key = $2 and status = 'running'`,
      [
        input.command.environment,
        input.command.idempotencyKey,
        input.errorMessage,
        input.providerCallId,
        input.sourcePayloadHash,
      ],
    );
    if (rowCount !== 1) throw new Error('Universe sync command was not running at failure');
    await tx.query(
      `insert into audit_event
         (actor_id, actor_role, action, object_type, object_id, environment, reason,
          result, request_id, correlation_id, after_value)
       values ($1, 'admin', 'fail', 'rni_universe_sync_command', $2, $3,
               'Persist failed FMP universe synchronization outcome',
               'failure', $4, $5, $6)`,
      [
        input.command.actorId,
        universeSyncCommandObjectId(input.command),
        input.command.environment,
        input.command.idempotencyKey,
        input.command.correlationId,
        JSON.stringify({
          errorMessage: input.errorMessage,
          providerCallId: input.providerCallId,
          sourcePayloadHash: input.sourcePayloadHash,
        }),
      ],
    );
  });
}

export type StageFmpUniverseMember = {
  readonly securityId: string;
  readonly providerSymbol: string;
  readonly providerCompanyName: string;
  readonly constituentFirstAddedAt: string | null;
};

export type StageFmpUniverseInput = {
  readonly environment: string;
  readonly sourceRetrievedAt: string;
  readonly sourcePayloadHash: string;
  readonly providerCallId: string;
  readonly members: readonly StageFmpUniverseMember[];
  readonly actorId: string;
  readonly requestId: string;
  readonly correlationId: string;
};

export type StageFmpUniverseOutcome = {
  readonly version: UniverseVersion;
  readonly memberCount: number;
  readonly reused: boolean;
  readonly impactPreview: {
    readonly addedSecurityIds: readonly string[];
    readonly removedSecurityIds: readonly string[];
  };
};

async function stageFmpUniverseVersionInTransaction(
  input: StageFmpUniverseInput,
  tx: Queryable,
): Promise<StageFmpUniverseOutcome> {
  await tx.query('select pg_advisory_xact_lock(hashtext($1))', [
    `universe-fmp-stage:${input.environment}`,
  ]);

  const requested = await tx.query(
    `select ${QUALIFIED_UNIVERSE_COLUMNS}
         from audit_event ae
         join universe_version uv on uv.id::text = ae.object_id
        where ae.environment = $1
          and ae.action = 'stage'
          and ae.object_type = 'universe_version'
          and ae.request_id = $2
        order by ae.occurred_at desc
        limit 1`,
    [input.environment, input.requestId],
  );
  const existing =
    requested.rows[0] === undefined
      ? await tx.query(
          `select ${UNIVERSE_COLUMNS}
               from universe_version
              where environment = $1 and source_provider = 'fmp' and source_payload_hash = $2`,
          [input.environment, input.sourcePayloadHash],
        )
      : requested;
  const existingRow = existing.rows[0];
  if (existingRow !== undefined) {
    const version = universeVersion.parse(camelizeRow(existingRow as Record<string, unknown>));
    const impact = version.impactPreview as {
      addedSecurityIds?: readonly string[];
      removedSecurityIds?: readonly string[];
    };
    return {
      version,
      memberCount: version.selectedCount,
      reused: true,
      impactPreview: {
        addedSecurityIds: impact.addedSecurityIds ?? [],
        removedSecurityIds: impact.removedSecurityIds ?? [],
      },
    };
  }

  const { rows: configs } = await tx.query<{ id: string }>(
    `select id from config_version where environment = $1 and status = 'active'`,
    [input.environment],
  );
  const configVersion = configs[0]?.id;
  if (configVersion === undefined) {
    throw new Error(`No active config_version in ${input.environment}`);
  }

  const { rows: activeVersions } = await tx.query<{ id: string }>(
    `select id from universe_version where environment = $1 and status = 'active'`,
    [input.environment],
  );
  const parentVersion = activeVersions[0]?.id ?? null;
  const { rows: activeMembers } =
    parentVersion === null
      ? { rows: [] as { security_id: string }[] }
      : await tx.query<{ security_id: string }>(
          `select security_id from universe_member
              where universe_version = $1 and enabled = true`,
          [parentVersion],
        );
  const priorIds = new Set(activeMembers.map(({ security_id }) => security_id));
  const nextIds = new Set(input.members.map(({ securityId }) => securityId));
  const addedSecurityIds = [...nextIds].filter((id) => !priorIds.has(id)).sort();
  const removedSecurityIds = [...priorIds].filter((id) => !nextIds.has(id)).sort();
  const impactPreview = { addedSecurityIds, removedSecurityIds };

  const { rows } = await tx.query(
    `insert into universe_version
         (environment, config_version, status, parent_version, selected_count, selection_query,
          impact_preview, source_provider, source_endpoint, source_retrieved_at,
          source_payload_hash, provider_call_id, created_by, change_reason)
       values ($1, $2, 'staged', $3, $4, $5, $6, 'fmp', '/stable/sp500-constituent',
               $7, $8, $9, $10, $11)
       returning ${UNIVERSE_COLUMNS}`,
    [
      input.environment,
      configVersion,
      parentVersion,
      input.members.length,
      JSON.stringify({ preset: 'sp500_fmp_current' }),
      JSON.stringify(impactPreview),
      input.sourceRetrievedAt,
      input.sourcePayloadHash,
      input.providerCallId,
      input.actorId,
      `Staged current S&P 500 membership from FMP (${input.sourceRetrievedAt})`,
    ],
  );
  const stagedRow = rows[0];
  if (stagedRow === undefined) throw new Error('universe_version stage insert returned no row');
  const version = universeVersion.parse(camelizeRow(stagedRow as Record<string, unknown>));

  for (const member of input.members) {
    await tx.query(
      `insert into universe_member
           (universe_version, security_id, added_by, selection_source, provider_symbol,
            provider_company_name, constituent_first_added_at)
         values ($1, $2, $3, 'fmp_sp500', $4, $5, $6)`,
      [
        version.id,
        member.securityId,
        input.actorId,
        member.providerSymbol,
        member.providerCompanyName,
        member.constituentFirstAddedAt,
      ],
    );
  }

  await tx.query(
    `insert into audit_event
         (actor_id, actor_role, action, object_type, object_id, environment, reason,
          after_value, result, request_id, correlation_id)
       values ($1, 'admin', 'stage', 'universe_version', $2, $3, $4, $5,
               'success', $6, $7)`,
    [
      input.actorId,
      version.id,
      input.environment,
      'Stage validated FMP S&P 500 candidate for human approval',
      JSON.stringify({ selectedCount: input.members.length, ...impactPreview }),
      input.requestId,
      input.correlationId,
    ],
  );

  return {
    version,
    memberCount: input.members.length,
    reused: false,
    impactPreview,
  };
}

/** Creates an immutable staged FMP snapshot. It never activates or mutates the current version. */
export async function stageFmpUniverseVersion(
  input: StageFmpUniverseInput,
): Promise<StageFmpUniverseOutcome> {
  return withTransaction(async (tx) => stageFmpUniverseVersionInTransaction(input, tx));
}

/** Stage/reuse the immutable candidate and terminalize its command in one transaction. */
export async function stageAndCompleteFmpUniverseCommand(input: {
  readonly command: UniverseSyncCommandInput;
  readonly stage: StageFmpUniverseInput;
}): Promise<StageFmpUniverseOutcome> {
  return withTransaction(async (tx) => {
    const staged = await stageFmpUniverseVersionInTransaction(input.stage, tx);
    await completeUniverseSyncCommandInTransaction(
      {
        command: input.command,
        result: { ok: true, staged },
        auditResult: 'success',
        providerCallId: input.stage.providerCallId,
        sourcePayloadHash: input.stage.sourcePayloadHash,
        universeVersionId: staged.version.id,
      },
      tx,
    );
    return staged;
  });
}

/** Record the human approval on a staged FMP snapshot without activating or altering it. */
export async function approveFmpUniverseVersion(
  environment: string,
  versionId: string,
  audit: ActivationAudit,
): Promise<UniverseVersion> {
  if (audit.actorRole !== 'admin') {
    throw new Error('FMP universe approval requires an admin actor');
  }
  return withTransaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`universe:${environment}`]);
    const { rows } = await tx.query(
      `update universe_version
          set approved_by = $3
        where id = $1 and environment = $2 and status = 'staged'
          and source_provider = 'fmp' and approved_by is null
      returning ${UNIVERSE_COLUMNS}`,
      [versionId, environment, audit.actorId],
    );
    const approved = rows[0];
    if (approved === undefined) {
      const { rows: existing } = await tx.query(
        `select ${UNIVERSE_COLUMNS} from universe_version where id = $1 and environment = $2`,
        [versionId, environment],
      );
      const version = existing[0];
      if (version !== undefined) {
        const parsed = universeVersion.parse(camelizeRow(version as Record<string, unknown>));
        if (
          parsed.status === 'staged' &&
          parsed.sourceProvider === 'fmp' &&
          parsed.approvedBy === audit.actorId
        ) {
          return parsed;
        }
      }
      throw new Error(
        `universe_version ${versionId} is not an unapproved staged FMP version in ${environment}`,
      );
    }

    await tx.query(
      `insert into audit_event
         (actor_id, actor_role, action, object_type, object_id, environment, reason,
          after_value, result, request_id, correlation_id)
       values ($1, $2, 'approve', 'universe_version', $3, $4, $5, $6,
               'success', $7, $8)`,
      [
        audit.actorId,
        audit.actorRole,
        versionId,
        environment,
        audit.reason,
        JSON.stringify(approved),
        audit.requestId,
        audit.correlationId,
      ],
    );
    return universeVersion.parse(camelizeRow(approved as Record<string, unknown>));
  });
}

/**
 * Activate one immutable successor. Legacy draft membership is materialised here. FMP snapshots
 * are different: staging already materialises the reviewed membership, so activation verifies
 * the caller's IDs against that stored set and never inserts or rewrites them.
 */
export async function activateUniverseVersion(
  environment: string,
  versionId: string,
  members: readonly { securityId: string; addedBy: string; selectionSource: string }[],
  audit: ActivationAudit,
): Promise<UniverseVersion> {
  if (members.length > UNIVERSE_MAX_SYMBOLS) {
    throw new Error(
      `${members.length} members exceeds universe.max_symbols (${UNIVERSE_MAX_SYMBOLS}, D-RNI-06). The database constraint would reject this too; failing here names the limit.`,
    );
  }

  return withTransaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`universe:${environment}`]);

    const { rows: targetRows } = await tx.query(
      `select ${UNIVERSE_COLUMNS} from universe_version
        where id = $1 and environment = $2
        for update`,
      [versionId, environment],
    );
    const targetRow = targetRows[0];
    if (targetRow === undefined) {
      throw new Error(`universe_version ${versionId} was not found in ${environment}`);
    }
    const target = universeVersion.parse(camelizeRow(targetRow as Record<string, unknown>));
    if (target.status !== 'draft' && target.status !== 'staged') {
      throw new Error(
        `universe_version ${versionId} is not a draft or staged version in ${environment}`,
      );
    }

    const previous = await tx.query(
      `select ${UNIVERSE_COLUMNS} from universe_version where environment = $1 and status = 'active'`,
      [environment],
    );
    const previousId = (previous.rows[0] as { id?: string } | undefined)?.id ?? null;
    const isFmp = target.sourceProvider === 'fmp';

    if (isFmp) {
      if (target.status !== 'staged' || target.approvedBy === null) {
        throw new Error(`FMP universe_version ${versionId} must be staged and approved first`);
      }
      if (audit.actorRole !== 'admin' || target.approvedBy !== audit.actorId) {
        throw new Error(
          `FMP universe_version ${versionId} must be activated by its recorded admin approver`,
        );
      }
      if (target.parentVersion !== previousId) {
        throw new Error(
          `FMP universe_version ${versionId} was reviewed against a stale active parent`,
        );
      }

      const { rows: storedMembers } = await tx.query<{ security_id: string }>(
        `select security_id from universe_member
          where universe_version = $1 and enabled = true
          order by security_id`,
        [versionId],
      );
      const storedIds = storedMembers.map(({ security_id }) => security_id);
      const suppliedIds = members.map(({ securityId }) => securityId).sort();
      if (
        storedIds.length !== target.selectedCount ||
        storedIds.length < 501 ||
        storedIds.length > UNIVERSE_MAX_SYMBOLS
      ) {
        throw new Error(
          `FMP universe_version ${versionId} stored membership does not match selected_count or completeness bounds`,
        );
      }
      if (
        suppliedIds.length !== storedIds.length ||
        suppliedIds.some((securityId, index) => securityId !== storedIds[index])
      ) {
        throw new Error(
          `FMP universe_version ${versionId} activation members must exactly match the reviewed staged membership`,
        );
      }
    } else {
      for (const member of members) {
        await tx.query(
          `insert into universe_member (universe_version, security_id, added_by, selection_source)
           values ($1, $2, $3, $4)
           on conflict (universe_version, security_id) do nothing`,
          [versionId, member.securityId, member.addedBy, member.selectionSource],
        );
      }
    }

    await tx.query(
      `update universe_version set status = 'superseded' where environment = $1 and status = 'active'`,
      [environment],
    );

    const { rows } = await tx.query(
      isFmp
        ? `update universe_version
              set status = 'active', activated_at = now()
            where id = $1 and environment = $2 and status = 'staged'
          returning ${UNIVERSE_COLUMNS}`
        : `update universe_version
              set status = 'active', activated_at = now(), selected_count = $3
            where id = $1 and environment = $2 and status in ('draft', 'staged')
      returning ${UNIVERSE_COLUMNS}`,
      isFmp ? [versionId, environment] : [versionId, environment, members.length],
    );

    const activated = rows[0];
    if (activated === undefined) {
      throw new Error(
        `universe_version ${versionId} is not a draft or staged version in ${environment}`,
      );
    }

    await tx.query(
      `insert into audit_event
         (actor_id, actor_role, action, object_type, object_id, environment, reason,
          before_value, after_value, result, request_id, correlation_id)
       values ($1, $2, 'activate', 'universe_version', $3, $4, $5, $6, $7, 'success', $8, $9)`,
      [
        audit.actorId,
        audit.actorRole,
        versionId,
        environment,
        audit.reason,
        JSON.stringify(previous.rows[0] ?? null),
        JSON.stringify(activated),
        audit.requestId,
        audit.correlationId,
      ],
    );

    return universeVersion.parse(camelizeRow(activated as Record<string, unknown>));
  });
}

export async function listUniverseMembers(
  versionId: string,
  db: Queryable = getPool(),
): Promise<string[]> {
  const { rows } = await db.query<{ security_id: string }>(
    'select security_id from universe_member where universe_version = $1 and enabled = true order by security_id',
    [versionId],
  );
  return rows.map((row) => row.security_id);
}
