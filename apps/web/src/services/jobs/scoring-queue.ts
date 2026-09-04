/**
 * The producer half of F20 §4.2's queue — what the collector calls.
 *
 * ## The binding rule, made structural
 *
 * §4.2 rule 1: *"The collector never blocks on the scorer. It writes the raw item and enqueues.
 * A scorer outage grows the backlog; it does not stop collection or lose data."*
 *
 * The strongest available form of that rule is not a try/catch — it is that **this module
 * cannot reach the scorer at all**. `enqueueForScoring` takes a `ScoringQueuePort` and nothing
 * else; there is no scorer client in its dependency set, no HTTP client, and no way to add one
 * without changing the signature. A future edit that made the collector wait for a score would
 * have to introduce the dependency first, which is a visible diff rather than a silent latency
 * regression at 3 a.m. under D-16's irreversible clock.
 *
 * The ordering guarantee — body first, enqueue second — is `ingestAndEnqueue`'s, below.
 */
import type { SocialAxis } from '@/contracts/primitives';
import { routeToScorer } from './routing';
import type { ScoringQueueEntry, ScoringQueuePort, ScoringQueueStats, SocialItemForm } from './ports';

/** A raw item the collector has just written, as the queue needs to see it. */
export type CollectedItem = {
  itemId: string;
  axis: SocialAxis;
  form: SocialItemForm;
};

export type EnqueueOutcome = {
  enqueued: readonly ScoringQueueEntry[];
  /** Ids the caller passed more than once in one batch. Deduplicated, not enqueued twice. */
  duplicates: readonly string[];
  backlog: ScoringQueueStats;
};

/**
 * Enqueues freshly collected items for their first scoring.
 *
 * Deduplicates within the batch. Cross-batch idempotency belongs to the implementation — see
 * `ScoringQueuePort.enqueue`'s contract — because only the store can see what it already holds.
 */
export async function enqueueForScoring(
  input: { items: readonly CollectedItem[]; at: Date },
  deps: { queue: ScoringQueuePort },
): Promise<EnqueueOutcome> {
  const enqueuedAt = input.at.toISOString();
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const entries: ScoringQueueEntry[] = [];

  for (const item of input.items) {
    if (seen.has(item.itemId)) {
      duplicates.push(item.itemId);
      continue;
    }
    seen.add(item.itemId);
    entries.push({
      itemId: item.itemId,
      axis: item.axis,
      form: item.form,
      scorerId: routeToScorer(item),
      reason: 'initial',
      supersedesScoreId: null,
      // An initial scoring has no target: whatever revision the service is pinned to now is by
      // definition the right one for an item that has never been scored.
      targetScorerVersion: null,
      enqueuedAt,
    });
  }

  if (entries.length > 0) await deps.queue.enqueue(entries);

  return { enqueued: entries, duplicates, backlog: await deps.queue.stats({ at: input.at }) };
}

/**
 * Write the raw bodies, then enqueue — in that order, and the order is the point.
 *
 * D-17 retains full bodies precisely so an unscored backlog is *recoverable*. If the enqueue
 * happened first and the write failed, the queue would hold an id with no body behind it; if
 * the write happened first and the enqueue failed, the body is still on disk and a later sweep
 * can re-enqueue it. The second failure is repairable and the first is not, so the write goes
 * first. That asymmetry is the whole reason this function exists rather than two calls at the
 * call site.
 *
 * A failing `writeItems` propagates: the collector's own retry owns that, and swallowing it
 * here would report items as collected that were never stored.
 */
export async function ingestAndEnqueue<TItem extends CollectedItem>(
  input: { items: readonly TItem[]; at: Date },
  deps: {
    queue: ScoringQueuePort;
    writeItems: (items: readonly TItem[]) => Promise<void>;
  },
): Promise<EnqueueOutcome> {
  if (input.items.length === 0) {
    return { enqueued: [], duplicates: [], backlog: await deps.queue.stats({ at: input.at }) };
  }

  await deps.writeItems(input.items);
  return enqueueForScoring({ items: input.items, at: input.at }, { queue: deps.queue });
}
