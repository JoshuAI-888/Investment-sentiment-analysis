/**
 * `sentiment_snapshot` (F09 §4.2's stance and news axes, F10's pipeline output). SQL lives here
 * and nowhere else (F03 DoD item 9).
 *
 * ## Idempotency without a `raw_hash` column
 *
 * Unlike `attention_snapshot` and `market_snapshot`, `sentiment_snapshot` (migration `0003`) has
 * no `raw_hash` — there is no single upstream payload to hash, since a sentiment snapshot is
 * itself a computed aggregate over a sample of evidence items, not a single provider
 * observation. Its primary key is `(subject_type, subject_id, source_type, observed_at,
 * ingested_at)` (migration `0011`, the same `ingested_at`-in-the-key treatment every other
 * bitemporal snapshot table gets, for the same reason: a revised aggregate must be stored as a
 * successor, never an UPDATE).
 *
 * With no hash to compare, "the same computation run retried" is detected by comparing **every
 * value column this table has**: `rawScore`, `shrunkScore`, `sampleAdequacy`, `sampleSize`,
 * `positiveCount`, `neutralCount`, `negativeCount`, `unclearCount`, `methodVersion` and
 * `expiresAt` all matching an existing row for the same `(subjectType, subjectId, sourceType,
 * observedAt)` is treated as the retry case (no-op); any of those differing is a genuine
 * revision (a re-run that sampled differently, scored differently, or reclassified the same
 * sample into different buckets while the headline score happened to round the same) and writes
 * a successor row.
 *
 * **An earlier version of this check compared only five of those ten columns** — omitting the
 * four per-bucket counts and `expiresAt` — which meant a re-classification that moved counts
 * between buckets (e.g. `positive: 20, negative: 8` re-scored to `positive: 20, negative: 0,
 * unclear: 8` with an unchanged headline `shrunkScore`) was misread as an identical retry and
 * silently dropped instead of superseded (lane-review finding 2). `latestSentimentSnapshot` then
 * kept returning the stale, pre-revision breakdown forever. There is no schema column this
 * table carries that is *not* now part of this comparison — the identity columns
 * (`subjectType`/`subjectId`/`sourceType`/`observedAt`) are the lookup key, `ingestedAt` is what
 * makes a revision a successor rather than a collision, and every other column is a value this
 * check compares.
 */
import { sentimentSnapshot, type SentimentSnapshot } from '../contracts/evidence';
import { camelizeRow, type Row } from './rows';
import { getPool, type Queryable } from './client';
import { asOf, FAR_FUTURE } from './as-of';

export type SentimentSubjectType = SentimentSnapshot['subjectType'];
export type SentimentSourceType = SentimentSnapshot['sourceType'];

const SENTIMENT_SNAPSHOT_COLUMNS =
  'subject_type, subject_id, source_type, raw_score, shrunk_score, sample_adequacy, sample_size, ' +
  'positive_count, neutral_count, negative_count, unclear_count, method_version, observed_at, ' +
  'ingested_at, expires_at';

export type NewSentimentSnapshot = Omit<SentimentSnapshot, 'ingestedAt'> & {
  ingestedAt?: SentimentSnapshot['ingestedAt'] | string;
};

export type SentimentSnapshotWrite = {
  readonly snapshot: SentimentSnapshot;
  /** `false` when an identical computation (see the module docstring) already existed. */
  readonly inserted: boolean;
};

