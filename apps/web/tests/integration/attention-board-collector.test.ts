/**
 * The full-board capture, against a real Postgres.
 *
 * The properties worth a database rather than a fake: that an **unmatched** ticker is stored
 * (the whole reason this table exists — `attention_snapshot` cannot hold one), that the board is
 * part of the row's identity, and that a repeat is distinguished from a revision by hash.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { collectAttentionBoards } from '../../src/services/attention/board-collector';
import { insertSecurity } from '../../src/repositories/security';
import { makePool, resetSchema } from './helpers/db';

const pool = makePool();
afterAll(async () => pool.end());

beforeEach(async () => {
  await resetSchema(pool);
});

function page(entries: { rank: number; ticker: string; name: string; mentions: string }[], pages = 1, currentPage = 1) {
  return {
    ok: true as const,
    data: {
      entries: entries.map((e) => ({
        ...e,
        upvotes: '10',
        rank24hAgo: '5',
        mentions24hAgo: '20',
      })),
      meta: { count: entries.length, pages, currentPage },
    },
    meta: { provider: 'apewisdom', operation: 'filter', cached: false } as never,
  };
}

async function boardRows() {
  const { rows } = await pool.query(
    'select board, ticker, name, security_id, rank, mentions, upvotes, page, pages_total from attention_board_snapshot order by board, rank',
  );
  return rows;
}

describe('the ApeWisdom board collector', () => {
  it('stores a ticker that resolves to no security — the row attention_snapshot cannot hold', async () => {
    const outcome = await collectAttentionBoards({
      db: pool,
      boards: ['wallstreetbets'],
      now: new Date('2026-09-05T12:00:00Z'),
      fetchPage: async () =>
        page([{ rank: 1, ticker: 'NOTREAL', name: 'Not A Real Security', mentions: '900' }]) as never,
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.unmatched).toBe(1);
    expect(outcome.matched).toBe(0);

    const rows = await boardRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['security_id']).toBeNull();
    // The provider's own name is kept: it is what makes an unresolved ticker identifiable later.
    expect(rows[0]?.['name']).toBe('Not A Real Security');
  });

  it('resolves a ticker that is in the security master', async () => {
    await insertSecurity({
      symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', assetType: 'equity',
      sector: null, industry: null, cik: null, currency: 'USD', active: true, aliases: [],
    }, pool);

    const outcome = await collectAttentionBoards({
      db: pool,
      boards: ['wallstreetbets'],
      fetchPage: async () => page([{ rank: 1, ticker: 'AAPL', name: 'Apple Inc.', mentions: '500' }]) as never,
    });

    expect(outcome.matched).toBe(1);
    expect((await boardRows())[0]?.['security_id']).not.toBeNull();
  });

  it('pages through a board until the provider says there are no more', async () => {
    const outcome = await collectAttentionBoards({
      db: pool,
      boards: ['wallstreetbets'],
      fetchPage: async (options) =>
        page(
          [{ rank: (options.page ?? 1) * 10, ticker: `T${options.page ?? 1}`, name: `Ticker ${options.page ?? 1}`, mentions: '5' }],
          3,
          options.page ?? 1,
        ) as never,
    });

    // Three pages, not the one page the previous collector took.
    expect(outcome.pagesFetched).toBe(3);
    expect(outcome.rowsWritten).toBe(3);
    expect((await boardRows()).map((row) => row['ticker'])).toEqual(['T1', 'T2', 'T3']);
  });

  it('keeps the same ticker on two boards as two facts, not one', async () => {
    const outcome = await collectAttentionBoards({
      db: pool,
      boards: ['wallstreetbets', 'stocks'],
      fetchPage: async (options) =>
        page([{ rank: options.filter === 'stocks' ? 7 : 1, ticker: 'GME', name: 'GameStop', mentions: '400' }]) as never,
    });

    // "GME was 1st on wallstreetbets and 7th on stocks" is two observations. Deduplicating them
    // would destroy exactly the per-board distinction this table exists to record.
    expect(outcome.rowsWritten).toBe(2);
    const rows = await boardRows();
    expect(rows.map((row) => [row['board'], row['rank']])).toEqual([
      ['stocks', 7],
      ['wallstreetbets', 1],
    ]);
  });

  it('treats an identical re-read as a repeat, and a changed one as a revision', async () => {
    const at = new Date('2026-09-05T12:00:00Z');
    const entry = { rank: 1, ticker: 'GME', name: 'GameStop', mentions: '400' };

    const first = await collectAttentionBoards({
      db: pool, boards: ['wallstreetbets'], now: at,
      fetchPage: async () => page([entry]) as never,
    });
    const repeat = await collectAttentionBoards({
      db: pool, boards: ['wallstreetbets'], now: at,
      fetchPage: async () => page([entry]) as never,
    });
    const revision = await collectAttentionBoards({
      db: pool, boards: ['wallstreetbets'], now: at,
      fetchPage: async () => page([{ ...entry, mentions: '450' }]) as never,
    });

    expect(first.rowsWritten).toBe(1);
    // Same identity, same content: nothing written.
    expect(repeat.rowsWritten).toBe(0);
    // Same identity, different content: a successor row, storable because ingested_at is in the
    // primary key — no UPDATE, which the append-only trigger forbids.
    expect(revision.rowsWritten).toBe(1);

    const { rows } = await pool.query('select count(*)::int as n from attention_board_snapshot');
    expect(rows[0]?.['n']).toBe(2);
  });

  it('one board failing does not cost the others their capture', async () => {
    const outcome = await collectAttentionBoards({
      db: pool,
      boards: ['wallstreetbets', 'stocks'],
      fetchPage: async (options) =>
        options.filter === 'stocks'
          ? ({ ok: false, error: { kind: 'upstream', status: 500 }, meta: {} } as never)
          : (page([{ rank: 1, ticker: 'GME', name: 'GameStop', mentions: '400' }]) as never),
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.boardsSucceeded).toBe(1);
    expect(outcome.failures.map((failure) => failure.board)).toEqual(['stocks']);
    expect(await boardRows()).toHaveLength(1);
  });

  it('stores a malformed count as null rather than guessing a zero', async () => {
    await collectAttentionBoards({
      db: pool,
      boards: ['wallstreetbets'],
      fetchPage: async () =>
        ({
          ok: true,
          data: {
            entries: [{ rank: 1, ticker: 'GME', name: 'GameStop', mentions: '400', upvotes: 'n/a', rank24hAgo: '', mentions24hAgo: '20' }],
            meta: { count: 1, pages: 1, currentPage: 1 },
          },
          meta: {},
        }) as never,
    });

    const rows = await boardRows();
    expect(rows[0]?.['upvotes']).toBeNull();
    expect(rows[0]?.['mentions']).toBe(400);
  });
});
