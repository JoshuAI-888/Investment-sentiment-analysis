import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import { asOf, buildAsOfSql, coverageFloor, recordCollectorStart } from '../../src/repositories/as-of';
import { closePool, getPool } from '../../src/repositories/client';

const url = databaseUrl();

/**
 * F22 §7 review step 1: *"Delete the look-ahead guard and run the test suite. If it stays green,
 * the guard is decoration and the PR does not merge."*
 *
 * These tests are built so that they cannot stay green. Each guarded assertion is paired with
 * the same query minus the guard, and the unguarded arm is asserted to return the row the
 * guarded arm excludes. If the `ingested_at` bound is deleted from `buildAsOfSql`, the two arms
 * return the same rows and the pairing fails — which is the property "a test proving it fires"
 * actually means.
 */
const AS_OF = new Date('2026-06-01T00:00:00Z');

/** The same query with the transaction-time bound removed. */
function withoutGuard(sql: string): string {
  const stripped = sql.replace(/\s+and ingested_at <= \$1/, '');
  if (stripped === sql) {
    throw new Error(
      'buildAsOfSql produced no `ingested_at <= $1` bound to strip. The look-ahead guard is gone, and every historical read is now free to see facts that did not exist yet (F22 §4.2).',
    );
  }
  return stripped;
}

describe.skipIf(url === undefined)('F22 §4.2 — the look-ahead guard', () => {
  let pool: pg.Pool;
  let securityId: string;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
    getPool(url);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
    const { rows } = await pool.query<{ id: string }>(
      `insert into security (symbol, name, exchange, asset_type, currency)
       values ('NVDA', 'NVIDIA', 'NASDAQ', 'equity', 'USD') returning id`,
    );
    securityId = rows[0]?.id as string;

    // Two facts about the SAME instant. One we knew at the time; one we learned a month later.
    await pool.query(
      `insert into market_snapshot (security_id, price, session, provider, observed_at, ingested_at, raw_hash)
       values ($1, '100.00', 'eod', 'fmp', '2026-05-01T00:00:00Z', '2026-05-01T01:00:00Z', 'known-then')`,
      [securityId],
    );
    await pool.query(
      `insert into market_snapshot (security_id, price, session, provider, observed_at, ingested_at, raw_hash)
       values ($1, '111.00', 'eod', 'fmp', '2026-05-01T00:00:00Z', '2026-07-01T00:00:00Z', 'learned-later')`,
      [securityId],
    );
  });

  afterAll(async () => {
    await closePool();
    await pool?.end();
  });

  it('bounds both temporal columns in the SQL it builds', () => {
    const sql = buildAsOfSql({ table: 'market_snapshot', asOfInstant: AS_OF });
    expect(sql).toContain('observed_at <= $1');
    expect(sql).toContain('ingested_at <= $1');
  });

  it('excludes a fact ingested after the as-of instant', async () => {
    const rows = await asOf<{ raw_hash: string }>({
      table: 'market_snapshot',
      asOfInstant: AS_OF,
      columns: 'raw_hash',
    });
    expect(rows.map((row) => row.raw_hash)).toEqual(['known-then']);
  });

  it('fails if the guard is removed — the unguarded query sees the future', async () => {
    // The pairing. This is the assertion §7 step 1 asks for: if the ingested_at bound were
    // deleted from buildAsOfSql, `withoutGuard` throws, and if it were somehow still stripped
    // the two arms would agree and the inequality below would fail.
    const sql = buildAsOfSql({ table: 'market_snapshot', asOfInstant: AS_OF, columns: 'raw_hash' });

    const guarded = await pool.query<{ raw_hash: string }>(sql, [AS_OF]);
    const unguarded = await pool.query<{ raw_hash: string }>(withoutGuard(sql), [AS_OF]);

    expect(guarded.rows.map((r) => r.raw_hash)).toEqual(['known-then']);
    expect(unguarded.rows.map((r) => r.raw_hash).sort()).toEqual(['known-then', 'learned-later']);
    expect(guarded.rows.length).toBeLessThan(unguarded.rows.length);
  });

  it('includes the late fact once the as-of instant reaches it', async () => {
    // The guard excludes by knowability, not permanently. Asked as of July, both facts existed.
    const rows = await asOf<{ raw_hash: string }>({
      table: 'market_snapshot',
      asOfInstant: new Date('2026-08-01T00:00:00Z'),
      columns: 'raw_hash',
    });
    expect(rows.map((row) => row.raw_hash).sort()).toEqual(['known-then', 'learned-later']);
  });

  it('guards evidence_item on available_at, not published_at', async () => {
    // published_at is when the author wrote it. available_at is when the provider let us see it.
    // Bounding the wrong one reads a filing the day it was dated rather than the day it landed.
    await pool.query(
      `insert into evidence_item
         (evidence_type, provider, title, published_at, available_at, ingested_at,
          license_class, coverage_class, raw_hash)
       values ('news', 'marketaux', 'Late arrival', '2026-05-01T00:00:00Z',
               '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z', 'snippet', 'sample', 'late')`,
    );

    const sql = buildAsOfSql({ table: 'evidence_item', asOfInstant: AS_OF, columns: 'raw_hash' });
    expect(sql).toContain('available_at <= $1');
    expect(sql).not.toContain('published_at');

    const rows = await asOf<{ raw_hash: string }>({
      table: 'evidence_item',
      asOfInstant: AS_OF,
      columns: 'raw_hash',
    });
    expect(rows).toHaveLength(0);
  });

  it('accepts extra predicates without losing the bounds', async () => {
    const rows = await asOf<{ raw_hash: string }>({
      table: 'market_snapshot',
      asOfInstant: new Date('2026-08-01T00:00:00Z'),
      columns: 'raw_hash',
      where: 'security_id = $2',
      params: [securityId],
    });
    expect(rows).toHaveLength(2);

    const sql = buildAsOfSql({
      table: 'market_snapshot',
      asOfInstant: AS_OF,
      where: 'security_id = $2',
    });
    expect(sql).toContain('ingested_at <= $1');
  });
});

