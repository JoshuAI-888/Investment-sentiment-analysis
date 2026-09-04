import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import { closePool, getPool, type Queryable } from '../../src/repositories/client';
import { marketSnapshotHistory } from '../../src/repositories/market';
import { collectMarketSnapshots, MARKET_DATA_PROVIDER } from '../../src/services/market/collector';
import { marketCollectorWrapperDeps } from '../../src/services/market/provider-deps';

/** A clock that never actually sleeps, so a test driving several retries isn't at the mercy of
 *  real exponential-backoff delay. */
const fastClock = { now: () => new Date(), sleep: async () => {} };

const url = databaseUrl();

const withCase = (fixtureCase: string) => ({ 'x-fixture-case': fixtureCase });

/**
 * Writes a scratch fixture tree for `market/historical_price_full` rather than adding a case to
 * the committed `fixtures/market/historical_price_full/` — that directory's nine-case matrix is
 * already closed for this adapter (`docs/progress/collect.md`), and a test-only shape (a bar with
 * a non-positive close) does not belong alongside it. Mirrors the identical pattern already used
 * for ApeWisdom on `feat/F08-attention-leaderboard` (round-49 lane-review finding 1).
 */
async function writeMarketFixture(caseName: string, body: unknown): Promise<string> {
  const fixturesRoot = await mkdtemp(join(tmpdir(), 'market-collector-'));
  await mkdir(join(fixturesRoot, 'market', 'historical_price_full'), { recursive: true });
  await writeFile(
    join(fixturesRoot, 'market', 'historical_price_full', `${caseName}.json`),
    JSON.stringify({ status: 200, headers: { 'content-type': 'application/json' }, body }),
  );
  return fixturesRoot;
}

function historicalBody(symbol: string, historical: readonly Record<string, unknown>[]) {
  return { symbol, historical };
}

/**
 * F04 §4.3.1 / §6: this collector's primary-scope DoD — one `market_snapshot` row per active
 * security per run, honest per-security failure handling, idempotent on a repeated observation.
 * Against a real Postgres, like every other repository-backed collector in this codebase — the
 * property under test (`insertMarketSnapshot`'s no-op-on-repeat idempotency) exists only there.
 */
