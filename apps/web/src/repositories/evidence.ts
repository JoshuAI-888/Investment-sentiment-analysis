/**
 * `evidence_item` (F09 §4.3, F03/F04, `02-ARCHITECTURE-CONTRACTS.md` §4.4). SQL lives here and
 * nowhere else (F03 DoD item 9).
 *
 * ## Idempotency, and the one thing it cannot guarantee that `attention.ts` could at least
 * partially guarantee
 *
 * `evidence_item`'s primary key is a bare `id uuid default gen_random_uuid()` (migration
 * `0003`) — migration `0011` gives every *other* bitemporal snapshot table `ingested_at` in a
 * composite primary key so a revision can collide with (and a race can be caught against) the
 * row it revises; it does not touch `evidence_item`, and there is **no unique constraint on
 * `raw_hash`** here at all. `insertEvidenceItem` still follows the same `where not exists` +
 * `23505` shape as `attention.ts` and `market.ts` for consistency and because it is harmless,
 * but the `catch` block is dead code today: two genuinely concurrent inserts of the same
 * `(provider, raw_hash, security_id)` cannot violate a constraint that does not exist, because
 * `id` is freshly `gen_random_uuid()`-ed on each call regardless of that identity. **A true
 * concurrent duplicate is therefore not preventable by Postgres under the current schema** —
 * only the sequential-retry case (`where not exists` sees the already-committed row) is
 * actually guarded. Reported under this feature's `CONTRACTS` line; closing it needs a unique
 * *constraint* on `(provider, raw_hash, security_id)` — migration `0013` adds an index on that
 * same triple *for lookup performance*, deliberately not as a `unique` constraint, because
 * turning a same-payload race between two *sequential* retries (already handled at the
 * application level) into a database-enforced guarantee against a true *concurrent* double-insert
 * is a bigger decision than this slice should make unilaterally — see that migration's own
 * comment. (This is a narrower question than "what does a null `security_id` mean", which is
 * already decided; see the next paragraph.)
 *
 * **The identity `raw_hash` alone is not enough (lane-review finding 1).** A wire story that
 * covers two tickers produces the *same* raw payload, and therefore the same `raw_hash`, once
 * per ticker it is collected for. Scoping the idempotency check on `raw_hash` alone means the
 * second ticker's insert is misread as a duplicate of the first's and silently discarded — not
 * an exotic case, but the ordinary shape of syndicated coverage. The identity actually being
 * checked is "the same observation of the same payload for the same subject and provider":
 * `security_id`, `provider`, and `raw_hash` together.
 *
 * **What "same subject" means when there is no subject (lane-review round 2, finding 3).** A
 * macro item (FRED, a market-wide fact) carries `security_id: null` — there is no security to
 * scope it to. `security_id is not distinct from $1` is null-safe SQL equality, which means two
 * macro items from the **same provider** that happen to produce the **same `raw_hash`** *are*
 * treated as one identity bucket and deduped against each other, exactly like two rows that
 * share a real `security_id` are. This is a deliberate choice, not an oversight: `raw_hash` is
 * built to hash the actual payload, so two macro facts that are genuinely different content
 * (a rate hike vs. a rate cut from the same provider) get different hashes as a matter of
 * course — the identity check does not need `security_id` to tell them apart when `raw_hash`
 * already does, and `security_id`'s only job in this triple is to keep two *different tickers'*
 * copies of the same syndicated payload apart, which a null value has no way to do regardless of
 * how it is compared. If two macro items ever collided on `(provider, raw_hash)` while being
 * genuinely different observations, that would be a defect in how `raw_hash` is constructed
 * upstream, not something this repository should try to compensate for by inventing a second
 * disambiguator with no basis in the schema. `migrations/0013`'s own comment is about a
 * different, narrower question — whether this identity should be enforced as a database-level
 * `unique` constraint rather than an index — and does not leave *this* one open.
 *
 * A genuine revision (a re-normalization pass that changes `raw_hash` for the same underlying
 * item) is a plain new row, same as every other table here — there is no successor-vs-overwrite
 * decision to make because nothing about this schema lets two rows collide on identity in the
 * first place.
 *
 * ## `dedupeKey` — F09 §4.3 names it, the table does not have it
 *
 * F09 §4.3 says evidence items "are deduped by `dedupeKey`", and
 * `02-ARCHITECTURE-CONTRACTS.md` §4.4's `EvidenceItem` interface defines it as "normalized url +
 * normalized title" — but `evidence_item` (migration `0003`) has no such column, and neither
 * does `contracts/evidence.ts`'s `evidenceItem` zod schema. Rather than inventing a schema
 * column (`CLAUDE.md`: "a needed contract change is reported, not made"), `evidenceForSecurity`
 * below derives it at read time using exactly the formula the architecture contract already
 * names, and attaches it to each returned item. This is deliberately **not** the same key
 * `insertEvidenceItem`'s idempotency check uses (`raw_hash`, which identifies "the same
 * collector delivery") — `dedupeKey` answers a different question, "is this the same underlying
 * article as a different row", which can be true across two genuinely distinct collector
 * deliveries (e.g. the same wire story re-syndicated and re-collected under a different
 * `raw_hash`). Reported under this feature's `CONTRACTS` line for the coordinator to decide
 * whether it belongs on the schema instead.
 */
