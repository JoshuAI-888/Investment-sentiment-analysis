import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import { closePool, getPool } from '../../src/repositories/client';
import { activateConfigVersion, findActiveConfigVersion, insertConfigVersion } from '../../src/repositories/versions';
import { attentionSnapshotHistory, countComparableAttentionSnapshots } from '../../src/repositories/attention';
import { harness } from '../unit/adapters/fakes';
import { inMemoryRedisClient, KEYS } from '../../src/services/attention/redis';
import { collectAttentionSnapshots } from '../../src/services/attention/collector';
import { computeAttentionMetrics } from '../../src/services/attention/compute';
import {
  ATTENTION_CONFIG_ENVIRONMENT,
  materializeAttentionMetricsForSecurity,
  runAttentionCollection,
} from '../../src/services/attention/pipeline';
import { assembleAttentionLeaderboard } from '../../src/services/attention/leaderboard';
import { seedAttentionStale, seedAttentionUnavailable } from '../../src/services/attention/testing';

const url = databaseUrl();

const AUDIT = { actorId: 'test', actorRole: 'system', reason: 'test', requestId: 'req-1', correlationId: 'corr-1' };

/**
 * Round-49 lane-review finding 1. `all_malformed.json`, `partial_malformed.json` and
 * `all_unmatched.json` used to be committed under `fixtures/apewisdom/filter/` — a path
 * `docs/progress/collect.md` lists under COLLECT's ownership, not this lane's. F02 already
 * established the fix for the identical shape of violation (commit `7b3634e`: "move Resend
 * contract fixtures out of the COLLECT-owned fixtures/ directory"), and this file already uses
 * the alternative for three other scenarios: a scratch `fixturesRoot` built with `mkdtemp`,
 * written only for the duration of the test it belongs to. This helper does the same for a case
 * selected by `x-fixture-case`, so these three test-only board shapes no longer live in a
 * directory a COLLECT change to the adapter's own contract could silently break.
 */
async function writeApewisdomFilterFixture(tmpPrefix: string, caseName: string, body: unknown): Promise<string> {
  const fixturesRoot = await mkdtemp(join(tmpdir(), tmpPrefix));
  await mkdir(join(fixturesRoot, 'apewisdom', 'filter'), { recursive: true });
  await writeFile(
    join(fixturesRoot, 'apewisdom', 'filter', `${caseName}.json`),
    JSON.stringify({ status: 200, headers: { 'content-type': 'application/json' }, body }),
  );
  return fixturesRoot;
}

/**
 * F08 §5 integration cases: collector idempotency on a repeated `observed_at`; depth counter
 * increments; a methodology-version change suppresses cross-boundary deltas. Against a real
 * Postgres — the properties under test (`calculation_snapshot_identity_unique`, the append-only
 * triggers) exist only there.
 */
