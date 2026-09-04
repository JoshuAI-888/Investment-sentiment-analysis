/**
 * F20 §5's integration row, end to end: *"Queue drains; a killed service grows the backlog and
 * loses nothing; restart resumes; re-score writes a successor and leaves the predecessor
 * intact."*
 *
 * ## What is real here and what is not
 *
 * **Real:** the whole `services/jobs/` pipeline, the `adapters/scorer.ts` wire contract, and
 * `adapters/wrapper.ts`'s nine stages — budget gate, quota ledger, cache, rate limiter, circuit
 * breaker, retry, zod validation and call log. The scorer's responses are the recorded fixtures,
 * read through `PROVIDER_MODE=fixture`'s own harness, which is how `05-TEST-STRATEGY.md` §8 says
 * CI runs.
 *
 * **Not real:** Postgres and Redis. `docs/features/F20-scorer-service.md` §4.3's table does not
 * exist yet, and `migrations/` and `repositories/` belong to SPINE — so persistence and the
 * queue arrive through the ports in `services/jobs/ports.ts`, backed by the in-memory fakes in
 * `tests/unit/jobs/fakes.ts`. Every property this file asserts is a property of the *ordering*
 * of port calls, which is exactly what survives being swapped onto a real store. What does not
 * survive, and is deferred rather than claimed, is durability across a process restart.
 *
 * "The service is killed" is expressed as the recorded 503 — which is what a platform proxy in
 * front of a dead container actually returns — driven through the real wrapper, so the failure
 * takes the same path a production outage would, breaker and all.
 */
import { describe, expect, it } from 'vitest';
import type { CollectedItem } from '@/services/jobs/scoring-queue';
import { ingestAndEnqueue } from '@/services/jobs/scoring-queue';
import { createScoreBatchPort } from '@/services/jobs/scorer-client';
import { drainScoringQueue, runScoringWorkerOnce } from '@/services/jobs/scoring-worker';
import type { ScoringWorkerDeps } from '@/services/jobs/scoring-worker';
import { enqueueRescore } from '@/services/jobs/rescore';
import { stanceGate } from '@/services/jobs/stance-availability';
import { liveScores } from '@/services/jobs/scores';
import { harness as wrapperHarness } from '../unit/adapters/fakes';
import {
  fakeHealth,
  fakeItems,
  fakeQueue,
  fakeScoreIds,
  fakeScoreStore,
  type Trace,
} from '../unit/jobs/fakes';

/** The three item ids the recorded `success` fixture answers for. */
const IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
] as const;

/**
 * One axis, because product invariant §6.1 says the three sampling frames are never
 * interchangeable — a window that mixed them would be wrong before the scorer ever saw it.
 * Forms are chosen so routing produces exactly the fixture's own per-item `scorerId`: two
 * FinBERT posts and one Twitter-RoBERTa comment.
 */
const ITEMS: CollectedItem[] = [
  { itemId: IDS[0], axis: 'reddit', form: 'post' },
  { itemId: IDS[1], axis: 'reddit', form: 'post' },
  { itemId: IDS[2], axis: 'reddit', form: 'comment' },
];

/**
 * The two items one metric window may hold together.
 *
 * F20 §5 states the Tier D3 check as *"a series containing two `scorer_version` values is
 * rejected"*, and §4.1 routes posts and comments to different models — so a window holding both
 * carries two revisions and is refused. That is the spec as written, and the consequence is
 * real: a Reddit window is post-only or comment-only until F06/F10 say otherwise. Flagged in
 * `stance-availability.ts` rather than quietly relaxed here.
 */
const FINBERT_WINDOW = [IDS[0], IDS[1]] as const;

const AT = new Date('2026-08-30T12:00:00.000Z');

/** The real, Hub-verified pins the `success` fixture carries. */
const REAL_FINBERT_PIN = 'ProsusAI/finbert@4556d13015211d73dccd3fdd39d39232506f3e43';
const REAL_ROBERTA_PIN =
  'cardiffnlp/twitter-roberta-base-sentiment-latest@3216a57f2a0d9c45a2e6c20157c20c49fb4bf9c7';

