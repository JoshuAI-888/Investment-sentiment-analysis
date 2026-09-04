import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import { closePool, getPool } from '../../src/repositories/client';
import { insertMarketSnapshot } from '../../src/repositories/market';
import { listGaps } from '../../src/repositories/coverage';
import { findCalculationSnapshot } from '../../src/repositories/calculations';
import { executeJob } from '../../src/services/jobs/job-service';
import { runTriggerPass } from '../../src/services/jobs/trigger';
import { triggeredIdempotencyKey } from '../../src/services/jobs/idempotency';
import type { CollectMarketSnapshotsOutcome, CollectedMarketSnapshotResult } from '../../src/services/market/collector';
import type { MarketSnapshot } from '../../src/contracts/security';

const url = databaseUrl();

/**
 * F16 §4.1b / §5's "Trigger" row and §7 review steps 6–8. Runs `runTriggerPass` directly against
 * seeded `market_snapshot` rows and a hand-built `CollectMarketSnapshotsOutcome`, rather than
 * through the real FMP-backed `collectMarketSnapshots` — the same reasoning `dispatch.test.ts`
 * gives for not going through a live provider: this layer's own contract (evaluate, persist,
 * check eligibility, check budget, refuse-and-record) is independent of how the observations
 * arrived, and `services/market/collector.ts` already has its own provider-facing test suite.
 */
