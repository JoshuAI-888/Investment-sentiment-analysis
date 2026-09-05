/**
 * A `ScoringQueuePort` that accepts entries and stores nothing.
 *
 * ## Why this exists, and why it is not a lie
 *
 * F20's queue machinery — lease, drain, attempt budget, outage abstention — is merged and
 * tested, but against a **port**: there is no implementation anywhere in `src/` and no queue
 * table in any migration. `progress/collect.md` records F20's "queue-and-persistence half" as
 * merged; what merged was the logic, proven against fakes (`MEMORY.md` B-31 §4).
 *
 * That left one real choice, and the owner made it: **start D-16's forward-only clock now, with
 * scoring deferred**, rather than hold collection until the durable store is built. Every hour
 * the collector does not run is corpus that cannot be recovered; an unscored backlog can be.
 *
 * ## What makes the backlog recoverable rather than lost
 *
 * `collector.ts` writes `evidence_item` rows **before** it enqueues, deliberately: "if the write
 * happened first and the enqueue failed, the body is still on disk and a later sweep can
 * re-enqueue it." D-17 keeps those bodies permanently. So when the durable queue lands, the
 * backlog is reconstructible by selecting the evidence rows that have no score — nothing that
 * passes through here is destroyed, only unrecorded as *pending*.
 *
 * ## What this must never become
 *
 * A queue that looks like it works. Two guards against that:
 *
 * 1. `lease` returns nothing, always. A worker pointed at this queue drains an empty queue and
 *    correctly concludes there is no work — rather than being handed entries this object never
 *    kept and cannot produce again.
 * 2. `stats` reports `depth: 0` because that is the literal truth — nothing is stored — and the
 *    *number of items that would have been queued* is surfaced separately, by the caller, as
 *    `pendingScoring` on the job run. The count belongs where an operator reads job outcomes,
 *    not hidden behind a stats call that implies a store.
 *
 * Delete this file when the durable queue lands. It is scaffolding with a known removal date,
 * not a fallback worth keeping.
 */
import type {
  LeasedScoringEntry,
  ScoringQueueEntry,
  ScoringQueuePort,
  ScoringQueueStats,
} from './ports';

export function deferredScoringQueue(): ScoringQueuePort {
  return {
    // Accepts and drops. Idempotent per `(itemId, reason, supersedesScoreId)` in the only sense
    // available to something that keeps no state: enqueuing the same entry twice has the same
    // effect as enqueuing it once, namely none.
    enqueue: async (_entries: readonly ScoringQueueEntry[]): Promise<void> => {},

    // Never hands out work. See guard 1 above.
    lease: async (): Promise<readonly LeasedScoringEntry[]> => [],

    // Nothing was ever leased, so there is nothing to acknowledge or return.
    ack: async (): Promise<void> => {},
    release: async (): Promise<void> => {},

    stats: async (): Promise<ScoringQueueStats> => ({
      depth: 0,
      leased: 0,
      oldestEnqueuedAt: null,
    }),
  };
}
