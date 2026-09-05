/**
 * Captures the **whole** ApeWisdom board — every stock filter, every page — into
 * `attention_board_snapshot`.
 *
 * ## Why this exists alongside `collector.ts`
 *
 * `collector.ts` writes `attention_snapshot`, which is universe-scoped by construction:
 * `security_id` is `not null` there, so a ticker outside the 100-symbol universe (D-27, D-30)
 * cannot be stored at all, and it fetched only the first page besides. Everything else the
 * provider returned was computed and then discarded.
 *
 * Under D-16 collection is forward-only with **no backfill**, and ApeWisdom is free and keyless.
 * A board row not captured today is gone permanently; a captured row nobody computes over costs
 * storage and nothing else. That asymmetry is the whole argument for this module.
 *
 * **It does not change what the product computes over.** `attention_snapshot` keeps its meaning
 * and its universe scope, and `collector.ts` is untouched. Promoting a ticker out of the raw
 * board into the universe remains an owner decision under D-27/D-30.
 *
 * ## What one run does
 *
 * For each of the nine stock boards: page 1, read `pages` from the response, then pages 2..n.
 * Every entry is written — resolved to a `security_id` where the ticker matches an active
 * security, `null` where it does not.
 *
 * **One board's failure never fails the run**, matching `collector.ts`'s own rule for thirteen
 * independent Substack feeds: nine boards, and a single 500 must not cost the other eight their
 * capture. A board that fails mid-pagination keeps the pages it did get — `page` and
 * `pages_total` are stored per row, so a partial capture is visible as such rather than looking
 * like a board that simply got shorter.
 */
import { canonicalHash } from '@/calc/canonical';
import {
  APEWISDOM_STOCK_FILTERS,
  fetchApeWisdomBoardPage,
  type ApeWisdomEntry,
  type ApeWisdomFilter,
} from '@/adapters/apewisdom';
import type { WrapperDeps } from '@/adapters/wrapper';
import type { ProviderError } from '@/contracts/provider';
import { getPool, type Queryable } from '@/repositories/client';
import { insertAttentionBoardRow } from '@/repositories/attention';
import { listActiveSecurities } from '@/repositories/security';
import { apewisdomWrapperDeps } from './provider-deps';

/**
 * Bumped when the parsing or hashing rules below change in a way that would make two rows
 * collected under different versions non-comparable — the same discipline `collector.ts` and the
 * Substack collector each apply to their own.
 */
export const BOARD_METHOD_VERSION = 'apewisdom-board-2026-09';

/** A guard against an unbounded loop if the provider ever reports a nonsense `pages`. */
export const MAX_PAGES_PER_BOARD = 50;

export type BoardFailure = { readonly board: string; readonly page: number; readonly error: ProviderError };

export type BoardCollectionOutcome = {
  readonly ok: boolean;
  readonly observedAt: string;
  readonly boardsAttempted: number;
  readonly boardsSucceeded: number;
  readonly rowsSeen: number;
  readonly rowsWritten: number;
  readonly matched: number;
  readonly unmatched: number;
  readonly pagesFetched: number;
  readonly failures: readonly BoardFailure[];
};

export type BoardCollectorOptions = {
  readonly db?: Queryable;
  readonly now?: Date;
  readonly providerMode?: 'fixture' | 'live';
  readonly fixturesRoot?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly deps?: Omit<WrapperDeps, 'fetcher'>;
  /** Defaults to every stock board. Narrowed only by tests. */
  readonly boards?: readonly ApeWisdomFilter[];
  /** Defaults to `fetchApeWisdomBoardPage`; injectable for the same reason the Substack collector's fetcher is. */
  readonly fetchPage?: typeof fetchApeWisdomBoardPage;
};

/**
 * ApeWisdom sends counts as numeric strings, not numbers (see `adapters/apewisdom.ts`). A value
 * that is not a bare integer is stored as `null` rather than coerced to 0 — "absent, never
 * guessed", the same rule `collector.ts` applies to a malformed count.
 */
function toInteger(value: string): number | null {
  return /^\d+$/.test(value) ? Number(value) : null;
}