/** Writes one snapshot. See the module docstring for the no-`raw_hash` idempotency check. */
export async function insertSentimentSnapshot(
  input: NewSentimentSnapshot,
  db: Queryable = getPool(),
): Promise<SentimentSnapshotWrite> {
  const ingestedAt = input.ingestedAt ?? new Date();
  const values = [
    input.subjectType,
    input.subjectId,
    input.sourceType,
    input.rawScore,
    input.shrunkScore,
    input.sampleAdequacy,
    input.sampleSize,
    input.positiveCount,
    input.neutralCount,
    input.negativeCount,
    input.unclearCount,
    input.methodVersion,
    input.observedAt,
    ingestedAt,
    input.expiresAt,
  ];

  let inserted: Row | undefined;
  try {
    const { rows } = await db.query(
      `insert into sentiment_snapshot (${SENTIMENT_SNAPSHOT_COLUMNS})
       select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
       where not exists (
         select 1 from sentiment_snapshot
         where subject_type = $1 and subject_id = $2 and source_type = $3 and observed_at = $13
           and raw_score = $4 and shrunk_score = $5 and sample_adequacy = $6 and sample_size = $7
           and positive_count = $8 and neutral_count = $9 and negative_count = $10
           and unclear_count = $11 and method_version = $12
           and expires_at is not distinct from $15
       )
       returning ${SENTIMENT_SNAPSHOT_COLUMNS}`,
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
    return { snapshot: sentimentSnapshot.parse(camelizeRow(inserted)), inserted: true };
  }

  return { snapshot: await readBackExistingSentimentSnapshot(input, db), inserted: false };
}

/**
 * Reads back the row an `insertSentimentSnapshot` call just found to already exist. This is an
 * identity lookup, not a point-in-time query — the `where not exists` check moments earlier
 * already established the row is there — so it goes through `asOf` with `FAR_FUTURE`, not the
 * real "now", as the bound. Passing real "now" (an earlier version of this function did) throws
 * whenever the row's `observed_at` is legitimately in the future — ordinary clock skew between
 * whatever scored the sample and whatever is retrying the insert — treating a successful
 * idempotent retry as a failure (lane-review round 3, finding 2). See `as-of.ts`'s `FAR_FUTURE`
 * docstring for the full reasoning.
 */
async function readBackExistingSentimentSnapshot(
  input: Pick<NewSentimentSnapshot, 'subjectType' | 'subjectId' | 'sourceType' | 'observedAt'>,
  db: Queryable,
): Promise<SentimentSnapshot> {
  const existingRows = await asOf<Row>(
    {
      table: 'sentiment_snapshot',
      asOfInstant: FAR_FUTURE,
      columns: SENTIMENT_SNAPSHOT_COLUMNS,
      where: 'subject_type = $2 and subject_id = $3 and source_type = $4 and observed_at = $5',
      params: [input.subjectType, input.subjectId, input.sourceType, input.observedAt],
      orderBy: 'ingested_at desc',
      limit: 1,
    },
    db,
  );
  const existing = existingRows[0];
  if (existing === undefined) {
    throw new Error(
      'sentiment_snapshot insert reported an existing duplicate but the row could not be read back',
    );
  }
  return sentimentSnapshot.parse(camelizeRow(existing));
}

export type SentimentSnapshotQuery = {
  readonly subjectType: SentimentSubjectType;
  readonly subjectId: string;
  readonly sourceType: SentimentSourceType;
  readonly asOfInstant: Date;
  readonly methodVersion?: string;
};

const DEFAULT_SENTIMENT_HISTORY_LIMIT = 100;

/**
 * A bounded, as-of-correct read: at most one row per distinct `observed_at`, the most recent
 * `ingested_at` known as of `asOfInstant` — the same shape `attentionSnapshotHistory` gives F06,
 * here for F09's stance and news axes.
 */
export async function sentimentSnapshotHistory(
  query: SentimentSnapshotQuery & { readonly limit?: number },
  db: Queryable = getPool(),
): Promise<SentimentSnapshot[]> {
  const methodologyPredicate = query.methodVersion === undefined ? '' : ' and method_version = $5';
  const params: unknown[] =
    query.methodVersion === undefined
      ? [query.subjectType, query.subjectId, query.sourceType]
      : [query.subjectType, query.subjectId, query.sourceType, query.methodVersion];

  const rows = await asOf<Row>(
    {
      table: 'sentiment_snapshot',
      asOfInstant: query.asOfInstant,
      columns: `distinct on (observed_at) ${SENTIMENT_SNAPSHOT_COLUMNS}`,
      where: `subject_type = $2 and subject_id = $3 and source_type = $4${methodologyPredicate}`,
      params,
      orderBy: 'observed_at desc, ingested_at desc',
      limit: query.limit ?? DEFAULT_SENTIMENT_HISTORY_LIMIT,
    },
    db,
  );
  return rows.map((row) => sentimentSnapshot.parse(camelizeRow(row)));
}

/** The single most recent comparable snapshot, as of `asOfInstant`. `null` if there is none. */
export async function latestSentimentSnapshot(
  query: SentimentSnapshotQuery,
  db: Queryable = getPool(),
): Promise<SentimentSnapshot | null> {
  const [row] = await sentimentSnapshotHistory({ ...query, limit: 1 }, db);
  return row ?? null;
}