describe.skipIf(url === undefined)('F08 — the attention collector and compute pipeline, end to end', () => {
  let pool: pg.Pool;
  let configVersion: string;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
    getPool(url);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
    await pool.query(
      `insert into security (symbol, name, exchange, asset_type, currency) values
       ('GME', 'GameStop Corp.', 'NYSE', 'equity', 'USD'),
       ('AAPL', 'Apple Inc.', 'NASDAQ', 'equity', 'USD')`,
    );
    const draft = await insertConfigVersion({
      environment: ATTENTION_CONFIG_ENVIRONMENT,
      createdBy: 'test',
      changeReason: 'test',
      checksum: 'test',
    });
    const activated = await activateConfigVersion(ATTENTION_CONFIG_ENVIRONMENT, draft.id, AUDIT);
    configVersion = activated.id;
  });

  afterAll(async () => {
    await closePool();
    await pool?.end();
  });

  async function securityId(symbol: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>('select id from security where symbol = $1', [symbol]);
    return rows[0]?.id as string;
  }

  describe('collectAttentionSnapshots', () => {
    it('matches GME and AAPL from the success fixture and drops nothing tracked', async () => {
      const result = await collectAttentionSnapshots({ providerMode: 'fixture', deps: harness().deps });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.results.map((r) => r.symbol).sort()).toEqual(['AAPL', 'GME']);
      expect(result.unmatchedTickers).toEqual([]);
    });

    // Round-24 lane-review finding 2: round 23's fix (matchBoardEntriesToSecurities de-duplicates
    // a ticker matched by more than one board entry) is unit-tested against the pure function
    // only — nothing at this level proves `collectAttentionSnapshots` actually reports the drop
    // and writes exactly one row. A scratch fixture (`fixturesRoot`, the same mechanism
    // `tests/unit/adapters/scorer.test.ts` uses for a case that doesn't belong in the
    // COLLECT-owned `fixtures/` tree) avoids adding a third file there for one integration case.
    it('a ticker appearing twice on one board response is written once, and the drop is reported (lane-review round 23 finding 1 / round 24 finding 2)', async () => {
      const fixturesRoot = await mkdtemp(join(tmpdir(), 'apewisdom-duplicate-'));
      await mkdir(join(fixturesRoot, 'apewisdom', 'filter'), { recursive: true });
      await writeFile(
        join(fixturesRoot, 'apewisdom', 'filter', 'success.json'),
        JSON.stringify({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: {
            count: 3,
            pages: 1,
            current_page: 1,
            results: [
              { rank: 1, ticker: 'GME', name: 'GameStop Corp.', mentions: '1204', upvotes: '8213', rank_24h_ago: '1', mentions_24h_ago: '1350' },
              { rank: 2, ticker: 'AAPL', name: 'Apple Inc.', mentions: '980', upvotes: '4021', rank_24h_ago: '3', mentions_24h_ago: '870' },
              { rank: 42, ticker: 'GME', name: 'GameStop Corp.', mentions: '9', upvotes: '2', rank_24h_ago: '40', mentions_24h_ago: '8' },
            ],
          },
        }),
      );

      const result = await collectAttentionSnapshots({ providerMode: 'fixture', deps: harness().deps, fixturesRoot });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const gmeResults = result.results.filter((r) => r.symbol === 'GME');
      expect(gmeResults).toHaveLength(1);
      // The best-ranked (first-listed) entry is the one kept, not whichever happened to be last.
      expect(gmeResults[0]?.snapshot.rank).toBe(1);
      expect(
        result.malformedEntries.some(
          (m) => m.ticker === 'GME' && m.reason.includes('matched more than one entry'),
        ),
      ).toBe(true);

      const gme = await securityId('GME');
      const { rows } = await pool.query<{ count: string }>(
        'select count(*)::text as count from attention_snapshot where security_id = $1',
        [gme],
      );
      expect(rows[0]?.count).toBe('1');
    });
  });

  describe('runAttentionCollection — F08 §7 review step 3', () => {
    it('is idempotent: running the collector twice on the same fixture reading writes one attention_snapshot row per security', async () => {
      const redis = inMemoryRedisClient();
      const first = await runAttentionCollection({ providerMode: 'fixture', deps: harness().deps, redis });
      const second = await runAttentionCollection({ providerMode: 'fixture', deps: harness().deps, redis });

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok || !second.ok) return;

      // Both runs recompute both securities (lane-review finding 3: recomputing on unchanged
      // data is no longer skipped, because `compute.ts`'s deterministic `calculationId` makes a
      // repeat computation a safe no-op rather than a constraint violation) — the idempotency
      // this DoD item actually asks about is at the raw-observation level, asserted below.
      expect(first.computed).toBe(2);
      expect(second.computed).toBe(2);

      const { rows } = await pool.query('select count(*)::text as count from attention_snapshot');
      expect(rows[0]?.count).toBe('2');
      // The second run's recompute did not create a second calculation_snapshot per security —
      // exactly the collision `calculation_snapshot_identity_unique` would otherwise raise.
      const { rows: snapshotCounts } = await pool.query(
        "select count(*)::text as count from calculation_snapshot where method_key = 'attention.rank_change'",
      );
      expect(snapshotCounts[0]?.count).toBe('2');
    });

    it('renders in the leaderboard read path after one collection run', async () => {
      const redis = inMemoryRedisClient();
      // `now` pinned explicitly, with a one-minute forward buffer: `collectAttentionSnapshots`
      // otherwise falls back to the fixture harness's own fake `deps.clock` (fixed at
      // 2026-08-30T12:00Z) for `observed_at`, while `insertAttentionSnapshot` defaults
      // `ingested_at` to the real wall clock — a gap of days against `assembleAttentionLeaderboard`'s
      // own default real `now`, which lane-review finding 5's read-time staleness check
      // (correctly) would flag. The buffer matters too: without it, `ingested_at` (stamped at the
      // real instant the insert actually executes, a few milliseconds after this line) can land
      // *after* an unpadded `now` captured here, making the row F22's as-of guard cannot yet see
      // — the exact race `repositories/attention.ts`'s own tests warn a hardcoded instant invites.
      const now = new Date(Date.now() + 60_000);
      const outcome = await runAttentionCollection({ providerMode: 'fixture', deps: harness().deps, redis, now });
      expect(outcome.ok).toBe(true);

      const leaderboard = await assembleAttentionLeaderboard({ redis, now });
      expect(leaderboard.state).toBe('ok');
      expect(leaderboard.rows.map((r) => r.symbol).sort()).toEqual(['AAPL', 'GME']);
      expect(leaderboard.providerMethodologyVersion).not.toBeNull();

      const gmeRow = leaderboard.rows.find((r) => r.symbol === 'GME');
      expect(gmeRow?.mentions.display).toBe('1204');
      expect(gmeRow?.rank.display).toBe('1');
      // The very first observation for this security — no local predecessor exists yet, so the
      // comparison falls back to ApeWisdom's own bundled prior fields (F08 §4.1's bootstrap case).
      expect(gmeRow?.rankChangeSource).toBe('provider_reported');
    });

    // Lane-review round 6 finding 3: `metric-manifest.ts` names `attention.engagement_per_mention`
    // as `attention.engagement_now`'s producing method in the normal case — this proves that
    // claim against the real pipeline rather than only re-asserting the manifest's own string,
    // which is what a prior version of this coverage did (and which stayed green through the
    // round-5 mistake it was meant to catch).
    it("the Upvotes cell carries attention.engagement_per_mention's calculationId, not attention.rank_change's (lane-review round 6 finding 3)", async () => {
      const redis = inMemoryRedisClient();
      const now = new Date(Date.now() + 60_000);
      const outcome = await runAttentionCollection({ providerMode: 'fixture', deps: harness().deps, redis, now });
      expect(outcome.ok).toBe(true);

      const leaderboard = await assembleAttentionLeaderboard({ redis, now });
      const gmeRow = leaderboard.rows.find((r) => r.symbol === 'GME');
      expect(gmeRow?.upvotes.calculationId).toBeTruthy();
      expect(gmeRow?.upvotes.calculationId).not.toBe(gmeRow?.rankChange.calculationId);

      const engagementPointer = await redis.get(
        `attention:pointer:${gmeRow?.securityId}:attention.engagement_per_mention`,
      );
      expect(gmeRow?.upvotes.calculationId).toBe(engagementPointer);
    });

    // Lane-review finding 3's own reproduction: a fresh server process (a new, empty in-memory
    // Redis client) with Postgres rows already persisted from an earlier run. Before the
    // round-1 fix, `pipeline.ts` skipped recomputing (and therefore re-pointing) any security
    // whose reading was unchanged, so a lost pointer store was never restored by a later,
    // otherwise-successful *collector* run.
    it('recovers a fully lost Redis pointer store on the very next collector run, without new data arriving', async () => {
      // No explicit `now` here, deliberately: `insertAttentionSnapshot`'s own idempotent-duplicate
      // path (`repositories/attention.ts#readBackExisting`) reads back with the *real*, unpadded
      // `new Date()` internally, uncontrollable from this test — pinning `observed_at` into the
      // future (to dodge the fixture harness's fixed past clock) makes that internal read-back
      // correctly refuse to find a not-yet-knowable, future-dated row. This test is about pointer
      // recovery, not freshness, so it does not need a "prompt" read at all — only that the row
      // becomes visible again, however its own freshness happens to read.
      const firstProcessRedis = inMemoryRedisClient();
      const first = await runAttentionCollection({ providerMode: 'fixture', deps: harness().deps, redis: firstProcessRedis });
      expect(first.ok).toBe(true);

      // Simulate a fresh process / an Upstash flush: a brand-new, empty Redis client. Postgres —
      // the `attention_snapshot` and `calculation_snapshot` rows the first run wrote — persists.
      const secondProcessRedis = inMemoryRedisClient();

      // The provider's own data has not changed at all — every `attention_snapshot` write this
      // run attempts will report `inserted: false`. Recovery must not depend on new data arriving.
      const second = await runAttentionCollection({
        providerMode: 'fixture',
        deps: harness().deps,
        redis: secondProcessRedis,
      });
      expect(second.ok).toBe(true);
      if (second.ok) expect(second.computed).toBe(2);

      const afterRecovery = await assembleAttentionLeaderboard({ redis: secondProcessRedis });
      // Never `unavailable` — that is the one state this test exists to rule out. Whether it
      // reads `ok` or `stale` depends only on how old the fixture harness's own fake clock is
      // relative to the real day this suite happens to run, which is not what this test is about.
      expect(afterRecovery.state).not.toBe('unavailable');
      expect(afterRecovery.rows.map((r) => r.symbol).sort()).toEqual(['AAPL', 'GME']);
      const restoredGme = afterRecovery.rows.find((r) => r.symbol === 'GME');
      expect(restoredGme?.rankChange.calculationId).toBeTruthy();
      expect(restoredGme?.mentions.display).toBe('1204');
    });

    // Lane-review round 2 finding 1: the *read* path itself must not trust Redis's own
    // bookkeeping key as the sole source of truth for whether any data exists — a cold Redis
    // (a fresh serverless invocation under the in-memory fallback, an Upstash flush) is the
    // common case in production today (MT-03/Upstash still not provisioned per `DEPLOY.md`), not
    // a corner case. This must recover on the *very first* read against a cold cache, with no
    // second collector run of any kind — unlike the test above, which exercises collector-driven
    // recovery.
    it('the read path recovers from a cold Redis on its own — Postgres, not Redis, is the source of truth for whether data exists (lane-review round 2 finding 1)', async () => {
      const firstProcessRedis = inMemoryRedisClient();
      const first = await runAttentionCollection({ providerMode: 'fixture', deps: harness().deps, redis: firstProcessRedis });
      expect(first.ok).toBe(true);

      // A brand-new, empty Redis client — no collector run against it at all. Only Postgres
      // (`attention_snapshot`, `calculation_snapshot`, the active `config_version`) has anything.
      const coldRedis = inMemoryRedisClient();

      const read = await assembleAttentionLeaderboard({ redis: coldRedis });
      expect(read.state).not.toBe('unavailable');
      expect(read.rows.map((r) => r.symbol).sort()).toEqual(['AAPL', 'GME']);
      const gmeRow = read.rows.find((r) => r.symbol === 'GME');
      expect(gmeRow?.mentions.display).toBe('1204');
      expect(gmeRow?.rankChange.calculationId).toBeTruthy();

      // Recovery repoints the cold Redis as a side effect, so a second read against the *same*
      // client no longer needs to recompute anything.
      const pointerAfterRecovery = await coldRedis.get(
        `attention:pointer:${gmeRow?.securityId}:attention.rank_change`,
      );
      expect(pointerAfterRecovery).toBe(gmeRow?.rankChange.calculationId);
    });

    // Round-8 lane-review finding 2: before this fix, a run in which every matched entry failed
    // `parseProviderCount`'s domain check (a scratch `all_malformed` fixture — round-49 moved this
    // out of the COLLECT-owned `fixtures/apewisdom/filter/` directory — a thousands-separated
    // `mentions` and a negative `upvotes`, both valid strings at the adapter
    // boundary) still set `degraded: false` (the *fetch* succeeded) and unconditionally advanced
    // `lastCollectedAt` to the new instant — the page then read `state: 'ok'` with a fresh
    // timestamp over a corpus that had not actually moved, which is exactly the "unnoticed
    // collection stoppage" D-16 calls permanent data loss.
    it('a run in which every matched entry is malformed reports degraded and leaves lastCollectedAt at the last real collection, not a false-fresh success (round-8 lane-review finding 2)', async () => {
      const redis = inMemoryRedisClient();
      const firstRunAt = new Date(Date.now() + 60_000);
      const good = await runAttentionCollection({ providerMode: 'fixture', deps: harness().deps, redis, now: firstRunAt });
      expect(good.ok).toBe(true);
      if (!good.ok) return;
      expect(good.computed).toBe(2);

      const secondRunAt = new Date(Date.now() + 120_000);
      const fixturesRoot = await writeApewisdomFilterFixture('apewisdom-all-malformed-', 'all_malformed', {
        count: 2,
        pages: 1,
        current_page: 1,
        results: [
          { rank: 1, ticker: 'GME', name: 'GameStop Corp.', mentions: '1,204', upvotes: '8213', rank_24h_ago: '1', mentions_24h_ago: '1350' },
          { rank: 2, ticker: 'AAPL', name: 'Apple Inc.', mentions: '980', upvotes: '-50', rank_24h_ago: '3', mentions_24h_ago: '900' },
        ],
      });
      const bad = await runAttentionCollection({
        providerMode: 'fixture',
        deps: harness().deps,
        fixturesRoot,
        headers: { 'x-fixture-case': 'all_malformed' },
        redis,
        now: secondRunAt,
      });
      expect(bad.ok).toBe(true);
      if (!bad.ok) return;
      expect(bad.computed).toBe(0);
      expect(bad.malformedEntries.map((entry) => entry.ticker).sort()).toEqual(['AAPL', 'GME']);

      // The failed run must not overwrite the last genuine collection instant.
      expect(await redis.get(KEYS.lastCollectedAt())).toBe(good.observedAt);
      expect(await redis.get(KEYS.degraded())).toBe(JSON.stringify(true));

      const leaderboard = await assembleAttentionLeaderboard({ redis, now: secondRunAt });
      expect(leaderboard.state).toBe('degraded');
      expect(leaderboard.degraded).toBe(true);
      expect(leaderboard.degradedMessage).not.toBeNull();
      // Round-11 lane-review finding 2: ApeWisdom answered 200 here — the board just contained
      // only malformed entries — so the message must never claim it "could not be reached".
      expect(leaderboard.degradedMessage).not.toContain('could not be reached');
      expect(leaderboard.degradedMessage).toContain('was reached');
      // The rows still render the last real observation — a failed run degrades the page state,
      // it does not erase what was already collected.
      expect(leaderboard.rows.map((r) => r.symbol).sort()).toEqual(['AAPL', 'GME']);
      const gmeRow = leaderboard.rows.find((r) => r.symbol === 'GME');
      expect(gmeRow?.mentions.display).toBe('1204');
    });

    // Round-33 lane-review finding 3: a *partial* malformed board (some entries parse, some don't)
    // is a different case from round 8's all-malformed one above — `collected.results.length` is
    // still nonzero, so `degraded` correctly stays `false` and `lastCollectedAt` correctly
    // advances (the corpus genuinely moved), but before this fix the dropped security's own
    // `malformedEntries` reason went nowhere durable: `KEYS.malformedTickers()` did not exist, and
    // the read path told a reader the security "may simply no longer be on ApeWisdom's tracked
    // board" — false; it is still on the board, sending data this run could not parse.
    it('a partially malformed board flags only the dropped security as malformed-last-run, and the flag clears the moment it parses cleanly again', async () => {
      const redis = inMemoryRedisClient();
      const firstRunAt = new Date(Date.now() + 60_000);
      const good = await runAttentionCollection({ providerMode: 'fixture', deps: harness().deps, redis, now: firstRunAt });
      expect(good.ok).toBe(true);
      if (!good.ok) return;
      expect(good.computed).toBe(2);

      const secondRunAt = new Date(Date.now() + 120_000);
      const fixturesRoot = await writeApewisdomFilterFixture('apewisdom-partial-malformed-', 'partial_malformed', {
        count: 2,
        pages: 1,
        current_page: 1,
        results: [
          { rank: 1, ticker: 'GME', name: 'GameStop Corp.', mentions: '1,204', upvotes: '8213', rank_24h_ago: '1', mentions_24h_ago: '1350' },
          { rank: 2, ticker: 'AAPL', name: 'Apple Inc.', mentions: '980', upvotes: '4021', rank_24h_ago: '3', mentions_24h_ago: '870' },
        ],
      });
      const partial = await runAttentionCollection({
        providerMode: 'fixture',
        deps: harness().deps,
        fixturesRoot,
        headers: { 'x-fixture-case': 'partial_malformed' },
        redis,
        now: secondRunAt,
      });
      expect(partial.ok).toBe(true);
      if (!partial.ok) return;
      // Only AAPL parsed; GME's comma-formatted mentions failed `parseProviderCount`'s domain check.
      expect(partial.computed).toBe(1);
      expect(partial.malformedEntries.map((entry) => entry.ticker)).toEqual(['GME']);

      // A partial run is real progress, not a stoppage: neither guard from round 8/9 fires.
      expect(await redis.get(KEYS.degraded())).toBe(JSON.stringify(false));
      expect(await redis.get(KEYS.lastCollectedAt())).toBe(partial.observedAt);
      expect(await redis.get(KEYS.malformedTickers())).toBe(JSON.stringify(['GME']));

      const leaderboard = await assembleAttentionLeaderboard({ redis, now: secondRunAt });
      const gmeRow = leaderboard.rows.find((r) => r.symbol === 'GME');
      const aaplRow = leaderboard.rows.find((r) => r.symbol === 'AAPL');
      expect(gmeRow?.wasMalformedLastRun).toBe(true);
      expect(aaplRow?.wasMalformedLastRun).toBe(false);

      // The flag is never sticky: the very next run that parses GME cleanly clears it.
      const thirdRunAt = new Date(Date.now() + 180_000);
      const clean = await runAttentionCollection({ providerMode: 'fixture', deps: harness().deps, redis, now: thirdRunAt });
      expect(clean.ok).toBe(true);
      if (!clean.ok) return;
      expect(clean.malformedEntries).toEqual([]);
      expect(await redis.get(KEYS.malformedTickers())).toBe(JSON.stringify([]));

      const recovered = await assembleAttentionLeaderboard({ redis, now: thirdRunAt });
      expect(recovered.rows.find((r) => r.symbol === 'GME')?.wasMalformedLastRun).toBe(false);
    });

    // Round-35 lane-review finding 1: a duplicate ticker on one board response
    // (`collector.ts`'s `duplicateTickers` handling) lands in `malformedEntries` for the drop
    // note *and* has its best-ranked entry genuinely written to `results` — round 33's
    // `KEYS.malformedTickers()` recorded it anyway, which was harmless only because such a row is
    // never simultaneously stale in the same run it was written. Once the row later goes stale
    // with no newer run to correct it, that stale flag would have falsely claimed "no new
    // observation was recorded" about the exact row this run *did* write.
    it('a duplicate ticker whose best-ranked entry is written this run is never flagged malformed-last-run', async () => {
      const fixturesRoot = await mkdtemp(join(tmpdir(), 'apewisdom-duplicate-pipeline-'));
      await mkdir(join(fixturesRoot, 'apewisdom', 'filter'), { recursive: true });
      await writeFile(
        join(fixturesRoot, 'apewisdom', 'filter', 'success.json'),
        JSON.stringify({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: {
            count: 3,
            pages: 1,
            current_page: 1,
            results: [
              { rank: 1, ticker: 'GME', name: 'GameStop Corp.', mentions: '1204', upvotes: '8213', rank_24h_ago: '1', mentions_24h_ago: '1350' },
              { rank: 2, ticker: 'AAPL', name: 'Apple Inc.', mentions: '980', upvotes: '4021', rank_24h_ago: '3', mentions_24h_ago: '870' },
              { rank: 42, ticker: 'GME', name: 'GameStop Corp.', mentions: '9', upvotes: '2', rank_24h_ago: '40', mentions_24h_ago: '8' },
            ],
          },
        }),
      );

      const redis = inMemoryRedisClient();
      const runAt = new Date(Date.now() + 60_000);
      const outcome = await runAttentionCollection({ providerMode: 'fixture', deps: harness().deps, fixturesRoot, redis, now: runAt });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.malformedEntries.some((entry) => entry.ticker === 'GME')).toBe(true);

      // The duplicate note was recorded, but GME's best-ranked entry was genuinely written this
      // run — the malformed-tickers record must not include it.
      const malformedTickers = JSON.parse((await redis.get(KEYS.malformedTickers())) ?? '[]') as string[];
      expect(malformedTickers).not.toContain('GME');

      const leaderboard = await assembleAttentionLeaderboard({ redis, now: runAt });
      expect(leaderboard.rows.find((r) => r.symbol === 'GME')?.wasMalformedLastRun).toBe(false);
    });

    // Round-36 lane-review finding 1: `wasMalformedLastRun` lives on a row, but a security whose
    // board entries have never once parsed has no `attention_snapshot` row at all — `buildRow` is
    // never reached for it — so it simply vanishes from the (up to) 100-row board with nothing
    // anywhere explaining the gap, unless the page-level `neverCollectedMalformedSymbols` field
    // catches it. GME and AAPL parse normally (real progress, `state: 'ok'`); a third active
    // security, NVDA, has never had a usable observation and this run's own entry for it is
    // comma-formatted, so it never gets one this run either.
    it('a security whose very first collection attempt is malformed appears in neverCollectedMalformedSymbols, never silently absent with no explanation', async () => {
      await pool.query(
        `insert into security (symbol, name, exchange, asset_type, currency) values
         ('NVDA', 'NVIDIA Corp.', 'NASDAQ', 'equity', 'USD')`,
      );

      const fixturesRoot = await mkdtemp(join(tmpdir(), 'apewisdom-never-collected-malformed-'));
      await mkdir(join(fixturesRoot, 'apewisdom', 'filter'), { recursive: true });
      await writeFile(
        join(fixturesRoot, 'apewisdom', 'filter', 'success.json'),
        JSON.stringify({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: {
            count: 3,
            pages: 1,
            current_page: 1,
            results: [
              { rank: 1, ticker: 'GME', name: 'GameStop Corp.', mentions: '1204', upvotes: '8213', rank_24h_ago: '1', mentions_24h_ago: '1350' },
              { rank: 2, ticker: 'AAPL', name: 'Apple Inc.', mentions: '980', upvotes: '4021', rank_24h_ago: '3', mentions_24h_ago: '870' },
              { rank: 3, ticker: 'NVDA', name: 'NVIDIA Corp.', mentions: '1,500', upvotes: '900', rank_24h_ago: '5', mentions_24h_ago: '1400' },
            ],
          },
        }),
      );

      const redis = inMemoryRedisClient();
      const runAt = new Date(Date.now() + 60_000);
      const outcome = await runAttentionCollection({ providerMode: 'fixture', deps: harness().deps, fixturesRoot, redis, now: runAt });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.malformedEntries.map((entry) => entry.ticker)).toEqual(['NVDA']);

      const leaderboard = await assembleAttentionLeaderboard({ redis, now: runAt });
      // GME and AAPL parsed fine — this run is real progress, never degraded.
      expect(leaderboard.state).toBe('ok');
      expect(leaderboard.rows.map((r) => r.symbol).sort()).toEqual(['AAPL', 'GME']);
      expect(leaderboard.rows.find((r) => r.symbol === 'NVDA')).toBeUndefined();
      // NVDA has no row to carry the flag on, but must not simply disappear.
      expect(leaderboard.neverCollectedMalformedSymbols).toEqual(['NVDA']);
    });

    // Round-9 lane-review finding 1: round 8's guard keyed only on `malformedEntries.length > 0`,
    // which covers the all-malformed case but not this one — ApeWisdom returning a genuinely
    // empty board (`results: []`, a real recorded shape) reaches `computed === 0` with
    // `malformedEntries` empty too, so the round-8 guard did not fire.
    it('a run that collects an empty board (zero results, zero malformed) also reports degraded rather than a false-fresh success (round-9 lane-review finding 1)', async () => {
      const redis = inMemoryRedisClient();
      const firstRunAt = new Date(Date.now() + 60_000);
      const good = await runAttentionCollection({ providerMode: 'fixture', deps: harness().deps, redis, now: firstRunAt });
      expect(good.ok).toBe(true);
      if (!good.ok) return;

      const secondRunAt = new Date(Date.now() + 120_000);
      const empty = await runAttentionCollection({
        providerMode: 'fixture',
        deps: harness().deps,
        headers: { 'x-fixture-case': 'empty' },
        redis,
        now: secondRunAt,
      });
      expect(empty.ok).toBe(true);
      if (!empty.ok) return;
      expect(empty.computed).toBe(0);
      expect(empty.malformedEntries).toEqual([]);
      expect(empty.unmatchedTickers).toEqual([]);

      expect(await redis.get(KEYS.lastCollectedAt())).toBe(good.observedAt);
      expect(await redis.get(KEYS.degraded())).toBe(JSON.stringify(true));

      const leaderboard = await assembleAttentionLeaderboard({ redis, now: secondRunAt });
      expect(leaderboard.state).toBe('degraded');
      expect(leaderboard.degraded).toBe(true);
      // Round-11 lane-review finding 2: an empty board is still a reached provider.
      expect(leaderboard.degradedMessage).not.toContain('could not be reached');
      // Round-32 lane-review finding 1: the board itself was empty (zero entries, not merely
      // zero *matched* entries) — asserting "every entry ... was malformed or matched no tracked
      // security" here would be a vacuous truth over an empty set, wrongly pinning the fault on
      // local matching when the provider sent nothing at all.
      expect(leaderboard.degradedMessage).toContain('the board was empty');
    });

    // Round-9 lane-review finding 1, second sibling: every board ticker fails to match any
    // tracked security (a provider ticker-format change; D-30 seeds the universe *from* this
    // board, so zero matches out of the whole tracked universe is a shape change, not routine
    // churn). `matched.length === 0` here too, and no entry is ever malformed since none is even
    // attempted — the same gap as the empty-board case, through a different door.
    it('a run in which every board ticker is unmatched also reports degraded, not a false-fresh success (round-9 lane-review finding 1)', async () => {
      const redis = inMemoryRedisClient();
      const firstRunAt = new Date(Date.now() + 60_000);
      const good = await runAttentionCollection({ providerMode: 'fixture', deps: harness().deps, redis, now: firstRunAt });
      expect(good.ok).toBe(true);
      if (!good.ok) return;

      const secondRunAt = new Date(Date.now() + 120_000);
      const fixturesRoot = await writeApewisdomFilterFixture('apewisdom-all-unmatched-', 'all_unmatched', {
        count: 2,
        pages: 1,
        current_page: 1,
        results: [
          { rank: 1, ticker: 'ZZZZ', name: 'Not A Tracked Security', mentions: '500', upvotes: '1000', rank_24h_ago: '1', mentions_24h_ago: '480' },
          { rank: 2, ticker: 'YYYY', name: 'Also Not Tracked', mentions: '300', upvotes: '600', rank_24h_ago: '3', mentions_24h_ago: '310' },
        ],
      });
      const unmatched = await runAttentionCollection({
        providerMode: 'fixture',
        deps: harness().deps,
        fixturesRoot,
        headers: { 'x-fixture-case': 'all_unmatched' },
        redis,
        now: secondRunAt,
      });
      expect(unmatched.ok).toBe(true);
      if (!unmatched.ok) return;
      expect(unmatched.computed).toBe(0);
      expect(unmatched.malformedEntries).toEqual([]);
      expect([...unmatched.unmatchedTickers].sort()).toEqual(['YYYY', 'ZZZZ']);

      expect(await redis.get(KEYS.lastCollectedAt())).toBe(good.observedAt);
      expect(await redis.get(KEYS.degraded())).toBe(JSON.stringify(true));

      const leaderboard = await assembleAttentionLeaderboard({ redis, now: secondRunAt });
      expect(leaderboard.state).toBe('degraded');
      expect(leaderboard.degraded).toBe(true);
      // Round-11 lane-review finding 2: every ticker went unmatched — still a reached provider.
      expect(leaderboard.degradedMessage).not.toContain('could not be reached');
      // Round-32 lane-review finding 1: here the board was genuinely non-empty (real entries
      // existed, all unmatched) — the "or every entry on it was ... matched no tracked security"
      // half of the message is the one that actually applies to this sub-cause.
      expect(leaderboard.degradedMessage).toContain('matched no tracked security');
    });

    // Round-11 lane-review finding 2's positive case: a genuine fetch failure is the one
    // `degraded` cause where "ApeWisdom could not be reached" is actually true — this proves the
    // distinct `degradedReason` values don't just suppress the phrase everywhere, only where it's
    // false.
    it('a genuine provider fetch failure still reports "could not be reached" — the one degraded cause where that is true (round-11 lane-review finding 2)', async () => {
      const redis = inMemoryRedisClient();
      const firstRunAt = new Date(Date.now() + 60_000);
      const good = await runAttentionCollection({ providerMode: 'fixture', deps: harness().deps, redis, now: firstRunAt });
      expect(good.ok).toBe(true);

      const secondRunAt = new Date(Date.now() + 120_000);
      const failed = await runAttentionCollection({
        providerMode: 'fixture',
        deps: harness().deps,
        headers: { 'x-fixture-case': 'server_error' },
        redis,
        now: secondRunAt,
      });
      expect(failed.ok).toBe(false);
      if (failed.ok) return;
      expect(failed.reason).toBe('provider_unavailable');

      const leaderboard = await assembleAttentionLeaderboard({ redis, now: secondRunAt });
      expect(leaderboard.state).toBe('degraded');
      expect(leaderboard.degradedMessage).toContain('could not be reached');
    });

    // Round-12 lane-review finding 2: round 11's fix hardcoded `'provider_unreachable'` for every
    // `!collected.ok` case, but `error.kind === 'contract'` (`fixtures/apewisdom/filter/
    // malformed.json` — a 200 response whose body is HTML, not the recorded JSON schema) is a
    // response ApeWisdom actually sent. "Could not be reached" is false for this one specifically.
    it('a 200 response with the wrong shape reports a contract-changed reason, not "could not be reached" (round-12 lane-review finding 2)', async () => {
      const redis = inMemoryRedisClient();
      const firstRunAt = new Date(Date.now() + 60_000);
      const good = await runAttentionCollection({ providerMode: 'fixture', deps: harness().deps, redis, now: firstRunAt });
      expect(good.ok).toBe(true);

      const secondRunAt = new Date(Date.now() + 120_000);
      const failed = await runAttentionCollection({
        providerMode: 'fixture',
        deps: harness().deps,
        headers: { 'x-fixture-case': 'malformed' },
        redis,
        now: secondRunAt,
      });
      expect(failed.ok).toBe(false);
      if (failed.ok) return;
      expect(failed.reason).toBe('provider_unavailable');

      const leaderboard = await assembleAttentionLeaderboard({ redis, now: secondRunAt });
      expect(leaderboard.state).toBe('degraded');
      expect(leaderboard.degradedMessage).not.toContain('could not be reached');
      expect(leaderboard.degradedMessage).toContain('reached');
      expect(leaderboard.degradedMessage).toContain('shape');
    });

    // Round-10 lane-review finding 2: round 9's `computed === 0` guard conflated "did the corpus
    // advance" with "did this run's own metric recomputation keep pace" — `collectAttentionSnapshots`
    // stamps `observed_at = options.now` while `insertAttentionSnapshot` stamps `ingested_at` at
    // the real wall-clock instant of the write, a moment *after* an unpadded `now`. The
    // immediately-following `computeAttentionMetrics` call reads as-of that same `now`, and the
    // look-ahead guard (`as-of.ts`) correctly excludes a row not yet "available" as of the instant
    // being read — so `computed` reads 0 even though real rows were written. `results.length` is
    // the right signal: it counts persisted snapshots directly, not a downstream computation this
    // run's own `now` choice can race.
    it("a run whose own `now` races insertAttentionSnapshot's real ingested_at still counts as progress, never a false ApeWisdom-unreachable claim (round-10 lane-review finding 2)", async () => {
      const redis = inMemoryRedisClient();
      // Deliberately unpadded — the exact race every other test in this suite pads 60s to avoid.
      const now = new Date();
      const outcome = await runAttentionCollection({ providerMode: 'fixture', deps: harness().deps, redis, now });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      // The race: real snapshots were written, but this run's own recompute couldn't see them yet.
      expect(outcome.computed).toBe(0);

      const { rows } = await pool.query('select count(*)::text as count from attention_snapshot');
      expect(rows[0]?.count).toBe('2');

      expect(await redis.get(KEYS.degraded())).toBe(JSON.stringify(false));
      expect(await redis.get(KEYS.lastCollectedAt())).toBe(outcome.observedAt);

      // The page must never claim ApeWisdom was unreachable — it was reached, and wrote real data.
      const laterRead = await assembleAttentionLeaderboard({ redis, now: new Date(now.getTime() + 60_000) });
      expect(laterRead.state).not.toBe('degraded');
      expect(laterRead.degraded).toBe(false);
    });

    // Round-9 lane-review finding 3: `providerMethodologyVersion` used to be a plain overwrite —
    // `providerMethodologyVersion = current.providerMethodologyVersion` on every loop iteration —
    // so the banner reported whichever active security happened to sort last by symbol
    // (`listActiveSecurities` orders by symbol), not the version paired with the page's actual
    // freshest observation. GME sorts after AAPL, so a stale GME reading under an old methodology
    // version silently became the whole page's reported version even while AAPL (and every other
    // currently-collecting security) had already moved to the new one.
    it("reports the methodology version of the freshest observation, not whichever active security sorts last by symbol (round-9 lane-review finding 3)", async () => {
      const aapl = await securityId('AAPL');
      const gme = await securityId('GME');
      const redis = inMemoryRedisClient();

      // GME: stale, under the old methodology version — and 'GME' sorts after 'AAPL', so the old
      // last-iteration-wins bug would let this one win regardless of freshness.
      const staleObservedAt = new Date(Date.now() - 10 * 24 * 60 * 60_000);
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 40, 42, 300, 280, 900, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'gme-old-methodology')`,
        [gme, staleObservedAt],
      );
      await materializeAttentionMetricsForSecurity({
        securityId: gme,
        symbol: 'GME',
        configVersion,
        db: pool,
        redis,
        now: new Date(staleObservedAt.getTime() + 5 * 60_000),
      });

      // AAPL: fresh, under the new methodology version — this is the one the banner must report.
      const freshObservedAt = new Date(Date.now());
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 5, 6, 2000, 1900, 9000, 24, 'pov_index', 'apewisdom-2026-12', $2, $2, 'aapl-new-methodology')`,
        [aapl, freshObservedAt],
      );
      const now = new Date(freshObservedAt.getTime() + 2 * 60_000);
      await materializeAttentionMetricsForSecurity({ securityId: aapl, symbol: 'AAPL', configVersion, db: pool, redis, now });

      const read = await assembleAttentionLeaderboard({ redis, db: pool, now });
      expect(read.providerMethodologyVersion).toBe('apewisdom-2026-12');
    });

    // Round-50 lane-review finding 3: `attention_snapshot.engagement`/`.rank` are nullable by
    // contract (ApeWisdom does not report every field for every entry), and `toRawMetricView`'s
    // null-observation branch is what keeps an unreported field from rendering as a fabricated
    // number — the same fabrication this feature already fought one file upstream
    // (`inputs.ts`, round-6 finding 4). No fixture or seed had ever exercised a null engagement or
    // rank through the read path: `seedAttentionFresh` gives every security a non-null engagement,
    // and the collector rejects an unparseable `upvotes`/`rank` as malformed rather than passing
    // `null` through — so this writes the row directly, the only way to reach this branch.
    it('renders a null engagement or rank as an honest abstention, never a fabricated number (round-50 lane-review finding 3)', async () => {
      const gme = await securityId('GME');
      const redis = inMemoryRedisClient();
      const observedAt = new Date();
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', null, 42, 300, 280, null, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'gme-null-fields')`,
        [gme, observedAt],
      );
      const now = new Date(observedAt.getTime() + 60_000);
      await materializeAttentionMetricsForSecurity({ securityId: gme, symbol: 'GME', configVersion, db: pool, redis, now });

      const read = await assembleAttentionLeaderboard({ redis, db: pool, now });
      const gmeRow = read.rows.find((r) => r.symbol === 'GME');
      expect(gmeRow?.upvotes.display).toBeNull();
      expect(gmeRow?.upvotes.eligibility).toBe('not_applicable');
      expect(gmeRow?.upvotes.reason).toBe('Not reported for this observation.');
      expect(gmeRow?.rank.display).toBeNull();
      expect(gmeRow?.rank.eligibility).toBe('not_applicable');
      expect(gmeRow?.rank.reason).toBe('Not reported for this observation.');
    });

    // Round-50 lane-review finding 1: `mentionsZscoreWindowHours` (`deriveZscoreWindowHours`) is
    // copied from the artifact layer into the row view at `buildRow`'s return statement with no
    // test at any level that would fail if that copy regressed to `null` — `deriveZscoreWindowHours`
    // itself is unit-tested in isolation, and `AttentionTable` is unit-tested against a
    // hand-supplied value, but nothing tests the seam that hands the real one from a genuinely
    // computed artifact to the assembled row. Round-25 finding 2 is the reason this field exists
    // at all: `n=30` means "about a month" at today's cadence and "about 2.5 hours" once F16a's
    // 5-minute dispatch lands, and nothing else on the page lets a reader tell the two apart.
    it('threads the real z-score window from the artifact through to the assembled row, not null (round-50 lane-review finding 1)', async () => {
      const gme = await securityId('GME');
      const totalSnapshots = 20;
      const baseDate = new Date('2026-01-01T00:00:00Z');
      for (let i = 0; i < totalSnapshots; i += 1) {
        const observedAt = new Date(baseDate.getTime() + i * 24 * 60 * 60_000);
        await pool.query(
          `insert into attention_snapshot
             (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
              window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
           values ($1, 'apewisdom', 5, 6, $2, $3, 500, 24, 'pov_index', 'apewisdom-2026-09', $4, $4, $5)`,
          [gme, 100 + i, 90 + i, observedAt, `zscore-window-${i}`],
        );
      }
      const newestObservedAt = new Date(baseDate.getTime() + (totalSnapshots - 1) * 24 * 60 * 60_000);
      const redis = inMemoryRedisClient();
      await materializeAttentionMetricsForSecurity({
        securityId: gme,
        symbol: 'GME',
        configVersion,
        db: pool,
        redis,
        now: newestObservedAt,
      });

      const read = await assembleAttentionLeaderboard({ redis, db: pool, now: newestObservedAt });
      const gmeRow = read.rows.find((r) => r.symbol === 'GME');
      // 19 comparable predecessors, one calendar day apart — the real window is 19 days, not null
      // and not some other hand-picked figure a stub could satisfy.
      expect(gmeRow?.mentionsZscoreWindowHours).toBe(19 * 24);
    });

    // Round-52 lane-review finding 1: `observationWindowHours` (`deriveRankChangeProvenance`'s
    // `windowHours`) is round 51's exact sibling — copied from the artifact layer into the
    // assembled row at `buildRow`'s return statement with no test at any level that would fail if
    // that copy regressed to `current.windowHours` (the provider's fixed 24-hour board constant,
    // exactly the mistake lane-review "finding 2" originally fixed). Every other fixture and seed
    // in this suite spaces observations exactly 24 hours apart, so the derived value and
    // `current.windowHours` are numerically identical everywhere else — the bug would be
    // invisible without a deliberately non-24-hour gap, which is what this test constructs.
    it('threads the real comparison window from the artifact through to the assembled row, not the provider constant (round-52 lane-review finding 1)', async () => {
      const gme = await securityId('GME');
      const predecessorObservedAt = new Date('2026-01-01T00:00:00Z');
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 20, 22, 200, 180, 500, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'obs-window-predecessor')`,
        [gme, predecessorObservedAt],
      );
      // Five calendar days later — deliberately not 24 hours, so a regression to the provider's
      // fixed board-window constant is distinguishable from the real, measured span.
      const currentObservedAt = new Date(predecessorObservedAt.getTime() + 5 * 24 * 60 * 60_000);
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 5, 6, 300, 200, 600, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'obs-window-current')`,
        [gme, currentObservedAt],
      );
      const redis = inMemoryRedisClient();
      await materializeAttentionMetricsForSecurity({
        securityId: gme,
        symbol: 'GME',
        configVersion,
        db: pool,
        redis,
        now: currentObservedAt,
      });

      const read = await assembleAttentionLeaderboard({ redis, db: pool, now: currentObservedAt });
      const gmeRow = read.rows.find((r) => r.symbol === 'GME');
      expect(gmeRow?.observationWindowHours).toBe(5 * 24);
      expect(gmeRow?.observationWindowHours).not.toBe(24);
    });

    // Round-10 lane-review finding 4: `buildRow` returns `null` for every security whenever
    // `activeConfig === null` (its recovery path needs one to freeze a calculation against),
    // which collapses into `rows.length === 0` — the same branch a genuine cold start takes —
    // even when Postgres holds real `attention_snapshot` rows and computed artifacts. `status`/
    // `activated_at` are config_version's own documented lifecycle columns
    // (`migrations/0009_append_only.sql`'s `reject_content_mutation`), so moving the active row
    // to 'superseded' directly is a legitimate transition the schema itself permits, not a
    // workaround — it reproduces "the active version was superseded with no successor activated"
    // without inventing a fake table state.
    it('reports no_active_config_version, not the ordinary cold-start reason, when a real corpus exists but no config version is active (round-10 lane-review finding 4)', async () => {
      const redis = inMemoryRedisClient();
      const collectedAt = new Date(Date.now() + 60_000);
      const good = await runAttentionCollection({ providerMode: 'fixture', deps: harness().deps, redis, now: collectedAt });
      expect(good.ok).toBe(true);

      const { rows: snapshotCount } = await pool.query('select count(*)::text as count from attention_snapshot');
      expect(Number(snapshotCount[0]?.count)).toBeGreaterThan(0);
      const { rows: artifactCount } = await pool.query('select count(*)::text as count from calculation_snapshot');
      expect(Number(artifactCount[0]?.count)).toBeGreaterThan(0);

      await pool.query("update config_version set status = 'superseded' where environment = $1 and status = 'active'", [
        ATTENTION_CONFIG_ENVIRONMENT,
      ]);
      const activeAfter = await findActiveConfigVersion(ATTENTION_CONFIG_ENVIRONMENT, pool);
      expect(activeAfter).toBeNull();

      // Cold Redis — the ordinary production read, since Upstash is not provisioned (MT-03). `now`
      // must be at or after `collectedAt` — the seeded snapshots were deliberately observed in the
      // future relative to the real clock, and reading with the real default `now` would exclude
      // them via the look-ahead guard for an unrelated reason, not the one this test targets.
      const coldRedis = inMemoryRedisClient();
      const read = await assembleAttentionLeaderboard({ redis: coldRedis, db: pool, now: new Date(collectedAt.getTime() + 60_000) });
      expect(read.state).toBe('unavailable');
      expect(read.rows).toEqual([]);
      // The one assertion this finding exists for: never the ordinary cold-start reason over a
      // real, populated corpus.
      expect(read.unavailableReason).toBe('no_active_config_version');
      // Round-47 lane-review finding 1: the page-level fact, independent of `unavailableReason`.
      expect(read.activeConfigVersionMissing).toBe(true);
    });

    // Round-37 lane-review finding 2: `buildRow` returns `null` for *every* security when
    // `configVersion === null`, regardless of whether that security's own board entry ever
    // parsed — so `neverCollectedMalformedSymbols` must not assert "no observation has ever been
    // recorded" for a security whose absence from `rows` here is the config-version fault, not a
    // parsing one, even though it happens to also carry a stale `malformedTickers` flag.
    it('never claims "no observation has ever been recorded" for a malformed-flagged security when the real cause is a superseded config version', async () => {
      const redis = inMemoryRedisClient();
      const collectedAt = new Date(Date.now() + 60_000);
      const good = await runAttentionCollection({ providerMode: 'fixture', deps: harness().deps, redis, now: collectedAt });
      expect(good.ok).toBe(true);

      await pool.query("update config_version set status = 'superseded' where environment = $1 and status = 'active'", [
        ATTENTION_CONFIG_ENVIRONMENT,
      ]);

      // Cold Redis, the same as round-10's own test above: a warm pointer's fast path never
      // reaches `buildRow`'s `configVersion === null` guard at all, which would make this test
      // pass for the wrong reason (real rows, never touching the branch under test). GME has a
      // full history in Postgres from the run above; flagging it malformed on this cold client
      // simulates a later run's own record surviving into this specific read.
      const coldRedis = inMemoryRedisClient();
      await coldRedis.set(KEYS.malformedTickers(), JSON.stringify(['GME']));

      const read = await assembleAttentionLeaderboard({ redis: coldRedis, db: pool, now: new Date(collectedAt.getTime() + 60_000) });
      expect(read.state).toBe('unavailable');
      expect(read.unavailableReason).toBe('no_active_config_version');
      expect(read.neverCollectedMalformedSymbols).toEqual([]);
      // Round-42 lane-review finding 1: both GME and AAPL have real observations but no row on
      // this cold-client read — the same infrastructure fault, disclosed by symbol.
      expect(read.configVersionGapSymbols.sort()).toEqual(['AAPL', 'GME']);
      expect(read.activeConfigVersionMissing).toBe(true);
    });

    // Round-38 lane-review finding 1: the previous test proves the *`unavailable`* branch; this
    // proves the fix holds on the *main* return path too, which round 37's own branch-specific
    // suppression never touched. With a missing active config version, `buildRow`'s fast path
    // (fresh, already-warm pointers) never consults `configVersion` at all — so GME and AAPL can
    // still build real rows (`rows.length > 0`, never reaching the `unavailable` branch) while a
    // third security, NVDA, has a real Postgres observation but no Redis pointer at all, so its
    // own `buildRow` call hits the same `configVersion === null` guard and returns `null`. NVDA
    // must not read as "never observed" just because it has no row.
    it('never claims "no observation has ever been recorded" for a malformed-flagged security on the main (non-unavailable) return path either', async () => {
      await pool.query(
        `insert into security (symbol, name, exchange, asset_type, currency) values
         ('NVDA', 'NVIDIA Corp.', 'NASDAQ', 'equity', 'USD')`,
      );
      const nvda = await securityId('NVDA');

      const redis = inMemoryRedisClient();
      const collectedAt = new Date(Date.now() + 60_000);
      const good = await runAttentionCollection({ providerMode: 'fixture', deps: harness().deps, redis, now: collectedAt });
      expect(good.ok).toBe(true);

      // NVDA has a real observation, but nothing ever materialized a Redis pointer for it.
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 60, 65, 150, 140, 900, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'nvda-no-pointer')`,
        [nvda, collectedAt],
      );

      await pool.query("update config_version set status = 'superseded' where environment = $1 and status = 'active'", [
        ATTENTION_CONFIG_ENVIRONMENT,
      ]);
      await redis.set(KEYS.malformedTickers(), JSON.stringify(['NVDA']));

      const read = await assembleAttentionLeaderboard({ redis, db: pool, now: new Date(collectedAt.getTime() + 60_000) });
      // GME and AAPL's already-warm pointers build real rows regardless of the missing config
      // version — this read never reaches the `unavailable` branch at all.
      expect(read.state).not.toBe('unavailable');
      expect(read.rows.map((r) => r.symbol).sort()).toEqual(['AAPL', 'GME']);
      expect(read.rows.find((r) => r.symbol === 'NVDA')).toBeUndefined();
      expect(read.neverCollectedMalformedSymbols).toEqual([]);
      // Round-42 lane-review finding 1: NVDA has a real observation with no row to render it
      // through — exactly the gap `configVersionGapSymbols` exists to disclose, on a page whose
      // own `state` gives no other hint that anything is missing.
      expect(read.configVersionGapSymbols).toEqual(['NVDA']);
      expect(read.activeConfigVersionMissing).toBe(true);
    });

    // Round-47 lane-review finding 1. The test just above still leaves one gap uncovered: NVDA's
    // *missing pointer* is what makes `configVersionGapSymbols` non-empty there, but
    // `buildRow`'s fast path never consults `configVersion` at all — a run where *every* tracked
    // security's pointers are already warm (no TTL on any of them) builds every row successfully
    // even with no active config version, leaving `configVersionGapSymbols: []` while the
    // collector has, in fact, permanently stopped (`pipeline.ts`'s early return on a missing
    // active config version fires before it ever contacts ApeWisdom again). `state` alone still
    // reads healthy; `activeConfigVersionMissing` is the only field that says otherwise.
    it('discloses a missing active config version even when every row still builds successfully (round-47 lane-review finding 1)', async () => {
      const redis = inMemoryRedisClient();
      const collectedAt = new Date(Date.now() + 60_000);
      const good = await runAttentionCollection({ providerMode: 'fixture', deps: harness().deps, redis, now: collectedAt });
      expect(good.ok).toBe(true);

      await pool.query("update config_version set status = 'superseded' where environment = $1 and status = 'active'", [
        ATTENTION_CONFIG_ENVIRONMENT,
      ]);
      expect(await findActiveConfigVersion(ATTENTION_CONFIG_ENVIRONMENT, pool)).toBeNull();

      // The same warm `redis` client the collector just wrote to — every pointer intact.
      const read = await assembleAttentionLeaderboard({ redis, db: pool, now: new Date(collectedAt.getTime() + 60_000) });
      expect(read.state).not.toBe('unavailable');
      expect(read.rows.length).toBeGreaterThan(0);
      expect(read.unavailableReason).toBeNull();
      expect(read.configVersionGapSymbols).toEqual([]);
      expect(read.activeConfigVersionMissing).toBe(true);
    });

    // Lane-review round 4 finding 1. `runAttentionCollection` writes every security's snapshot
    // first, then materializes Redis pointers in a second, separate loop — so a security whose
    // materialization step didn't run for the newest observation can have a fresh Postgres row
    // paired with a Redis pointer left over from an *older* one. Before this fix, `buildRow`
    // rendered the raw cells from the fresh row and every delta from the stale pointer with no
    // check the two agreed, understating an 18-rank, 600-mention move as roughly zero.
    it('a stale Redis pointer paired with a fresher Postgres snapshot is recomputed, never rendered as if it still agreed (lane-review round 4 finding 1)', async () => {
      const gme = await securityId('GME');
      const redis = inMemoryRedisClient();
      const firstObservedAt = new Date('2026-08-30T09:00:00Z');
      const secondObservedAt = new Date('2026-08-30T10:00:00Z');

      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 30, 32, 900, 850, 5000, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'stale-poll-1')`,
        [gme, firstObservedAt],
      );
      // Materializes and points Redis at O1 — this is the pointer that will go stale.
      const staleMetrics = await materializeAttentionMetricsForSecurity({
        securityId: gme,
        symbol: 'GME',
        configVersion,
        db: pool,
        redis,
        now: new Date(firstObservedAt.getTime() + 5 * 60_000),
      });
      expect(staleMetrics).not.toBeNull();

      // A second, newer observation lands directly in Postgres — simulating the second,
      // materialize-only loop in `runAttentionCollection` not having run yet for this security —
      // without ever calling `materializeAttentionMetricsForSecurity` for it. Redis's pointer
      // still resolves to O1's artifact.
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 12, 30, 1500, 900, 8000, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'stale-poll-2')`,
        [gme, secondObservedAt],
      );

      const read = await assembleAttentionLeaderboard({
        redis,
        db: pool,
        now: new Date(secondObservedAt.getTime() + 5 * 60_000),
      });
      const gmeRow = read.rows.find((row) => row.symbol === 'GME');
      expect(gmeRow).toBeDefined();

      // Raw cells always reflect the freshest snapshot (O2).
      expect(gmeRow?.mentions.display).toBe('1500');
      expect(gmeRow?.rank.display).toBe('12');
      // The delta must be recomputed against O2, not left describing O1's own predecessor — the
      // true move is 18 ranks and +600 mentions, not the near-zero figure a stale O1-vs-O1's-own-
      // predecessor pointer would have shown.
      expect(gmeRow?.rankChange.display).toBe('18');
      expect(gmeRow?.mentionDelta?.display).toBe('600');
      // The pointer itself must have been repointed at the newly computed artifact, not left
      // referencing O1's — otherwise the next read would silently repeat this exact bug.
      const repointed = await redis.get(`attention:pointer:${gme}:attention.rank_change`);
      expect(repointed).toBe(gmeRow?.rankChange.calculationId);
      expect(repointed).not.toBe(staleMetrics?.rankChange.calculationId);
    });

    // Lane-review round 6 finding 2. `pipeline.ts` writes the five pointers as five separate,
    // sequential redis calls — an interruption between them can leave `rank_change`'s pointer
    // fresh (matching the newest observation) while one of the other four still describes an
    // older one. Round 4's guard covered only `rank_change`; this proves the other four are
    // caught too, not just when `rank_change` itself is stale.
    it('a stale mention_delta pointer is caught and the whole row recomputed even though rank_change\'s own pointer already matches the fresher snapshot (lane-review round 6 finding 2)', async () => {
      const gme = await securityId('GME');
      const redis = inMemoryRedisClient();
      const firstObservedAt = new Date('2026-08-30T09:00:00Z');
      const secondObservedAt = new Date('2026-08-30T10:00:00Z');

      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 30, 32, 900, 850, 5000, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'partial-poll-1')`,
        [gme, firstObservedAt],
      );
      const firstMetrics = await materializeAttentionMetricsForSecurity({
        securityId: gme,
        symbol: 'GME',
        configVersion,
        db: pool,
        redis,
        now: new Date(firstObservedAt.getTime() + 5 * 60_000),
      });
      const staleMentionDeltaId = firstMetrics?.mentionDelta?.calculationId;
      expect(staleMentionDeltaId).toBeTruthy();

      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 12, 30, 1500, 900, 8000, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'partial-poll-2')`,
        [gme, secondObservedAt],
      );
      // Fully materializes O2 — every pointer, `rank_change` included, now matches the fresher
      // observation.
      await materializeAttentionMetricsForSecurity({
        securityId: gme,
        symbol: 'GME',
        configVersion,
        db: pool,
        redis,
        now: new Date(secondObservedAt.getTime() + 5 * 60_000),
      });

      // Simulates the interruption: only `mention_delta`'s pointer reverts to the O1-era
      // artifact, as if the second, materialize-only loop in `runAttentionCollection` had thrown
      // right after writing `rank_change`'s pointer for O2 but before reaching `mention_delta`'s.
      await redis.set(KEYS.metricPointer(gme, 'attention.mention_delta'), staleMentionDeltaId as string);

      const read = await assembleAttentionLeaderboard({
        redis,
        db: pool,
        now: new Date(secondObservedAt.getTime() + 10 * 60_000),
      });
      const gmeRow = read.rows.find((row) => row.symbol === 'GME');

      // The whole row must be recomputed against O2 — not just the one pointer that was caught
      // stale — since a partial recompute would leave the same inconsistency in a different shape.
      expect(gmeRow?.rankChange.display).toBe('18');
      expect(gmeRow?.mentionDelta?.display).toBe('600');
      expect(gmeRow?.mentionDelta?.calculationId).not.toBe(staleMentionDeltaId);

      const repointed = await redis.get(KEYS.metricPointer(gme, 'attention.mention_delta'));
      expect(repointed).toBe(gmeRow?.mentionDelta?.calculationId);
    });

    // Lane-review round 7 finding 2. `engagement_per_mention` and `mentions_zscore` are
    // unconditionally computed — unlike `mention_delta`/`mention_growth`, which are legitimately
    // `del`'d on a methodology boundary, an absent pointer for either of the always-computed two
    // can only mean an interrupted materialization. This proves the *absence* case specifically,
    // not just the stale-but-present case round 6 finding 2 already covers.
    it('a missing (not merely stale) engagement_per_mention pointer still triggers full-row recovery, since that method is never legitimately suppressed (lane-review round 7 finding 2)', async () => {
      const gme = await securityId('GME');
      const redis = inMemoryRedisClient();
      const observedAt = new Date('2026-08-30T09:00:00Z');

      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 30, 32, 900, 850, 5000, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'absent-poll-1')`,
        [gme, observedAt],
      );
      await materializeAttentionMetricsForSecurity({
        securityId: gme,
        symbol: 'GME',
        configVersion,
        db: pool,
        redis,
        now: new Date(observedAt.getTime() + 5 * 60_000),
      });

      // Simulates the interruption landing right after `rank_change`'s pointer write but before
      // `engagement_per_mention`'s ever happened — `rank_change` is fresh and matches `current`;
      // `engagement_per_mention` was never written for this observation at all.
      await redis.del(KEYS.metricPointer(gme, 'attention.engagement_per_mention'));

      const read = await assembleAttentionLeaderboard({
        redis,
        db: pool,
        now: new Date(observedAt.getTime() + 10 * 60_000),
      });
      const gmeRow = read.rows.find((row) => row.symbol === 'GME');

      // The Upvotes cell must carry engagement_per_mention's own calculationId, recovered — never
      // fall back to rank_change's, whose inputs contain no engagement figure at all.
      expect(gmeRow?.upvotes.calculationId).toBeTruthy();
      expect(gmeRow?.upvotes.calculationId).not.toBe(gmeRow?.rankChange.calculationId);
      const repointed = await redis.get(KEYS.metricPointer(gme, 'attention.engagement_per_mention'));
      expect(repointed).toBe(gmeRow?.upvotes.calculationId);
    });

    // Lane-review round 14 finding 1. `pointerMatchesCurrent` (round 4 finding 1, above) only
    // compared `observedAt` — enough to catch a stale pointer left over from a genuinely older
    // observation, but not a provider *revision*: `repositories/attention.ts` stores a revision
    // as a successor row with the identical `(security_id, source, observed_at)` but a later
    // `ingested_at`, and `attentionSnapshotHistory`'s `distinct on (observed_at) … order by
    // ingested_at desc` makes that revised row `current` from the moment it lands — under the
    // same `observedAt` the original pointer already matched. Traced live: a revision landing
    // after the original was already pointed at rendered the revised raw cells beside the
    // *original* reading's deltas and `calculationId`, permanently — the guard kept returning
    // `true` for the one axis it checked.
    it('a provider revision — the same observed_at, a later ingested_at, different values — is detected and recomputed, never served under the original reading\'s artifact forever (lane-review round 14 finding 1)', async () => {
      const gme = await securityId('GME');
      const redis = inMemoryRedisClient();
      const observedAt = new Date('2026-08-30T09:00:00Z');
      const originalIngestedAt = new Date(observedAt.getTime() + 60_000);
      const revisionIngestedAt = new Date(observedAt.getTime() + 10 * 60_000);

      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 50, 55, 105, 100, 5000, 24, 'pov_index', 'apewisdom-2026-09', $2, $3, 'revision-original')`,
        [gme, observedAt, originalIngestedAt],
      );
      const originalMetrics = await materializeAttentionMetricsForSecurity({
        securityId: gme,
        symbol: 'GME',
        configVersion,
        db: pool,
        redis,
        now: new Date(originalIngestedAt.getTime() + 60_000),
      });
      expect(originalMetrics).not.toBeNull();
      expect(originalMetrics?.rankChange.result?.display).toBe('5');

      // The provider revises the same observation window after the fact: identical `observed_at`,
      // a later `ingested_at`, and materially different values — exactly the case
      // `insertAttentionSnapshot`'s own doc names a genuine revision, stored as a successor row
      // rather than an update.
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 5, 55, 900, 100, 9000, 24, 'pov_index', 'apewisdom-2026-09', $2, $3, 'revision-corrected')`,
        [gme, observedAt, revisionIngestedAt],
      );

      const read = await assembleAttentionLeaderboard({
        redis,
        db: pool,
        now: new Date(revisionIngestedAt.getTime() + 60_000),
      });
      const gmeRow = read.rows.find((row) => row.symbol === 'GME');
      expect(gmeRow).toBeDefined();

      // Raw cells reflect the revision — the latest `ingested_at` for this `observed_at`.
      expect(gmeRow?.rank.display).toBe('5');
      expect(gmeRow?.mentions.display).toBe('900');
      // The delta must be recomputed against the revision (55 -> 5, 100 -> 900), never left
      // describing the original reading's own (55 -> 50, 100 -> 105) delta forever.
      expect(gmeRow?.rankChange.display).toBe('50');
      expect(gmeRow?.mentionDelta?.display).toBe('800');
      expect(gmeRow?.rankChange.calculationId).not.toBe(originalMetrics?.rankChange.calculationId);

      const repointed = await redis.get(`attention:pointer:${gme}:attention.rank_change`);
      expect(repointed).toBe(gmeRow?.rankChange.calculationId);
    });

    // Lane-review round 5 finding 2. A row recomputed inside `buildRow` (the exact scenario
    // round 4 finding 1 fixes) previously left the 30-minute notable-movers cache untouched, so
    // the "Notable rank changes" cards could disagree with the freshly recomputed table row for
    // the same security on the same page — a plausible-looking but wrong number, not an obvious
    // failure.
    it('invalidates the notable-movers cache when a row is recomputed mid-read, so cards and table never disagree (lane-review round 5 finding 2)', async () => {
      const gme = await securityId('GME');
      const redis = inMemoryRedisClient();
      const firstObservedAt = new Date('2026-08-30T09:00:00Z');
      const secondObservedAt = new Date('2026-08-30T10:00:00Z');

      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 30, 32, 900, 850, 5000, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'movers-poll-1')`,
        [gme, firstObservedAt],
      );
      await materializeAttentionMetricsForSecurity({
        securityId: gme,
        symbol: 'GME',
        configVersion,
        db: pool,
        redis,
        now: new Date(firstObservedAt.getTime() + 5 * 60_000),
      });

      // Populates the notable-movers cache from the O1-era row.
      const firstRead = await assembleAttentionLeaderboard({
        redis,
        db: pool,
        now: new Date(firstObservedAt.getTime() + 5 * 60_000),
      });
      const firstMover = firstRead.notableMovers.find((mover) => mover.symbol === 'GME');
      // Bootstrap case: no local predecessor exists yet, so `rank_change` falls back to the
      // provider's own bundled rank_prior (32) — `32 - 30 = 2`.
      expect(firstMover?.rankChange.display).toBe('2');

      // A fresher observation lands directly in Postgres without materializing — the same
      // stale-pointer scenario round 4 finding 1 fixes for the table row.
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 12, 30, 1500, 900, 8000, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'movers-poll-2')`,
        [gme, secondObservedAt],
      );

      const secondRead = await assembleAttentionLeaderboard({
        redis,
        db: pool,
        now: new Date(secondObservedAt.getTime() + 5 * 60_000),
      });
      const gmeRow = secondRead.rows.find((row) => row.symbol === 'GME');
      const gmeMover = secondRead.notableMovers.find((mover) => mover.symbol === 'GME');
      expect(gmeRow?.rankChange.display).toBe('18');
      // The card must agree with the table — same recomputed value, same calculationId — not the
      // O1-era figure the cache was still holding.
      expect(gmeMover?.rankChange.display).toBe('18');
      expect(gmeMover?.rankChange.calculationId).toBe(gmeRow?.rankChange.calculationId);
      expect(gmeMover?.mentionDelta?.display).toBe('600');
    });

    // Lane-review round 3 finding 1 — the exact serious regression the round-2 fix introduced,
    // reproduced against a real Postgres: two ordinary polls of the SAME security where mentions
    // and engagement stay byte-identical but rank moves and time passes (a routine case for a
    // thin ticker, not a rare one). Before this fix, `deterministicCalculationId` hashed only
    // `{key, value, dataType}` per input — dropping `provenance` (`observedAt`/`ingestedAt`),
    // which `computeInputHash` does include — so the second poll's `attention.engagement_per_
    // mention` and `attention.mentions_zscore` artifacts (whose inputs never touch rank at all)
    // shared a `calculationId` with the first poll's while genuinely differing in `input_hash`,
    // and the round-2 divergence check correctly, but wrongly, threw on every such poll.
    it('a second ordinary poll with unchanged mentions/engagement but a new observed_at never throws, and gets its own calculationId (lane-review round 3 finding 1)', async () => {
      const gme = await securityId('GME');
      const firstObservedAt = new Date('2026-08-30T10:00:00Z');
      const secondObservedAt = new Date('2026-08-30T11:00:00Z');

      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 10, 12, 140, 130, 500, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'poll-1')`,
        [gme, firstObservedAt],
      );
      const first = await computeAttentionMetrics({
        securityId: gme,
        symbol: 'GME',
        configVersion,
        now: new Date(firstObservedAt.getTime() + 5 * 60_000),
      });
      expect(first).not.toBeNull();

      // Rank moves 10 → 9; mentions and engagement are byte-identical to the first poll. Only
      // `observed_at`/`ingested_at` (this row's provenance) and `rank`/`rank_prior` differ.
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 9, 10, 140, 140, 500, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'poll-2')`,
        [gme, secondObservedAt],
      );

      const second = await computeAttentionMetrics({
        securityId: gme,
        symbol: 'GME',
        configVersion,
        now: new Date(secondObservedAt.getTime() + 5 * 60_000),
      });
      expect(second).not.toBeNull();

      // `engagement_per_mention`'s inputs (`engagement`, `mentions_now`) hold the identical
      // *values* across both polls — this is exactly the case the regression got wrong. A
      // provenance-aware id must still treat them as two distinct observations.
      expect(second?.engagementPerMention.calculationId).not.toBe(first?.engagementPerMention.calculationId);
      expect(second?.engagementPerMention.inputHash).not.toBe(first?.engagementPerMention.inputHash);
      // The rank actually moved, so `rank_change` differing is not by itself informative — asserted
      // anyway for completeness.
      expect(second?.rankChange.calculationId).not.toBe(first?.rankChange.calculationId);
    });

    it('genuinely never-collected data (nothing in Postgres either) still reads unavailable', async () => {
      const redis = inMemoryRedisClient();
      const read = await assembleAttentionLeaderboard({ redis });
      expect(read.state).toBe('unavailable');
      expect(read.rows).toHaveLength(0);
    });

    // Round-25 lane-review finding 1. The very first collection attempt this deployment ever
    // makes fails outright (nothing has ever been written to Postgres, so `rows.length === 0`
    // regardless): `state` is correctly `'unavailable'` (F08 §4.5's own definition — no
    // observation exists anywhere), but `degraded`/`degradedReason`/`degradedMessage` must still
    // report the real outage Redis recorded, not the hardcoded `false`/`null`/`null` the early
    // return used to return. `GET /api/social/reddit` is this leaderboard object verbatim, so a
    // caller reading `degraded: false` here would believe collection is healthy when it is not.
    it('a first-ever collection attempt that fails still reports the real outage, even though state reads unavailable (round-25 lane-review finding 1)', async () => {
      const redis = inMemoryRedisClient();
      const failed = await runAttentionCollection({
        providerMode: 'fixture',
        deps: harness().deps,
        headers: { 'x-fixture-case': 'server_error' },
        redis,
      });
      expect(failed.ok).toBe(false);

      const read = await assembleAttentionLeaderboard({ redis });
      expect(read.state).toBe('unavailable');
      expect(read.rows).toHaveLength(0);
      expect(read.degraded).toBe(true);
      expect(read.degradedReason).toBe('provider_unreachable');
      expect(read.degradedMessage).toContain('could not be reached');
      // Round-27 lane-review finding 1: round 25 hoisted `degradedMessage` above this early
      // return without changing its text, so it kept asserting "the rows below are the most
      // recent successful observations" — false on a branch that hardcodes `rows: []` two lines
      // below. The zero-row-specific trailing sentence must never claim rows exist.
      expect(read.degradedMessage).not.toContain('rows below');
      expect(read.degradedMessage).toContain('No observation has been recorded for any tracked security yet.');
    });

    // Round-26 lane-review finding 3. `runAttentionCollection` refuses to call
    // `collectAttentionSnapshots` at all when no config version is active — so a deployment whose
    // config version was *never* activated (never even superseded from an earlier active one, the
    // round-10 scenario above) reaches the read path with an empty Postgres corpus, exactly like
    // an ordinary cold start. `unavailableReason` must still report the real, permanent
    // configuration fault — not the transient-sounding "never_collected," which reads as "will
    // resolve on its own" for a state that will not.
    it('reports no_active_config_version, not the ordinary cold-start reason, when no config version was ever activated (round-26 lane-review finding 3)', async () => {
      await pool.query("update config_version set status = 'superseded' where environment = $1 and status = 'active'", [
        ATTENTION_CONFIG_ENVIRONMENT,
      ]);
      const activeAfter = await findActiveConfigVersion(ATTENTION_CONFIG_ENVIRONMENT, pool);
      expect(activeAfter).toBeNull();

      const redis = inMemoryRedisClient();
      const read = await assembleAttentionLeaderboard({ redis, db: pool });
      expect(read.state).toBe('unavailable');
      expect(read.rows).toHaveLength(0);
      expect(read.unavailableReason).toBe('no_active_config_version');
    });

    // Round-28 lane-review finding 2. `degraded`/`degradedReason` are Redis bookkeeping, entirely
    // independent of `config_version`'s own Postgres lifecycle — nothing clears them when an
    // active config version is later superseded. A provider outage recorded while a config
    // version was active, followed by that version being superseded, leaves the read path with
    // BOTH a real degraded outage AND `unavailableReason: 'no_active_config_version'` — and the
    // zero-row degradedMessage must not claim "no observation has ever been recorded" over a
    // corpus that may well hold real history from before the outage.
    it('does not claim "no observation has been recorded" when the real cause is a superseded config version, not an empty corpus (round-28 lane-review finding 2)', async () => {
      const redis = inMemoryRedisClient();
      const failed = await runAttentionCollection({
        providerMode: 'fixture',
        deps: harness().deps,
        headers: { 'x-fixture-case': 'server_error' },
        redis,
      });
      expect(failed.ok).toBe(false);

      await pool.query("update config_version set status = 'superseded' where environment = $1 and status = 'active'", [
        ATTENTION_CONFIG_ENVIRONMENT,
      ]);
      const activeAfter = await findActiveConfigVersion(ATTENTION_CONFIG_ENVIRONMENT, pool);
      expect(activeAfter).toBeNull();

      const read = await assembleAttentionLeaderboard({ redis, db: pool });
      expect(read.state).toBe('unavailable');
      expect(read.unavailableReason).toBe('no_active_config_version');
      expect(read.degraded).toBe(true);
      expect(read.degradedReason).toBe('provider_unreachable');
      expect(read.degradedMessage).toContain('could not be reached');
      expect(read.degradedMessage).not.toContain('No observation has been recorded for any tracked security yet.');
      expect(read.degradedMessage).toContain('may be hiding attention data this deployment has already collected');
      // Round-46 lane-review finding 1: "on the last collection run" reads as recent, but no run
      // has been attempted since the config version was lost — the message must say so, not just
      // the config-gap fact.
      //
      // Round-49 lane-review finding 2: the message no longer attributes the missing run to the
      // config gap causally ("because there is also no..."), since nothing calls the collector in
      // production regardless of config version state — it states the config gap as its own fact.
      expect(read.degradedMessage).toContain('also no active config version to record a calculation against');
      expect(read.degradedMessage).not.toContain('has not been able to attempt another run since');
    });

    // Round-46 lane-review finding 2, sibling of the round-28 test above for the other two
    // `degradedReason` values: only `provider_unreachable`'s compound composition was ever
    // exercised, leaving `no_new_data`'s and `provider_contract_changed`'s own text (a different
    // string from `degradedReasonExplanation`, spliced into the identical compound sentence)
    // completely unpinned at any level.
    it('composes the compound config-gap message correctly for no_new_data too (round-46 lane-review finding 2)', async () => {
      const redis = inMemoryRedisClient();
      const emptyRun = await runAttentionCollection({
        providerMode: 'fixture',
        deps: harness().deps,
        headers: { 'x-fixture-case': 'empty' },
        redis,
      });
      expect(emptyRun.ok).toBe(true);

      await pool.query("update config_version set status = 'superseded' where environment = $1 and status = 'active'", [
        ATTENTION_CONFIG_ENVIRONMENT,
      ]);
      expect(await findActiveConfigVersion(ATTENTION_CONFIG_ENVIRONMENT, pool)).toBeNull();

      const read = await assembleAttentionLeaderboard({ redis, db: pool });
      expect(read.state).toBe('unavailable');
      expect(read.unavailableReason).toBe('no_active_config_version');
      expect(read.degraded).toBe(true);
      expect(read.degradedReason).toBe('no_new_data');
      expect(read.degradedMessage).not.toContain('could not be reached');
      expect(read.degradedMessage).toContain('the board was empty');
      expect(read.degradedMessage).toContain('also no active config version to record a calculation against');
      expect(read.degradedMessage).toContain('may be hiding attention data this deployment has already collected');
    });

    it('composes the compound config-gap message correctly for provider_contract_changed too (round-46 lane-review finding 2)', async () => {
      const redis = inMemoryRedisClient();
      const malformedRun = await runAttentionCollection({
        providerMode: 'fixture',
        deps: harness().deps,
        headers: { 'x-fixture-case': 'malformed' },
        redis,
      });
      expect(malformedRun.ok).toBe(false);

      await pool.query("update config_version set status = 'superseded' where environment = $1 and status = 'active'", [
        ATTENTION_CONFIG_ENVIRONMENT,
      ]);
      expect(await findActiveConfigVersion(ATTENTION_CONFIG_ENVIRONMENT, pool)).toBeNull();

      const read = await assembleAttentionLeaderboard({ redis, db: pool });
      expect(read.state).toBe('unavailable');
      expect(read.unavailableReason).toBe('no_active_config_version');
      expect(read.degraded).toBe(true);
      expect(read.degradedReason).toBe('provider_contract_changed');
      expect(read.degradedMessage).not.toContain('could not be reached');
      expect(read.degradedMessage).toContain('shape');
      expect(read.degradedMessage).toContain('also no active config version to record a calculation against');
      expect(read.degradedMessage).toContain('may be hiding attention data this deployment has already collected');
    });

    // Lane-review round 2 finding 3's own divergent-content scenario (a `calculationId` collision
    // whose existing row does NOT hold the same content) cannot be reproduced here: `pool.query`
    // both an `update` and a `delete` against `calculation_snapshot` are rejected by its own
    // append-only trigger (`migrations/0012_retention_exception.sql`) before this test could ever
    // corrupt a row to simulate it — confirmed below, since that append-only guarantee is itself
    // a real, if incidental, defence for this exact risk and worth asserting rather than assuming.
    // The divergence-detection logic itself (`compute.ts#computeAndStore`'s catch block) is
    // covered directly, with `persistArtifact`/`loadArtifact` mocked, in
    // `tests/unit/services/attention/compute.test.ts`.
    it("confirms calculation_snapshot's own append-only trigger — not just this module — stands between a corrupted row and a silent divergence", async () => {
      const first = await runAttentionCollection({ providerMode: 'fixture', deps: harness().deps, redis: inMemoryRedisClient() });
      expect(first.ok).toBe(true);
      const { rows } = await pool.query<{ id: string }>(
        "select id from calculation_snapshot where method_key = 'attention.rank_change' limit 1",
      );
      const id = rows[0]?.id;
      expect(id).toBeTruthy();
      await expect(
        pool.query('update calculation_snapshot set input_hash = $1 where id = $2', ['deadbeef'.repeat(8), id]),
      ).rejects.toThrow(/append-only/);
    });
  });

  describe('countComparableAttentionSnapshots / depth — F06 §4.1', () => {
    it('increments as the collector runs across distinct observation days', async () => {
      const gme = await securityId('GME');

      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 5, 6, 100, 90, 500, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'seed-1')`,
        [gme, new Date('2026-08-30T00:00:00Z')],
      );

      // A second, later observation — one comparable predecessor now exists.
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 3, 5, 140, 100, 700, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'seed-2')`,
        [gme, new Date('2026-08-31T00:00:00Z')],
      );

      const secondMetrics = await computeAttentionMetrics({
        securityId: gme,
        symbol: 'GME',
        configVersion,
        now: new Date('2026-08-31T00:00:00Z'),
      });
      // A local predecessor exists (the first observation, seeded above) — the comparison is
      // this deployment's own, even though depth is still only 1 (lane-review finding 1: the
      // label must never be gated on depth).
      expect(secondMetrics?.rankChangeSource).toBe('own_history');
      expect(secondMetrics?.rankChange.result?.display).toBe('2');

      const rawDepth = await countComparableAttentionSnapshots({
        securityId: gme,
        source: 'apewisdom',
        methodologyVersion: 'apewisdom-2026-09',
        beforeObservedAt: new Date('2026-08-31T00:00:00Z'),
        asOfInstant: new Date('2026-08-31T00:00:00Z'),
      });
      expect(rawDepth).toBe(1);
    });

    // Round-9 lane-review finding 4 found the z-score's comparable-history query silently capped
    // at `attentionSnapshotHistory`'s `DEFAULT_HISTORY_LIMIT = 100` — a bound meant "for a UI
    // trend," not this method's window. Round-9's own fix (no limit at all) was itself wrong,
    // caught by round-10 lane-review finding 1: an unbounded window means one persisted
    // `history_N` `calculation_input` row per history point, per poll, per security, forever —
    // measured at 45,150 rows from 300 polls on a single security, with no line item in
    // `check:storage`'s projection to catch it. The corrected fix bounds the window at 30 — the
    // upper end of `calc/methods/attention-mentions-zscore.ts`'s own documented "14–30-element
    // window" — and `deriveHistoryDepth` (`leaderboard.ts`, read at render time from the
    // artifact's actual `history_N` inputs) now honestly reports that bounded figure: the page
    // never claims more history informed a z-score than genuinely did. `countComparableAttentionSnapshots`
    // (F06's own gate on whether at least 14 comparable snapshots exist at all, ever) answers a
    // different question and is expected to diverge from the bounded window past 30 — asserted
    // below directly against the repository function, not treated as a bug the way round 9
    // treated the prior (accidental, mismatched-purpose) divergence. `compute.ts` used to also
    // return this same uncapped count as its own `historyDepth` field on every compute call, at
    // real, unbounded cost; round-30 lane-review finding 2 removed it — nothing outside this
    // test ever read it, since the UI's own depth-14 gate is `deriveHistoryDepth(zscoreArtifact)`
    // below, and the two agree on the one thing they're both asked (whether depth has reached
    // 14) — see `compute.ts`'s own doc for the reachability argument.
    it('the z-score window is bounded at 30 comparable snapshots, while the depth-14 gate counter stays uncapped', async () => {
      const gme = await securityId('GME');
      const totalSnapshots = 45;
      const baseDate = new Date('2026-01-01T00:00:00Z');

      for (let i = 0; i < totalSnapshots; i += 1) {
        const observedAt = new Date(baseDate.getTime() + i * 24 * 60 * 60_000);
        await pool.query(
          `insert into attention_snapshot
             (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
              window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
           values ($1, 'apewisdom', 5, 6, $2, $3, 500, 24, 'pov_index', 'apewisdom-2026-09', $4, $4, $5)`,
          [gme, 100 + i, 90 + i, observedAt, `depth-window-${i}`],
        );
      }

      const newestObservedAt = new Date(baseDate.getTime() + (totalSnapshots - 1) * 24 * 60 * 60_000);
      const metrics = await computeAttentionMetrics({
        securityId: gme,
        symbol: 'GME',
        configVersion,
        now: newestObservedAt,
      });
      // 44 comparable predecessors exist, well past the 30-element window — the artifact's own
      // history_N inputs (what the page actually renders) must cap at exactly 30, not report all
      // 44 (round 9's storage-unbounded mistake) and not silently cap at 99 (the original,
      // mismatched-purpose bug).
      const historyInputCount =
        metrics?.mentionsZscore.inputs.filter((input) => input.key.startsWith('history_')).length ?? -1;
      expect(historyInputCount).toBe(30);

      const rawDepth = await countComparableAttentionSnapshots({
        securityId: gme,
        source: 'apewisdom',
        methodologyVersion: 'apewisdom-2026-09',
        beforeObservedAt: newestObservedAt,
        asOfInstant: newestObservedAt,
      });
      // F06's depth-14 gate counts the true, uncapped total (44) — a different question from the
      // z-score's own bounded window, and the two are expected to diverge past 30.
      expect(rawDepth).toBe(totalSnapshots - 1);
    });
  });

  describe('a methodology-version change suppresses cross-boundary deltas', () => {
    it('renders not_applicable, never a number, once the newest observation crosses a boundary', async () => {
      const gme = await securityId('GME');

      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 5, 6, 100, 90, 500, 24, 'pov_index', 'apewisdom-2026-08', $2, $2, 'seed-old')`,
        [gme, new Date('2026-08-30T00:00:00Z')],
      );
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 3, 5, 140, 100, 700, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'seed-new')`,
        [gme, new Date('2026-08-31T00:00:00Z')],
      );

      const metrics = await computeAttentionMetrics({
        securityId: gme,
        symbol: 'GME',
        configVersion,
        now: new Date('2026-08-31T00:00:00Z'),
      });

      expect(metrics?.rankChange.eligibility).toBe('not_applicable');
      expect(metrics?.rankChange.result).toBeNull();
      expect(metrics?.rankChange.abstention?.reason).toBe('methodology_version_boundary');

      // Lane-review finding 4: `attention.mention_delta`/`mention_growth` have no boundary
      // awareness of their own — before the fix this rendered "+40" (140 - 100) on the exact row
      // where Δ Rank correctly abstained. F08 §4.2 makes suppressing this explicitly this
      // feature's job, not F06's.
      expect(metrics?.mentionDelta).toBeNull();
      expect(metrics?.mentionGrowth).toBeNull();
      expect(metrics?.isMethodologyBoundary).toBe(true);

      // The history itself is unaffected — both rows still exist, just not treated as comparable.
      const history = await attentionSnapshotHistory({ securityId: gme, source: 'apewisdom', asOfInstant: new Date('2026-08-31T00:00:00Z') });
      expect(history).toHaveLength(2);
    });
  });

  // Lane-review finding 5: `asOf` must be the actual compute-time instant, not the snapshot's own
  // `observedAt` — otherwise `asOf − freshest input observedAt` is identically zero and
  // `eligibility: 'stale'` can never fire, no matter how old the data actually is.
  describe('staleness — F08 §4.5 / D-16 (lane-review finding 5)', () => {
    it('the freshly-computed artifact reflects the real gap between "now" and the observation, not a permanently-zero one', async () => {
      const gme = await securityId('GME');
      const observedAt = new Date('2026-08-30T00:00:00Z');

      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 5, 6, 100, 90, 500, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'seed-stale')`,
        [gme, observedAt],
      );

      // `attention.rank_change`'s registered `stalenessMinutes` is 360 (six hours). Computed
      // promptly, in a process that has never seen this observation before, the artifact is `ok`.
      const promptMetrics = await computeAttentionMetrics({
        securityId: gme,
        symbol: 'GME',
        configVersion,
        now: new Date(observedAt.getTime() + 5 * 60_000), // 5 minutes later
      });
      expect(promptMetrics?.rankChange.eligibility).toBe('ok');

      // The actual regression: if `asOf` were pinned to `current.observedAt` (the snapshot's own
      // timestamp) rather than the real compute-time instant, `asOf − freshest input observedAt`
      // is identically zero no matter what `now` is passed in, and `eligibility: 'stale'` could
      // never fire regardless of how old the underlying reading actually is. A distinct security
      // (fresh input_hash, so this does not collide with the row above under
      // `calculation_snapshot_identity_unique`) computed 7 hours after its own `observed_at` —
      // past the 360-minute staleness window — must therefore read `eligibility: 'stale'` here,
      // at the artifact level, independent of `leaderboard.ts`'s own separate read-time check
      // below (lane-review finding 5 regression test: this sub-case did not previously exist and
      // would not have caught the bug, since 5-minutes-later reads `ok` under either `asOf`).
      const aapl = await securityId('AAPL');
      const staleObservedAt = new Date('2026-08-30T00:00:00Z');
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 8, 9, 50, 40, 200, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'seed-stale-aapl')`,
        [aapl, staleObservedAt],
      );
      const laterMetrics = await computeAttentionMetrics({
        securityId: aapl,
        symbol: 'AAPL',
        configVersion,
        now: new Date(staleObservedAt.getTime() + 7 * 60 * 60_000), // 7 hours later
      });
      expect(laterMetrics?.rankChange.eligibility).toBe('stale');
    });

    // `calculation_snapshot_identity_unique` (SPINE's, keyed on `input_hash`, which does not
    // include `asOf`) means a *second* compute call against the identical reading cannot ever
    // persist a fresh `stale` verdict under any id — `compute.ts`'s own doc records this as a
    // genuine, reported limit rather than something silently worked around. This is exactly why
    // `leaderboard.ts` derives staleness a second, independent way, asserted below against the
    // real read path rather than against `compute.ts` alone.
    it('the read path still surfaces staleness at read time, even though the persisted artifact cannot be updated for unchanged data', async () => {
      const redis = inMemoryRedisClient();
      // Anchored to the real clock, with a forward buffer, not a synthetic past date:
      // `insertAttentionSnapshot` defaults `ingested_at` to the real wall clock regardless of
      // what `observed_at` a caller passes, so pinning `observedAt` to an already-old literal
      // would make it un-knowable "as of" a `now` from that same old literal, and pinning it to
      // an *unpadded* `new Date()` races the real instant the insert actually executes — both are
      // F22's as-of guard doing its job, neither is the bug this test means to exercise.
      const observedAt = new Date(Date.now() + 5 * 60_000);

      // A real collection, computed promptly (well inside the six-hour window).
      const collected = await runAttentionCollection({
        providerMode: 'fixture',
        deps: harness().deps,
        redis,
        now: observedAt,
      });
      expect(collected.ok).toBe(true);

      const freshRead = await assembleAttentionLeaderboard({ redis, now: new Date(observedAt.getTime() + 5 * 60_000) });
      expect(freshRead.state).toBe('ok');
      expect(freshRead.rows.every((row) => !row.isStale)).toBe(true);

      // No new collection ever runs again — exactly D-16's "a stopped collector" scenario. A page
      // view ten hours later must still say so, even though nothing in Postgres or Redis changed
      // and the stored `attention.rank_change` artifact itself still reads `eligibility: 'ok'`.
      const staleRead = await assembleAttentionLeaderboard({ redis, now: new Date(observedAt.getTime() + 10 * 60 * 60_000) });
      expect(staleRead.state).toBe('stale');
      expect(staleRead.rows.length).toBeGreaterThan(0);
      expect(staleRead.rows.every((row) => row.isStale)).toBe(true);
      // The number itself is not hidden — a stale value is disclosed, not withheld (product
      // invariant §6.3's neighbouring discipline: abstention is a stated value, not an absence).
      expect(staleRead.rows.find((row) => row.symbol === 'GME')?.rankChange.display).not.toBeNull();
    });

    // Round-8 lane-review finding 3: `pageState` used to derive the page-level `stale` state from
    // `rows.some(row => row.isStale)` — *any single* row aging past the floor. D-30 seeds the
    // universe from ApeWisdom's own top-100 page, and `match.ts` only ever snapshots a name while
    // it is present there, so the moment one security falls off page 1 (routine board churn, not
    // a collector problem), its last snapshot ages past the six-hour floor and stays there
    // permanently — pinning the whole page to `stale` forever even while every other name,
    // including this one's own neighbours, keeps collecting normally. `contract.ts` defines
    // page-level `stale` as a fact about the collection run, not about any one security; this
    // proves a recent collection reads `ok` regardless of how stale one now-untracked row's
    // leftover observation is.
    it('reads ok, not stale, when the collection itself is current even though one security fell off the board long ago', async () => {
      const redis = inMemoryRedisClient();
      const gme = await securityId('GME');
      const aapl = await securityId('AAPL');

      // AAPL: last seen on the board 8 hours ago — well past the 360-minute staleness floor — and
      // never observed again. This is exactly what "fell off ApeWisdom's top 100" looks like: no
      // new row, ever, for this security, while the rest of the universe keeps collecting.
      const aaplObservedAt = new Date(Date.now() - 8 * 60 * 60_000);
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 95, 90, 20, 22, 40, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'aapl-dropped')`,
        [aapl, aaplObservedAt],
      );
      await materializeAttentionMetricsForSecurity({
        securityId: aapl,
        symbol: 'AAPL',
        configVersion,
        db: pool,
        redis,
        now: new Date(aaplObservedAt.getTime() + 5 * 60_000),
      });

      // GME: the collector is healthy and just ran.
      const gmeObservedAt = new Date(Date.now());
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 1, 2, 1500, 1400, 9000, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'gme-fresh')`,
        [gme, gmeObservedAt],
      );
      const now = new Date(gmeObservedAt.getTime() + 2 * 60_000);
      await materializeAttentionMetricsForSecurity({ securityId: gme, symbol: 'GME', configVersion, db: pool, redis, now });

      const read = await assembleAttentionLeaderboard({ redis, db: pool, now });
      const aaplRow = read.rows.find((row) => row.symbol === 'AAPL');
      const gmeRow = read.rows.find((row) => row.symbol === 'GME');
      expect(aaplRow?.isStale).toBe(true);
      expect(gmeRow?.isStale).toBe(false);
      // The bug this test exists to catch: the page-level state must track the collection run's
      // own recency (GME's, and `lastCollectedAt`'s), not get stuck on AAPL's individually-stale
      // row forever.
      expect(read.state).toBe('ok');
    });

    // Round-11 lane-review finding 1: `pageState` checks `degraded` before `collectionStale` and
    // returns on the first match, so a provider outage lasting past the six-hour staleness floor
    // reads `state: 'degraded'`, never `'stale'` — even though every row is by then individually
    // stale too. `notableMoversExcludedForStaleness` must still read true here, computed directly
    // from row staleness rather than from which page state fired.
    it('notableMoversExcludedForStaleness reads true under a degraded state whose rows have also gone stale, not just under state "stale"', async () => {
      const gme = await securityId('GME');
      const redis = inMemoryRedisClient();

      // A real observation, 7 hours old — past the six-hour floor — with a genuine, eligible,
      // large rank change (a local predecessor 30 hours ago).
      const priorObservedAt = new Date(Date.now() - 30 * 60 * 60_000);
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 45, 50, 300, 280, 900, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'gme-degraded-prior')`,
        [gme, priorObservedAt],
      );
      await materializeAttentionMetricsForSecurity({
        securityId: gme,
        symbol: 'GME',
        configVersion,
        db: pool,
        redis,
        now: new Date(priorObservedAt.getTime() + 5 * 60_000),
      });
      const currentObservedAt = new Date(Date.now() - 7 * 60 * 60_000);
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 5, 45, 900, 300, 3000, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'gme-degraded-current')`,
        [gme, currentObservedAt],
      );
      // Materialized promptly (5 minutes after its own observedAt, well inside the staleness
      // floor) so the persisted artifact's own `eligibility` bakes in as `'ok'` — matching the
      // review's own live trace ("a row with a real, eligible Δ Rank of 40"). Reading much later
      // (below) is what makes `isStale` true at read time without touching the frozen artifact —
      // `compute.ts`'s own documented limit on recomputing eligibility for unchanged data.
      await materializeAttentionMetricsForSecurity({
        securityId: gme,
        symbol: 'GME',
        configVersion,
        db: pool,
        redis,
        now: new Date(currentObservedAt.getTime() + 5 * 60_000),
      });
      const now = new Date();

      // The last collector run failed outright — a genuine outage, not merely an old collection.
      await redis.set(KEYS.degraded(), JSON.stringify(true));

      const read = await assembleAttentionLeaderboard({ redis, db: pool, now });
      expect(read.state).toBe('degraded');
      const gmeRow = read.rows.find((row) => row.symbol === 'GME');
      expect(gmeRow?.isStale).toBe(true);
      expect(gmeRow?.rankChange.eligibility).toBe('ok');
      expect(gmeRow?.rankChange.display).not.toBeNull();
      // The row would have qualified for notableMovers but for staleness — selectNotableMovers
      // correctly excludes it either way, but the UI must know *why* the list is empty.
      expect(read.notableMovers).toEqual([]);
      expect(read.notableMoversExcludedForStaleness).toBe(true);
    });

    // Round-14 lane-review finding 2. The test above materializes *promptly* (5 minutes after its
    // own `observedAt`), so the persisted artifact's own `eligibility` bakes in as `'ok'` and only
    // `isStale` (the read-time check) goes true later. A cold-cache recovery is different: no
    // pointer and no prior materialization exist at all, so `buildRow`'s recovery path calls
    // `materializeAttentionMetricsForSecurity` with `now` the *read's own*, already-stale wall
    // clock — `calc/artifact.ts`'s eligibility rule (`args.stale === true ? 'stale' : 'ok'`) then
    // freezes `eligibility: 'stale'` on that very first computation. `hasNotableMoverExcludedFor
    // Staleness` required `eligibility === 'ok'` and so missed exactly this row — the ordinary
    // case while MT-03/Upstash remains unprovisioned — showing "no security clears the notable-
    // mover bar" instead of the accurate staleness explanation on the very first cold read.
    it('notableMoversExcludedForStaleness reads true on the very first, cold-cache-recovery read of an already-stale observation, whose fresh artifact bakes in eligibility "stale" rather than "ok" (lane-review round 14 finding 2)', async () => {
      const gme = await securityId('GME');
      const redis = inMemoryRedisClient();

      // A real observation, 7 hours old — past the six-hour floor — with a genuine, eligible,
      // large rank change against its own bundled `rank_prior`. Never materialized: this
      // simulates a fresh process (no Redis pointer store at all) reading Postgres cold.
      const observedAt = new Date(Date.now() - 7 * 60 * 60_000);
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 5, 45, 900, 300, 3000, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'gme-cold-recovery')`,
        [gme, observedAt],
      );

      const read = await assembleAttentionLeaderboard({ redis, db: pool, now: new Date() });
      // The page itself reads `'stale'` (no collector run has failed; the collection is merely
      // old) — `pageState`'s own precedence, unrelated to what this test is about.
      expect(read.state).toBe('stale');
      const gmeRow = read.rows.find((row) => row.symbol === 'GME');
      expect(gmeRow?.isStale).toBe(true);
      // The frozen artifact — computed for the first time here, at the already-stale `now` — is
      // itself `'stale'`, not `'ok'`: the exact case the eligibility check must not disqualify.
      expect(gmeRow?.rankChange.eligibility).toBe('stale');
      expect(gmeRow?.rankChange.display).not.toBeNull();
      expect(read.notableMovers).toEqual([]);
      expect(read.notableMoversExcludedForStaleness).toBe(true);
    });

    // Round-12 lane-review finding 3: `cachedNotableMovers`'s 30-minute TTL is invalidated only by
    // an actual collector run or mid-read recovery — never merely by time passing. A mover cached
    // while fresh can cross the six-hour staleness floor mid-window and keep being served under
    // "the three largest moves this run" for up to the rest of the TTL, contradicting the very
    // same read's own `row.isStale`/`FreshnessBadge`.
    it('a cached notable mover is dropped once its own row crosses the staleness floor, even with a warm cache', async () => {
      const gme = await securityId('GME');
      const redis = inMemoryRedisClient();

      const priorObservedAt = new Date(Date.now() - 7 * 60 * 60_000);
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 60, 65, 300, 280, 900, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'gme-cache-prior')`,
        [gme, priorObservedAt],
      );
      await materializeAttentionMetricsForSecurity({
        securityId: gme,
        symbol: 'GME',
        configVersion,
        db: pool,
        redis,
        now: new Date(priorObservedAt.getTime() + 5 * 60_000),
      });
      // Observed 5 hours 50 minutes ago — still inside the six-hour floor right now, but it will
      // cross it 10 minutes from now.
      const currentObservedAt = new Date(Date.now() - (5 * 60 + 50) * 60_000);
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 10, 60, 900, 300, 3000, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'gme-cache-current')`,
        [gme, currentObservedAt],
      );
      await materializeAttentionMetricsForSecurity({
        securityId: gme,
        symbol: 'GME',
        configVersion,
        db: pool,
        redis,
        now: new Date(currentObservedAt.getTime() + 5 * 60_000),
      });

      // First read: still fresh, GME is a genuine notable mover, and the 30-minute cache warms.
      const freshRead = await assembleAttentionLeaderboard({ redis, db: pool, now: new Date() });
      expect(freshRead.rows.find((row) => row.symbol === 'GME')?.isStale).toBe(false);
      expect(freshRead.notableMovers.map((m) => m.symbol)).toEqual(['GME']);
      expect(await redis.get(KEYS.notableMovers())).not.toBeNull();

      // Second read, 25 minutes later — the cache (30-minute TTL) is still warm, but GME's own
      // observation has now crossed the six-hour staleness floor.
      const laterNow = new Date(Date.now() + 25 * 60_000);
      const staleRead = await assembleAttentionLeaderboard({ redis, db: pool, now: laterNow });
      expect(staleRead.rows.find((row) => row.symbol === 'GME')?.isStale).toBe(true);
      // The bug this test exists to catch: a warm cache must not keep serving a mover whose own
      // row has since gone stale.
      expect(staleRead.notableMovers).toEqual([]);
      expect(staleRead.notableMoversExcludedForStaleness).toBe(true);
    });

    // Round-13 lane-review finding 1: round 12's own fix filtered the cached blob in place —
    // dropping a now-stale entry without ever letting a genuinely fresh, otherwise-eligible
    // security take the vacated slot. This proves a live mover is not hidden just because a
    // *different* cached mover went stale in the meantime.
    it('a fresh, eligible mover is not hidden by a cache still holding a different, now-stale entry', async () => {
      const gme = await securityId('GME');
      const aapl = await securityId('AAPL');
      const redis = inMemoryRedisClient();

      // GME: will be the sole cached mover, and will cross the staleness floor before the second read.
      const gmePriorAt = new Date(Date.now() - 7 * 60 * 60_000);
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 60, 65, 300, 280, 900, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'gme-vacate-prior')`,
        [gme, gmePriorAt],
      );
      await materializeAttentionMetricsForSecurity({
        securityId: gme,
        symbol: 'GME',
        configVersion,
        db: pool,
        redis,
        now: new Date(gmePriorAt.getTime() + 5 * 60_000),
      });
      const gmeCurrentAt = new Date(Date.now() - (5 * 60 + 50) * 60_000);
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 10, 60, 900, 300, 3000, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'gme-vacate-current')`,
        [gme, gmeCurrentAt],
      );
      await materializeAttentionMetricsForSecurity({
        securityId: gme,
        symbol: 'GME',
        configVersion,
        db: pool,
        redis,
        now: new Date(gmeCurrentAt.getTime() + 5 * 60_000),
      });

      // First read: only GME qualifies (AAPL has no history yet), cache warms with ['GME'].
      const firstRead = await assembleAttentionLeaderboard({ redis, db: pool, now: new Date() });
      expect(firstRead.notableMovers.map((m) => m.symbol)).toEqual(['GME']);

      // AAPL now gets a real, eligible, large rank change — inserted *after* the cache warmed.
      const aaplPriorAt = new Date(Date.now() - 60 * 60_000);
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 50, 55, 200, 190, 700, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'aapl-vacate-prior')`,
        [aapl, aaplPriorAt],
      );
      await materializeAttentionMetricsForSecurity({
        securityId: aapl,
        symbol: 'AAPL',
        configVersion,
        db: pool,
        redis,
        now: new Date(aaplPriorAt.getTime() + 5 * 60_000),
      });
      const aaplCurrentAt = new Date();
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 5, 50, 800, 200, 4000, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'aapl-vacate-current')`,
        [aapl, aaplCurrentAt],
      );
      await materializeAttentionMetricsForSecurity({
        securityId: aapl,
        symbol: 'AAPL',
        configVersion,
        db: pool,
        redis,
        now: new Date(aaplCurrentAt.getTime() + 5 * 60_000),
      });

      // Second read, 25 minutes later: GME has crossed the floor, AAPL is fresh and eligible.
      const laterNow = new Date(Date.now() + 25 * 60_000);
      const laterRead = await assembleAttentionLeaderboard({ redis, db: pool, now: laterNow });
      expect(laterRead.rows.find((row) => row.symbol === 'GME')?.isStale).toBe(true);
      expect(laterRead.rows.find((row) => row.symbol === 'AAPL')?.isStale).toBe(false);
      // The bug this test exists to catch: AAPL must not stay hidden just because GME, a
      // different cached entry, is the one that went stale.
      expect(laterRead.notableMovers.map((m) => m.symbol)).toEqual(['AAPL']);
    });

    // Round-15 lane-review finding 2. `pipeline.ts` invalidates this cache with one `redis.del`
    // issued after its whole per-security materialization loop finishes. An interruption strictly
    // after the last security's own materialization call leaves every pointer fresh — so
    // `buildRow`'s own recovery never fires, and this cache's `del` never runs either — while the
    // cache still holds the *previous* run's mover for that security. `isStale === false` alone
    // cannot catch this: the row is present and fresh, just a different fresh reading than the one
    // the cache described. Simulated here by materializing a second, sharply different observation
    // directly (as `runAttentionCollection`'s own materialize loop would) and never calling the
    // `notableMovers` cache's own `redis.del` — the exact state a post-loop interruption leaves.
    it('a cached notable mover with a fresh but superseded calculationId is recomputed, never rendered with a real-but-disagreeing calculation_id (lane-review round 15 finding 2)', async () => {
      const gme = await securityId('GME');
      const redis = inMemoryRedisClient();

      const firstObservedAt = new Date(Date.now() - 60 * 60_000);
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 45, 50, 300, 280, 900, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'gme-cache-stale-first')`,
        [gme, firstObservedAt],
      );
      await materializeAttentionMetricsForSecurity({
        securityId: gme,
        symbol: 'GME',
        configVersion,
        db: pool,
        redis,
        now: new Date(firstObservedAt.getTime() + 5 * 60_000),
      });
      // Warms the notable-movers cache with GME's first-observation mover.
      const firstRead = await assembleAttentionLeaderboard({
        redis,
        db: pool,
        now: new Date(firstObservedAt.getTime() + 5 * 60_000),
      });
      const cachedMover = firstRead.notableMovers.find((mover) => mover.symbol === 'GME');
      expect(cachedMover).toBeDefined();
      const staleCalculationId = cachedMover?.rankChange.calculationId;

      // A second, much sharper observation lands and is fully materialized — exactly what
      // `runAttentionCollection`'s per-security loop does — but the cache's own `redis.del`
      // (issued only after that whole loop finishes) is simulated as never having fired.
      const secondObservedAt = new Date(Date.now() - 5 * 60_000);
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 5, 45, 900, 300, 3000, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'gme-cache-stale-second')`,
        [gme, secondObservedAt],
      );
      const freshMetrics = await materializeAttentionMetricsForSecurity({
        securityId: gme,
        symbol: 'GME',
        configVersion,
        db: pool,
        redis,
        now: new Date(secondObservedAt.getTime() + 5 * 60_000),
      });
      expect(freshMetrics?.rankChange.calculationId).not.toBe(staleCalculationId);

      const secondRead = await assembleAttentionLeaderboard({
        redis,
        db: pool,
        now: new Date(secondObservedAt.getTime() + 5 * 60_000),
      });
      const gmeRow = secondRead.rows.find((row) => row.symbol === 'GME');
      expect(gmeRow?.isStale).toBe(false);
      expect(gmeRow?.rankChange.calculationId).toBe(freshMetrics?.rankChange.calculationId);

      // The mover card must carry the fresh reading's own calculationId — never the stale cache's,
      // even though that cached entry's row is present and not itself flagged `isStale`.
      const gmeMover = secondRead.notableMovers.find((mover) => mover.symbol === 'GME');
      expect(gmeMover).toBeDefined();
      expect(gmeMover?.rankChange.calculationId).toBe(freshMetrics?.rankChange.calculationId);
      expect(gmeMover?.rankChange.calculationId).not.toBe(staleCalculationId);
    });

    // Round-16 lane-review finding 1. `parsed.every(...)` on an empty cached array is vacuously
    // `true`, so a cache warmed while nothing yet clears the notable-mover bar is trusted forever
    // (up to the TTL) even after a later, genuinely eligible security appears — the same
    // interruption class round 15 finding 2 fixed (a run dying strictly after the last security's
    // own materialization, before the cache's own invalidating `redis.del`) leaves an empty `"[]"`
    // in place instead of a superseded non-empty one, and the round-15 fix's `.every` check on
    // cache *members* has no member to apply itself to.
    it('an empty cached notable-movers list is never trusted once a security has become genuinely eligible (lane-review round 16 finding 1)', async () => {
      const gme = await securityId('GME');
      const redis = inMemoryRedisClient();

      // First observation: thin-sample (below the 5-mention floor), so `selectNotableMovers`
      // excludes it regardless of rank-change magnitude — the read below caches an empty list.
      const firstObservedAt = new Date(Date.now() - 60 * 60_000);
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 45, 90, 3, 3, 20, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'gme-empty-cache-first')`,
        [gme, firstObservedAt],
      );
      await materializeAttentionMetricsForSecurity({
        securityId: gme,
        symbol: 'GME',
        configVersion,
        db: pool,
        redis,
        now: new Date(firstObservedAt.getTime() + 5 * 60_000),
      });
      const firstRead = await assembleAttentionLeaderboard({
        redis,
        db: pool,
        now: new Date(firstObservedAt.getTime() + 5 * 60_000),
      });
      expect(firstRead.notableMovers).toEqual([]);
      expect(await redis.get(KEYS.notableMovers())).toBe('[]');

      // A second, genuinely eligible observation lands and is fully materialized — exactly what
      // `runAttentionCollection`'s per-security loop does — but the cache's own `redis.del`
      // (issued only after that whole loop finishes) is simulated as never having fired.
      const secondObservedAt = new Date(Date.now() - 5 * 60_000);
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 5, 45, 900, 3, 3000, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'gme-empty-cache-second')`,
        [gme, secondObservedAt],
      );
      const freshMetrics = await materializeAttentionMetricsForSecurity({
        securityId: gme,
        symbol: 'GME',
        configVersion,
        db: pool,
        redis,
        now: new Date(secondObservedAt.getTime() + 5 * 60_000),
      });

      const secondRead = await assembleAttentionLeaderboard({
        redis,
        db: pool,
        now: new Date(secondObservedAt.getTime() + 5 * 60_000),
      });
      const gmeRow = secondRead.rows.find((row) => row.symbol === 'GME');
      expect(gmeRow?.isThinSample).toBe(false);
      expect(gmeRow?.rankChange.eligibility).toBe('ok');

      // The stale empty cache must not be trusted: GME now genuinely clears the bar.
      expect(secondRead.notableMovers).not.toEqual([]);
      const gmeMover = secondRead.notableMovers.find((mover) => mover.symbol === 'GME');
      expect(gmeMover).toBeDefined();
      expect(gmeMover?.rankChange.calculationId).toBe(freshMetrics?.rankChange.calculationId);
    });

    // Round-34 lane-review finding 1: round 33 added `rankChangeSource`/`observationWindowHours`
    // as required `NotableMoverView` fields, but `cachedNotableMovers`'s own validity check never
    // verified a cached blob actually carries them — a blob written before that change (or by any
    // future schema addition to this cache) would be served with both `undefined`, which
    // `NotableMovers.tsx` renders as a false "this deployment's own comparison" caption and a bare
    // "NaN-hour" window rather than failing loudly. This writes exactly that pre-round-33 shape
    // directly into the cache key, bypassing `selectNotableMovers` entirely, the same way the
    // round-15/16 tests above simulate an interrupted invalidation.
    it('a cached mover missing rankChangeSource/observationWindowHours (a pre-round-33 shape) is never trusted (round-34 lane-review finding 1)', async () => {
      const gme = await securityId('GME');
      const redis = inMemoryRedisClient();

      const observedAt = new Date(Date.now() - 5 * 60_000);
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 5, 45, 900, 300, 3000, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'gme-legacy-cache-shape')`,
        [gme, observedAt],
      );
      const metrics = await materializeAttentionMetricsForSecurity({
        securityId: gme,
        symbol: 'GME',
        configVersion,
        db: pool,
        redis,
        now: new Date(observedAt.getTime() + 5 * 60_000),
      });
      expect(metrics).not.toBeNull();

      // A pre-round-33 cache entry: matches the live row on every field `stillValid` already
      // checked before round 34 (calculationId on both metrics) — isolating the one thing this
      // fix adds: no `rankChangeSource`, no `observationWindowHours`.
      await redis.set(
        KEYS.notableMovers(),
        JSON.stringify([
          {
            securityId: gme,
            symbol: 'GME',
            companyName: 'GameStop Corp.',
            rankChange: { ...metrics?.rankChange.result, calculationId: metrics?.rankChange.calculationId },
            mentionDelta:
              metrics?.mentionDelta === null
                ? null
                : { ...metrics?.mentionDelta.result, calculationId: metrics?.mentionDelta.calculationId },
          },
        ]),
      );

      const read = await assembleAttentionLeaderboard({ redis, db: pool, now: new Date(observedAt.getTime() + 5 * 60_000) });
      const gmeMover = read.notableMovers.find((mover) => mover.symbol === 'GME');
      expect(gmeMover).toBeDefined();
      expect(gmeMover?.rankChangeSource).toBeDefined();
      expect(gmeMover?.observationWindowHours).toBeDefined();
      expect(typeof gmeMover?.observationWindowHours).toBe('number');
    });

    // Round-42 lane-review finding 2: `isWarmingUp` is a required `NotableMoverView` field added
    // after round 33's own `rankChangeSource`/`observationWindowHours` — the identical staleness
    // class round 34 already found twice for those two must not recur for this third field. A
    // cached blob that otherwise matches the live row exactly but disagrees on `isWarmingUp` must
    // still be invalidated, never served with the wrong warm-up qualifier.
    it('a cached mover with a stale isWarmingUp value is never trusted (round-42 lane-review finding 2)', async () => {
      const gme = await securityId('GME');
      const redis = inMemoryRedisClient();

      const observedAt = new Date(Date.now() - 5 * 60_000);
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 5, 45, 900, 300, 3000, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'gme-stale-warming-up-cache')`,
        [gme, observedAt],
      );
      await materializeAttentionMetricsForSecurity({
        securityId: gme,
        symbol: 'GME',
        configVersion,
        db: pool,
        redis,
        now: new Date(observedAt.getTime() + 5 * 60_000),
      });

      const firstRead = await assembleAttentionLeaderboard({ redis, db: pool, now: new Date(observedAt.getTime() + 5 * 60_000) });
      const gmeRow = firstRead.rows.find((r) => r.symbol === 'GME');
      const gmeMoverFromFirstRead = firstRead.notableMovers.find((m) => m.symbol === 'GME');
      expect(gmeRow).toBeDefined();
      expect(gmeMoverFromFirstRead).toBeDefined();
      const trueIsWarmingUp = gmeRow?.historyDepth.comparableSnapshots as number < 14;
      expect(gmeMoverFromFirstRead?.isWarmingUp).toBe(trueIsWarmingUp);

      // A cache entry that agrees with the live row on every other field but flips `isWarmingUp`.
      await redis.set(
        KEYS.notableMovers(),
        JSON.stringify([{ ...gmeMoverFromFirstRead, isWarmingUp: !trueIsWarmingUp }]),
      );

      const secondRead = await assembleAttentionLeaderboard({ redis, db: pool, now: new Date(observedAt.getTime() + 5 * 60_000) });
      const gmeMoverFromSecondRead = secondRead.notableMovers.find((m) => m.symbol === 'GME');
      expect(gmeMoverFromSecondRead).toBeDefined();
      expect(gmeMoverFromSecondRead?.isWarmingUp).toBe(trueIsWarmingUp);
    });

    // Round-13 lane-review finding 1's second hole: a cached mover for a security no longer in
    // `rows` at all (e.g. deactivated) was never removed by round 12's own `isStale`-only filter.
    it('a cached mover for a security no longer active at all is dropped, not just one that went stale', async () => {
      const gme = await securityId('GME');
      const aapl = await securityId('AAPL');
      const redis = inMemoryRedisClient();

      const priorAt = new Date(Date.now() - 60 * 60_000);
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 50, 55, 200, 190, 700, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'gme-deactivate-prior')`,
        [gme, priorAt],
      );
      await materializeAttentionMetricsForSecurity({
        securityId: gme,
        symbol: 'GME',
        configVersion,
        db: pool,
        redis,
        now: new Date(priorAt.getTime() + 5 * 60_000),
      });
      const currentAt = new Date();
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 5, 50, 800, 200, 4000, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'gme-deactivate-current')`,
        [gme, currentAt],
      );
      await materializeAttentionMetricsForSecurity({
        securityId: gme,
        symbol: 'GME',
        configVersion,
        db: pool,
        redis,
        now: new Date(currentAt.getTime() + 5 * 60_000),
      });

      // AAPL: fresh, but below the thin-sample floor, so it stays active and in `rows` after GME
      // is deactivated below without ever itself qualifying as a notable mover — otherwise
      // `rows.length` would reach zero and the unrelated "unavailable" early return would fire
      // before `cachedNotableMovers` is ever called, proving nothing about the cache.
      await pool.query(
        `insert into attention_snapshot
           (security_id, source, rank, rank_prior, mentions, mentions_prior, engagement,
            window_hours, coverage_class, provider_methodology_version, observed_at, ingested_at, raw_hash)
         values ($1, 'apewisdom', 80, 82, 3, 3, 10, 24, 'pov_index', 'apewisdom-2026-09', $2, $2, 'aapl-deactivate-current')`,
        [aapl, currentAt],
      );
      await materializeAttentionMetricsForSecurity({
        securityId: aapl,
        symbol: 'AAPL',
        configVersion,
        db: pool,
        redis,
        now: new Date(currentAt.getTime() + 5 * 60_000),
      });

      const firstRead = await assembleAttentionLeaderboard({ redis, db: pool, now: new Date() });
      expect(firstRead.notableMovers.map((m) => m.symbol)).toEqual(['GME']);

      await pool.query('update security set active = false where id = $1', [gme]);

      const secondRead = await assembleAttentionLeaderboard({ redis, db: pool, now: new Date() });
      expect(secondRead.rows.find((row) => row.symbol === 'GME')).toBeUndefined();
      // The bug this test exists to catch: a mover card with no corresponding table row at all.
      expect(secondRead.notableMovers).toEqual([]);
    });
  });

  // Round-39 lane-review finding 2: round 38's `KEYS.malformedTickers()` clear was placed only in
  // `seedAttentionFresh` — `seedAttentionUnavailable` and `seedAttentionStale` do not build on it
  // and did not clear the key themselves, even though both already clear `KEYS.degradedReason()`
  // for the identical leak class (Redis's in-memory fallback is one singleton per e2e server
  // process, not per-test). A stale `never_collected_malformed` seed earlier in the same process
  // would otherwise render the malformed banner over a state whose own tests assert a genuine
  // cold start or a stale-but-otherwise-ordinary board.
  describe('e2e seed state isolation — round-39 lane-review finding 2', () => {
    it('seedAttentionUnavailable clears a leaked malformedTickers flag', async () => {
      const redis = inMemoryRedisClient();
      await redis.set(KEYS.malformedTickers(), JSON.stringify(['MLFD']));
      await seedAttentionUnavailable(redis);
      expect(await redis.get(KEYS.malformedTickers())).toBeNull();
    });

    it('seedAttentionStale clears a leaked malformedTickers flag', async () => {
      const redis = inMemoryRedisClient();
      await redis.set(KEYS.malformedTickers(), JSON.stringify(['MLFD']));
      await seedAttentionStale(redis);
      expect(await redis.get(KEYS.malformedTickers())).toBeNull();
    });
  });
});
