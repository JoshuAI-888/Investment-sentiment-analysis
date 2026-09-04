/**
 * The migration runner. Applies `migrations/*.sql` in filename order, once each, recording a
 * checksum so an edited migration is detected rather than silently skipped.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Queryable } from './client';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

export type Migration = { readonly filename: string; readonly sql: string; readonly checksum: string };

export async function loadMigrations(dir: string = MIGRATIONS_DIR): Promise<Migration[]> {
  const entries = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort();

  return Promise.all(
    entries.map(async (filename) => {
      const sql = await readFile(path.join(dir, filename), 'utf8');
      return { filename, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    }),
  );
}

export type MigrationOutcome = {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
};

export async function migrate(db: Queryable, dir?: string): Promise<MigrationOutcome> {
  const migrations = await loadMigrations(dir);
  const applied: string[] = [];
  const skipped: string[] = [];

  // The ledger has to exist before it can be read, and it is itself a migration file.
  const ledger = migrations.find((m) => m.filename.startsWith('0000_'));
  if (ledger === undefined) throw new Error('0000_migration_ledger.sql is missing');
  await db.query(ledger.sql);

  const { rows } = await db.query<{ filename: string; checksum: string }>(
    'select filename, checksum from schema_migration',
  );
  const seen = new Map(rows.map((row) => [row.filename, row.checksum]));

  for (const migration of migrations) {
    const previous = seen.get(migration.filename);

    if (previous !== undefined) {
      if (previous !== migration.checksum) {
        throw new Error(
          `Migration ${migration.filename} has changed since it was applied (checksum ${previous.slice(0, 12)} → ${migration.checksum.slice(0, 12)}). ` +
            'An edited migration produces environments whose schemas disagree without anything reporting it. Add a new migration instead.',
        );
      }
      skipped.push(migration.filename);
      continue;
    }

    if (migration.filename.startsWith('0000_')) {
      // Applied above; record it like any other.
      await db.query('insert into schema_migration (filename, checksum) values ($1, $2)', [
        migration.filename,
        migration.checksum,
      ]);
      applied.push(migration.filename);
      continue;
    }

    await db.query(migration.sql);
    await db.query('insert into schema_migration (filename, checksum) values ($1, $2)', [
      migration.filename,
      migration.checksum,
    ]);
    applied.push(migration.filename);
  }

  return { applied, skipped };
}
