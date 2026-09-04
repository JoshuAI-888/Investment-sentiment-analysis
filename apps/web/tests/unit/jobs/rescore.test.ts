import { describe, expect, it } from 'vitest';
import type { ProviderMeta, ProviderResult } from '@/contracts/provider';
import type { ScoreBatchOutcome } from '@/adapters/scorer';
import { enqueueRescore, MAX_RESCORE_BATCH } from '@/services/jobs/rescore';
import type { RescoreCandidate } from '@/services/jobs/rescore';
import type { ScoreRow } from '@/services/jobs/ports';
import { runScoringWorkerOnce } from '@/services/jobs/scoring-worker';
import type { ScoringWorkerDeps } from '@/services/jobs/scoring-worker';
import { liveScores } from '@/services/jobs/scores';
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

const OLD = 'ProsusAI/finbert@4556d13015211d73dccd3fdd39d39232506f3e43';
const NEW = 'ProsusAI/finbert@0123456789abcdef0123456789abcdef01234567';
const NEW_ROBERTA =
  'cardiffnlp/twitter-roberta-base-sentiment-latest@89abcdef0123456789abcdef0123456789abcdef';
const RUNTIME = 'sha256:aaaa';
const AT = new Date('2026-09-01T09:00:00.000Z');

const META: ProviderMeta = {
  provider: 'scorer',
  endpoint: 'score',
  requestedAt: AT.toISOString(),
  latencyMs: 5,
  cache: 'miss',
  quotaRemaining: null,
  costUsd: null,
  payloadRef: null,
};

function predecessor(overrides: Partial<ScoreRow> = {}): ScoreRow {
  return {
    scoreId: 'score-old-1',
    itemId: 'item-1',
    label: 'bullish',
    scores: { bullish: '0.900000', bearish: '0.050000', neutral: '0.050000' },
    scorerId: 'finbert',
    scorerVersion: OLD,
    runtimeVersion: RUNTIME,
    inputHash: 'b'.repeat(64),
    truncated: false,
    scorerProvenance: 'pinned',
    supersedesScoreId: null,
    scoredAt: '2026-08-30T12:00:00.000000Z',
    recordedAt: '2026-08-30T12:00:01.000Z',
    ...overrides,
  };
}

function harness(texts: Record<string, string> = { 'item-1': 'the original body' }) {
  const trace: Trace = [];
  const queue = fakeQueue(trace);
  const items = fakeItems(trace, texts);
  const store = fakeScoreStore(trace);
  const health = fakeHealth(trace);
  const { clock } = fakeClock('2026-09-01T09:00:00.000Z');
  return { trace, queue, items, store, health, clock };
}

const CANDIDATE: RescoreCandidate = { itemId: 'item-1', axis: 'reddit', form: 'post' };

