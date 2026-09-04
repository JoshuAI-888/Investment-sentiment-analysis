/**
 * F16 §4.4/§5 — "every job supports a dry run that makes zero external calls" (Integration test
 * plan row), proven at the *admin* layer this feature adds (`services/admin/job-dry-run.ts`), not
 * only at F16a's own `executeJob` layer (`tests/integration/dispatch.test.ts` already covers
 * that). Seeds a job whose `job_key` is `market_data_poll` — a real entry in `job-service.ts`'s
 * own `DISPATCH_TABLE`, wired to a real collector that would make real HTTP calls if it were ever
 * actually invoked — specifically so this test is not vacuous against a job with no handler at
 * all. `PROVIDER_MODE` is left at whatever the test environment default is (fixture); if the dry
 * run's own short-circuit ever regressed and the handler *were* called, a fixture-mode adapter
 * would still not error, so the load-bearing assertions here are the *counters* (`providerCalls`,
 * `itemsRead`, `itemsWritten`, `estimatedCostUsd`) and the absence of any `raw_provider_payload`/
 * `provider_call_log` row — not merely "the call didn't throw".
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import { closePool, getPool } from '../../src/repositories/client';
import { insertConfigVersion, activateConfigVersion } from '../../src/repositories/versions';
import { runJobDryRun } from '../../src/services/admin/job-dry-run';
import { listAuditEvents } from '../../src/repositories/audit';
import type { Session } from '../../src/services/auth';

const url = databaseUrl();

const SESSION: Session = {
  userId: 'admin-dry-run-test',
  email: 'admin@example.com',
  sessionId: 'sess-1',
  expiresAt: new Date().toISOString(),
  mustChangePassword: false,
};

const AUDIT = {
  actorId: 'owner',
  actorRole: 'admin',
  reason: 'bootstrap',
  requestId: 'r',
  correlationId: 'c',
};

describe.skipIf(url === undefined)('F16b — admin dry run makes zero external calls', () => {
  let pool: pg.Pool;
  let configVersionId: string;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
    getPool(url);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
    const draft = await insertConfigVersion(
      { environment: 'production', createdBy: 'owner', changeReason: 'bootstrap', checksum: `sum-${randomUUID()}` },
      pool,
    );
    const activated = await activateConfigVersion('production', draft.id, AUDIT);
    configVersionId = activated.id;
  });

  afterAll(async () => {
    await closePool();
    await pool?.end();
  });

  async function seedJob(jobKey: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `insert into job_definition
         (job_key, display_name, enabled, schedule_type, schedule_expression, priority,
          max_runtime_seconds, trigger_eligible, next_due_at, config_version, updated_by)
       values ($1, $2, true, 'interval', '300', 100, 60, false, now(), $3, 'test-seed')
       returning id`,
      [jobKey, `Test ${jobKey}`, configVersionId],
    );
    return rows[0]?.id as string;
  }

  it('a dry run of a job with a real dispatch handler (market_data_poll) never invokes it', async () => {
    const jobId = await seedJob('market_data_poll');

    const result = await runJobDryRun(jobId, SESSION, 'proving zero external calls');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.run.dryRun).toBe(true);
    expect(result.run.triggerType).toBe('manual');
    expect(result.run.status).toBe('skipped');
    expect(result.run.providerCalls).toBe(0);
    expect(result.run.itemsRead).toBe(0);
    expect(result.run.itemsWritten).toBe(0);
    expect(result.run.estimatedCostUsd).toBe('0');

    // Nothing that a real market-data collector call would leave behind exists.
    const { rows: payloadRows } = await pool.query('select count(*)::text as count from raw_provider_payload');
    expect(payloadRows[0]?.count).toBe('0');
    const { rows: callLogRows } = await pool.query('select count(*)::text as count from provider_call_log');
    expect(callLogRows[0]?.count).toBe('0');
  });

  it('audits the dry run even though it is not a versioned mutation', async () => {
    const jobId = await seedJob('attention_poll');

    const result = await runJobDryRun(jobId, SESSION, 'checking what attention_poll would do');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const events = await listAuditEvents({ objectType: 'job_definition' });
    const dryRunEvent = events.find((e) => e.action === 'job.dry_run');
    expect(dryRunEvent).toBeDefined();
    expect(dryRunEvent?.result).toBe('success');
    expect(dryRunEvent?.actorId).toBe(SESSION.userId);
    expect(dryRunEvent?.reason).toBe('checking what attention_poll would do');
  });

  it('two distinct dry-run requests for the same job produce two distinct job_run rows, not a deduplicated one', async () => {
    const jobId = await seedJob('market_data_poll');

    const first = await runJobDryRun(jobId, SESSION, 'first dry run');
    const second = await runJobDryRun(jobId, SESSION, 'second dry run');
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.run.id).not.toBe(second.run.id);
    const { rows } = await pool.query<{ count: string }>(
      'select count(*)::text as count from job_run where job_id = $1',
      [jobId],
    );
    expect(rows[0]?.count).toBe('2');
  });

  it('returns not_found for a job id that does not exist, without writing anything', async () => {
    const result = await runJobDryRun('00000000-0000-0000-0000-000000000000', SESSION, 'nonexistent job');
    expect(result).toEqual({ ok: false, reason: 'not_found' });

    const { rows } = await pool.query<{ count: string }>('select count(*)::text as count from job_run');
    expect(rows[0]?.count).toBe('0');
  });
});
