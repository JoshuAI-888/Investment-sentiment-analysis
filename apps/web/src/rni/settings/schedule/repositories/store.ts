import type pg from 'pg';
import { z } from 'zod';
import { jobDefinition, type JobDefinition } from '@/contracts/operations';
import { getPool, withTransaction, type Queryable } from '@/repositories/client';
import { camelizeRow, type Row } from '@/repositories/rows';
import { hashRniModelInput } from '@/rni/agents/model-input';
import { previewRniSchedule } from '@/rni/orchestration/schedules';
import { validateScheduleCadence } from '../cadence';
import { RniScheduleSettingsError } from '../errors';
import {
  scheduleSetting,
  scheduleUpdateRequest,
  scheduleUpdateResult,
  type RniScheduleSettingsService,
  type ScheduleSetting,
  type ScheduleUpdateRequest,
} from '../schemas';

type Options = { environment: string; actorId: string; pool?: pg.Pool };
const receipt = z
  .object({ requestHash: z.string().regex(/^[0-9a-f]{64}$/u), result: scheduleUpdateResult })
  .strict();

/** Only the existing environment-bound scheduled definition is selectable by this service. */
async function definition(
  environment: string,
  db: Queryable,
  locking = false,
): Promise<JobDefinition> {
  const { rows } = await db.query(
    `select j.* from job_definition j join config_version c on c.id=j.config_version
     where j.job_key=$1 and c.environment=$2 ${locking ? 'for update of j' : ''}`,
    [`rni-scheduled:${environment}`, environment],
  );
  if (rows.length !== 1) throw new RniScheduleSettingsError('unavailable');
  const parsed = jobDefinition.safeParse(camelizeRow(rows[0] as Row));
  if (!parsed.success) throw new RniScheduleSettingsError('unavailable');
  const job = parsed.data;
  const empty = (v: unknown) =>
    v === null || (typeof v === 'object' && Object.keys(v).length === 0);
  if (
    hashRniModelInput(job.scope) !== hashRniModelInput({ kind: 'full_universe' }) ||
    job.concurrencyPolicy !== 'skip' ||
    job.jitterSeconds !== 0 ||
    !empty(job.activeWindows) ||
    !empty(job.dependencies)
  )
    throw new RniScheduleSettingsError('unavailable');
  return job;
}

async function transactionTime(db: Queryable): Promise<Date> {
  return (await db.query<{ at: Date }>('select clock_timestamp() as at')).rows[0]!.at;
}

function setting(job: JobDefinition, observedAt: Date): ScheduleSetting {
  try {
    validateScheduleCadence(
      {
        scheduleType: job.scheduleType,
        scheduleExpression: job.scheduleExpression,
        displayTimezone: job.displayTimezone,
      },
      observedAt,
    );
    // The persisted due instant is authoritative, even when overdue. For paused jobs these are
    // labelled projections, not promises that work will run. Never silently move due state on GET.
    const localTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: job.displayTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    }).format(job.nextDueAt);
    return scheduleSetting.parse({
      jobId: job.id,
      version: job.version,
      enabled: job.enabled,
      scheduleType: job.scheduleType,
      scheduleExpression: job.scheduleExpression,
      displayTimezone: job.displayTimezone,
      scope: job.scope,
      nextDueAt: job.nextDueAt.toISOString(),
      nextRuns: [
        { dueAt: job.nextDueAt.toISOString(), localTime, timezone: job.displayTimezone },
        ...previewRniSchedule(job, job.nextDueAt, 4),
      ],
      observedAt: observedAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      updatedBy: job.updatedBy,
    });
  } catch {
    throw new RniScheduleSettingsError('unavailable');
  }
}

/** Operational job definitions are versioned mutable state; analytical run snapshots are not. */
export class PostgresRniScheduleSettingsService implements RniScheduleSettingsService {
  private readonly pool: pg.Pool;
  constructor(private readonly options: Options) {
    if (!options.environment.trim() || options.environment.length > 200 || !options.actorId.trim())
      throw new RniScheduleSettingsError('invalid');
    this.pool = options.pool ?? getPool();
  }

