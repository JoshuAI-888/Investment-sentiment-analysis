/**
 * `market_snapshot` and `price_return_snapshot` (F09 §4.1/§4.2, F06's `price.regime` /
 * `technical.*` methods). SQL lives here and nowhere else (F03 DoD item 9).
 *
 * ## `market_snapshot`: the same idempotency discipline as `attention.ts`
 *
 * `market_snapshot`'s primary key is `(security_id, provider, observed_at, ingested_at)`
 * (migration `0011` — F22 found the same defect here it found on every other bitemporal
 * snapshot table: without `ingested_at` in the key, a corrected price can only be stored as an
 * UPDATE, which erases the value that was actually knowable at the time). `insertMarketSnapshot`
 * therefore follows `attention.ts`'s exact pattern: a repeated, identical observation
 * (`security_id`, `provider`, `observed_at`, `raw_hash` all match) is a no-op; a genuine
 * revision (same identity, different `raw_hash`) writes a successor row, never an UPDATE. See
 * `attention.ts`'s module docstring for the full reasoning, including the one thing this
 * pattern still cannot guarantee without a schema change (a truly concurrent double-dispatch
 * whose `ingested_at` values collide to the microsecond) — the `23505` catch below exists for
 * exactly that case.
 *
 * `marketSnapshotHistory` is the stored-data analogue of `adapters/market.ts`'s `DailyBar` that
 * F07's live dashboard path builds from a provider call — this reads the same shape from
 * `market_snapshot` rows instead, which is what lets F09's ticker page and F06's `price.regime`
 * / `technical.*` methods assemble an ordered close-price series **with no provider call in the
 * read path** (F09 DoD item 1). Filtering to `session: 'eod'` is how a caller gets a genuine
 * daily-bar series rather than a mix of intraday and end-of-day prints.
 *
 * ## `price_return_snapshot`: a different idempotency shape, because the schema is different
 *
 * Unlike every table above, `price_return_snapshot` carries **no `raw_hash` and no
 * `ingested_at`** — migration `0002` gives it a plain primary key,
 * `(security_id, as_of_date, horizon_calendar_days, provider, method_version)`, and `0011` does
 * not touch it. That primary key is already the full natural identity (there is no separate
 * "collector run" to retry idempotently against), so `insertPriceReturnSnapshot` uses a real
 * `on conflict ... do nothing`, not the manual `where not exists` + catch pattern above. This is
 * strictly stronger — Postgres itself serializes a genuine concurrent race on this table, so
 * there is no `23505` to catch, ever. A revision that must change a stored total return is
 * only representable by bumping `method_version`, the same discipline `attention_snapshot`
 * already applies to `provider_methodology_version` (F-05 / R-03): a silent value change under
 * the same identity is not supported by this schema, and this repository does not attempt to
 * paper over that with a `do update` — a caller that needs to correct a return recomputes it
 * under a new `method_version`.
 *
 * **F09 §4.2 / schema mismatch, reported rather than papered over.** F09 §4.2 asks for "5d/20d
 * returns". `price_return_snapshot`'s `horizon_calendar_days` check constraint only accepts
 * `7, 30, 90, 180` (calendar days) — there is no legal way to store a 5-trading-day or
 * 20-trading-day horizon under this schema, and 7/30 calendar days are not the same measurement
 * as 5/20 *trading* days. This module accepts only the four legal values (mirroring the zod
 * contract's own `z.union([z.literal(7), ...])`) rather than inventing a horizon the check
 * constraint would reject. See this feature's `CONTRACTS` report line.
 *
 * Reads are bounded by `computed_at <= asOfInstant` even though this table is not in
 * `contracts/bitemporal.ts` and so is not subject to `no-unbounded-pit-read` — a return is a
 * derived fact that could in principle be recomputed after the fact (a baseline price
 * correction), and nothing should read a return that was not yet computed as of the instant it
 * is reading at, even though the guard module itself does not enforce this for a table with no
 * `ingested_at` column.
 */
import {
  marketSnapshot,
  priceReturnSnapshot,
  type MarketSnapshot,
  type PriceReturnSnapshot,
} from '../contracts/security';
import { camelizeRow, type Row } from './rows';
import { getPool, type Queryable } from './client';
import { asOf, FAR_FUTURE } from './as-of';

/** `marketSnapshot['session']` is not exported as its own type by `contracts/security.ts`. */
type MarketSession = MarketSnapshot['session'];

const MARKET_SNAPSHOT_COLUMNS =
  'security_id, price, change_percent, session, provider, observed_at, ingested_at, raw_hash';

export type NewMarketSnapshot = Omit<MarketSnapshot, 'ingestedAt'> & {
  ingestedAt?: MarketSnapshot['ingestedAt'] | string;
};

export type MarketSnapshotWrite = {
  readonly snapshot: MarketSnapshot;
  /** `false` when an identical `(security_id, provider, observed_at, raw_hash)` row already existed. */
  readonly inserted: boolean;
};

