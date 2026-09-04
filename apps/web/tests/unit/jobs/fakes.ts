/**
 * In-memory implementations of `services/jobs/ports.ts`, all of which record what they were
 * asked and in what order.
 *
 * The recording is the point, exactly as it is in `tests/unit/adapters/fakes.ts`. Several of
 * F20's Definition-of-Done items are statements about *sequence* — "collection loses nothing
 * while the scorer is down", "a re-score writes a successor and does not mutate" — and an
 * implementation that got the right final values by acking before it persisted, or by updating
 * a predecessor instead of appending, would pass every value-based assertion. `trace` is what
 * separates them.
 *
 * The score store is **append-only and deep-frozen**. A frozen row makes an in-place mutation
 * throw at the moment it happens rather than showing up as a wrong value three assertions
 * later, which is the difference between a test that localises F20 §7 step 7's defect and one
 * that merely notices it.
 */
import type { RejectedScore, ScoreBatchOutcome, ScoreResult } from '@/adapters/scorer';
import type {
  LeasedScoringEntry,
  RawItemReaderPort,
  ScoreRow,
  ScoreStorePort,
  ScoreableText,
  ScorerHealth,
  ScorerHealthPort,
  ScoringQueueEntry,
  ScoringQueuePort,
  UnscoreableRow,
} from '@/services/jobs/ports';

export type Trace = string[];

type Slot = {
  entry: ScoringQueueEntry;
  /** Insertion order, so a release restores an entry's original position in the backlog. */
  seq: number;
  attempts: number;
  leaseId: string | null;
};

function idempotencyKey(entry: ScoringQueueEntry): string {
  return `${entry.itemId}|${entry.reason}|${entry.supersedesScoreId ?? ''}`;
}

/**
 * A FIFO queue with leases. Stands in for the Redis list plus its Postgres mirror; the
 * durability property belongs to that implementation, and every ordering property F20 §4.2
 * asserts is visible without it.
 *
 * Idempotency is enforced over *outstanding* entries, which is what the port's contract needs
 * for the overlapping-poll case. A real implementation would carry a unique index on the
 * mirror.
 */
export function fakeQueue(trace: Trace) {
  const slots: Slot[] = [];
  let seq = 0;
  let leaseCounter = 0;

  const port: ScoringQueuePort = {
    enqueue: async (entries) => {
      trace.push(`queue.enqueue:${entries.length}`);
      const outstanding = new Set(slots.map((slot) => idempotencyKey(slot.entry)));
      for (const entry of entries) {
        const key = idempotencyKey(entry);
        if (outstanding.has(key)) continue;
        outstanding.add(key);
        seq += 1;
        slots.push({ entry, seq, attempts: 0, leaseId: null });
      }
    },
    lease: async ({ max }) => {
      const waiting = slots
        .filter((slot) => slot.leaseId === null)
        .sort((a, b) => {
          const byTime = Date.parse(a.entry.enqueuedAt) - Date.parse(b.entry.enqueuedAt);
          return byTime !== 0 ? byTime : a.seq - b.seq;
        })
        .slice(0, max);
      const leased: LeasedScoringEntry[] = waiting.map((slot) => {
        leaseCounter += 1;
        slot.leaseId = `lease-${leaseCounter}`;
        return { ...slot.entry, leaseId: slot.leaseId, attempts: slot.attempts };
      });
      trace.push(`queue.lease:${leased.length}`);
      return leased;
    },
    ack: async ({ leaseIds }) => {
      trace.push(`queue.ack:${leaseIds.length}`);
      for (const leaseId of leaseIds) {
        const index = slots.findIndex((slot) => slot.leaseId === leaseId);
        if (index >= 0) slots.splice(index, 1);
      }
    },
    release: async ({ leaseIds, countsAsAttempt }) => {
      trace.push(`queue.release:${leaseIds.length}:${countsAsAttempt ? 'attempt' : 'no-attempt'}`);
      for (const leaseId of leaseIds) {
        const slot = slots.find((candidate) => candidate.leaseId === leaseId);
        if (slot === undefined) continue;
        slot.leaseId = null;
        if (countsAsAttempt) slot.attempts += 1;
      }
    },
    stats: async () => {
      const enqueuedAts = slots.map((slot) => slot.entry.enqueuedAt).sort();
      return {
        depth: slots.filter((slot) => slot.leaseId === null).length,
        leased: slots.filter((slot) => slot.leaseId !== null).length,
        oldestEnqueuedAt: enqueuedAts[0] ?? null,
      };
    },
  };

  return {
    port,
    slots,
    /** Every item id still in the queue, leased or not — "nothing was lost" reads off this. */
    outstandingItemIds: () => slots.map((slot) => slot.entry.itemId).sort(),
    attemptsFor: (itemId: string) => slots.find((slot) => slot.entry.itemId === itemId)?.attempts,
  };
}