describe.skipIf(url === undefined)('F22 DoD 10 — the coverage floor is written once', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
    getPool(url);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
  });

  afterAll(async () => {
    await closePool();
    await pool?.end();
  });

  it('records the floor on first collection', async () => {
    const first = new Date('2026-09-01T00:00:00Z');
    const outcome = await recordCollectorStart('reddit', first, 'first observed item');
    expect(outcome.recorded).toBe(true);
    expect((await coverageFloor('reddit'))?.toISOString()).toBe(first.toISOString());
  });

  it('does not move the floor when the collector restarts', async () => {
    const first = new Date('2026-09-01T00:00:00Z');
    await recordCollectorStart('reddit', first, 'first observed item');

    const second = await recordCollectorStart('reddit', new Date('2026-10-01T00:00:00Z'), 'restart');
    expect(second.recorded).toBe(false);
    expect(second.startedAt.toISOString()).toBe(first.toISOString());
  });

  it('refuses an UPDATE at the database level', async () => {
    await recordCollectorStart('reddit', new Date('2026-09-01T00:00:00Z'), 'first');
    await expect(
      pool.query(`update collector_start set started_at = now() where axis = 'reddit'`),
    ).rejects.toThrow(/written once per axis/);
  });

  it('refuses a DELETE at the database level', async () => {
    await recordCollectorStart('reddit', new Date('2026-09-01T00:00:00Z'), 'first');
    await expect(pool.query(`delete from collector_start where axis = 'reddit'`)).rejects.toThrow(
      /written once per axis/,
    );
  });

  it('tracks each axis independently', async () => {
    // X starts later than Reddit — it is trigger-sampled and D-32 funds it at zero to begin
    // with. Per-axis floors are what stop a cross-platform comparison hiding that asymmetry.
    await recordCollectorStart('reddit', new Date('2026-09-01T00:00:00Z'), 'first');
    await recordCollectorStart('x', new Date('2026-11-15T00:00:00Z'), 'first trigger fired');

    expect((await coverageFloor('reddit'))?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect((await coverageFloor('x'))?.toISOString()).toBe('2026-11-15T00:00:00.000Z');
    expect(await coverageFloor('substack')).toBeNull();
  });
});
