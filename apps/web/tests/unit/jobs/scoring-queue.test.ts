import { describe, expect, it } from 'vitest';
import { enqueueForScoring, ingestAndEnqueue } from '@/services/jobs/scoring-queue';
import type { CollectedItem } from '@/services/jobs/scoring-queue';
import { fakeQueue, type Trace } from './fakes';

const AT = new Date('2026-08-30T12:00:00.000Z');

const ITEMS: CollectedItem[] = [
  { itemId: 'item-1', axis: 'reddit', form: 'post' },
  { itemId: 'item-2', axis: 'reddit', form: 'comment' },
  { itemId: 'item-3', axis: 'x', form: 'post' },
];

describe('F20 §4.2 rule 1 — the collector writes and enqueues, and never waits for a score', () => {
  it('freezes the routing decision on the entry at enqueue time', async () => {
    const trace: Trace = [];
    const queue = fakeQueue(trace);

    const outcome = await enqueueForScoring({ items: ITEMS, at: AT }, { queue: queue.port });

    expect(outcome.enqueued.map((entry) => [entry.itemId, entry.scorerId])).toEqual([
      ['item-1', 'finbert'],
      ['item-2', 'tweet-roberta'],
      ['item-3', 'tweet-roberta'],
    ]);
    // A re-score must route to the same model as the initial scoring. Deriving it once, here,
    // is what makes that true without re-deriving it identically later and hoping.
    expect(outcome.enqueued.every((entry) => entry.reason === 'initial')).toBe(true);
    expect(outcome.enqueued.every((entry) => entry.supersedesScoreId === null)).toBe(true);
  });

  it('deduplicates within a batch rather than enqueuing an item twice', async () => {
    const trace: Trace = [];
    const queue = fakeQueue(trace);

    const outcome = await enqueueForScoring(
      { items: [...ITEMS, { itemId: 'item-1', axis: 'reddit', form: 'post' }], at: AT },
      { queue: queue.port },
    );

    expect(outcome.duplicates).toEqual(['item-1']);
    expect(outcome.enqueued).toHaveLength(3);
    expect(outcome.backlog.depth).toBe(3);
  });

  it('reports backlog depth and the oldest unscored timestamp for the operator (§4.2 rule 3)', async () => {
    const trace: Trace = [];
    const queue = fakeQueue(trace);

    await enqueueForScoring({ items: [ITEMS[0]!], at: new Date('2026-08-30T09:00:00.000Z') }, { queue: queue.port });
    const outcome = await enqueueForScoring({ items: [ITEMS[1]!], at: AT }, { queue: queue.port });

    expect(outcome.backlog.depth).toBe(2);
    expect(outcome.backlog.oldestEnqueuedAt).toBe('2026-08-30T09:00:00.000Z');
  });

  it('writes the bodies before it enqueues, so a queued id always has a body behind it', async () => {
    const trace: Trace = [];
    const queue = fakeQueue(trace);

    await ingestAndEnqueue(
      { items: ITEMS, at: AT },
      {
        queue: queue.port,
        writeItems: async (items) => {
          trace.push(`write:${items.length}`);
        },
      },
    );

    // The order is the assertion. Enqueuing first would leave the queue holding an id with no
    // body behind it if the write then failed — the one failure D-17's retention cannot repair.
    expect(trace.indexOf('write:3')).toBeGreaterThanOrEqual(0);
    expect(trace.indexOf('write:3')).toBeLessThan(trace.indexOf('queue.enqueue:3'));
  });

  it('propagates a failed body write and enqueues nothing', async () => {
    const trace: Trace = [];
    const queue = fakeQueue(trace);

    await expect(
      ingestAndEnqueue(
        { items: ITEMS, at: AT },
        {
          queue: queue.port,
          writeItems: async () => {
            throw new Error('neon is down');
          },
        },
      ),
    ).rejects.toThrow('neon is down');

    expect(queue.slots).toHaveLength(0);
    expect(trace).not.toContain('queue.enqueue:3');
  });

  it('completes with only a queue and a writer — there is no scorer in its dependency set', async () => {
    const trace: Trace = [];
    const queue = fakeQueue(trace);

    // The strongest form of "the collector never blocks on the scorer" available in a unit
    // test: this call is given no scorer, no HTTP client and no way to reach one, and it still
    // returns a full result. A future edit that made collection wait on a score would have to
    // widen this signature first, which is a visible diff.
    const outcome = await ingestAndEnqueue(
      { items: ITEMS, at: AT },
      { queue: queue.port, writeItems: async () => {} },
    );

    expect(outcome.enqueued).toHaveLength(3);
    expect(trace.some((entry) => entry.startsWith('score'))).toBe(false);
  });

  it('does nothing at all for an empty collection cycle', async () => {
    const trace: Trace = [];
    const queue = fakeQueue(trace);
    let writes = 0;

    const outcome = await ingestAndEnqueue(
      { items: [], at: AT },
      {
        queue: queue.port,
        writeItems: async () => {
          writes += 1;
        },
      },
    );

    expect(writes).toBe(0);
    expect(outcome.enqueued).toEqual([]);
    expect(outcome.backlog).toEqual({ depth: 0, leased: 0, oldestEnqueuedAt: null });
  });
});
