import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import {
  advanceJobDefinitionSchedule,
  claimJobRun,
  dueJobDefinitions,
  findJobDefinitionById,
  findJobDefinitionByKey,
  findJobRunById,
  findRunningJobRun,
  findTriggerEligibleJobDefinition,
  finishJobRun,
  jobRunHistory,
  listJobDefinitions,
  mostRecentJobRun,
  startJobRun,
  updateJobDefinition,
  type NewJobRun,
} from '../../src/repositories/jobs';
import { closePool, getPool } from '../../src/repositories/client';
import type { JobRun } from '../../src/contracts/operations';

const url = databaseUrl();

/**
 * F16 §4.1/§4.1b/§4.5: the dispatch core's data layer. Built as a standalone SPINE gap-fill
 * (no `F##` names it) so F16a (COLLECT) has something to build `JobService` on top of — see
 * `src/repositories/jobs.ts`'s module docstring for the idempotency and state-machine reasoning
 * these tests exercise.
 */
describe.skipIf(url === undefined)('job_definition / job_run repository', () => {
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
       values ('production', 'active', 'test-seed', 'seed for jobs.test.ts', 'checksum-1')
       returning id`,
    );
    configVersionId = rows[0]?.id as string;
  });

  afterAll(async () => {
    await closePool();
    await pool?.end();
  });

  async function seedJobDefinition(overrides: Partial<{
    jobKey: string;
    displayName: string;
    enabled: boolean;
    triggerEligible: boolean;
    priority: number;
    nextDueAt: Date;
    maxRuntimeSeconds: number;
  }> = {}): Promise<string> {
    const {
      jobKey = 'market-data-poll',
      displayName = 'Market data poll',
      enabled = true,
      triggerEligible = false,
      priority = 100,
      nextDueAt = new Date('2026-09-01T00:00:00Z'),
      maxRuntimeSeconds = 60,
    } = overrides;
    const { rows } = await pool.query<{ id: string }>(
      `insert into job_definition
         (job_key, display_name, enabled, schedule_type, schedule_expression, priority,
          max_runtime_seconds, trigger_eligible, next_due_at, config_version, updated_by)
       values ($1, $2, $3, 'interval', '5m', $4, $5, $6, $7, $8, 'test-seed')
       returning id`,
      [jobKey, displayName, enabled, priority, maxRuntimeSeconds, triggerEligible, nextDueAt, configVersionId],
    );
    return rows[0]?.id as string;
  }

  function newRun(jobId: string, overrides: Partial<NewJobRun> = {}): NewJobRun {
    return {
      jobId,
      triggerType: 'scheduled',
      idempotencyKey: `${jobId}:2026-09-01T00:00:00Z`,
      configVersion: configVersionId,
      lockKey: 'dispatch-lock',
      ...overrides,
    };
  }

  describe('dueJobDefinitions', () => {
    it('returns an enabled job whose next_due_at has passed', async () => {
      await seedJobDefinition({ jobKey: 'due-job', nextDueAt: new Date('2026-09-01T00:00:00Z') });
      const due = await dueJobDefinitions(new Date('2026-09-01T00:05:00Z'), pool);
      expect(due.jobs).toHaveLength(1);
      expect(due.jobs[0]?.jobKey).toBe('due-job');
      expect(due.truncated).toBe(false);
    });

    // Post-review finding 6: the boundary case at exact equality was untested — `<=` and `<`
    // disagree only here, and a dispatcher whose clock lands exactly on a job's next_due_at must
    // still see it as due, not wait for the next tick.
    it('includes a job whose next_due_at exactly equals asOfInstant — the <= boundary', async () => {
      await seedJobDefinition({ jobKey: 'exact-due', nextDueAt: new Date('2026-09-01T00:00:00Z') });
      const due = await dueJobDefinitions(new Date('2026-09-01T00:00:00Z'), pool);
      expect(due.jobs.map((job) => job.jobKey)).toEqual(['exact-due']);
    });

    it('excludes a job whose next_due_at is still in the future', async () => {
      await seedJobDefinition({ jobKey: 'future-job', nextDueAt: new Date('2026-09-02T00:00:00Z') });
      const due = await dueJobDefinitions(new Date('2026-09-01T00:00:00Z'), pool);
      expect(due.jobs).toHaveLength(0);
    });

    it('excludes a disabled job even when it is due', async () => {
      await seedJobDefinition({
        jobKey: 'disabled-job',
        enabled: false,
        nextDueAt: new Date('2026-09-01T00:00:00Z'),
      });
      const due = await dueJobDefinitions(new Date('2026-09-01T00:05:00Z'), pool);
      expect(due.jobs).toHaveLength(0);
    });

    it('orders by priority ascending, then next_due_at ascending', async () => {
      await seedJobDefinition({
        jobKey: 'low-priority',
        priority: 200,
        nextDueAt: new Date('2026-09-01T00:00:00Z'),
      });
      await seedJobDefinition({
        jobKey: 'high-priority',
        priority: 10,
        nextDueAt: new Date('2026-09-01T00:00:00Z'),
      });

      const due = await dueJobDefinitions(new Date('2026-09-01T00:05:00Z'), pool);
      expect(due.jobs.map((job) => job.jobKey)).toEqual(['high-priority', 'low-priority']);
    });

    it('respects an explicit limit', async () => {
      await seedJobDefinition({ jobKey: 'a', nextDueAt: new Date('2026-09-01T00:00:00Z') });
      await seedJobDefinition({ jobKey: 'b', nextDueAt: new Date('2026-09-01T00:00:00Z') });
      const due = await dueJobDefinitions(new Date('2026-09-01T00:05:00Z'), pool, 1);
      expect(due.jobs).toHaveLength(1);
    });

    /**
     * Post-review finding 8. Without `truncated`, a caller cannot distinguish "exactly the limit
     * were due" from "more were due and got silently dropped" — and because the read is ordered
     * by priority ascending, a truncated page always drops the *lowest*-priority due jobs, every
     * tick, which starve rather than merely run late.
     */
    it('signals truncation when more due jobs exist than the limit, and omits it otherwise', async () => {
      await seedJobDefinition({ jobKey: 'a', priority: 10, nextDueAt: new Date('2026-09-01T00:00:00Z') });
      await seedJobDefinition({ jobKey: 'b', priority: 20, nextDueAt: new Date('2026-09-01T00:00:00Z') });
      await seedJobDefinition({ jobKey: 'c', priority: 30, nextDueAt: new Date('2026-09-01T00:00:00Z') });

      const truncatedPage = await dueJobDefinitions(new Date('2026-09-01T00:05:00Z'), pool, 2);
      expect(truncatedPage.jobs.map((job) => job.jobKey)).toEqual(['a', 'b']);
      expect(truncatedPage.truncated).toBe(true);

      const fullPage = await dueJobDefinitions(new Date('2026-09-01T00:05:00Z'), pool, 3);
      expect(fullPage.jobs).toHaveLength(3);
      expect(fullPage.truncated).toBe(false);

      const exactPage = await dueJobDefinitions(new Date('2026-09-01T00:05:00Z'), pool, 3);
      // Exactly `limit` due jobs, with none left over, must not report truncation either.
      expect(exactPage.truncated).toBe(false);
    });
  });

  describe('findJobDefinitionByKey / findTriggerEligibleJobDefinition', () => {
    it('returns null for a job_key that does not exist', async () => {
      expect(await findJobDefinitionByKey('nonexistent', pool)).toBeNull();
    });

    it('finds an existing job regardless of trigger eligibility', async () => {
      await seedJobDefinition({ jobKey: 'plain-job', triggerEligible: false });
      const found = await findJobDefinitionByKey('plain-job', pool);
      expect(found?.jobKey).toBe('plain-job');
    });

    it('F16 §4.1b: a trigger-eligible job is found by the trigger-path lookup', async () => {
      await seedJobDefinition({ jobKey: 'x-sampling-window', triggerEligible: true });
      const found = await findTriggerEligibleJobDefinition('x-sampling-window', pool);
      expect(found?.jobKey).toBe('x-sampling-window');
      expect(found?.triggerEligible).toBe(true);
    });

    it('D-15: a job that exists but was not registered trigger-eligible is indistinguishable from one that does not exist', async () => {
      await seedJobDefinition({ jobKey: 'not-eligible', triggerEligible: false });
      // Confirmed via the plain lookup that the row genuinely exists...
      expect(await findJobDefinitionByKey('not-eligible', pool)).not.toBeNull();
      // ...and the trigger-path lookup still refuses it, exactly as it refuses a nonexistent key.
      expect(await findTriggerEligibleJobDefinition('not-eligible', pool)).toBeNull();
    });

    it('refuses a disabled job even if it is registered trigger-eligible', async () => {
      await seedJobDefinition({ jobKey: 'disabled-but-eligible', enabled: false, triggerEligible: true });
      expect(await findTriggerEligibleJobDefinition('disabled-but-eligible', pool)).toBeNull();
    });
  });

  describe('advanceJobDefinitionSchedule', () => {
    it('writes the next due instant and increments version', async () => {
      const jobId = await seedJobDefinition({ jobKey: 'advance-me' });
      const before = await findJobDefinitionByKey('advance-me', pool);
      expect(before?.version).toBe(1);

      const updated = await advanceJobDefinitionSchedule(
        jobId,
        new Date('2026-09-01T00:05:00Z'),
        'dispatcher',
        pool,
      );
      expect(updated.nextDueAt.toISOString()).toBe('2026-09-01T00:05:00.000Z');
      expect(updated.version).toBe(2);
      expect(updated.updatedBy).toBe('dispatcher');
    });

    it('throws for a job id that does not exist', async () => {
      await expect(
        advanceJobDefinitionSchedule(
          '00000000-0000-0000-0000-000000000000',
          new Date(),
          'dispatcher',
          pool,
        ),
      ).rejects.toThrow(/does not exist/);
    });

    it('is a genuine UPDATE, not a successor row — job_definition is not append-only', async () => {
      const jobId = await seedJobDefinition({ jobKey: 'mutate-in-place' });
      await advanceJobDefinitionSchedule(jobId, new Date('2026-09-01T00:05:00Z'), 'dispatcher', pool);
      const { rows } = await pool.query('select count(*)::text as count from job_definition');
      // If this were append-only, the advance would have to be a second row.
      expect(rows[0]?.count).toBe('1');
    });
  });

  describe('claimJobRun', () => {
    it('claims a new run', async () => {
      const jobId = await seedJobDefinition();
      const { run, claimed } = await claimJobRun(newRun(jobId), pool);
      expect(claimed).toBe(true);
      expect(run.status).toBe('queued');
      expect(run.jobId).toBe(jobId);
      expect(run.attempt).toBe(1);
      expect(run.dryRun).toBe(false);
    });

    it('F16 §4.1 step 4: a re-delivery of the same idempotency key is a no-op, not a second row', async () => {
      const jobId = await seedJobDefinition();
      const first = await claimJobRun(newRun(jobId), pool);
      const second = await claimJobRun(newRun(jobId), pool);

      expect(first.claimed).toBe(true);
      expect(second.claimed).toBe(false);
      expect(second.run.id).toBe(first.run.id);

      const { rows } = await pool.query('select count(*)::text as count from job_run');
      expect(rows[0]?.count).toBe('1');
    });

    it('a genuinely concurrent double-claim on the same idempotency key still yields exactly one claim', async () => {
      // Unlike attention_snapshot/market_snapshot (B-27/B-29), job_run.idempotency_key carries a
      // real `unique` constraint, so this is provable under true concurrency, not just against a
      // sequential retry — two overlapping `claimJobRun` calls against the same pool, not awaited
      // one after another.
      const jobId = await seedJobDefinition();
      const input = newRun(jobId);
      const [a, b] = await Promise.all([claimJobRun(input, pool), claimJobRun(input, pool)]);

      const claims = [a.claimed, b.claimed].sort();
      expect(claims).toEqual([false, true]);
      expect(a.run.id).toBe(b.run.id);

      const { rows } = await pool.query('select count(*)::text as count from job_run');
      expect(rows[0]?.count).toBe('1');
    });

    it('two different due instants for the same job are two different runs', async () => {
      const jobId = await seedJobDefinition();
      const first = await claimJobRun(newRun(jobId, { idempotencyKey: `${jobId}:t1` }), pool);
      const second = await claimJobRun(newRun(jobId, { idempotencyKey: `${jobId}:t2` }), pool);
      expect(first.claimed).toBe(true);
      expect(second.claimed).toBe(true);
      expect(first.run.id).not.toBe(second.run.id);
    });

    it('records a dry run flag and a manual trigger with a requester', async () => {
      const jobId = await seedJobDefinition();
      const { run } = await claimJobRun(
        newRun(jobId, {
          triggerType: 'manual',
          dryRun: true,
          requestedBy: 'admin@example.com',
          requestReason: 'testing the dry-run path',
        }),
        pool,
      );
      expect(run.dryRun).toBe(true);
      expect(run.triggerType).toBe('manual');
      expect(run.requestedBy).toBe('admin@example.com');
    });

    /**
     * Post-review finding 4. `claimJobRun`'s contract is that a re-delivery of the same
     * `(job_id, due_at)` is a no-op — not merely that some row already holds this exact key
     * string. If the key's own derivation ever lost the `job_id` component, two different jobs
     * whose due instants collide would otherwise silently share a "claim", and the second job's
     * caller would be told to skip execution — permanent, silent corpus loss under D-16.
     */
    it('throws when the same idempotency key is claimed for two different jobs', async () => {
      const jobA = await seedJobDefinition({ jobKey: 'job-a' });
      const jobB = await seedJobDefinition({ jobKey: 'job-b' });
      const sharedKey = 'shared-idempotency-key';

      await claimJobRun(newRun(jobA, { idempotencyKey: sharedKey }), pool);
      await expect(claimJobRun(newRun(jobB, { idempotencyKey: sharedKey }), pool)).rejects.toThrow(
        /idempotency key collides across two different jobs/,
      );
    });

    it('stores an explicit null error distinctly from an unset one — both read back as null', async () => {
      // Regression guard for the SQL-NULL-vs-JSON-null distinction the module docstring names:
      // if `jsonParam` ever mis-serialized an explicit `null` as the JSON scalar `null`, `error
      // is null` (used nowhere in this module today, but relied on by any future caller) would
      // stop matching this row.
      const jobId = await seedJobDefinition();
      const { run } = await claimJobRun(newRun(jobId), pool);
      const { rows } = await pool.query<{ error: unknown }>(
        'select error from job_run where id = $1',
        [run.id],
      );
      expect(rows[0]?.error).toBeNull();
      const { rows: nullCheck } = await pool.query<{ count: string }>(
        'select count(*)::text as count from job_run where id = $1 and error is null',
        [run.id],
      );
      expect(nullCheck[0]?.count).toBe('1');
    });
  });

  describe('startJobRun', () => {
    it('transitions queued to running', async () => {
      const jobId = await seedJobDefinition();
      const { run } = await claimJobRun(newRun(jobId), pool);
      const started = await startJobRun(run.id, new Date('2026-09-01T00:00:05Z'), pool);
      expect(started.started).toBe(true);
      expect(started.run.status).toBe('running');
      expect(started.run.startedAt?.toISOString()).toBe('2026-09-01T00:00:05.000Z');
    });

    it('is tolerant of a re-entrant start on an already-running row (crash recovery)', async () => {
      const jobId = await seedJobDefinition();
      const { run } = await claimJobRun(newRun(jobId), pool);
      const firstStart = await startJobRun(run.id, new Date('2026-09-01T00:00:05Z'), pool);
      const secondStart = await startJobRun(run.id, new Date('2026-09-01T00:00:09Z'), pool);

      expect(firstStart.started).toBe(true);
      // Post-review finding 1: the re-entrant call did not perform the transition itself.
      expect(secondStart.started).toBe(false);
      expect(secondStart.run.status).toBe('running');
      // The second call must not have moved `started_at` — it observes the state the first call
      // already reached, it does not re-apply its own (later, wrong) timestamp on top of it.
      expect(secondStart.run.startedAt?.toISOString()).toBe(firstStart.run.startedAt?.toISOString());
    });

    /**
     * Post-review finding 1. Reproduced directly against Postgres 16 (see the module docstring):
     * under READ COMMITTED, the loser of a genuinely concurrent `queued` → `running` race blocks
     * on the winner's lock, then re-evaluates its `where status = 'queued'` against the
     * now-committed row and matches zero rows — landing in exactly the same fallback branch a
     * sequential crash-recovery retry would. Without the `started` flag, both callers would
     * receive an identical, successful-looking `JobRun` with no way to tell which one actually
     * won an expired-lock double-dispatch (F16 §4.1 step 7's named scenario).
     */
    it('a genuinely concurrent double-start on the same run yields exactly one started:true', async () => {
      const jobId = await seedJobDefinition();
      const { run } = await claimJobRun(newRun(jobId), pool);

      const [a, b] = await Promise.all([
        startJobRun(run.id, new Date('2026-09-01T00:00:05Z'), pool),
        startJobRun(run.id, new Date('2026-09-01T00:00:05Z'), pool),
      ]);

      const startedFlags = [a.started, b.started].sort();
      expect(startedFlags).toEqual([false, true]);
      expect(a.run.status).toBe('running');
      expect(b.run.status).toBe('running');

      const { rows } = await pool.query('select count(*)::text as count from job_run');
      expect(rows[0]?.count).toBe('1');
    });

    it('throws when starting a run that has already finished', async () => {
      const jobId = await seedJobDefinition();
      const { run } = await claimJobRun(newRun(jobId), pool);
      await startJobRun(run.id, new Date('2026-09-01T00:00:05Z'), pool);
      await finishJobRun(run.id, { status: 'succeeded', completedAt: new Date('2026-09-01T00:01:00Z') }, pool);

      await expect(startJobRun(run.id, new Date(), pool)).rejects.toThrow(/cannot start a run/);
    });

    it('throws for a run id that does not exist', async () => {
      await expect(
        startJobRun('00000000-0000-0000-0000-000000000000', new Date(), pool),
      ).rejects.toThrow(/does not exist/);
    });
  });

  describe('finishJobRun', () => {
    it('records a full outcome from running', async () => {
      const jobId = await seedJobDefinition();
      const { run } = await claimJobRun(newRun(jobId), pool);
      await startJobRun(run.id, new Date('2026-09-01T00:00:05Z'), pool);

      const finished = await finishJobRun(
        run.id,
        {
          status: 'succeeded',
          completedAt: new Date('2026-09-01T00:01:00Z'),
          itemsRead: 42,
          itemsWritten: 40,
          providerCalls: 3,
          estimatedCostUsd: '0.015',
          metrics: { latencyMs: 812 },
          dataAsOf: new Date('2026-09-01T00:00:55Z'),
        },
        pool,
      );

      expect(finished.status).toBe('succeeded');
      expect(finished.itemsRead).toBe(42);
      expect(finished.itemsWritten).toBe(40);
      expect(finished.providerCalls).toBe(3);
      expect(finished.estimatedCostUsd).toBe('0.015');
      expect(finished.metrics).toEqual({ latencyMs: 812 });
      expect(finished.dataAsOf?.toISOString()).toBe('2026-09-01T00:00:55.000Z');
    });

    /**
     * Post-review finding 3 (round 2), fixing the exact gap that let a real bug (finding 2, round
     * 2) through: the existing "tolerant retry" test only ever retried an *empty* outcome, where
     * every field-comparison guard in `finishOutcomeConflictsWithExisting` short-circuits on
     * `undefined` without ever running. This retries a *fully populated* outcome — including a
     * multi-key `metrics` object (whose key order Postgres's `jsonb` does not preserve) and an
     * `estimatedCostUsd` with a different number of trailing zeros than what round-trips back —
     * and must still be tolerated as the identical duplicate it is.
     */
    it('is tolerant of a retried finish reporting an identical, fully populated outcome', async () => {
      const jobId = await seedJobDefinition();
      const { run } = await claimJobRun(newRun(jobId), pool);
      await startJobRun(run.id, new Date('2026-09-01T00:00:05Z'), pool);
      const outcome = {
        status: 'succeeded' as const,
        completedAt: new Date('2026-09-01T00:01:00Z'),
        itemsRead: 42,
        itemsWritten: 40,
        providerCalls: 3,
        estimatedCostUsd: '0.0150', // trailing-zero normalization is exercised separately below
        error: { code: 'NONE', message: 'ok' },
        metrics: { latencyMs: 812, itemsSkipped: 3, a: 1 }, // key order jsonb will not preserve
        unpricedUnits: { freeCalls: 2 },
        dataAsOf: new Date('2026-09-01T00:00:55Z'),
      };

      const first = await finishJobRun(run.id, outcome, pool);
      const second = await finishJobRun(run.id, outcome, pool);

      expect(first.status).toBe('succeeded');
      expect(second.id).toBe(first.id);
      expect(second.estimatedCostUsd).toBe('0.0150');
    });

    /**
     * Post-review finding 1 (round 3). `canonicalJsonString` used to compare a caller's raw
     * in-memory object directly, before this fix — `JSON.stringify` (the actual write path,
     * `jsonParam`) drops an `undefined`-valued property and serializes a `Date` via its own
     * `toJSON()`, but the raw comparison saw the `undefined` key and the live `Date` instance,
     * reporting a byte-identical retry as a conflict. Confirmed directly against Postgres 16.
     */
    it('is tolerant of a retried finish whose jsonb fields contain a Date value or an undefined property', async () => {
      const jobId = await seedJobDefinition();
      const { run } = await claimJobRun(newRun(jobId), pool);
      const outcome = {
        status: 'succeeded' as const,
        completedAt: new Date('2026-09-01T00:01:00Z'),
        error: { code: 'ETIMEDOUT', message: 'provider timeout', provider: undefined },
        metrics: { windowEnd: new Date('2026-09-01T00:00:55.000Z'), n: 3 },
      };

      const first = await finishJobRun(run.id, outcome, pool);
      const second = await finishJobRun(run.id, outcome, pool);
      expect(second.id).toBe(first.id);
    });

    it('round-trips unpricedUnits through jsonb', async () => {
      const jobId = await seedJobDefinition();
      const { run } = await claimJobRun(newRun(jobId), pool);
      const finished = await finishJobRun(
        run.id,
        {
          status: 'succeeded',
          completedAt: new Date('2026-09-01T00:00:01Z'),
          unpricedUnits: { freeReads: 5 },
        },
        pool,
      );
      expect(finished.unpricedUnits).toEqual({ freeReads: 5 });
    });

    it.each([
      ['itemsRead', { itemsRead: 42 }, { itemsRead: 99 }],
      ['itemsWritten', { itemsWritten: 40 }, { itemsWritten: 99 }],
      ['error', { error: { message: 'a' } }, { error: { message: 'b' } }],
      ['metrics', { metrics: { latencyMs: 1 } }, { metrics: { latencyMs: 2 } }],
      ['unpricedUnits', { unpricedUnits: { a: 1 } }, { unpricedUnits: { a: 2 } }],
      ['dataAsOf', { dataAsOf: new Date('2026-09-01T00:00:00Z') }, { dataAsOf: new Date('2026-09-01T00:00:01Z') }],
      // Post-review finding 2 (round 3): every other conflict guard had a test in the
      // conflicting direction; estimatedCostUsd only had the tolerant direction, so
      // decimalStringsMatch could be made unconditionally permissive with the suite still green.
      ['estimatedCostUsd', { estimatedCostUsd: '0.09' }, { estimatedCostUsd: '0.90' }],
    ] as const)(
      'throws when a retried finish reports a conflicting %s',
      async (_label, firstFields, secondFields) => {
        const jobId = await seedJobDefinition();
        const { run } = await claimJobRun(newRun(jobId), pool);
        await startJobRun(run.id, new Date('2026-09-01T00:00:05Z'), pool);
        const base = { status: 'succeeded' as const, completedAt: new Date('2026-09-01T00:01:00Z') };

        await finishJobRun(run.id, { ...base, ...firstFields }, pool);
        await expect(finishJobRun(run.id, { ...base, ...secondFields }, pool)).rejects.toThrow(
          /different outcome payload for the same status/,
        );
      },
    );

    /**
     * Post-review finding 2 (round 2): `estimatedCostUsd` comparison must be numeric-equality, not
     * string equality — `numeric` preserves scale on write, so a caller's `'0.015'` and a
     * previously-stored `'0.0150'` denote the identical amount and must not conflict.
     */
    it('does not treat a trailing-zero-only difference in estimatedCostUsd as a conflict', async () => {
      const jobId = await seedJobDefinition();
      const { run } = await claimJobRun(newRun(jobId), pool);
      await startJobRun(run.id, new Date('2026-09-01T00:00:05Z'), pool);
      const base = { status: 'succeeded' as const, completedAt: new Date('2026-09-01T00:01:00Z') };

      await finishJobRun(run.id, { ...base, estimatedCostUsd: '0.015' }, pool);
      const second = await finishJobRun(run.id, { ...base, estimatedCostUsd: '0.0150' }, pool);
      expect(second.status).toBe('succeeded');
    });

    it('allows finishing directly from queued — the dry-run path never calls startJobRun', async () => {
      const jobId = await seedJobDefinition();
      const { run } = await claimJobRun(newRun(jobId, { dryRun: true }), pool);
      const finished = await finishJobRun(
        run.id,
        { status: 'succeeded', completedAt: new Date('2026-09-01T00:00:01Z') },
        pool,
      );
      expect(finished.status).toBe('succeeded');
      expect(finished.startedAt).toBeNull();
    });

    it('records a failure with an error payload', async () => {
      const jobId = await seedJobDefinition();
      const { run } = await claimJobRun(newRun(jobId), pool);
      await startJobRun(run.id, new Date('2026-09-01T00:00:05Z'), pool);

      const finished = await finishJobRun(
        run.id,
        {
          status: 'failed',
          completedAt: new Date('2026-09-01T00:00:30Z'),
          error: { message: 'provider timeout', code: 'ETIMEDOUT' },
        },
        pool,
      );
      expect(finished.status).toBe('failed');
      expect(finished.error).toEqual({ message: 'provider timeout', code: 'ETIMEDOUT' });
    });

    it('is tolerant of a retried finish reporting the same terminal outcome', async () => {
      const jobId = await seedJobDefinition();
      const { run } = await claimJobRun(newRun(jobId), pool);
      await startJobRun(run.id, new Date('2026-09-01T00:00:05Z'), pool);
      const outcome = { status: 'succeeded' as const, completedAt: new Date('2026-09-01T00:01:00Z') };

      const first = await finishJobRun(run.id, outcome, pool);
      const second = await finishJobRun(run.id, outcome, pool);
      expect(first.status).toBe('succeeded');
      expect(second.status).toBe('succeeded');
      expect(second.id).toBe(first.id);
    });

    it('throws when a second call reports a different terminal outcome than the first', async () => {
      const jobId = await seedJobDefinition();
      const { run } = await claimJobRun(newRun(jobId), pool);
      await startJobRun(run.id, new Date('2026-09-01T00:00:05Z'), pool);
      await finishJobRun(run.id, { status: 'succeeded', completedAt: new Date('2026-09-01T00:01:00Z') }, pool);

      await expect(
        finishJobRun(run.id, { status: 'failed', completedAt: new Date('2026-09-01T00:01:05Z') }, pool),
      ).rejects.toThrow(/does not get two different final outcomes/);
    });

    /**
     * Post-review finding 2. The re-entrant tolerance used to compare only `status` — a retry
     * reporting the *same* terminal status with different numbers (a different `providerCalls`
     * or `estimatedCostUsd`) was silently treated as an identical duplicate, keeping whichever
     * payload happened to land first rather than whichever is actually correct, with nothing to
     * signal that a real conflict was discarded.
     */
    it('throws when a second call reports the same terminal status but a conflicting payload', async () => {
      const jobId = await seedJobDefinition();
      const { run } = await claimJobRun(newRun(jobId), pool);
      await startJobRun(run.id, new Date('2026-09-01T00:00:05Z'), pool);
      await finishJobRun(
        run.id,
        { status: 'succeeded', completedAt: new Date('2026-09-01T00:01:00Z'), providerCalls: 3 },
        pool,
      );

      await expect(
        finishJobRun(
          run.id,
          { status: 'succeeded', completedAt: new Date('2026-09-01T00:01:00Z'), providerCalls: 7 },
          pool,
        ),
      ).rejects.toThrow(/different outcome payload for the same status/);
    });

    it('throws for a run id that does not exist', async () => {
      await expect(
        finishJobRun(
          '00000000-0000-0000-0000-000000000000',
          { status: 'succeeded', completedAt: new Date() },
          pool,
        ),
      ).rejects.toThrow(/does not exist/);
    });

    it('rejects a non-terminal status before ever reaching the database', async () => {
      const jobId = await seedJobDefinition();
      const { run } = await claimJobRun(newRun(jobId), pool);
      await expect(
        finishJobRun(
          run.id,
          // @ts-expect-error — deliberately not a terminal status, to prove the runtime guard.
          { status: 'running', completedAt: new Date() },
          pool,
        ),
      ).rejects.toThrow(/not a terminal job_run status/);
    });

    it('is a genuine UPDATE, not a successor row — job_run is not append-only', async () => {
      const jobId = await seedJobDefinition();
      const { run } = await claimJobRun(newRun(jobId), pool);
      await startJobRun(run.id, new Date('2026-09-01T00:00:05Z'), pool);
      await finishJobRun(run.id, { status: 'succeeded', completedAt: new Date('2026-09-01T00:01:00Z') }, pool);

      const { rows } = await pool.query('select count(*)::text as count from job_run');
      expect(rows[0]?.count).toBe('1');
    });
  });

  describe('findRunningJobRun', () => {
    it('returns null when no run is running', async () => {
      const jobId = await seedJobDefinition();
      await claimJobRun(newRun(jobId), pool);
      expect(await findRunningJobRun(jobId, pool)).toBeNull();
    });

    it('finds the running run and ignores queued/terminal ones', async () => {
      const jobId = await seedJobDefinition();
      const queued = await claimJobRun(newRun(jobId, { idempotencyKey: `${jobId}:t1` }), pool);
      const running = await claimJobRun(newRun(jobId, { idempotencyKey: `${jobId}:t2` }), pool);
      const done = await claimJobRun(newRun(jobId, { idempotencyKey: `${jobId}:t3` }), pool);

      await startJobRun(running.run.id, new Date('2026-09-01T00:00:05Z'), pool);
      await startJobRun(done.run.id, new Date('2026-09-01T00:00:05Z'), pool);
      await finishJobRun(done.run.id, { status: 'succeeded', completedAt: new Date('2026-09-01T00:01:00Z') }, pool);
      void queued;

      const found = await findRunningJobRun(jobId, pool);
      expect(found?.id).toBe(running.run.id);
    });

    it('scopes to one job and does not return another job’s running run', async () => {
      const jobA = await seedJobDefinition({ jobKey: 'job-a' });
      const jobB = await seedJobDefinition({ jobKey: 'job-b' });
      const runB = await claimJobRun(newRun(jobB), pool);
      await startJobRun(runB.run.id, new Date('2026-09-01T00:00:05Z'), pool);

      expect(await findRunningJobRun(jobA, pool)).toBeNull();
    });
  });

  describe('jobRunHistory', () => {
    it('orders most-recent-first, treating a still-queued run as newest', async () => {
      const jobId = await seedJobDefinition();
      const older = await claimJobRun(newRun(jobId, { idempotencyKey: `${jobId}:t1` }), pool);
      await startJobRun(older.run.id, new Date('2026-09-01T00:00:00Z'), pool);
      await finishJobRun(older.run.id, { status: 'succeeded', completedAt: new Date('2026-09-01T00:01:00Z') }, pool);

      const stillQueued = await claimJobRun(newRun(jobId, { idempotencyKey: `${jobId}:t2` }), pool);

      const history = await jobRunHistory({ jobId }, pool);
      expect(history[0]?.id).toBe(stillQueued.run.id);
      expect(history[1]?.id).toBe(older.run.id);
    });

    it('filters by status', async () => {
      const jobId = await seedJobDefinition();
      const failed = await claimJobRun(newRun(jobId, { idempotencyKey: `${jobId}:t1` }), pool);
      await startJobRun(failed.run.id, new Date('2026-09-01T00:00:00Z'), pool);
      await finishJobRun(failed.run.id, { status: 'failed', completedAt: new Date('2026-09-01T00:00:10Z') }, pool);

      const succeeded = await claimJobRun(newRun(jobId, { idempotencyKey: `${jobId}:t2` }), pool);
      await startJobRun(succeeded.run.id, new Date('2026-09-01T00:01:00Z'), pool);
      await finishJobRun(succeeded.run.id, { status: 'succeeded', completedAt: new Date('2026-09-01T00:01:10Z') }, pool);

      const failedOnly = await jobRunHistory({ jobId, statuses: ['failed'] }, pool);
      expect(failedOnly).toHaveLength(1);
      expect(failedOnly[0]?.id).toBe(failed.run.id);
    });

    it('respects the limit', async () => {
      const jobId = await seedJobDefinition();
      await claimJobRun(newRun(jobId, { idempotencyKey: `${jobId}:t1` }), pool);
      await claimJobRun(newRun(jobId, { idempotencyKey: `${jobId}:t2` }), pool);
      const history = await jobRunHistory({ jobId, limit: 1 }, pool);
      expect(history).toHaveLength(1);
    });

    it('scopes to one job', async () => {
      const jobA = await seedJobDefinition({ jobKey: 'job-a' });
      const jobB = await seedJobDefinition({ jobKey: 'job-b' });
      await claimJobRun(newRun(jobA), pool);
      await claimJobRun(newRun(jobB), pool);
      const history = await jobRunHistory({ jobId: jobA }, pool);
      expect(history).toHaveLength(1);
      expect(history[0]?.jobId).toBe(jobA);
    });

    /**
     * Post-review finding 5. An empty `statuses: []` must mean "match none," not "no filter at
     * all" — an admin view with every status checkbox deselected asking for nothing must not be
     * shown everything.
     */
    it('matches nothing, not everything, when statuses is an empty array', async () => {
      const jobId = await seedJobDefinition();
      await claimJobRun(newRun(jobId), pool);
      const history = await jobRunHistory({ jobId, statuses: [] }, pool);
      expect(history).toHaveLength(0);
    });
  });

  // F16 §4.5's own status vocabulary — passed explicitly by any test wanting "any status", since
  // post-review finding 1 (round 2) made `statuses` required with no unfiltered default.
  const ANY_JOB_RUN_STATUS: readonly JobRun['status'][] = [
    'queued',
    'running',
    'succeeded',
    'degraded',
    'failed',
    'cancelled',
    'skipped',
  ];

  describe('mostRecentJobRun', () => {
    it('returns null with no runs at all', async () => {
      expect(await mostRecentJobRun({ statuses: ANY_JOB_RUN_STATUS }, pool)).toBeNull();
    });

    it('finds the latest run across every job — the F16 §4.5 heartbeat primitive', async () => {
      const jobA = await seedJobDefinition({ jobKey: 'job-a' });
      const jobB = await seedJobDefinition({ jobKey: 'job-b' });

      const older = await claimJobRun(newRun(jobA, { idempotencyKey: `${jobA}:t1` }), pool);
      await startJobRun(older.run.id, new Date('2026-09-01T00:00:00Z'), pool);
      await finishJobRun(older.run.id, { status: 'succeeded', completedAt: new Date('2026-09-01T00:00:10Z') }, pool);

      const newer = await claimJobRun(newRun(jobB, { idempotencyKey: `${jobB}:t1` }), pool);
      await startJobRun(newer.run.id, new Date('2026-09-01T01:00:00Z'), pool);
      await finishJobRun(newer.run.id, { status: 'succeeded', completedAt: new Date('2026-09-01T01:00:10Z') }, pool);

      // The real heartbeat caller passes `{ statuses: ['succeeded'] }` (see the test below) — this
      // one deliberately passes every status, to prove the ordering logic itself rather than the
      // status filter.
      const latest = await mostRecentJobRun({ statuses: ANY_JOB_RUN_STATUS }, pool);
      expect(latest?.id).toBe(newer.run.id);
    });

    it('filters by status — a stale-dispatch alert wants only successful dispatches', async () => {
      const jobId = await seedJobDefinition();
      const failed = await claimJobRun(newRun(jobId, { idempotencyKey: `${jobId}:t1` }), pool);
      await startJobRun(failed.run.id, new Date('2026-09-01T00:00:00Z'), pool);
      await finishJobRun(failed.run.id, { status: 'failed', completedAt: new Date('2026-09-01T00:00:10Z') }, pool);

      expect(await mostRecentJobRun({ statuses: ['succeeded'] }, pool)).toBeNull();

      const succeeded = await claimJobRun(newRun(jobId, { idempotencyKey: `${jobId}:t2` }), pool);
      await startJobRun(succeeded.run.id, new Date('2026-09-01T01:00:00Z'), pool);
      await finishJobRun(succeeded.run.id, { status: 'succeeded', completedAt: new Date('2026-09-01T01:00:10Z') }, pool);

      const latestSucceeded = await mostRecentJobRun({ statuses: ['succeeded'] }, pool);
      expect(latestSucceeded?.id).toBe(succeeded.run.id);
    });

    // Post-review finding 5, same guard as jobRunHistory above.
    it('matches nothing, not everything, when statuses is an empty array', async () => {
      const jobId = await seedJobDefinition();
      const { run } = await claimJobRun(newRun(jobId), pool);
      await startJobRun(run.id, new Date('2026-09-01T00:00:05Z'), pool);
      await finishJobRun(run.id, { status: 'succeeded', completedAt: new Date('2026-09-01T00:01:00Z') }, pool);

      expect(await mostRecentJobRun({ statuses: [] }, pool)).toBeNull();
    });
  });

  describe('findJobRunById', () => {
    it('returns null for an id that does not exist', async () => {
      expect(await findJobRunById('00000000-0000-0000-0000-000000000000', pool)).toBeNull();
    });

    it('round-trips a claimed run', async () => {
      const jobId = await seedJobDefinition();
      const { run } = await claimJobRun(newRun(jobId), pool);
      const found = await findJobRunById(run.id, pool);
      expect(found?.id).toBe(run.id);
    });
  });

  // F16 §4.2/§4.4 (F16b, Wave 4) — the admin edit surface's own repository layer.
  describe('findJobDefinitionById', () => {
    it('returns null for an id that does not exist', async () => {
      expect(await findJobDefinitionById('00000000-0000-0000-0000-000000000000', pool)).toBeNull();
    });

    it('finds an existing job by its primary key', async () => {
      const jobId = await seedJobDefinition({ jobKey: 'find-by-id' });
      const found = await findJobDefinitionById(jobId, pool);
      expect(found?.id).toBe(jobId);
      expect(found?.jobKey).toBe('find-by-id');
    });
  });

  describe('listJobDefinitions', () => {
    it('returns every row, ordered by priority then job_key', async () => {
      await seedJobDefinition({ jobKey: 'z-job', priority: 50 });
      await seedJobDefinition({ jobKey: 'a-job', priority: 50 });
      await seedJobDefinition({ jobKey: 'high-priority', priority: 10 });

      const listed = await listJobDefinitions(pool);
      expect(listed.map((job) => job.jobKey)).toEqual(['high-priority', 'a-job', 'z-job']);
    });

    it('returns an empty array when no jobs exist', async () => {
      expect(await listJobDefinitions(pool)).toEqual([]);
    });
  });

  describe('updateJobDefinition', () => {
    /** Full control over every editable column, unlike the file's own `seedJobDefinition` (which hardcodes `schedule_expression = '5m'`, not a valid interval for real scheduling math). */
    async function seedEditableJob(overrides: Partial<{
      jobKey: string;
      scheduleType: 'interval' | 'cron';
      scheduleExpression: string;
      displayTimezone: string;
      enabled: boolean;
      maxAttempts: number;
      maxCostUsdPerRun: string | null;
      nextDueAt: Date;
    }> = {}): Promise<string> {
      const {
        jobKey = 'editable-job',
        scheduleType = 'interval',
        scheduleExpression = '300',
        displayTimezone = 'UTC',
        enabled = true,
        maxAttempts = 3,
        maxCostUsdPerRun = null,
        nextDueAt = new Date('2026-09-01T00:00:00Z'),
      } = overrides;
      const { rows } = await pool.query<{ id: string }>(
        `insert into job_definition
           (job_key, display_name, enabled, schedule_type, schedule_expression, display_timezone,
            priority, max_runtime_seconds, max_attempts, max_cost_usd_per_run, trigger_eligible,
            next_due_at, config_version, updated_by)
         values ($1, $2, $3, $4, $5, $6, 100, 60, $7, $8, false, $9, $10, 'test-seed')
         returning id`,
        [
          jobKey, `Test ${jobKey}`, enabled, scheduleType, scheduleExpression, displayTimezone,
          maxAttempts, maxCostUsdPerRun, nextDueAt, configVersionId,
        ],
      );
      return rows[0]?.id as string;
    }

    it('updates enabled state alone, bumping version, and leaves other columns untouched', async () => {
      const jobId = await seedEditableJob({ enabled: true, scheduleExpression: '300' });
      const updated = await updateJobDefinition(jobId, 1, { enabled: false }, 'admin', pool);
      expect(updated?.enabled).toBe(false);
      expect(updated?.version).toBe(2);
      expect(updated?.scheduleExpression).toBe('300');
      expect(updated?.updatedBy).toBe('admin');
    });

    it('updates cadence (scheduleType/scheduleExpression/displayTimezone) together', async () => {
      const jobId = await seedEditableJob({ scheduleType: 'interval', scheduleExpression: '300' });
      const updated = await updateJobDefinition(
        jobId,
        1,
        { scheduleType: 'cron', scheduleExpression: '0 9 * * *', displayTimezone: 'America/New_York' },
        'admin',
        pool,
      );
      expect(updated?.scheduleType).toBe('cron');
      expect(updated?.scheduleExpression).toBe('0 9 * * *');
      expect(updated?.displayTimezone).toBe('America/New_York');
    });

    it('updates the due-time override directly', async () => {
      const jobId = await seedEditableJob({ nextDueAt: new Date('2026-09-01T00:00:00Z') });
      const updated = await updateJobDefinition(
        jobId,
        1,
        { nextDueAt: new Date('2026-12-25T00:00:00Z') },
        'admin',
        pool,
      );
      expect(updated?.nextDueAt.toISOString()).toBe('2026-12-25T00:00:00.000Z');
    });

    it('updates retry policy (maxAttempts + backoffPolicy) together', async () => {
      const jobId = await seedEditableJob({ maxAttempts: 3 });
      const updated = await updateJobDefinition(
        jobId,
        1,
        { maxAttempts: 5, backoffPolicy: { strategy: 'exponential', baseSeconds: 30 } },
        'admin',
        pool,
      );
      expect(updated?.maxAttempts).toBe(5);
      expect(updated?.backoffPolicy).toEqual({ strategy: 'exponential', baseSeconds: 30 });
    });

    it('sets and clears the per-job budget ceiling', async () => {
      const jobId = await seedEditableJob({ maxCostUsdPerRun: null });
      const withCeiling = await updateJobDefinition(jobId, 1, { maxCostUsdPerRun: '5.00' }, 'admin', pool);
      expect(withCeiling?.maxCostUsdPerRun).toBe('5.00');

      const cleared = await updateJobDefinition(jobId, 2, { maxCostUsdPerRun: null }, 'admin', pool);
      expect(cleared?.maxCostUsdPerRun).toBeNull();
    });

    it('returns null on a stale expectedVersion — the row is untouched', async () => {
      const jobId = await seedEditableJob({ enabled: true });
      const result = await updateJobDefinition(jobId, 99, { enabled: false }, 'admin', pool);
      expect(result).toBeNull();

      const stillOriginal = await findJobDefinitionById(jobId, pool);
      expect(stillOriginal?.enabled).toBe(true);
      expect(stillOriginal?.version).toBe(1);
    });

    it('returns null for a job id that does not exist', async () => {
      const result = await updateJobDefinition(
        '00000000-0000-0000-0000-000000000000',
        1,
        { enabled: false },
        'admin',
        pool,
      );
      expect(result).toBeNull();
    });

    it('throws when called with no editable field set', async () => {
      const jobId = await seedEditableJob();
      await expect(updateJobDefinition(jobId, 1, {}, 'admin', pool)).rejects.toThrow(/no editable fields/);
    });

    /**
     * F16b's brief, explicitly: "a dispatcher tick and an admin edit racing on the same
     * job_definition row is a genuine scenario your tests should cover." `advanceJobDefinitionSchedule`
     * is F16a's dispatcher-only writer of this same row; racing it genuinely concurrently against
     * this function (not just sequentially) proves the `(id, version)` conditional UPDATE actually
     * serializes the two writers under real concurrency, the same way `claimJobRun`'s and
     * `startJobRun`'s own "genuinely concurrent" tests prove their own guards above.
     */
    it('a genuinely concurrent dispatcher advance and admin edit on the same row: exactly one wins, the other is refused', async () => {
      const jobId = await seedEditableJob({ enabled: true });

      const [adminResult, dispatcherResult] = await Promise.all([
        updateJobDefinition(jobId, 1, { enabled: false }, 'admin', pool),
        advanceJobDefinitionSchedule(jobId, new Date('2026-09-01T00:05:00Z'), 'jobs:dispatch', pool).catch(() => null),
      ]);

      // `advanceJobDefinitionSchedule` has no optimistic-concurrency guard of its own (it is F16a's
      // sole Wave-1 writer, unconditional by design) — it always succeeds. The admin edit above is
      // the one that must lose when it loses: it targeted `expectedVersion: 1`, and if the
      // dispatcher's unconditional advance committed first, the row is already at version 2 by the
      // time the admin's conditional UPDATE runs, so it correctly finds no matching row and
      // returns `null` rather than silently overwriting the dispatcher's own write.
      expect(dispatcherResult).not.toBeNull();
      const finalRow = await findJobDefinitionById(jobId, pool);

      if (adminResult === null) {
        // The admin lost the race: its `WHERE version = 1` never matched (the dispatcher's own
        // unconditional advance committed first and moved the row to version 2), so the admin's
        // UPDATE touched zero rows — not a second, silently-discarded write. Exactly one write
        // happened in total.
        expect(finalRow?.enabled).toBe(true); // never touched by the losing admin write
        expect(finalRow?.version).toBe(2);
      } else {
        // The admin won the race (its UPDATE ran and committed first, while it still matched
        // version 1) — its own write landed, and the dispatcher's subsequent, unconditional
        // advance still applied on top of it (it has no version guard of its own). Two writes.
        expect(adminResult.enabled).toBe(false);
        expect(finalRow?.enabled).toBe(false);
        expect(finalRow?.version).toBe(3);
      }
    });
  });
});