/** Writes one observation. See the module docstring for the no-UPDATE / successor-row discipline. */
export async function insertMarketSnapshot(
  input: NewMarketSnapshot,
  db: Queryable = getPool(),
): Promise<MarketSnapshotWrite> {
  const ingestedAt = input.ingestedAt ?? new Date();
  const values = [
    input.securityId,
    input.price,
    input.changePercent,
    input.session,
    input.provider,
    input.observedAt,
    ingestedAt,
    input.rawHash,
  ];

  let inserted: Row | undefined;
  try {
    const { rows } = await db.query(
      `insert into market_snapshot (${MARKET_SNAPSHOT_COLUMNS})
       select $1, $2, $3, $4, $5, $6, $7, $8
       where not exists (
         select 1 from market_snapshot
         where security_id = $1 and provider = $5 and observed_at = $6 and raw_hash = $8
       )
       returning ${MARKET_SNAPSHOT_COLUMNS}`,
      values,
    );
    inserted = rows[0] as Row | undefined;
  } catch (error) {
    const isUniqueViolation =
      typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';
    if (!isUniqueViolation) throw error;
    inserted = undefined;
  }

  if (inserted !== undefined) {
    return { snapshot: marketSnapshot.parse(camelizeRow(inserted)), inserted: true };
  }

  return { snapshot: await readBackExistingMarketSnapshot(input, db), inserted: false };
}

/**
 * Reads back the row an `insertMarketSnapshot` call just found to already exist. This is an
 * identity lookup, not a point-in-time query — the `where not exists` check moments earlier
 * already established the row is there — so it goes through `asOf` with `FAR_FUTURE`, not the
 * real "now", as the bound. Passing real "now" (an earlier version of this function did) throws
 * whenever the row's `observed_at` is legitimately in the future — a pre/after-hours print
 * timestamped ahead of the collector's clock, or ordinary clock skew — treating a successful
 * idempotent retry as a failure (lane-review round 3, finding 2). See `as-of.ts`'s `FAR_FUTURE`
 * docstring for the full reasoning.
 */
async function readBackExistingMarketSnapshot(
  input: Pick<NewMarketSnapshot, 'securityId' | 'provider' | 'observedAt'>,
  db: Queryable,
): Promise<MarketSnapshot> {
  const existingRows = await asOf<Row>(
    {
      table: 'market_snapshot',
      asOfInstant: FAR_FUTURE,
      columns: MARKET_SNAPSHOT_COLUMNS,
      where: 'security_id = $2 and provider = $3 and observed_at = $4',
      params: [input.securityId, input.provider, input.observedAt],
      orderBy: 'ingested_at desc',
      limit: 1,
    },
    db,
  );
  const existing = existingRows[0];
  if (existing === undefined) {
    throw new Error(
      'market_snapshot insert reported an existing duplicate but the row could not be read back',
    );
  }
  return marketSnapshot.parse(camelizeRow(existing));
}

export type MarketSnapshotQuery = {
  readonly securityId: string;
  readonly asOfInstant: Date;
  readonly provider?: string;
  /** Filters to one session — pass `'eod'` for a genuine daily-bar series. Omitted: any session. */
  readonly session?: MarketSession;
};

const DEFAULT_MARKET_HISTORY_LIMIT = 200;

/**
 * A bounded, as-of-correct read: at most one row per distinct `observed_at`, the most recent
 * `ingested_at` known as of `asOfInstant`. Ordered most-recent-first, like
 * `attentionSnapshotHistory` — a caller building a chronological series re-sorts, the same way
 * `services/dashboard/inputs.ts` already re-sorts `DailyBar[]` before use.
 */
export async function marketSnapshotHistory(
  query: MarketSnapshotQuery & { readonly limit?: number },
  db: Queryable = getPool(),
): Promise<MarketSnapshot[]> {
  // `asOf` always binds `$1` to `asOfInstant` itself; every param passed here starts at `$2`.
  const predicates: string[] = ['security_id = $2'];
  const params: unknown[] = [query.securityId];

  if (query.provider !== undefined) {
    params.push(query.provider);
    predicates.push(`provider = $${params.length + 1}`);
  }
  if (query.session !== undefined) {
    params.push(query.session);
    predicates.push(`session = $${params.length + 1}`);
  }

  const where = predicates.join(' and ');

  const rows = await asOf<Row>(
    {
      table: 'market_snapshot',
      asOfInstant: query.asOfInstant,
      columns: `distinct on (observed_at) ${MARKET_SNAPSHOT_COLUMNS}`,
      where,
      params,
      orderBy: 'observed_at desc, ingested_at desc',
      limit: query.limit ?? DEFAULT_MARKET_HISTORY_LIMIT,
    },
    db,
  );
  return rows.map((row) => marketSnapshot.parse(camelizeRow(row)));
}

/** The single most recent comparable observation, as of `asOfInstant`. `null` if there is none. */
export async function latestMarketSnapshot(
  query: MarketSnapshotQuery,
  db: Queryable = getPool(),
): Promise<MarketSnapshot | null> {
  const [row] = await marketSnapshotHistory({ ...query, limit: 1 }, db);
  return row ?? null;
}

