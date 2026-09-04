import { describe, expect, it } from 'vitest';
import {
  ABSENT_FROM_BOARD,
  comparisonWindowHours,
  engagementPerMentionInputs,
  mentionDeltaInputs,
  mentionsZscoreInputs,
  rankChangeInputs,
  resolvePriorSource,
} from '../../../../src/services/attention/inputs';
import type { AttentionSnapshot } from '../../../../src/contracts/security';

function snapshot(overrides: Partial<AttentionSnapshot> = {}): AttentionSnapshot {
  return {
    securityId: 'sec-1',
    source: 'apewisdom',
    rank: 3,
    rankPrior: 5,
    mentions: 100,
    mentionsPrior: 90,
    engagement: 500,
    windowHours: 24,
    coverageClass: 'pov_index',
    providerMethodologyVersion: 'apewisdom-2026-09',
    observedAt: new Date('2026-09-01T00:00:00Z'),
    ingestedAt: new Date('2026-09-01T00:00:00Z'),
    rawHash: 'hash-1',
    ...overrides,
  };
}

describe('resolvePriorSource — F08 §4.1 (F06 §4.1 amendment)', () => {
  it('uses the provider-reported prior when no local predecessor exists (bootstrap)', () => {
    const current = snapshot({ rankPrior: 7, mentionsPrior: 80 });
    const result = resolvePriorSource(current, null);
    expect(result).toEqual({
      rankPriorRaw: '7',
      rankPriorImputed: false,
      mentionsPriorRaw: '80',
      methodologyVersionPrior: current.providerMethodologyVersion,
      sourceKind: 'provider_reported',
      isMethodologyBoundary: false,
      priorSnapshot: null,
    });
  });

  it('translates a null provider-reported rankPrior to the "0" (absent) sentinel in bootstrap', () => {
    const current = snapshot({ rankPrior: null, mentionsPrior: null });
    const result = resolvePriorSource(current, null);
    expect(result.rankPriorRaw).toBe(ABSENT_FROM_BOARD);
    expect(result.mentionsPriorRaw).toBeNull();
  });

  // Lane-review finding 1's exact live probe: a local predecessor at 11:00 (rank 40), current at
  // 12:00 (rank 10), the provider's own bundled `rank_24h_ago` = 12. The provider's own delta
  // would be 2 (12 - 10); the correct, locally-computed delta is 30 (40 - 10). The label must say
  // "own_history" — attributing a real 30-rank move to the provider (which never produced it)
  // is exactly the bug this regression test exists to catch, regardless of how little local
  // history has accrued.
  it('labels the comparison "own_history" the moment a local predecessor exists — never gated on depth (lane-review finding 1)', () => {
    const current = snapshot({ rank: 10, rankPrior: 12, observedAt: new Date('2026-09-01T12:00:00Z') });
    const prior = snapshot({ rank: 40, observedAt: new Date('2026-09-01T11:00:00Z') });
    const result = resolvePriorSource(current, prior);
    expect(result.sourceKind).toBe('own_history');
    expect(result.rankPriorRaw).toBe('40');
    // Never "12" (the provider's own bundled field) — the arithmetic uses the local row.
    expect(result.rankPriorRaw).not.toBe('12');
  });

  it('stays "own_history" even on the very first local predecessor ever recorded (depth would be 0)', () => {
    const current = snapshot();
    const prior = snapshot({ rank: 10, mentions: 60 });
    const result = resolvePriorSource(current, prior);
    expect(result.sourceKind).toBe('own_history');
    expect(result.rankPriorRaw).toBe('10');
  });

  it("translates a local predecessor's null rank to the absent sentinel", () => {
    const current = snapshot();
    const prior = snapshot({ rank: null, mentions: 30 });
    const result = resolvePriorSource(current, prior);
    expect(result.rankPriorRaw).toBe(ABSENT_FROM_BOARD);
  });

  it('carries the local predecessor\'s own methodology version, not the current one, so a boundary can be detected', () => {
    const current = snapshot({ providerMethodologyVersion: 'apewisdom-2026-09' });
    const prior = snapshot({ providerMethodologyVersion: 'apewisdom-2026-08' });
    const result = resolvePriorSource(current, prior);
    expect(result.methodologyVersionPrior).toBe('apewisdom-2026-08');
    expect(result.isMethodologyBoundary).toBe(true);
  });

  it('is not a methodology boundary when the local predecessor shares the current methodology version', () => {
    const current = snapshot({ providerMethodologyVersion: 'apewisdom-2026-09' });
    const prior = snapshot({ providerMethodologyVersion: 'apewisdom-2026-09' });
    const result = resolvePriorSource(current, prior);
    expect(result.isMethodologyBoundary).toBe(false);
  });

  it('is never a methodology boundary in the bootstrap case — one field of one response cannot straddle one', () => {
    const current = snapshot();
    expect(resolvePriorSource(current, null).isMethodologyBoundary).toBe(false);
  });
});

