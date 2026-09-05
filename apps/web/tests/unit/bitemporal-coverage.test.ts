import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BITEMPORAL_TABLES,
  NOT_A_FACT_TABLE,
  VALID_TIME_COLUMN,
} from '../../src/contracts/bitemporal';

/**
 * The list in `contracts/bitemporal.ts` arms both the `asOf` guard and the lint rule. A table
 * that is bitemporal in the schema but missing from that list is unguarded, and **nothing else
 * reports it** — the lint passes because it was never told to look, and the guard is simply
 * never used.
 *
 * So the list is checked against the migrations rather than trusted. This is the same shape as
 * the `tracked-sources` guard: the failure is an absence, and absences do not announce
 * themselves.
 */
const MIGRATIONS = fileURLToPath(new URL('../../migrations/', import.meta.url));

async function migrationSql(): Promise<string> {
  const files = (await readdir(MIGRATIONS)).filter((name) => name.endsWith('.sql')).sort();
  const parts = await Promise.all(
    files.map((name) => readFile(path.join(MIGRATIONS, name), 'utf8')),
  );
  return parts.join('\n');
}

describe('the bitemporal table list matches the schema', () => {
  it('lists every table that carries both a valid-time and an ingested_at column', async () => {
    const sql = await migrationSql();

    // Every `create table X (...)` block, and whether it declares ingested_at.
    const blocks = [...sql.matchAll(/create table (\w+) \(([\s\S]*?)\n\);/g)];
    expect(blocks.length).toBeGreaterThan(20);

    const carriesIngestedAt = blocks
      .filter(([, , body]) => body !== undefined && /\bingested_at\b/.test(body))
      .map(([, name]) => name)
      .filter((name): name is string => name !== undefined);

    // Every table with the column is either guarded or explicitly excused, with a reason. A new
    // one is neither, so it fails here — which is the point: the choice gets made deliberately
    // rather than by whichever list somebody happened to edit.
    const unaccounted = carriesIngestedAt.filter(
      (table) =>
        !(BITEMPORAL_TABLES as readonly string[]).includes(table) &&
        NOT_A_FACT_TABLE[table] === undefined,
    );
    expect(unaccounted, 'these carry ingested_at but are neither guarded nor excused').toEqual([]);

    // And every guarded table really does carry the column.
    expect([...BITEMPORAL_TABLES].sort()).toEqual(
      carriesIngestedAt.filter((t) => (BITEMPORAL_TABLES as readonly string[]).includes(t)).sort(),
    );
  });

  it('names a valid-time column for every listed table', () => {
    for (const table of BITEMPORAL_TABLES) {
      expect(VALID_TIME_COLUMN[table], `${table} has no valid-time column`).toBeTruthy();
    }
  });

  it('bounds evidence_item on available_at rather than published_at', () => {
    // published_at is when the author wrote it; available_at is when we could have seen it.
    // Bounding the wrong one reads a filing on the day it is dated rather than the day it lands.
    expect(VALID_TIME_COLUMN.evidence_item).toBe('available_at');
  });

  it('carries ingested_at in every bitemporal primary key', async () => {
    // F22 §4.1: never overwrite, insert a successor. With ingested_at outside the key a
    // revision collides with the row it revises, and the only way to store it is the UPDATE
    // that §4.1 forbids — which deletes the value that was knowable at the time.
    const sql = await migrationSql();

    // Tables whose identity is a surrogate uuid, where this property holds trivially: every
    // insert is a new row, so a revision cannot collide with what it revises and there is no
    // composite key to inspect. Named with the reason rather than skipped silently, because
    // "this table has no composite primary key" and "someone forgot ingested_at" look identical
    // to the regex below.
    const SURROGATE_KEYED: Record<string, string> = {
      evidence_item: 'surrogate uuid key; revisions are new rows',
      attention_board_snapshot:
        'surrogate uuid key, and necessarily so: its natural identity includes `ticker`, and F03 ' +
        'forbids ticker text in any primary or foreign key schema-wide. Identity is a unique ' +
        'INDEX over (source, board, ticker, observed_at, ingested_at) instead — which carries ' +
        'ingested_at, so the property this case is about is still enforced, just not by a pkey.',
    };

    for (const table of BITEMPORAL_TABLES) {
      if (SURROGATE_KEYED[table] !== undefined) continue;
      const pk = new RegExp(`${table}_pkey\\s+primary key \\(([^)]*)\\)`).exec(sql);
      expect(pk, `${table} has no primary key declaration to check`).not.toBeNull();
      expect(pk?.[1], `${table}'s primary key omits ingested_at`).toContain('ingested_at');
    }
  });
});
