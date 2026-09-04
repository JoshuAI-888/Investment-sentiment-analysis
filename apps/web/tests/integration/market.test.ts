import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import {
  insertMarketSnapshot,
  latestMarketSnapshot,
  marketSnapshotHistory,
  insertPriceReturnSnapshot,
  latestPriceReturnSnapshot,
  priceReturnSnapshotHistory,
  type NewMarketSnapshot,
  type NewPriceReturnSnapshot,
} from '../../src/repositories/market';
import { closePool, getPool } from '../../src/repositories/client';

const url = databaseUrl();

/**
 * F09 §4.1 (header price/change) and §4.2 (price axis), F06's `price.regime` / `technical.*`
 * methods — all read `market_snapshot` and `price_return_snapshot` through this repository, with
 * no provider call in the read path (F09 DoD item 1).
 */
describe.skipIf(url === undefined)('market_snapshot repository', () => {
  let pool: pg.Pool;
  let securityId: string;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
    getPool(url);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
    const { rows } = await pool.query<{ id: string }>(
      `insert into security (symbol, name, exchange, asset_type, currency)
       values ('GME', 'GameStop', 'NYSE', 'equity', 'USD') returning id`,
    );
    securityId = rows[0]?.id as string;
  });

  afterAll(async () => {
    await closePool();
    await pool?.end();
  });

  function snapshot(overrides: Partial<NewMarketSnapshot> = {}): NewMarketSnapshot {
    return {
      securityId,
      price: '24.50',
      changePercent: '1.25',
      session: 'eod',
      provider: 'fmp',
      observedAt: new Date('2026-09-01T00:00:00Z'),
      rawHash: 'hash-1',
      ...overrides,
    };
  }

  describe('insertMarketSnapshot', () => {
    it('writes a new row when none exists', async () => {
      const result = await insertMarketSnapshot(snapshot());
      expect(result.inserted).toBe(true);
      expect(result.snapshot.price).toBe('24.50');

      const { rows } = await pool.query('select count(*)::text as count from market_snapshot');
      expect(rows[0]?.count).toBe('1');
    });

    it('is idempotent on a repeated observation', async () => {
      const first = await insertMarketSnapshot(snapshot());
      const second = await insertMarketSnapshot(snapshot());

      expect(first.inserted).toBe(true);
      expect(second.inserted).toBe(false);
      expect(second.snapshot.rawHash).toBe(first.snapshot.rawHash);

      const { rows } = await pool.query('select count(*)::text as count from market_snapshot');
      expect(rows[0]?.count).toBe('1');
    });

    it('is idempotent even when the re-run passes an ingestedAt older than the existing row\'s', async () => {
      const first = await insertMarketSnapshot(
        snapshot({ ingestedAt: new Date('2020-01-05T00:00:00Z') }),
      );
      const second = await insertMarketSnapshot(
        snapshot({ ingestedAt: new Date('2020-01-01T00:00:00Z') }),
      );

      expect(first.inserted).toBe(true);
      expect(second.inserted).toBe(false);
      expect(second.snapshot.rawHash).toBe(first.snapshot.rawHash);
    });

    it('inserts a successor rather than overwriting when the observation is revised', async () => {
      const first = await insertMarketSnapshot(snapshot({ rawHash: 'hash-1' }));
      const revised = await insertMarketSnapshot(snapshot({ rawHash: 'hash-2', price: '30.00' }));

      expect(first.inserted).toBe(true);
      expect(revised.inserted).toBe(true);
      expect(revised.snapshot.price).toBe('30.00');

      const { rows } = await pool.query<{ raw_hash: string; price: string }>(
        'select raw_hash, price from market_snapshot order by ingested_at asc',
      );
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ raw_hash: 'hash-1', price: '24.50' });
      expect(rows[1]).toMatchObject({ raw_hash: 'hash-2', price: '30.00' });
    });

    it('handles a genuine concurrent race gracefully — two inserts sharing an identical ingestedAt', async () => {
      // Unlike a sequential retry, this forces the *actual* primary key
      // (security_id, provider, observed_at, ingested_at) to collide: both calls pass the same
      // pinned ingestedAt, so if both race past the `where not exists` pre-check before either
      // commits (the one thing this repository's manual check cannot serialize against — see
      // the module docstring), the second physical INSERT collides with the first's row on the
      // real primary key and Postgres itself raises 23505, which the catch block must recover
      // from rather than let escape to the caller.
      const racedIngestedAt = new Date('2026-09-01T00:00:00Z');
      const input = snapshot({ ingestedAt: racedIngestedAt, rawHash: 'raced' });

      const [first, second] = await Promise.all([
        insertMarketSnapshot(input, pool),
        insertMarketSnapshot(input, pool),
      ]);

      // Exactly one row exists, and both calls returned successfully (no unhandled exception),
      // whichever one "won" the race.
      expect([first.inserted, second.inserted].sort()).toEqual([false, true]);
      expect(first.snapshot.rawHash).toBe('raced');
      expect(second.snapshot.rawHash).toBe('raced');

      const { rows } = await pool.query('select count(*)::text as count from market_snapshot');
      expect(rows[0]?.count).toBe('1');
    });

    it('does not throw on an idempotent retry when observed_at is in the future (lane-review round 3, finding 2)', async () => {
      // A pre/after-hours print timestamped ahead of the collector's clock, or ordinary clock
      // skew — either way, a legitimately future-dated observed_at must not turn a successful
      // idempotent retry into a thrown exception. The read-back this exercises is an identity
      // lookup for a row already known to exist, not a point-in-time query, and must not be
      // bounded at real "now".
      const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const first = await insertMarketSnapshot(snapshot({ rawHash: 'future-print', observedAt: future }));
      const second = await insertMarketSnapshot(snapshot({ rawHash: 'future-print', observedAt: future }));

      expect(first.inserted).toBe(true);
      expect(second.inserted).toBe(false);
      expect(second.snapshot.rawHash).toBe('future-print');
    });
  });

  describe('latestMarketSnapshot / marketSnapshotHistory', () => {
    it('returns null when there is no observation yet', async () => {
      const result = await latestMarketSnapshot({ securityId, asOfInstant: new Date('2026-09-01T00:00:00Z') });
      expect(result).toBeNull();
    });

    it('returns the most recent observation as of the given instant', async () => {
      await insertMarketSnapshot(
        snapshot({
          observedAt: new Date('2026-09-01T00:00:00Z'),
          ingestedAt: new Date('2026-09-01T00:00:00Z'),
          rawHash: 'd1',
          price: '20.00',
        }),
      );
      await insertMarketSnapshot(
        snapshot({
          observedAt: new Date('2026-09-02T00:00:00Z'),
          ingestedAt: new Date('2026-09-02T00:00:00Z'),
          rawHash: 'd2',
          price: '22.00',
        }),
      );

      const latest = await latestMarketSnapshot({
        securityId,
        asOfInstant: new Date('2026-09-03T00:00:00Z'),
      });
      expect(latest?.price).toBe('22.00');
    });

    it('excludes an observation ingested after the as-of instant (F22 §4.2 look-ahead guard)', async () => {
      const cutoff = new Date('2026-09-01T12:00:00Z');
      await insertMarketSnapshot(
        snapshot({
          observedAt: new Date('2026-09-01T00:00:00Z'),
          ingestedAt: new Date('2026-09-01T01:00:00Z'),
          rawHash: 'known-then',
          price: '20.00',
        }),
      );
      // A correction learned after the cutoff — knowable now, not knowable as of `cutoff`.
      await insertMarketSnapshot(
        snapshot({
          observedAt: new Date('2026-09-01T00:00:00Z'),
          ingestedAt: new Date('2026-09-05T00:00:00Z'),
          rawHash: 'learned-later',
          price: '999.00',
        }),
      );

      const asOfCutoff = await latestMarketSnapshot({ securityId, asOfInstant: cutoff });
      expect(asOfCutoff?.price).toBe('20.00');

      const asOfLater = await latestMarketSnapshot({
        securityId,
        asOfInstant: new Date('2026-09-06T00:00:00Z'),
      });
      expect(asOfLater?.price).toBe('999.00');
    });

    it('collapses a corrected observation to one row per observed_at in the history series', async () => {
      await insertMarketSnapshot(
        snapshot({
          observedAt: new Date('2026-09-01T00:00:00Z'),
          ingestedAt: new Date('2026-09-01T00:00:00Z'),
          rawHash: 'a',
          price: '10.00',
        }),
      );
      await insertMarketSnapshot(
        snapshot({
          observedAt: new Date('2026-09-02T00:00:00Z'),
          ingestedAt: new Date('2026-09-02T00:00:00Z'),
          rawHash: 'b',
          price: '20.00',
        }),
      );
      await insertMarketSnapshot(
        snapshot({
          observedAt: new Date('2026-09-01T00:00:00Z'),
          ingestedAt: new Date('2026-09-03T00:00:00Z'),
          rawHash: 'a-corrected',
          price: '15.00',
        }),
      );

      const history = await marketSnapshotHistory({
        securityId,
        asOfInstant: new Date('2026-09-04T00:00:00Z'),
      });

      expect(history).toHaveLength(2);
      expect(history.map((row) => row.price).sort()).toEqual(['15.00', '20.00']);
    });

    it('filters to one session when asked — a daily-bar series for the technical methods', async () => {
      await insertMarketSnapshot(
        snapshot({
          observedAt: new Date('2026-09-01T00:00:00Z'),
          ingestedAt: new Date('2026-09-01T00:00:00Z'),
          session: 'eod',
          rawHash: 'eod-1',
          price: '20.00',
        }),
      );
      await insertMarketSnapshot(
        snapshot({
          observedAt: new Date('2026-09-01T12:00:00Z'),
          ingestedAt: new Date('2026-09-01T12:00:00Z'),
          session: 'regular',
          rawHash: 'intraday-1',
          price: '21.00',
        }),
      );

      const eodOnly = await marketSnapshotHistory({
        securityId,
        asOfInstant: new Date('2026-09-02T00:00:00Z'),
        session: 'eod',
      });
      expect(eodOnly).toHaveLength(1);
      expect(eodOnly[0]?.rawHash).toBe('eod-1');

      const anySession = await marketSnapshotHistory({
        securityId,
        asOfInstant: new Date('2026-09-02T00:00:00Z'),
      });
      expect(anySession).toHaveLength(2);
    });
  });
});

