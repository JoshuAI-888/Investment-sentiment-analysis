import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import { closePool, getPool } from '../../src/repositories/client';
import {
  collectSubstackItems,
  SUBSTACK_COVERAGE_CLASS,
  SUBSTACK_EVIDENCE_PROVIDER,
  SUBSTACK_LICENSE_CLASS,
} from '../../src/services/collect/substack-collector';
import { SUBSTACK_PUBLICATIONS, type SubstackPublication } from '../../src/services/collect/substack-publications';
import { runSubstackPoll, SUBSTACK_POLL_JOB_KEY } from '../../src/services/jobs/collectors';

const url = databaseUrl();

const withCase = (fixtureCase: string) => ({ 'x-fixture-case': fixtureCase });

/**
 * Writes a scratch fixture tree for `substack/feed`, mirroring
 * `tests/integration/market-collector.test.ts`'s own `writeMarketFixture` pattern exactly — the
 * committed `apps/web/fixtures/substack/feed/` matrix (six real cases, F04) stays untouched by
 * test-only shapes, same reasoning that file gives: a test-only case does not belong alongside a
 * recorded-from-real-payload fixture set.
 */
async function writeSubstackFixture(fixturesRoot: string, caseName: string, xml: string): Promise<void> {
  await mkdir(join(fixturesRoot, 'substack', 'feed'), { recursive: true });
  await writeFile(
    join(fixturesRoot, 'substack', 'feed', `${caseName}.json`),
    JSON.stringify({ status: 200, headers: { 'content-type': 'application/rss+xml; charset=utf-8' }, body: xml }),
  );
}

/** A minimal, valid RSS 2.0 feed with the given `<item>`s, matching real Substack shape closely
 *  enough for `parseSubstackFeed` (content:encoded namespace, CDATA-wrapped bodies). */