export async function collectAttentionBoards(
  options: BoardCollectorOptions = {},
): Promise<BoardCollectionOutcome> {
  const db = options.db ?? getPool();
  const now = options.now ?? new Date();
  const providerMode = options.providerMode ?? 'fixture';
  const deps = options.deps ?? apewisdomWrapperDeps({ db });
  const fetchPage = options.fetchPage ?? fetchApeWisdomBoardPage;
  const boards = options.boards ?? APEWISDOM_STOCK_FILTERS;

  // Resolved once for the whole run, not per row: nine boards times up to fifty pages is a lot
  // of lookups against a table that cannot change mid-run.
  const securities = await listActiveSecurities(db);
  const byTicker = new Map(securities.map((security) => [security.symbol.toUpperCase(), security.id]));

  const failures: BoardFailure[] = [];
  let rowsSeen = 0;
  let rowsWritten = 0;
  let matched = 0;
  let unmatched = 0;
  let pagesFetched = 0;
  let boardsSucceeded = 0;

  for (const board of boards) {
    let page = 1;
    let pagesTotal = 1;
    let boardFailed = false;

    while (page <= pagesTotal && page <= MAX_PAGES_PER_BOARD) {
      const result = await fetchPage(
        {
          filter: board,
          page,
          ...(options.headers === undefined ? {} : { headers: options.headers }),
        },
        providerMode,
        { ...deps, ...(options.fixturesRoot === undefined ? {} : { fixturesRoot: options.fixturesRoot }) },
      );

      if (!result.ok) {
        // Keep whatever pages this board already yielded and move to the next board.
        failures.push({ board, page, error: result.error });
        boardFailed = true;
        break;
      }

      pagesFetched += 1;
      pagesTotal = Math.max(1, result.data.meta.pages);

      for (const entry of result.data.entries) {
        rowsSeen += 1;
        const securityId = byTicker.get(entry.ticker.toUpperCase()) ?? null;
        if (securityId === null) unmatched += 1;
        else matched += 1;

        const written = await insertAttentionBoardRow(
          {
            source: 'apewisdom',
            board,
            ticker: entry.ticker,
            name: entry.name,
            securityId,
            rank: entry.rank,
            mentions: toInteger(entry.mentions) ?? 0,
            upvotes: toInteger(entry.upvotes),
            rank24hAgo: toInteger(entry.rank24hAgo),
            mentions24hAgo: toInteger(entry.mentions24hAgo),
            page,
            pagesTotal,
            providerMethodologyVersion: BOARD_METHOD_VERSION,
            observedAt: now,
            rawHash: boardRowHash(board, entry),
          },
          db,
        );
        if (written.inserted) rowsWritten += 1;
      }

      page += 1;
    }

    if (!boardFailed) boardsSucceeded += 1;
  }

  return {
    // A run is ok if any board yielded anything. Every board failing is a total outage, and the
    // caller reports it as a failed job rather than a quiet zero.
    ok: boardsSucceeded > 0,
    observedAt: now.toISOString(),
    boardsAttempted: boards.length,
    boardsSucceeded,
    rowsSeen,
    rowsWritten,
    matched,
    unmatched,
    pagesFetched,
    failures,
  };
}

/**
 * Over the provider's values **as sent**, so a changed reading is a different hash.
 *
 * `rank` is stringified because it is the one field ApeWisdom sends as a real number rather than
 * a numeric string, and `canonicalize` rejects a raw JS number outright
 * (`02-ARCHITECTURE-CONTRACTS.md` §4.2: values cross that boundary as decimal strings, never as
 * floats). Stringifying preserves the provider's value exactly; coercing the other direction —
 * parsing the numeric strings into numbers — would not.
 */
function boardRowHash(board: string, entry: ApeWisdomEntry): string {
  return canonicalHash({
    board,
    rank: String(entry.rank),
    ticker: entry.ticker,
    name: entry.name,
    mentions: entry.mentions,
    upvotes: entry.upvotes,
    rank24hAgo: entry.rank24hAgo,
    mentions24hAgo: entry.mentions24hAgo,
  });
}
