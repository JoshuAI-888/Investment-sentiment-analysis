import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import { seedUniverse, universeSeedFile } from '../../src/repositories/universe-seed';
import { closePool, getPool } from '../../src/repositories/client';
import { activateConfigVersion, insertConfigVersion } from '../../src/repositories/versions';

const url = databaseUrl();

const AUDIT = {
  actorId: 'owner',
  actorRole: 'admin',
  reason: 'seed test',
  requestId: 'r',
  correlationId: 'c',
};

const SEED = universeSeedFile.parse({
  seededAt: '2026-09-01',
  basis: '100 most-discussed on Reddit, ranked via ApeWisdom (D-30)',
  symbols: [
    { symbol: 'NVDA', exchange: 'NASDAQ' },
    { symbol: 'TSLA', exchange: 'NASDAQ' },
    { symbol: 'GME', exchange: 'NYSE' },
  ],
});

describe.skipIf(url === undefined)('F03 §4.4 — the universe seed is idempotent', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
    getPool(url);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
    const config = await insertConfigVersion({
      environment: 'test',
      createdBy: 'owner',
      changeReason: 'bootstrap',
      checksum: 'sum',
    });
    await activateConfigVersion('test', config.id, AUDIT);

    for (const entry of SEED.symbols) {
      await pool.query(
        `insert into security (symbol, name, exchange, asset_type, currency)
         values ($1, $2, $3, 'equity', 'USD')`,
        [entry.symbol, `${entry.symbol} Inc`, entry.exchange],
      );
    }
  });

  afterAll(async () => {
    await closePool();
    await pool?.end();
  });

  async function counts() {
    const { rows } = await pool.query<{ versions: string; members: string }>(
      `select (select count(*) from universe_version)::text as versions,
              (select count(*) from universe_member)::text as members`,
    );
    return { versions: Number(rows[0]?.versions), members: Number(rows[0]?.members) };
  }

  it('seeds once and creates an active version with every member', async () => {
    const outcome = await seedUniverse('test', SEED);
    expect(outcome.seeded).toBe(true);
    expect(await counts()).toEqual({ versions: 1, members: 3 });
  });

  it('is idempotent across three runs', async () => {
    await seedUniverse('test', SEED);
    const after1 = await counts();
    await seedUniverse('test', SEED);
    await seedUniverse('test', SEED);
    expect(await counts()).toEqual(after1);
  });

  it('reports that it did nothing rather than silently succeeding', async () => {
    await seedUniverse('test', SEED);
    const second = await seedUniverse('test', SEED);
    expect(second.seeded).toBe(false);
    if (second.seeded) return;
    expect(second.reason).toBe('already_seeded');
    expect(second.existingVersions).toBe(1);
  });

  it('never resurrects a symbol an administrator removed', async () => {
    // The rule the whole design turns on. Seeding is gated on "zero universe versions", not on
    // "which symbols are missing" — the second reinstates every removal on every deploy.
    await seedUniverse('test', SEED);

    const { rows } = await pool.query<{ id: string }>(
      `select id from universe_version where environment = 'test'`,
    );
    const version = rows[0]?.id;

    const { rows: removed } = await pool.query<{ id: string }>(
      `select id from security where symbol = 'GME'`,
    );
    await pool.query(
      `update universe_member set enabled = false where universe_version = $1 and security_id = $2`,
      [version, removed[0]?.id],
    );

    await seedUniverse('test', SEED);
    await seedUniverse('test', SEED);

    const { rows: still } = await pool.query<{ enabled: boolean }>(
      `select enabled from universe_member where universe_version = $1 and security_id = $2`,
      [version, removed[0]?.id],
    );
    expect(still[0]?.enabled).toBe(false);
  });

  it('fails rather than seeding a partial universe when a symbol is missing', async () => {
    const withUnknown = universeSeedFile.parse({
      ...SEED,
      symbols: [...SEED.symbols, { symbol: 'NOPE', exchange: 'NASDAQ' }],
    });

    await expect(seedUniverse('test', withUnknown)).rejects.toThrow(/Missing: NOPE@NASDAQ/);
    expect(await counts()).toEqual({ versions: 0, members: 0 });
  });

  it('fails when there is no active config version to record against', async () => {
    await pool.query(`update config_version set status = 'superseded' where status = 'active'`);
    await expect(seedUniverse('test', SEED)).rejects.toThrow(/No active config_version/);
  });

  it('records the seed date, because the selection is circular with the metric', async () => {
    await seedUniverse('test', SEED);
    const { rows } = await pool.query<{ change_reason: string }>(
      `select change_reason from universe_version where environment = 'test'`,
    );
    expect(rows[0]?.change_reason).toContain('2026-09-01');
    expect(rows[0]?.change_reason).toContain('ApeWisdom');
  });

  it('writes an audit event for the seed', async () => {
    await seedUniverse('test', SEED);
    const { rows } = await pool.query<{ action: string; actor_id: string }>(
      `select action, actor_id from audit_event where object_type = 'universe_version'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('seed');
  });
});
