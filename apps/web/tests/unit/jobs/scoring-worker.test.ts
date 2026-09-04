import { describe, expect, it } from 'vitest';
import type { ProviderError, ProviderMeta, ProviderResult } from '@/contracts/provider';
import type { ScoreBatchOutcome, ScoreRequestItem, ScoreResult } from '@/adapters/scorer';
import { enqueueForScoring } from '@/services/jobs/scoring-queue';
import type { ScoreBatchPort, ScoringWorkerDeps } from '@/services/jobs/scoring-worker';
import {
  drainScoringQueue,
  runScoringWorkerOnce,
  scoringBacklogCounters,
} from '@/services/jobs/scoring-worker';
import { fakeClock } from '../adapters/fakes';
import {
  batchOutcome,
  fakeHealth,
  fakeItems,
  fakeQueue,
  fakeScoreIds,
  fakeScoreStore,
  type Trace,
} from './fakes';

const FINBERT = 'ProsusAI/finbert@4556d13015211d73dccd3fdd39d39232506f3e43';
const ROBERTA = 'cardiffnlp/twitter-roberta-base-sentiment-latest@3216a57f2a0d9c45a2e6c20157c20c49fb4bf9c7';
const RUNTIME = 'sha256:1f0c2f0f6b5f4d0b9c2f8a1d3e4b5c6d7e8f90112233445566778899aabbccdd';
const HASH = 'a'.repeat(64);

const META: ProviderMeta = {
  provider: 'scorer',
  endpoint: 'score',
  requestedAt: '2026-08-30T12:00:00.000Z',
  latencyMs: 12,
  cache: 'miss',
  quotaRemaining: null,
  costUsd: null,
  payloadRef: null,
};

function scoreResultFor(item: ScoreRequestItem): ScoreResult {
  return {
    itemId: item.itemId,
    label: 'bullish',
    scores: { bullish: '0.900000', bearish: '0.050000', neutral: '0.050000' },
    scorer: {
      scorerId: item.kind,
      scorerVersion: item.kind === 'finbert' ? FINBERT : ROBERTA,
      runtimeVersion: RUNTIME,
    },
    scoredAt: '2026-08-30T12:00:00.000000Z',
    inputHash: HASH,
    truncated: false,
  };
}

/** A scorer that answers every item correctly. */
function healthyScorer(trace: Trace, seen: ScoreRequestItem[][] = []): ScoreBatchPort {
  return async (items) => {
    trace.push(`score:${items.length}`);
    seen.push([...items]);
    return { ok: true, data: batchOutcome(items.map(scoreResultFor)), meta: META };
  };
}

function failure(error: ProviderError): ProviderResult<ScoreBatchOutcome> {
  return { ok: false, error, meta: META };
}

/** A scorer that is down. Every failure mode of the wire arrives as one of these. */
function deadScorer(trace: Trace, error: ProviderError = { kind: 'upstream', status: 503 }): ScoreBatchPort {
  return async (items) => {
    trace.push(`score:${items.length}`);
    return failure(error);
  };
}

function harness(options: { texts?: Record<string, string>; score?: ScoreBatchPort } = {}) {
  const trace: Trace = [];
  const queue = fakeQueue(trace);
  const items = fakeItems(trace, options.texts ?? {});
  const store = fakeScoreStore(trace);
  const health = fakeHealth(trace);
  const { clock, advance } = fakeClock();
  const deps: ScoringWorkerDeps = {
    queue: queue.port,
    items: items.port,
    store: store.port,
    health: health.port,
    score: options.score ?? healthyScorer(trace),
    clock,
    newScoreId: fakeScoreIds(),
  };
  return { trace, queue, items, store, health, deps, advance };
}

const AT = new Date('2026-08-30T12:00:00.000Z');

async function seed(h: ReturnType<typeof harness>, ids: string[]) {
  await enqueueForScoring(
    { items: ids.map((itemId) => ({ itemId, axis: 'reddit' as const, form: 'post' as const })), at: AT },
    { queue: h.queue.port },
  );
  for (const id of ids) h.items.write(id, `body of ${id}`);
}

