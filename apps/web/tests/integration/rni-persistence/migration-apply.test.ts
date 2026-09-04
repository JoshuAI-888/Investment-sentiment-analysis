import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { loadMigrations, migrate } from '../../../src/repositories/migrate';
import { databaseUrl, makePool } from '../helpers/db';

const url = databaseUrl();
const RNI_MIGRATIONS = [
  '0020_rni_sources.sql',
  '0021_rni_observations.sql',
  '0022_rni_claims_narratives.sql',
  '0023_rni_platform_slices.sql',
] as const;

describe.skipIf(url === undefined)('RNI D09 migration verification', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = makePool();
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('applies migrations 0020-0023 on a clean schema and then skips them idempotently', async () => {
    await pool.query('drop schema public cascade; create schema public');
    const first = await migrate(pool);
    for (const filename of RNI_MIGRATIONS) expect(first.applied).toContain(filename);

    const second = await migrate(pool);
    for (const filename of RNI_MIGRATIONS) expect(second.skipped).toContain(filename);
    expect(second.applied).toEqual([]);
  });

  it('forward-applies RNI migrations over the populated legacy schema without rewriting it', async () => {
    await pool.query('drop schema public cascade; create schema public');
    const migrations = await loadMigrations();
    const legacyMigrations = migrations.filter((migration) => migration.filename < '0020_');
    for (const migration of legacyMigrations) {
      await pool.query(migration.sql);
      await pool.query('insert into schema_migration (filename, checksum) values ($1, $2)', [
        migration.filename,
        migration.checksum,
      ]);
    }

    const { rows } = await pool.query<{ id: string }>(
      `insert into security (symbol, name, exchange, asset_type, currency)
       values ('LEG', 'Legacy Security', 'NYSE', 'equity', 'USD') returning id`,
    );
    const legacySecurityId = rows[0]!.id;

    const outcome = await migrate(pool);
    for (const filename of RNI_MIGRATIONS) expect(outcome.applied).toContain(filename);
    const { rows: legacyRows } = await pool.query<{ symbol: string; name: string }>(
      'select symbol, name from security where id = $1',
      [legacySecurityId],
    );
    expect(legacyRows).toEqual([{ symbol: 'LEG', name: 'Legacy Security' }]);

    const { rows: rniTables } = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name in (
          'rni_source_item', 'rni_security_observation', 'rni_evidence_claim',
          'rni_platform_slice'
        )`,
    );
    expect(rniTables).toHaveLength(4);
  });
});
