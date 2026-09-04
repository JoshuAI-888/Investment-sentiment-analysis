import { describe, expect, it } from 'vitest';
import { buildAxisDisclosures, type AxisCounts, type BuildDisclosuresInput } from '@/services/evidence/disclosure';
import { SUBSTACK_PUBLICATION_SET_VERSION } from '@/services/evidence/sampling-config';

function emptyCounts(): BuildDisclosuresInput['counts'] {
  const empty: AxisCounts = { retrieved: 0, used: 0, exclusions: [] };
  return { reddit: { ...empty }, x: { ...empty }, substack: { ...empty } };
}

describe('buildAxisDisclosures', () => {
  it('always returns exactly three, in a fixed reddit/x/substack order', () => {
    const [reddit, x, substack] = buildAxisDisclosures({
      counts: emptyCounts(),
      windowFrom: null,
      windowTo: null,
      reddit: { subredditsPolled: [], treeComplete: null },
      x: { watchlistVersion: null, triggerEvent: null },
    });
    expect(reddit.axis).toBe('reddit');
    expect(x.axis).toBe('x');
    expect(substack.axis).toBe('substack');
  });

  it('never uses a shared statement across axes', () => {
    const [reddit, x, substack] = buildAxisDisclosures({
      counts: emptyCounts(),
      windowFrom: null,
      windowTo: null,
      reddit: { subredditsPolled: [], treeComplete: null },
      x: { watchlistVersion: null, triggerEvent: null },
    });
    const statements = new Set([reddit.statement, x.statement, substack.statement]);
    expect(statements.size).toBe(3);
  });

  it('discloses Reddit as not collected (D-39), ignoring any counts a caller might pass', () => {
    const counts: BuildDisclosuresInput['counts'] = {
      ...emptyCounts(),
      reddit: { retrieved: 40, used: 12, exclusions: [{ reason: 'not_relevant', count: 3 }] },
    };
    const [reddit] = buildAxisDisclosures({
      counts,
      windowFrom: '2026-08-01T00:00:00.000Z',
      windowTo: '2026-09-01T00:00:00.000Z',
      reddit: { subredditsPolled: ['wallstreetbets', 'stocks'], treeComplete: true },
      x: { watchlistVersion: null, triggerEvent: null },
    });

    expect(reddit.retrievedCount).toBe(0);
    expect(reddit.usedCount).toBe(0);
    expect(reddit.exclusions).toEqual([]);
    expect(reddit.windowFrom).toBeNull();
    expect(reddit.meta).toEqual({ kind: 'reddit', collected: false, subredditsPolled: [], treeComplete: null });
    expect(reddit.statement).toMatch(/not a data source/i);
    expect(reddit.statement).not.toMatch(/observed sample of comments/i);
  });

  it('never labels the X frame as continuous, and carries the trigger event', () => {
    const counts: BuildDisclosuresInput['counts'] = {
      ...emptyCounts(),
      x: { retrieved: 5, used: 4, exclusions: [] },
    };
    const [, x] = buildAxisDisclosures({
      counts,
      windowFrom: null,
      windowTo: null,
      reddit: { subredditsPolled: [], treeComplete: null },
      x: { watchlistVersion: 'wl-3', triggerEvent: 'price_move_2026-09-01T14:32:00Z' },
    });

    expect(x.statement).toMatch(/event-conditional, not continuous/i);
    expect(x.meta).toEqual({ kind: 'x', watchlistVersion: 'wl-3', triggerEvent: 'price_move_2026-09-01T14:32:00Z' });
    expect(x.retrievedCount).toBe(5);
    expect(x.usedCount).toBe(4);
  });

  it('names the publication-set version in the Substack statement and its selection basis', () => {
    const [, , substack] = buildAxisDisclosures({
      counts: emptyCounts(),
      windowFrom: null,
      windowTo: null,
      reddit: { subredditsPolled: [], treeComplete: null },
      x: { watchlistVersion: null, triggerEvent: null },
    });

    expect(substack.statement).toContain(SUBSTACK_PUBLICATION_SET_VERSION);
    expect(substack.meta).toMatchObject({ kind: 'substack', publicationSetVersion: SUBSTACK_PUBLICATION_SET_VERSION });
    if (substack.meta.kind === 'substack') {
      expect(substack.meta.selectionBasis).toMatch(/sector coverage/i);
    }
  });

  it('none of the three statements uses banned vocabulary (docs/04-BUILD-LOOP.md §5)', () => {
    const banned = ['signal', 'strong buy', 'risk-on', 'consensus', 'reddit sentiment', 'social sentiment', 'x sentiment', 'retail sentiment'];
    const [reddit, x, substack] = buildAxisDisclosures({
      counts: emptyCounts(),
      windowFrom: null,
      windowTo: null,
      reddit: { subredditsPolled: [], treeComplete: null },
      x: { watchlistVersion: null, triggerEvent: null },
    });
    for (const disclosure of [reddit, x, substack]) {
      const lower = disclosure.statement.toLowerCase();
      for (const word of banned) {
        expect(lower).not.toContain(word);
      }
    }
  });
});
