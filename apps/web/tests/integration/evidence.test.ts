import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import {
  CANDIDATE_SCAN_LIMIT,
  dedupeKeyOf,
  evidenceForSecurity,
  insertEvidenceItem,
  type NewEvidenceItem,
} from '../../src/repositories/evidence';
import { closePool, getPool } from '../../src/repositories/client';

const url = databaseUrl();

/**
 * F09 §4.3 — the evidence drawer reads through this repository, entirely from stored data
 * (F09 DoD item 1). See `evidence.ts`'s module docstring for two things this suite deliberately
 * does NOT claim: a real concurrent-duplicate guarantee (the schema has no unique constraint to
 * arbitrate one), and a stored `dedupeKey` column (it is derived at read time).
 */
describe.skipIf(url === undefined)('evidence_item repository', () => {
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

  function item(overrides: Partial<NewEvidenceItem> = {}): NewEvidenceItem {
    return {
      securityId,
      evidenceType: 'news',
      provider: 'marketaux',
      title: 'GameStop rallies on retail interest',
      snippet: 'Shares of GameStop rose sharply amid renewed retail attention.',
      sourceUrl: 'https://example.com/gme-rally?utm_source=feed',
      publisher: 'Example Wire',
      authorRef: null,
      stanceLabel: 'bullish',
      stanceScore: '0.62',
      relevanceScore: '0.90',
      publishedAt: new Date('2026-09-01T00:00:00Z'),
      availableAt: new Date('2026-09-01T00:05:00Z'),
      lastCheckedAt: null,
      availability: 'available',
      licenseClass: 'snippet',
      coverageClass: 'sample',
      rawHash: 'hash-1',
      metadata: {},
      ...overrides,
    };
  }

  describe('insertEvidenceItem', () => {
    it('writes a new row when none exists', async () => {
      const result = await insertEvidenceItem(item());
      expect(result.inserted).toBe(true);
      expect(result.item.title).toBe('GameStop rallies on retail interest');

      const { rows } = await pool.query('select count(*)::text as count from evidence_item');
      expect(rows[0]?.count).toBe('1');
    });

    it('is idempotent on a repeated observation (same raw_hash)', async () => {
      const first = await insertEvidenceItem(item());
      const second = await insertEvidenceItem(item());

      expect(first.inserted).toBe(true);
      expect(second.inserted).toBe(false);
      expect(second.item.id).toBe(first.item.id);

      const { rows } = await pool.query('select count(*)::text as count from evidence_item');
      expect(rows[0]?.count).toBe('1');
    });

    it('is idempotent even when the re-run passes an ingestedAt older than the existing row\'s', async () => {
      const first = await insertEvidenceItem(item({ ingestedAt: new Date('2020-01-05T00:00:00Z') }));
      const second = await insertEvidenceItem(item({ ingestedAt: new Date('2020-01-01T00:00:00Z') }));

      expect(first.inserted).toBe(true);
      expect(second.inserted).toBe(false);
      expect(second.item.id).toBe(first.item.id);
    });

    it('a genuine revision (different raw_hash) writes a new row, never an update', async () => {
      const first = await insertEvidenceItem(item({ rawHash: 'hash-1' }));
      const revised = await insertEvidenceItem(
        item({ rawHash: 'hash-2', title: 'GameStop rallies on retail interest (corrected)' }),
      );

      expect(first.inserted).toBe(true);
      expect(revised.inserted).toBe(true);
      expect(revised.item.id).not.toBe(first.item.id);

      const { rows } = await pool.query('select count(*)::text as count from evidence_item');
      expect(rows[0]?.count).toBe('2');
    });

    it('does not misread the same raw_hash shared across two securities as a duplicate (lane-review finding 1)', async () => {
      // A syndicated wire story covering two tickers produces the identical raw payload — and
      // therefore the identical raw_hash — once per ticker it is collected for. Scoping the
      // duplicate check on raw_hash alone would misread the second insert as a repeat of the
      // first and silently drop it.
      const { rows } = await pool.query<{ id: string }>(
        `insert into security (symbol, name, exchange, asset_type, currency)
         values ('AMC', 'AMC Entertainment', 'NYSE', 'equity', 'USD') returning id`,
      );
      const otherSecurityId = rows[0]?.id as string;

      // `ingestedAt` pinned explicitly on both inserts — left to default to the real wall
      // clock, this test would pass only until that clock reached its own hardcoded
      // `asOfInstant` below (the same recurring defect flagged repeatedly across this
      // codebase's history: attention.test.ts twice, market.test.ts once).
      const ingestedAt = new Date('2026-09-01T00:00:00Z');
      const gme = await insertEvidenceItem(
        item({ securityId, rawHash: 'shared-wire-story', title: 'GME and AMC both rally', ingestedAt }),
      );
      const amc = await insertEvidenceItem(
        item({
          securityId: otherSecurityId,
          rawHash: 'shared-wire-story',
          title: 'GME and AMC both rally',
          ingestedAt,
        }),
      );

      expect(gme.inserted).toBe(true);
      expect(amc.inserted).toBe(true);
      expect(amc.item.id).not.toBe(gme.item.id);
      expect(amc.item.securityId).toBe(otherSecurityId);

      const { rows: countRows } = await pool.query(
        'select count(*)::text as count from evidence_item',
      );
      expect(countRows[0]?.count).toBe('2');

      const forAmc = await evidenceForSecurity({
        securityId: otherSecurityId,
        asOfInstant: new Date('2026-09-02T00:00:00Z'),
      });
      expect(forAmc.scannedCount).toBe(1);
      expect(forAmc.distinctCount).toBe(1);
      expect(forAmc.items).toHaveLength(1);
      expect(forAmc.items[0]?.securityId).toBe(otherSecurityId);
    });

    it('is idempotent per (security_id, provider, raw_hash), not raw_hash alone', async () => {
      const first = await insertEvidenceItem(item({ rawHash: 'same-hash' }));
      const second = await insertEvidenceItem(item({ rawHash: 'same-hash' }));

      expect(first.inserted).toBe(true);
      expect(second.inserted).toBe(false);
      expect(second.item.id).toBe(first.item.id);
    });

    it('is idempotent for a macro item with a null security_id (lane-review round 2, finding 3)', async () => {
      // `security_id is not distinct from $1` is null-safe SQL equality — this is the case that
      // proves it: if the check ever regressed to a plain `=`, `security_id = null` is never
      // true in SQL, so `where not exists` would report "not exists" on every single retry and
      // this repeated macro-item collection would insert an unbounded duplicate row forever
      // under D-16's permanent, forward-only corpus, with nothing here to catch it.
      const first = await insertEvidenceItem(
        item({
          securityId: null,
          evidenceType: 'macro',
          provider: 'fred',
          title: 'Fed holds rates steady',
          sourceUrl: null,
          rawHash: 'fred-rate-decision-1',
        }),
      );
      const second = await insertEvidenceItem(
        item({
          securityId: null,
          evidenceType: 'macro',
          provider: 'fred',
          title: 'Fed holds rates steady',
          sourceUrl: null,
          rawHash: 'fred-rate-decision-1',
        }),
      );

      expect(first.inserted).toBe(true);
      expect(second.inserted).toBe(false);
      expect(second.item.id).toBe(first.item.id);

      const { rows } = await pool.query('select count(*)::text as count from evidence_item');
      expect(rows[0]?.count).toBe('1');
    });

    it('does not let a null security_id from one provider collide with a different provider\'s macro item', async () => {
      const fred = await insertEvidenceItem(
        item({
          securityId: null,
          evidenceType: 'macro',
          provider: 'fred',
          title: 'Shared headline text',
          sourceUrl: null,
          rawHash: 'same-hash-different-provider',
        }),
      );
      const other = await insertEvidenceItem(
        item({
          securityId: null,
          evidenceType: 'macro',
          provider: 'sec-edgar',
          title: 'Shared headline text',
          sourceUrl: null,
          rawHash: 'same-hash-different-provider',
        }),
      );

      expect(fred.inserted).toBe(true);
      expect(other.inserted).toBe(true);
      expect(other.item.id).not.toBe(fred.item.id);
    });

    it('does not throw on an idempotent retry when available_at is in the future (lane-review round 3, finding 2)', async () => {
      // Embargoed content, or ordinary clock skew — either way, a legitimately future-dated
      // available_at must not turn a successful idempotent retry into a thrown exception. The
      // read-back this exercises is an identity lookup for a row already known to exist, not a
      // point-in-time query, and must not be bounded at real "now".
      const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const first = await insertEvidenceItem(item({ rawHash: 'embargoed', availableAt: future }));
      const second = await insertEvidenceItem(item({ rawHash: 'embargoed', availableAt: future }));

      expect(first.inserted).toBe(true);
      expect(second.inserted).toBe(false);
      expect(second.item.id).toBe(first.item.id);
    });
  });

  describe('dedupeKeyOf', () => {
    it('normalizes the url (strips query string and trailing slash) and the title (case, whitespace)', () => {
      const a = dedupeKeyOf({
        sourceUrl: 'https://Example.com/Story/?utm_source=x',
        title: '  GameStop   Rallies  ',
        rawHash: 'irrelevant-when-a-url-exists',
      });
      const b = dedupeKeyOf({
        sourceUrl: 'https://example.com/Story/',
        title: 'gamestop rallies',
        rawHash: 'a-different-irrelevant-hash',
      });
      expect(a).toBe(b);
    });

    it('produces different keys for genuinely different items', () => {
      const a = dedupeKeyOf({ sourceUrl: 'https://example.com/a', title: 'Story A', rawHash: 'a' });
      const b = dedupeKeyOf({ sourceUrl: 'https://example.com/b', title: 'Story B', rawHash: 'b' });
      expect(a).not.toBe(b);
    });

    it('does not collapse two distinct null-sourceUrl items sharing a title (lane-review finding 4)', () => {
      // Two different Reddit comments, both titled "GME thread" (a real, common shape — sampled
      // comments rarely have distinguishing titles), neither with a permalink stored.
      const a = dedupeKeyOf({ sourceUrl: null, title: 'GME thread', rawHash: 'comment-1' });
      const b = dedupeKeyOf({ sourceUrl: null, title: 'GME thread', rawHash: 'comment-2' });
      expect(a).not.toBe(b);
    });

    it('does collapse two null-sourceUrl items that share both a title and a raw_hash', () => {
      const a = dedupeKeyOf({ sourceUrl: null, title: 'GME thread', rawHash: 'identical-payload' });
      const b = dedupeKeyOf({ sourceUrl: null, title: 'GME thread', rawHash: 'identical-payload' });
      expect(a).toBe(b);
    });
  });

  describe('evidenceForSecurity', () => {
    it('returns items most-recent-first by available_at, each carrying a dedupeKey', async () => {
      // Distinct titles/urls — two genuinely different items, not two rows of the same story
      // (which `evidenceForSecurity` now correctly collapses to one; see the dedup test below).
      await insertEvidenceItem(
        item({
          rawHash: 'older',
          title: 'Older story',
          sourceUrl: 'https://example.com/older',
          availableAt: new Date('2026-09-01T00:00:00Z'),
          ingestedAt: new Date('2026-09-01T00:00:00Z'),
        }),
      );
      await insertEvidenceItem(
        item({
          rawHash: 'newer',
          title: 'Newer story',
          sourceUrl: 'https://example.com/newer',
          availableAt: new Date('2026-09-02T00:00:00Z'),
          ingestedAt: new Date('2026-09-02T00:00:00Z'),
        }),
      );

      const result = await evidenceForSecurity({
        securityId,
        asOfInstant: new Date('2026-09-03T00:00:00Z'),
      });
      expect(result.items.map((entry) => entry.rawHash)).toEqual(['newer', 'older']);
      expect(result.scannedCount).toBe(2);
      expect(result.distinctCount).toBe(2);
      expect(result.truncated).toBe(false);
      expect(result.items[0]?.dedupeKey).toBe(dedupeKeyOf(result.items[0] as never));
    });

    it('excludes an item ingested after the as-of instant (F22 §4.2 look-ahead guard)', async () => {
      const cutoff = new Date('2026-09-01T12:00:00Z');
      // Distinct titles/urls — two genuinely different items, not two rows of the same story.
      await insertEvidenceItem(
        item({
          rawHash: 'known-then',
          title: 'Known then',
          sourceUrl: 'https://example.com/known-then',
          availableAt: new Date('2026-09-01T00:00:00Z'),
          ingestedAt: new Date('2026-09-01T01:00:00Z'),
        }),
      );
      await insertEvidenceItem(
        item({
          rawHash: 'learned-later',
          title: 'Learned later',
          sourceUrl: 'https://example.com/learned-later',
          availableAt: new Date('2026-09-01T00:00:00Z'),
          ingestedAt: new Date('2026-09-05T00:00:00Z'),
        }),
      );

      const asOfCutoff = await evidenceForSecurity({ securityId, asOfInstant: cutoff });
      expect(asOfCutoff.items.map((entry) => entry.rawHash)).toEqual(['known-then']);

      const asOfLater = await evidenceForSecurity({
        securityId,
        asOfInstant: new Date('2026-09-06T00:00:00Z'),
      });
      expect(asOfLater.items.map((entry) => entry.rawHash).sort()).toEqual(['known-then', 'learned-later']);
    });

    it('bounds on available_at, not published_at — a filing dated earlier than it was seen', async () => {
      await insertEvidenceItem(
        item({
          rawHash: 'late-arrival',
          publishedAt: new Date('2026-05-01T00:00:00Z'),
          availableAt: new Date('2026-09-01T00:00:00Z'),
          ingestedAt: new Date('2026-09-01T00:00:00Z'),
        }),
      );

      const beforeAvailable = await evidenceForSecurity({
        securityId,
        asOfInstant: new Date('2026-06-01T00:00:00Z'),
      });
      expect(beforeAvailable.items).toHaveLength(0);

      const afterAvailable = await evidenceForSecurity({
        securityId,
        asOfInstant: new Date('2026-09-02T00:00:00Z'),
      });
      expect(afterAvailable.items).toHaveLength(1);
    });

    it('scopes to one security and does not leak another security’s evidence', async () => {
      const { rows } = await pool.query<{ id: string }>(
        `insert into security (symbol, name, exchange, asset_type, currency)
         values ('AMC', 'AMC Entertainment', 'NYSE', 'equity', 'USD') returning id`,
      );
      const otherSecurityId = rows[0]?.id as string;

      const observedAt = new Date('2026-09-01T00:00:00Z');
      await insertEvidenceItem(
        item({ securityId, rawHash: 'mine', availableAt: observedAt, ingestedAt: observedAt }),
      );
      await insertEvidenceItem(
        item({
          securityId: otherSecurityId,
          rawHash: 'theirs',
          availableAt: observedAt,
          ingestedAt: observedAt,
        }),
      );

      const mine = await evidenceForSecurity({
        securityId,
        asOfInstant: new Date('2026-09-02T00:00:00Z'),
      });
      expect(mine.items).toHaveLength(1);
      expect(mine.items[0]?.rawHash).toBe('mine');
    });

    it('reports scannedCount, distinctCount and items.length as three genuinely different numbers (lane-review round 2 finding 2, round 3 finding 3)', async () => {
      // The reviewer's own live probe, reproduced: 5 copies of one syndicated story (the
      // newest arrivals) plus 5 genuinely distinct stories (older) — 10 raw rows, 6 distinct
      // items, a page of 5. All three numbers must differ and each must mean exactly one thing:
      // `scannedCount` (10) is the raw, pre-dedup row count within the scan window — F09 §4.3's
      // "how many were retrieved"; `distinctCount` (6) is how many of those are actually
      // distinct stories, which is what makes the 4 duplicate copies visible as *filtered*
      // rather than simply absent; `items.length` (5) is what actually renders, cut short by
      // `limit` alone, one distinct item short of `distinctCount`. Conflating any two of these
      // (round 1: raw-before-dedup as "retrieved"; round 2: distinct-after-dedup as "retrieved",
      // which hid the duplicates entirely) understates or mislabels the real filtering.
      for (let i = 0; i < 5; i += 1) {
        await insertEvidenceItem(
          item({
            rawHash: `syndicated-${i}`,
            title: 'Shared Story',
            sourceUrl: `https://example.com/story?copy=${i}`,
            // Every syndicated copy is more recent than every distinct story below.
            availableAt: new Date(`2026-09-1${i}T00:00:00Z`),
            ingestedAt: new Date(`2026-09-1${i}T00:00:00Z`),
          }),
        );
      }
      for (let i = 0; i < 5; i += 1) {
        await insertEvidenceItem(
          item({
            rawHash: `distinct-${i}`,
            title: `Distinct Story ${i}`,
            sourceUrl: `https://example.com/distinct-${i}`,
            availableAt: new Date(`2026-09-0${i + 1}T00:00:00Z`),
            ingestedAt: new Date(`2026-09-0${i + 1}T00:00:00Z`),
          }),
        );
      }

      const result = await evidenceForSecurity({
        securityId,
        asOfInstant: new Date('2026-09-20T00:00:00Z'),
        limit: 5,
      });

      expect(result.scannedCount).toBe(10);
      expect(result.distinctCount).toBe(6);
      expect(result.items).toHaveLength(5);
      expect(result.truncated).toBe(false);
      // Most-recent syndicated copy (available_at desc) wins the dedup, then the 4 most recent
      // distinct stories fill the rest of the page — the single oldest distinct story (index 0)
      // is the one page-worthy item correctly excluded by the limit itself, not by dedup.
      expect(result.items.map((entry) => entry.rawHash)).toEqual([
        'syndicated-4',
        'distinct-4',
        'distinct-3',
        'distinct-2',
        'distinct-1',
      ]);
    });

    it('discloses truncation rather than silently under-reporting when the scan window is exhausted (lane-review round 3, finding 1)', async () => {
      // `scanLimit` (the third parameter, production callers never pass it) stands in for
      // `CANDIDATE_SCAN_LIMIT` so this can be proven at 5 rows instead of a million. 8 distinct
      // items exist; a scan window of 5 sees only the 5 most recent and must say so honestly
      // rather than reporting "5 scanned, 5 distinct" as if that were the whole story.
      for (let i = 0; i < 8; i += 1) {
        await insertEvidenceItem(
          item({
            rawHash: `story-${i}`,
            title: `Story ${i}`,
            sourceUrl: `https://example.com/story-${i}`,
            availableAt: new Date(`2026-09-0${i + 1}T00:00:00Z`),
            ingestedAt: new Date(`2026-09-0${i + 1}T00:00:00Z`),
          }),
        );
      }

      const truncatedResult = await evidenceForSecurity(
        { securityId, asOfInstant: new Date('2026-09-20T00:00:00Z') },
        pool,
        5,
      );
      expect(truncatedResult.scannedCount).toBe(5);
      expect(truncatedResult.distinctCount).toBe(5);
      expect(truncatedResult.truncated).toBe(true);

      const fullResult = await evidenceForSecurity(
        { securityId, asOfInstant: new Date('2026-09-20T00:00:00Z') },
        pool,
        100,
      );
      expect(fullResult.scannedCount).toBe(8);
      expect(fullResult.distinctCount).toBe(8);
      expect(fullResult.truncated).toBe(false);
    });

    it('truncates honestly at the real production default, not just at an injected small scanLimit (lane-review round 4)', async () => {
      // Round 3's `discloses truncation` test only proves the *mechanism* works, at an injected
      // depth of 5 — it says nothing about whether the real, un-overridden `CANDIDATE_SCAN_LIMIT`
      // behaves the same way under load. This seeds rows past the actual default via a single
      // bulk insert (individual `insertEvidenceItem` calls at this depth would make the suite
      // itself slow) and calls `evidenceForSecurity` with no `scanLimit` override at all,
      // exercising the exact code path a real caller hits.
      const rowCount = CANDIDATE_SCAN_LIMIT + 5;
      await pool.query(
        `insert into evidence_item
           (security_id, evidence_type, provider, title, source_url, availability,
            license_class, coverage_class, raw_hash, available_at, ingested_at)
         select
           $1, 'news', 'bulk-seed', 'Bulk story ' || g, 'https://example.com/bulk-' || g,
           'available', 'snippet', 'sample', 'bulk-hash-' || g,
           timestamptz '2026-01-01T00:00:00Z' + (g || ' seconds')::interval,
           timestamptz '2026-01-01T00:00:00Z' + (g || ' seconds')::interval
         from generate_series(1, $2) as g`,
        [securityId, rowCount],
      );

      const result = await evidenceForSecurity({
        securityId,
        asOfInstant: new Date('2030-01-01T00:00:00Z'),
      });

      // Exactly the real default, not an injected stand-in — this is what a production caller
      // actually gets once a ticker's evidence corpus grows past CANDIDATE_SCAN_LIMIT.
      expect(result.scannedCount).toBe(CANDIDATE_SCAN_LIMIT);
      expect(result.distinctCount).toBe(CANDIDATE_SCAN_LIMIT);
      expect(result.truncated).toBe(true);
      expect(result.items).toHaveLength(50);
    }, 20_000);
  });
});