describe('F20 §4.3 — every score row carries the six provenance fields', () => {
  it('writes scorer_id, scorer_version, runtime_version, input_hash, truncated and scorer_provenance', async () => {
    const h = harness();
    await seed(h, ['item-1']);

    const outcome = await runScoringWorkerOnce(h.deps);

    expect(outcome.scored).toBe(1);
    const row = h.store.rows[0]!;
    expect(row.scorerId).toBe('finbert');
    expect(row.scorerVersion).toBe(FINBERT);
    expect(row.runtimeVersion).toBe(RUNTIME);
    expect(row.inputHash).toBe(HASH);
    expect(row.truncated).toBe(false);
    expect(row.scorerProvenance).toBe('pinned');
    // Every one of the six, present and non-empty — the Tier D3 completeness counter.
    for (const key of ['scorerId', 'scorerVersion', 'runtimeVersion', 'inputHash', 'scorerProvenance'] as const) {
      expect(row[key]).toBeTruthy();
    }
  });

  it('only ever writes scorer_provenance = pinned in v1', async () => {
    const h = harness();
    await seed(h, ['item-1', 'item-2', 'item-3']);

    await runScoringWorkerOnce(h.deps);

    expect(h.store.rows).toHaveLength(3);
    expect(new Set(h.store.rows.map((row) => row.scorerProvenance))).toEqual(new Set(['pinned']));
  });

  it('keeps every score as the decimal string the scorer sent, byte for byte', async () => {
    const h = harness({
      score: async (items) => ({
        ok: true,
        // A value that a float round-trip would silently rewrite: `String(Number('0.100000'))`
        // is `'0.1'`. If anything in this path touched a JS number, this assertion fails.
        data: batchOutcome(
          items.map((item) => ({
            ...scoreResultFor(item),
            scores: { bullish: '0.100000', bearish: '0.100000', neutral: '0.800000' },
          })),
        ),
        meta: META,
      }),
    });
    await seed(h, ['item-1']);

    await runScoringWorkerOnce(h.deps);

    expect(h.store.rows[0]!.scores).toEqual({
      bullish: '0.100000',
      bearish: '0.100000',
      neutral: '0.800000',
    });
  });
});

describe('F20 §4.2 rule 1 — a scorer outage grows the backlog and loses nothing', () => {
  it('writes no score, returns every entry to the queue, and records the outage', async () => {
    const h = harness({ score: deadScorer([]) });
    await seed(h, ['item-1', 'item-2']);

    const outcome = await runScoringWorkerOnce(h.deps);

    expect(outcome.scorerAvailable).toBe(false);
    expect(outcome.scored).toBe(0);
    expect(h.store.rows).toEqual([]);
    expect(h.store.unscoreable).toEqual([]);
    expect(h.queue.outstandingItemIds()).toEqual(['item-1', 'item-2']);
    expect(outcome.backlog.depth).toBe(2);
    expect(h.health.current()).toMatchObject({ state: 'outage' });
  });

  it('does not spend the attempt budget on a failure the items did not cause', async () => {
    const h = harness({ score: deadScorer([]) });
    await seed(h, ['item-1']);

    for (let pass = 0; pass < 8; pass += 1) await runScoringWorkerOnce(h.deps);

    // Eight failed passes, zero attempts charged. Under D-16 there is no backfill, so an item
    // must never be given up on because the *service* was down for a while.
    expect(h.queue.attemptsFor('item-1')).toBe(0);
    expect(h.queue.outstandingItemIds()).toEqual(['item-1']);
    expect(h.trace).toContain('queue.release:1:no-attempt');
    expect(h.trace).not.toContain('queue.release:1:attempt');
  });

  it('drains the whole backlog when the scorer comes back', async () => {
    const trace: Trace = [];
    let up = false;
    const h = harness({
      score: async (items) => {
        trace.push(`score:${items.length}`);
        if (!up) return failure({ kind: 'upstream', status: 503 });
        return { ok: true, data: batchOutcome(items.map(scoreResultFor)), meta: META };
      },
    });
    await seed(h, ['item-1', 'item-2', 'item-3', 'item-4', 'item-5']);

    const down = await runScoringWorkerOnce(h.deps, { batchSize: 2 });
    expect(down.scorerAvailable).toBe(false);
    expect(h.queue.outstandingItemIds()).toHaveLength(5);

    up = true;
    const drained = await drainScoringQueue(h.deps, { batchSize: 2 });

    expect(drained.scored).toBe(5);
    expect(h.queue.outstandingItemIds()).toEqual([]);
    expect(h.store.rows.map((row) => row.itemId).sort()).toEqual([
      'item-1',
      'item-2',
      'item-3',
      'item-4',
      'item-5',
    ]);
    expect(h.health.current().state).toBe('ok');
  });

  it('holds the first failure timestamp for the whole outage, not the latest one', async () => {
    const h = harness({ score: deadScorer([]) });
    await seed(h, ['item-1']);

    await runScoringWorkerOnce(h.deps);
    const first = h.health.current();
    h.advance(3_600_000);
    await runScoringWorkerOnce(h.deps);

    // F18 renders "unavailable since {ts}". Restarting the clock on every failed pass would
    // make a one-hour outage read as seconds old, forever.
    expect(h.health.current().since).toBe(first.since);
  });
});

