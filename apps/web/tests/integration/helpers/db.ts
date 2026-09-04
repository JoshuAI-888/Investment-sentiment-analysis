import pg from 'pg';
import { migrate } from '../../../src/repositories/migrate';

pg.types.setTypeParser(1700, (value) => value);
pg.types.setTypeParser(20, (value) => value);

/**
 * Integration tests need a real Postgres — the properties under test (append-only triggers,
 * partial unique indexes, check constraints) exist only in the database. There is no useful
 * mock of a constraint.
 */
export function databaseUrl(): string | undefined {
  const url = process.env['DATABASE_URL'];
  return url === undefined || url === '' ? undefined : url;
}

export function makePool(): pg.Pool {
  const url = databaseUrl();
  if (url === undefined) throw new Error('DATABASE_URL is not set');
  return new pg.Pool({ connectionString: url, max: 4 });
}

export async function resetSchema(pool: pg.Pool): Promise<void> {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(pool);
}

/** Every table, so a test can clear state between cases without re-running migrations. */
export async function truncateAll(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name <> 'schema_migration'`,
  );
  if (rows.length === 0) return;
  const list = rows.map((row) => `"${row.table_name}"`).join(', ');
  // The append-only triggers reject DELETE but not TRUNCATE, which is what makes this usable
  // as a test fixture without weakening the trigger.
  await pool.query(`truncate table ${list} restart identity cascade`);
}