function feedXml(items: readonly { guid: string; title: string; link: string; pubDate: string; contentHtml: string }[]): string {
  const itemsXml = items
    .map(
      (item) => `<item>
<title>${item.title}</title>
<link>${item.link}</link>
<guid isPermaLink="false">${item.guid}</guid>
<pubDate>${item.pubDate}</pubDate>
<content:encoded><![CDATA[${item.contentHtml}]]></content:encoded>
</item>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
<title>Test Publication</title>
<link>https://test.substack.com</link>
<description>Test fixture feed</description>
${itemsXml}
</channel>
</rss>
`;
}

const energyPub: SubstackPublication = { sector: 'Energy', publication: 'Energy Test Pub', subdomain: 'energytest' };
const materialsPub: SubstackPublication = {
  sector: 'Materials',
  publication: 'Materials Test Pub',
  subdomain: 'materialstest',
};

/**
 * F16a's own report: no Substack collector service existed yet ("Substack not seeded — no
 * collector service exists yet"). This suite proves the gap this feature closes — a real,
 * deterministic fixture-mode poll cycle that actually writes `evidence_item` rows — against a
 * real Postgres, the same discipline every other repository-backed collector in this codebase is
 * held to (`tests/integration/market-collector.test.ts`).
 */
describe.skipIf(url === undefined)('the Substack collector', () => {
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

  async function evidenceCount(): Promise<number> {
    const { rows } = await pool.query<{ count: string }>(
      "select count(*)::text as count from evidence_item where provider = $1",
      [SUBSTACK_EVIDENCE_PROVIDER],
    );
    return Number(rows[0]?.count ?? '0');
  }

  it('polls two configured publications and persists one evidence_item per entry, per publication', async () => {
    const fixturesRoot = await mkdtemp(join(tmpdir(), 'substack-collector-'));
    await writeSubstackFixture(
      fixturesRoot,
      'energy_feed',
      feedXml([
        {
          guid: 'energy-1',
          title: 'Energy post one',
          link: 'https://energytest.substack.com/p/one',
          pubDate: 'Mon, 25 Aug 2025 13:00:00 GMT',
          contentHtml: '<p>Energy body one.</p>',
        },
      ]),
    );
    await writeSubstackFixture(
      fixturesRoot,
      'materials_feed',
      feedXml([
        {
          guid: 'materials-1',
          title: 'Materials post one',
          link: 'https://materialstest.substack.com/p/one',
          pubDate: 'Tue, 26 Aug 2025 09:00:00 GMT',
          contentHtml: '<p>Materials body one.</p>',
        },
      ]),
    );

    const outcome = await collectSubstackItems({
      providerMode: 'fixture',
      fixturesRoot,
      publications: [energyPub, materialsPub],
      headersByPublication: {
        energytest: withCase('energy_feed'),
        materialstest: withCase('materials_feed'),
      },
    });

    expect(outcome.failures).toEqual([]);
    expect(outcome.skippedEntries).toEqual([]);
    expect(outcome.results).toHaveLength(2);
    expect(outcome.results.every((r) => r.inserted)).toBe(true);
    expect(outcome.results.map((r) => r.publicationSlug).sort()).toEqual(['energytest', 'materialstest']);

    expect(await evidenceCount()).toBe(2);

    const { rows } = await pool.query<{ security_id: string | null; license_class: string; coverage_class: string }>(
      "select security_id, license_class, coverage_class from evidence_item where provider = $1",
      [SUBSTACK_EVIDENCE_PROVIDER],
    );
    for (const row of rows) {
      expect(row.security_id).toBeNull();
      expect(row.license_class).toBe(SUBSTACK_LICENSE_CLASS);
      expect(row.coverage_class).toBe(SUBSTACK_COVERAGE_CLASS);
    }
  });

  // D-17 / this feature's own DoD: persisted content is the real content:encoded HTML, not a
  // truncated snippet. Asserted against a real round trip through Postgres, not just the
  // in-memory builder unit test.
  it('persists the full content:encoded HTML, not a truncated snippet', async () => {
    const fixturesRoot = await mkdtemp(join(tmpdir(), 'substack-collector-'));
    const longBody = `<p>${'Full body text. '.repeat(400)}</p><p>with <b>markup</b> &amp; an entity.</p>`;
    await writeSubstackFixture(
      fixturesRoot,
      'long_body',
      feedXml([
        {
          guid: 'long-1',
          title: 'A long post',
          link: 'https://energytest.substack.com/p/long',
          pubDate: 'Mon, 25 Aug 2025 13:00:00 GMT',
          contentHtml: longBody,
        },
      ]),
    );

    await collectSubstackItems({
      providerMode: 'fixture',
      fixturesRoot,
      publications: [energyPub],
      headers: withCase('long_body'),
    });

    const { rows } = await pool.query<{ snippet: string }>(
      'select snippet from evidence_item where provider = $1',
      [SUBSTACK_EVIDENCE_PROVIDER],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.snippet).toBe(longBody);
    expect(rows[0]?.snippet).toContain('<b>markup</b>');
    expect(rows[0]?.snippet?.length).toBeGreaterThan(6000);
  });

  // §2.1's two-snapshot pair: the same feed polled twice, the second poll adding one new entry
  // while the first entry stays present (the ordinary RSS shape — old items don't vanish until
  // they roll off the page). Proves guid-based dedup: the unchanged entry is not re-inserted, and
  // the genuinely new entry is.
  it('is idempotent across two polls on unchanged guids, and captures a newly appeared entry on the second poll', async () => {
    const fixturesRoot = await mkdtemp(join(tmpdir(), 'substack-collector-'));
    await writeSubstackFixture(
      fixturesRoot,
      'poll_1',
      feedXml([
        {
          guid: 'stable-guid-1',
          title: 'First post',
          link: 'https://energytest.substack.com/p/first',
          pubDate: 'Mon, 25 Aug 2025 13:00:00 GMT',
          contentHtml: '<p>First post body.</p>',
        },
      ]),
    );
    await writeSubstackFixture(
      fixturesRoot,
      'poll_2',
      feedXml([
        // Same guid, same content — still present in the feed on the later poll.
        {
          guid: 'stable-guid-1',
          title: 'First post',
          link: 'https://energytest.substack.com/p/first',
          pubDate: 'Mon, 25 Aug 2025 13:00:00 GMT',
          contentHtml: '<p>First post body.</p>',
        },
        // A genuinely new entry that appeared between the two polls.
        {
          guid: 'stable-guid-2',
          title: 'Second post',
          link: 'https://energytest.substack.com/p/second',
          pubDate: 'Wed, 27 Aug 2025 10:00:00 GMT',
          contentHtml: '<p>Second post body.</p>',
        },
      ]),
    );

    const first = await collectSubstackItems({
      providerMode: 'fixture',
      fixturesRoot,
      publications: [energyPub],
      headers: withCase('poll_1'),
    });
    expect(first.results).toHaveLength(1);
    expect(first.results[0]?.inserted).toBe(true);
    expect(await evidenceCount()).toBe(1);

    const second = await collectSubstackItems({
      providerMode: 'fixture',
      fixturesRoot,
      publications: [energyPub],
      headers: withCase('poll_2'),
    });

    expect(second.results).toHaveLength(2);
    // The already-seen guid: not a new row.
    const stableResult = second.results.find((r) => r.item.metadata && (r.item.metadata as { guid?: string }).guid === 'stable-guid-1');
    expect(stableResult?.inserted).toBe(false);
    // The newly appeared guid: a genuinely new row.
    const newResult = second.results.find((r) => (r.item.metadata as { guid?: string }).guid === 'stable-guid-2');
    expect(newResult?.inserted).toBe(true);

    // Exactly two distinct rows exist in total across both polls — the repeat of stable-guid-1
    // never became a second row.
    expect(await evidenceCount()).toBe(2);
  });

  // Per-publication failure isolation — the same discipline
  // `services/market/collector.ts#collectMarketSnapshots` already establishes per-security.
  it("one publication's feed failure never stops another publication's poll, and the run finishes the full list", async () => {
    const fixturesRoot = await mkdtemp(join(tmpdir(), 'substack-collector-'));
    await writeSubstackFixture(
      fixturesRoot,
      'good_feed',
      feedXml([
        {
          guid: 'good-1',
          title: 'A good post',
          link: 'https://materialstest.substack.com/p/good',
          pubDate: 'Mon, 25 Aug 2025 13:00:00 GMT',
          contentHtml: '<p>Good body.</p>',
        },
      ]),
    );
    // Not an RSS document at all — `parseSubstackFeed` throws, which the adapter turns into a
    // `{kind: 'contract'}` ProviderResult failure (`adapters/substack.ts`'s own doc).
    await writeSubstackFixture(fixturesRoot, 'broken_feed', '<html><body>not rss</body></html>');

    const outcome = await collectSubstackItems({
      providerMode: 'fixture',
      fixturesRoot,
      publications: [energyPub, materialsPub],
      headersByPublication: {
        energytest: withCase('broken_feed'),
        materialstest: withCase('good_feed'),
      },
    });

    expect(outcome.failures).toMatchObject([
      { publicationSlug: 'energytest', reason: 'provider_error', error: { kind: 'contract' } },
    ]);
    expect(outcome.results).toMatchObject([{ publicationSlug: 'materialstest', inserted: true }]);
    expect(await evidenceCount()).toBe(1);
  });

  it('reports an empty feed honestly rather than fabricating an item', async () => {
    const fixturesRoot = await mkdtemp(join(tmpdir(), 'substack-collector-'));
    await writeSubstackFixture(fixturesRoot, 'empty_feed', feedXml([]));

    const outcome = await collectSubstackItems({
      providerMode: 'fixture',
      fixturesRoot,
      publications: [energyPub],
      headers: withCase('empty_feed'),
    });

    expect(outcome.results).toEqual([]);
    expect(outcome.failures).toMatchObject([{ publicationSlug: 'energytest', reason: 'no_entries_returned' }]);
    expect(await evidenceCount()).toBe(0);
  });

  it('stamps lastCheckedAt from an injected clock rather than the real wall clock, and collectedAt matches it', async () => {
    const fixturesRoot = await mkdtemp(join(tmpdir(), 'substack-collector-'));
    await writeSubstackFixture(
      fixturesRoot,
      'success',
      feedXml([
        {
          guid: 'clock-1',
          title: 'Clock post',
          link: 'https://energytest.substack.com/p/clock',
          pubDate: 'Mon, 25 Aug 2025 13:00:00 GMT',
          contentHtml: '<p>Clock body.</p>',
        },
      ]),
    );
    const now = new Date('2030-01-01T00:00:00.000Z');

    const outcome = await collectSubstackItems({
      providerMode: 'fixture',
      fixturesRoot,
      publications: [energyPub],
      now,
    });
    expect(outcome.collectedAt).toBe(now.toISOString());

    const { rows } = await pool.query<{ last_checked_at: string }>(
      'select last_checked_at from evidence_item where provider = $1',
      [SUBSTACK_EVIDENCE_PROVIDER],
    );
    expect(new Date(rows[0]?.last_checked_at as string).toISOString()).toBe(now.toISOString());
  });
});

/**
 * `runSubstackPoll` (`services/jobs/collectors.ts`) — the `JobRunOutcome` bridge this feature adds
 * so `substack_poll` can genuinely be dispatched once `job-service.ts#DISPATCH_TABLE` gets its one
 * remaining line (see that module's own doc comment, and this feature's report, for why this
 * feature cannot add that line itself). Exercised here against the real, disclosed 13-publication
 * set (`SUBSTACK_PUBLICATIONS`) and the real committed `fixtures/substack/feed/success.json`
 * fixture (F04) — no publication override, the same shape the actual dispatched job would run.
 */
describe.skipIf(url === undefined)(`the ${SUBSTACK_POLL_JOB_KEY} job bridge (runSubstackPoll)`, () => {
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

  it('polls the real 13-publication set against the committed success fixture and reports a clean succeeded outcome', async () => {
    const now = new Date('2026-09-05T12:00:00.000Z');
    const { outcome, triggerDispatchRequests } = await runSubstackPoll(pool, now);

    expect(outcome.status).toBe('succeeded');
    expect(outcome.providerCalls).toBe(SUBSTACK_PUBLICATIONS.length);
    expect(outcome.providerCalls).toBe(13);
    // fixtures/substack/feed/success.json carries 2 <item>s; every one of the 13 configured
    // publications gets the same fixture body in fixture mode (no per-publication override), so
    // this run persists 13 × 2 = 26 real evidence_item rows through the same path a real
    // dispatched tick would use.
    expect(outcome.itemsWritten).toBe(26);
    expect(outcome.dataAsOf).toEqual(now);
    expect(triggerDispatchRequests).toEqual([]);

    const { rows } = await pool.query<{ count: string }>(
      "select count(*)::text as count from evidence_item where provider = 'substack'",
    );
    expect(rows[0]?.count).toBe('26');
  });

  it('never fabricates a triggerDispatchRequest — Substack is not D-15’s trigger axis', async () => {
    const { triggerDispatchRequests } = await runSubstackPoll(pool, new Date());
    expect(triggerDispatchRequests).toEqual([]);
  });
});