describe('F20 §4.2 rule 2 — nothing is substituted for a missing score', () => {
  it('never appends a row on any failure branch', async () => {
    const errors: ProviderError[] = [
      { kind: 'timeout' },
      { kind: 'upstream', status: 503 },
      { kind: 'circuit_open', openedAt: '2026-08-30T12:00:00.000Z' },
      { kind: 'contract', issues: ['scores.bullish: must be a decimal string'] },
      { kind: 'budget_denied', scope: 'global' },
    ];
    for (const error of errors) {
      const h = harness({ score: async () => failure(error) });
      await seed(h, ['item-1']);

      const outcome = await runScoringWorkerOnce(h.deps);

      expect(outcome.scored).toBe(0);
      expect(h.store.rows).toEqual([]);
      expect(h.trace).not.toContain('store.appendScores:1');
      expect(h.health.current().state).toBe('outage');
    }
  });

  it('charges an attempt only to the item the scorer answered wrongly about, when a sibling was admitted', async () => {
    // The rejection is attributable here because the same response admitted item-1 — proof the
    // scorer is working and item-2 specifically is the odd one out.
    const h = harness({
      score: async (items) => ({
        ok: true,
        data: batchOutcome(
          items.filter((item) => item.itemId === 'item-1').map(scoreResultFor),
          items
            .filter((item) => item.itemId === 'item-2')
            .map((item) => ({ itemId: item.itemId, issues: ['scorerVersion: not a commit SHA'] })),
        ),
        meta: META,
      }),
    });
    await seed(h, ['item-1', 'item-2']);

    await runScoringWorkerOnce(h.deps);

    expect(h.queue.attemptsFor('item-2')).toBe(1);
    expect(h.trace).toContain('queue.release:1:attempt');
  });

  it('does not charge a solo rejected item — nothing in the same response proves it, not the service, is at fault', async () => {
    // THE REGRESSION a third lane-review pass found: with only one item leased, a persistent
    // per-item rejection and a systemic scorer regression (e.g. a deploy that regressed to
    // emitting JSON numbers for every row) are indistinguishable from inside this pass — both
    // produce `admitted: []`. Charging this item the same way the mixed-batch case above does
    // would, for a real systemic regression, permanently mark every affected item unscoreable
    // with a detail string ("the scorer returned an inadmissible result for this item N times")
    // that is false for all of them. So a rejection with nothing admitted alongside it is
    // treated like the batch-level `ok:false` case: uncharged, backlog grows, forever if the
    // rejection never clears. That is a real, accepted cost — a solo bad item can no longer be
    // given up on — traded for never falsely mass-labelling a systemic failure as N individual
    // item defects.
    const h = harness({
      score: async (items) => ({
        ok: true,
        data: batchOutcome(
          [],
          items.map((item) => ({ itemId: item.itemId, issues: ['unpinned revision'] })),
        ),
        meta: META,
      }),
    });
    await seed(h, ['item-1']);

    for (let pass = 0; pass < 6; pass += 1) await runScoringWorkerOnce(h.deps, { maxAttempts: 3 });

    expect(h.queue.attemptsFor('item-1')).toBe(0);
    expect(h.store.unscoreable).toEqual([]);
    expect(h.queue.outstandingItemIds()).toEqual(['item-1']);
  });

  it('still gives up on an item the scorer keeps answering wrongly about, as long as it is never alone', async () => {
    // The mirror of the case above: item-2 is persistently rejected, but a fresh, always-good
    // item accompanies it into every pass — an ongoing initial-scoring stream, not a one-off
    // bundle — so `admitted` is never empty and the rejection stays attributable throughout.
    const h = harness({
      score: async (items) => ({
        ok: true,
        data: batchOutcome(
          items.filter((item) => item.itemId !== 'item-2').map(scoreResultFor),
          items
            .filter((item) => item.itemId === 'item-2')
            .map((item) => ({ itemId: item.itemId, issues: ['unpinned revision'] })),
        ),
        meta: META,
      }),
    });
    await seed(h, ['item-2']);

    for (let pass = 0; pass < 6; pass += 1) {
      await seed(h, [`item-good-${String(pass)}`]);
      await runScoringWorkerOnce(h.deps, { maxAttempts: 3 });
    }

    expect(h.store.unscoreable).toEqual([
      expect.objectContaining({ itemId: 'item-2', reason: 'scorer_contract_violation' }),
    ]);
    expect(h.queue.outstandingItemIds()).not.toContain('item-2');
  });
});