describe('comparisonWindowHours — F08 §4.2 (lane-review finding 2)', () => {
  it('is the real elapsed span between the local predecessor and the current observation', () => {
    const current = snapshot({ observedAt: new Date('2026-09-01T12:00:00Z') });
    const prior = snapshot({ observedAt: new Date('2026-09-01T11:00:00Z') });
    expect(comparisonWindowHours(current, prior)).toBe(1);
  });

  it('is fractional for a sub-hour gap — never rounded up to a whole provider-window unit', () => {
    const current = snapshot({ observedAt: new Date('2026-09-01T12:05:00Z') });
    const prior = snapshot({ observedAt: new Date('2026-09-01T12:00:00Z') });
    expect(comparisonWindowHours(current, prior)).toBeCloseTo(5 / 60, 6);
  });

  it("falls back to the provider's own declared window only in the bootstrap case", () => {
    const current = snapshot({ windowHours: 24 });
    expect(comparisonWindowHours(current, null)).toBe(24);
  });
});

describe('*_prior input provenance — lane-review round 6 finding 1', () => {
  it('rank_prior/methodology_version_prior name the local predecessor as their source in the own_history case, never current', () => {
    const current = snapshot({ rank: 30, observedAt: new Date('2026-09-01T12:00:00Z') });
    const predecessor = snapshot({
      rank: 40,
      providerMethodologyVersion: 'apewisdom-2026-09',
      observedAt: new Date('2026-09-01T11:00:00Z'),
    });
    const prior = resolvePriorSource(current, predecessor);
    expect(prior.sourceKind).toBe('own_history');

    const inputs = rankChangeInputs(current, prior);
    const rankPrior = inputs.find((input) => input.key === 'rank_prior');
    const methodologyPrior = inputs.find((input) => input.key === 'methodology_version_prior');

    // Never current's own instant — the predecessor's.
    expect(rankPrior?.provenance.observedAt).toBe(predecessor.observedAt.toISOString());
    expect(rankPrior?.provenance.observedAt).not.toBe(current.observedAt.toISOString());
    // The predecessor's own `rank` column, not a synthesized "24h ago" field ApeWisdom never sent.
    expect(rankPrior?.provenance.providerField).toBe('rank');
    expect(methodologyPrior?.provenance.observedAt).toBe(predecessor.observedAt.toISOString());
    expect(methodologyPrior?.provenance.providerField).toBe('provider_methodology_version');
  });

  it("rank_prior/methodology_version_prior name current's own bundled field in the bootstrap case", () => {
    const current = snapshot({ rank: 10, rankPrior: 12, observedAt: new Date('2026-09-01T12:00:00Z') });
    const prior = resolvePriorSource(current, null);
    expect(prior.sourceKind).toBe('provider_reported');

    const inputs = rankChangeInputs(current, prior);
    const rankPrior = inputs.find((input) => input.key === 'rank_prior');
    const methodologyPrior = inputs.find((input) => input.key === 'methodology_version_prior');

    expect(rankPrior?.provenance.observedAt).toBe(current.observedAt.toISOString());
    expect(rankPrior?.provenance.providerField).toBe('rank_24h_ago');
    expect(methodologyPrior?.provenance.providerField).toBe('methodology_version_24h_ago');
  });

  it('mentions_prior names the local predecessor in the own_history case', () => {
    const current = snapshot({ mentions: 1500, observedAt: new Date('2026-09-01T12:00:00Z') });
    const predecessor = snapshot({ mentions: 900, observedAt: new Date('2026-09-01T11:00:00Z') });
    const prior = resolvePriorSource(current, predecessor);

    const inputs = mentionDeltaInputs(current, prior);
    const mentionsPrior = inputs.find((input) => input.key === 'mentions_prior');
    expect(mentionsPrior?.provenance.observedAt).toBe(predecessor.observedAt.toISOString());
    expect(mentionsPrior?.provenance.providerField).toBe('mentions');
  });
});