/** The deliberately synthetic second pin the `success_rescored` fixture carries — see
 *  `fixtures/scorer/README.md`. A re-score cannot be tested with only one revision. */
const SYNTHETIC_FINBERT_PIN = 'ProsusAI/finbert@0123456789abcdef0123456789abcdef01234567';
const SYNTHETIC_ROBERTA_PIN =
  'cardiffnlp/twitter-roberta-base-sentiment-latest@89abcdef0123456789abcdef0123456789abcdef';

/**
 * `serviceState` is read at call time, so a test can take the service down and bring it back
 * between worker passes without rebuilding the pipeline.
 */
function pipeline(serviceState: { case: string }) {
  const trace: Trace = [];
  const queue = fakeQueue(trace);
  const items = fakeItems(trace);
  const store = fakeScoreStore(trace);
  const health = fakeHealth(trace);
  const wrapper = wrapperHarness();
  const bodies = new Map<string, string>();

  const deps: ScoringWorkerDeps = {
    queue: queue.port,
    items: items.port,
    store: store.port,
    health: health.port,
    clock: { now: () => AT, sleep: async () => {} },
    newScoreId: fakeScoreIds(),
    score: async (batch) =>
      createScoreBatchPort(
        { providerMode: 'fixture', headers: { 'x-fixture-case': serviceState.case } },
        wrapper.deps,
      )(batch),
  };

  return {
    trace,
    queue,
    items,
    store,
    health,
    wrapper,
    deps,
    /** The collector: writes the body, then enqueues. Never touches the scorer. */
    collect: (batch: readonly CollectedItem[], at = AT) =>
      ingestAndEnqueue(
        { items: batch, at },
        {
          queue: queue.port,
          writeItems: async (written) => {
            for (const item of written) {
              bodies.set(item.itemId, `body of ${item.itemId}`);
              items.write(item.itemId, `body of ${item.itemId}`);
            }
          },
        },
      ),
  };
}

describe('F20 §5 — collector → queue → scorer → scored rows', () => {
  it('drains the queue and writes a complete provenance row for every item', async () => {
    const service = { case: 'success' };
    const p = pipeline(service);

    await p.collect(ITEMS);
    expect(p.queue.outstandingItemIds()).toEqual([...IDS].sort());

    const drained = await drainScoringQueue(p.deps);

    expect(drained.scored).toBe(3);
    expect(p.queue.outstandingItemIds()).toEqual([]);
    expect(p.store.rows).toHaveLength(3);
    for (const row of p.store.rows) {
      expect(row.scorerVersion).toMatch(/^[^@]+@[0-9a-f]{40}$/);
      expect(row.runtimeVersion).toMatch(/^sha256:/);
      expect(row.inputHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.scorerProvenance).toBe('pinned');
      expect(typeof row.truncated).toBe('boolean');
    }
    // The wrapper really ran: the call is in the log, unpriced, with no cost event.
    expect(p.wrapper.logs.map((entry) => entry.provider)).toContain('scorer');
    expect(p.wrapper.costs).toEqual([]);
  });

  it('never calls the scorer from the collection path', async () => {
    const service = { case: 'server_error' };
    const p = pipeline(service);

    // The service is dead for the whole of this. Collection completes anyway.
    const first = await p.collect(ITEMS);
    const second = await p.collect([{ itemId: 'item-4', axis: 'reddit', form: 'comment' }], new Date('2026-08-30T12:05:00.000Z'));

    expect(first.enqueued).toHaveLength(3);
    expect(second.enqueued).toHaveLength(1);
    expect(p.wrapper.calls()).toBe(0);
    expect(p.queue.outstandingItemIds()).toHaveLength(4);
  });
});

