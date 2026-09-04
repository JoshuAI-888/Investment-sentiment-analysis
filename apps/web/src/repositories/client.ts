/**
 * The database client. **SQL lives only in `repositories/`** (F03 DoD item 9), and this module
 * is the door every repository goes through.
 *
 * Two decisions worth stating, because both are the kind that get reversed by accident:
 *
 * **`numeric` is parsed as a string, always.** node-postgres parses `numeric` (OID 1700) into a
 * JavaScript number by default, which silently converts every decimal in the schema into a
 * float at the boundary — the exact defect `no-float-in-analytics` exists to prevent inside the
 * analytics modules, arriving from underneath them. The parser is overridden below.
 *
 * **`int8` is parsed as a string too.** `config_version` and `universe_version` are `bigserial`.
 * They are small today, and `Number` would be fine today, which is precisely why the wrong
 * behaviour would never be noticed.
 */
import pg from 'pg';

// OID 1700 = numeric/decimal. Identity, not Number.
pg.types.setTypeParser(1700, (value) => value);
// OID 20 = int8/bigint.
pg.types.setTypeParser(20, (value) => value);

export type Queryable = {
  query: <R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ) => Promise<pg.QueryResult<R>>;
};

let pool: pg.Pool | undefined;

export function getPool(connectionString?: string): pg.Pool {
  if (pool !== undefined) return pool;

  const url = connectionString ?? process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error(
      'DATABASE_URL is not set. Repositories require a database; in fixture mode the services above them should not be reaching one at all.',
    );
  }

  pool = new pg.Pool({ connectionString: url, max: 10 });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool === undefined) return;
  const closing = pool;
  pool = undefined;
  await closing.end();
}

/**
 * Runs `fn` inside a transaction, rolling back on any throw.
 *
 * F03 §4.3's activation is the reason this exists rather than being inlined: "a failed
 * activation leaves the previous version active" is a property of the rollback, not of the
 * happy path, and a hand-rolled BEGIN/COMMIT gets its error branch wrong eventually.
 */
export async function withTransaction<T>(
  fn: (tx: Queryable) => Promise<T>,
  poolOverride?: pg.Pool,
): Promise<T> {
  const client = await (poolOverride ?? getPool()).connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
