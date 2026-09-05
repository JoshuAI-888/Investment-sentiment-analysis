/**
 * `attention_snapshot` (F08 §4.1, F06 §4.1). SQL lives here and nowhere else (F03 DoD item 9).
 *
 * The table is bitemporal (`contracts/bitemporal.ts`) and its provider does not version its own
 * methodology, so `provider_methodology_version` is pinned per row (R-03) and a rank change or
 * z-score computed across a methodology boundary is refused elsewhere (`calc/methods/attention-
 * rank-change-v1_1.ts`) rather than fabricated.
 *
 * ## Idempotency: why this is "insert a successor", never "update in place"
 *
 * F08 §4.1 asks for a collector that is "idempotent per `(security_id, observed_at)`". The same
 * discipline this codebase already applies to every other append-only / bitemporal table
 * (`MEMORY.md` B-08, B-11, B-12) rules out an UPDATE outright: overwriting a row an earlier
 * as-of read already returned is exactly the look-ahead defect F22's guard exists to prevent on
 * the read side. So a **genuine revision** — the same `(security_id, source, observed_at)` with
 * a different `raw_hash` (e.g. a provider recomputing a window after the fact) — is stored as a
 * new row with a later `ingested_at`, never as an overwrite of the row it revises.
 *
 * A **repeated, identical** observation is a different case, and it is the one "idempotent"
 * actually names: the same collector run retried after a partial failure, or the dispatcher
 * redelivering the same job. `raw_hash` is what tells the two apart, because it hashes the
 * payload the snapshot was built from, not the snapshot's own identity columns — an unchanged
 * observation hashes the same on every re-ingestion. Where a row already exists for the same
 * identity with the same hash, nothing new is written (`inserted: false`, the existing row is
 * returned). Where it exists with a different hash, a successor row is written
 * (`inserted: true`).
 *
 * **What this cannot guarantee without a schema change.** The primary key is `(security_id,
 * source, observed_at, ingested_at)` (migration `0011`) — `ingested_at` is in the key precisely
 * so a revision can be stored at all, which means there is no unique constraint on
 * `(security_id, source, observed_at)` alone for Postgres to arbitrate a genuine race between two
 * concurrent inserts of the same observation. The write below (`insert ... where not exists`) is
 * atomic against sequential re-runs, which is the case F08 §7 review step 3 actually describes
 * ("run the collector twice on the same window"), but a truly concurrent double-dispatch could
 * still land two rows a moment apart. Closing that fully needs a unique index on
 * `(security_id, source, observed_at)`, which is a migration and out of this slice's scope (it
 * touches `repositories/` and `contracts/` only) — recorded here rather than silently assumed
 * away. In production the dispatcher's Redis lock (`02-ARCHITECTURE-CONTRACTS.md` §7 step 2)
 * already makes a duplicate delivery a no-op before it reaches this function.
 */
import { attentionSnapshot, type AttentionSnapshot } from '../contracts/security';
import { camelizeRow, type Row } from './rows';
import { getPool, type Queryable } from './client';
import { asOf } from './as-of';

/** The one place this narrows `AttentionSnapshot['source']` to a name, so callers need not. */
export type AttentionSource = AttentionSnapshot['source'];

const ATTENTION_SNAPSHOT_COLUMNS =
  'security_id, source, rank, rank_prior, mentions, mentions_prior, engagement, window_hours, ' +
  'coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash';

/** Everything but `ingestedAt`, which defaults to the write instant like every other snapshot. */
export type NewAttentionSnapshot = Omit<AttentionSnapshot, 'ingestedAt'> & {
  ingestedAt?: AttentionSnapshot['ingestedAt'] | string;
};

