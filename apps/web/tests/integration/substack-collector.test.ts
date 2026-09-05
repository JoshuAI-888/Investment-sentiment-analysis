import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import { closePool, getPool } from '../../src/repositories/client';
import { evidenceForSecurity } from '../../src/repositories/evidence';
import { collectSubstackEvidence } from '../../src/services/substack/collector';
import { fetchSubstackFeed } from '../../src/adapters/substack';
import type { SubstackPublication } from '../../src/adapters/substack-publications';
import type { ScoringQueueEntry, ScoringQueuePort } from '../../src/services/jobs/ports';
import { substackWrapperDeps } from '../../src/services/substack/provider-deps';

const url = databaseUrl();

/**
 * `callProvider` catches a thrown fetcher error, classifies it, and retries with backoff before
 * giving up — so a failure case driven through the real `systemClock` would sit in genuine
 * exponential-backoff sleeps. Same trick, and same reason, as `market-collector.test.ts`.
 */
function fastDeps() {
  return { ...substackWrapperDeps(), clock: { now: () => new Date(), sleep: async () => {} } };
}
const FAR_FUTURE = new Date('2099-01-01T00:00:00.000Z');

const PUBLICATION: SubstackPublication = {
  slug: 'example',
  name: 'Example Letter',
  sector: 'Information Technology',
};

/** Captures what the collector enqueues without needing F20's real Postgres-backed queue. */
function recordingQueue(): ScoringQueuePort & { readonly entries: ScoringQueueEntry[] } {
  const entries: ScoringQueueEntry[] = [];
  return {
    entries,
    enqueue: async (batch) => {
      entries.push(...batch);
    },
    lease: async () => [],
    ack: async () => {},
    release: async () => {},
    stats: async () => ({ depth: entries.length, oldestEnqueuedAt: null, leased: 0 }),
  };
}

/**
 * A scratch fixture tree rather than a new case under the committed `fixtures/substack/feed/` —
 * that directory's case matrix is closed for this adapter, and the committed `success.json`
 * deliberately names no company, so it cannot exercise attribution. Mirrors the same pattern
 * `market-collector.test.ts` uses and documents.
 */
async function writeFeedFixture(caseName: string, itemsXml: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'substack-collector-'));
  await mkdir(join(root, 'substack', 'feed'), { recursive: true });
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>Example Letter</title><link>https://example.substack.com</link>
<description>Scratch fixture.</description>
${itemsXml}
</channel></rss>`;
  await writeFile(
    join(root, 'substack', 'feed', `${caseName}.json`),
    JSON.stringify({
      status: 200,
      headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
      body,
    }),
  );
  return root;
}

function item(title: string, slug: string, contentHtml: string, pubDate = 'Thu, 04 Sep 2026 09:00:00 GMT') {
  return `<item>
