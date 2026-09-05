import { describe, expect, it } from 'vitest';
import { AXIS_FRAME_STATEMENT } from '@/contracts/evidence-pack';
import { fetchAxisBundles, buildFrameDisclosure, SOCIAL_AXES } from '@/services/evidence/frames';
import { fakeEvidenceDb, fakeEvidenceItem } from './helpers';

const SECURITY_ID = '00000000-0000-0000-0000-0000000000aa';
const ASOF = new Date('2026-09-04T00:00:00Z');
const WINDOW = { from: new Date('2026-08-28T00:00:00Z'), to: ASOF };

describe('fetchAxisBundles — F10 §4.1 three sampling frames', () => {
  it('scopes each axis to its own provider and reports a distinct-item retrieved count', async () => {
    const db = fakeEvidenceDb([
      fakeEvidenceItem({ provider: 'reddit', title: 'Reddit post A' }),
      fakeEvidenceItem({ provider: 'reddit', title: 'Reddit post B' }),
      fakeEvidenceItem({ provider: 'x', title: 'X post A' }),
      fakeEvidenceItem({ provider: 'substack', title: 'Substack post A' }),
    ]);
    const bundles = await fetchAxisBundles({ securityId: SECURITY_ID, asOfInstant: ASOF }, db);
    expect(bundles).toHaveLength(3);
    expect(SOCIAL_AXES).toEqual(['reddit', 'x', 'substack']);

    const reddit = bundles.find((b) => b.axis === 'reddit');
    expect(reddit?.retrievedCount).toBe(2);
    const x = bundles.find((b) => b.axis === 'x');
    expect(x?.retrievedCount).toBe(1);
    const substack = bundles.find((b) => b.axis === 'substack');
    expect(substack?.retrievedCount).toBe(1);
  });

  it('reports the pre-dedup scanned count as retrieved, not the post-dedup distinct count (lane-review finding 2b)', async () => {
    // Two rows, same normalized url -- one distinct item after evidenceForSecurity's own
    // within-axis dedup, but two rows were genuinely scanned.
    const db = fakeEvidenceDb([
      fakeEvidenceItem({ provider: 'reddit', sourceUrl: 'https://reddit.com/r/x/comments/dup', title: 'Same story' }),
      fakeEvidenceItem({ provider: 'reddit', sourceUrl: 'https://reddit.com/r/x/comments/dup', title: 'Same story' }),
    ]);
    const bundles = await fetchAxisBundles({ securityId: SECURITY_ID, asOfInstant: ASOF }, db);
    const reddit = bundles.find((b) => b.axis === 'reddit');
    expect(reddit?.retrievedCount).toBe(2);
    expect(reddit?.items).toHaveLength(1);
  });

  it('is legitimately empty for an axis with no coverage, not an error (D-15)', async () => {
    const db = fakeEvidenceDb([fakeEvidenceItem({ provider: 'reddit' })]);
    const bundles = await fetchAxisBundles({ securityId: SECURITY_ID, asOfInstant: ASOF }, db);
    const x = bundles.find((b) => b.axis === 'x');
    expect(x?.retrievedCount).toBe(0);
    expect(x?.items).toHaveLength(0);
  });
});

describe('buildFrameDisclosure — F10 §4.5 per-axis statements', () => {
  it('carries the exact reddit frame statement and window/count fields, verbatim', () => {
    const disclosure = buildFrameDisclosure(
      { axis: 'reddit', items: [], retrievedCount: 4, truncatedScan: false },
      3,
      WINDOW,
    );
    expect(disclosure.frameStatement).toBe(AXIS_FRAME_STATEMENT.reddit);
    expect(disclosure.retrievedCount).toBe(4);
    expect(disclosure.usedCount).toBe(3);
    expect(disclosure.window).toEqual(WINDOW);
  });

  it('carries the exact x frame statement', () => {
    const disclosure = buildFrameDisclosure(
      { axis: 'x', items: [], retrievedCount: 0, truncatedScan: false },
      0,
      WINDOW,
    );
    expect(disclosure.frameStatement).toBe(AXIS_FRAME_STATEMENT.x);
  });

  it('carries the exact substack frame statement, plus injected basis fields', () => {
    const disclosure = buildFrameDisclosure(
      { axis: 'substack', items: [], retrievedCount: 2, truncatedScan: false },
      2,
      WINDOW,
      { substack: { publicationSetVersion: 'v1', selectionBasis: 'GICS sector coverage' } },
    );
    expect(disclosure.frameStatement).toBe(AXIS_FRAME_STATEMENT.substack);
    expect(disclosure.publicationSetVersion).toBe('v1');
    expect(disclosure.selectionBasis).toBe('GICS sector coverage');
  });

  it('reads subreddits polled from item metadata, deduped and sorted', () => {
    const items = [
      { ...fakeEvidenceItem({ provider: 'reddit', metadata: { subreddit: 'wallstreetbets' } }), dedupeKey: 'a' },
      { ...fakeEvidenceItem({ provider: 'reddit', metadata: { subreddit: 'stocks' } }), dedupeKey: 'b' },
      { ...fakeEvidenceItem({ provider: 'reddit', metadata: { subreddit: 'wallstreetbets' } }), dedupeKey: 'c' },
    ];
    const disclosure = buildFrameDisclosure(
      { axis: 'reddit', items, retrievedCount: 3, truncatedScan: false },
      3,
      WINDOW,
    );
    expect(disclosure.subredditsPolled).toEqual(['stocks', 'wallstreetbets']);
  });

  it('omits treeComplete entirely rather than fabricating it when no item reports it', () => {
    const items = [{ ...fakeEvidenceItem({ provider: 'reddit', metadata: {} }), dedupeKey: 'a' }];
    const disclosure = buildFrameDisclosure(
      { axis: 'reddit', items, retrievedCount: 1, truncatedScan: false },
      1,
      WINDOW,
    );
    expect(disclosure.treeComplete).toBeUndefined();
  });

  it('reads the x watchlist version and trigger event id from metadata', () => {
    const items = [
      {
        ...fakeEvidenceItem({
          provider: 'x',
          metadata: { watchlistVersion: 'watchlist-v3', triggerEventId: 'trg-1' },
        }),
        dedupeKey: 'a',
      },
    ];
    const disclosure = buildFrameDisclosure({ axis: 'x', items, retrievedCount: 1, truncatedScan: false }, 1, WINDOW);
    expect(disclosure.watchlistVersion).toBe('watchlist-v3');
    expect(disclosure.triggerEventId).toBe('trg-1');
  });
});