// ── price_return_snapshot ─────────────────────────────────────────────────────────────────────

const PRICE_RETURN_COLUMNS =
  'security_id, as_of_date, horizon_calendar_days, as_of_price, as_of_price_date, baseline_price, ' +
  'baseline_price_date, total_return, adjustment_status, quality_status, provider, method_version, computed_at';

export type NewPriceReturnSnapshot = Omit<PriceReturnSnapshot, 'computedAt'> & {
  computedAt?: PriceReturnSnapshot['computedAt'] | string;
};

export type PriceReturnSnapshotWrite = {
  readonly snapshot: PriceReturnSnapshot;
  /** `false` when a row already existed for this exact identity (see the module docstring). */
  readonly inserted: boolean;
};

/**
 * Writes one return. Real `on conflict ... do nothing` against the table's actual primary key —
 * see the module docstring for why this table does not need the manual `where not exists` +
 * `23505` pattern the other snapshot tables use.
 */
export async function insertPriceReturnSnapshot(
  input: NewPriceReturnSnapshot,
  db: Queryable = getPool(),
): Promise<PriceReturnSnapshotWrite> {
  const computedAt = input.computedAt ?? new Date();
  const values = [
    input.securityId,
    input.asOfDate,
    input.horizonCalendarDays,
    input.asOfPrice,
    input.asOfPriceDate,
    input.baselinePrice,
    input.baselinePriceDate,
    input.totalReturn,
    input.adjustmentStatus,
    input.qualityStatus,
    input.provider,
    input.methodVersion,
    computedAt,
  ];

  const { rows } = await db.query(
    `insert into price_return_snapshot (${PRICE_RETURN_COLUMNS})
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     on conflict (security_id, as_of_date, horizon_calendar_days, provider, method_version)
     do nothing
     returning ${PRICE_RETURN_COLUMNS}`,
    values,
  );

  const inserted = rows[0] as Row | undefined;
  if (inserted !== undefined) {
    return { snapshot: priceReturnSnapshot.parse(camelizeRow(inserted)), inserted: true };
  }

  const { rows: existingRows } = await db.query(
    `select ${PRICE_RETURN_COLUMNS} from price_return_snapshot
     where security_id = $1 and as_of_date = $2 and horizon_calendar_days = $3
       and provider = $4 and method_version = $5`,
    [input.securityId, input.asOfDate, input.horizonCalendarDays, input.provider, input.methodVersion],
  );
  const existing = existingRows[0] as Row | undefined;
  if (existing === undefined) {
    throw new Error(
      'price_return_snapshot insert reported a conflict but the row could not be read back',
    );
  }
  return { snapshot: priceReturnSnapshot.parse(camelizeRow(existing)), inserted: false };
}

export type PriceReturnSnapshotQuery = {
  readonly securityId: string;
  /** Only the values the check constraint accepts — see the module docstring. */
  readonly horizonCalendarDays: 7 | 30 | 90 | 180;
  readonly asOfInstant: Date;
  readonly provider?: string;
  readonly methodVersion?: string;
};

const DEFAULT_PRICE_RETURN_HISTORY_LIMIT = 200;

/**
 * Bounded at `computed_at <= asOfInstant` — see the module docstring for why, given this table
 * carries no `ingested_at` and is not registered in `contracts/bitemporal.ts`.
 */
export async function priceReturnSnapshotHistory(
  query: PriceReturnSnapshotQuery & { readonly limit?: number },
  db: Queryable = getPool(),
): Promise<PriceReturnSnapshot[]> {
  const predicates = ['security_id = $1', 'horizon_calendar_days = $2', 'computed_at <= $3'];
  const params: unknown[] = [query.securityId, query.horizonCalendarDays, query.asOfInstant];

  if (query.provider !== undefined) {
    params.push(query.provider);
    predicates.push(`provider = $${params.length}`);
  }
  if (query.methodVersion !== undefined) {
    params.push(query.methodVersion);
    predicates.push(`method_version = $${params.length}`);
  }

  params.push(query.limit ?? DEFAULT_PRICE_RETURN_HISTORY_LIMIT);
  const { rows } = await db.query(
    `select ${PRICE_RETURN_COLUMNS} from price_return_snapshot
     where ${predicates.join(' and ')}
     order by as_of_date desc, computed_at desc
     limit $${params.length}`,
    params,
  );
  return rows.map((row) => priceReturnSnapshot.parse(camelizeRow(row as Row)));
}

/** The single most recent comparable return, as of `asOfInstant`. `null` if there is none. */
export async function latestPriceReturnSnapshot(
  query: PriceReturnSnapshotQuery,
  db: Queryable = getPool(),
): Promise<PriceReturnSnapshot | null> {
  const [row] = await priceReturnSnapshotHistory({ ...query, limit: 1 }, db);
  return row ?? null;
}