describe('one bad row must not poison its neighbours (lane-review finding 1)', () => {
  /** Admits everything except `poisoned`, which comes back per-item rejected. */
  const withOnePoisoned =
    (poisoned: string): ScoreBatchPort =>
    async (items) => ({
      ok: true,
      data: batchOutcome(
        items.filter((item) => item.itemId !== poisoned).map(scoreResultFor),
        items
          .filter((item) => item.itemId === poisoned)
          .map((item) => ({ itemId: item.itemId, issues: ['scores.bullish: is not a string'] })),
      ),
      meta: META,
    });

  it('scores the good items in the same batch immediately', async () => {
    const h = harness({ score: withOnePoisoned('item-2') });
    await seed(h, ['item-1', 'item-2', 'item-3']);

    const outcome = await runScoringWorkerOnce(h.deps);

    expect(outcome.scored).toBe(2);
    expect(h.store.rows.map((row) => row.itemId)).toEqual(['item-1', 'item-3']);
    // Only the poisoned one goes back, and only it is charged.
    expect(h.queue.outstandingItemIds()).toEqual(['item-2']);
    expect(h.queue.attemptsFor('item-2')).toBe(1);
  });

  it('never charges an attempt to an item the scorer answered correctly', async () => {
    const h = harness({ score: withOnePoisoned('item-2') });
    await seed(h, ['item-1', 'item-2', 'item-3']);

    // item-1/item-3 are only there for the first pass — once scored and acked they cannot keep
    // proving item-2's rejection attributable on later passes, so a fresh companion is seeded
    // each round (a stand-in for the ongoing initial-scoring stream a real collector provides).
    // Without one, item-2 would end up leased alone from pass 2 onward, `admitted` would be
    // empty, and per the third lane-review-round fix it would never be charged again — the
    // correct outcome for a solo rejection, but not what *this* test is checking (a persistent
    // rejection that genuinely stays attributable throughout).
    for (let pass = 0; pass < 6; pass += 1) {
      await seed(h, [`item-good-${String(pass)}`]);
      await runScoringWorkerOnce(h.deps, { maxAttempts: 3 });
    }

    // THE REGRESSION (first lane-review round). Before that fix all three items ended up
    // unscoreable, each with a detail claiming the scorer had returned an inadmissible result
    // for it — false for two of the three — and nothing re-enqueued them. That is permanent
    // loss of up to 31 good items per bad one at the default batch size, in the feature whose
    // stated purpose is that an outage loses nothing (D-16, §4.2 rule 1).
    expect(h.store.unscoreable).toEqual([
      expect.objectContaining({ itemId: 'item-2', reason: 'scorer_contract_violation' }),
    ]);
    expect(h.store.rows.map((row) => row.itemId)).toContain('item-1');
    expect(h.store.rows.map((row) => row.itemId)).toContain('item-3');
    expect(h.queue.outstandingItemIds()).not.toContain('item-2');
  });

  it('treats a whole-response failure as an outage, charging nobody', async () => {
    // A response that is not a JSON array at all is indistinguishable from the service being
    // broken, and says nothing about any individual item. Charging attempts for it would
    // eventually mark the entire corpus unscoreable, one batch at a time.
    const h = harness({
      score: async () => failure({ kind: 'contract', issues: ['expected array, received object'] }),
    });
    await seed(h, ['item-1', 'item-2', 'item-3']);

    for (let pass = 0; pass < 10; pass += 1) await runScoringWorkerOnce(h.deps, { maxAttempts: 3 });

    expect(h.store.unscoreable).toEqual([]);
    expect(h.queue.outstandingItemIds()).toEqual(['item-1', 'item-2', 'item-3']);
    expect(h.queue.attemptsFor('item-1')).toBe(0);
    expect(h.health.current().state).toBe('outage');
  });

  it('reports an outage when every row in the response was refused', async () => {
    const h = harness({
      score: async (items) => ({
        ok: true,
        data: batchOutcome(
          [],
          items.map((item) => ({ itemId: item.itemId, issues: ['label: invalid'] })),
        ),
        meta: META,
      }),
    });
    await seed(h, ['item-1']);

    const outcome = await runScoringWorkerOnce(h.deps);

    // The service is up and producing nothing usable. Dependent metrics must abstain, or they
    // would render against a corpus that has silently stopped growing.
    expect(outcome.scorerAvailable).toBe(false);
    expect(h.health.current().state).toBe('outage');
  });
});