describe('engagementPerMentionInputs — lane-review round 6 finding 4', () => {
  it('marks a substituted zero as imputed, never as an observed ok value, when engagement was not reported', () => {
    const current = snapshot({ engagement: null });
    const inputs = engagementPerMentionInputs(current);
    const engagementInput = inputs.find((input) => input.key === 'engagement');
    expect(engagementInput?.value).toBe('0');
    expect(engagementInput?.quality).toBe('imputed');
  });

  it('keeps a genuinely reported engagement figure as ok', () => {
    const current = snapshot({ engagement: 500 });
    const inputs = engagementPerMentionInputs(current);
    const engagementInput = inputs.find((input) => input.key === 'engagement');
    expect(engagementInput?.value).toBe('500');
    expect(engagementInput?.quality).toBe('ok');
  });
});

/**
 * Round-52 lane-review finding 2. A `null` `rank` (current or a local predecessor's) is
 * substituted with `ABSENT_FROM_BOARD` ('0') so `attention.rank_change` has something to compute
 * against, but `null` means "not reported for this observation" — a data-quality gap, not the
 * genuinely different fact the sentinel exists to state ("ApeWisdom reported this ticker off the
 * board"). The substitution must be marked `'imputed'`, mirroring `engagementPerMentionInputs`'s
 * identical round-6 fix, not `'ok'` on a fabricated value.
 */
describe('rankChangeInputs — a null rank is imputed, not fabricated as ok (round-52 lane-review finding 2)', () => {
  it('marks a null current.rank as imputed', () => {
    const current = snapshot({ rank: null });
    const prior = resolvePriorSource(current, null);
    const inputs = rankChangeInputs(current, prior);
    const rankNow = inputs.find((i) => i.key === 'rank_now');
    expect(rankNow?.value).toBe(ABSENT_FROM_BOARD);
    expect(rankNow?.quality).toBe('imputed');
  });

  it('keeps a genuinely reported current.rank as ok', () => {
    const current = snapshot({ rank: 5 });
    const prior = resolvePriorSource(current, null);
    const inputs = rankChangeInputs(current, prior);
    expect(inputs.find((i) => i.key === 'rank_now')?.quality).toBe('ok');
  });

  it('marks a null local predecessor rank as imputed (own_history case)', () => {
    const current = snapshot({ rank: 5 });
    const predecessor = snapshot({ rank: null });
    const prior = resolvePriorSource(current, predecessor);
    const inputs = rankChangeInputs(current, prior);
    const rankPrior = inputs.find((i) => i.key === 'rank_prior');
    expect(rankPrior?.value).toBe(ABSENT_FROM_BOARD);
    expect(rankPrior?.quality).toBe('imputed');
  });

  // Round-53 lane-review finding 1, correcting round 52's own fix: `current.rankPrior` is null
  // for exactly one reason — `collector.ts` translated ApeWisdom's own "not on the board"
  // sentinel (`rank_24h_ago: '0'`) to `null` because the persisted column can't store a literal
  // `0`. That is a genuinely observed provider fact round-tripped through `null`, not a
  // data-quality gap — the ordinary path for any ticker newly appearing on the board, not an edge
  // case. Marking it 'imputed' claimed the deployment filled in a value ApeWisdom actually sent.
  it('never marks a null provider-reported rankPrior as imputed — it is the genuine "not on the board" sentinel, round-tripped through null', () => {
    const current = snapshot({ rankPrior: null });
    const prior = resolvePriorSource(current, null);
    const inputs = rankChangeInputs(current, prior);
    const rankPrior = inputs.find((i) => i.key === 'rank_prior');
    expect(rankPrior?.value).toBe(ABSENT_FROM_BOARD);
    expect(rankPrior?.quality).toBe('ok');
  });

  it('keeps a genuinely reported rank_prior as ok, in both sourcing cases', () => {
    const current = snapshot({ rank: 5, rankPrior: 7 });
    const bootstrapInputs = rankChangeInputs(current, resolvePriorSource(current, null));
    expect(bootstrapInputs.find((i) => i.key === 'rank_prior')?.quality).toBe('ok');

    const predecessor = snapshot({ rank: 12 });
    const ownHistoryInputs = rankChangeInputs(current, resolvePriorSource(current, predecessor));
    expect(ownHistoryInputs.find((i) => i.key === 'rank_prior')?.quality).toBe('ok');
  });
});