<title>${title}</title>
<link>https://example.substack.com/p/${slug}</link>
<guid isPermaLink="false">https://example.substack.com/p/${slug}</guid>
<pubDate>${pubDate}</pubDate>
<content:encoded><![CDATA[${contentHtml}]]></content:encoded>
</item>`;
}

describe.skipIf(url === undefined)('F04 — the Substack collector', () => {
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

  async function insertSecurity(symbol: string, name: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `insert into security (symbol, name, exchange, asset_type, currency, active)
       values ($1, $2, 'NASDAQ', 'equity', 'USD', true) returning id`,
      [symbol, name],
    );
    return rows[0]?.id as string;
  }

  async function heartbeats(): Promise<{ axis: string; items_seen: number }[]> {
    const { rows } = await pool.query('select axis, items_seen from collector_heartbeat');
    return rows as { axis: string; items_seen: number }[];
  }

  it('attributes a post to the security it names and enqueues it for scoring', async () => {
    const tesla = await insertSecurity('TSLA', 'Tesla, Inc.');
    const fixturesRoot = await writeFeedFixture(
      'success',
      item('Tesla had a strong quarter', 'tsla', '<p>Tesla shipped a lot of cars.</p>'),
    );
    const queue = recordingQueue();

    const outcome = await collectSubstackEvidence({
      queue,
      providerMode: 'fixture',
      fixturesRoot,
      publications: [PUBLICATION],
      now: new Date('2026-09-05T12:00:00.000Z'),
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.entriesSeen).toBe(1);
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.securityId).toBe(tesla);
    expect(outcome.enqueuedCount).toBe(1);
    expect(queue.entries[0]).toMatchObject({ axis: 'substack', form: 'article', scorerId: 'finbert' });

    const evidence = await evidenceForSecurity({ securityId: tesla, asOfInstant: FAR_FUTURE });
    expect(evidence.items).toHaveLength(1);
    expect(evidence.items[0]?.title).toBe('Tesla had a strong quarter');
    expect(evidence.items[0]?.snippet).toBe('Tesla shipped a lot of cars.');
  });

  // The property that makes a 5-minute cadence safe: re-polling the same feed must not grow the
  // corpus or re-score an item that already has a score.
  it('is idempotent across a repeated poll — no new rows, nothing re-enqueued', async () => {
    const tesla = await insertSecurity('TSLA', 'Tesla, Inc.');
    const fixturesRoot = await writeFeedFixture(
      'success',
      item('Tesla had a strong quarter', 'tsla', '<p>Tesla shipped a lot of cars.</p>'),
    );

    const first = recordingQueue();
    await collectSubstackEvidence({ queue: first, providerMode: 'fixture', fixturesRoot, publications: [PUBLICATION] });

    const second = recordingQueue();
    const outcome = await collectSubstackEvidence({
      queue: second,
      providerMode: 'fixture',
      fixturesRoot,
      publications: [PUBLICATION],
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows.every((r) => r.inserted)).toBe(false);
    expect(outcome.enqueuedCount).toBe(0);
    expect(second.entries).toEqual([]);

    const evidence = await evidenceForSecurity({ securityId: tesla, asOfInstant: FAR_FUTURE });
    expect(evidence.items).toHaveLength(1);
  });

  it('keeps an unattributed post as securityId:null corpus rather than discarding it', async () => {
    await insertSecurity('TSLA', 'Tesla, Inc.');
    const fixturesRoot = await writeFeedFixture(
      'success',
      item('A note on rates', 'rates', '<p>Nothing in the universe is named here.</p>'),
    );
    const queue = recordingQueue();

    const outcome = await collectSubstackEvidence({ queue, providerMode: 'fixture', fixturesRoot, publications: [PUBLICATION] });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.securityId).toBeNull();
    // No subject to take a stance about — it waits for entity.collision_guard.
    expect(outcome.enqueuedCount).toBe(0);

    const { rows } = await pool.query('select count(*)::int as n from evidence_item where security_id is null');
    expect((rows[0] as { n: number }).n).toBe(1);
  });

  // "A gap is the absence of the heartbeat, not the absence of data" — a quiet week for a weekly
  // publication must not manufacture a coverage gap.
  it('writes a heartbeat with items_seen 0 on an empty but successful poll', async () => {
    const fixturesRoot = await writeFeedFixture('success', '');
    const queue = recordingQueue();

    const outcome = await collectSubstackEvidence({ queue, providerMode: 'fixture', fixturesRoot, publications: [PUBLICATION] });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.entriesSeen).toBe(0);
    expect(outcome.heartbeatWritten).toBe(true);
    expect(await heartbeats()).toEqual([{ axis: 'substack', items_seen: 0 }]);
  });

  it('writes no heartbeat when every publication fails, so gap detection sees the hole', async () => {
    const queue = recordingQueue();
    const outcome = await collectSubstackEvidence({
      queue,
      providerMode: 'fixture',
      publications: [PUBLICATION],
      headers: { 'x-fixture-case': 'server_error' },
      deps: fastDeps(),
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.heartbeatWritten).toBe(false);
    expect(outcome.failedPublications.map((f) => f.slug)).toEqual(['example']);
    expect(await heartbeats()).toEqual([]);
  });

  it('still writes a heartbeat and persists what it saw when only some publications fail', async () => {
    const tesla = await insertSecurity('TSLA', 'Tesla, Inc.');
    const fixturesRoot = await writeFeedFixture(
      'success',
      item('Tesla had a strong quarter', 'tsla', '<p>Tesla shipped a lot of cars.</p>'),
    );
    const queue = recordingQueue();

    const outcome = await collectSubstackEvidence({
      queue,
      providerMode: 'fixture',
      fixturesRoot,
      publications: [PUBLICATION, { slug: 'broken', name: 'Broken', sector: 'Energy' }],
      deps: fastDeps(),
      // The fixture harness keys a recorded response by provider/endpoint/case, never by
      // publication slug, so both feeds would otherwise read the same file and both succeed.
      // Failing one by slug is the only way to exercise the partial-failure path.
      fetchFeed: async (feedOptions, providerMode, feedDeps) =>
        feedOptions.publicationSlug === 'broken'
          ? {
              ok: false,
              error: { kind: 'upstream', status: 500 },
              meta: (await fetchSubstackFeed(feedOptions, providerMode, feedDeps)).meta,
            }
          : fetchSubstackFeed(feedOptions, providerMode, feedDeps),
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // One feed of two failing must not cost the other its poll, and must not manufacture an
    // axis-wide gap either: the heartbeat is still written, because the collector did run and
    // the items it saw are real.
    expect(outcome.failedPublications.map((f) => f.slug)).toEqual(['broken']);
    expect(outcome.heartbeatWritten).toBe(true);
    expect(await heartbeats()).toEqual([{ axis: 'substack', items_seen: 1 }]);

    const evidence = await evidenceForSecurity({ securityId: tesla, asOfInstant: FAR_FUTURE });
    expect(evidence.items).toHaveLength(1);
  });
});
