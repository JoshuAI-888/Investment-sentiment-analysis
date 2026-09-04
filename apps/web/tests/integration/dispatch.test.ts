import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import { closePool, getPool } from '../../src/repositories/client';
import { findJobRunById, jobRunHistory } from '../../src/repositories/jobs';
import { executeJob } from '../../src/services/jobs/job-service';
import { runDispatchTick } from '../../src/services/jobs/dispatch';
import { acquireDispatchTickLock } from '../../src/services/jobs/dispatch-lock';
import { KEYS } from '../../src/services/jobs/redis';
import { inMemoryRedisClient, type RedisClient } from '../../src/services/jobs/redis';
import { scheduledIdempotencyKey } from '../../src/services/jobs/idempotency';
import type { JobDefinition } from '../../src/contracts/operations';

const url = databaseUrl();

/**
 * F16 §5/§6 — the dispatch core's own test plan: duplicate delivery is a no-op, a held lock
 * prevents overlap, an expired lock recovers, manual and scheduled execute identical code, and a
 * dry run makes zero external calls. `market_data_poll`/`attention_poll` aren't dispatched here
 * against real providers — that would need live FMP/ApeWisdom fixtures and is exactly what
 * `services/market/collector.ts`'s and `services/attention/collector.ts`'s own test suites
 * already cover. What is new here is the layer on top: claim → start → finish → schedule
 * advance, and the lock around the whole tick — proven with a job whose `job_key` has no real
 * dispatch handler (a deliberate, honestly-labelled `no_handler` case), which exercises every
 * layer of `JobService.execute` without needing a live provider at all.
 */