describe('giving up without discarding a score the item already has (lane-review finding 2)', () => {
  it('abandons a re-score whose body was purged, leaving the predecessor standing', async () => {
    const h = harness();
    await seed(h, ['item-1']);
    await runScoringWorkerOnce(h.deps);
    expect(h.store.rows).toHaveLength(1);

    // A re-score is queued, and the body vanishes before the worker leases it.
    await h.queue.port.enqueue([
      {
        itemId: 'item-1',
        axis: 'reddit',
        form: 'post',
        scorerId: 'finbert',
        reason: 'rescore',
        supersedesScoreId: h.store.rows[0]!.scoreId,
        targetScorerVersion: `ProsusAI/finbert@${'0'.repeat(40)}`,
        enqueuedAt: AT.toISOString(),
      },
    ]);
    h.items.purge('item-1');

    const outcome = await runScoringWorkerOnce(h.deps);

    // No `text_unavailable` row: one demonstrably CAN exist, and does. Writing it would drop the
    // item from `n` on every dependent metric and label it "no score can ever exist".
    expect(h.store.unscoreable).toEqual([]);
    expect(outcome.abandoned).toEqual(['item-1']);
    expect(h.store.rows).toHaveLength(1);
    expect(h.queue.outstandingItemIds()).toEqual([]);
  });

  it('still records text_unavailable for an item that never had a score', async () => {
    const h = harness();
    await seed(h, ['item-1']);
    h.items.purge('item-1');

    const outcome = await runScoringWorkerOnce(h.deps);

    expect(outcome.abandoned).toEqual([]);
    expect(h.store.unscoreable).toEqual([
      expect.objectContaining({ itemId: 'item-1', reason: 'text_unavailable' }),
    ]);
  });
});

describe('a re-score must land under the revision it asked for (lane-review finding 3)', () => {
  const OTHER_PIN = `ProsusAI/finbert@${'a'.repeat(40)}`;

  const rescoreEntry = (target: string) => ({
    itemId: 'item-1',
    axis: 'reddit' as const,
    form: 'post' as const,
    scorerId: 'finbert' as const,
    reason: 'rescore' as const,
    supersedesScoreId: 'score-1',
    targetScorerVersion: target,
    enqueuedAt: AT.toISOString(),
  });

  it('writes no successor when the service is still on the old pin, and says so', async () => {
    const h = harness();
    await seed(h, ['item-1']);
    await runScoringWorkerOnce(h.deps);
    const afterInitial = h.store.rows.length;

    // The fake scorer always answers under FINBERT. The operator asked for a different pin.
    await h.queue.port.enqueue([rescoreEntry(OTHER_PIN)]);
    const outcome = await runScoringWorkerOnce(h.deps);

    // THE REGRESSION. Before this fix the successor was written under the OLD revision, the
    // window stayed homogeneous so nothing downstream could tell, `already_at_target` never
    // fired because the version never moved, and every later run appended another identical
    // successor forever while the operator believed the migration had happened.
    expect(outcome.scored).toBe(0);
    expect(h.store.rows).toHaveLength(afterInitial);
    expect(outcome.staleRevisions).toEqual([
      { itemId: 'item-1', expected: OTHER_PIN, actual: FINBERT },
    ]);
  });

  it('does not append a duplicate successor however many times it is run', async () => {
    const h = harness();
    await seed(h, ['item-1']);
    await runScoringWorkerOnce(h.deps);

    await h.queue.port.enqueue([rescoreEntry(OTHER_PIN)]);
    for (let pass = 0; pass < 5; pass += 1) await runScoringWorkerOnce(h.deps, { maxAttempts: 3 });

    expect(h.store.rows).toHaveLength(1);
  });

  it('abandons the re-score once the attempts run out, keeping the predecessor', async () => {
    const h = harness();
    await seed(h, ['item-1']);
    await runScoringWorkerOnce(h.deps);

    await h.queue.port.enqueue([rescoreEntry(OTHER_PIN)]);
    for (let pass = 0; pass < 8; pass += 1) await runScoringWorkerOnce(h.deps, { maxAttempts: 3 });

    // Not marked unscoreable — the item has a perfectly good score. The re-score simply could
    // not be performed, and the entry stops occupying the head of the backlog.
    expect(h.store.unscoreable).toEqual([]);
    expect(h.store.rows).toHaveLength(1);
    expect(h.queue.outstandingItemIds()).toEqual([]);
  });

  it('writes the successor when the service really is on the new pin', async () => {
    const h = harness();
    await seed(h, ['item-1']);
    await runScoringWorkerOnce(h.deps);

    // targetScorerVersion matches what the fake scorer actually answers under.
    await h.queue.port.enqueue([rescoreEntry(FINBERT)]);
    const outcome = await runScoringWorkerOnce(h.deps);

    expect(outcome.staleRevisions).toEqual([]);
    expect(outcome.scored).toBe(1);
    expect(h.store.rows).toHaveLength(2);
    expect(h.store.rows[1]!.supersedesScoreId).toBe('score-1');
  });
});

