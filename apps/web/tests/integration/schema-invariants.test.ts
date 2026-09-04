import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema } from './helpers/db';

const url = databaseUrl();

describe.skipIf(url === undefined)('F03 DoD — schema invariants', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  it('has every table source §7.2 requires', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name <> 'schema_migration'`,
    );
    const present = new Set(rows.map((row) => row.table_name));

    // F03 §4.2's 27 named tables.
    const named = [
      'security', 'security_profile_snapshot', 'market_snapshot', 'price_return_snapshot',
      'valuation_snapshot', 'attention_snapshot', 'evidence_item', 'sentiment_snapshot',
      'calculation_snapshot', 'calculation_input', 'calculation_step', 'user_assumption_profile',
      'calculation_share', 'calculation_issue', 'calculation_validation_run', 'research_run',
      'research_event', 'claim_ledger', 'provider_call_log', 'config_version', 'universe_version',
      'model_route', 'provider_policy', 'job_definition', 'raw_provider_payload', 'cost_event',
      'audit_event',
    ];

    // The companion tables defined in the same §7.2 sections. F03 §4.2's count of 27 names only
    // the first table of each section; these seven are load-bearing for F03's own DoD —
    // `universe_member` is what "the seed never resurrects a removed symbol" is about, and
    // `method_registry` is what check:copy's Tier D4 clause reads.
    const companions = [
      'app_setting', 'universe_member', 'data_agreement', 'job_run', 'unit_price_book',
      'budget_policy', 'method_registry',
    ];

    for (const table of [...named, ...companions]) {
      expect(present.has(table), `${table} is missing`).toBe(true);
    }
  });

  it('uses ticker text as no primary or foreign key anywhere', async () => {
    // F03 DoD: "verified by a schema query in a test, not by inspection". A symbol is
    // reassignable; a reassignment must not silently rewrite the prior holder's history.
    const { rows } = await pool.query<{ offender: string }>(
      `select tc.table_name || '.' || kcu.column_name as offender
         from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu
           on kcu.constraint_name = tc.constraint_name
          and kcu.table_schema = tc.table_schema
        where tc.table_schema = 'public'
          and tc.constraint_type in ('PRIMARY KEY', 'FOREIGN KEY')
          and kcu.column_name ~* '(symbol|ticker)'`,
    );
    expect(rows.map((row) => row.offender)).toEqual([]);
  });

  it('stores no user-visible number as a float', async () => {
    const { rows } = await pool.query<{ offender: string }>(
      `select table_name || '.' || column_name || ' (' || data_type || ')' as offender
         from information_schema.columns
        where table_schema = 'public'
          and data_type in ('real', 'double precision', 'money')`,
    );
    expect(rows.map((row) => row.offender)).toEqual([]);
  });

  it('makes every snapshot table bitemporal', async () => {
    // Bitemporality is a valid-time column plus a transaction-time column. Observation tables
    // name them observed_at/ingested_at; DERIVED tables name them differently because the
    // semantics differ — a computed return was never "observed". The map forces a new snapshot
    // table to make that choice explicitly rather than inheriting a name match.
    const TEMPORAL_PAIRS: Record<string, readonly [string, string]> = {
      security_profile_snapshot: ['observed_at', 'ingested_at'],
      market_snapshot: ['observed_at', 'ingested_at'],
      attention_snapshot: ['observed_at', 'ingested_at'],
      sentiment_snapshot: ['observed_at', 'ingested_at'],
      price_return_snapshot: ['as_of_date', 'computed_at'],
      valuation_snapshot: ['as_of_date', 'computed_at'],
      calculation_snapshot: ['input_cutoff', 'computed_at'],
    };

    const { rows } = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name like '%_snapshot'`,
    );

    for (const { table_name } of rows) {
      const pair = TEMPORAL_PAIRS[table_name];
      expect(pair, `${table_name} has no declared temporal pair`).toBeDefined();
      if (pair === undefined) continue;

      const { rows: columns } = await pool.query<{ column_name: string; data_type: string }>(
        `select column_name, data_type from information_schema.columns
          where table_schema = 'public' and table_name = $1 and column_name = any($2)`,
        [table_name, [...pair]],
      );
      expect(columns.map((c) => c.column_name).sort(), `${table_name} is missing ${pair.join('/')}`)
        .toEqual([...pair].sort());
    }
  });

  it('permits at most one active config version per environment', async () => {
    const { rows } = await pool.query<{ indexdef: string }>(
      `select indexdef from pg_indexes
        where schemaname = 'public' and indexname = 'config_version_single_active'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toContain("status = 'active'");
  });

  it('permits at most one active universe version per environment', async () => {
    const { rows } = await pool.query<{ indexdef: string }>(
      `select indexdef from pg_indexes
        where schemaname = 'public' and indexname = 'universe_version_single_active'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('gives cost_event.cost_usd no default at all', async () => {
    // F03 §4.2. A zero default sums into the monthly total as though the call were free, and
    // D-11 left the global ceiling as the only budget control.
    const { rows } = await pool.query<{ column_default: string | null; is_nullable: string }>(
      `select column_default, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'cost_event' and column_name = 'cost_usd'`,
    );
    expect(rows[0]?.is_nullable).toBe('YES');
    expect(rows[0]?.column_default).toBeNull();
  });
});
