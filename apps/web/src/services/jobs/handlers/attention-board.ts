/**
 * `attention.board` — captures the whole ApeWisdom board (every stock filter, every page) into
 * `attention_board_snapshot`.
 *
 * Distinct from `attention.snapshot`, which writes the universe-scoped `attention_snapshot`
 * series analytics read. Both run: this one is the raw superset, kept because under D-16
 * collection is forward-only with no backfill and ApeWisdom is free and keyless, so a board row
 * not captured today is gone permanently.
 */
import { collectAttentionBoards } from '@/services/attention/board-collector';
import { APEWISDOM_STOCK_FILTERS } from '@/adapters/apewisdom';
import { env } from '@/env';
import type { JobHandler } from '../registry';

export const ATTENTION_BOARD_JOB_KEY = 'attention.board';

export const attentionBoardHandler: JobHandler = async (ctx) => {
  if (ctx.dryRun) {
    return {
      status: 'succeeded',
      dryRunSummary: {
        willCall: APEWISDOM_STOCK_FILTERS.map(
          (board) => `https://apewisdom.io/api/v1.0/filter/${board}/page/{1..n}`,
        ),
        estimatedCostUsd: '0',
        message:
          `Would page through ${APEWISDOM_STOCK_FILTERS.length} ApeWisdom stock board(s) and write ` +
          'every entry to attention_board_snapshot, resolving tickers to securities where possible ' +
          'and storing null where not. ApeWisdom is free and keyless — this run would cost $0.',
      },
    };
  }

  const outcome = await collectAttentionBoards({
    db: ctx.db,
    now: ctx.now,
    providerMode: env.PROVIDER_MODE,
  });

  if (!outcome.ok) {
    // Every board failed: nothing was captured and nothing can be vouched for.
    return {
      status: 'failed',
      providerCalls: outcome.failures.length,
      estimatedCostUsd: '0',
      error: {
        kind: 'total_outage',
        message: `all ${outcome.boardsAttempted} ApeWisdom board(s) failed`,
        failures: outcome.failures.map((failure) => `${failure.board}#${failure.page}`),
      },
    };
  }

  return {
    // Some boards captured, some failed: degraded. The rows collected are real, and one board's
    // 500 must not discard the other eight.
    status: outcome.failures.length > 0 ? 'degraded' : 'succeeded',
    itemsRead: outcome.rowsSeen,
    itemsWritten: outcome.rowsWritten,
    providerCalls: outcome.pagesFetched,
    estimatedCostUsd: '0',
    dataAsOf: new Date(outcome.observedAt),
    metrics: {
      boardsAttempted: outcome.boardsAttempted,
      boardsSucceeded: outcome.boardsSucceeded,
      pagesFetched: outcome.pagesFetched,
      rowsSeen: outcome.rowsSeen,
      rowsWritten: outcome.rowsWritten,
      // The split that matters: `matched` rows also feed the universe-scoped series, `unmatched`
      // exist only here and are the whole reason this job was added.
      matched: outcome.matched,
      unmatched: outcome.unmatched,
      failures: outcome.failures.map((failure) => `${failure.board}#${failure.page}`),
    },
  };
};
