import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { z } from 'zod';
import type pg from 'pg';
import { jobDefinition, jobRun, type JobDefinition, type JobRun } from '@/contracts/operations';
import { claimJobRun, type NewJobRun } from '@/repositories/jobs';
import { getPool, type Queryable } from '@/repositories/client';
import { camelizeRow, type Row } from '@/repositories/rows';
import { hashRniModelInput } from '@/rni/agents/model-input';
import {
  rniModelTask,
  rniTaskEnvelope,
  type RniManualRefreshScope,
  type RniTaskEnvelope,
} from '@/rni/contracts';
import { RniOrchestrationError } from '@/rni/orchestration/budget';
import { combinedDeliveryFor, deliveryFor } from '@/rni/orchestration/refresh';
import {
  executionRecord,
  type RniCombinedDelivery,
  type RniCommandRecord,
  type RniExecutionRecord,
  type RniOrchestrationStore,
  type RniOrchestrationTransaction,
  type RniPlatformDelivery,
  type RniRefreshPlan,
} from '@/rni/orchestration/types';
import {
  RNI_WORKER_MANIFEST_TASKS,
  hashRniWorkerPriceBook,
  type RniWorkerManifest,
  type RniWorkerManifestMember,
  type RniWorkerPriceBookValue,
} from '@/rni/orchestration/worker-manifest';
import {
  RniWorkerManifestRepositoryError,
  assembleRniWorkerManifest,
  loadRniWorkerManifestAuthorities,
  persistRniWorkerManifest,
  readRniWorkerBuildEnvironment,
  type RniWorkerBuildEnvironment,
} from '@/rni/repositories/worker-manifest';

const JOB_DEFINITION_COLUMNS =
  'id, job_key, display_name, enabled, schedule_type, schedule_expression, display_timezone, ' +
  'active_windows, jitter_seconds, scope, priority, max_runtime_seconds, concurrency_policy, ' +
  'max_attempts, backoff_policy, dependencies, max_calls_per_run, max_cost_usd_per_run, ' +
  'trigger_eligible, next_due_at, config_version, version, updated_by, updated_at';
const JOB_RUN_COLUMNS =
  'id, job_id, trigger_type, idempotency_key, config_version, universe_version, status, ' +
  'attempt, dry_run, requested_by, request_reason, lock_key, started_at, completed_at, ' +
  'data_as_of, items_read, items_written, provider_calls, estimated_cost_usd, unpriced_units, ' +
  'error, metrics';
const uuid = z.string().uuid();
const partitionName = z.string().min(1).max(200);
const activeTransactions = new WeakMap<RniOrchestrationTransaction, Queryable>();

function immutableRun(record: RniExecutionRecord) {
  const { status: _status, completedAt: _completedAt, ...identity } = record.run;
  return identity;
}

function immutableSlice(record: RniExecutionRecord, platform: 'reddit' | 'x') {
  const slice = record.platforms[platform].slice;
  return {
    id: slice.id,
    runId: slice.runId,
    platform: slice.platform,
    coverageDisclosure: slice.coverageDisclosure,
  };
}

/** Trusted bridge for I07 publication. It never opens a second transaction or pool connection. */
export function queryableForRniOrchestrationTransaction(
  transaction: RniOrchestrationTransaction,
): Queryable {
  const queryable = activeTransactions.get(transaction);
  if (queryable === undefined) {
    throw new RniOrchestrationError('STALE_EXECUTION');
  }
  return queryable;
}

type DefinitionIds = { manualJobId: string; scheduledJobId: string };

type ManifestAdmissionConfigRow = {
  config_checksum: string;
  model_policy_version: string;
  budget_policy_version: string;
  universe_snapshot_hash: string;
};

type ManifestAdmissionRouteRow = {
  task: (typeof RNI_WORKER_MANIFEST_TASKS)[number];
  transport: string;
  primary_provider: string;
  primary_model: string;
  canonical_provider_model_id: string;
  model_revision: string;
  reasoning_effort: string;
  policy_version: string;
  calibration_version: string;
  capability_snapshot_id: string;
  prompt_version: string;
  temperature: string;
  fallback_chain: string[];
  allowed_data_classes: string[];
  max_input_bytes: number;
  max_input_tokens: number;
  max_output_tokens: number;
  max_tool_calls: number;
  timeout_ms: number;
  max_cost_usd: string;
  capability_response_hash: string;
  capability_observed_at: string;
  capability_expires_at: string;
  capability_available: boolean;
  supports_responses: boolean;
  supports_structured_outputs: boolean;
  supports_web_search: boolean;
  reasoning_efforts: string[];
};

type ManifestAdmissionPriceHeaderRow = {
  price_book_version: string;
  source_url: string;
  response_hash: string;
  observed_at: string;
  first_tier_input_ceiling: number;
};

type ManifestAdmissionPriceUnitRow = {
  provider: 'openai';
  service: 'openai_responses' | 'openai_web_search';
  operation_or_model: string;
  unit_type: 'input_token' | 'output_token' | 'search';
  unit_price: string;
  currency: 'USD';
  effective_from: string;
  effective_until: string | null;
  source_reference: string;
};

type ManifestAdmissionMemberRow = {
  security_id: string;
  ticker: string;
  company_name: string;
  exchange: string;
  asset_type: string;
  currency: string;
  aliases: string[];
  selection_source: string;
  provider_symbol: string;
  provider_company_name: string;
  constituent_first_added_at: string | null;
};