describe('F20 DoD — a killed scorer grows the backlog and loses nothing', () => {
  it('keeps collecting, keeps every item, and drains once the service is back', async () => {
    const service = { case: 'server_error' };
    const p = pipeline(service);

    await p.collect(ITEMS);

    const down = await runScoringWorkerOnce(p.deps);
    expect(down.scorerAvailable).toBe(false);
    expect(down.scored).toBe(0);
    expect(p.store.rows).toEqual([]);

    // Collection continues *during* the outage, and the backlog is what grows.
    await p.collect([{ itemId: 'item-4', axis: 'reddit', form: 'comment' }], new Date('2026-08-30T12:05:00.000Z'));
    const stillDown = await runScoringWorkerOnce(p.deps);
    expect(stillDown.backlog.depth).toBe(4);
    expect(p.health.current().state).toBe('outage');

    // Nothing was lost: every id collected is still queued.
    expect(p.queue.outstandingItemIds()).toEqual([...IDS, 'item-4'].sort());

    // Two failed passes at three attempts each have tripped the circuit breaker (source §9.4:
    // five consecutive failures, 60 seconds). That is correct behaviour and part of what
    // "restart resumes" has to survive, so the clock moves past the cooldown rather than the
    // breaker being reached around.
    p.wrapper.advance(61_000);

    // The service comes back. Only the three the fixture answers for can be scored; the fourth
    // is answered for by no fixture, so it stays queued rather than being invented.
    service.case = 'success';
    const resumed = await runScoringWorkerOnce(p.deps, { batchSize: 3 });

    expect(resumed.scorerAvailable).toBe(true);
    expect(resumed.scored).toBe(3);
    expect(p.store.rows.map((row) => row.itemId).sort()).toEqual([...IDS].sort());
    expect(p.health.current().state).toBe('ok');
    expect(p.queue.outstandingItemIds()).toEqual(['item-4']);
  });

  it('renders abstention on the dependent metric while the service is down — never a number', async () => {
    const service = { case: 'server_error' };
    const p = pipeline(service);

    await p.collect(ITEMS);
    await runScoringWorkerOnce(p.deps);

    const window = [...FINBERT_WINDOW];
    const gate = stanceGate({
      itemIds: window,
      scores: await p.store.port.readScores({ itemIds: window }),
      unscoreable: await p.store.port.readUnscoreable({ itemIds: window }),
      health: await p.health.port.read(),
    });

    expect(gate.kind).toBe('abstain');
    if (gate.kind !== 'abstain') return;
    expect(gate.abstention.reason).toBe('scorer_unavailable');
    expect(gate.abstention.message).toContain('scorer unavailable since');
    // Verified by taking the service down, not by inspection — and there is no number on this
    // branch to substitute even if a caller wanted one.
    expect('scores' in gate).toBe(false);

    // And the same window renders once the backlog drains.
    service.case = 'success';
    await drainScoringQueue(p.deps);
    const after = stanceGate({
      itemIds: window,
      scores: await p.store.port.readScores({ itemIds: window }),
      unscoreable: [],
      health: await p.health.port.read(),
    });
    expect(after.kind).toBe('ok');
    if (after.kind !== 'ok') return;
    expect(after.scores).toHaveLength(2);
  });

  it('admits the items the scorer answered correctly and isolates the one it did not', async () => {
    // The `wrong_item` fixture renames the FIRST row's itemId to something nobody requested.
    // The other two rows are perfectly good.
    const service = { case: 'wrong_item' };
    const p = pipeline(service);

    await p.collect(ITEMS);
    const outcome = await runScoringWorkerOnce(p.deps);

    // THE REGRESSION (lane-review finding 1) through the real wrapper: this used to score 0 of
    // 3 and charge an attempt to all three, so five passes later all three were permanently
    // unscoreable — two of them for a defect in a row that was not theirs.
    expect(outcome.scored).toBe(2);
    expect(p.store.rows.map((row) => row.itemId)).toEqual([IDS[1], IDS[2]]);
    expect(p.queue.outstandingItemIds()).toEqual([IDS[0]]);
    // Only the unanswered item spends an attempt.
    expect(p.trace).toContain('queue.release:1:attempt');
    expect(p.wrapper.violations).toHaveLength(1);
  });

  it('loses nothing — the malformed row stays in the backlog forever rather than being given up on', async () => {
    const service = { case: 'wrong_item' };
    const p = pipeline(service);

    await p.collect(ITEMS);
    for (let pass = 0; pass < 6; pass += 1) {
      await runScoringWorkerOnce(p.deps, { maxAttempts: 3 });
      p.wrapper.advance(61_000); // keep the breaker out of the way; it is not what is under test
    }

    // The other two are scored on pass 1 and gone. From pass 2 on, IDS[0] is the only item this
    // static fixture is ever asked about, so nothing in the response proves the rejection is
    // IDS[0]'s fault rather than a systemic scorer regression — the same "unattributable"
    // reasoning as a whole-batch `ok:false` failure (lane-review, third round). It is charged
    // once (pass 1, when IDS[1]/IDS[2] proved the service was working) and never again, so it
    // never reaches `maxAttempts` and never becomes unscoreable — it simply never clears, which
    // is the correct, disclosed trade-off: D-16 forbids ever mislabelling a systemic failure as
    // one item's defect, even at the cost of a solo bad row occupying the backlog forever.
    expect(p.store.unscoreable).toEqual([]);
    expect(p.store.rows.map((row) => row.itemId).sort()).toEqual([IDS[1], IDS[2]].sort());
    expect(p.queue.outstandingItemIds()).toEqual([IDS[0]]);
    expect(p.queue.attemptsFor(IDS[0])).toBe(1);
  });
});

