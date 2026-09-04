/**
 * The attention snapshot collector — F08 §4.1.
 *
 * > "Persists an `attention_snapshot` per active symbol per run, with `observed_at`,
 * > `ingested_at`, and `provider_methodology_version`. Idempotent per `(security_id,
 * > observed_at)`."
 *
 * This module does the fetch-and-persist half: it calls the ApeWisdom adapter (F04), matches the
 * board against the security master (`match.ts`), and writes through
 * `repositories/attention.ts#insertAttentionSnapshot` — the idempotency and revision-vs-repeat
 * semantics live there and are not reimplemented here (per this feature's build instructions).
 *
 * **Why `repositories/` is reached from `services/attention/`, a path not in this lane's listed
 * ownership.** `02-ARCHITECTURE-CONTRACTS.md` §3: `repositories ← services`, never
 * `repositories ← app`/`ui`. F05 hit the identical shape first (`calc` cannot reach
 * `repositories` either) and it was accepted in review. Reported plainly under this feature's
 * `FILES`/`CONTRACTS` for the coordinator to confirm.
 */
import { env } from '@/env';
import { fetchApeWisdomRanking, type ApeWisdomEntry, type ApeWisdomFilter } from '@/adapters/apewisdom';
import type { WrapperDeps } from '@/adapters/wrapper';
import type { ProviderError } from '@/contracts/provider';
import { canonicalHash } from '@/calc/canonical';
import { getPool, type Queryable } from '@/repositories/client';
import { listActiveSecurities } from '@/repositories/security';
import { insertAttentionSnapshot, type NewAttentionSnapshot } from '@/repositories/attention';
import type { AttentionSnapshot } from '@/contracts/security';
import { apewisdomWrapperDeps } from './provider-deps';
import { matchBoardEntriesToSecurities, type MatchedBoardEntry } from './match';

/**
 * Pinned by hand (F-05/R-03: "the provider does not version its own methodology"). ApeWisdom
 * publishes no version of its own ranking algorithm, so this is this deployment's own record of
 * "which reading of ApeWisdom's methodology produced these rows" — bump it (as a new literal,
 * never edited in place on already-written rows) if ApeWisdom's ranking or windowing is ever
 * observed to change, so `attention.rank_change`'s methodology-boundary guard has something real
 * to detect.
 */
export const APEWISDOM_METHODOLOGY_VERSION = 'apewisdom-2026-09';

/** ApeWisdom's board is a rolling 24-hour comparison (`rank_24h_ago`, `mentions_24h_ago`). */
export const APEWISDOM_WINDOW_HOURS = 24;

const ABSENT_FROM_BOARD_SENTINEL = 0;

/**
 * Lane-review round 7 finding 3. `adapters/apewisdom.ts` deliberately keeps `mentions`, `upvotes`,
 * `rank24hAgo` and `mentions24hAgo` as strings rather than coercing them itself — its own doc
 * comment: coercing "would hide a shape change behind a value that still looks right." This
 * module was undoing exactly that at the boundary: `Number('')` is `0` (a fabricated observed
 * count, indistinguishable from a genuine zero — the identical fabrication round 6 finding 4
 * removed from `inputs.ts`, one file upstream), and `Number('1,204')` is `NaN`, which
 * `insertAttentionSnapshot` then throws out of Postgres as `invalid input syntax for type
 * integer`, uncaught, aborting `collectAttentionSnapshots`'s loop mid-board with a partial
 * snapshot set persisted and no `degraded` signal ever set. `/^-?\d+$/` accepts only what
 * ApeWisdom's own field is documented to send — a bare integer literal, no thousands separator,
 * no empty string — and returns `null` on anything else so the caller can reject the entry
 * explicitly instead of inserting a value that "still looks right."
 */
function parseProviderCount(raw: string): number | null {
  if (!/^-?\d+$/.test(raw)) return null;
  return Number(raw);
}

/** The exact payload the observation is built from, so a repeated poll hashes identically. */
function snapshotRawHash(entry: ApeWisdomEntry): string {
  return canonicalHash({
    ticker: entry.ticker,
    rank: String(entry.rank),
    mentions: entry.mentions,
    upvotes: entry.upvotes,
    rank24hAgo: entry.rank24hAgo,
    mentions24hAgo: entry.mentions24hAgo,
  });
}