export type AttentionSnapshotWrite = {
  readonly snapshot: AttentionSnapshot;
  /**
   * `false` when an identical `(security_id, source, observed_at, raw_hash)` observation already
   * existed and nothing new was written — the repeated-collector-run case F08 §4.1 calls
   * "idempotent". `true` for a brand-new observation and for a genuine revision (same identity,
   * different `raw_hash`), which is stored as a successor row rather than an update.
   */
  readonly inserted: boolean;
};

/**
 * Writes one observation. See the module docstring for why a duplicate no-ops and a revision
 * writes a successor rather than either being an UPDATE.
 */
export async function insertAttentionSnapshot(
  input: NewAttentionSnapshot,
  db: Queryable = getPool(),
): Promise<AttentionSnapshotWrite> {
  const ingestedAt = input.ingestedAt ?? new Date();
  const values = [
    input.securityId,
    input.source,
    input.rank,
    input.rankPrior,
    input.mentions,
    input.mentionsPrior,
    input.engagement,
    input.windowHours,
    input.coverageClass,
    input.providerMethodologyVersion,
    input.observedAt,
    ingestedAt,
    input.rawHash,
  ];

  // A single statement: insert only if no row already carries this exact identity and hash.
  // The `where not exists` subquery names the table inside a `from`, but the rule that would
  // otherwise flag that (`no-unbounded-pit-read`) exempts any literal whose statement is an
  // INSERT (F01 §4.3) — an insert that reads back its own conflict check is not a look-ahead.
  //
  // Atomic against sequential re-runs, not against genuine concurrency: there is no unique
  // constraint on `(security_id, source, observed_at)` alone (see the module docstring), so two
  // truly concurrent calls can both pass the `where not exists` check under READ COMMITTED and
  // both attempt to insert. They cannot both succeed silently, though — their `ingested_at`
  // values would have to collide to the millisecond to violate the bitemporal primary key, which
  // is rare but real (found by lane-review). Caught below rather than left to escape as a raw
  // driver error to a caller whose entire contract is "a repeated observation is not an error".
  let inserted: Row | undefined;
  try {
    const { rows } = await db.query(
      `insert into attention_snapshot (${ATTENTION_SNAPSHOT_COLUMNS})
       select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
       where not exists (
         select 1 from attention_snapshot
         where security_id = $1 and source = $2 and observed_at = $11 and raw_hash = $13
       )
       returning ${ATTENTION_SNAPSHOT_COLUMNS}`,
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
    return { snapshot: attentionSnapshot.parse(camelizeRow(inserted)), inserted: true };
  }

  return { snapshot: await readBackExisting(input, db), inserted: false };
}

/**
 * Reads back the row an `insertAttentionSnapshot` call just found to already exist — bounded at
 * the actual current instant, never at the write's own `ingestedAt`. The row was committed by an
 * earlier call, so it is always knowable "as of now"; bounding at the caller's `ingestedAt`
 * instead (an earlier version of this function did) throws whenever a re-run passes an
 * `ingestedAt` older than the existing row's — a real, easily-reached case (a backfill-style
 * reprocessing pass, or simply two calls whose default `new Date()` values straddle the
 * existing row's `ingested_at`), not an edge case. Found by lane-review.
 */
async function readBackExisting(
  input: Pick<NewAttentionSnapshot, 'securityId' | 'source' | 'observedAt'>,
  db: Queryable,
): Promise<AttentionSnapshot> {
  const existingRows = await asOf<Row>(
    {
      table: 'attention_snapshot',
      asOfInstant: new Date(),
      columns: ATTENTION_SNAPSHOT_COLUMNS,
      where: 'security_id = $2 and source = $3 and observed_at = $4',
      params: [input.securityId, input.source, input.observedAt],
      orderBy: 'ingested_at desc',
      limit: 1,
    },
    db,
  );
  const existing = existingRows[0];
  if (existing === undefined) {
    throw new Error(
      'attention_snapshot insert reported an existing duplicate but the row could not be read back',
    );
  }
  return attentionSnapshot.parse(camelizeRow(existing));
}

/**
 * A bounded, as-of-correct read for one `(security_id, source)`: at most one row per distinct
 * `observed_at`, the most recent `ingested_at` known as of `asOfInstant`. This is the shape both
 * F08's leaderboard trend and F06's `attention.mentions_zscore` history window need — a series of
 * comparable prior observations, not whatever a plain `select *` would return if a correction had
 * ever landed a second row for the same `observed_at`.
 *
 * **`methodologyVersion` is optional, and the two callers named above want it set differently.**
 * F08's leaderboard trend wants "whatever the current snapshot series actually is" and renders a
 * methodology change as its own disclosed event, so it omits the filter. F06's z-score history
 * window is exactly the case a methodology boundary must not silently cross — passing it here
 * filters out any row on the far side of the boundary before this function's caller ever sees it,
 * so the two features cannot drift apart on what "comparable" means (the omission of this filter
 * was round-1 lane-review's finding: this docstring already claimed the boundary was respected
 * when the query did not enforce it).
 *
 * `limit` defaults to comfortably above F06's `min_history` assumption (14) so a caller building
 * the z-score's history series does not have to know that number to get enough rows; callers that
 * want the F08 leaderboard's short trend pass a smaller one explicitly.
 */
export type AttentionSnapshotQuery = {
  readonly securityId: string;
  readonly source: AttentionSource;
  readonly asOfInstant: Date;
  readonly methodologyVersion?: string;
};

const DEFAULT_HISTORY_LIMIT = 100;

export async function attentionSnapshotHistory(
  query: AttentionSnapshotQuery & { readonly limit?: number },
  db: Queryable = getPool(),
): Promise<AttentionSnapshot[]> {
  const methodologyPredicate =
    query.methodologyVersion === undefined ? '' : ' and provider_methodology_version = $4';
  const params: unknown[] =
    query.methodologyVersion === undefined
      ? [query.securityId, query.source]
      : [query.securityId, query.source, query.methodologyVersion];

  const rows = await asOf<Row>(
    {
      table: 'attention_snapshot',
      asOfInstant: query.asOfInstant,
      columns: `distinct on (observed_at) ${ATTENTION_SNAPSHOT_COLUMNS}`,
      where: `security_id = $2 and source = $3${methodologyPredicate}`,
      params,
      orderBy: 'observed_at desc, ingested_at desc',
      limit: query.limit ?? DEFAULT_HISTORY_LIMIT,
    },
    db,
  );
  return rows.map((row) => attentionSnapshot.parse(camelizeRow(row)));
}

/** The single most recent comparable observation, as of `asOfInstant`. `null` if there is none. */
export async function latestAttentionSnapshot(
  query: AttentionSnapshotQuery,
  db: Queryable = getPool(),
): Promise<AttentionSnapshot | null> {
  const [row] = await attentionSnapshotHistory({ ...query, limit: 1 }, db);
  return row ?? null;
}

/**
 * How many *comparable* prior snapshots exist before `beforeObservedAt`, as of `asOfInstant`.
 * This is F06 §4.1's z-score gate ("fewer than 14 comparable snapshots ⇒ no z-score") and F08
 * §4.1's `HistoryDepth`, in one place so the two features cannot silently drift apart on what
 * "comparable" means.
 *
 * "Comparable" here matches the standard this codebase already set for `attention.rank_change`
 * (`calc/methods/attention-rank-change-v1_1.ts`, F-05 amendment): the **same source** — a Reddit
 * count and an ApeWisdom rank are not the same measurement — and the **same
 * `provider_methodology_version`** as the reference snapshot, since a methodology change alters
 * what "mentions" means for the same security. A prior snapshot on the far side of a methodology
 * boundary is not a comparable observation and must not inflate the depth count.
 *
 * Built directly on `attentionSnapshotHistory`'s own as-of-collapsed, methodology-filtered row
 * set — not a separate `count(distinct observed_at)` query — so the two functions cannot drift
 * apart on which rows are comparable (round-1 lane-review found the original two-query version
 * had: this one applied the methodology filter to raw, un-collapsed rows, which could count a
 * superseded revision that no longer matches the current methodology).
 */
export type ComparableAttentionSnapshotQuery = {
  readonly securityId: string;
  readonly source: AttentionSource;
  readonly methodologyVersion: string;
  readonly beforeObservedAt: Date;
  readonly asOfInstant: Date;
};

/**
 * Comfortably above any realistic collection history for a single security under D-16's
 * forward-only collection — this is a depth *count*, not a paginated read, so there is no reason
 * to truncate it the way `attentionSnapshotHistory`'s own default limit does for a UI trend.
 */
const COMPARABLE_COUNT_LIMIT = 1_000_000;

export async function countComparableAttentionSnapshots(
  query: ComparableAttentionSnapshotQuery,
  db: Queryable = getPool(),
): Promise<number> {
  const history = await attentionSnapshotHistory(
    {
      securityId: query.securityId,
      source: query.source,
      methodologyVersion: query.methodologyVersion,
      asOfInstant: query.asOfInstant,
      limit: COMPARABLE_COUNT_LIMIT,
    },
    db,
  );
  return history.filter((row) => row.observedAt.getTime() < query.beforeObservedAt.getTime()).length;
}

// ── the raw provider board (0015_attention_board_snapshot.sql) ───────────────────────────────

const ATTENTION_BOARD_COLUMNS =
  'source, board, ticker, name, security_id, rank, mentions, upvotes, rank_24h_ago, ' +
  'mentions_24h_ago, page, pages_total, provider_methodology_version, observed_at, ' +
  'ingested_at, raw_hash';

export type NewAttentionBoardRow = {
  readonly source: 'apewisdom';
  readonly board: string;
  readonly ticker: string;
  readonly name: string;
  /** Null when the ticker resolves to no active security — the case this table exists for. */
  readonly securityId: string | null;
  readonly rank: number;
  readonly mentions: number;
  readonly upvotes: number | null;
  readonly rank24hAgo: number | null;
  readonly mentions24hAgo: number | null;
  readonly page: number;
  readonly pagesTotal: number;
  readonly providerMethodologyVersion: string;
  readonly observedAt: Date;
  readonly ingestedAt?: Date;
  readonly rawHash: string;
};

/**
 * Idempotent per `(source, board, ticker, observed_at, raw_hash)`, the same shape
 * `insertAttentionSnapshot` uses and for the same reason: **a repeat is not a revision.**
 * Re-reading a board inside one observation instant and getting identical content is a no-op;
 * getting *different* content is a successor row, which the bitemporal primary key
 * (`ingested_at` included) makes storable without the UPDATE the append-only trigger forbids.
 *
 * Returns whether a row was written, so a collector can report what it actually added rather
 * than what it attempted.
 */
export async function insertAttentionBoardRow(
  input: NewAttentionBoardRow,
  db: Queryable = getPool(),
): Promise<{ inserted: boolean }> {
  const ingestedAt = input.ingestedAt ?? new Date();
  const { rows } = await db.query(
    `insert into attention_board_snapshot (${ATTENTION_BOARD_COLUMNS})
     select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
     where not exists (
       select 1 from attention_board_snapshot
       where source = $1 and board = $2 and ticker = $3 and observed_at = $14 and raw_hash = $16
     )
     returning ticker`,
    [
      input.source,
      input.board,
      input.ticker,
      input.name,
      input.securityId,
      input.rank,
      input.mentions,
      input.upvotes,
      input.rank24hAgo,
      input.mentions24hAgo,
      input.page,
      input.pagesTotal,
      input.providerMethodologyVersion,
      input.observedAt,
      ingestedAt,
      input.rawHash,
    ],
  );
  return { inserted: rows.length > 0 };
}
