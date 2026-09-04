import { describe, expect, it } from 'vitest';
import { stanceGate } from '@/services/jobs/stance-availability';
import type { ScoreRow, ScorerHealth, UnscoreableRow } from '@/services/jobs/ports';

const V1 = 'ProsusAI/finbert@4556d13015211d73dccd3fdd39d39232506f3e43';
const V2 = 'ProsusAI/finbert@0123456789abcdef0123456789abcdef01234567';

const OK: ScorerHealth = { state: 'ok', since: '2026-08-30T00:00:00.000Z' };
const DOWN: ScorerHealth = {
  state: 'outage',
  since: '2026-08-30T11:04:00.000Z',
  lastError: { kind: 'upstream', status: 503 },
};

function row(itemId: string, overrides: Partial<ScoreRow> = {}): ScoreRow {
  return {
    scoreId: `score-${itemId}`,
    itemId,
    label: 'bullish',
    scores: { bullish: '0.900000', bearish: '0.050000', neutral: '0.050000' },
    scorerId: 'finbert',
    scorerVersion: V1,
    runtimeVersion: 'sha256:aaaa',
    inputHash: 'd'.repeat(64),
    truncated: false,
    scorerProvenance: 'pinned',
    supersedesScoreId: null,
    scoredAt: '2026-08-30T12:00:00.000000Z',
    recordedAt: '2026-08-30T12:00:01.000Z',
    ...overrides,
  };
}

function unscoreable(itemId: string): UnscoreableRow {
  return {
    itemId,
    reason: 'text_unavailable',
    detail: 'purged upstream',
    recordedAt: '2026-08-30T12:00:00.000Z',
  };
}

