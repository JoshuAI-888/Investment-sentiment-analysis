/**
 * The look-ahead guard (F22 §4.2). **Every historical read goes through here.**
 *
 * It bounds `observed_at <= asOf` **and** `ingested_at <= asOf`. Bounding only the first is the
 * mistake this module exists to prevent, and it is not an obvious mistake: `observed_at` is the
 * column that means "when the fact was true", so bounding it feels like the whole job. But a
 * fact we did not *learn* until later was not available to act on, and a backtest that reads it
 * anyway sees information that did not exist at the time. Its IC is then meaningless in the
 * direction that flatters it.
 *
 * `no-unbounded-pit-read` (F01 §4.3, armed by F22) makes a read of one of these tables outside
 * this module a build failure rather than a review suggestion.
 */
import type { CoverageAxis } from '../contracts/coverage';
import { VALID_TIME_COLUMN, type BitemporalTable } from '../contracts/bitemporal';
import { getPool, type Queryable } from './client';

// One list, shared with the lint rule that enforces this module's use. See ../contracts/bitemporal.
export { BITEMPORAL_TABLES, type BitemporalTable } from '../contracts/bitemporal';

export type AsOfOptions = {
  readonly table: BitemporalTable;
  readonly asOfInstant: Date;
  readonly columns?: string;
  /** Extra predicates, parameterised from $2 onward — $1 is always the as-of instant. */
  readonly where?: string;
  readonly params?: readonly unknown[];
  readonly orderBy?: string;
  readonly limit?: number;
};

/**
 * Builds the SQL. Exported separately from the execution so a test can assert the shape of the
 * predicate without a database — and so the "does the guard fire?" test has something to
 * remove.
 */
export function buildAsOfSql(options: AsOfOptions): string {
  const validTime = VALID_TIME_COLUMN[options.table];
  const columns = options.columns ?? '*';

  const bounds = `${validTime} <= $1 and ingested_at <= $1`;
  const extra = options.where === undefined ? '' : ` and (${options.where})`;
  const order = options.orderBy === undefined ? '' : ` order by ${options.orderBy}`;
  const limit = options.limit === undefined ? '' : ` limit ${options.limit}`;

  return `select ${columns} from ${options.table} where ${bounds}${extra}${order}${limit}`;
}

export async function asOf<T extends Record<string, unknown>>(
  options: AsOfOptions,
  db: Queryable = getPool(),
): Promise<T[]> {
  const sql = buildAsOfSql(options);
  const { rows } = await db.query<T>(sql, [options.asOfInstant, ...(options.params ?? [])]);
  return rows;
}

/**
 * The maximum instant a JS `Date` can represent (year 275760) — never in any real row's past.
 *
 * `asOf`'s bound (`valid_time <= $1 and ingested_at <= $1`) exists for genuine point-in-time
 * reads, where "as of when" is the whole question. It is the wrong tool, unmodified, for a read
 * that already knows a specific row exists by its identity and only needs to fetch it back — a
 * duplicate-insert's read-back being the standing example across `attention.ts`, `market.ts`,
 * `sentiment.ts` and `evidence.ts`. Passing the real "now" there bounds not just `ingested_at`
 * (the intended, load-bearing bound: never read back at the write's own possibly-stale
 * `ingestedAt`) but also the table's valid-time column, which throws the moment that column is
 * legitimately in the future — embargoed content with a future `available_at`, a `market_snapshot`
 * pre/after-hours print timestamped ahead of the collector's clock, or ordinary clock skew — even
 * though the row is real, already committed, and exactly what the caller asked for. `FAR_FUTURE`
 * used as `asOfInstant` keeps the read going through this same guarded helper (rather than a raw,
 * unguarded query the lint rule would have to special-case) while making both bounds a true no-op
 * for any row that could possibly exist, which is exactly the "always knowable, regardless of
 * when" property an identity read-back needs (found by lane-review, round 3).
 */
export const FAR_FUTURE = new Date(8_640_000_000_000_000);

/**
 * The coverage floor for an axis, read from `collector_start`.
 *
 * Never from configuration: a config change would silently move the floor of every historical
 * view built on it, and every one of those views would keep rendering confidently.
 */
export async function coverageFloor(
  axis: CoverageAxis,
  db: Queryable = getPool(),
): Promise<Date | null> {
  const { rows } = await db.query<{ started_at: Date }>(
    'select started_at from collector_start where axis = $1',
    [axis],
  );
  return rows[0]?.started_at ?? null;
}

/**
 * Records the floor. Idempotent by design — the second call is a no-op, not an update, because
 * the table rejects updates outright (0010). A collector restarting must not move the floor.
 */
export async function recordCollectorStart(
  axis: CoverageAxis,
  startedAt: Date,
  note: string,
  db: Queryable = getPool(),
): Promise<{ recorded: boolean; startedAt: Date }> {
  const { rows } = await db.query<{ started_at: Date }>(
    `insert into collector_start (axis, started_at, note)
     values ($1, $2, $3)
     on conflict (axis) do nothing
     returning started_at`,
    [axis, startedAt, note],
  );

  const inserted = rows[0];
  if (inserted !== undefined) return { recorded: true, startedAt: inserted.started_at };

  const existing = await coverageFloor(axis, db);
  if (existing === null) throw new Error(`collector_start for ${axis} vanished mid-insert`);
  return { recorded: false, startedAt: existing };
}