describe('a stale-revision refusal is not an outage (lane-review finding 1, second round)', () => {
  const OTHER_PIN = `ProsusAI/finbert@${'a'.repeat(40)}`;

  it('marks the scorer healthy when every chargeable entry was a stale-revision skip', async () => {
    const h = harness();
    await seed(h, ['item-1']);
    await runScoringWorkerOnce(h.deps);

    await h.queue.port.enqueue([
      {
        itemId: 'item-1',
        axis: 'reddit',
        form: 'post',
        scorerId: 'finbert',
        reason: 'rescore',
        supersedesScoreId: h.store.rows[0]!.scoreId,
        targetScorerVersion: OTHER_PIN,
        enqueuedAt: AT.toISOString(),
      },
    ]);
    const outcome = await runScoringWorkerOnce(h.deps);

    // THE REGRESSION. Before this fix, a pass in which every candidate was refused only for a
    // stale revision fell into the outage branch and called `markOutage` — marking a scorer
    // that answered every request correctly as being down, which stalls the whole backlog
    // behind a false "scorer unavailable" banner.
    expect(outcome.staleRevisions).toHaveLength(1);
    expect(outcome.scorerAvailable).toBe(true);
    expect(h.health.current().state).toBe('ok');
  });

  it('still marks an outage when a stale revision and a genuine rejection share a pass', async () => {
    const h = harness({
      score: async (items) => ({
        ok: true,
        data: batchOutcome(
          items.filter((item) => item.itemId === 'item-1').map(scoreResultFor),
          items
            .filter((item) => item.itemId === 'item-2')
            .map((item) => ({ itemId: item.itemId, issues: ['scores.bullish: is not a string'] })),
        ),
        meta: META,
      }),
    });
    h.items.write('item-1', 'body of item-1');
    await h.queue.port.enqueue([
      {
        itemId: 'item-1',
        axis: 'reddit',
        form: 'post',
        scorerId: 'finbert',
        reason: 'rescore',
        supersedesScoreId: null,
        targetScorerVersion: OTHER_PIN,
        enqueuedAt: AT.toISOString(),
      },
    ]);
    await seed(h, ['item-2']);

    const outcome = await runScoringWorkerOnce(h.deps);

    // One stale-revision skip and one genuine contract rejection in the same pass: the scorer
    // really did misbehave for item-2, so this must still read as an outage rather than the
    // healthy state the previous test expects for an all-stale-revision pass.
    expect(outcome.staleRevisions).toHaveLength(1);
    expect(outcome.scorerAvailable).toBe(false);
    expect(h.health.current().state).toBe('outage');
  });

  it('drainScoringQueue paces one attempt per call on an all-stale pass, rather than self-exhausting', async () => {
    const h = harness();
    await seed(h, ['item-1']);
    await runScoringWorkerOnce(h.deps);
    const predecessorScoreId = h.store.rows[0]!.scoreId;

    await h.queue.port.enqueue([
      {
        itemId: 'item-1',
        axis: 'reddit',
        form: 'post',
        scorerId: 'finbert',
        reason: 'rescore',
        supersedesScoreId: predecessorScoreId,
        targetScorerVersion: OTHER_PIN,
        enqueuedAt: AT.toISOString(),
      },
    ]);

    // THE REGRESSION (second lane-review pass). `scorerAvailable: true` on an all-stale pass is
    // correct for health reporting, but `drainScoringQueue` used to read that same flag as its
    // sole "keep going" signal. Before this fix, one `drainScoringQueue({maxAttempts:3})` call
    // burned all 3 attempts and abandoned the re-score in a single tick instead of pacing one
    // charged attempt per scheduled dispatcher run.
    const drained = await drainScoringQueue(h.deps, { maxAttempts: 3 });

    expect(drained.passes).toBe(1);
    expect(h.queue.attemptsFor('item-1')).toBe(1);
    expect(h.queue.outstandingItemIds()).toEqual(['item-1']); // still in the backlog, not abandoned yet
  });
});

