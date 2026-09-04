import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import {
  insertSentimentSnapshot,
  latestSentimentSnapshot,
  sentimentSnapshotHistory,
  type NewSentimentSnapshot,
} from '../../src/repositories/sentiment';
import { closePool, getPool } from '../../src/repositories/client';

const url = databaseUrl();

/** F09 §4.2's sampled-stance and news axes read `sentiment_snapshot` through this repository. */
describe.skipIf(url === undefined)('sentiment_snapshot repository', () => {
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

  function snapshot(overrides: Partial<NewSentimentSnapshot> = {}): NewSentimentSnapshot {
    return {
      subjectType: 'security',
      subjectId: securityId,
      sourceType: 'sampled_social',
      rawScore: '0.42',
      shrunkScore: '0.30',
      sampleAdequacy: '0.80',
      sampleSize: 40,
      positiveCount: 20,
      neutralCount: 10,
      negativeCount: 8,
      unclearCount: 2,
      methodVersion: 'stance-v1',
      observedAt: new Date('2026-09-01T00:00:00Z'),
      expiresAt: null,
      ...overrides,
    };
  }

  describe('insertSentimentSnapshot', () => {
    it('writes a new row when none exists', async () => {
      const result = await insertSentimentSnapshot(snapshot());
      expect(result.inserted).toBe(true);
      expect(result.snapshot.shrunkScore).toBe('0.30');

      const { rows } = await pool.query('select count(*)::text as count from sentiment_snapshot');
      expect(rows[0]?.count).toBe('1');
    });

    it('is idempotent when the same computation is retried (identical values)', async () => {
      const first = await insertSentimentSnapshot(snapshot());
      const second = await insertSentimentSnapshot(snapshot());

      expect(first.inserted).toBe(true);
      expect(second.inserted).toBe(false);
      expect(second.snapshot.shrunkScore).toBe(first.snapshot.shrunkScore);

      const { rows } = await pool.query('select count(*)::text as count from sentiment_snapshot');
      expect(rows[0]?.count).toBe('1');
    });

    it('is idempotent even when the re-run passes an ingestedAt older than the existing row\'s', async () => {
      const first = await insertSentimentSnapshot(
        snapshot({ ingestedAt: new Date('2020-01-05T00:00:00Z') }),
      );
      const second = await insertSentimentSnapshot(
        snapshot({ ingestedAt: new Date('2020-01-01T00:00:00Z') }),
      );

      expect(first.inserted).toBe(true);
      expect(second.inserted).toBe(false);
    });

    it('a genuine revision (different computed values) writes a successor, not an update', async () => {
      const first = await insertSentimentSnapshot(snapshot({ shrunkScore: '0.30' }));
      const revised = await insertSentimentSnapshot(snapshot({ shrunkScore: '0.55', rawScore: '0.60' }));

      expect(first.inserted).toBe(true);
      expect(revised.inserted).toBe(true);

      const { rows } = await pool.query<{ shrunk_score: string }>(
        'select shrunk_score from sentiment_snapshot order by ingested_at asc',
      );
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ shrunk_score: '0.30' });
      expect(rows[1]).toMatchObject({ shrunk_score: '0.55' });
    });

    it('a revision that only moves the per-bucket counts (scores unchanged) writes a successor, not a no-op (lane-review finding 2)', async () => {
      // A re-classification pass that moves 8 items from "negative" to "unclear" while the
      // headline raw/shrunk scores happen to round the same, and sample_size (the counts' sum)
      // stays the same too — the sum-check constraint (migration 0003) requires the four
      // buckets to always sum to sample_size, so only the *distribution* between buckets
      // changes here. An idempotency check that compares only the five headline fields cannot
      // see this and would misreport it as an identical retry, silently dropping the corrected
      // breakdown.
      // `ingestedAt` pinned explicitly on both inserts — left to default to the real wall
      // clock, this test would pass only until that clock reached its own hardcoded
      // `asOfInstant` below (the same recurring defect flagged repeatedly across this
      // codebase's history: attention.test.ts twice, market.test.ts once, evidence.test.ts once).
      const first = await insertSentimentSnapshot(
        snapshot({
          positiveCount: 20,
          neutralCount: 10,
          negativeCount: 8,
          unclearCount: 2,
          ingestedAt: new Date('2026-09-01T00:00:00Z'),
        }),
      );
      const revised = await insertSentimentSnapshot(
        snapshot({
          positiveCount: 20,
          neutralCount: 12,
          negativeCount: 0,
          unclearCount: 8,
          ingestedAt: new Date('2026-09-01T01:00:00Z'),
        }),
      );

      expect(first.inserted).toBe(true);
      expect(revised.inserted).toBe(true);

      const { rows } = await pool.query<{ negative_count: number; unclear_count: number }>(
        'select negative_count, unclear_count from sentiment_snapshot order by ingested_at asc',
      );
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ negative_count: 8, unclear_count: 2 });
      expect(rows[1]).toMatchObject({ negative_count: 0, unclear_count: 8 });

      const latest = await latestSentimentSnapshot({
        subjectType: 'security',
        subjectId: securityId,
        sourceType: 'sampled_social',
        asOfInstant: new Date('2026-09-02T00:00:00Z'),
      });
      expect(latest).toMatchObject({ negativeCount: 0, unclearCount: 8 });
    });

    it('a revision that only changes expiresAt writes a successor, not a no-op', async () => {
      const first = await insertSentimentSnapshot(snapshot({ expiresAt: null }));
      const revised = await insertSentimentSnapshot(
        snapshot({ expiresAt: new Date('2026-12-01T00:00:00Z') }),
      );

      expect(first.inserted).toBe(true);
      expect(revised.inserted).toBe(true);

      const { rows } = await pool.query('select count(*)::text as count from sentiment_snapshot');
      expect(rows[0]?.count).toBe('2');
    });

    it('does not throw on an idempotent retry when observed_at is in the future (lane-review round 3, finding 2)', async () => {
      // Ordinary clock skew between whatever scored the sample and whatever is retrying the
      // insert — a legitimately future-dated observed_at must not turn a successful idempotent
      // retry into a thrown exception. The read-back this exercises is an identity lookup for a
      // row already known to exist, not a point-in-time query, and must not be bounded at real
      // "now".
      const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const first = await insertSentimentSnapshot(snapshot({ observedAt: future }));
      const second = await insertSentimentSnapshot(snapshot({ observedAt: future }));

      expect(first.inserted).toBe(true);
      expect(second.inserted).toBe(false);
    });

    it('handles a genuine concurrent race gracefully — two inserts sharing an identical ingestedAt', async () => {
      const racedIngestedAt = new Date('2026-09-01T00:00:00Z');
      const input = snapshot({ ingestedAt: racedIngestedAt });

      const [first, second] = await Promise.all([
        insertSentimentSnapshot(input, pool),
        insertSentimentSnapshot(input, pool),
      ]);

      expect([first.inserted, second.inserted].sort()).toEqual([false, true]);
      const { rows } = await pool.query('select count(*)::text as count from sentiment_snapshot');
      expect(rows[0]?.count).toBe('1');
    });
  });

  describe('latestSentimentSnapshot / sentimentSnapshotHistory', () => {
    it('returns null when there is no observation yet', async () => {
      const result = await latestSentimentSnapshot({
        subjectType: 'security',
        subjectId: securityId,
        sourceType: 'sampled_social',
        asOfInstant: new Date('2026-09-01T00:00:00Z'),
      });
      expect(result).toBeNull();
    });

    it('excludes an observation ingested after the as-of instant (F22 §4.2 look-ahead guard)', async () => {
      const cutoff = new Date('2026-09-01T12:00:00Z');
      await insertSentimentSnapshot(
        snapshot({
          observedAt: new Date('2026-09-01T00:00:00Z'),
          ingestedAt: new Date('2026-09-01T01:00:00Z'),
          shrunkScore: '0.30',
        }),
      );
      await insertSentimentSnapshot(
        snapshot({
          observedAt: new Date('2026-09-01T00:00:00Z'),
          ingestedAt: new Date('2026-09-05T00:00:00Z'),
          shrunkScore: '0.90',
        }),
      );

      const asOfCutoff = await latestSentimentSnapshot({
        subjectType: 'security',
        subjectId: securityId,
        sourceType: 'sampled_social',
        asOfInstant: cutoff,
      });
      expect(asOfCutoff?.shrunkScore).toBe('0.30');

      const asOfLater = await latestSentimentSnapshot({
        subjectType: 'security',
        subjectId: securityId,
        sourceType: 'sampled_social',
        asOfInstant: new Date('2026-09-06T00:00:00Z'),
      });
      expect(asOfLater?.shrunkScore).toBe('0.90');
    });

    it('keeps the news and sampled_social axes apart', async () => {
      await insertSentimentSnapshot(
        snapshot({ sourceType: 'sampled_social', shrunkScore: '0.30', observedAt: new Date('2026-09-01T00:00:00Z'), ingestedAt: new Date('2026-09-01T00:00:00Z') }),
      );
      await insertSentimentSnapshot(
        snapshot({ sourceType: 'news', shrunkScore: '0.70', observedAt: new Date('2026-09-01T00:00:00Z'), ingestedAt: new Date('2026-09-01T00:00:00Z') }),
      );

      const social = await latestSentimentSnapshot({
        subjectType: 'security',
        subjectId: securityId,
        sourceType: 'sampled_social',
        asOfInstant: new Date('2026-09-02T00:00:00Z'),
      });
      const news = await latestSentimentSnapshot({
        subjectType: 'security',
        subjectId: securityId,
        sourceType: 'news',
        asOfInstant: new Date('2026-09-02T00:00:00Z'),
      });
      expect(social?.shrunkScore).toBe('0.30');
      expect(news?.shrunkScore).toBe('0.70');
    });

    it('filters to one method version when asked, and does not when not asked', async () => {
      await insertSentimentSnapshot(
        snapshot({
          observedAt: new Date('2026-09-01T00:00:00Z'),
          ingestedAt: new Date('2026-09-01T00:00:00Z'),
          methodVersion: 'stance-v1',
          shrunkScore: '0.30',
        }),
      );
      await insertSentimentSnapshot(
        snapshot({
          observedAt: new Date('2026-09-02T00:00:00Z'),
          ingestedAt: new Date('2026-09-02T00:00:00Z'),
          methodVersion: 'stance-v2',
          shrunkScore: '0.55',
        }),
      );

      const filtered = await sentimentSnapshotHistory({
        subjectType: 'security',
        subjectId: securityId,
        sourceType: 'sampled_social',
        methodVersion: 'stance-v2',
        asOfInstant: new Date('2026-09-03T00:00:00Z'),
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.shrunkScore).toBe('0.55');

      const unfiltered = await sentimentSnapshotHistory({
        subjectType: 'security',
        subjectId: securityId,
        sourceType: 'sampled_social',
        asOfInstant: new Date('2026-09-03T00:00:00Z'),
      });
      expect(unfiltered).toHaveLength(2);
    });
  });
});
