import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import {
  attentionSnapshotHistory,
  countComparableAttentionSnapshots,
  insertAttentionSnapshot,
  latestAttentionSnapshot,
  type NewAttentionSnapshot,
} from '../../src/repositories/attention';
import { closePool, getPool } from '../../src/repositories/client';

const url = databaseUrl();

/**
 * F08 §4.1: "Persists an `attention_snapshot` per active symbol per run ... Idempotent per
 * `(security_id, observed_at)`." F06 §4.1: the z-score is hidden below 14 *comparable*
 * snapshots. Both rest on the repository layer built here.
 */
describe.skipIf(url === undefined)('attention_snapshot repository', () => {
  let pool: pg.Pool;
  let securityId: string;
  let otherSecurityId: string;

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

    const { rows: otherRows } = await pool.query<{ id: string }>(
      `insert into security (symbol, name, exchange, asset_type, currency)
       values ('AMC', 'AMC Entertainment', 'NYSE', 'equity', 'USD') returning id`,
    );
    otherSecurityId = otherRows[0]?.id as string;
  });

  afterAll(async () => {
    await closePool();
    await pool?.end();
  });

  function snapshot(overrides: Partial<NewAttentionSnapshot> = {}): NewAttentionSnapshot {
    return {
      securityId,
      source: 'apewisdom',
      rank: 3,
      rankPrior: 5,
      mentions: 120,
      mentionsPrior: 90,
      engagement: 4500,
      windowHours: 24,
      coverageClass: 'pov_index',
      providerMethodologyVersion: 'apewisdom-2026-08',
      observedAt: new Date('2026-09-01T00:00:00Z'),
      rawHash: 'hash-1',
      ...overrides,
    };
  }

  describe('insertAttentionSnapshot', () => {
    it('writes a new row when none exists', async () => {
      const result = await insertAttentionSnapshot(snapshot());
      expect(result.inserted).toBe(true);
      expect(result.snapshot.mentions).toBe(120);
      expect(result.snapshot.securityId).toBe(securityId);

      const { rows } = await pool.query('select count(*)::text as count from attention_snapshot');
      expect(rows[0]?.count).toBe('1');
    });

    it('is idempotent on a repeated observation — F08 §7 review step 3', async () => {
      const first = await insertAttentionSnapshot(snapshot());
      const second = await insertAttentionSnapshot(snapshot());

      expect(first.inserted).toBe(true);
      expect(second.inserted).toBe(false);
      expect(second.snapshot.rawHash).toBe(first.snapshot.rawHash);

      const { rows } = await pool.query('select count(*)::text as count from attention_snapshot');
      expect(rows[0]?.count).toBe('1');
    });

    it('is idempotent even when the re-run passes an ingestedAt older than the existing row\'s', async () => {
      // Round-1 lane-review: the read-back after a detected duplicate used to bound itself at
      // the *re-run's own* `ingestedAt`, not at the actual current instant. The existing row
      // (already committed, so always knowable "as of now") then fell outside that bound
      // whenever the re-run's `ingestedAt` was older than the row it was about to find — not a
      // contrived case, since it is exactly what a backfill-style reprocessing pass or two
      // out-of-order collector retries produce. The old code threw
      // "attention_snapshot insert reported an existing duplicate but the row could not be read
      // back" here; this must return the existing row instead.
      // Both dates are safely in the past relative to whenever this suite actually runs — the
      // bug this reproduces is about the *relationship* between the two calls' `ingestedAt`
      // values, not about either being in the future, which would be a different (and invalid)
      // scenario: a row cannot really be ingested before it is written.
      const first = await insertAttentionSnapshot(
        snapshot({ ingestedAt: new Date('2020-01-05T00:00:00Z') }),
      );
      const second = await insertAttentionSnapshot(
        snapshot({ ingestedAt: new Date('2020-01-01T00:00:00Z') }),
      );

      expect(first.inserted).toBe(true);
      expect(second.inserted).toBe(false);
      expect(second.snapshot.rawHash).toBe(first.snapshot.rawHash);
    });

    it('inserts a successor rather than overwriting when the observation is revised', async () => {
      const first = await insertAttentionSnapshot(snapshot({ rawHash: 'hash-1' }));
      const revised = await insertAttentionSnapshot(
        snapshot({ rawHash: 'hash-2', mentions: 250 }),
      );

      expect(first.inserted).toBe(true);
      expect(revised.inserted).toBe(true);
      expect(revised.snapshot.mentions).toBe(250);

      const { rows } = await pool.query<{ raw_hash: string; mentions: number }>(
        'select raw_hash, mentions from attention_snapshot order by ingested_at asc',
      );
      expect(rows).toHaveLength(2);
      // The original row is untouched — a revision writes a successor, it does not update
      // (MEMORY.md B-08, B-11, B-12).
      expect(rows[0]).toMatchObject({ raw_hash: 'hash-1', mentions: 120 });
      expect(rows[1]).toMatchObject({ raw_hash: 'hash-2', mentions: 250 });
    });

    it('treats two different sources at the same observed_at as distinct observations', async () => {
      await insertAttentionSnapshot(snapshot({ source: 'apewisdom', rawHash: 'a' }));
      const second = await insertAttentionSnapshot(snapshot({ source: 'reddit', rawHash: 'b' }));

      expect(second.inserted).toBe(true);
      const { rows } = await pool.query('select count(*)::text as count from attention_snapshot');
      expect(rows[0]?.count).toBe('2');
    });

    it('round-trips a security new to the board — rank, rankPrior, mentionsPrior and engagement all null', async () => {
      // F06 §4.1's `NEW` case and F08 §4.4's off-board case: a security absent from the prior
      // observation (or the provider not reporting engagement at all) is `null`, not zero or a
      // fabricated placeholder — all four columns are nullable in migration 0002 and in the zod
      // contract, and nothing else in this repository's own test suite exercised the null path
      // before this (round-1 lane-review).
      //
      // `ingestedAt` pinned explicitly — round-1's own fix for this exact defect elsewhere in
      // this file (a defaulted `ingestedAt` racing a hardcoded future `asOfInstant`) was missed
      // on this test when it was added, and round 2 found it: this test would start failing the
      // moment the real wall clock passed `asOfInstant` below.
      const result = await insertAttentionSnapshot(
        snapshot({
          ingestedAt: new Date('2026-09-01T00:00:00Z'),
          rank: null,
          rankPrior: null,
          mentionsPrior: null,
          engagement: null,
        }),
      );
      expect(result.snapshot).toMatchObject({
        rank: null,
        rankPrior: null,
        mentionsPrior: null,
        engagement: null,
      });

      const readBack = await latestAttentionSnapshot({
        securityId,
        source: 'apewisdom',
        asOfInstant: new Date('2026-09-02T00:00:00Z'),
      });
      expect(readBack).toMatchObject({ rank: null, rankPrior: null, mentionsPrior: null, engagement: null });
    });
  });

  describe('latestAttentionSnapshot / attentionSnapshotHistory', () => {
    it('returns null when there is no observation yet', async () => {
      const result = await latestAttentionSnapshot({
        securityId,
        source: 'apewisdom',
        asOfInstant: new Date('2026-09-01T00:00:00Z'),
      });
      expect(result).toBeNull();
    });

    it('returns the most recent observation as of the given instant', async () => {
      // `ingestedAt` pinned explicitly, not left to default to the real wall clock: this test
      // reads at a fixed `asOfInstant` in the past relative to when the suite runs today, and a
      // defaulted `ingestedAt` would eventually land after that bound and silently exclude the
      // row (round-1 lane-review: this exact test broke this way under a simulated future date).
      await insertAttentionSnapshot(
        snapshot({
          observedAt: new Date('2026-09-01T00:00:00Z'),
          ingestedAt: new Date('2026-09-01T00:00:00Z'),
          rawHash: 'd1',
          mentions: 100,
        }),
      );
      await insertAttentionSnapshot(
        snapshot({
          observedAt: new Date('2026-09-02T00:00:00Z'),
          ingestedAt: new Date('2026-09-02T00:00:00Z'),
          rawHash: 'd2',
          mentions: 140,
        }),
      );

      const latest = await latestAttentionSnapshot({
        securityId,
        source: 'apewisdom',
        asOfInstant: new Date('2026-09-03T00:00:00Z'),
      });
      expect(latest?.mentions).toBe(140);
    });

    it('excludes an observation ingested after the as-of instant (F22 §4.2 look-ahead guard)', async () => {
      const cutoff = new Date('2026-09-01T12:00:00Z');
      await insertAttentionSnapshot(
        snapshot({
          observedAt: new Date('2026-09-01T00:00:00Z'),
          ingestedAt: new Date('2026-09-01T01:00:00Z'),
          rawHash: 'known-then',
          mentions: 100,
        }),
      );
      // A correction learned after the cutoff — knowable now, not knowable as of `cutoff`.
      await insertAttentionSnapshot(
        snapshot({
          observedAt: new Date('2026-09-01T00:00:00Z'),
          ingestedAt: new Date('2026-09-05T00:00:00Z'),
          rawHash: 'learned-later',
          mentions: 999,
        }),
      );

      const asOfCutoff = await latestAttentionSnapshot({
        securityId,
        source: 'apewisdom',
        asOfInstant: cutoff,
      });
      expect(asOfCutoff?.mentions).toBe(100);

      const asOfLater = await latestAttentionSnapshot({
        securityId,
        source: 'apewisdom',
        asOfInstant: new Date('2026-09-06T00:00:00Z'),
      });
      expect(asOfLater?.mentions).toBe(999);
    });

    it('collapses a corrected observation to one row per observed_at in the history series', async () => {
      // `ingestedAt` pinned explicitly on every insert — round-1 lane-review found the un-pinned
      // version of this test broke once real wall-clock time passed its hardcoded `asOfInstant`.
      await insertAttentionSnapshot(
        snapshot({
          observedAt: new Date('2026-09-01T00:00:00Z'),
          ingestedAt: new Date('2026-09-01T00:00:00Z'),
          rawHash: 'a',
          mentions: 10,
        }),
      );
      await insertAttentionSnapshot(
        snapshot({
          observedAt: new Date('2026-09-02T00:00:00Z'),
          ingestedAt: new Date('2026-09-02T00:00:00Z'),
          rawHash: 'b',
          mentions: 20,
        }),
      );
      // A revision of the first observation, landing after the second was already recorded.
      await insertAttentionSnapshot(
        snapshot({
          observedAt: new Date('2026-09-01T00:00:00Z'),
          ingestedAt: new Date('2026-09-03T00:00:00Z'),
          rawHash: 'a-corrected',
          mentions: 15,
        }),
      );

      const history = await attentionSnapshotHistory({
        securityId,
        source: 'apewisdom',
        asOfInstant: new Date('2026-09-04T00:00:00Z'),
      });

      expect(history).toHaveLength(2);
      expect(history.map((row) => row.mentions).sort((a, b) => a - b)).toEqual([15, 20]);
    });

    it('filters to one provider methodology version when asked, and does not when not asked', async () => {
      // Round-1 lane-review: this function's docstring claimed to serve F06's comparable
      // history window, but the query did not filter by methodology at all — a caller reading
      // the docstring and trusting it got a series silently mixing two methodologies.
      await insertAttentionSnapshot(
        snapshot({
          observedAt: new Date('2026-09-01T00:00:00Z'),
          ingestedAt: new Date('2026-09-01T00:00:00Z'),
          rawHash: 'old-methodology',
          providerMethodologyVersion: 'apewisdom-2026-08',
          mentions: 10,
        }),
      );
      await insertAttentionSnapshot(
        snapshot({
          observedAt: new Date('2026-09-02T00:00:00Z'),
          ingestedAt: new Date('2026-09-02T00:00:00Z'),
          rawHash: 'new-methodology',
          providerMethodologyVersion: 'apewisdom-2026-09',
          mentions: 20,
        }),
      );

      const filtered = await attentionSnapshotHistory({
        securityId,
        source: 'apewisdom',
        methodologyVersion: 'apewisdom-2026-09',
        asOfInstant: new Date('2026-09-03T00:00:00Z'),
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.mentions).toBe(20);

      const unfiltered = await attentionSnapshotHistory({
        securityId,
        source: 'apewisdom',
        asOfInstant: new Date('2026-09-03T00:00:00Z'),
      });
      expect(unfiltered).toHaveLength(2);
    });

    it('scopes to one security and does not leak another security’s history', async () => {
      const observedAt = new Date('2026-09-01T00:00:00Z');
      await insertAttentionSnapshot(snapshot({ securityId, observedAt, ingestedAt: observedAt, rawHash: 'mine' }));
      await insertAttentionSnapshot(
        snapshot({ securityId: otherSecurityId, observedAt, ingestedAt: observedAt, rawHash: 'theirs' }),
      );

      const history = await attentionSnapshotHistory({
        securityId,
        source: 'apewisdom',
        asOfInstant: new Date('2026-09-03T00:00:00Z'),
      });
      expect(history).toHaveLength(1);
      expect(history[0]?.rawHash).toBe('mine');
    });
  });

  describe('countComparableAttentionSnapshots', () => {
    // `ingestedAt` is set explicitly to the same fictional day as `observedAt` rather than
    // left to default to the real wall clock: these tests bound reads with an `asOfInstant`
    // in August 2026, and a defaulted `ingestedAt` of "whenever this test actually runs" would
    // fail that bound (or pass it vacuously) depending on the date the suite happens to run on.
    async function seedDaily(count: number, methodologyVersion: string, startDay = 1) {
      for (let day = 0; day < count; day += 1) {
        const observedAt = new Date(Date.UTC(2026, 7, startDay + day));
        await insertAttentionSnapshot(
          snapshot({
            observedAt,
            ingestedAt: observedAt,
            rawHash: `${methodologyVersion}-${startDay + day}`,
            providerMethodologyVersion: methodologyVersion,
          }),
        );
      }
    }

    it('is 0 with no history', async () => {
      const count = await countComparableAttentionSnapshots({
        securityId,
        source: 'apewisdom',
        methodologyVersion: 'apewisdom-2026-08',
        beforeObservedAt: new Date('2026-09-01T00:00:00Z'),
        asOfInstant: new Date('2026-09-01T00:00:00Z'),
      });
      expect(count).toBe(0);
    });

    it('counts distinct observed_at values, not physical rows', async () => {
      await seedDaily(3, 'apewisdom-2026-08');
      // A correction of one of the three days — must not double-count.
      await insertAttentionSnapshot(
        snapshot({
          observedAt: new Date(Date.UTC(2026, 7, 1)),
          ingestedAt: new Date(Date.UTC(2026, 7, 10)),
          rawHash: 'apewisdom-2026-08-1-corrected',
          providerMethodologyVersion: 'apewisdom-2026-08',
        }),
      );

      const count = await countComparableAttentionSnapshots({
        securityId,
        source: 'apewisdom',
        methodologyVersion: 'apewisdom-2026-08',
        beforeObservedAt: new Date(Date.UTC(2026, 7, 4)),
        asOfInstant: new Date(Date.UTC(2026, 7, 11)),
      });
      expect(count).toBe(3);
    });

    it('reaches the F06 §4.1 threshold of 14 comparable snapshots', async () => {
      await seedDaily(14, 'apewisdom-2026-08');

      const count = await countComparableAttentionSnapshots({
        securityId,
        source: 'apewisdom',
        methodologyVersion: 'apewisdom-2026-08',
        beforeObservedAt: new Date(Date.UTC(2026, 7, 15)),
        asOfInstant: new Date(Date.UTC(2026, 7, 15)),
      });
      expect(count).toBe(14);
    });

    it('excludes snapshots on the far side of a methodology-version boundary', async () => {
      await seedDaily(10, 'apewisdom-2026-08', 1);
      await seedDaily(10, 'apewisdom-2026-09', 11);

      const count = await countComparableAttentionSnapshots({
        securityId,
        source: 'apewisdom',
        // The reference snapshot is on the NEW methodology.
        methodologyVersion: 'apewisdom-2026-09',
        beforeObservedAt: new Date(Date.UTC(2026, 7, 21)),
        asOfInstant: new Date(Date.UTC(2026, 7, 21)),
      });
      // Only the 10 snapshots already on the new methodology (days 11–20) are comparable —
      // the 10 pre-boundary snapshots exist but must not inflate the depth count.
      expect(count).toBe(10);
    });

    it('excludes a different source from the count', async () => {
      await seedDaily(5, 'apewisdom-2026-08');
      // On its own `observed_at`, distinct from every seeded apewisdom day (round-2
      // lane-review): the first version of this row shared `observed_at` with the day-1
      // apewisdom row, so `attentionSnapshotHistory`'s `distinct on (observed_at)` collapse
      // swallowed one of the two regardless of the `source` predicate — the count stayed 5
      // whether or not `and source = $3` was deleted from the implementation, which is exactly
      // as vacuous as the as-of-bound version round 1 found. A day with no apewisdom row at all
      // (day 6) means this row can only be excluded by the source filter, not by the collapse.
      const reddit = new Date(Date.UTC(2026, 7, 6));
      await insertAttentionSnapshot(
        snapshot({
          source: 'reddit',
          observedAt: reddit,
          ingestedAt: reddit,
          rawHash: 'reddit-1',
          providerMethodologyVersion: 'apewisdom-2026-08',
        }),
      );

      const count = await countComparableAttentionSnapshots({
        securityId,
        source: 'apewisdom',
        methodologyVersion: 'apewisdom-2026-08',
        beforeObservedAt: new Date(Date.UTC(2026, 7, 10)),
        asOfInstant: new Date(Date.UTC(2026, 7, 10)),
      });
      expect(count).toBe(5);
    });

    it('respects the as-of bound — a not-yet-knowable snapshot does not count', async () => {
      await seedDaily(5, 'apewisdom-2026-08');
      // A 6th snapshot exists in the table but was not ingested until later.
      await insertAttentionSnapshot(
        snapshot({
          observedAt: new Date(Date.UTC(2026, 7, 6)),
          ingestedAt: new Date(Date.UTC(2026, 7, 20)),
          rawHash: 'apewisdom-2026-08-6',
          providerMethodologyVersion: 'apewisdom-2026-08',
        }),
      );

      const count = await countComparableAttentionSnapshots({
        securityId,
        source: 'apewisdom',
        methodologyVersion: 'apewisdom-2026-08',
        beforeObservedAt: new Date(Date.UTC(2026, 7, 10)),
        asOfInstant: new Date(Date.UTC(2026, 7, 7)),
      });
      expect(count).toBe(5);
    });
  });
});