describe('F20 §4.2 rule 2 — a scorer outage renders abstention, never a substituted number', () => {
  it('abstains with scorer_unavailable and the since-timestamp F18 renders', () => {
    const outcome = stanceGate({
      itemIds: ['item-1', 'item-2'],
      scores: [row('item-1')],
      unscoreable: [],
      health: DOWN,
    });

    expect(outcome.kind).toBe('abstain');
    if (outcome.kind !== 'abstain') return;
    expect(outcome.abstention.reason).toBe('scorer_unavailable');
    expect(outcome.abstention.message).toContain('scorer unavailable since 2026-08-30T11:04:00.000Z');
  });

  it('offers no number to read on the abstaining branch — substitution is not expressible', () => {
    const outcome = stanceGate({
      itemIds: ['item-1'],
      scores: [],
      unscoreable: [],
      health: DOWN,
    });

    // The structural half of "no silent substitution": a caller that ignores the abstention
    // has nothing to render. There is no `scores`, and no partial or default value.
    expect('scores' in outcome).toBe(false);
    expect(Object.keys(outcome).sort()).toEqual(['abstention', 'kind']);
  });

  it('says so plainly when the scorer is up and the backlog has simply not reached these items', () => {
    const outcome = stanceGate({
      itemIds: ['item-1', 'item-2', 'item-3'],
      scores: [row('item-1')],
      unscoreable: [],
      health: OK,
    });

    expect(outcome.kind).toBe('abstain');
    if (outcome.kind !== 'abstain') return;
    expect(outcome.abstention.message).toContain('2 of 3 item(s) in this window have not been scored yet');
    // Not claimed as an outage: the scorer is reachable, and saying otherwise would page
    // someone for a queue that is draining normally.
    expect(outcome.abstention.message).not.toContain('unavailable');
  });

  it('renders when every item in the window has a live score under one revision', () => {
    const outcome = stanceGate({
      itemIds: ['item-1', 'item-2'],
      scores: [row('item-1'), row('item-2')],
      unscoreable: [],
      health: OK,
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.scores.map((r) => r.itemId)).toEqual(['item-1', 'item-2']);
    expect(outcome.scorerVersion).toBe(V1);
    expect(outcome.excluded).toEqual([]);
  });
});

describe('Tier D3 — no series admitted to a metric mixes scorers', () => {
  it('refuses a window whose live rows carry two scorer revisions', () => {
    const outcome = stanceGate({
      itemIds: ['item-1', 'item-2'],
      scores: [row('item-1'), row('item-2', { scorerVersion: V2 })],
      unscoreable: [],
      health: OK,
    });

    expect(outcome.kind).toBe('abstain');
    if (outcome.kind !== 'abstain') return;
    expect(outcome.abstention.reason).toBe('methodology_version_boundary');
    expect(outcome.abstention.message).toContain(V1);
    expect(outcome.abstention.message).toContain(V2);
  });

  it('accepts a window whose predecessors were under a different revision, once superseded', () => {
    // The whole point of §4.4: the old row is still there and still readable. It simply is not
    // the live one, so the window is homogeneous again after a completed re-score.
    const outcome = stanceGate({
      itemIds: ['item-1'],
      scores: [
        row('item-1'),
        row('item-1', { scoreId: 'score-successor', scorerVersion: V2, supersedesScoreId: 'score-item-1' }),
      ],
      unscoreable: [],
      health: OK,
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.scorerVersion).toBe(V2);
    expect(outcome.scores.map((r) => r.scoreId)).toEqual(['score-successor']);
  });

  it('refuses a half-migrated window, where only some items were re-scored', () => {
    const outcome = stanceGate({
      itemIds: ['item-1', 'item-2'],
      scores: [
        row('item-1'),
        row('item-1', { scoreId: 'succ-1', scorerVersion: V2, supersedesScoreId: 'score-item-1' }),
        row('item-2'),
      ],
      unscoreable: [],
      health: OK,
    });

    expect(outcome.kind).toBe('abstain');
    if (outcome.kind !== 'abstain') return;
    expect(outcome.abstention.reason).toBe('methodology_version_boundary');
  });
});

describe('the ugly inputs', () => {
  it('abstains on an empty window rather than rendering a zero', () => {
    const outcome = stanceGate({ itemIds: [], scores: [], unscoreable: [], health: OK });

    expect(outcome.kind).toBe('abstain');
    if (outcome.kind !== 'abstain') return;
    expect(outcome.abstention.reason).toBe('no_coverage_in_window');
    expect(outcome.abstention.message).toContain('no items in this window');
  });

  it('abstains when every item in the window is permanently unscoreable', () => {
    const outcome = stanceGate({
      itemIds: ['item-1'],
      scores: [],
      unscoreable: [unscoreable('item-1')],
      health: OK,
    });

    expect(outcome.kind).toBe('abstain');
    if (outcome.kind !== 'abstain') return;
    expect(outcome.abstention.message).toContain('unscoreable');
  });

  it('renders the rest of the window when one item is permanently unscoreable, and names it', () => {
    const outcome = stanceGate({
      itemIds: ['item-1', 'item-gone'],
      scores: [row('item-1')],
      unscoreable: [unscoreable('item-gone')],
      health: OK,
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.scores.map((r) => r.itemId)).toEqual(['item-1']);
    // Surfaced, not silently dropped: a coverage note is the honest rendering.
    expect(outcome.excluded.map((r) => r.itemId)).toEqual(['item-gone']);
  });

  it('does not let an unscoreable row override a score the item actually has', () => {
    // THE REGRESSION (lane-review finding 2). A re-score whose body is purged between enqueue
    // and lease can leave an item holding both a good predecessor score and a
    // `text_unavailable` row. Filtering on the unscoreable row alone dropped that item from `n`
    // and reported it under `excluded` — whose contract says "no score can ever exist for
    // them", which is false when one demonstrably does.
    const outcome = stanceGate({
      itemIds: ['item-1', 'item-2'],
      scores: [row('item-1'), row('item-2')],
      unscoreable: [unscoreable('item-2')],
      health: OK,
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.scores.map((r) => r.itemId)).toEqual(['item-1', 'item-2']);
    expect(outcome.excluded).toEqual([]);
  });

  it('still excludes an unscoreable item whose only score was superseded away', () => {
    // The other side of the same rule: `excluded` turns on whether a *live* score exists, not
    // on whether any row was ever written.
    const outcome = stanceGate({
      itemIds: ['item-1', 'item-2'],
      scores: [row('item-1')],
      unscoreable: [unscoreable('item-2')],
      health: OK,
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.excluded.map((r) => r.itemId)).toEqual(['item-2']);
  });

  it('ignores scores for items outside the window', () => {
    const outcome = stanceGate({
      itemIds: ['item-1'],
      scores: [row('item-1'), row('item-elsewhere', { scorerVersion: V2 })],
      unscoreable: [],
      health: OK,
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.scorerVersion).toBe(V1);
  });

  it('prefers the outage explanation over the backlog one, because it is the actionable fact', () => {
    const outcome = stanceGate({
      itemIds: ['item-1', 'item-2'],
      scores: [],
      unscoreable: [],
      health: DOWN,
    });

    expect(outcome.kind === 'abstain' && outcome.abstention.reason).toBe('scorer_unavailable');
  });
});