/**
 * Round-50 lane-review finding 2. `snapshotInput` used to stamp every input `freshness: 'fresh'`
 * unconditionally, including the deliberately historical ones (`*_prior`, `history_N`) — up to a
 * month old for `mentions_zscore`'s own window. `CalculationInspector.tsx` renders `freshness`
 * beside each input's `observed_at`, so a reader could see "2026-08-04… / fresh" beside a current
 * reading three weeks later. No test at any level asserted this field for attention inputs before
 * this round.
 */
describe('snapshotInput freshness — round-50 lane-review finding 2', () => {
  it('marks the current observation fresh and the prior comparison stale, in the own_history case', () => {
    const current = snapshot({ observedAt: new Date('2026-09-01T12:00:00Z') });
    const predecessor = snapshot({ observedAt: new Date('2026-08-01T12:00:00Z') });
    const prior = resolvePriorSource(current, predecessor);

    const rankInputs = rankChangeInputs(current, prior);
    expect(rankInputs.find((i) => i.key === 'rank_now')?.freshness).toBe('fresh');
    expect(rankInputs.find((i) => i.key === 'mentions_now')?.freshness).toBe('fresh');
    expect(rankInputs.find((i) => i.key === 'methodology_version_now')?.freshness).toBe('fresh');
    expect(rankInputs.find((i) => i.key === 'rank_prior')?.freshness).toBe('stale');
    expect(rankInputs.find((i) => i.key === 'methodology_version_prior')?.freshness).toBe('stale');

    const mentionInputs = mentionDeltaInputs(current, prior);
    expect(mentionInputs.find((i) => i.key === 'mentions_now')?.freshness).toBe('fresh');
    expect(mentionInputs.find((i) => i.key === 'mentions_prior')?.freshness).toBe('stale');
  });

  it('marks the bootstrap-case prior stale too, even though it is read off the current row', () => {
    const current = snapshot({ rankPrior: 12, observedAt: new Date('2026-09-01T12:00:00Z') });
    const prior = resolvePriorSource(current, null);
    const rankInputs = rankChangeInputs(current, prior);
    expect(rankInputs.find((i) => i.key === 'rank_prior')?.freshness).toBe('stale');
  });

  it('marks every history_N input stale and the current mentions reading fresh', () => {
    const current = snapshot({ observedAt: new Date('2026-09-01T00:00:00Z') });
    const history = [
      snapshot({ observedAt: new Date('2026-08-31T00:00:00Z') }),
      snapshot({ observedAt: new Date('2026-08-01T00:00:00Z') }),
    ];
    const inputs = mentionsZscoreInputs(current, history);
    expect(inputs.find((i) => i.key === 'mentions_now')?.freshness).toBe('fresh');
    expect(inputs.find((i) => i.key === 'history_0')?.freshness).toBe('stale');
    expect(inputs.find((i) => i.key === 'history_1')?.freshness).toBe('stale');
  });

  it('keeps the current-instant engagement input fresh', () => {
    const inputs = engagementPerMentionInputs(snapshot());
    expect(inputs.find((i) => i.key === 'engagement')?.freshness).toBe('fresh');
    expect(inputs.find((i) => i.key === 'mentions_now')?.freshness).toBe('fresh');
  });
});