/**
 * ApeWisdom's own sentinel for "not on the board:" `rank_24h_ago: "0"`. The persisted table's
 * `rank`/`mentions` columns are domain-honest — `rank` is `.positive()`, so `0` cannot be stored
 * literally — so a security new to the board 24h ago is translated to `null` here, once, rather
 * than leaving every later reader to know the sentinel. `mentionsPrior` is nulled alongside it: a
 * mention count paired with a rank the provider itself did not track is not a fact this collector
 * can vouch for either.
 */
export type AttentionSnapshotInputResult =
  | { readonly ok: true; readonly input: NewAttentionSnapshot }
  /** The provider sent a numeric field this collector cannot honestly parse — F08 §8's "dropped,
   *  never guessed" discipline applied to a malformed count, not only an unmatched ticker. */
  | { readonly ok: false; readonly reason: string };

/**
 * Round-8 lane-review finding 1: `parseProviderCount` validates *format* (a bare integer
 * literal) but not *domain*, and `entry.rank` was not validated at all — `adapters/apewisdom.ts`
 * only constrains it to `z.number()`. `contracts/security.ts#attentionSnapshot` requires
 * `rank`/`rankPrior` positive and `mentions`/`mentionsPrior`/`engagement` non-negative, and that
 * schema is what runs on the row *read back* — so an out-of-domain value (a negative
 * `rank_24h_ago` that is not the "0" sentinel, a fractional or non-positive `rank`) was being
 * committed permanently to `attention_snapshot` and then throwing a `ZodError` uncaught out of
 * every later read of that row, forever, under D-16's no-delete-path rule. Checked here, before
 * the row is ever written, exactly like the format check one line up.
 *
 * **Also bounded above — round-24 lane-review finding 1.** `attention_snapshot`'s numeric columns
 * are Postgres `integer` (`migrations/0002_security_and_market.sql`), and neither this check nor
 * `contracts/security.ts#attentionSnapshot` (`.int().positive()`/`.int().nonnegative()`, no
 * `.max()`) bounded the *magnitude* — a format-valid, in-domain count past `int4`'s range
 * (`"9999999999"`, or a `rank` that large) reached `insertAttentionSnapshot` and Postgres raised
 * `22003 value out of range for type integer` uncaught, the exact `collector.ts:47-59`-documented
 * failure mode (a partial board committed, no `degraded` signal ever set, the collector silently
 * stalled on that value on every later poll) that rounds 7 and 8 each closed one half of and this
 * closes the other.
 */
const POSTGRES_INT4_MAX = 2_147_483_647;

function isNonNegativeInt(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= POSTGRES_INT4_MAX;
}

export function buildAttentionSnapshotInput(matched: MatchedBoardEntry, observedAt: Date): AttentionSnapshotInputResult {
  const { entry, securityId } = matched;

  if (!Number.isInteger(entry.rank) || entry.rank <= 0 || entry.rank > POSTGRES_INT4_MAX) {
    return { ok: false, reason: `rank is not a positive integer: ${JSON.stringify(entry.rank)}` };
  }

  const rankPriorRaw = parseProviderCount(entry.rank24hAgo);
  if (rankPriorRaw === null || !isNonNegativeInt(rankPriorRaw)) {
    return { ok: false, reason: `rank_24h_ago is not a non-negative integer: ${JSON.stringify(entry.rank24hAgo)}` };
  }
  const newToBoard = rankPriorRaw === ABSENT_FROM_BOARD_SENTINEL;

  const mentions = parseProviderCount(entry.mentions);
  if (mentions === null || !isNonNegativeInt(mentions)) {
    return { ok: false, reason: `mentions is not a non-negative integer: ${JSON.stringify(entry.mentions)}` };
  }
  const engagement = parseProviderCount(entry.upvotes);
  if (engagement === null || !isNonNegativeInt(engagement)) {
    return { ok: false, reason: `upvotes is not a non-negative integer: ${JSON.stringify(entry.upvotes)}` };
  }
  let mentionsPrior: number | null = null;
  if (!newToBoard) {
    mentionsPrior = parseProviderCount(entry.mentions24hAgo);
    if (mentionsPrior === null || !isNonNegativeInt(mentionsPrior)) {
      return { ok: false, reason: `mentions_24h_ago is not a non-negative integer: ${JSON.stringify(entry.mentions24hAgo)}` };
    }
  }

  return {
    ok: true,
    input: {
      securityId,
      source: 'apewisdom',
      rank: entry.rank,
      rankPrior: newToBoard ? null : rankPriorRaw,
      mentions,
      mentionsPrior,
      engagement,
      windowHours: APEWISDOM_WINDOW_HOURS,
      coverageClass: 'pov_index',
      providerMethodologyVersion: APEWISDOM_METHODOLOGY_VERSION,
      observedAt,
      rawHash: snapshotRawHash(entry),
    },
  };
}

