import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';

import { databaseUrl, makePool, resetSchema } from '../helpers/db';

const url = databaseUrl();
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const TASKS = [
  ['rni_discovery', 'gpt-5.6-terra', 'terra-capability'],
  ['rni_relationship', 'gpt-5.6-terra', 'terra-capability'],
  ['rni_classifier', 'gpt-5.6-terra', 'terra-capability'],
  ['rni_verification', 'gpt-5.6-sol', 'sol-capability'],
  ['rni_challenger', 'gpt-5.6-sol', 'sol-capability'],
] as const;

type Seed = {
  readonly configVersion: string;
  readonly universeVersion: string;
  readonly securityId: string;
};

type Run = Seed & { readonly runId: string };

describe.skipIf(url === undefined)('I10B — persisted RNI routing and atomic AI budgets', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = makePool();
  });

  beforeEach(async () => {
    await resetSchema(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  async function seedGovernedConfig(options: {
    readonly unitPrice?: string;
    readonly includeTerraPrices?: boolean;
    readonly includeSolPrices?: boolean;
    readonly expiresAt?: string;
  } = {}): Promise<Seed> {
    const config = await pool.query<{ id: string }>(
      `insert into config_version
         (environment, status, created_by, change_reason, checksum)
       values ('test', 'draft', 'coordinator', 'I10B fixture', $1)
       returning id`,
      [randomUUID()],
    );
    const configVersion = config.rows[0]!.id;
    const expiresAt = options.expiresAt ?? '2099-01-01T00:00:00Z';
    await pool.query(
      `insert into rni_model_capability_snapshot (
         id, ai_route, configured_model_id, provider, canonical_provider_model_id,
         model_revision, response_hash, observed_at, expires_at, available,
         supports_responses, supports_structured_outputs, supports_web_search, reasoning_efforts
       ) values
         ('terra-capability', 'openai_direct', 'gpt-5.6-terra', 'openai',
          'gpt-5.6-terra', 'terra-2026-07-09', $1, '2026-09-01T00:00:00Z', $3,
          true, true, true, true, '["low"]'),
         ('sol-capability', 'openai_direct', 'gpt-5.6-sol', 'openai',
          'gpt-5.6-sol', 'sol-2026-07-09', $2, '2026-09-01T00:00:00Z', $3,
          true, true, true, false, '["low"]')`,
      [HASH_A, HASH_B, expiresAt],
    );
    await pool.query(
      `insert into rni_ai_config (
         config_version, ai_route, model_policy_version, budget_policy_version,
         manual_run_hard_usd, full_universe_hard_usd, rolling_24h_hard_usd,
         monthly_warning_usd, monthly_hard_usd
       ) values ($1, 'openai_direct', 'rni-balanced-model-policy-v1',
                 'rni-ai-budget-policy-v1', 2, 25, 50, 300, 500)`,
      [configVersion],
    );
    for (const [task, model, capability] of TASKS) {
      await pool.query(
        `insert into model_route (
           config_version, task, transport, primary_provider, primary_model, model_revision,
           fallback_chain, prompt_version, schema_version, temperature, max_input_tokens,
           max_output_tokens, timeout_ms, max_cost_usd, allowed_data_classes, canary_percent,
           ai_route, canonical_provider_model_id, reasoning_effort, capability_snapshot_id,
           policy_version
         ) values (
           $1, $2, 'openai_responses', 'openai', $3,
           case when $3 = 'gpt-5.6-terra' then 'terra-2026-07-09' else 'sol-2026-07-09' end,
           '[]', $2 || '-v1', 'rni-schema-v1', 0, 500, 500, 30000, 25, '[]', 0,
           'openai_direct', $3, 'low', $4, 'rni-balanced-model-policy-v1'
         )`,
        [configVersion, task, model, capability],
      );
    }
    await pool.query(
      `update config_version set status = 'active', activated_at = now() where id = $1`,
      [configVersion],
    );
    const security = await pool.query<{ id: string }>(
      `insert into security (symbol, name, exchange, asset_type, currency)
       values ('NVDA', 'NVIDIA Corporation', 'NASDAQ', 'equity', 'USD') returning id`,
    );
    const securityId = security.rows[0]!.id;
    const universe = await pool.query<{ id: string }>(
      `insert into universe_version
         (environment, config_version, status, selected_count, created_by, change_reason)
       values ('test', $1, 'draft', 1, 'coordinator', 'I10B fixture') returning id`,
      [configVersion],
    );
    const universeVersion = universe.rows[0]!.id;
    await pool.query(
      `insert into universe_member (universe_version, security_id, added_by, selection_source)
       values ($1, $2, 'coordinator', 'preset')`,
      [universeVersion, securityId],
    );

    const unitPrice = options.unitPrice ?? '0.001';
    const pricedModels = [
      ...(options.includeTerraPrices === false ? [] : ['gpt-5.6-terra']),
      ...(options.includeSolPrices === false ? [] : ['gpt-5.6-sol']),
    ];
    for (const model of pricedModels) {
      for (const unitType of ['input_token', 'output_token']) {
        await pool.query(
          `insert into unit_price_book (
             price_book_version, provider, service, operation_or_model, unit_type, unit_price,
             currency, effective_from, source_reference
           ) values ('rni-prices-v1', 'openai', 'openai_responses', $1, $2, $3,
                     'USD', '2026-01-01T00:00:00Z', 'I10B deterministic fixture')`,
          [model, unitType, unitPrice],
        );
      }
    }
    await pool.query(
      `insert into unit_price_book (
         price_book_version, provider, service, operation_or_model, unit_type, unit_price,
         currency, effective_from, source_reference
       ) values ('rni-prices-v1', 'openai', 'openai_web_search', 'web_search', 'search',
                 $1, 'USD', '2026-01-01T00:00:00Z', 'I10B deterministic fixture')`,
      [unitPrice],
    );
    return { configVersion, universeVersion, securityId };
  }

  async function createRun(seed: Seed, scope: 'manual_ticker' | 'full_universe'): Promise<Run> {
    const runId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into rni_run (
           id, idempotency_key, trigger, status, window_start, window_end, universe_version,
           config_version, prompt_version, ai_route, requested_at
         ) values ($1, $2, $3, 'running', now() - interval '1 day', now(), $4, $5,
                   'rni-prompts-v1', 'openai_direct', now())`,
        [
          runId,
          `i10b-${runId}`,
          scope === 'manual_ticker' ? 'manual' : 'schedule',
          seed.universeVersion,
          seed.configVersion,
        ],
      );
      await client.query(
        `insert into rni_run_execution_scope (run_id, scope_kind, security_id)
         values ($1, $2, $3)`,
        [runId, scope, scope === 'manual_ticker' ? seed.securityId : null],
      );
      await client.query(
        `insert into rni_platform_slice
           (run_id, platform, status, coverage_disclosure)
         values ($1, 'reddit', 'running', 'I10B fixture'),
                ($1, 'x', 'running', 'I10B fixture')`,
        [runId],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    return { ...seed, runId };
  }

  async function reserve(
    run: Run,
    invocationId: string,
    task: string,
    hash = HASH_A,
    capabilitySnapshotId = task === 'rni_verification' || task === 'rni_challenger'
      ? 'sol-capability'
      : 'terra-capability',
  ) {
    const { rows } = await pool.query<{
      invocation_id: string;
      decision: 'reserved' | 'denied';
      estimated_cost_usd: string | null;
      denial_code: string | null;
      warning_emitted: boolean;
    }>(
      `select * from rni_reserve_ai_invocation($1, $2, $3, $4, $5, 'rni-prices-v1')`,
      [invocationId, run.runId, task, hash, capabilitySnapshotId],
    );
    return rows[0]!;
  }

  it('activates exactly five fresh balanced routes and locks their lineage', async () => {
    const seed = await seedGovernedConfig();
    const routes = await pool.query<{
      task: string;
      canonical_provider_model_id: string;
      reasoning_effort: string;
    }>(
      `select task, canonical_provider_model_id, reasoning_effort
         from model_route where config_version = $1 order by task`,
      [seed.configVersion],
    );
    expect(routes.rows).toHaveLength(5);
    expect(routes.rows.every(({ reasoning_effort }) => reasoning_effort === 'low')).toBe(true);
    await expect(
      pool.query(
        `update model_route set primary_model = 'other' where config_version = $1
          and task = 'rni_classifier'`,
        [seed.configVersion],
      ),
    ).rejects.toThrow(/successor config|draft successor/u);
    await expect(
      pool.query(`update rni_model_capability_snapshot set available = false where id = 'terra-capability'`),
    ).rejects.toThrow(/append-only/u);
  });

  it('accepts a fresh matching capability refresh without rewriting the active config', async () => {
    const seed = await seedGovernedConfig();
    await pool.query(
      `insert into rni_model_capability_snapshot (
         id, ai_route, configured_model_id, provider, canonical_provider_model_id,
         model_revision, response_hash, observed_at, expires_at, available,
         supports_responses, supports_structured_outputs, supports_web_search, reasoning_efforts
       ) values (
         'terra-capability-refresh', 'openai_direct', 'gpt-5.6-terra', 'openai',
         'gpt-5.6-terra', 'terra-2026-07-09', $1, now() - interval '1 minute',
         now() + interval '1 day', true, true, true, true, '["low"]'
       )`,
      ['f'.repeat(64)],
    );
    const run = await createRun(seed, 'manual_ticker');
    const result = await reserve(
      run,
      randomUUID(),
      'rni_classifier',
      HASH_A,
      'terra-capability-refresh',
    );
    expect(result.decision).toBe('reserved');
    const configRows = await pool.query<{ count: string }>(
      `select count(*)::text as count from rni_ai_config where config_version = $1`,
      [seed.configVersion],
    );
    expect(configRows.rows[0]!.count).toBe('1');

    await pool.query(
      `insert into rni_model_capability_snapshot (
         id, ai_route, configured_model_id, provider, canonical_provider_model_id,
         model_revision, response_hash, observed_at, expires_at, available,
         supports_responses, supports_structured_outputs, supports_web_search, reasoning_efforts
       ) values (
         'terra-capability-expired', 'openai_direct', 'gpt-5.6-terra', 'openai',
         'gpt-5.6-terra', 'terra-2026-07-09', $1, '2026-01-01T00:00:00Z',
         '2026-01-02T00:00:00Z', true, true, true, true, '["low"]'
       )`,
      ['e'.repeat(64)],
    );
    await expect(
      reserve(
        await createRun(seed, 'manual_ticker'),
        randomUUID(),
        'rni_classifier',
        HASH_B,
        'terra-capability-expired',
      ),
    ).rejects.toThrow(/fresh exact capability/u);
  });

  it('rejects unapproved limits and stale capability activation', async () => {
    const draft = await pool.query<{ id: string }>(
      `insert into config_version
         (environment, status, created_by, change_reason, checksum)
       values ('test', 'draft', 'coordinator', 'wrong limits', $1) returning id`,
      [randomUUID()],
    );
    await expect(
      pool.query(
        `insert into rni_ai_config (
           config_version, ai_route, model_policy_version, budget_policy_version,
           manual_run_hard_usd, full_universe_hard_usd, rolling_24h_hard_usd,
           monthly_warning_usd, monthly_hard_usd
         ) values ($1, 'openai_direct', 'rni-balanced-model-policy-v1',
                   'rni-ai-budget-policy-v1', 3, 25, 50, 300, 500)`,
        [draft.rows[0]!.id],
      ),
    ).rejects.toThrow(/2\/25\/50\/300\/500/u);

    await expect(seedGovernedConfig({ expiresAt: '2026-09-02T00:00:00Z' })).rejects.toThrow(
      /fresh capability/u,
    );
  });

  it('allows the exact manual boundary, denies only excess, and replays exactly', async () => {
    const run = await createRun(await seedGovernedConfig(), 'manual_ticker');
    const firstId = randomUUID();
    const first = await reserve(run, firstId, 'rni_relationship');
    const replay = await reserve(run, firstId, 'rni_relationship');
    const second = await reserve(run, randomUUID(), 'rni_classifier', HASH_B);
    const denied = await reserve(run, randomUUID(), 'rni_relationship', 'c'.repeat(64));

    expect(first).toMatchObject({ decision: 'reserved', estimated_cost_usd: '1.000' });
    expect(replay).toEqual({ ...first, warning_emitted: false });
    expect(second.decision).toBe('reserved');
    expect(denied).toMatchObject({ decision: 'denied', denial_code: 'run_hard_limit' });
    await expect(reserve(run, firstId, 'rni_relationship', HASH_B)).rejects.toThrow(
      /different intent/u,
    );
    await pool.query(`update rni_run set status = 'complete', completed_at = now() where id = $1`, [
      run.runId,
    ]);
    expect(await reserve(run, firstId, 'rni_relationship')).toEqual({
      ...first,
      warning_emitted: false,
    });
    await expect(
      reserve(run, randomUUID(), 'rni_classifier', 'd'.repeat(64)),
    ).rejects.toThrow(/non-terminal run/u);
  });

  it('serializes concurrent reservations so the run cannot overspend', async () => {
    const run = await createRun(await seedGovernedConfig(), 'manual_ticker');
    const outcomes = await Promise.all(
      [HASH_A, HASH_B, 'c'.repeat(64)].map((hash) =>
        reserve(run, randomUUID(), 'rni_classifier', hash),
      ),
    );
    expect(outcomes.filter(({ decision }) => decision === 'reserved')).toHaveLength(2);
    expect(outcomes.filter(({ denial_code }) => denial_code === 'run_hard_limit')).toHaveLength(1);
  });

  it('allows the exact rolling boundary and denies the next full-universe reservation', async () => {
    const seed = await seedGovernedConfig({ unitPrice: '0.025' });
    const first = await reserve(await createRun(seed, 'full_universe'), randomUUID(), 'rni_classifier');
    const second = await reserve(
      await createRun(seed, 'full_universe'),
      randomUUID(),
      'rni_classifier',
      HASH_B,
    );
    const third = await reserve(
      await createRun(seed, 'full_universe'),
      randomUUID(),
      'rni_classifier',
      'c'.repeat(64),
    );
    expect(first.estimated_cost_usd).toBe('25.000');
    expect(second.decision).toBe('reserved');
    expect(third).toMatchObject({ decision: 'denied', denial_code: 'rolling_24h_hard_limit' });
  });

  it('fails closed before dispatch when any required price component is absent', async () => {
    const run = await createRun(
      await seedGovernedConfig({ includeTerraPrices: false }),
      'manual_ticker',
    );
    const invocationId = randomUUID();
    expect(await reserve(run, invocationId, 'rni_relationship')).toMatchObject({
      decision: 'denied',
      denial_code: 'unpriced_component',
      estimated_cost_usd: null,
    });
    const costs = await pool.query<{ count: string }>(
      `select count(*)::text as count from cost_event where request_id = $1`,
      [invocationId],
    );
    expect(costs.rows[0]!.count).toBe('0');
  });

  it('reserves the discovery model envelope plus one governed Web Search call', async () => {
    const run = await createRun(await seedGovernedConfig(), 'manual_ticker');
    const result = await reserve(run, randomUUID(), 'rni_discovery');
    expect(result).toMatchObject({ decision: 'reserved', estimated_cost_usd: '1.001' });
  });

  it('will not detach verifier or challenger spend from its prepared synthesis invocation', async () => {
    const run = await createRun(await seedGovernedConfig(), 'manual_ticker');
    const invocationId = randomUUID();
    await expect(reserve(run, invocationId, 'rni_verification')).rejects.toThrow(
      /synthesis invocation|foreign key/u,
    );
    const rows = await pool.query<{ count: string }>(
      `select count(*)::text as count from rni_ai_model_invocation where id = $1`,
      [invocationId],
    );
    expect(rows.rows[0]!.count).toBe('0');
  });

  it('settles exact usage once while ambiguous calls retain their reservation', async () => {
    const run = await createRun(await seedGovernedConfig(), 'manual_ticker');
    const settledId = randomUUID();
    const ambiguousId = randomUUID();
    await reserve(run, settledId, 'rni_relationship');
    await reserve(run, ambiguousId, 'rni_classifier', HASH_B);
    const settled = await pool.query<{ actual: string }>(
      `select rni_settle_ai_invocation($1, $2, 'resp-1', 'succeeded', 100, 20, 50, 0)::text as actual`,
      [settledId, HASH_A],
    );
    expect(Number(settled.rows[0]!.actual)).toBeCloseTo(0.15);
    const replay = await pool.query<{ actual: string }>(
      `select rni_settle_ai_invocation($1, $2, 'resp-1', 'succeeded', 100, 20, 50, 0)::text as actual`,
      [settledId, HASH_A],
    );
    expect(replay.rows[0]!.actual).toBe(settled.rows[0]!.actual);
    await expect(
      pool.query(
        `select rni_settle_ai_invocation($1, $2, 'resp-other', 'succeeded', 100, 20, 50, 0)`,
        [settledId, HASH_A],
      ),
    ).rejects.toThrow(/differs from the committed result/u);
    const exposure = await pool.query<{ spend: string }>(
      `select rni_ai_effective_spend('test', now() - interval '1 hour',
              now() + interval '1 hour', $1)::text as spend`,
      [run.runId],
    );
    expect(Number(exposure.rows[0]!.spend)).toBeCloseTo(1.15);
  });

  it('stores monthly warning evidence at most once under concurrency', async () => {
    const seed = await seedGovernedConfig();
    const insert = () =>
      pool.query(
        `insert into rni_ai_budget_warning (
           config_version, environment, period_start, warning_code, effective_usd
         ) values ($1, 'test', date_trunc('month', now()), 'monthly_warning', 300)
         on conflict do nothing returning warning_code`,
        [seed.configVersion],
      );
    const outcomes = await Promise.all([insert(), insert(), insert()]);
    expect(outcomes.flatMap(({ rows }) => rows)).toHaveLength(1);
  });
});