describe('a batch-level 400 or 401/403 is never charged either (lane-review finding 2, reverted)', () => {
  // A second-round fix tried charging these, reasoning that a 4xx must be a permanent,
  // request-shaped bug rather than a transient outage. Reverted: `services/scorer/app.py`
  // returns its whole-request 400 when *any single item* in the batch carries an unregistered
  // `kind` or a missing field, so a batch-level 400 says exactly as little about which item is
  // at fault as the `contract` case below — charging every leased entry for it reintroduces the
  // "one bad item poisons its neighbours" bug this module's own doc already names as fixed.
  // Caught by a second lane-review pass on the reverted fix itself.
  it('does not charge a 400', async () => {
    const h = harness({ score: deadScorer([], { kind: 'upstream', status: 400 }) });
    await seed(h, ['item-1']);

    await runScoringWorkerOnce(h.deps);

    expect(h.queue.attemptsFor('item-1')).toBe(0);
    expect(h.trace).toContain('queue.release:1:no-attempt');
  });

  it('does not charge an entitlement failure (401/403)', async () => {
    const h = harness({
      score: deadScorer([], { kind: 'entitlement', endpoint: 'score', status: 401 }),
    });
    await seed(h, ['item-1']);

    await runScoringWorkerOnce(h.deps);

    expect(h.queue.attemptsFor('item-1')).toBe(0);
  });

  it('never marks a batch of good items unscoreable because one of them had a bad kind', async () => {
    // The concrete scenario the revert protects: two good items and one whose scorerId the
    // deployed container does not recognize. The service (correctly, per its own contract)
    // 400s the whole request rather than partially answering. None of the three may be
    // permanently penalized for the other's problem.
    const h = harness({ score: deadScorer([], { kind: 'upstream', status: 400 }) });
    await seed(h, ['item-1', 'item-2', 'item-3']);

    for (let pass = 0; pass < 10; pass += 1) await runScoringWorkerOnce(h.deps, { maxAttempts: 3 });

    expect(h.store.unscoreable).toEqual([]);
    expect(h.queue.outstandingItemIds().sort()).toEqual(['item-1', 'item-2', 'item-3']);
    expect(h.queue.attemptsFor('item-1')).toBe(0);
  });

  it('still releases a real outage (503) uncharged, as before', async () => {
    const h = harness({ score: deadScorer([]) });
    await seed(h, ['item-1']);

    await runScoringWorkerOnce(h.deps);

    expect(h.queue.attemptsFor('item-1')).toBe(0);
  });
});

describe('drainScoringQueue still stops on the first real outage (lane-review, fifth round)', () => {
  it('does not keep hammering a dead scorer just because unrelated purged items were cleaned up in the same pass', async () => {
    const trace: Trace = [];
    const h = harness({ score: deadScorer(trace) });
    // item-2's body is purged (D-17) — resolved before the scorer is ever called, independent
    // of whether the call that follows succeeds. item-1 is left for the (dead) scorer.
    await seed(h, ['item-1', 'item-2']);
    h.items.purge('item-2');

    // THE REGRESSION. A fourth-round version of the loop condition let `unscoreable.length > 0`
    // (from item-2's purge, nothing to do with the scorer) override `!scorerAvailable`, so a
    // dead scorer plus an ordinary trickle of purged bodies — D-17 guarantees these exist —
    // kept the drain calling the dead service once per pass for the rest of `maxPasses`, instead
    // of stopping on the first failure the way this function's own doc promises.
    const drained = await drainScoringQueue(h.deps, { maxPasses: 10 });

    expect(drained.passes).toBe(1);
    expect(trace.filter((entry) => entry.startsWith('score:'))).toHaveLength(1);
    expect(h.store.unscoreable).toEqual([
      expect.objectContaining({ itemId: 'item-2', reason: 'text_unavailable' }),
    ]);
    expect(h.queue.outstandingItemIds()).toEqual(['item-1']);
  });
});