/** The raw item store, holding the re-scoreable unit per D-17. */
export function fakeItems(trace: Trace, texts: Record<string, string> = {}) {
  const bodies = new Map<string, string>(Object.entries(texts));
  const port: RawItemReaderPort = {
    readScoreableText: async ({ itemIds }) => {
      trace.push(`items.read:${itemIds.length}`);
      const found: ScoreableText[] = [];
      for (const itemId of itemIds) {
        const text = bodies.get(itemId);
        // Absent, not empty: an upstream deletion that has been purged has no text at all.
        if (text !== undefined) found.push({ itemId, text });
      }
      return found;
    },
  };
  return {
    port,
    bodies,
    write: (itemId: string, text: string) => bodies.set(itemId, text),
    /** An X post deleted upstream and purged — D-17's one unrecoverable case. */
    purge: (itemId: string) => bodies.delete(itemId),
  };
}

export class DuplicateScoreIdError extends Error {}

/** Append-only, deep-frozen. There is no update path, because the port offers none. */
export function fakeScoreStore(trace: Trace) {
  const rows: ScoreRow[] = [];
  const unscoreable: UnscoreableRow[] = [];

  const port: ScoreStorePort = {
    appendScores: async ({ rows: incoming }) => {
      trace.push(`store.appendScores:${incoming.length}`);
      for (const row of incoming) {
        // Idempotent on the natural key, per `ports.ts`'s `ScoreStorePort` contract — a
        // redelivered lease mints a fresh `scoreId` for what is otherwise the same row, and
        // that repeat must be absorbed, not written a second time. Found by lane-review.
        const repeat = rows.some(
          (existing) =>
            existing.itemId === row.itemId &&
            existing.scorerVersion === row.scorerVersion &&
            existing.inputHash === row.inputHash &&
            existing.supersedesScoreId === row.supersedesScoreId,
        );
        if (repeat) continue;
        if (rows.some((existing) => existing.scoreId === row.scoreId)) {
          throw new DuplicateScoreIdError(`score ${row.scoreId} already exists`);
        }
        const frozen = Object.freeze({ ...row, scores: Object.freeze({ ...row.scores }) });
        rows.push(frozen);
      }
    },
    readScores: async ({ itemIds }) => {
      trace.push(`store.readScores:${itemIds.length}`);
      const wanted = new Set(itemIds);
      return rows.filter((row) => wanted.has(row.itemId));
    },
    appendUnscoreable: async ({ rows: incoming }) => {
      trace.push(`store.appendUnscoreable:${incoming.length}`);
      unscoreable.push(...incoming.map((row) => Object.freeze({ ...row })));
    },
    readUnscoreable: async ({ itemIds }) => {
      const wanted = new Set(itemIds);
      return unscoreable.filter((row) => wanted.has(row.itemId));
    },
  };

  return { port, rows, unscoreable };
}

export function fakeHealth(trace: Trace, initial: ScorerHealth = { state: 'ok', since: '2026-08-30T00:00:00.000Z' }) {
  let health: ScorerHealth = initial;
  const port: ScorerHealthPort = {
    markOutage: async ({ at, error }) => {
      trace.push(`health.markOutage:${error.kind}`);
      // The *first* failure's timestamp, held for as long as the outage lasts — F18 renders
      // "unavailable since {ts}", and restarting that clock on every failed pass would make
      // a two-hour outage read as thirty seconds old, forever.
      if (health.state === 'outage') {
        health = { state: 'outage', since: health.since, lastError: error };
        return;
      }
      health = { state: 'outage', since: at.toISOString(), lastError: error };
    },
    markHealthy: async ({ at }) => {
      trace.push('health.markHealthy');
      if (health.state === 'ok') return;
      health = { state: 'ok', since: at.toISOString() };
    },
    read: async () => health,
  };
  return { port, current: () => health };
}

/**
 * Wraps bare `ScoreResult`s in the per-item envelope `ScoreBatchPort` now returns.
 *
 * The envelope exists because a single bad row used to fail a whole batch and lose up to 31
 * good items with it (lane-review finding 1), so most tests want "all admitted" and a few want
 * a precisely-placed rejection.
 */
export function batchOutcome(
  admitted: readonly ScoreResult[],
  rejected: readonly RejectedScore[] = [],
): ScoreBatchOutcome {
  return { admitted: [...admitted], rejected: [...rejected] };
}

/** Deterministic score ids, so a successor chain is asserted exactly rather than by shape. */
export function fakeScoreIds(prefix = 'score') {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}-${n}`;
  };
}