import { evidenceItem, type EvidenceItem } from '../contracts/evidence';
import { camelizeRow, type Row } from './rows';
import { getPool, type Queryable } from './client';
import { asOf, FAR_FUTURE } from './as-of';

const EVIDENCE_ITEM_COLUMNS =
  'id, security_id, evidence_type, provider, title, snippet, source_url, publisher, author_ref, ' +
  'stance_label, stance_score, relevance_score, published_at, available_at, ingested_at, ' +
  'last_checked_at, availability, license_class, coverage_class, raw_hash, metadata';

export type NewEvidenceItem = Omit<EvidenceItem, 'id' | 'ingestedAt'> & {
  id?: EvidenceItem['id'];
  ingestedAt?: EvidenceItem['ingestedAt'] | string;
};

export type EvidenceItemWrite = {
  readonly item: EvidenceItem;
  /**
   * `false` when a row with this exact `(security_id, provider, raw_hash)` identity already
   * existed — see the module docstring for why `raw_hash` alone is not the right key.
   */
  readonly inserted: boolean;
};

/** Writes one item. See the module docstring for what this idempotency check can and cannot guarantee. */
export async function insertEvidenceItem(
  input: NewEvidenceItem,
  db: Queryable = getPool(),
): Promise<EvidenceItemWrite> {
  const ingestedAt = input.ingestedAt ?? new Date();
  const values = [
    input.securityId,
    input.evidenceType,
    input.provider,
    input.title,
    input.snippet,
    input.sourceUrl,
    input.publisher,
    input.authorRef,
    input.stanceLabel,
    input.stanceScore,
    input.relevanceScore,
    input.publishedAt,
    input.availableAt,
    ingestedAt,
    input.lastCheckedAt,
    input.availability,
    input.licenseClass,
    input.coverageClass,
    input.rawHash,
    JSON.stringify(input.metadata ?? {}),
  ];

  let inserted: Row | undefined;
  try {
    const { rows } = await db.query(
      `insert into evidence_item (
         security_id, evidence_type, provider, title, snippet, source_url, publisher, author_ref,
         stance_label, stance_score, relevance_score, published_at, available_at, ingested_at,
         last_checked_at, availability, license_class, coverage_class, raw_hash, metadata
       )
       select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
       where not exists (
         select 1 from evidence_item
         where provider = $3 and raw_hash = $19 and security_id is not distinct from $1
       )
       returning ${EVIDENCE_ITEM_COLUMNS}`,
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
    return { item: evidenceItem.parse(camelizeRow(inserted)), inserted: true };
  }

  return {
    item: await readBackExistingEvidenceItem(
      { securityId: input.securityId, provider: input.provider, rawHash: input.rawHash },
      db,
    ),
    inserted: false,
  };
}

/**
 * Reads back the row an `insertEvidenceItem` call just found to already exist. This is an
 * identity lookup, not a point-in-time query — the `where not exists` check moments earlier
 * already established the row is there — so it goes through `asOf` with `FAR_FUTURE`, not the
 * real "now", as the bound. Passing real "now" (an earlier version of this function did) throws
 * whenever the row's `available_at` is legitimately in the future — embargoed content, or
 * ordinary clock skew — treating a successful idempotent retry as a failure (lane-review round
 * 3, finding 2). See `as-of.ts`'s `FAR_FUTURE` docstring for the full reasoning.
 *
 * Scoped by the same `(security_id, provider, raw_hash)` identity the insert's own duplicate
 * check uses (lane-review finding 1) — reading back by `raw_hash` alone would return the wrong
 * ticker's row for a syndicated story shared across two securities.
 */
async function readBackExistingEvidenceItem(
  identity: { readonly securityId: string | null; readonly provider: string; readonly rawHash: string },
  db: Queryable,
): Promise<EvidenceItem> {
  const existingRows = await asOf<Row>(
    {
      table: 'evidence_item',
      asOfInstant: FAR_FUTURE,
      columns: EVIDENCE_ITEM_COLUMNS,
      where: 'provider = $2 and raw_hash = $3 and security_id is not distinct from $4',
      params: [identity.provider, identity.rawHash, identity.securityId],
      orderBy: 'ingested_at desc',
      limit: 1,
    },
    db,
  );
  const existing = existingRows[0];
  if (existing === undefined) {
    throw new Error(
      'evidence_item insert reported an existing duplicate but the row could not be read back',
    );
  }
  return evidenceItem.parse(camelizeRow(existing));
}

export type EvidenceItemQuery = {
  readonly securityId: string;
  readonly asOfInstant: Date;
  readonly limit?: number;
  /**
   * F10 §4.1's three sampling frames are `provider` values on this table ('reddit', 'x',
   * 'substack') — there is no separate axis column. Omitted (F09's existing usage) reads every
   * provider, unchanged from before this field existed; F10's pack builder passes exactly one
   * axis per frame, since the three frames are never blended (D-14).
   */
  readonly providers?: readonly string[];
};

const DEFAULT_EVIDENCE_LIMIT = 50;

/** F09 §4.3's normalization: lowercased, trimmed, query string and trailing slash stripped from the url. */
function normalizeUrl(url: string | null): string {
  if (url === null) return '';
  return url
    .trim()
    .toLowerCase()
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * See the module docstring — "normalized url + normalized title" per
 * `02-ARCHITECTURE-CONTRACTS.md` §4.4 (F09 §4.3 is what asks for the dedup itself).
 *
 * **`sourceUrl: null` is a real, common state on this contract** — a Reddit comment sampled
 * without a permalink, or a provider that does not expose one. `normalizeUrl(null)` returns
 * `''`, so without a fallback here every null-url item would collapse onto the same url-half of
 * the key and dedupe purely on title — two *distinct* items that happen to share a title (two
 * different "GME thread" comments, different bodies, different `rawHash`) would then be treated
 * as one and one of them silently dropped (lane-review finding 4). Falling back to `rawHash`
 * when there is no url to normalize keeps those apart: two items only share a dedupe key when
 * they share *either* a normalized url, *or* both a title and the exact payload hash — never
 * from the absence of a url alone.
 */
export function dedupeKeyOf(item: Pick<EvidenceItem, 'sourceUrl' | 'title' | 'rawHash'>): string {
  const urlPart = item.sourceUrl === null ? `no-url:${item.rawHash}` : normalizeUrl(item.sourceUrl);
  return `${urlPart}|${normalizeTitle(item.title)}`;
}

export type EvidenceItemWithDedupeKey = EvidenceItem & { readonly dedupeKey: string };

export type EvidenceForSecurityResult = {
  /** Deduped by `dedupeKey`, most-recent-first, truncated to `query.limit`. */
  readonly items: readonly EvidenceItemWithDedupeKey[];
  /**
   * F09 §4.3: "The drawer states how many items were retrieved and how many were used" — this is
   * the "retrieved" half: the raw, pre-dedup row count within this call's scan window. **This is
   * not the same number as `distinctCount`** (lane-review round 3, finding 3: an earlier version
   * of this function conflated the two — for 10 raw rows collapsing to 6 distinct items, it
   * called 6 "retrieved", which hid the 4 duplicate copies that were actually filtered out and
   * disclosed only page truncation, not the dedup filtering F09 §4.3 actually asks to be made
   * visible). Bounded by the scan window (`CANDIDATE_SCAN_LIMIT`, or the `scanLimit` override),
   * not by `query.limit` — see `truncated` for when that window itself may be an undercount.
   */
  readonly scannedCount: number;
  /**
   * How many *distinct* items (post-dedup) exist within the scan window, before `query.limit`
   * truncates the page. `items.length` (the "used" half of F09 §4.3's disclosure) is only ever
   * smaller than this when the page itself was cut short by `query.limit` — never because dedup
   * ran on an already-truncated set of raw rows, which was lane-review round 2's finding: an
   * earlier version of this function applied `query.limit` in the SQL before dedup ever ran, so a
   * security with 6 distinct items and 5 duplicates of the newest one, read with `limit: 5`,
   * reported "5 retrieved, 1 used" — a coverage understatement dressed up as a filtering
   * statistic. A caller wanting F09 §4.3's full three-way disclosure — how many exist, how many
   * are actually distinct, how many are shown — reads `scannedCount`, `distinctCount` and
   * `items.length` off one result rather than re-deriving any of them.
   */
  readonly distinctCount: number;
  /**
   * `true` when the raw scan hit its window (`CANDIDATE_SCAN_LIMIT` or the `scanLimit` override)
   * without necessarily having read every row that exists for this security — meaning
   * `scannedCount` and `distinctCount` are a lower bound, not an exact count, and there may be
   * more (possibly-distinct) evidence this call never saw. Never left silently undisclosed
   * (lane-review round 3, finding 1): under D-16's permanent, forward-only corpus, the
   * heaviest-covered tickers are exactly the ones a fixed scan window will eventually reach, and
   * a caller rendering "N found" from a truncated `scannedCount` with no way to know it was
   * truncated would be reporting a wrong number with the same confidence as a right one.
   */
  readonly truncated: boolean;
};

/**
 * The scan window dedup runs over — **not** `query.limit`; `query.limit` is applied only to the
 * already-deduped result (see `EvidenceForSecurityResult`'s `distinctCount`). Not "every row this
 * security will ever have" (D-16's corpus is permanent and forward-only, so that number is
 * unbounded over time, unlike `attention_snapshot`'s one-row-per-collection-run shape, which is
 * why `attention.ts`'s `COMPARABLE_COUNT_LIMIT` can safely be a number nothing will ever reach) —
 * a fixed cap instead, sized against **measured query cost**, not a row-count projection.
 *
 * **This constant was `1,000,000` before lane-review round 4 measured what that actually costs**:
 * a single `evidenceForSecurity` call at 100,000 rows for one security ran ~4.25s and allocated
 * ~268MB of transient heap against real Postgres; extrapolated to 1,000,000 rows, ~42s and
 * ~2.7GB — both fail F09 DoD item 10's ticker-snapshot p95 < 3s outright, and the memory figure
 * is an OOM crash in a memory-capped serverless function, not a degraded state. The row-count
 * reasoning that produced `1,000,000` ("55 years at 50 items/day") also understated realistic
 * volume: `evidence_item` pools Reddit, X, Substack and news together for one security, and a
 * heavily-discussed ticker can realistically reach ~300 items/day, crossing 100,000 within a
 * year — and under D-16 that only grows, never shrinks. `5,000` rows measured ~271ms and ~40MB
 * in the same probe: fast and safe at the volume a real ticker will actually reach. Round 3's
 * `EvidenceForSecurityResult.truncated` flag is what makes this moderate window honest once a
 * real corpus exceeds it, rather than a second silent-wrongness bug at a smaller number — at
 * `1,000,000` that flag was inert (never true in any realistic production data, so built and
 * never actually exercised); at `5,000` it is the mechanism doing real work.
 */
export const CANDIDATE_SCAN_LIMIT = 5_000;

/**
 * As-of-correct read for one security's evidence corpus, most-recent-first by `available_at` —
 * the column F22's guard bounds on for this table (`published_at` is when the author wrote it,
 * not when we could have seen it; see `contracts/bitemporal.ts`).
 *
 * Dedup runs over the scan window (`scanLimit`, defaulting to `CANDIDATE_SCAN_LIMIT`) — **not**
 * `query.limit` — and `query.limit` is applied only to the already-deduped result. Doing it the
 * other way around (limit in the SQL, dedup on what comes back) is the exact defect lane-review
 * round 2 found: it can silently under-report a ticker's real evidence coverage whenever
 * duplicates of one story crowd out genuinely distinct items within the page the SQL `LIMIT` cut
 * off before dedup ever saw them.
 *
 * `scanLimit` is a parameter (rather than baked in) purely so a test can exercise the
 * `truncated` path at a small, fast depth without needing a `CANDIDATE_SCAN_LIMIT`-sized fixture
 * for every case — production callers should never pass it. A depth genuinely near the real
 * default is still worth proving directly at least once; see the integration test that seeds
 * rows past the actual default rather than overriding it.
 */
export async function evidenceForSecurity(
  query: EvidenceItemQuery,
  db: Queryable = getPool(),
  scanLimit: number = CANDIDATE_SCAN_LIMIT,
): Promise<EvidenceForSecurityResult> {
  const hasProviders = query.providers !== undefined && query.providers.length > 0;
  const rows = await asOf<Row>(
    {
      table: 'evidence_item',
      asOfInstant: query.asOfInstant,
      columns: EVIDENCE_ITEM_COLUMNS,
      where: hasProviders ? 'security_id = $2 and provider = any($3::text[])' : 'security_id = $2',
      params: hasProviders ? [query.securityId, query.providers] : [query.securityId],
      orderBy: 'available_at desc, ingested_at desc',
      limit: scanLimit,
    },
    db,
  );

  const scannedCount = rows.length;
  const truncated = scannedCount >= scanLimit;

  const seen = new Set<string>();
  const deduped: EvidenceItemWithDedupeKey[] = [];
  for (const row of rows) {
    const item = evidenceItem.parse(camelizeRow(row));
    const dedupeKey = dedupeKeyOf(item);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    deduped.push({ ...item, dedupeKey });
  }

  const limit = query.limit ?? DEFAULT_EVIDENCE_LIMIT;
  return {
    items: deduped.slice(0, limit),
    scannedCount,
    distinctCount: deduped.length,
    truncated,
  };
}