describe.skipIf(url === undefined)('F16a dispatch core', () => {
  let pool: pg.Pool;
  let configVersionId: string;
  let redis: RedisClient;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
    getPool(url);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
    redis = inMemoryRedisClient();
    const { rows } = await pool.query<{ id: string }>(
      `insert into config_version (environment, status, created_by, change_reason, checksum)
       values ('production', 'active', 'test-seed', 'seed for dispatch.test.ts', 'checksum-1')
       returning id`,
    );
    configVersionId = rows[0]?.id as string;
  });

  afterAll(async () => {
    await closePool();
    await pool?.end();
  });

  async function seedJob(overrides: Partial<{
    jobKey: string;
    enabled: boolean;
    nextDueAt: Date;
    scheduleExpression: string;
  }> = {}): Promise<JobDefinition> {
    const {
      jobKey = 'no_handler_job',
      enabled = true,
      nextDueAt = new Date('2026-09-01T00:00:00Z'),
      scheduleExpression = '300',
    } = overrides;
    const { rows } = await pool.query(
      `insert into job_definition
         (job_key, display_name, enabled, schedule_type, schedule_expression, priority,
          max_runtime_seconds, trigger_eligible, next_due_at, config_version, updated_by)
       values ($1, $2, $3, 'interval', $4, 100, 60, false, $5, $6, 'test-seed')
       returning id, job_key, display_name, enabled, schedule_type, schedule_expression,
         display_timezone, active_windows, jitter_seconds, scope, priority, max_runtime_seconds,
         concurrency_policy, max_attempts, backoff_policy, dependencies, max_calls_per_run,
         max_cost_usd_per_run, trigger_eligible, next_due_at, config_version, version,
         updated_by, updated_at`,
      [jobKey, `Test job ${jobKey}`, enabled, scheduleExpression, nextDueAt, configVersionId],
    );
    const row = rows[0] as Record<string, unknown>;
    return {
      id: row.id as string,
      jobKey: row.job_key as string,
      displayName: row.display_name as string,
      enabled: row.enabled as boolean,
      scheduleType: row.schedule_type as JobDefinition['scheduleType'],
      scheduleExpression: row.schedule_expression as string,
      displayTimezone: row.display_timezone as string,
      activeWindows: row.active_windows,
      jitterSeconds: row.jitter_seconds as number,
      scope: row.scope,
      priority: row.priority as number,
      maxRuntimeSeconds: row.max_runtime_seconds as number,
      concurrencyPolicy: row.concurrency_policy as JobDefinition['concurrencyPolicy'],
      maxAttempts: row.max_attempts as number,
      backoffPolicy: row.backoff_policy,
      dependencies: row.dependencies,
      maxCallsPerRun: row.max_calls_per_run as number | null,
      maxCostUsdPerRun: row.max_cost_usd_per_run as string | null,
      triggerEligible: row.trigger_eligible as boolean,
      nextDueAt: row.next_due_at as Date,
      configVersion: row.config_version as string,
      version: row.version as number,
      updatedBy: row.updated_by as string,
      updatedAt: row.updated_at as Date,
    };
  }

  describe('idempotency — duplicate delivery of the same (job_id, due_at)', () => {
    it('claims once and is a no-op on the second delivery', async () => {
      const job = await seedJob();
      const idempotencyKey = scheduledIdempotencyKey(job.id, job.nextDueAt);

      const first = await executeJob({ job, triggerType: 'scheduled', idempotencyKey, lockKey: 'test-lock', db: pool });
      expect(first.executed).toBe(true);

      const second = await executeJob({ job, triggerType: 'scheduled', idempotencyKey, lockKey: 'test-lock', db: pool });
      expect(second.executed).toBe(false);
      expect(second.run.id).toBe(first.run.id);

      const history = await jobRunHistory({ jobId: job.id }, pool);
      expect(history).toHaveLength(1);
    });

    it('the triple-replay case: three concurrent deliveries produce exactly one execution', async () => {
      const job = await seedJob();
      const idempotencyKey = scheduledIdempotencyKey(job.id, job.nextDueAt);

      const results = await Promise.all(
        Array.from({ length: 3 }, () =>
          executeJob({ job, triggerType: 'scheduled', idempotencyKey, lockKey: 'test-lock', db: pool }),
        ),
      );

      const executedCount = results.filter((r) => r.executed).length;
      expect(executedCount).toBe(1);

      const history = await jobRunHistory({ jobId: job.id }, pool);
      expect(history).toHaveLength(1);
    });
  });

  describe('the dispatch-tick lock', () => {
    it('a held lock prevents a second concurrent tick from running at all', async () => {
      const held = await acquireDispatchTickLock(redis);
      expect(held).not.toBeNull();

      const result = await runDispatchTick({ db: pool, redis });
      expect(result.ran).toBe(false);
      if (!result.ran) expect(result.reason).toBe('locked');

      await held?.release();
    });

    it('an expired lock allows the next tick to recover', async () => {
      const held = await acquireDispatchTickLock(redis, 1);
      expect(held).not.toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const result = await runDispatchTick({ db: pool, redis });
      expect(result.ran).toBe(true);
    });

    it('is released after a normal tick completes, so the next tick is never blocked by a healthy prior one', async () => {
      await seedJob({ jobKey: 'released_lock_job', nextDueAt: new Date('2026-09-01T00:00:00Z') });
      const first = await runDispatchTick({ db: pool, redis, now: new Date('2026-09-01T00:05:00Z') });
      expect(first.ran).toBe(true);

      const secondLock = await acquireDispatchTickLock(redis);
      expect(secondLock).not.toBeNull();
      await secondLock?.release();
    });
  });

  describe('manual and scheduled paths execute the identical code', () => {
    it('produces the same handler outcome shape and job_run lifecycle regardless of triggerType', async () => {
      const scheduledJob = await seedJob({ jobKey: 'no_handler_scheduled' });
      const manualJob = await seedJob({ jobKey: 'no_handler_manual' });

      const scheduled = await executeJob({
        job: scheduledJob,
        triggerType: 'scheduled',
        idempotencyKey: scheduledIdempotencyKey(scheduledJob.id, scheduledJob.nextDueAt),
        lockKey: 'test-lock',
        db: pool,
      });
      const manual = await executeJob({
        job: manualJob,
        triggerType: 'manual',
        idempotencyKey: `manual:${manualJob.id}:${new Date().toISOString()}`,
        lockKey: 'test-lock',
        requestedBy: 'operator@example.com',
        db: pool,
      });

      // Both fail identically (no dispatch handler registered for `no_handler_*`) — the point is
      // that the *shape* of the outcome (both terminal, both `failed`, for the identical reason)
      // does not depend on which trigger type drove the call, only on the handler itself.
      expect(scheduled.run.status).toBe('failed');
      expect(manual.run.status).toBe('failed');
      expect(scheduled.run.triggerType).toBe('scheduled');
      expect(manual.run.triggerType).toBe('manual');
      expect(manual.run.requestedBy).toBe('operator@example.com');

      // Only the scheduled run advances its own job's schedule (job-service.ts's own documented
      // scoping) — a manual run must not desynchronise the clock cadence.
      const advancedScheduled = await pool.query<{ next_due_at: Date }>(
        'select next_due_at from job_definition where id = $1',
        [scheduledJob.id],
      );
      expect(new Date(advancedScheduled.rows[0]?.next_due_at as Date).getTime()).toBeGreaterThan(
        scheduledJob.nextDueAt.getTime(),
      );
      const unadvancedManual = await pool.query<{ next_due_at: Date }>(
        'select next_due_at from job_definition where id = $1',
        [manualJob.id],
      );
      expect(new Date(unadvancedManual.rows[0]?.next_due_at as Date).getTime()).toBe(
        manualJob.nextDueAt.getTime(),
      );
    });
  });

  describe('dry run', () => {
    it('finishes as skipped with zero items/provider calls — the handler is never invoked', async () => {
      const job = await seedJob({ jobKey: 'no_handler_dry_run' });
      const result = await executeJob({
        job,
        triggerType: 'manual',
        idempotencyKey: `manual:${job.id}:dry`,
        lockKey: 'test-lock',
        dryRun: true,
        db: pool,
      });

      expect(result.executed).toBe(true);
      expect(result.run.status).toBe('skipped');
      expect(result.run.itemsRead).toBe(0);
      expect(result.run.itemsWritten).toBe(0);
      expect(result.run.providerCalls).toBe(0);
      expect(result.run.dryRun).toBe(true);

      const reloaded = await findJobRunById(result.run.id, pool);
      expect(reloaded?.status).toBe('skipped');
    });
  });

  describe('lock release on every exit path', () => {
    it('releases the lock even when a due job throws', async () => {
      await seedJob({ jobKey: 'no_handler_throws', nextDueAt: new Date('2026-09-01T00:00:00Z') });
      const result = await runDispatchTick({ db: pool, redis, now: new Date('2026-09-01T00:05:00Z') });
      expect(result.ran).toBe(true);

      // The lock must be free again immediately after — a failing job inside the tick must not
      // strand the lock (§4.1 step 7).
      const reacquired = await acquireDispatchTickLock(redis);
      expect(reacquired).not.toBeNull();
      await reacquired?.release();
    });
  });

  it('KEYS.dispatchTickLock is a stable, single key for the whole tick', () => {
    expect(KEYS.dispatchTickLock()).toBe('jobs:dispatch:tick:lock');
  });
});