/**
 * F09 §4.2's price axis reads whichever legal horizon exists (see `market.ts`'s module
 * docstring for why this repository never accepts a `5` or `20` day horizon — the check
 * constraint in migration `0002` only permits `7, 30, 90, 180`).
 */
describe.skipIf(url === undefined)('price_return_snapshot repository', () => {
  let pool: pg.Pool;
  let securityId: string;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
    getPool(url);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
    const { rows } = await pool.query<{ id: string }>(
      `insert into security (symbol, name, exchange, asset_type, currency)
       values ('GME', 'GameStop', 'NYSE', 'equity', 'USD') returning id`,
    );
    securityId = rows[0]?.id as string;
  });

  afterAll(async () => {
    await closePool();
    await pool?.end();
  });

  function priceReturn(overrides: Partial<NewPriceReturnSnapshot> = {}): NewPriceReturnSnapshot {
    return {
      securityId,
      asOfDate: '2026-09-01',
      horizonCalendarDays: 7,
      asOfPrice: '24.50',
      asOfPriceDate: '2026-09-01',
      baselinePrice: '23.00',
      baselinePriceDate: '2026-08-25',
      totalReturn: '0.0652',
      adjustmentStatus: 'adjusted',
      qualityStatus: 'ok',
      provider: 'fmp',
      methodVersion: 'price-return-v1',
      ...overrides,
    };
  }

  it('writes a new row when none exists', async () => {
    const result = await insertPriceReturnSnapshot(priceReturn());
    expect(result.inserted).toBe(true);
    expect(result.snapshot.totalReturn).toBe('0.0652');
  });

  it('is idempotent on an exact repeat of the same identity', async () => {
    const first = await insertPriceReturnSnapshot(priceReturn());
    const second = await insertPriceReturnSnapshot(priceReturn());

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(second.snapshot.totalReturn).toBe(first.snapshot.totalReturn);

    const { rows } = await pool.query('select count(*)::text as count from price_return_snapshot');
    expect(rows[0]?.count).toBe('1');
  });

  it('a revised return is only representable as a new method_version, never an overwrite', async () => {
    const first = await insertPriceReturnSnapshot(priceReturn({ methodVersion: 'price-return-v1' }));
    const revised = await insertPriceReturnSnapshot(
      priceReturn({ methodVersion: 'price-return-v2', totalReturn: '0.0700' }),
    );

    expect(first.inserted).toBe(true);
    expect(revised.inserted).toBe(true);

    const { rows } = await pool.query<{ method_version: string; total_return: string }>(
      'select method_version, total_return from price_return_snapshot order by method_version asc',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ method_version: 'price-return-v1', total_return: '0.0652' });
    expect(rows[1]).toMatchObject({ method_version: 'price-return-v2', total_return: '0.0700' });
  });

  it('resolves a genuine concurrent race with on-conflict-do-nothing, never an exception', async () => {
    const input = priceReturn();
    const [first, second] = await Promise.all([
      insertPriceReturnSnapshot(input, pool),
      insertPriceReturnSnapshot(input, pool),
    ]);

    expect([first.inserted, second.inserted].sort()).toEqual([false, true]);
    const { rows } = await pool.query('select count(*)::text as count from price_return_snapshot');
    expect(rows[0]?.count).toBe('1');
  });

  it('respects the as-of bound on computed_at — a not-yet-computed return does not leak', async () => {
    await insertPriceReturnSnapshot(
      priceReturn({ computedAt: new Date('2026-09-01T00:00:00Z'), totalReturn: '0.05' }),
    );

    const before = await latestPriceReturnSnapshot({
      securityId,
      horizonCalendarDays: 7,
      asOfInstant: new Date('2026-08-31T00:00:00Z'),
    });
    expect(before).toBeNull();

    const after = await latestPriceReturnSnapshot({
      securityId,
      horizonCalendarDays: 7,
      asOfInstant: new Date('2026-09-02T00:00:00Z'),
    });
    expect(after?.totalReturn).toBe('0.05');
  });

  it('filters to one horizon and does not leak another', async () => {
    // `computedAt` pinned explicitly on both inserts — left to default to the real wall clock,
    // this test would pass only until that clock reached its own hardcoded `asOfInstant` below,
    // the same recurring defect `attention.test.ts`'s history already found more than once
    // (lane-review finding 3).
    const computedAt = new Date('2026-09-01T00:00:00Z');
    await insertPriceReturnSnapshot(
      priceReturn({ horizonCalendarDays: 7, totalReturn: '0.01', computedAt }),
    );
    await insertPriceReturnSnapshot(
      priceReturn({ horizonCalendarDays: 30, totalReturn: '0.05', computedAt }),
    );

    const sevenDay = await priceReturnSnapshotHistory({
      securityId,
      horizonCalendarDays: 7,
      asOfInstant: new Date('2026-09-02T00:00:00Z'),
    });
    expect(sevenDay).toHaveLength(1);
    expect(sevenDay[0]?.totalReturn).toBe('0.01');
  });

  it('rejects a horizon the check constraint does not accept, at the database level', async () => {
    await expect(
      pool.query(
        `insert into price_return_snapshot
           (security_id, as_of_date, horizon_calendar_days, as_of_price, as_of_price_date,
            baseline_price, baseline_price_date, adjustment_status, quality_status, provider,
            method_version)
         values ($1, '2026-09-01', 5, '24.50', '2026-09-01', '23.00', '2026-08-27', 'adjusted', 'ok',
                 'fmp', 'price-return-v1')`,
        [securityId],
      ),
    ).rejects.toThrow(/horizon/);
  });
});