/** Provision the two operational definitions against the active config without resetting cadence. */
export async function ensureRniJobDefinitions(
  environment: string,
  db: Queryable = getPool(),
): Promise<DefinitionIds> {
  const partition = partitionName.parse(environment);
  const active = await db.query<{ id: string }>(
    `select id::text as id from config_version
      where environment = $1 and status = 'active'`,
    [partition],
  );
  const configVersion = active.rows[0]?.id;
  if (configVersion === undefined) throw new RniOrchestrationError('INVALID_PLAN');
  const definitions = [
    {
      key: `rni-manual:${partition}`,
      display: 'RNI manual refresh',
      expression: '31536000',
      scope: {},
      triggerEligible: false,
      nextDue: new Date(Date.now() + 31_536_000_000),
    },
    {
      key: `rni-scheduled:${partition}`,
      display: 'RNI scheduled full-universe refresh',
      expression: '3600',
      scope: { kind: 'full_universe' },
      triggerEligible: true,
      nextDue: new Date(Date.now() + 3_600_000),
    },
  ] as const;
  const ids: string[] = [];
  for (const definition of definitions) {
    const { rows } = await db.query<{ id: string }>(
      `insert into job_definition (
         job_key, display_name, enabled, schedule_type, schedule_expression, display_timezone,
         active_windows, jitter_seconds, scope, priority, max_runtime_seconds,
         concurrency_policy, max_attempts, backoff_policy, dependencies, max_calls_per_run,
         max_cost_usd_per_run, trigger_eligible, next_due_at, config_version, updated_by
       ) values ($1,$2,true,'interval',$3,'UTC','[]',0,$4,50,900,'skip',3,
         '{"strategy":"exponential","base_ms":1000,"max_ms":30000}','[]',125,25,$5,$6,$7,
         'rni-coordinator')
       on conflict (job_key) do update
         set config_version = excluded.config_version,
             max_calls_per_run = greatest(job_definition.max_calls_per_run, 125),
             updated_by = 'rni-coordinator',
             updated_at = case when job_definition.config_version is distinct from excluded.config_version
               then now() else job_definition.updated_at end,
             version = job_definition.version +
               (job_definition.config_version is distinct from excluded.config_version)::integer
       returning id`,
      [
        definition.key,
        definition.display,
        definition.expression,
        JSON.stringify(definition.scope),
        definition.triggerEligible,
        definition.nextDue,
        configVersion,
      ],
    );
    ids.push(rows[0]!.id);
  }
  return { manualJobId: ids[0]!, scheduledJobId: ids[1]! };
}

type PersistedExecutionRow = {
  run_id: string;
  partition: string;
  job_run_id: string;
  plan_hash: string;
  coalesce_key: string;
  coalesce_until: Date;
  deadline: Date;
  rerun_of: string | null;
  admitted_cost_usd: string;
  remaining_admission_usd: string;
  admitted_at: Date;
  released_at: Date | null;
  record: unknown;
};

class PostgresRniOrchestrationTransaction implements RniOrchestrationTransaction {
  readonly committedPublicationRuns = new Set<string>();

  constructor(
    private readonly partition: string,
    private readonly db: Queryable,
    private readonly buildEnvironment?: RniWorkerBuildEnvironment,
  ) {}

  async getCommand(key: string): Promise<unknown | null> {
    const { rows } = await this.db.query<{ record: unknown }>(
      `select record from rni_orchestration_command
        where partition = $1 and command_key = $2 for update`,
      [this.partition, key],
    );
    return rows[0]?.record ?? null;
  }

  async putCommand(command: RniCommandRecord): Promise<void> {
    const { rowCount } = await this.db.query(
      `insert into rni_orchestration_command (partition,command_key,intent_hash,record)
       values ($1,$2,$3,$4) on conflict (partition,command_key) do nothing`,
      [this.partition, command.key, command.intentHash, JSON.stringify(command)],
    );
    if (rowCount === 1) return;
    const prior = await this.getCommand(command.key);
    if (hashRniModelInput(prior) !== hashRniModelInput(command)) {
      throw new RniOrchestrationError('CONFLICT');
    }
  }

  async getExecution(runId: string): Promise<unknown | null> {
    const { rows } = await this.db.query<{ record: unknown }>(
      `select record from rni_orchestration_execution
        where partition = $1 and run_id = $2 for update`,
      [this.partition, uuid.parse(runId)],
    );
    const raw = rows[0]?.record;
    if (raw === undefined) return null;
    const record = executionRecord.parse(raw);
    await this.verifyPublicationProjection(record);
    return raw;
  }

  async findCoalescible(key: string, at: string): Promise<unknown | null> {
    const { rows } = await this.db.query<{ record: unknown }>(
      `select e.record from rni_orchestration_execution e
        join rni_run r on r.id = e.run_id
       where e.partition = $1 and e.coalesce_key = $2 and e.coalesce_until > $3
         and e.deadline > $3 and r.status in ('requested','running')
       order by e.admitted_at desc, e.run_id desc limit 1 for update of e`,
      [this.partition, key, at],
    );
    return rows[0]?.record ?? null;
  }

