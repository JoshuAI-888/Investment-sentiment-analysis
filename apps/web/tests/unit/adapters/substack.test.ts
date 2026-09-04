import { describe, expect, it } from 'vitest';
import { fetchSubstackFeed, parseSubstackFeed } from '@/adapters/substack';
import { harness } from './fakes';

const RSS_WITH_TWO_ITEMS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
<title>Example</title>
<item>
<title>Post One &amp; Things</title>
<link>https://example.substack.com/p/post-one</link>
<guid isPermaLink="false">https://example.substack.com/p/post-one</guid>
<pubDate>Mon, 01 Sep 2025 12:00:00 GMT</pubDate>
<content:encoded><![CDATA[<p>Full <b>body</b> &amp; more</p>]]></content:encoded>
</item>
<item>
<title>Post Two — no content:encoded</title>
<link>https://example.substack.com/p/post-two</link>
<guid isPermaLink="false">https://example.substack.com/p/post-two</guid>
<pubDate>Tue, 02 Sep 2025 08:00:00 GMT</pubDate>
<description><![CDATA[<p>Falls back here.</p>]]></description>
</item>
</channel>
</rss>`;

const RSS_WITH_ONE_ITEM = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<item>
<title>Solo post</title>
<link>https://example.substack.com/p/solo</link>
<pubDate>Wed, 03 Sep 2025 08:00:00 GMT</pubDate>
</item>
</channel>
</rss>`;

const RSS_WITH_NO_ITEMS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>Empty publication</title>
</channel>
</rss>`;

describe('parseSubstackFeed', () => {
  it('parses multiple items, preferring content:encoded and falling back to description', () => {
    const entries = parseSubstackFeed(RSS_WITH_TWO_ITEMS);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      guid: 'https://example.substack.com/p/post-one',
      title: 'Post One & Things',
      link: 'https://example.substack.com/p/post-one',
      publishedAt: '2025-09-01T12:00:00.000Z',
      contentHtml: '<p>Full <b>body</b> &amp; more</p>',
    });
    expect(entries[1]?.contentHtml).toBe('<p>Falls back here.</p>');
  });

  it('normalizes a single <item> — fast-xml-parser hands it back as an object, not an array', () => {
    const entries = parseSubstackFeed(RSS_WITH_ONE_ITEM);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.guid).toBe('https://example.substack.com/p/solo'); // falls back to link
    expect(entries[0]?.contentHtml).toBe('');
  });

  it('returns an empty array for a channel with no items, rather than throwing', () => {
    expect(parseSubstackFeed(RSS_WITH_NO_ITEMS)).toEqual([]);
  });

  it('drops an individual item with an unparseable pubDate rather than failing the batch', () => {
    const xml = `<rss version="2.0"><channel>
      <item><title>Bad date</title><link>https://x.test/a</link><pubDate>not-a-date</pubDate></item>
      <item><title>Good date</title><link>https://x.test/b</link><pubDate>Mon, 01 Sep 2025 12:00:00 GMT</pubDate></item>
    </channel></rss>`;

    expect(parseSubstackFeed(xml)).toEqual([
      expect.objectContaining({ title: 'Good date' }),
    ]);
  });

  it('throws on a document with no <rss><channel> root', () => {
    expect(() => parseSubstackFeed('<html><body>not a feed</body></html>')).toThrow(/RSS 2.0/);
  });
});

describe('fetchSubstackFeed — against the committed fixtures (F04 §4.2/§4.3)', () => {
  // `fetchSubstackFeed` builds its own fixture-or-live fetcher internally (§4.2's `createFetcher`),
  // so `h.deps.fetcher` is never consulted — only the wrapper's other ports (budget, quota, cache,
  // breaker, logging) come from the harness. Case selection travels on the `headers` option,
  // which `fetchSubstackFeed` forwards onto the request the fixture fetcher reads.
  it('returns parsed entries for the default ("success") fixture', async () => {
    const h = harness();

    const result = await fetchSubstackFeed({ publicationSlug: 'example' }, 'fixture', h.deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0]?.title).toContain('Q3 margins');
    }
  });

  it('returns an empty array, ok:true, for the empty fixture', async () => {
    const h = harness();

    const result = await fetchSubstackFeed(
      { publicationSlug: 'example', headers: { 'x-fixture-case': 'empty' } },
      'fixture',
      h.deps,
    );

    expect(result).toMatchObject({ ok: true, data: [] });
  });

  it('reports a parse failure loudly when the fixture is not RSS at all', async () => {
    const h = harness();

    // Malformed: an HTML error page instead of RSS. The wrapper's schema (non-empty string)
    // accepts it; parseSubstackFeed is what must catch that this is not a feed at all.
    const result = await fetchSubstackFeed(
      { publicationSlug: 'example', headers: { 'x-fixture-case': 'malformed' } },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: 'contract', issues: expect.any(Array) });
    expect(h.violations).toHaveLength(1);
  });

  it('never throws on a 403 — the DoD applies to Substack too', async () => {
    const h = harness();

    const result = await fetchSubstackFeed(
      { publicationSlug: 'example', headers: { 'x-fixture-case': 'entitlement_403' } },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: 'entitlement', endpoint: 'feed', status: 403 });
  });

  it('honours Retry-After on a 429 without retrying an unpriced RSS poll needlessly', async () => {
    const h = harness();

    const result = await fetchSubstackFeed(
      { publicationSlug: 'example', headers: { 'x-fixture-case': 'rate_limited_with_retry_after' } },
      'fixture',
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: 'rate_limit', retryAfterMs: 30_000 });
  });

  it('is never priced — costUsd stays null even on a successful poll', async () => {
    const h = harness();

    const result = await fetchSubstackFeed({ publicationSlug: 'example' }, 'fixture', h.deps);

    expect(result.meta.costUsd).toBeNull();
  });
});