describe.skipIf(url === undefined)('F16a trigger path', () => {
  let pool: pg.Pool;
  let configVersionId: string;
  let securityId: string;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
    getPool(url);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
    const { rows: sec } = await pool.query<{ id: string }>(
      `insert into security (symbol, name, exchange, asset_type, currency)
       values ('SPKE', 'Spike Test Corp.', 'NYSE', 'equity', 'USD') returning id`,
    );
    securityId = sec[0]?.id as string;

    const { rows: cv } = await pool.query<{ id: string }>(
      `insert into config_version (environment, status, created_by, change_reason, checksum)
       values ('production', 'active', 'test-seed', 'seed for trigger.test.ts', 'checksum-1')
       returning id`,
    );
    configVersionId = cv[0]?.id as string;
  });

  afterAll(async () => {
    await closePool();
    await pool?.end();
  });

  async function seedTwoCloses(priorPrice: string, nowPrice: string, observedAtNow: Date) {
    const priorDate = new Date(observedAtNow.getTime() - 24 * 60 * 60 * 1000);
    // `ingestedAt` is pinned to each observation's own date, not left to default to the real
    // wall clock (`insertMarketSnapshot`'s own default) — `evaluateMarketSpike`'s as-of read is
    // bounded by the `now` this test passes in, which is a fixed historical instant; leaving
    // `ingestedAt` at real "today" would put it *after* that bound and the row would never be
    // visible to the read this test is exercising.
    await insertMarketSnapshot(
      {
        securityId,
        price: priorPrice,
        changePercent: null,
        session: 'eod',
        provider: 'fmp',
        observedAt: priorDate,
        ingestedAt: priorDate,
        rawHash: `prior-${priorPrice}`,
      },
      pool,
    );
    await insertMarketSnapshot(
      {
        securityId,
        price: nowPrice,
        changePercent: null,
        session: 'eod',
        provider: 'fmp',
        observedAt: observedAtNow,
        ingestedAt: observedAtNow,
        rawHash: `now-${nowPrice}`,
      },
      pool,
    );
  }

  async function seedXJob(enabled: boolean): Promise<void> {
    await pool.query(
      `insert into job_definition
         (job_key, display_name, enabled, schedule_type, schedule_expression, priority,
          max_runtime_seconds, trigger_eligible, next_due_at, config_version, updated_by)
       values ('x_sampling_window', 'X sampling window', $1, 'interval', '3600', 5, 60, true,
         now(), $2, 'test-seed')`,
      [enabled, configVersionId],
    );
  }

  function fakeResult(inserted: boolean): CollectedMarketSnapshotResult {
    return {
      securityId,
      symbol: 'SPKE',
      inserted,
      snapshot: {} as unknown as MarketSnapshot,
    };
  }

  function pollOutcome(inserted: boolean): CollectMarketSnapshotsOutcome {
    return {
      collectedAt: new Date().toISOString(),
      results: [fakeResult(inserted)],
      failures: [],
    };
  }

  it('a non-crossing move fires no window but still writes a full verdict artifact', async () => {
    const now = new Date('2026-09-02T00:00:00Z');
    await seedTwoCloses('100', '101', now); // 1% move, under the 5% default band
    await seedXJob(true);

    const pass = await runTriggerPass(pollOutcome(true), { configVersion: configVersionId }, { db: pool, now });

    expect(pass.verdicts).toHaveLength(1);
    expect(pass.verdicts[0]?.fired).toBe(false);
    expect(pass.dispatchRequests).toHaveLength(0);

    const artifact = await findCalculationSnapshot(pass.verdicts[0]?.calculationId as string, pool);
    expect(artifact).not.toBeNull();
    expect(artifact?.status).toBe('complete');

    const gaps = await listGaps('x', pool);
    expect(gaps).toHaveLength(0);
  });

  it('a crossing move fires, and — with the real (zero) X budget — is refused and recorded as a CoverageGap, never a smaller window', async () => {
    const now = new Date('2026-09-02T00:00:00Z');
    await seedTwoCloses('100', '110', now); // 10% move, over the 5% default band
    await seedXJob(true);

    const pass = await runTriggerPass(pollOutcome(true), { configVersion: configVersionId }, { db: pool, now });

    expect(pass.verdicts[0]?.fired).toBe(true);
    expect(pass.dispatchRequests).toHaveLength(0); // refused, not dispatched

    const gaps = await listGaps('x', pool);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.reason).toBe('budget_denied');
  });

  it('a trigger-ineligible (disabled) job produces no dispatch request and no CoverageGap — the axis is unwired, not budget-refused', async () => {
    const now = new Date('2026-09-02T00:00:00Z');
    await seedTwoCloses('100', '110', now);
    await seedXJob(false); // enabled = false, matching the Wave 1 seed migration

    const pass = await runTriggerPass(pollOutcome(true), { configVersion: configVersionId }, { db: pool, now });

    expect(pass.verdicts[0]?.fired).toBe(true);
    expect(pass.dispatchRequests).toHaveLength(0);
    expect(await listGaps('x', pool)).toHaveLength(0);
  });

  it('a spike detected twice in one interval yields one window, never two — proven through the real idempotency key and claimJobRun', async () => {
    const now = new Date('2026-09-02T00:00:00Z');
    await seedTwoCloses('100', '110', now);
    await seedXJob(true);

    // Force the budget check to allow, so a dispatch request is actually produced — the real
    // (D-32) budget check refuses everything today, which would make this scenario
    // unobservable without overriding it.
    const allow = () => ({ allowed: true as const });

    // In real operation `evaluateMarketSpike` runs **once** per newly-inserted bar — a second
    // five-minute tick re-observing the *same still-current* bar has nothing new to insert, so
    // `runTriggerPass`'s own `inserted`-only filter (`collectors.ts`) never calls it again for
    // that bar; `calculation_snapshot`'s own identity constraint would reject a second, genuinely
    // duplicate artifact for the identical (method, subject, config, scenario, inputCutoff)
    // anyway. What "detected twice" actually has to prove is one layer down: **if** something
    // upstream ever did surface the same triggering bar a second time, the *dispatch* it would
    // produce must still collapse to one window — which is exactly what the idempotency key is
    // for. Verified here by deriving the key the way a second tick genuinely would (pure,
    // no second `evaluateMarketSpike` call) and confirming `claimJobRun` — via `executeJob` —
    // treats the second delivery as a no-op.
    const firstPass = await runTriggerPass(pollOutcome(true), { configVersion: configVersionId }, { db: pool, now, budgetCheck: allow });
    expect(firstPass.dispatchRequests).toHaveLength(1);
    const request = firstPass.dispatchRequests[0];
    if (request === undefined) throw new Error('expected a dispatch request');

    const rederivedKey = triggeredIdempotencyKey(request.job.id, securityId, firstPass.verdicts[0]?.observedAt as string);
    expect(rederivedKey).toBe(request.idempotencyKey);

    const firstExecution = await executeJob({
      job: request.job,
      triggerType: 'triggered',
      idempotencyKey: request.idempotencyKey,
      lockKey: 'test-lock',
      db: pool,
      now,
    });
    const secondExecution = await executeJob({
      job: request.job,
      triggerType: 'triggered',
      idempotencyKey: request.idempotencyKey,
      lockKey: 'test-lock',
      db: pool,
      now,
    });

    expect(firstExecution.executed).toBe(true);
    expect(secondExecution.executed).toBe(false); // the second delivery of the same spike is a no-op
    expect(secondExecution.run.id).toBe(firstExecution.run.id);
  });

  it('abstains (and still writes an artifact) for a security with no prior close, and evaluates only newly-inserted results', async () => {
    const now = new Date('2026-09-02T00:00:00Z');
    // Only one observation exists — no prior close.
    await insertMarketSnapshot(
      { securityId, price: '100', changePercent: null, session: 'eod', provider: 'fmp', observedAt: now, rawHash: 'only-one' },
      pool,
    );
    await seedXJob(true);

    const pass = await runTriggerPass(pollOutcome(true), { configVersion: configVersionId }, { db: pool, now });
    expect(pass.verdicts[0]?.fired).toBe(false);

    const artifact = await findCalculationSnapshot(pass.verdicts[0]?.calculationId as string, pool);
    expect(artifact?.status).toBe('insufficient_data');
  });

  it('never evaluates a result the poll did not newly insert this tick', async () => {
    const now = new Date('2026-09-02T00:00:00Z');
    await seedTwoCloses('100', '110', now);
    await seedXJob(true);

    const pass = await runTriggerPass(pollOutcome(false), { configVersion: configVersionId }, { db: pool, now });
    expect(pass.verdicts).toHaveLength(0);
  });
});