describe('D-17 — an item whose text is gone is recorded, never scored empty', () => {
  it('records text_unavailable and does not send the item to the scorer', async () => {
    const seen: ScoreRequestItem[][] = [];
    const trace: Trace = [];
    const h = harness({ score: healthyScorer(trace, seen) });
    await seed(h, ['item-1', 'item-2']);
    h.items.purge('item-2'); // deleted upstream and purged — D-17's unrecoverable case

    const outcome = await runScoringWorkerOnce(h.deps);

    expect(outcome.scored).toBe(1);
    expect(h.store.unscoreable).toEqual([
      expect.objectContaining({ itemId: 'item-2', reason: 'text_unavailable' }),
    ]);
    expect(seen.flat().map((item) => item.itemId)).toEqual(['item-1']);
    expect(h.queue.outstandingItemIds()).toEqual([]);
  });

  it('never calls the scorer at all when no leased item has text left', async () => {
    const trace: Trace = [];
    const h = harness({ score: healthyScorer(trace) });
    await seed(h, ['item-1']);
    h.items.purge('item-1');

    const outcome = await runScoringWorkerOnce(h.deps);

    expect(outcome.scored).toBe(0);
    expect(trace.some((entry) => entry.startsWith('score:'))).toBe(false);
    expect(h.health.current().state).toBe('ok');
  });
});

describe('the worker pass itself', () => {
  it('persists before it acks, so a crash between the two redelivers rather than loses', async () => {
    const h = harness();
    await seed(h, ['item-1']);

    await runScoringWorkerOnce(h.deps);

    const appendAt = h.trace.indexOf('store.appendScores:1');
    const ackAt = h.trace.indexOf('queue.ack:1');
    expect(appendAt).toBeGreaterThanOrEqual(0);
    expect(ackAt).toBeGreaterThan(appendAt);
  });

  it('a redelivered append does not double-write, even under a fresh scoreId (lane-review finding 3)', async () => {
    const h = harness();
    await seed(h, ['item-1']);
    await runScoringWorkerOnce(h.deps);
    expect(h.store.rows).toHaveLength(1);
    const original = h.store.rows[0]!;

    // Simulates the crash-between-append-and-ack case: the same row content, freshly minted
    // scoreId, appended a second time because the lease was never acked and came back.
    await h.store.port.appendScores({
      rows: [{ ...original, scoreId: 'a-completely-different-score-id' }],
    });

    // THE REGRESSION. `scoreId` never repeats across calls (it is minted fresh each time), so a
    // dedup keyed on it — the module's own comment used to claim this was the guard — catches
    // nothing here, and the redelivery would silently double-count `n` for this item.
    expect(h.store.rows).toHaveLength(1);
    expect(h.store.rows[0]!.scoreId).toBe(original.scoreId);
  });

  it('makes no scorer call and no health claim when the queue is empty', async () => {
    const trace: Trace = [];
    const h = harness({ score: healthyScorer(trace) });

    const outcome = await runScoringWorkerOnce(h.deps);

    expect(outcome).toMatchObject({ leased: 0, scored: 0, scorerAvailable: true });
    expect(trace.some((entry) => entry.startsWith('score:'))).toBe(false);
    // An empty queue is not evidence the scorer recovered. Marking it healthy here would clear
    // a real outage the moment the backlog happened to drain.
    expect(h.trace).not.toContain('health.markHealthy');
  });

  it('returns an item the scorer silently skipped, and still writes the ones it answered', async () => {
    const h = harness({
      score: async (items) => ({
        ok: true,
        data: batchOutcome(items.filter((item) => item.itemId !== 'item-2').map(scoreResultFor)),
        meta: META,
      }),
    });
    await seed(h, ['item-1', 'item-2']);

    const outcome = await runScoringWorkerOnce(h.deps);

    expect(outcome.scored).toBe(1);
    expect(outcome.returnedToQueue).toBe(1);
    expect(h.store.rows.map((row) => row.itemId)).toEqual(['item-1']);
    expect(h.queue.outstandingItemIds()).toEqual(['item-2']);
  });

  it('leases in enqueue order and honours the batch size', async () => {
    const trace: Trace = [];
    const seen: ScoreRequestItem[][] = [];
    const h = harness({ score: healthyScorer(trace, seen) });
    await seed(h, ['item-1', 'item-2', 'item-3']);

    await runScoringWorkerOnce(h.deps, { batchSize: 2 });

    expect(seen[0]!.map((item) => item.itemId)).toEqual(['item-1', 'item-2']);
  });

  it('reports the operator counters §4.2 rule 3 asks for', () => {
    const counters = scoringBacklogCounters(
      { depth: 4, leased: 2, oldestEnqueuedAt: '2026-08-30T11:00:00.000Z' },
      new Date('2026-08-30T12:00:00.000Z'),
    );
    expect(counters).toEqual({ depth: 4, leased: 2, oldestUnscoredAgeMs: 3_600_000 });
    expect(scoringBacklogCounters({ depth: 0, leased: 0, oldestEnqueuedAt: null }, new Date()).oldestUnscoredAgeMs).toBeNull();
  });
});