describe('F20 §4.4 — re-score writes a successor through the real pipeline', () => {
  it('leaves the predecessor intact and hash-verifiable, and the read path shows the successor', async () => {
    const service = { case: 'success' };
    const p = pipeline(service);

    await p.collect(ITEMS);
    await drainScoringQueue(p.deps);
    const predecessors = p.store.rows.map((row) => ({ ...row, scores: { ...row.scores } }));
    expect(predecessors).toHaveLength(3);

    // Every predecessor is on the original pin.
    expect(new Set(predecessors.map((row) => row.scorerVersion))).toEqual(
      new Set([REAL_FINBERT_PIN, REAL_ROBERTA_PIN]),
    );

    const rescore = await enqueueRescore(
      {
        candidates: ITEMS.map((item) => ({ itemId: item.itemId, axis: item.axis, form: item.form })),
        targetScorerVersions: {
          finbert: SYNTHETIC_FINBERT_PIN,
          'tweet-roberta': SYNTHETIC_ROBERTA_PIN,
        },
        at: new Date('2026-09-01T09:00:00.000Z'),
      },
      { queue: p.queue.port, items: p.items.port, store: p.store.port },
    );

    expect(rescore.ok).toBe(true);
    if (!rescore.ok) return;
    expect(rescore.enqueued).toHaveLength(3);
    expect(rescore.enqueued.every((entry) => entry.reason === 'rescore')).toBe(true);

    // The service is redeployed onto the new pin. Without this the re-score writes nothing —
    // see the next test.
    service.case = 'success_rescored';
    await drainScoringQueue(p.deps);

    // Six rows: three predecessors, three successors. Nothing was recomputed in place.
    expect(p.store.rows).toHaveLength(6);
    for (const before of predecessors) {
      const after = p.store.rows.find((row) => row.scoreId === before.scoreId);
      // Byte-for-byte unchanged, `inputHash` included — the successor did not reach back and
      // rewrite it. This is **not** a check that the hash is correct: nothing on this side of
      // the wire re-derives a sha256 to compare against, so it proves the value is stable, not
      // that it is right. DoD item 6's "hash-verifiable" is a claim about the scorer service's
      // own output, not something this test can independently confirm — found by lane-review,
      // which correctly read the old comment here as claiming more than the assertion below it
      // checked.
      expect(after).toEqual(before);
      // And still on the OLD pin — the successor did not reach back and rewrite it.
      expect(after!.scorerVersion).not.toBe(SYNTHETIC_FINBERT_PIN);
    }

    const live = liveScores(p.store.rows);
    expect(live).toHaveLength(3);
    expect(live.every((row) => row.supersedesScoreId !== null)).toBe(true);
    expect(new Set(live.map((row) => row.supersedesScoreId))).toEqual(
      new Set(predecessors.map((row) => row.scoreId)),
    );

    // THE ASSERTION THIS TEST WAS MISSING (lane-review finding 3). It previously checked only
    // that rows and predecessor links existed — which passed while every "successor" was under
    // the *same* revision as its predecessor, i.e. while the re-score had done nothing at all.
    expect(live.filter((row) => row.scorerId === 'finbert').map((row) => row.scorerVersion)).toEqual([
      SYNTHETIC_FINBERT_PIN,
      SYNTHETIC_FINBERT_PIN,
    ]);
    expect(live.find((row) => row.scorerId === 'tweet-roberta')!.scorerVersion).toBe(
      SYNTHETIC_ROBERTA_PIN,
    );
  });

  it('writes nothing when the re-score runs but the service was never redeployed', async () => {
    const service = { case: 'success' };
    const p = pipeline(service);

    await p.collect(ITEMS);
    await drainScoringQueue(p.deps);
    expect(p.store.rows).toHaveLength(3);

    await enqueueRescore(
      {
        candidates: ITEMS.map((item) => ({ itemId: item.itemId, axis: item.axis, form: item.form })),
        targetScorerVersions: {
          finbert: SYNTHETIC_FINBERT_PIN,
          'tweet-roberta': SYNTHETIC_ROBERTA_PIN,
        },
        at: new Date('2026-09-01T09:00:00.000Z'),
      },
      { queue: p.queue.port, items: p.items.port, store: p.store.port },
    );

    // `service.case` stays 'success' — the container is still on the original pin.
    const drained = await drainScoringQueue(p.deps, { maxAttempts: 2 });

    // No successor at all, and the reason is reported rather than inferred. Before the fix this
    // appended three successors under the OLD revision, `stanceGate` saw a homogeneous window
    // and rendered normally, and every subsequent run appended three more forever.
    expect(p.store.rows).toHaveLength(3);
    expect(drained.outcomes.flatMap((outcome) => outcome.staleRevisions).length).toBeGreaterThan(0);
    expect(drained.outcomes[0]!.staleRevisions[0]).toMatchObject({
      expected: SYNTHETIC_FINBERT_PIN,
      actual: REAL_FINBERT_PIN,
    });
    // And the items keep the scores they already had — nothing is marked unscoreable.
    expect(p.store.unscoreable).toEqual([]);
  });

  it('mixes no scorer revisions in a window that was only half re-scored', async () => {
    const service = { case: 'success' };
    const p = pipeline(service);

    await p.collect(ITEMS);
    await drainScoringQueue(p.deps);

    // Fabricate the half-migrated state directly: one successor under a different revision.
    const first = p.store.rows[0]!;
    await p.store.port.appendScores({
      rows: [
        {
          ...first,
          scoreId: 'score-successor',
          scorerVersion: 'ProsusAI/finbert@0123456789abcdef0123456789abcdef01234567',
          supersedesScoreId: first.scoreId,
          recordedAt: '2026-09-01T09:00:00.000Z',
        },
      ],
    });

    const gate = stanceGate({
      itemIds: [...FINBERT_WINDOW],
      scores: p.store.rows,
      unscoreable: [],
      health: { state: 'ok', since: '2026-08-30T00:00:00.000Z' },
    });

    expect(gate.kind).toBe('abstain');
    if (gate.kind !== 'abstain') return;
    expect(gate.abstention.reason).toBe('methodology_version_boundary');
  });
});