  getCurrentSchedule() {
    return withTransaction(async (db) => {
      await db.query('set transaction isolation level repeatable read read only');
      const job = await definition(this.options.environment, db);
      return setting(job, await transactionTime(db));
    }, this.pool);
  }

  async updateSchedule(raw: ScheduleUpdateRequest) {
    const parsed = scheduleUpdateRequest.safeParse(raw);
    if (!parsed.success) throw new RniScheduleSettingsError('invalid');
    const request = parsed.data;
    const { environment, actorId } = this.options;
    const requestHash = hashRniModelInput({ ...request, environment, actorId });
    return withTransaction(async (db) => {
      // Same lock order as PostgresRniOrchestrationStore. Never take the job row first.
      await db.query("select pg_advisory_xact_lock(hashtextextended('rni-ai-budget:' || $1, 0))", [
        environment,
      ]);
      await db.query(
        "select pg_advisory_xact_lock(hashtextextended('rni-orchestration:' || $1, 0))",
        [environment],
      );
      const replay = await db.query<{ object_id: string; after_value: unknown }>(
        `select object_id,after_value from audit_event where environment=$1 and request_id=$2
         and object_type='rni_schedule_setting' and action='update'`,
        [environment, request.idempotencyKey],
      );
      if (replay.rows.length) {
        const saved = receipt.safeParse(replay.rows[0]!.after_value);
        if (replay.rows.length !== 1 || !saved.success)
          throw new RniScheduleSettingsError('unavailable');
        if (saved.data.requestHash !== requestHash) throw new RniScheduleSettingsError('conflict');
        const { result } = saved.data;
        if (
          result.idempotencyKey !== request.idempotencyKey ||
          result.setting.jobId !== replay.rows[0]!.object_id ||
          result.setting.version !== request.expectedVersion + 1 ||
          result.setting.enabled !== request.enabled ||
          result.setting.scheduleType !== request.scheduleType ||
          result.setting.scheduleExpression !== request.scheduleExpression ||
          result.setting.displayTimezone !== request.displayTimezone
        )
          throw new RniScheduleSettingsError('unavailable');
        return { ...saved.data.result, disposition: 'duplicate' as const };
      }
      const previous = await definition(environment, db, true);
      if (previous.version !== request.expectedVersion)
        throw new RniScheduleSettingsError('conflict');
      const now = await transactionTime(db);
      const cadence = {
        scheduleType: request.scheduleType,
        scheduleExpression: request.scheduleExpression,
        displayTimezone: request.displayTimezone,
      };
      const nextDueAt = validateScheduleCadence(cadence, now)[0]!.dueAt;
      const updated = await db.query(
        `update job_definition set enabled=$3,schedule_type=$4,schedule_expression=$5,
           display_timezone=$6,next_due_at=$7,version=version+1,updated_by=$8,updated_at=$9
         where id=$1 and version=$2 returning id`,
        [
          previous.id,
          request.expectedVersion,
          request.enabled,
          request.scheduleType,
          request.scheduleExpression,
          request.displayTimezone,
          nextDueAt,
          actorId,
          now,
        ],
      );
      if (updated.rowCount !== 1) throw new RniScheduleSettingsError('conflict');
      const result = scheduleUpdateResult.parse({
        disposition: 'accepted',
        idempotencyKey: request.idempotencyKey,
        setting: setting(await definition(environment, db), now),
      });
      await db.query(
        `insert into audit_event (actor_id,actor_role,action,object_type,object_id,environment,
           reason,before_value,after_value,result,request_id,correlation_id)
         values ($1,'admin','update','rni_schedule_setting',$2,$3,$4,$5::jsonb,$6::jsonb,'success',$7,$7)`,
        [
          actorId,
          previous.id,
          environment,
          request.reason,
          JSON.stringify({
            version: previous.version,
            enabled: previous.enabled,
            scheduleType: previous.scheduleType,
            scheduleExpression: previous.scheduleExpression,
            displayTimezone: previous.displayTimezone,
            nextDueAt: previous.nextDueAt.toISOString(),
          }),
          JSON.stringify({ requestHash, result }),
          request.idempotencyKey,
        ],
      );
      return result;
    }, this.pool);
  }
}