describe.skipIf(url === undefined)('F04 — the market-data collector', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
    getPool(url);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
  });

  afterAll(async () => {
    await closePool();
    await pool?.end();
  });

  async function insertSecurity(symbol: string, active = true): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `insert into security (symbol, name, exchange, asset_type, currency, active)
       values ($1, $2, 'NASDAQ', 'equity', 'USD', $3) returning id`,
      [symbol, `${symbol} Inc.`, active],
    );
    return rows[0]?.id as string;
  }

  it('uses the committed success fixture to persist one snapshot per active security', async () => {
    const aapl = await insertSecurity('AAPL');
    const gme = await insertSecurity('GME');

    const outcome = await collectMarketSnapshots({ providerMode: 'fixture' });

    expect(outcome.failures).toEqual([]);
    expect(outcome.results.map((r) => r.symbol).sort()).toEqual(['AAPL', 'GME']);
    expect(outcome.results.every((r) => r.inserted)).toBe(true);

    const history = await marketSnapshotHistory({
      securityId: aapl,
      asOfInstant: new Date('2099-01-01T00:00:00Z'),
    });
    expect(history).toHaveLength(1);
    // fixtures/market/historical_price_full/success.json: the newest of the two recorded bars.
    expect(history[0]).toMatchObject({
      price: '232.1',
      session: 'eod',
      provider: MARKET_DATA_PROVIDER,
      observedAt: new Date('2026-08-28T00:00:00.000Z'),
    });

    const gmeHistory = await marketSnapshotHistory({
      securityId: gme,
      asOfInstant: new Date('2099-01-01T00:00:00Z'),
    });
    expect(gmeHistory).toHaveLength(1);
  });

  it('excludes an inactive security', async () => {
    await insertSecurity('AAPL');
    await insertSecurity('DELISTED', false);

    const outcome = await collectMarketSnapshots({ providerMode: 'fixture' });
    expect(outcome.results.map((r) => r.symbol)).toEqual(['AAPL']);
  });

  it('returns no results and no failures when there are no active securities', async () => {
    const outcome = await collectMarketSnapshots({ providerMode: 'fixture' });
    expect(outcome).toMatchObject({ results: [], failures: [] });
  });

  it('is idempotent: running the collector twice against an unchanged bar writes one row', async () => {
    await insertSecurity('AAPL');

    const first = await collectMarketSnapshots({ providerMode: 'fixture' });
    const second = await collectMarketSnapshots({ providerMode: 'fixture' });

    expect(first.results[0]?.inserted).toBe(true);
    expect(second.results[0]?.inserted).toBe(false);

    const { rows } = await pool.query('select count(*)::text as count from market_snapshot');
    expect(rows[0]?.count).toBe('1');
  });

  it("a security with no bars returned is reported as a failure, not fabricated as a snapshot", async () => {
    await insertSecurity('ZZZZ');

    const outcome = await collectMarketSnapshots({
      providerMode: 'fixture',
      headers: withCase('empty'),
    });

    expect(outcome.results).toEqual([]);
    expect(outcome.failures).toMatchObject([{ symbol: 'ZZZZ', reason: 'no_bars_returned' }]);

    const { rows } = await pool.query('select count(*)::text as count from market_snapshot');
    expect(rows[0]?.count).toBe('0');
  });

  it("a provider entitlement failure for one security never touches another security's result", async () => {
    const good = await insertSecurity('AAPL');
    const denied = await insertSecurity('BLOCKED');

    const outcome = await collectMarketSnapshots({
      providerMode: 'fixture',
      headersBySymbol: { BLOCKED: withCase('entitlement_403') },
    });

    expect(outcome.results.map((r) => r.symbol)).toEqual(['AAPL']);
    expect(outcome.failures).toMatchObject([
      { symbol: 'BLOCKED', reason: 'provider_error', error: { kind: 'entitlement' } },
    ]);

    const goodHistory = await marketSnapshotHistory({
      securityId: good,
      asOfInstant: new Date('2099-01-01T00:00:00Z'),
    });
    expect(goodHistory).toHaveLength(1);

    const deniedHistory = await marketSnapshotHistory({
      securityId: denied,
      asOfInstant: new Date('2099-01-01T00:00:00Z'),
    });
    expect(deniedHistory).toHaveLength(0);
  });

  it('a malformed bar (non-positive close) for one security is dropped while a genuinely successful one persists, in the same run', async () => {
    const fixturesRoot = await writeMarketFixture(
      'success',
      historicalBody('AAPL', [
        { date: '2026-08-28', open: 230.12, high: 233.4, low: 229.8, close: 232.1, volume: 54321000 },
      ]),
    );
    await mkdir(join(fixturesRoot, 'market', 'historical_price_full'), { recursive: true });
    await writeFile(
      join(fixturesRoot, 'market', 'historical_price_full', 'bad_close.json'),
      JSON.stringify({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: historicalBody('BADCLOSE', [
          { date: '2026-08-28', open: 10, high: 11, low: 9, close: 0, volume: 1000 },
        ]),
      }),
    );

    const good = await insertSecurity('AAPL');
    const bad = await insertSecurity('BADCLOSE');

    const outcome = await collectMarketSnapshots({
      providerMode: 'fixture',
      fixturesRoot,
      headersBySymbol: { BADCLOSE: withCase('bad_close') },
    });

    expect(outcome.results).toMatchObject([{ symbol: 'AAPL', inserted: true }]);
    expect(outcome.failures).toMatchObject([{ symbol: 'BADCLOSE', reason: 'malformed_bar' }]);

    const goodHistory = await marketSnapshotHistory({
      securityId: good,
      asOfInstant: new Date('2099-01-01T00:00:00Z'),
    });
    expect(goodHistory).toHaveLength(1);

    const badHistory = await marketSnapshotHistory({
      securityId: bad,
      asOfInstant: new Date('2099-01-01T00:00:00Z'),
    });
    expect(badHistory).toHaveLength(0);
  });

  it('picks the most recent of several bars, not the first in the array', async () => {
    const fixturesRoot = await writeMarketFixture(
      'success',
      historicalBody('AAPL', [
        // Deliberately oldest-first, the opposite of FMP's real ordering, so this proves
        // `mostRecentBar` is actually consulted rather than the array's first element.
        { date: '2026-08-01', open: 100, high: 105, low: 99, close: 101, volume: 1000 },
        { date: '2026-08-28', open: 230.12, high: 233.4, low: 229.8, close: 232.1, volume: 54321000 },
      ]),
    );
    const security = await insertSecurity('AAPL');

    const outcome = await collectMarketSnapshots({ providerMode: 'fixture', fixturesRoot });
    expect(outcome.results).toMatchObject([{ symbol: 'AAPL', inserted: true }]);

    const history = await marketSnapshotHistory({
      securityId: security,
      asOfInstant: new Date('2099-01-01T00:00:00Z'),
    });
    expect(history[0]).toMatchObject({ price: '232.1', observedAt: new Date('2026-08-28T00:00:00.000Z') });
  });

  it('stamps ingestedAt from an injected clock rather than the real wall clock', async () => {
    await insertSecurity('AAPL');
    const now = new Date('2030-01-01T00:00:00.000Z');

    const outcome = await collectMarketSnapshots({ providerMode: 'fixture', now });
    expect(outcome.collectedAt).toBe(now.toISOString());

    const { rows } = await pool.query<{ ingested_at: string }>(
      'select ingested_at from market_snapshot limit 1',
    );
    expect(new Date(rows[0]?.ingested_at as string).toISOString()).toBe(now.toISOString());
  });

  // Post-review findings 1/2: an uncaught exception anywhere inside one security's iteration used
  // to abort the whole `for` loop, silently skipping every security alphabetically after it — a
  // permanent, unrecoverable gap under D-16. This reproduces the exact original trigger (an
  // impossible date reaching `insertMarketSnapshot`) with a security positioned so its failure
  // would previously have swallowed the next one.
  it("one security's unparseable bar never stops the run — every other security is still processed", async () => {
    const fixturesRoot = await writeMarketFixture(
      'bad_date',
      historicalBody('AAADATE', [
        { date: '2026-13-45', open: 10, high: 11, low: 9, close: 10, volume: 1000 },
      ]),
    );
    await mkdir(join(fixturesRoot, 'market', 'historical_price_full'), { recursive: true });
    await writeFile(
      join(fixturesRoot, 'market', 'historical_price_full', 'success.json'),
      JSON.stringify({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: historicalBody('ZZLAST', [
          { date: '2026-08-28', open: 230.12, high: 233.4, low: 229.8, close: 232.1, volume: 54321000 },
        ]),
      }),
    );

    // Alphabetically first, so the bug this reproduces (an uncaught throw aborting the loop)
    // would previously have prevented ZZLAST from ever being polled at all.
    await insertSecurity('AAADATE');
    const afterInAlphabet = await insertSecurity('ZZLAST');

    const outcome = await collectMarketSnapshots({
      providerMode: 'fixture',
      fixturesRoot,
      headersBySymbol: { AAADATE: withCase('bad_date') },
    });

    expect(outcome.results).toMatchObject([{ symbol: 'ZZLAST', inserted: true }]);
    expect(outcome.failures).toMatchObject([{ symbol: 'AAADATE', reason: 'malformed_bar' }]);

    const history = await marketSnapshotHistory({
      securityId: afterInAlphabet,
      asOfInstant: new Date('2099-01-01T00:00:00Z'),
    });
    expect(history).toHaveLength(1);
  });

  it('rejects a nonexistent calendar date rather than silently persisting the JS date-rollover result', async () => {
    const fixturesRoot = await writeMarketFixture(
      'bad_date',
      historicalBody('BADDATE', [
        // "2026-02-30" does not exist; `new Date(...)` would silently roll it to 2026-03-02.
        { date: '2026-02-30', open: 10, high: 11, low: 9, close: 10, volume: 1000 },
      ]),
    );
    const security = await insertSecurity('BADDATE');

    const outcome = await collectMarketSnapshots({
      providerMode: 'fixture',
      fixturesRoot,
      headersBySymbol: { BADDATE: withCase('bad_date') },
    });

    expect(outcome.results).toEqual([]);
    expect(outcome.failures).toMatchObject([{ symbol: 'BADDATE', reason: 'malformed_bar' }]);

    const history = await marketSnapshotHistory({
      securityId: security,
      asOfInstant: new Date('2099-01-01T00:00:00Z'),
    });
    expect(history).toHaveLength(0);
    const { rows } = await pool.query('select count(*)::text as count from market_snapshot');
    expect(rows[0]?.count).toBe('0');
  });

  // Post-review finding 3: this collector runs on a five-minute clock job (F16 §4.1b). During
  // market hours, FMP's newest bar is the *in-progress* trading day, not a completed one —
  // persisting it as `session: 'eod'` would falsify `repositories/market.ts`'s own documented
  // "genuine daily-bar series" guarantee and churn a new revision row on every poll.
  it("does not persist today's (market-time) bar — it has not closed yet", async () => {
    const now = new Date('2026-08-28T18:00:00.000Z'); // mid-session, US Eastern
    const fixturesRoot = await writeMarketFixture(
      'success',
      historicalBody('AAPL', [
        { date: '2026-08-28', open: 230.12, high: 233.4, low: 229.8, close: 231.5, volume: 12345 },
      ]),
    );
    const security = await insertSecurity('AAPL');

    const outcome = await collectMarketSnapshots({ providerMode: 'fixture', fixturesRoot, now });

    expect(outcome.results).toEqual([]);
    expect(outcome.failures).toMatchObject([{ symbol: 'AAPL', reason: 'bar_not_final' }]);

    const history = await marketSnapshotHistory({
      securityId: security,
      asOfInstant: new Date('2099-01-01T00:00:00Z'),
    });
    expect(history).toHaveLength(0);
  });

  /**
   * Round-2 lane-review finding 2: the newest bar in the response being today's in-progress
   * print used to discard the whole response, even though the previous trading day's finalized
   * close was sitting in the same already-fetched payload. This is the two-bar case that proves
   * the fallback: the in-progress bar is never persisted, but the prior day's real close is.
   */
  it("falls back to the newest already-closed bar in the same response, rather than discarding it because the newest bar is today's", async () => {
    const now = new Date('2026-08-28T18:00:00.000Z'); // mid-session, US Eastern, market date 2026-08-28
    const fixturesRoot = await writeMarketFixture(
      'success',
      historicalBody('AAPL', [
        { date: '2026-08-27', open: 228.0, high: 231.0, low: 227.5, close: 230.0, volume: 40000000 },
        { date: '2026-08-28', open: 230.12, high: 233.4, low: 229.8, close: 231.5, volume: 12345 }, // in-progress
      ]),
    );
    const security = await insertSecurity('AAPL');

    const outcome = await collectMarketSnapshots({ providerMode: 'fixture', fixturesRoot, now });

    expect(outcome.failures).toEqual([]);
    expect(outcome.results).toMatchObject([{ symbol: 'AAPL', inserted: true }]);

    const history = await marketSnapshotHistory({
      securityId: security,
      asOfInstant: new Date('2099-01-01T00:00:00Z'),
    });
    expect(history).toHaveLength(1);
    // The prior day's finalized close, never the in-progress 2026-08-28 print.
    expect(history[0]).toMatchObject({ price: '230', observedAt: new Date('2026-08-27T00:00:00.000Z') });
  });

  /**
   * Round-3 lane-review finding 1, re-scoped by round-4 findings 1/2/4. A bar dated strictly
   * *after* today (a provider anomaly) must not cause the whole response to be discarded when a
   * usable older bar exists — the collector still finds and persists it. Round 3 additionally
   * tried to report the anomaly as a `failures` entry alongside the `results` success; round 4
   * found that incomplete (only the literal newest bar was ever checked) and self-contradictory
   * (a fallback bar that later failed its own validation could produce two conflicting
   * `malformed_bar` records for one security). This asserts the corrected, narrower contract: the
   * good bar is persisted, and the run reports it as a plain, un-flagged success — a discarded
   * anomalous bar with a usable fallback is silently superseded, a disclosed gap rather than a
   * claim of comprehensive anomaly detection (see `docs/progress/collect.md`).
   */
  it('persists a valid older bar without reporting a failure when the newest bar is dated in the future', async () => {
    const now = new Date('2026-08-28T18:00:00.000Z'); // market date 2026-08-28
    const fixturesRoot = await writeMarketFixture(
      'success',
      historicalBody('AAPL', [
        { date: '2027-04-01', open: 500, high: 505, low: 495, close: 502, volume: 1000 }, // garbage future date
        { date: '2026-08-27', open: 228.0, high: 231.0, low: 227.5, close: 230.0, volume: 40000000 },
      ]),
    );
    const security = await insertSecurity('AAPL');

    const outcome = await collectMarketSnapshots({ providerMode: 'fixture', fixturesRoot, now });

    expect(outcome.failures).toEqual([]);
    expect(outcome.results).toMatchObject([{ symbol: 'AAPL', inserted: true }]);

    const history = await marketSnapshotHistory({
      securityId: security,
      asOfInstant: new Date('2099-01-01T00:00:00Z'),
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ price: '230', observedAt: new Date('2026-08-27T00:00:00.000Z') });
  });

  /**
   * Round-3 lane-review finding 3, re-scoped by round-4 findings 1/2/4 (see the test above for
   * why this is a plain success rather than a success-plus-failure pair). A single garbage-dated
   * entry sorting above every real date used to discard the whole payload, including a genuinely
   * final older bar sitting right next to it — the same loss round-2 finding 2 fixed for a merely
   * not-yet-final newest bar, left open for a malformed one. `"2026-13-01"` string-sorts above
   * `"2026-08-27"`, reproducing the exact hazard `mostRecentBar`'s own doc already names for
   * untrusted provider ordering.
   */
  it('falls back to an older valid bar when the newest bar in the response is malformed, rather than discarding the whole response', async () => {
    const now = new Date('2026-08-29T18:00:00.000Z');
    const fixturesRoot = await writeMarketFixture(
      'success',
      historicalBody('AAPL', [
        { date: '2026-13-01', open: 500, high: 505, low: 495, close: 502, volume: 1000 }, // malformed
        { date: '2026-08-27', open: 228.0, high: 231.0, low: 227.5, close: 230.0, volume: 40000000 },
      ]),
    );
    const security = await insertSecurity('AAPL');

    const outcome = await collectMarketSnapshots({ providerMode: 'fixture', fixturesRoot, now });

    expect(outcome.failures).toEqual([]);
    expect(outcome.results).toMatchObject([{ symbol: 'AAPL', inserted: true }]);

    const history = await marketSnapshotHistory({
      securityId: security,
      asOfInstant: new Date('2099-01-01T00:00:00Z'),
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ price: '230', observedAt: new Date('2026-08-27T00:00:00.000Z') });
  });

  /**
   * Round-3 lane-review finding 4. The fallback filter's `isValidCalendarDate` clause was added
   * in the round-2 fix but nothing reached it with a malformed *older* candidate — every existing
   * `bad_date` fixture used a single bar, so the newest-bar malformed check always short-circuited
   * first. This is the case that specifically needs the filter clause: a today-dated newest bar
   * (ordinary, not itself malformed) with an older, nonexistent-date bar as the only alternative —
   * deleting the filter's date-validity clause would make this test persist the JS-rolled-over
   * `2026-02-30` → `2026-03-02` bar instead of correctly finding nothing to fall back to.
   */
  it('does not fall back to an older bar whose date is malformed, when the newest bar is only not-final', async () => {
    const now = new Date('2026-08-28T18:00:00.000Z'); // market date 2026-08-28
    const fixturesRoot = await writeMarketFixture(
      'success',
      historicalBody('AAPL', [
        { date: '2026-08-28', open: 230.12, high: 233.4, low: 229.8, close: 231.5, volume: 12345 }, // in-progress
        { date: '2026-02-30', open: 10, high: 11, low: 9, close: 10, volume: 1000 }, // nonexistent date
      ]),
    );
    const security = await insertSecurity('AAPL');

    const outcome = await collectMarketSnapshots({ providerMode: 'fixture', fixturesRoot, now });

    expect(outcome.results).toEqual([]);
    expect(outcome.failures).toMatchObject([{ symbol: 'AAPL', reason: 'bar_not_final' }]);

    const history = await marketSnapshotHistory({
      securityId: security,
      asOfInstant: new Date('2099-01-01T00:00:00Z'),
    });
    expect(history).toHaveLength(0);
  });

  /**
   * Round-4 lane-review finding 1: when the fallback bar found in place of a discarded newest bar
   * itself fails `buildMarketSnapshotInput`'s own field validation, the run must report exactly
   * one honest failure for the security — not a "success" record for a bar that was never
   * persisted, and not two conflicting `malformed_bar` entries (one for the discarded newest bar,
   * one for the fallback's own rejection).
   */
  it('reports a single honest failure when the fallback bar found for a discarded newest bar is itself invalid', async () => {
    const now = new Date('2026-08-28T18:00:00.000Z'); // market date 2026-08-28
    const fixturesRoot = await writeMarketFixture(
      'success',
      historicalBody('AAPL', [
        { date: '2027-04-01', open: 500, high: 505, low: 495, close: 502, volume: 1000 }, // discarded: future date
        { date: '2026-08-27', open: 228.0, high: 231.0, low: 227.5, close: 0, volume: 40000000 }, // invalid close
      ]),
    );
    const security = await insertSecurity('AAPL');

    const outcome = await collectMarketSnapshots({ providerMode: 'fixture', fixturesRoot, now });

    expect(outcome.results).toEqual([]);
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures).toMatchObject([{ symbol: 'AAPL', reason: 'malformed_bar' }]);

    const history = await marketSnapshotHistory({
      securityId: security,
      asOfInstant: new Date('2099-01-01T00:00:00Z'),
    });
    expect(history).toHaveLength(0);
  });

  /**
   * Round-2 lane-review finding 3: no existing test distinguished `marketDateString` (an
   * `America/New_York`-local date) from a plain `now.toISOString().slice(0, 10)` UTC date — every
   * prior test used a `now` where the two calendars agree. `2026-08-29T02:00:00Z` is 22:00 ET on
   * the 28th: under the ET rule this is still market-date `2026-08-28`, so a bar also dated
   * `2026-08-28` must be rejected as not yet final. Under a plain UTC slice, `now`'s date would be
   * `2026-08-29`, and the same bar would incorrectly be accepted as already closed. This is the
   * one case in the suite that would fail if `MARKET_TIMEZONE` were silently dropped.
   */
  it('treats a bar dated the same day as an evening-UTC `now` as not-final under the market (ET) calendar, not the UTC one', async () => {
    const now = new Date('2026-08-29T02:00:00.000Z'); // 22:00 ET on 2026-08-28 — still "today" in ET
    const fixturesRoot = await writeMarketFixture(
      'success',
      historicalBody('AAPL', [{ date: '2026-08-28', open: 230.12, high: 233.4, low: 229.8, close: 231.5, volume: 12345 }]),
    );
    const security = await insertSecurity('AAPL');

    const outcome = await collectMarketSnapshots({ providerMode: 'fixture', fixturesRoot, now });

    expect(outcome.results).toEqual([]);
    expect(outcome.failures).toMatchObject([{ symbol: 'AAPL', reason: 'bar_not_final' }]);

    const history = await marketSnapshotHistory({
      securityId: security,
      asOfInstant: new Date('2099-01-01T00:00:00Z'),
    });
    expect(history).toHaveLength(0);
  });

  /**
   * The same ET-vs-UTC distinction, exercised across a DST fall-back transition (2026-11-01 is
   * EST, UTC−5, by then). `2026-11-02T04:30:00Z` is 23:30 ET on 2026-11-01 — still that trading
   * day in ET, so a bar dated `2026-11-01` must still be rejected as not final. A plain UTC slice
   * would read `now` as `2026-11-02` and wrongly accept the bar as already closed.
   */
  it('holds the ET boundary correctly across a DST fall-back transition', async () => {
    const now = new Date('2026-11-02T04:30:00.000Z');
    const fixturesRoot = await writeMarketFixture(
      'success',
      historicalBody('AAPL', [{ date: '2026-11-01', open: 230.12, high: 233.4, low: 229.8, close: 231.5, volume: 12345 }]),
    );
    await insertSecurity('AAPL');

    const outcome = await collectMarketSnapshots({ providerMode: 'fixture', fixturesRoot, now });

    expect(outcome.results).toEqual([]);
    expect(outcome.failures).toMatchObject([{ symbol: 'AAPL', reason: 'bar_not_final' }]);
  });

  it('persists a bar dated a prior trading day normally', async () => {
    const now = new Date('2026-08-29T18:00:00.000Z');
    const fixturesRoot = await writeMarketFixture(
      'success',
      historicalBody('AAPL', [
        { date: '2026-08-28', open: 230.12, high: 233.4, low: 229.8, close: 232.1, volume: 54321000 },
      ]),
    );
    const security = await insertSecurity('AAPL');

    const outcome = await collectMarketSnapshots({ providerMode: 'fixture', fixturesRoot, now });

    expect(outcome.results).toMatchObject([{ symbol: 'AAPL', inserted: true }]);
    expect(outcome.failures).toEqual([]);

    const history = await marketSnapshotHistory({
      securityId: security,
      asOfInstant: new Date('2099-01-01T00:00:00Z'),
    });
    expect(history).toHaveLength(1);
  });

  // Post-review finding 4: `provider-deps.ts` builds one circuit breaker per run, shared across
  // every security — so once enough transient failures open it, every security processed
  // afterward fails without ever being called, which is not the isolated single-security failure
  // the generic message claims.
  it('gives an honest, distinct message when the shared circuit breaker opens mid-run, not the per-security isolation claim', async () => {
    const securities: string[] = [];
    // FAILURE_THRESHOLD is 5, and each call gets up to 3 attempts (MAX_RETRIES=2) before the
    // breaker sees it as one more consecutive failure — two securities hitting a transient 503
    // (server_error, already a committed adapter fixture) drive it well past threshold.
    for (const symbol of ['AAA_FAIL', 'BBB_FAIL']) {
      securities.push(await insertSecurity(symbol));
    }
    const afterBreakerOpens = await insertSecurity('ZZZ_OK');

    const outcome = await collectMarketSnapshots({
      providerMode: 'fixture',
      headersBySymbol: {
        AAA_FAIL: withCase('server_error'),
        BBB_FAIL: withCase('server_error'),
      },
      deps: { ...marketCollectorWrapperDeps({ db: pool }), clock: fastClock },
    });

    const lastFailure = outcome.failures.find((f) => f.symbol === 'ZZZ_OK');
    expect(lastFailure).toBeDefined();
    expect(lastFailure?.error?.kind).toBe('circuit_open');
    // Must not claim isolation for the one failure mode where it is false.
    expect(lastFailure?.message).not.toContain('every other security in this run is unaffected');
    expect(lastFailure?.message).toContain('circuit breaker is open');

    const history = await marketSnapshotHistory({
      securityId: afterBreakerOpens,
      asOfInstant: new Date('2099-01-01T00:00:00Z'),
    });
    expect(history).toHaveLength(0);
  });

  /**
   * Round-2 lane-review finding 4: the per-security `try`/`catch` added for the earlier
   * unparseable-date bug had no test that actually throws from inside the loop body — every
   * existing failure path returns an honest `ok: false`/empty result rather than throwing, so
   * deleting the `try`/`catch` left the suite green. A transient DB error on `insertMarketSnapshot`
   * (the realistic remaining trigger the module's own doc names) pins the structural guarantee.
   */
  it("a transient database error inserting one security's snapshot is caught and reported, never stopping the run", async () => {
    const good = await insertSecurity('AAPL');
    const poisoned = await insertSecurity('POISONED');

    const poisonedDb: Queryable = {
      query: async (text, values) => {
        if (text.includes('insert into market_snapshot') && values?.[0] === poisoned) {
          throw new Error('simulated transient database error');
        }
        return pool.query(text, values as unknown[]);
      },
    };

    const outcome = await collectMarketSnapshots({
      providerMode: 'fixture',
      db: poisonedDb,
      deps: marketCollectorWrapperDeps({ db: pool }),
    });

    expect(outcome.results.map((r) => r.symbol)).toEqual(['AAPL']);
    expect(outcome.failures).toMatchObject([
      { symbol: 'POISONED', reason: 'unexpected_error', message: expect.stringContaining('simulated transient database error') },
    ]);

    const goodHistory = await marketSnapshotHistory({
      securityId: good,
      asOfInstant: new Date('2099-01-01T00:00:00Z'),
    });
    expect(goodHistory).toHaveLength(1);
  });
});
