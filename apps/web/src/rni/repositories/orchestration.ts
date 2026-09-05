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

  async createExecution(input: RniExecutionRecord): Promise<void> {
    const record = executionRecord.parse(input);
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
        `select 1 from rni_orchestration_execution
          where run_id=$1 and partition=$2
            and record #>> '{combined,publication,token}' = record #>> '{combined,lease,token}'
            and (record #>> '{combined,publication,attempt}')::integer
              = (record #>> '{combined,attempt}')::integer
            and clock_timestamp() < (record #>> '{combined,lease,expiresAt}')::timestamptz
            and clock_timestamp() < deadline
          for update`,
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
  constructor(private readonly pool: pg.Pool = getPool()) {}

  async transact<T>(
    partition: string,
    operation: (tx: RniOrchestrationTransaction) => Promise<T>,
  ): Promise<T> {
    const trustedPartition = partitionName.parse(partition);
    const client = await this.pool.connect();
    const transaction = new PostgresRniOrchestrationTransaction(trustedPartition, client);
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
