import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import { closePool, getPool } from '../../src/repositories/client';
import { executeJob } from '../../src/services/jobs/job-service';
import { checkDispatchHeartbeat } from '../../src/services/jobs/heartbeat';
import { scheduledIdempotencyKey } from '../../src/services/jobs/idempotency';
import type { JobDefinition } from '../../src/contracts/operations';

const url = databaseUrl();

/** F16 §4.5 / §6's heartbeat DoD item — "alerts on staleness ... deployed in Wave 1." */
describe.skipIf(url === undefined)('F16a heartbeat', () => {
  let pool: pg.Pool;
  let configVersionId: string;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
    getPool(url);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
    const { rows } = await pool.query<{ id: string }>(
      `insert into config_version (environment, status, created_by, change_reason, checksum)
       values ('production', 'active', 'test-seed', 'seed for heartbeat.test.ts', 'checksum-1')
       returning id`,
    );
    configVersionId = rows[0]?.id as string;
  });

  afterAll(async () => {
    await closePool();
    await pool?.end();
  });

  it('reports stale when no job has ever succeeded', async () => {
    const check = await checkDispatchHeartbeat(pool, new Date());
    expect(check.stale).toBe(true);
    expect(check.lastSuccessAt).toBeNull();
  });

  it('reports healthy immediately after a successful run, and stale once the threshold has passed', async () => {
    const { rows } = await pool.query<{ id: string }>(
      `insert into job_definition
         (job_key, display_name, enabled, schedule_type, schedule_expression, priority,
          max_runtime_seconds, trigger_eligible, next_due_at, config_version, updated_by)
       values ('no_handler_heartbeat', 'Test job', true, 'interval', '300', 100, 60, false,
         $1, $2, 'test-seed')
       returning id`,
      [new Date('2026-09-01T00:00:00Z'), configVersionId],
    );
    const jobId = rows[0]?.id as string;

    // This job has no dispatch handler, so it will finish 'failed', not 'succeeded' — heartbeat
    // must not count that as healthy. Manufacture a genuinely succeeded run directly instead,
    // the same way `finishJobRun`'s own contract test does, so this test exercises the read
    // path (`mostRecentJobRun({statuses:['succeeded']})`) rather than a real collector.
    const job: JobDefinition = {
      id: jobId,
      jobKey: 'no_handler_heartbeat',
      displayName: 'Test job',
      enabled: true,
      scheduleType: 'interval',
      scheduleExpression: '300',
      displayTimezone: 'UTC',
      activeWindows: [],
      jitterSeconds: 0,
      scope: {},
      priority: 100,
      maxRuntimeSeconds: 60,
      concurrencyPolicy: 'skip',
      maxAttempts: 3,
      backoffPolicy: {},
      dependencies: [],
      maxCallsPerRun: null,
      maxCostUsdPerRun: null,
      triggerEligible: false,
      nextDueAt: new Date('2026-09-01T00:00:00Z'),
      configVersion: configVersionId,
      version: 1,
      updatedBy: 'test',
      updatedAt: new Date('2026-09-01T00:00:00Z'),
    };
    await executeJob({
      job,
      triggerType: 'manual',
      idempotencyKey: scheduledIdempotencyKey(jobId, job.nextDueAt),
      lockKey: 'test-lock',
      db: pool,
    });
    // Force it to 'succeeded' directly against the row this run created — this test's own
    // concern is the heartbeat's read, not producing a real successful collector run.
    await pool.query("update job_run set status = 'succeeded' where job_id = $1", [jobId]);
    const runRow = await pool.query<{ id: string; completed_at: Date }>(
      'select id, completed_at from job_run where job_id = $1',
      [jobId],
    );
    const completedAt = runRow.rows[0]?.completed_at as Date;

    const healthy = await checkDispatchHeartbeat(pool, new Date(completedAt.getTime() + 5 * 60_000), 20);
    expect(healthy.stale).toBe(false);

    const stale = await checkDispatchHeartbeat(pool, new Date(completedAt.getTime() + 25 * 60_000), 20);
    expect(stale.stale).toBe(true);
  });
});