  async resolveActivePlan(scope: RniManualRefreshScope, asOf: string): Promise<unknown> {
    const parsedScope = z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('ticker'), ticker: z.string().min(1) }).strict(),
        z.object({ kind: z.literal('full_universe') }).strict(),
      ])
      .parse(scope);
    const { rows: routeRows } = await this.db.query<{
      config_version: string;
      ai_route: 'openai_direct' | 'vercel_ai_gateway';
      manual_run_hard_usd: string;
      full_universe_hard_usd: string;
      rolling_24h_hard_usd: string;
      monthly_warning_usd: string;
      monthly_hard_usd: string;
      task: RniTaskEnvelope['task'];
      prompt_version: string;
      max_input_bytes: number;
      max_input_tokens: number;
      max_output_tokens: number;
      max_tool_calls: number;
      timeout_ms: number;
      max_cost_usd: string;
    }>(
      `select cv.id::text as config_version, ai.ai_route, ai.manual_run_hard_usd,
              ai.full_universe_hard_usd, ai.rolling_24h_hard_usd,
              ai.monthly_warning_usd, ai.monthly_hard_usd,
              mr.task, mr.prompt_version, mr.max_input_bytes,
              mr.max_input_tokens, mr.max_output_tokens, mr.max_tool_calls, mr.timeout_ms,
              mr.max_cost_usd
         from config_version cv
         join rni_ai_config ai on ai.config_version = cv.id
         join model_route mr on mr.config_version = cv.id and mr.ai_route = ai.ai_route
         join lateral (
           select c.id from rni_model_capability_snapshot c
            where c.ai_route = mr.ai_route and c.configured_model_id = mr.primary_model
              and c.provider = mr.primary_provider
              and c.canonical_provider_model_id = mr.canonical_provider_model_id
              and c.model_revision = mr.model_revision and c.available
              and c.supports_responses and c.supports_structured_outputs
              and c.reasoning_efforts ? mr.reasoning_effort
              and (mr.task <> 'rni_discovery' or c.supports_web_search)
              and c.observed_at <= $2 and c.expires_at > $2
            order by c.observed_at desc, c.id desc limit 1
         ) capability on true
        where cv.environment = $1 and cv.status = 'active'
          and mr.task = any($3::text[])
        order by array_position($3::text[], mr.task)
        for share of cv`,
      [this.partition, asOf, rniModelTask.options],
    );
    if (
      routeRows.length !== rniModelTask.options.length ||
      new Set(routeRows.map(({ task }) => task)).size !== rniModelTask.options.length
    ) {
      throw new RniOrchestrationError('INVALID_PLAN');
    }
    const first = routeRows[0]!;
    const universe = await this.db.query<{ id: string; selected_count: number }>(
      `select id::text as id, selected_count from universe_version
        where environment = $1 and status = 'active' for share`,
      [this.partition],
    );
    const activeUniverse = universe.rows[0];
    if (activeUniverse === undefined || activeUniverse.selected_count < 1) {
      throw new RniOrchestrationError('INVALID_PLAN');
    }
    let scopePreview: RniRefreshPlan['scopePreview'];
    if (parsedScope.kind === 'ticker') {
      const security = await this.db.query<{
        id: string;
        ticker: string;
        company_name: string;
        exchange: string;
      }>(
        `select s.id, s.symbol as ticker, s.name as company_name, s.exchange
           from universe_member m join security s on s.id = m.security_id
          where m.universe_version = $1 and m.enabled and s.symbol = $2
          order by s.id limit 2`,
        [activeUniverse.id, parsedScope.ticker],
      );
      if (security.rows.length !== 1) throw new RniOrchestrationError('NOT_FOUND');
      const selected = security.rows[0]!;
      scopePreview = {
        kind: 'ticker',
        securityId: selected.id,
        ticker: selected.ticker,
        companyName: selected.company_name,
        exchange: selected.exchange,
        universeVersion: activeUniverse.id,
      };
    } else {
      scopePreview = {
        kind: 'full_universe',
        universeVersion: activeUniverse.id,
        securityCount: activeUniverse.selected_count,
      };
    }
    const envelopes = routeRows.map((route) =>
      rniTaskEnvelope.parse({
        task: route.task,
        maxInputBytes: route.max_input_bytes,
        maxInputTokensReserved: route.max_input_tokens,
        maxOutputTokens: route.max_output_tokens,
        maxToolCalls: route.max_tool_calls,
        timeoutMs: route.timeout_ms,
        maxCostUsd: route.max_cost_usd,
      }),
    );
    const end = new Date(asOf);
    const windowStart = new Date(end.getTime() - 86_400_000);
    const comparisonEnd = windowStart;
    const comparisonStart = new Date(comparisonEnd.getTime() - 7 * 86_400_000);
    // These are worst-case unique billable invocations. Queue redelivery and a known-safe
    // workflow retry must replay the same invocation identity; it does not buy another slot.
    const tickerCalls = {
      reddit: {
        rni_discovery: 1,
        rni_relationship: 3,
        rni_classifier: 3,
        rni_verification: 1,
        rni_challenger: 1,
      },
      x: {
        rni_discovery: 0,
        rni_relationship: 2,
        rni_classifier: 2,
        rni_verification: 0,
        rni_challenger: 0,
      },
    };
    const universeCalls = {
      reddit: {
        rni_discovery: 3,
        rni_relationship: 20,
        rni_classifier: 20,
        rni_verification: 20,
        rni_challenger: 20,
      },
      x: {
        rni_discovery: 0,
        rni_relationship: 20,
        rni_classifier: 20,
        rni_verification: 0,
        rni_challenger: 0,
      },
    };
    return {
      configVersion: first.config_version,
      universeVersion: activeUniverse.id,
      promptVersion: `rni-prompt-set-${hashRniModelInput(
        routeRows.map(({ task, prompt_version }) => [task, prompt_version]),
      )}`,
      aiRoute: first.ai_route,
      scopePreview,
      timezone: 'UTC',
      windowStart: windowStart.toISOString(),
      windowEnd: end.toISOString(),
      comparisonStart: comparisonStart.toISOString(),
      comparisonEnd: comparisonEnd.toISOString(),
      envelopes,
      calls: parsedScope.kind === 'ticker' ? tickerCalls : universeCalls,
      maxAttempts: 3,
      maxRuntimeMs: 900_000,
      leaseMs: 60_000,
      baseBackoffMs: 1_000,
      maxBackoffMs: 30_000,
      coalesceMs: 60_000,
      budgets: {
        manualRunHardUsd: first.manual_run_hard_usd,
        fullUniverseHardUsd: first.full_universe_hard_usd,
        rolling24hHardUsd: first.rolling_24h_hard_usd,
        monthlyWarningUsd: first.monthly_warning_usd,
        monthlyHardUsd: first.monthly_hard_usd,
        currency: 'USD',
      },
      maxCostUsd:
        parsedScope.kind === 'ticker' ? first.manual_run_hard_usd : first.full_universe_hard_usd,
      coverage: {
        reddit: 'Reddit sampled Web Search discovery; not exhaustive platform coverage.',
        x: 'Configured X query sample; independent from Reddit and not platform-wide coverage.',
      },
    } satisfies RniRefreshPlan;
  }

  async getJobDefinition(jobId: string): Promise<JobDefinition | null> {
    const { rows } = await this.db.query(
      `select ${JOB_DEFINITION_COLUMNS} from job_definition where id = $1 for update`,
      [uuid.parse(jobId)],
    );
    return rows[0] === undefined ? null : jobDefinition.parse(camelizeRow(rows[0] as Row));
  }

  async isScheduledJobBusy(jobId: string): Promise<boolean> {
    const { rows } = await this.db.query<{ id: string }>(
      `select id from job_run
        where job_id = $1 and status in ('queued','running') limit 1 for update`,
      [uuid.parse(jobId)],
    );
    return rows.length === 1;
  }

  async createJob(input: NewJobRun): Promise<JobRun> {
    const claimed = await claimJobRun(input, this.db);
    if (!claimed.claimed) throw new RniOrchestrationError('CONFLICT');
    return claimed.run;
  }

  async createExecution(input: RniExecutionRecord): Promise<RniExecutionRecord> {
    const proposed = executionRecord.parse(input);
    const admission = await this.admitWorkerManifest(proposed);
    const record = admission.record;
    if (record.partition !== this.partition) throw new RniOrchestrationError('CONFLICT');
    await this.db.query(
      `insert into rni_run (
         id,idempotency_key,trigger,status,window_start,window_end,comparison_start,
         comparison_end,universe_version,config_version,prompt_version,ai_route,requested_at,
         completed_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        record.run.id,
        record.run.idempotencyKey,
        record.run.trigger,
        record.run.status,
        record.run.windowStart,
        record.run.windowEnd,
        record.run.comparisonStart,
        record.run.comparisonEnd,
        record.run.universeVersion,
        record.run.configVersion,
        record.run.promptVersion,
        record.run.aiRoute,
        record.run.requestedAt,
        record.run.completedAt,
      ],
    );
    for (const state of Object.values(record.platforms)) {
      const slice = state.slice;
      await this.db.query(
        `insert into rni_platform_slice (
           id,run_id,platform,status,eligible_source_count,coverage_disclosure,last_attempt_at,
           last_successful_refresh_at,data_through_at,computed_at,error_code
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          slice.id,
          slice.runId,
          slice.platform,
          slice.status,
          slice.eligibleSourceCount,
          slice.coverageDisclosure,
          slice.lastAttemptAt,
          slice.lastSuccessfulRefreshAt,
          slice.dataThroughAt,
          slice.computedAt,
          slice.errorCode,
        ],
      );
    }
    await this.db.query(
      `insert into rni_run_execution_scope (run_id,scope_kind,security_id)
       values ($1,$2,$3)`,
      [
        record.run.id,
        record.plan.scopePreview.kind === 'ticker' ? 'manual_ticker' : 'full_universe',
        record.plan.scopePreview.kind === 'ticker' ? record.plan.scopePreview.securityId : null,
      ],
    );
    await this.db.query(
      `insert into rni_orchestration_execution (
         run_id,partition,job_run_id,plan_hash,coalesce_key,coalesce_until,deadline,rerun_of,
         admitted_cost_usd,remaining_admission_usd,admitted_at,record
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11)`,
      [
        record.run.id,
        this.partition,
        record.jobRunId,
        record.planHash,
        record.coalesceKey,
        record.coalesceUntil,
        record.deadline,
        record.rerunOf,
        record.reservedCostUsd,
        record.run.requestedAt,
        JSON.stringify(record),
      ],
    );
    try {
      const persisted = await persistRniWorkerManifest(admission.manifest, this.db);
      if (
        persisted.runId !== record.run.id ||
        persisted.runManifestHash !== admission.record.runManifestHash
      ) {
        throw new RniOrchestrationError('CONFLICT');
      }
    } catch (error) {
      if (error instanceof RniOrchestrationError) throw error;
      if (error instanceof RniWorkerManifestRepositoryError) {
        throw new RniOrchestrationError(error.code === 'CONFLICT' ? 'CONFLICT' : 'INVALID_PLAN');
      }
      throw error;
    }
    return record;
  }

  private async admitWorkerManifest(proposed: RniExecutionRecord): Promise<{
    readonly record: Extract<RniExecutionRecord, { version: 'rni-execution-v2' }>;
    readonly manifest: RniWorkerManifest;
  }> {
    if (proposed.version !== 'rni-execution-v1') throw new RniOrchestrationError('CONFLICT');
    try {
      const config = await this.loadManifestAdmissionConfig(proposed);
      const routes = await this.loadManifestAdmissionRoutes(proposed);
      const priceBook = await this.loadManifestAdmissionPriceBook(proposed.run.requestedAt);
      const members = await this.loadManifestAdmissionMembers(proposed);
      const promptVersions = Object.fromEntries(
        routes.map(({ task, prompt_version }) => [task, prompt_version]),
      ) as Record<(typeof RNI_WORKER_MANIFEST_TASKS)[number], string>;
      const authorities = await loadRniWorkerManifestAuthorities(
        {
          configVersion: proposed.plan.configVersion,
          promptVersions,
          buildEnvironment: this.buildEnvironment ?? readRniWorkerBuildEnvironment(),
        },
        this.db,
      );
      const assembled = assembleRniWorkerManifest(
        {
          version: 'rni-worker-manifest-v2',
          environment: this.partition,
          partition: this.partition,
          runId: proposed.run.id,
          jobRunId: proposed.jobRunId,
          planHash: proposed.planHash,
          trigger: proposed.run.trigger,
          acceptedAt: proposed.run.requestedAt,
          deadline: proposed.deadline,
          scope:
            proposed.plan.scopePreview.kind === 'ticker'
              ? {
                  kind: 'manual_ticker',
                  selectedSecurityId: proposed.plan.scopePreview.securityId,
                }
              : { kind: 'full_universe' },
          windows: {
            timezone: proposed.plan.timezone,
            windowStart: proposed.plan.windowStart,
            windowEnd: proposed.plan.windowEnd,
            comparisonStart: proposed.plan.comparisonStart,
            comparisonEnd: proposed.plan.comparisonEnd,
            assessmentCutoffAt: proposed.plan.windowEnd,
          },
          configuration: {
            version: proposed.plan.configVersion,
            checksum: config.config_checksum,
            aiRoute: proposed.plan.aiRoute,
            modelPolicyVersion: config.model_policy_version,
            budgetPolicyVersion: config.budget_policy_version,
            promptSetVersion: proposed.plan.promptVersion,
            aggregateBudgets: proposed.plan.budgets,
          },
          universe: {
            version: proposed.plan.universeVersion,
            snapshotHash: config.universe_snapshot_hash,
          },
          modelRoutes: routes.map((route) => ({
            task: route.task,
            aiRoute: proposed.plan.aiRoute,
            transport: route.transport,
            provider: route.primary_provider,
            configuredModelId: route.primary_model,
            canonicalProviderModelId: route.canonical_provider_model_id,
            modelRevision: route.model_revision,
            reasoningEffort: route.reasoning_effort,
            policyVersion: route.policy_version,
            calibrationVersion: route.calibration_version,
            capability: {
              snapshotId: route.capability_snapshot_id,
              responseHash: route.capability_response_hash,
              observedAt: route.capability_observed_at,
              expiresAt: route.capability_expires_at,
              available: route.capability_available,
              supportsResponses: route.supports_responses,
              supportsStructuredOutputs: route.supports_structured_outputs,
              supportsWebSearch: route.supports_web_search,
              reasoningEfforts: route.reasoning_efforts,
              requiresResponses: true,
              requiresStructuredOutputs: true,
              requiresWebSearch: route.task === 'rni_discovery',
            },
            temperature: route.temperature,
            fallbackChain: route.fallback_chain,
            allowedDataClasses: route.allowed_data_classes,
            envelope: {
              task: route.task,
              maxInputBytes: route.max_input_bytes,
              maxInputTokensReserved: route.max_input_tokens,
              maxOutputTokens: route.max_output_tokens,
              maxToolCalls: route.max_tool_calls,
              timeoutMs: route.timeout_ms,
              maxCostUsd: route.max_cost_usd,
            },
            priceBook,
          })),
          orchestration: {
            maxAttempts: proposed.plan.maxAttempts,
            maxRuntimeMs: proposed.plan.maxRuntimeMs,
            leaseMs: proposed.plan.leaseMs,
            baseBackoffMs: proposed.plan.baseBackoffMs,
            maxBackoffMs: proposed.plan.maxBackoffMs,
            coalesceMs: proposed.plan.coalesceMs,
            calls: proposed.plan.calls,
            maxCostUsd: proposed.plan.maxCostUsd,
          },
          coverage: proposed.plan.coverage,
          members,
        },
        authorities,
      );
      const runManifestHash = assembled.runManifestHash;
      const record = executionRecord.parse({
        ...proposed,
        version: 'rni-execution-v2',
        runManifestHash,
        platforms: {
          reddit: {
            ...proposed.platforms.reddit,
            delivery: deliveryFor(
              proposed.run.id,
              'reddit',
              proposed.planHash,
              proposed.platforms.reddit.delivery.attempt,
              runManifestHash,
            ),
          },
          x: {
            ...proposed.platforms.x,
            delivery: deliveryFor(
              proposed.run.id,
              'x',
              proposed.planHash,
              proposed.platforms.x.delivery.attempt,
              runManifestHash,
            ),
          },
        },
        combined: {
          ...proposed.combined,
          delivery: combinedDeliveryFor(
            proposed.run.id,
            proposed.planHash,
            proposed.combined.delivery.attempt,
            runManifestHash,
          ),
        },
      });
      if (record.version !== 'rni-execution-v2') throw new RniOrchestrationError('CONFLICT');
      return { record, manifest: assembled.manifest };
    } catch (error) {
      if (error instanceof RniOrchestrationError) throw error;
      if (error instanceof RniWorkerManifestRepositoryError || error instanceof z.ZodError) {
        throw new RniOrchestrationError(
          error instanceof RniWorkerManifestRepositoryError && error.code === 'CONFLICT'
            ? 'CONFLICT'
            : 'INVALID_PLAN',
        );
      }
      throw error;
    }
  }

  private async loadManifestAdmissionConfig(
    record: RniExecutionRecord,
  ): Promise<ManifestAdmissionConfigRow> {
    const { rows } = await this.db.query<ManifestAdmissionConfigRow>(
      `select config.checksum as config_checksum,
              ai.model_policy_version,ai.budget_policy_version,
              universe.source_payload_hash as universe_snapshot_hash
         from config_version config
         join rni_ai_config ai on ai.config_version=config.id
         join universe_version universe on universe.id=$3
        where config.id=$1 and config.environment=$2 and config.status='active'
          and universe.environment=$2 and universe.status='active'
          and universe.source_provider='fmp'
          and universe.source_endpoint='/stable/sp500-constituent'
          and universe.source_payload_hash is not null
          and universe.selected_count between 501 and 600
        for share of config,universe`,
      [record.plan.configVersion, this.partition, record.plan.universeVersion],
    );
    if (rows.length !== 1) throw new RniOrchestrationError('INVALID_PLAN');
    return rows[0]!;
  }

  private async loadManifestAdmissionRoutes(
    record: RniExecutionRecord,
  ): Promise<readonly ManifestAdmissionRouteRow[]> {
    const { rows } = await this.db.query<ManifestAdmissionRouteRow>(
      `select route.task,route.transport,route.primary_provider,route.primary_model,
              route.canonical_provider_model_id,route.model_revision,route.reasoning_effort,
              route.policy_version,route.calibration_version,
              route.capability_snapshot_id,route.prompt_version,route.temperature::text,
              route.fallback_chain,route.allowed_data_classes,route.max_input_bytes,
              route.max_input_tokens,route.max_output_tokens,route.max_tool_calls,
              route.timeout_ms,route.max_cost_usd::text,
              capability.response_hash as capability_response_hash,
              to_char(capability.observed_at at time zone 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as capability_observed_at,
              to_char(capability.expires_at at time zone 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as capability_expires_at,
              capability.available as capability_available,capability.supports_responses,
              capability.supports_structured_outputs,capability.supports_web_search,
              capability.reasoning_efforts
         from model_route route
         join rni_model_capability_snapshot capability
           on capability.id=route.capability_snapshot_id
          and capability.ai_route=route.ai_route
          and capability.configured_model_id=route.primary_model
          and capability.provider=route.primary_provider
          and capability.canonical_provider_model_id=route.canonical_provider_model_id
          and capability.model_revision=route.model_revision
        where route.config_version=$1 and route.ai_route=$2
          and route.task=any($3::text[])
        order by array_position($3::text[],route.task)`,
      [record.plan.configVersion, record.plan.aiRoute, RNI_WORKER_MANIFEST_TASKS],
    );
    if (
      rows.length !== RNI_WORKER_MANIFEST_TASKS.length ||
      rows.some((row, index) => row.task !== RNI_WORKER_MANIFEST_TASKS[index])
    ) {
      throw new RniOrchestrationError('INVALID_PLAN');
    }
    return rows;
  }

  private async loadManifestAdmissionPriceBook(
    acceptedAt: string,
  ): Promise<RniWorkerManifest['modelRoutes'][number]['priceBook']> {
    const header = await this.db.query<ManifestAdmissionPriceHeaderRow>(
      `select evidence.price_book_version,evidence.source_url,evidence.response_hash,
              to_char(evidence.observed_at at time zone 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as observed_at,
              evidence.first_tier_input_ceiling
         from rni_price_book_evidence evidence
         join unit_price_book price
           on price.price_book_version=evidence.price_book_version
        where evidence.observed_at <= $1
          and price.provider='openai' and price.currency='USD'
          and price.effective_from <= $1
          and (price.effective_until is null or price.effective_until > $1)
          and ((price.service='openai_responses'
                and price.operation_or_model in ('gpt-5.6-terra','gpt-5.6-sol')
                and price.unit_type in ('input_token','output_token'))
            or (price.service='openai_web_search' and price.operation_or_model='web_search'
                and price.unit_type='search'))
        group by evidence.price_book_version,evidence.source_url,evidence.response_hash,
                 evidence.observed_at,evidence.first_tier_input_ceiling
       having count(*)=5
        order by evidence.observed_at desc,evidence.price_book_version desc
        limit 1`,
      [acceptedAt],
    );
    const selected = header.rows[0];
    if (selected === undefined) throw new RniOrchestrationError('INVALID_PLAN');
    const unitRows = await this.db.query<ManifestAdmissionPriceUnitRow>(
      `select provider,service,operation_or_model,unit_type,unit_price::text,currency,
              to_char(effective_from at time zone 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as effective_from,
              case when effective_until is null then null else
                to_char(effective_until at time zone 'UTC',
                  'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end as effective_until,
              source_reference
         from unit_price_book
        where price_book_version=$1 and provider='openai' and currency='USD'
          and effective_from <= $2 and (effective_until is null or effective_until > $2)
          and ((service='openai_responses'
                and operation_or_model in ('gpt-5.6-terra','gpt-5.6-sol')
                and unit_type in ('input_token','output_token'))
            or (service='openai_web_search' and operation_or_model='web_search'
                and unit_type='search'))
        order by provider collate "C",service collate "C",operation_or_model collate "C",
                 unit_type collate "C"`,
      [selected.price_book_version, acceptedAt],
    );
    if (unitRows.rows.length !== 5) throw new RniOrchestrationError('INVALID_PLAN');
    const value: RniWorkerPriceBookValue = {
      version: selected.price_book_version,
      sourceUrl: selected.source_url,
      responseHash: selected.response_hash,
      observedAt: selected.observed_at,
      firstTierInputCeiling: selected.first_tier_input_ceiling,
      units: unitRows.rows.map((unit) => ({
        provider: unit.provider,
        service: unit.service,
        operationOrModel: unit.operation_or_model,
        unitType: unit.unit_type,
        unitPrice: unit.unit_price,
        currency: unit.currency,
        effectiveFrom: unit.effective_from,
        effectiveUntil: unit.effective_until,
        sourceReference: unit.source_reference,
      })) as RniWorkerPriceBookValue['units'],
    };
    return { ...value, snapshotHash: hashRniWorkerPriceBook(value) };
  }

  private async loadManifestAdmissionMembers(
    record: RniExecutionRecord,
  ): Promise<RniWorkerManifestMember[]> {
    const { rows } = await this.db.query<ManifestAdmissionMemberRow>(
      `select security.id::text as security_id,security.symbol as ticker,
              security.name as company_name,security.exchange,security.asset_type,
              security.currency,security.aliases,member.selection_source,
              member.provider_symbol,member.provider_company_name,
              case when member.constituent_first_added_at is null then null else
                to_char(member.constituent_first_added_at at time zone 'UTC',
                  'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end as constituent_first_added_at
         from universe_member member
         join security on security.id=member.security_id
        where member.universe_version=$1 and member.enabled
          and ($2::uuid is null or security.id=$2)
        order by security.symbol collate "C",security.exchange collate "C",security.id`,
      [
        record.plan.universeVersion,
        record.plan.scopePreview.kind === 'ticker' ? record.plan.scopePreview.securityId : null,
      ],
    );
    const expected =
      record.plan.scopePreview.kind === 'full_universe'
        ? record.plan.scopePreview.securityCount
        : 1;
    if (
      rows.length !== expected ||
      (record.plan.scopePreview.kind === 'full_universe' &&
        (rows.length < 501 || rows.length > 600))
    ) {
      throw new RniOrchestrationError('INVALID_PLAN');
    }
    return rows.map((member, index) => ({
      ordinal: index + 1,
      securityId: member.security_id,
      ticker: member.ticker,
      companyName: member.company_name,
      exchange: member.exchange,
      assetType: member.asset_type,
      currency: member.currency,
      aliases: member.aliases,
      selectionSource: member.selection_source,
      providerSymbol: member.provider_symbol,
      providerCompanyName: member.provider_company_name,
      constituentFirstAddedAt: member.constituent_first_added_at,
    }));
  }

  async putExecution(input: RniExecutionRecord): Promise<void> {
    const record = executionRecord.parse(input);
    const current = await this.lockExecutionRow(record.run.id);
    const previous = executionRecord.parse(current.record);
    await this.verifyPublicationProjection(previous);
    if (
      current.partition !== this.partition ||
      current.job_run_id !== record.jobRunId ||
      current.plan_hash !== record.planHash ||
      current.coalesce_key !== record.coalesceKey ||
      current.coalesce_until.toISOString() !== record.coalesceUntil ||
      current.deadline.toISOString() !== record.deadline ||
      current.rerun_of !== record.rerunOf ||
      !new Decimal(current.admitted_cost_usd).eq(record.reservedCostUsd) ||
      hashRniModelInput(previous.plan) !== hashRniModelInput(record.plan) ||
      hashRniModelInput(immutableRun(previous)) !== hashRniModelInput(immutableRun(record)) ||
      hashRniModelInput(immutableSlice(previous, 'reddit')) !==
        hashRniModelInput(immutableSlice(record, 'reddit')) ||
      hashRniModelInput(immutableSlice(previous, 'x')) !==
        hashRniModelInput(immutableSlice(record, 'x')) ||
      (previous.combined.publication !== null &&
        hashRniModelInput(previous.combined.publication) !==
          hashRniModelInput(record.combined.publication))
    ) {
      throw new RniOrchestrationError('CONFLICT');
    }
    const terminal = ['complete', 'partial', 'failed', 'cancelled'].includes(record.run.status);
    await this.db.query(`update rni_run set status = $2, completed_at = $3 where id = $1`, [
      record.run.id,
      record.run.status,
      record.run.completedAt,
    ]);
    for (const state of Object.values(record.platforms)) {
      const slice = state.slice;
      await this.db.query(
        `update rni_platform_slice set status=$2,eligible_source_count=$3,last_attempt_at=$4,
           last_successful_refresh_at=$5,data_through_at=$6,computed_at=$7,error_code=$8
         where id=$1 and run_id=$9 and platform=$10`,
        [
          slice.id,
          slice.status,
          slice.eligibleSourceCount,
          slice.lastAttemptAt,
          slice.lastSuccessfulRefreshAt,
          slice.dataThroughAt,
          slice.computedAt,
          slice.errorCode,
          record.run.id,
          slice.platform,
        ],
      );
    }
    const jobStatus = {
      requested: 'queued',
      running: 'running',
      complete: 'succeeded',
      partial: 'degraded',
      failed: 'failed',
      cancelled: 'cancelled',
    }[record.run.status];
    await this.db.query(
      `update job_run set status=$2,
         started_at=case when $2='running' then coalesce(started_at,$3::timestamptz) else started_at end,
         completed_at=case when $2 in ('succeeded','degraded','failed','cancelled')
           then $4::timestamptz else null end
       where id=$1`,
      [record.jobRunId, jobStatus, record.run.requestedAt, record.run.completedAt],
    );
    const becamePublished =
      previous.combined.publication === null && record.combined.publication !== null;
    await this.db.query(
      `update rni_orchestration_execution
          set record=$2,remaining_admission_usd=case when $3 then 0 else remaining_admission_usd end,
              released_at=case when $3 then coalesce(released_at,clock_timestamp())
                               else released_at end,updated_at=clock_timestamp()
        where run_id=$1 and partition=$4`,
      [record.run.id, JSON.stringify(record), terminal, this.partition],
    );
    if (becamePublished) {
      const proof = record.combined.publication!;
      await this.db.query(
        `insert into rni_orchestration_publication_receipt (
           run_id,plan_hash,artifact_hash,status,token,attempt,acquired_at,expires_at,
           committed_at,artifact
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
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
      this.committedPublicationRuns.add(record.run.id);
    }
  }

  async admitBudget(input: {
    runId: string;
    at: string;
    costUsd: string;
    runLimitUsd: string;
  }): Promise<{ rollingDayUsd: string; calendarMonthUsd: string }> {
    uuid.parse(input.runId);
    await this.db.query(
      `select pg_advisory_xact_lock(hashtextextended('rni-ai-budget:' || $1, 0))`,
      [this.partition],
    );
    const { rows } = await this.db.query<{
      rolling_day_usd: string;
      calendar_month_usd: string;
    }>(
      `with clock as (select clock_timestamp() as at), usage as (
         select
           rni_ai_effective_spend($1,c.at-interval '24 hours',c.at+interval '1 microsecond')
             + coalesce((select sum(e.remaining_admission_usd)
                 from rni_orchestration_execution e
                 join rni_run r on r.id=e.run_id join config_version cv on cv.id=r.config_version
                where cv.environment=$1 and e.released_at is null),0)
             as rolling_day_usd,
           rni_ai_effective_spend($1,date_trunc('month',c.at at time zone 'UTC') at time zone 'UTC',
             c.at+interval '1 microsecond')
             + coalesce((select sum(e.remaining_admission_usd)
                 from rni_orchestration_execution e
                 join rni_run r on r.id=e.run_id join config_version cv on cv.id=r.config_version
                where cv.environment=$1 and e.released_at is null),0) as calendar_month_usd
           from clock c
       ) select rolling_day_usd,calendar_month_usd from usage`,
      [this.partition],
    );
    return {
      rollingDayUsd: rows[0]!.rolling_day_usd,
      calendarMonthUsd: rows[0]!.calendar_month_usd,
    };
  }

  enqueue(delivery: RniPlatformDelivery, notBefore: string): Promise<void> {
    return this.insertOutbox('platform', delivery, notBefore);
  }

  enqueueCombined(delivery: RniCombinedDelivery, notBefore: string): Promise<void> {
    return this.insertOutbox('combined', delivery, notBefore);
  }

  async advanceSchedule(input: {
    jobId: string;
    version: number;
    dueAt: string;
    nextDueAt: string;
  }): Promise<void> {
    const { rowCount } = await this.db.query(
      `update job_definition set next_due_at=$4,version=version+1,updated_by='rni-scheduler',
         updated_at=clock_timestamp()
       where id=$1 and version=$2 and next_due_at=$3`,
      [input.jobId, input.version, input.dueAt, input.nextDueAt],
    );
    if (rowCount !== 1) throw new RniOrchestrationError('CONFLICT');
  }

  async audit(input: {
    event:
      | 'accepted'
      | 'coalesced'
      | 'rerun'
      | 'platform_terminal'
      | 'platform_retry'
      | 'combined_committed'
      | 'combined_terminal'
      | 'combined_retry'
      | 'schedule_skipped';
    runId: string | null;
    actor: string;
    at: string;
    jobId?: string;
    dueAt?: string;
  }): Promise<void> {
    const objectId = input.runId ?? input.jobId ?? this.partition;
    const requestId = createHash('sha256')
      .update(JSON.stringify([this.partition, input.event, objectId, input.at, input.dueAt]))
      .digest('hex');
    await this.db.query(
      `insert into audit_event (
         occurred_at,actor_id,actor_role,action,object_type,object_id,environment,reason,
         after_value,result,request_id,correlation_id
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'success',$10,$11)`,
      [
        input.at,
        input.actor,
        input.actor === 'rni-worker' || input.actor === 'rni-scheduler' ? 'service' : 'admin',
        input.event,
        input.runId === null ? 'rni_schedule' : 'rni_run',
        objectId,
        this.partition,
        `RNI orchestration ${input.event}`,
        JSON.stringify({ jobId: input.jobId, dueAt: input.dueAt }),
        requestId,
        input.runId ?? requestId,
      ],
    );
  }

  async assertPublicationFences(): Promise<void> {
    for (const runId of this.committedPublicationRuns) {
      const { rowCount } = await this.db.query(
        `select 1
           from rni_orchestration_execution e
           left join rni_full_universe_publication_release release_row
             on release_row.run_id = e.run_id
           left join rni_orchestration_publication_receipt receipt
             on receipt.run_id = e.run_id
          where e.run_id=$1 and e.partition=$2
            and (e.record #>> '{combined,publication,attempt}')::integer
              = (e.record #>> '{combined,attempt}')::integer
            and clock_timestamp()
              < (e.record #>> '{combined,publication,expiresAt}')::timestamptz
            and clock_timestamp() < e.deadline
            and (
              (
                release_row.run_id is null
                and e.record #>> '{combined,status}' = 'running'
                and e.record #>> '{combined,publication,token}'
                  = e.record #>> '{combined,lease,token}'
                and e.record #>> '{combined,publication,expiresAt}'
                  = e.record #>> '{combined,lease,expiresAt}'
              )
              or (
                release_row.run_id is not null
                and e.record ->> 'version' = 'rni-execution-v2'
                and e.record #>> '{combined,status}' = 'complete'
                and e.record #> '{combined,lease}' = 'null'::jsonb
                and e.record #>> '{combined,publication,token}'
                  = e.record #>> '{combined,outcomeToken}'
                and release_row.combined_token::text
                  = e.record #>> '{combined,publication,token}'
                and receipt.token = release_row.combined_token
                and receipt.artifact_hash = release_row.aggregate_hash
                and receipt.committed_at = release_row.released_at
              )
            )
          for update of e`,
        [runId, this.partition],
      );
      if (rowCount !== 1) throw new RniOrchestrationError('STALE_EXECUTION');
    }
  }

  private async lockExecutionRow(runId: string): Promise<PersistedExecutionRow> {
    const { rows } = await this.db.query<PersistedExecutionRow>(
      `select * from rni_orchestration_execution
        where run_id=$1 and partition=$2 for update`,
      [uuid.parse(runId), this.partition],
    );
    if (rows[0] === undefined) throw new RniOrchestrationError('NOT_FOUND');
    return rows[0];
  }

  private async verifyPublicationProjection(record: RniExecutionRecord): Promise<void> {
    const { rows } = await this.db.query<{
      plan_hash: string;
      artifact_hash: string;
      status: string;
      token: string;
      attempt: number;
      acquired_at: Date;
      expires_at: Date;
      committed_at: Date;
      artifact: unknown;
    }>(
      `select plan_hash,artifact_hash,status,token,attempt,acquired_at,expires_at,committed_at,
              artifact
         from rni_orchestration_publication_receipt where run_id=$1`,
      [record.run.id],
    );
    const receipt = rows[0];
    const proof = record.combined.publication;
    if (proof === null) {
      if (receipt !== undefined) throw new RniOrchestrationError('CONFLICT');
      return;
    }
    if (
      receipt === undefined ||
      receipt.plan_hash !== record.planHash ||
      receipt.artifact_hash !== proof.artifact.artifactHash ||
      receipt.status !== proof.artifact.status ||
      receipt.token !== proof.token ||
      receipt.attempt !== proof.attempt ||
      receipt.acquired_at.toISOString() !== proof.acquiredAt ||
      receipt.expires_at.toISOString() !== proof.expiresAt ||
      receipt.committed_at.toISOString() !== proof.committedAt ||
      hashRniModelInput(receipt.artifact) !== hashRniModelInput(proof.artifact)
    ) {
      throw new RniOrchestrationError('CONFLICT');
    }
  }

  private async insertOutbox(
    kind: 'platform' | 'combined',
    delivery: RniPlatformDelivery | RniCombinedDelivery,
    notBefore: string,
  ): Promise<void> {
    const hash = hashRniModelInput(delivery);
    const { rowCount } = await this.db.query(
      `insert into rni_orchestration_outbox
        (delivery_key,partition,kind,run_id,payload_hash,payload,not_before)
       values ($1,$2,$3,$4,$5,$6,$7) on conflict (delivery_key) do nothing`,
      [
        delivery.deliveryKey,
        this.partition,
        kind,
        delivery.runId,
        hash,
        JSON.stringify(delivery),
        notBefore,
      ],
    );
    if (rowCount === 1) return;
    const replay = await this.db.query<{
      partition: string;
      kind: string;
      run_id: string;
      payload_hash: string;
      not_before: Date;
    }>(
      `select partition,kind,run_id,payload_hash,not_before
         from rni_orchestration_outbox where delivery_key=$1`,
      [delivery.deliveryKey],
    );
    const row = replay.rows[0];
    if (
      row === undefined ||
      row.partition !== this.partition ||
      row.kind !== kind ||
      row.run_id !== delivery.runId ||
      row.payload_hash !== hash ||
      row.not_before.toISOString() !== new Date(notBefore).toISOString()
    ) {
      throw new RniOrchestrationError('CONFLICT');
    }
  }
}

export class PostgresRniOrchestrationStore implements RniOrchestrationStore {
  constructor(
    private readonly pool: pg.Pool = getPool(),
    private readonly buildEnvironment?: RniWorkerBuildEnvironment,
  ) {}

  async transact<T>(
    partition: string,
    operation: (tx: RniOrchestrationTransaction) => Promise<T>,
  ): Promise<T> {
    const trustedPartition = partitionName.parse(partition);
    const client = await this.pool.connect();
    const transaction = new PostgresRniOrchestrationTransaction(
      trustedPartition,
      client,
      this.buildEnvironment,
    );
    try {
      await client.query('begin');
      // Match I10's order exactly. Every lifecycle transaction may project run state after
      // locking the execution row, so it must own the global budget lock before either row.
      await client.query(
        `select pg_advisory_xact_lock(hashtextextended('rni-ai-budget:' || $1, 0))`,
        [trustedPartition],
      );
      await client.query(
        `select pg_advisory_xact_lock(hashtextextended('rni-orchestration:' || $1, 0))`,
        [trustedPartition],
      );
      activeTransactions.set(transaction, client);
      const result = await operation(transaction);
      await transaction.assertPublicationFences();
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      activeTransactions.delete(transaction);
      client.release();
    }
  }
}

export class PostgresRniOutbox {
  constructor(
    private readonly partition: string,
    private readonly kind: 'platform' | 'combined',
    private readonly pool: pg.Pool = getPool(),
  ) {
    partitionName.parse(partition);
  }

  async pending(at: string, limit: number): Promise<readonly unknown[]> {
    const { rows } = await this.pool.query<{ payload: unknown; not_before: Date }>(
      `select payload,not_before from rni_orchestration_outbox
        where partition=$1 and kind=$2 and published_at is null and not_before <= $3
        order by not_before,created_at,delivery_key limit $4`,
      [this.partition, this.kind, at, limit],
    );
    return rows.map((row) => ({ delivery: row.payload, notBefore: row.not_before.toISOString() }));
  }

  async markPublished(input: {
    deliveryKey: string;
    payloadHash: string;
    messageId: string;
  }): Promise<void> {
    const { rows } = await this.pool.query<{ payload_hash: string; published_at: Date | null }>(
      `update rni_orchestration_outbox
          set published_at=coalesce(published_at,clock_timestamp()),
              message_id=coalesce(message_id,$4)
        where delivery_key=$1 and partition=$2 and kind=$3 and payload_hash=$5
        returning payload_hash,published_at`,
      [input.deliveryKey, this.partition, this.kind, input.messageId, input.payloadHash],
    );
    if (rows.length !== 1) throw new RniOrchestrationError('CONFLICT');
  }
}

export async function findRniJobRun(id: string, db: Queryable = getPool()): Promise<JobRun | null> {
  const { rows } = await db.query(`select ${JOB_RUN_COLUMNS} from job_run where id=$1`, [id]);
  return rows[0] === undefined ? null : jobRun.parse(camelizeRow(rows[0] as Row));
}
