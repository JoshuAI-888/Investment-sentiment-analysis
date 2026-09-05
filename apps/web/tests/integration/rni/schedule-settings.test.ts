import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { databaseUrl, makePool, resetSchema, truncateAll } from '../helpers/db';
import { PostgresRniScheduleSettingsService } from '../../../src/rni/settings/schedule/repositories/store';
import type { ScheduleUpdateRequest } from '../../../src/rni/settings/schedule/schemas';
import { PostgresRniOrchestrationStore } from '../../../src/rni/repositories/orchestration';
import { RniRefreshService } from '../../../src/rni/orchestration/refresh';

describe.skipIf(!databaseUrl())('PostgreSQL admin schedule settings', () => {
  let pool: pg.Pool;
  let configId: string;
  let scheduledId: string;
  let manualId: string;
  const dueAt = '2020-01-01T00:00:00.000Z';
  const service = (environment = 'test', actorId = 'admin') =>
    new PostgresRniScheduleSettingsService({ environment, actorId, pool });
  const request = (patch: Partial<ScheduleUpdateRequest> = {}): ScheduleUpdateRequest => ({
    expectedVersion: 1,
    enabled: true,
    scheduleType: 'interval',
    scheduleExpression: '7200',
    displayTimezone: 'Pacific/Auckland',
    reason: 'Change future cadence',
    idempotencyKey: randomUUID(),
    ...patch,
  });
  const snapshot = async () =>
    (await pool.query('select to_jsonb(j) as row from job_definition j order by job_key')).rows;
  const audits = async () =>
    (
      await pool.query(
        "select * from audit_event where object_type='rni_schedule_setting' order by occurred_at",
      )
    ).rows;
  const refresh = (store = new PostgresRniOrchestrationStore(pool)) =>
    new RniRefreshService({
      store,
      partition: 'test',
      actor: 'scheduler',
      manualJobId: manualId,
      now: () => new Date(),
      newId: randomUUID,
      authorize: async () => {},
    });

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
  }, 60_000);
  beforeEach(async () => {
    await truncateAll(pool);
    configId = (
      await pool.query<{ id: string }>(`insert into config_version
      (environment,status,created_by,change_reason,checksum) values ('test','draft','admin','isolated scheduling fixture','fixture') returning id::text`)
    ).rows[0]!.id;
    const definitions = await pool.query<{ id: string; job_key: string }>(
      `insert into job_definition
      (job_key,display_name,schedule_type,schedule_expression,scope,max_runtime_seconds,concurrency_policy,
       max_calls_per_run,max_cost_usd_per_run,trigger_eligible,next_due_at,config_version,updated_by)
      values ('rni-scheduled:test','RNI schedule','interval','3600','{"kind":"full_universe"}',900,'skip',200,25,true,$1,$2,'seed'),
             ('rni-manual:test','RNI manual','interval','31536000','{}',900,'skip',200,25,false,$1,$2,'seed') returning id,job_key`,
      [dueAt, configId],
    );
    scheduledId = definitions.rows.find((v) => v.job_key === 'rni-scheduled:test')!.id;
    manualId = definitions.rows.find((v) => v.job_key === 'rni-manual:test')!.id;
    // Real operational queued/running/history rows must remain byte-for-byte unchanged on edits.
    for (const status of ['running', 'succeeded'])
      await pool.query(
        `insert into job_run
      (job_id,trigger_type,idempotency_key,config_version,status,lock_key,started_at,completed_at)
      values ($1,'scheduled',$2,$3,$4,$2,now(),case when $4='succeeded' then now() else null end)`,
        [scheduledId, randomUUID(), configId, status],
      );
    await pool.query(
      `with u as (
      insert into universe_version (environment,config_version,status,selected_count,created_by,change_reason)
      values ('test',$1,'draft',100,'admin','Preserved legacy test universe') returning id
    ), r as (
      insert into rni_run (idempotency_key,trigger,status,window_start,window_end,
        universe_version,config_version,prompt_version,ai_route,requested_at,completed_at)
      select gen_random_uuid()::text,'schedule',s.status,'2020-01-01T00:00:00.123456Z'::timestamptz,
        '2020-01-02T00:00:00.123456Z'::timestamptz,u.id,$1,'historical-prompt','openai_direct',
        '2020-01-02T00:00:00.123456Z'::timestamptz,case when s.status='complete' then now() else null end
      from u cross join (values ('running'),('complete')) s(status) returning id,status
    ) insert into rni_platform_slice (run_id,platform,status,coverage_disclosure)
      select r.id,p.platform,r.status,'Historical independent source coverage'
      from r cross join (values ('reddit'),('x')) p(platform)`,
      [configId],
    );
  });
  afterEach(async () => {
    await pool.query('drop trigger if exists schedule_settings_test_failure on audit_event');
  });
  afterAll(async () => {
    await pool?.end();
  });

  it('reads the real persisted due instant, without provisioning or advancing it', async () => {
    const before = await snapshot();
    const read = await service().getCurrentSchedule();
    expect(read).toMatchObject({
      jobId: scheduledId,
      version: 1,
      enabled: true,
      nextDueAt: dueAt,
      scope: { kind: 'full_universe' },
    });
    expect(read.nextRuns[0]!.dueAt).toBe(dueAt);
    expect(read.nextRuns).toHaveLength(5);
    expect(await snapshot()).toEqual(before);
    expect(await audits()).toHaveLength(0);
  });
  it('atomically updates only operational cadence, advances from DB time, and audits the full result', async () => {
    const before = await snapshot();
    const runs = (await pool.query('select to_jsonb(r) as row from job_run r order by id')).rows;
    const rniRuns = (await pool.query('select to_jsonb(r) as row from rni_run r order by id')).rows;
    const slices = (
      await pool.query('select to_jsonb(s) as row from rni_platform_slice s order by id')
    ).rows;
    const input = request();
    const saved = await service().updateSchedule(input);
    expect(saved).toMatchObject({
      disposition: 'accepted',
      idempotencyKey: input.idempotencyKey,
      setting: { version: 2, displayTimezone: 'Pacific/Auckland', scheduleExpression: '7200' },
    });
    expect(Date.parse(saved.setting.nextDueAt) - Date.parse(saved.setting.observedAt)).toBe(
      7_200_000,
    );
    const after = await snapshot();
    const mutable = [
      'enabled',
      'schedule_type',
      'schedule_expression',
      'display_timezone',
      'next_due_at',
      'version',
      'updated_by',
      'updated_at',
    ];
    const immutable = (rows: typeof before) =>
      rows.map(({ row }) =>
        Object.fromEntries(
          Object.entries(row as Record<string, unknown>).filter(([key]) => !mutable.includes(key)),
        ),
      );
    expect(immutable(after)).toEqual(immutable(before));
    expect(after.find((v) => v.row.id === manualId)).toEqual(
      before.find((v) => v.row.id === manualId),
    );
    expect((await pool.query('select to_jsonb(r) as row from job_run r order by id')).rows).toEqual(
      runs,
    );
    expect((await pool.query('select to_jsonb(r) as row from rni_run r order by id')).rows).toEqual(
      rniRuns,
    );
    expect(
      (await pool.query('select to_jsonb(s) as row from rni_platform_slice s order by id')).rows,
    ).toEqual(slices);
    const audit = (await audits())[0]!;
    expect(audit).toMatchObject({
      actor_id: 'admin',
      reason: input.reason,
      object_id: scheduledId,
      request_id: input.idempotencyKey,
    });
    expect(audit.after_value.result).toEqual(saved);
    expect(await audits()).toHaveLength(1);
  });
  it('replays before stale-version checking, including after a later edit', async () => {
    const input = request();
    const first = await service().updateSchedule(input);
    await service().updateSchedule(request({ expectedVersion: 2, enabled: false }));
    const before = await snapshot();
    expect(await service().updateSchedule(input)).toEqual({ ...first, disposition: 'duplicate' });
    expect(await snapshot()).toEqual(before);
    expect(await audits()).toHaveLength(2);
  });
  it('serializes concurrent same-key and different-key edits', async () => {
    const input = request();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => service().updateSchedule(input)),
    );
    expect(results.filter((v) => v.disposition === 'accepted')).toHaveLength(1);
    expect(await audits()).toHaveLength(1);
    const edits = await Promise.allSettled([
      service().updateSchedule(request({ expectedVersion: 2, enabled: false })),
      service().updateSchedule(request({ expectedVersion: 2, scheduleExpression: '10800' })),
    ]);
    expect(edits.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
    expect(edits.filter((v) => v.status === 'rejected')).toHaveLength(1);
    expect(await audits()).toHaveLength(2);
  });
  it('rejects crossed intent or actor reuse, stale edits, missing or foreign definitions without writes', async () => {
    const input = request();
    await service().updateSchedule(input);
    const before = await snapshot();
    await expect(service().updateSchedule({ ...input, reason: 'different' })).rejects.toThrow(
      'conflict',
    );
    await expect(service('test', 'other-admin').updateSchedule(input)).rejects.toThrow('conflict');
    await expect(service().updateSchedule(request())).rejects.toThrow('conflict');
    await expect(service('other').getCurrentSchedule()).rejects.toThrow('unavailable');
    await expect(service('other').updateSchedule(request())).rejects.toThrow('unavailable');
    expect(await snapshot()).toEqual(before);
    expect(await audits()).toHaveLength(1);
    await pool.query("update job_definition set job_key='unrelated-job' where id=$1", [
      scheduledId,
    ]);
    await expect(service().getCurrentSchedule()).rejects.toThrow('unavailable');
  });
  it('fails closed when a matching key points to another environment configuration', async () => {
    await pool.query("update job_definition set job_key='rni-scheduled:other' where id=$1", [
      scheduledId,
    ]);
    await expect(service('other').getCurrentSchedule()).rejects.toThrow('unavailable');
    await expect(service('other').updateSchedule(request())).rejects.toThrow('unavailable');
    expect(await audits()).toHaveLength(0);
  });
  it('rejects invalid cadence before writes and allows correcting an invalid stored cadence', async () => {
    const before = await snapshot();
    for (const patch of [
      { scheduleExpression: '299' },
      { displayTimezone: 'Invalid/Timezone' },
      { scheduleType: 'cron' as const, scheduleExpression: '* * * * *' },
    ])
      await expect(service().updateSchedule(request(patch))).rejects.toThrow('invalid');
    expect(await snapshot()).toEqual(before);
    expect(await audits()).toHaveLength(0);
    await pool.query("update job_definition set schedule_expression='invalid' where id=$1", [
      scheduledId,
    ]);
    await expect(service().getCurrentSchedule()).rejects.toThrow('unavailable');
    expect((await service().updateSchedule(request())).setting.scheduleExpression).toBe('7200');
  });
  it('rolls back the definition and receipt together when audit insertion fails', async () => {
    await pool.query(`create or replace function reject_schedule_settings_test() returns trigger language plpgsql as $$
      begin if new.object_type='rni_schedule_setting' then raise exception 'simulated audit failure'; end if; return new; end $$`);
    await pool.query(
      'create trigger schedule_settings_test_failure before insert on audit_event for each row execute function reject_schedule_settings_test()',
    );
    const before = await snapshot();
    const input = request();
    await expect(service().updateSchedule(input)).rejects.toThrow('simulated audit failure');
    expect(await snapshot()).toEqual(before);
    expect(await audits()).toHaveLength(0);
    await pool.query('drop trigger schedule_settings_test_failure on audit_event');
    expect((await service().updateSchedule(input)).disposition).toBe('accepted');
  });
  it('pauses and resumes strictly forward without restarting existing jobs or permitting an old due fire', async () => {
    const paused = await service().updateSchedule(request({ enabled: false }));
    expect(paused.setting.enabled).toBe(false);
    await expect(refresh().schedule({ jobId: scheduledId, dueAt })).rejects.toThrow('INVALID_PLAN');
    const resumed = await service().updateSchedule(
      request({ expectedVersion: 2, enabled: true, scheduleExpression: '300' }),
    );
    expect(Date.parse(resumed.setting.nextDueAt) - Date.parse(resumed.setting.observedAt)).toBe(
      300_000,
    );
    await expect(refresh().schedule({ jobId: scheduledId, dueAt })).rejects.toThrow('NOT_DUE');
    expect(
      (await pool.query('select count(*)::integer as count from job_run')).rows[0]!.count,
    ).toBe(2);
  });
  it('waits for the budget lock before holding the orchestration or job lock', async () => {
    const blocker = await pool.connect();
    await blocker.query('begin');
    await blocker.query("select pg_advisory_xact_lock(hashtextextended('rni-ai-budget:test',0))");
    let settled = false;
    const pending = service()
      .updateSchedule(request())
      .finally(() => {
        settled = true;
      });
    try {
      await pool.query('select pg_sleep(0.05)');
      const probe = await pool.connect();
      try {
        await probe.query('begin');
        expect(
          (
            await probe.query(
              "select pg_try_advisory_xact_lock(hashtextextended('rni-orchestration:test',0)) as acquired",
            )
          ).rows,
        ).toEqual([{ acquired: true }]);
        expect(
          (
            await probe.query('select id from job_definition where id=$1 for update nowait', [
              scheduledId,
            ])
          ).rowCount,
        ).toBe(1);
        expect(settled).toBe(false);
      } finally {
        await probe.query('rollback');
        probe.release();
      }
    } finally {
      await blocker.query('rollback');
      blocker.release();
    }
    expect((await pending).disposition).toBe('accepted');
  });
  it('serializes an edit behind atomic busy skip/advance and preserves that skip receipt after later edits', async () => {
    const store = new PostgresRniOrchestrationStore(pool);
    let acquired!: () => void;
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scheduler = new RniRefreshService({
      partition: 'test',
      actor: 'scheduler',
      manualJobId: manualId,
      now: () => new Date(),
      newId: randomUUID,
      authorize: async () => {},
      store: {
        transact: (partition, operation) =>
          store.transact(partition, async (tx) => {
            acquired();
            await gate;
            return operation(tx);
          }),
      },
    });
    const fired = scheduler.schedule({ jobId: scheduledId, dueAt });
    await locked;
    const edit = service()
      .updateSchedule(request())
      .then(
        () => 'unexpected',
        (error) => (error as Error).message,
      );
    release();
    const skipped = await fired;
    expect(skipped).toMatchObject({ disposition: 'skipped', reason: 'busy' });
    expect(await edit).toContain('conflict');
    const changed = await service().updateSchedule(request({ expectedVersion: 2 }));
    expect(await refresh().schedule({ jobId: scheduledId, dueAt })).toEqual(skipped);
    expect((await service().getCurrentSchedule()).nextDueAt).toBe(changed.setting.nextDueAt);
    expect(
      (
        await pool.query(
          "select count(*)::integer as count from audit_event where action='schedule_skipped'",
        )
      ).rows[0]!.count,
    ).toBe(1);
    expect(
      (await pool.query('select count(*)::integer as count from job_run')).rows[0]!.count,
    ).toBe(2);
  });
});
