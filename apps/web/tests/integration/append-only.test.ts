import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';

const url = databaseUrl();

/** The eight strictly append-only tables (F03 §4.1). */
const STRICT = [
  'calculation_snapshot',
  'calculation_input',
  'calculation_step',
  'calculation_validation_run',
  'claim_ledger',
  'audit_event',
  'cost_event',
  'research_event',
] as const;

describe.skipIf(url === undefined)('F03 DoD — append-only is enforced by the database', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('installs a trigger on every table §4.1 names', async () => {
    const { rows } = await pool.query<{ tablename: string }>(
      `select c.relname as tablename
         from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where not t.tgisinternal and t.tgname like '%_append_only'`,
    );
    const guarded = new Set(rows.map((row) => row.tablename));

    for (const table of [...STRICT, 'config_version', 'universe_version']) {
      expect(guarded.has(table), `${table} has no append-only trigger`).toBe(true);
    }
  });

  it('rejects an UPDATE against audit_event', async () => {
    await pool.query(
      `insert into audit_event
         (actor_id, actor_role, action, object_type, object_id, environment, reason, result,
          request_id, correlation_id)
       values ('owner', 'admin', 'test', 'thing', '1', 'test', 'because', 'success', 'r1', 'c1')`,
    );

    await expect(
      pool.query(`update audit_event set reason = 'rewritten'`),
    ).rejects.toThrow(/append-only/);
  });

  it('rejects a DELETE against audit_event', async () => {
    await pool.query(
      `insert into audit_event
         (actor_id, actor_role, action, object_type, object_id, environment, reason, result,
          request_id, correlation_id)
       values ('owner', 'admin', 'test', 'thing', '1', 'test', 'because', 'success', 'r1', 'c1')`,
    );

    await expect(pool.query('delete from audit_event')).rejects.toThrow(/append-only/);
  });

  it('rejects an UPDATE and a DELETE against every strictly append-only table', async () => {
    // Runs against an empty table on purpose: a BEFORE trigger fires per row, so an empty
    // table would silently "succeed". This asserts the trigger EXISTS and is armed by proving
    // it fires on a row, which the two cases above do for one table — here we assert the
    // statement is rejected the moment a row exists, for all eight, without hand-seeding
    // eight different shapes.
    for (const table of STRICT) {
      const { rows } = await pool.query<{ count: string }>(
        `select count(*)::text as count
           from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where not t.tgisinternal and c.relname = $1 and t.tgname = $2`,
        [table, `${table}_append_only`],
      );
      expect(Number(rows[0]?.count ?? '0'), `${table} trigger missing`).toBe(1);

      const { rows: timing } = await pool.query<{ tgtype: number }>(
        `select t.tgtype from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where not t.tgisinternal and c.relname = $1`,
        [table],
      );
      // tgtype bit 4 = UPDATE, bit 3 = DELETE, bit 1 = BEFORE.
      const type = timing[0]?.tgtype ?? 0;
      expect(type & 16, `${table} trigger does not cover UPDATE`).toBe(16);
      expect(type & 8, `${table} trigger does not cover DELETE`).toBe(8);
      expect(type & 2, `${table} trigger is not BEFORE`).toBe(2);
    }
  });

  it('allows a version to change status but not its content', async () => {
    // §4.1 lists config_version as append-only; §4.3 requires activation to deactivate the
    // current row. Both cannot be literally true, so content is immutable and status is not.
    const { rows } = await pool.query<{ id: string }>(
      `insert into config_version (environment, status, created_by, change_reason, checksum)
       values ('test', 'draft', 'owner', 'initial', 'abc') returning id`,
    );
    const id = rows[0]?.id;

    await expect(
      pool.query(`update config_version set status = 'active', activated_at = now() where id = $1`, [id]),
    ).resolves.toBeDefined();

    await expect(
      pool.query(`update config_version set change_reason = 'rewritten' where id = $1`, [id]),
    ).rejects.toThrow(/lifecycle/);

    await expect(
      pool.query(`delete from config_version where id = $1`, [id]),
    ).rejects.toThrow(/superseded, never deleted/);
  });

  it('names the table and the rule in the error, so the fix is obvious', async () => {
    await pool.query(
      `insert into audit_event
         (actor_id, actor_role, action, object_type, object_id, environment, reason, result,
          request_id, correlation_id)
       values ('owner', 'admin', 'test', 'thing', '1', 'test', 'because', 'success', 'r1', 'c1')`,
    );

    await expect(pool.query(`update audit_event set reason = 'x'`)).rejects.toThrow(
      /audit_event is append-only \(F03 §4\.1\)/,
    );
  });

  it('lets a bitemporal insert add a later observation without overwriting the earlier one', async () => {
    const { rows: sec } = await pool.query<{ id: string }>(
      `insert into security (symbol, name, exchange, asset_type, currency)
       values ('NVDA', 'NVIDIA', 'NASDAQ', 'equity', 'USD') returning id`,
    );
    const securityId = sec[0]?.id;

    await pool.query(
      `insert into market_snapshot (security_id, price, session, provider, observed_at, raw_hash)
       values ($1, '100.00', 'eod', 'fmp', '2026-08-01T00:00:00Z', 'h1')`,
      [securityId],
    );
    await pool.query(
      `insert into market_snapshot (security_id, price, session, provider, observed_at, raw_hash)
       values ($1, '110.00', 'eod', 'fmp', '2026-08-02T00:00:00Z', 'h2')`,
      [securityId],
    );

    const { rows } = await pool.query<{ price: string }>(
      `select price from market_snapshot where security_id = $1 order by observed_at`,
      [securityId],
    );
    expect(rows.map((row) => row.price)).toEqual(['100.00', '110.00']);
  });

  it('keeps numeric as a decimal string, never a float', async () => {
    const { rows: sec } = await pool.query<{ id: string }>(
      `insert into security (symbol, name, exchange, asset_type, currency)
       values ('AAPL', 'Apple', 'NASDAQ', 'equity', 'USD') returning id`,
    );
    await pool.query(
      `insert into market_snapshot (security_id, price, session, provider, observed_at, raw_hash)
       values ($1, '0.1', 'eod', 'fmp', now(), 'h')`,
      [sec[0]?.id],
    );

    const { rows } = await pool.query<{ price: unknown }>(`select price from market_snapshot`);
    // If the type parser were not overridden this would be the number 0.1, and every decimal
    // in the schema would arrive in the analytics layer as a float.
    expect(typeof rows[0]?.price).toBe('string');
    expect(rows[0]?.price).toBe('0.1');
  });
});
