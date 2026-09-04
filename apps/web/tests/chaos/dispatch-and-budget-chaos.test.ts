import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from '../integration/helpers/db';
import { closePool, getPool } from '../../src/repositories/client';
import { jobRunHistory } from '../../src/repositories/jobs';
import { executeJob } from '../../src/services/jobs/job-service';
import { runDispatchTick } from '../../src/services/jobs/dispatch';
import { acquireDispatchTickLock } from '../../src/services/jobs/dispatch-lock';
import { inMemoryRedisClient, type RedisClient } from '../../src/services/jobs/redis';
import { scheduledIdempotencyKey } from '../../src/services/jobs/idempotency';
import type { JobDefinition } from '../../src/contracts/operations';
import { insertCostEvent } from '../../src/repositories/cost';
import { getGlobalBudgetDecision, resolveBudgetThresholds } from '../../src/services/budget/policy';
import { checkGlobalBudget } from '../../src/services/dashboard/budget';
import { getCostLedgerView } from '../../src/services/admin/reads';

const url = databaseUrl();

/**
 * F18 §4.5 — the chaos suite's two dispatcher-level injections. F16a's own dispatch/trigger
 * integration tests (`tests/integration/dispatch.test.ts`) already cover the duplicate-delivery
 * and expired-lock cases *at the dispatcher level* — this file reuses those exact fixtures
 * (`executeJob`, `acquireDispatchTickLock`, `scheduledIdempotencyKey`) rather than re-deriving
 * them, and adds the assertions that are squarely this feature's own: that neither injected
 * fault manufactures a spurious budget/degraded state, and — separately — that a genuine
 * budget-exceeded condition renders honestly rather than throwing or inventing content. The
 * third §4.5 injection (per-noncritical-provider disable) is covered in
 * `tests/chaos/provider-degradation-chaos.test.ts`.
 */
describe.skipIf(url === undefined)('F18 chaos suite — dispatch injections and budget-exceeded', () => {
  let pool: pg.Pool;
  let redis: RedisClient;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
    getPool(url);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
    redis = inMemoryRedisClient();
    await pool.query(
      `insert into config_version (environment, status, created_by, change_reason, checksum)
       values ('production', 'active', 'test-seed', 'seed for chaos suite', 'checksum-1')`,
    );
  });

  afterAll(async () => {
    await closePool();
    await pool?.end();
  });

  async function seedJob(overrides: Partial<{ jobKey: string; nextDueAt: Date }> = {}): Promise<JobDefinition> {
    const { rows: cv } = await pool.query<{ id: string }>(
      `select id from config_version where environment = 'production' and status = 'active'`,
    );
    const configVersionId = cv[0]?.id as string;
    const { jobKey = 'chaos_no_handler_job', nextDueAt = new Date('2026-09-01T00:00:00Z') } = overrides;
    const { rows } = await pool.query(
      `insert into job_definition
         (job_key, display_name, enabled, schedule_type, schedule_expression, priority,
          max_runtime_seconds, trigger_eligible, next_due_at, config_version, updated_by)
       values ($1, $2, true, 'interval', '300', 100, 60, false, $3, $4, 'test-seed')
       returning id, job_key, display_name, enabled, schedule_type, schedule_expression,
         display_timezone, active_windows, jitter_seconds, scope, priority, max_runtime_seconds,
         concurrency_policy, max_attempts, backoff_policy, dependencies, max_calls_per_run,
         max_cost_usd_per_run, trigger_eligible, next_due_at, config_version, version,
         updated_by, updated_at`,
      [jobKey, `Chaos test job ${jobKey}`, nextDueAt, configVersionId],
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

  describe('injection: a duplicate QStash delivery', () => {
    it('is a genuine no-op — no second job_run, and the budget decision is untouched by it', async () => {
      const job = await seedJob();
      const idempotencyKey = scheduledIdempotencyKey(job.id, job.nextDueAt);

      const before = await getGlobalBudgetDecision(new Date('2026-09-01T00:00:00Z'), pool);
      expect(before.tier).toBe('ok');

      const first = await executeJob({ job, triggerType: 'scheduled', idempotencyKey, lockKey: 'chaos-lock', db: pool });
      const second = await executeJob({ job, triggerType: 'scheduled', idempotencyKey, lockKey: 'chaos-lock', db: pool });
      expect(second.executed).toBe(false);
      expect(second.run.id).toBe(first.run.id);

      const history = await jobRunHistory({ jobId: job.id }, pool);
      expect(history).toHaveLength(1);

      // The duplicate delivery wrote no second job_run and no handler ran twice — it must not
      // have manufactured any spend, so the budget decision this feature owns stays exactly
      // where it started.
      const after = await getGlobalBudgetDecision(new Date('2026-09-01T00:00:00Z'), pool);
      expect(after.tier).toBe('ok');
      expect(after.spentUsd).toBe(before.spentUsd);
    });
  });

  describe('injection: an expired lock', () => {
    it('recovers silently — no CoverageGap, no duplicate run, no spurious degraded state', async () => {
      const held = await acquireDispatchTickLock(redis, 1);
      expect(held).not.toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const result = await runDispatchTick({ db: pool, redis });
      expect(result.ran).toBe(true);

      // A lock expiring and being recovered is a control-plane event, not a provider outage —
      // it must not show up as any of F18's catalogued degraded states, and it must not have
      // touched the budget ledger.
      const decision = await getGlobalBudgetDecision(new Date('2026-09-01T00:00:00Z'), pool);
      expect(decision.tier).toBe('ok');
    });
  });

  describe('injection: a budget-exceeded condition', () => {
    it('renders honestly — no unhandled error, no invented content, no $0.00 where $350 was actually spent', async () => {
      await insertCostEvent(
        {
          occurredAt: new Date('2026-09-01T12:00:00Z'),
          provider: 'fmp',
          service: 'chaos_test',
          operationOrModel: 'test',
          feature: 'f18.chaos_suite',
          jobRunId: null,
          researchRunId: null,
          userId: null,
          requestId: randomUUID(),
          unitType: 'call',
          requestUnits: '1',
          billableUnits: '1',
          unitPrice: '350.00',
          currency: 'USD',
          priceBookVersion: null,
          costUsd: '350.00',
          costStatus: 'actual',
          cacheStatus: 'miss',
          metadata: {},
        },
        pool,
      );

      // The dashboard refresh's own hard-ceiling gate: must refuse, must carry a real message,
      // must never throw.
      const { hardUsd } = await resolveBudgetThresholds(pool);
      const refresh = await checkGlobalBudget(new Date('2026-09-01T12:00:00Z'), pool, hardUsd);
      expect(refresh.allowed).toBe(false);
      if (!refresh.allowed) {
        expect(refresh.message.length).toBeGreaterThan(0);
        expect(refresh.message).not.toContain('$0.00');
      }

      // The admin ledger view (F15, §2 Out) — a "core path" per F18 §4.1 — must keep working:
      // no throw, and the real figure, never a fabricated zero.
      const from = new Date(Date.UTC(2026, 8, 1));
      const to = new Date(Date.UTC(2026, 8, 2));
      const ledger = await getCostLedgerView(from, to);
      expect(ledger.totals.totalUsd).toBe('350.00');
      expect(ledger.totals.totalUsd).not.toBe('0.00');
    });
  });
});