export type CollectedSnapshotResult = {
  readonly securityId: string;
  readonly symbol: string;
  readonly snapshot: AttentionSnapshot;
  /** `false` when this exact observation already existed — F08 §7 review step 3. */
  readonly inserted: boolean;
};

export type CollectAttentionSnapshotsOptions = {
  readonly filter?: ApeWisdomFilter;
  readonly db?: Queryable;
  /** Injectable so a repeated test run is not at the mercy of the real clock. */
  readonly now?: Date;
  readonly providerMode?: 'fixture' | 'live';
  readonly fixturesRoot?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly deps?: Omit<WrapperDeps, 'fetcher'>;
};

export type CollectAttentionSnapshotsOutcome =
  | {
      readonly ok: true;
      readonly observedAt: string;
      readonly results: readonly CollectedSnapshotResult[];
      /** Board tickers matching no active security — dropped, never guessed (F08 §8). */
      readonly unmatchedTickers: readonly string[];
      /** Lane-review round 7 finding 3: a matched entry whose numeric fields didn't parse as the
       *  bare integers ApeWisdom is documented to send — dropped the same way an unmatched ticker
       *  is, rather than persisting a fabricated or NaN-derived value, or aborting the whole run
       *  over one malformed row. */
      readonly malformedEntries: readonly { readonly ticker: string; readonly reason: string }[];
    }
  | { readonly ok: false; readonly error: ProviderError; readonly message: string };

/**
 * One collector run: fetch the board, match it against the active security master, persist one
 * snapshot per match. A provider failure produces no new snapshots and touches nothing already
 * stored — collection never depends on a prior run having succeeded
 * (`02-ARCHITECTURE-CONTRACTS.md` §2.1's "collection never depends on the scorer" is the same
 * discipline applied to this provider).
 */
export async function collectAttentionSnapshots(
  options: CollectAttentionSnapshotsOptions = {},
): Promise<CollectAttentionSnapshotsOutcome> {
  const db = options.db ?? getPool();
  const providerMode = options.providerMode ?? env.PROVIDER_MODE;
  const filter = options.filter ?? 'all-stocks';

  const deps = options.deps ?? apewisdomWrapperDeps({ db });
  const board = await fetchApeWisdomRanking(
    {
      filter,
      ...(options.headers === undefined ? {} : { headers: options.headers }),
    },
    providerMode,
    {
      ...deps,
      ...(options.fixturesRoot === undefined ? {} : { fixturesRoot: options.fixturesRoot }),
    },
  );

  if (!board.ok) {
    return {
      ok: false,
      error: board.error,
      message:
        `ApeWisdom's board could not be read (${board.error.kind}). This run persisted no new ` +
        'attention snapshots; nothing already stored was touched.',
    };
  }

  const securities = await listActiveSecurities(db);
  const { matched, duplicateTickers } = matchBoardEntriesToSecurities(board.data, securities);
  const matchedTickers = new Set(matched.map((entry) => entry.symbol.toUpperCase()));
  const unmatchedTickers = board.data
    .map((entry) => entry.ticker)
    .filter((ticker) => !matchedTickers.has(ticker.toUpperCase()));

  const observedAt = options.now ?? new Date(board.meta.requestedAt);
  const results: CollectedSnapshotResult[] = [];
  const malformedEntries: { readonly ticker: string; readonly reason: string }[] = [];
  // Round-23 lane-review finding 1: a duplicate ticker on this one board response is dropped the
  // same way an unmatched or malformed entry is — never written as if it were a genuine mid-run
  // revision (see `match.ts#MatchBoardEntriesResult`'s own doc for why that would otherwise land
  // permanently mislabelled under D-16's no-delete retention).
  for (const ticker of duplicateTickers) {
    malformedEntries.push({
      ticker,
      reason: 'this ticker matched more than one entry on the same board response — the best-ranked entry was kept',
    });
  }
  for (const entry of matched) {
    const built = buildAttentionSnapshotInput(entry, observedAt);
    if (!built.ok) {
      malformedEntries.push({ ticker: entry.symbol, reason: built.reason });
      continue;
    }
    const write = await insertAttentionSnapshot(built.input, db);
    results.push({
      securityId: entry.securityId,
      symbol: entry.symbol,
      snapshot: write.snapshot,
      inserted: write.inserted,
    });
  }

  return { ok: true, observedAt: observedAt.toISOString(), results, unmatchedTickers, malformedEntries };
}