describe('F20 §4.4 — a re-score writes a successor and never mutates a predecessor', () => {
  it('enqueues an entry naming the row it will supersede, and writes no score itself', async () => {
    const h = harness();
    await h.store.port.appendScores({ rows: [predecessor()] });
    const before = JSON.stringify(h.store.rows);
    h.trace.length = 0; // drop the seeding write, so the trace below is the job's alone

    const outcome = await enqueueRescore(
      { candidates: [CANDIDATE], targetScorerVersions: { finbert: NEW, 'tweet-roberta': NEW_ROBERTA }, at: AT },
      { queue: h.queue.port, items: h.items.port, store: h.store.port },
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.enqueued).toEqual([
      {
        itemId: 'item-1',
        axis: 'reddit',
        form: 'post',
        scorerId: 'finbert',
        reason: 'rescore',
        supersedesScoreId: 'score-old-1',
        // Carried onto the entry so the worker can refuse a successor that comes back under
        // the old pin (lane-review finding 3).
        targetScorerVersion: NEW,
        enqueuedAt: AT.toISOString(),
      },
    ]);
    // The re-score job never holds a write handle and a predecessor at the same time.
    expect(h.trace.filter((entry) => entry.startsWith('store.appendScores'))).toHaveLength(0);
    expect(JSON.stringify(h.store.rows)).toBe(before);
  });

  it('leaves the predecessor readable and hash-verifiable after the successor lands', async () => {
    const h = harness();
    await h.store.port.appendScores({ rows: [predecessor()] });

    await enqueueRescore(
      { candidates: [CANDIDATE], targetScorerVersions: { finbert: NEW, 'tweet-roberta': NEW_ROBERTA }, at: AT },
      { queue: h.queue.port, items: h.items.port, store: h.store.port },
    );

    const deps: ScoringWorkerDeps = {
      queue: h.queue.port,
      items: h.items.port,
      store: h.store.port,
      health: h.health.port,
      score: async (batch): Promise<ProviderResult<ScoreBatchOutcome>> => ({
        ok: true,
        data: batchOutcome(
          batch.map((item) => ({
            itemId: item.itemId,
            label: 'bearish' as const,
            scores: { bullish: '0.050000', bearish: '0.900000', neutral: '0.050000' },
            scorer: { scorerId: item.kind, scorerVersion: NEW, runtimeVersion: RUNTIME },
            scoredAt: '2026-09-01T09:00:00.000000Z',
            inputHash: 'c'.repeat(64),
            truncated: false,
          })),
        ),
        meta: META,
      }),
      clock: h.clock,
      newScoreId: fakeScoreIds('score-new'),
    };

    await runScoringWorkerOnce(deps);

    expect(h.store.rows).toHaveLength(2);
    const [old, successor] = h.store.rows as [ScoreRow, ScoreRow];

    // The predecessor is byte-for-byte what it was: same label, same scores, same hash, same
    // revision. F20 §7 step 7 reviews exactly this.
    expect(old).toEqual(predecessor());
    expect(successor.supersedesScoreId).toBe('score-old-1');
    expect(successor.scorerVersion).toBe(NEW);
    expect(successor.label).toBe('bearish');

    // And the read path now shows the successor only.
    expect(liveScores(h.store.rows).map((row) => row.scoreId)).toEqual(['score-new-1']);
  });

  it('refuses an over-large batch instead of quietly doing part of it', async () => {
    const h = harness();
    const candidates = Array.from({ length: MAX_RESCORE_BATCH + 1 }, (_, index) => ({
      itemId: `item-${index}`,
      axis: 'reddit' as const,
      form: 'post' as const,
    }));

    const outcome = await enqueueRescore(
      { candidates, targetScorerVersions: { finbert: NEW, 'tweet-roberta': NEW_ROBERTA }, at: AT },
      { queue: h.queue.port, items: h.items.port, store: h.store.port },
    );

    expect(outcome).toEqual({
      ok: false,
      reason: 'batch_too_large',
      requested: MAX_RESCORE_BATCH + 1,
      limit: MAX_RESCORE_BATCH,
    });
    // A half-done re-score leaves the corpus mixing two revisions, which is what Tier D3
    // rejects — so nothing at all is enqueued.
    expect(h.queue.slots).toHaveLength(0);
  });

  it('skips an item that has never been scored — there is nothing to write a successor to', async () => {
    const h = harness();

    const outcome = await enqueueRescore(
      { candidates: [CANDIDATE], targetScorerVersions: { finbert: NEW, 'tweet-roberta': NEW_ROBERTA }, at: AT },
      { queue: h.queue.port, items: h.items.port, store: h.store.port },
    );

    expect(outcome.ok && outcome.skipped).toEqual([{ itemId: 'item-1', reason: 'never_scored' }]);
    expect(h.queue.slots).toHaveLength(0);
  });

  it('skips an item already scored under the target revision, so a re-run is a no-op', async () => {
    const h = harness();
    await h.store.port.appendScores({ rows: [predecessor({ scorerVersion: NEW })] });

    const outcome = await enqueueRescore(
      { candidates: [CANDIDATE], targetScorerVersions: { finbert: NEW, 'tweet-roberta': NEW_ROBERTA }, at: AT },
      { queue: h.queue.port, items: h.items.port, store: h.store.port },
    );

    expect(outcome.ok && outcome.skipped).toEqual([{ itemId: 'item-1', reason: 'already_at_target' }]);
  });

  it('skips a candidate whose axis/form disagrees with what the predecessor was actually scored under (lane-review finding 5)', async () => {
    const h = harness();
    // Collected and scored as a Reddit *post* (routes to finbert).
    await h.store.port.appendScores({ rows: [predecessor({ scorerId: 'finbert' })] });

    // The candidate list says *comment* instead — which routes to tweet-roberta.
    const outcome = await enqueueRescore(
      {
        candidates: [{ itemId: 'item-1', axis: 'reddit', form: 'comment' }],
        targetScorerVersions: { finbert: NEW, 'tweet-roberta': NEW_ROBERTA },
        at: AT,
      },
      { queue: h.queue.port, items: h.items.port, store: h.store.port },
    );

    // THE REGRESSION. Before this fix, nothing compared the candidate's derived `scorerId`
    // against `predecessor.scorerId` — a wrong `form` would enqueue a re-score routed to
    // tweet-roberta for an item whose live predecessor was scored by finbert, and the worker's
    // `targetScorerVersion` check cannot catch this: it only verifies the service answered
    // under the requested pin, not that the requested pin was for the right model at all.
    expect(outcome.ok && outcome.skipped).toEqual([{ itemId: 'item-1', reason: 'scorer_mismatch' }]);
    expect(h.queue.slots).toHaveLength(0);
  });

  it('re-scores an X item from its bounded snippet, and skips one that was purged (D-17)', async () => {
    const h = harness({ 'x-live': 'the retained snippet' });
    await h.store.port.appendScores({
      rows: [
        predecessor({ scoreId: 'score-x-live', itemId: 'x-live', scorerId: 'tweet-roberta' }),
        predecessor({ scoreId: 'score-x-gone', itemId: 'x-gone', scorerId: 'tweet-roberta' }),
      ],
    });

    const outcome = await enqueueRescore(
      {
        candidates: [
          { itemId: 'x-live', axis: 'x', form: 'post' },
          { itemId: 'x-gone', axis: 'x', form: 'post' },
        ],
        targetScorerVersions: { finbert: NEW, 'tweet-roberta': NEW_ROBERTA },
        at: AT,
      },
      { queue: h.queue.port, items: h.items.port, store: h.store.port },
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.enqueued.map((entry) => entry.itemId)).toEqual(['x-live']);
    expect(outcome.enqueued[0]!.scorerId).toBe('tweet-roberta');
    expect(outcome.skipped).toEqual([{ itemId: 'x-gone', reason: 'text_unavailable' }]);
    // The purged item keeps the score it already had. It is not deleted and not zeroed.
    expect(h.store.rows.map((row) => row.itemId)).toContain('x-gone');
  });

  it('supersedes the current successor, not the original, on a second re-score', async () => {
    const h = harness();
    await h.store.port.appendScores({
      rows: [
        predecessor(),
        predecessor({
          scoreId: 'score-old-2',
          supersedesScoreId: 'score-old-1',
          scorerVersion: NEW,
          recordedAt: '2026-08-31T12:00:00.000Z',
        }),
      ],
    });

    const third = 'ProsusAI/finbert@fedcba9876543210fedcba9876543210fedcba98';
    const outcome = await enqueueRescore(
      { candidates: [CANDIDATE], targetScorerVersions: { finbert: third }, at: AT },
      { queue: h.queue.port, items: h.items.port, store: h.store.port },
    );

    expect(outcome.ok && outcome.enqueued[0]!.supersedesScoreId).toBe('score-old-2');
  });
});
