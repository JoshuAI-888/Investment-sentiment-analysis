import { describe, expect, it } from 'vitest';
import {
  deriveHistoryDepth,
  deriveNeverCollectedMalformedSymbols,
  deriveRankChangeProvenance,
  deriveZscoreWindowHours,
  hasNotableMoverExcludedForStaleness,
  pageState,
  pointerMatchesCurrent,
  selectNotableMovers,
  toMetricView,
} from '../../../../src/services/attention/leaderboard';
import type { AttentionMetricView, AttentionRowView } from '../../../../src/services/attention/contract';
import type { CalculationArtifact, CalculationInputValue } from '../../../../src/calc/artifact';
import type { AttentionSnapshot } from '../../../../src/contracts/security';

function rankNowInput(observedAt: string): CalculationInputValue {
  return {
    key: 'rank_now',
    value: '10',
    unit: 'ranks',
    dataType: 'decimal',
    source: 'apewisdom/apewisdom',
    quality: 'ok',
    freshness: 'fresh',
    provenance: {
      provider: 'apewisdom',
      providerField: 'rank',
      sourceUrl: null,
      observedAt,
      availableAt: observedAt,
      ingestedAt: observedAt,
      rawPayloadId: null,
      licenseClass: 'attribution_required',
      redactionClass: 'public',
    },
  };
}

function artifactWithRankNow(inputs: readonly CalculationInputValue[]): CalculationArtifact {
  return {
    calculationId: 'calc-1',
    methodId: 'attention.rank_change',
    methodVersion: '1.1.0',
    subject: { kind: 'security', id: 'sec-1', label: 'GME' },
    asOf: '2026-08-30T10:05:00.000Z',
    inputs,
    assumptions: [],
    steps: [],
    result: { exact: '18', display: '18', roundingRule: 'int_0dp_half_even', unit: 'ranks' },
    abstention: null,
    eligibility: 'ok',
    inputHash: 'h1',
    resultHash: 'h2',
    configVersion: '1',
    scenario: { kind: 'official' },
    points: null,
    warnings: [],
    retentionClass: 'standard',
    computedAt: '2026-08-30T10:05:00.000Z',
  };
}

function snapshot(observedAt: string): AttentionSnapshot {
  return {
    securityId: 'sec-1',
    source: 'apewisdom',
    rank: 10,
    rankPrior: 12,
    mentions: 900,
    mentionsPrior: 850,
    engagement: 5000,
    windowHours: 24,
    coverageClass: 'pov_index',
    providerMethodologyVersion: 'apewisdom-2026-09',
    observedAt: new Date(observedAt),
    ingestedAt: new Date(observedAt),
    rawHash: 'hash-1',
  };
}

function metric(overrides: Partial<AttentionMetricView> = {}): AttentionMetricView {
  return {
    calculationId: 'calc-1',
    metricId: 'attention.rank_change',
    label: 'Δ Rank',
    display: '3',
    unit: 'ranks',
    roundingRule: 'int_0dp_half_even',
    eligibility: 'ok',
    reason: null,
    isClamped: false,
    ...overrides,
  };
}

const DEFAULT_OBSERVED_AT = new Date('2026-09-01T00:00:00Z');

function row(overrides: Partial<AttentionRowView> = {}): AttentionRowView {
  return {
    securityId: 'sec-1',
    symbol: 'GME',
    companyName: 'GameStop Corp.',
    mentions: metric({ metricId: 'attention.mentions_now', label: 'Mentions' }),
    mentionDelta: metric({ metricId: 'attention.mention_delta', label: 'Δ Mentions' }),
    mentionGrowth: null,
    upvotes: metric({ metricId: 'attention.engagement_now', label: 'Upvotes' }),
    rank: metric({ metricId: 'attention.rank_now', label: 'Rank' }),
    rankChange: metric(),
    mentionsZscore: null,
    mentionsZscoreWindowHours: null,
    observedAt: DEFAULT_OBSERVED_AT,
    observationWindowHours: 24,
    historyDepth: { securityId: 'sec-1', comparableSnapshots: 20, requiredForZscore: 14 },
    isNew: false,
    isDroppedFromBoard: false,
    isMethodologyBoundary: false,
    isThinSample: false,
    rankChangeSource: 'own_history',
    isStale: false,
    wasMalformedLastRun: false,
    ...overrides,
  };
}

describe('selectNotableMovers — F08 §4.4', () => {
  it('picks the top three by absolute rank-change magnitude', () => {
    const rows = [
      row({ securityId: 's1', symbol: 'A', rankChange: metric({ display: '2' }) }),
      row({ securityId: 's2', symbol: 'B', rankChange: metric({ display: '-9' }) }),
      row({ securityId: 's3', symbol: 'C', rankChange: metric({ display: '5' }) }),
      row({ securityId: 's4', symbol: 'D', rankChange: metric({ display: '-1' }) }),
    ];
    const movers = selectNotableMovers(rows, DEFAULT_OBSERVED_AT);
    expect(movers.map((m) => m.symbol)).toEqual(['B', 'C', 'A']);
  });

  it('excludes a thin-sample row even if its magnitude would otherwise qualify', () => {
    const rows = [
      row({ securityId: 's1', symbol: 'THIN', isThinSample: true, rankChange: metric({ display: '50' }) }),
      row({ securityId: 's2', symbol: 'B', rankChange: metric({ display: '2' }) }),
    ];
    const movers = selectNotableMovers(rows, DEFAULT_OBSERVED_AT);
    expect(movers.map((m) => m.symbol)).toEqual(['B']);
  });

  it('excludes a row whose rank_change could not be computed at all', () => {
    const rows = [
      row({
        securityId: 's1',
        symbol: 'NEW',
        rankChange: metric({ display: null, eligibility: 'not_applicable', reason: 'new to the board' }),
      }),
      row({ securityId: 's2', symbol: 'B', rankChange: metric({ display: '2' }) }),
    ];
    const movers = selectNotableMovers(rows, DEFAULT_OBSERVED_AT);
    expect(movers.map((m) => m.symbol)).toEqual(['B']);
  });

  // Round-9 lane-review finding 2: `attention.rank_change`'s stored `eligibility` can never be
  // updated back to `'stale'` for an unchanged observation, so a security that fell off the
  // board long ago can carry `eligibility: 'ok'` and a large historical Δ Rank forever — without
  // this exclusion it would permanently lead "the three largest moves this run."
  it('excludes a stale row even though its rank_change magnitude would otherwise lead the list', () => {
    const rows = [
      row({ securityId: 's1', symbol: 'GONE', isStale: true, rankChange: metric({ display: '85' }) }),
      row({ securityId: 's2', symbol: 'FRSH', isStale: false, rankChange: metric({ display: '2' }) }),
    ];
    const movers = selectNotableMovers(rows, DEFAULT_OBSERVED_AT);
    expect(movers.map((m) => m.symbol)).toEqual(['FRSH']);
  });

  it('returns an empty list rather than throwing when nothing qualifies', () => {
    expect(selectNotableMovers([], DEFAULT_OBSERVED_AT)).toEqual([]);
  });

  // Round-33 lane-review finding 2: without these, the card ranked Δ Rank values computed over
  // unlike spans and unlike sources as one undifferentiated list, with no way for a reader to
  // tell a same-run provider-bootstrap delta from a five-day own-history one.
  it('carries the source security\'s rankChangeSource and observationWindowHours, never a default', () => {
    const rows = [
      row({
        securityId: 's1',
        symbol: 'PROV',
        rankChangeSource: 'provider_reported',
        observationWindowHours: 24,
        rankChange: metric({ display: '50' }),
      }),
      row({
        securityId: 's2',
        symbol: 'OWN',
        rankChangeSource: 'own_history',
        observationWindowHours: 120,
        rankChange: metric({ display: '20' }),
      }),
    ];
    const movers = selectNotableMovers(rows, DEFAULT_OBSERVED_AT);
    const bySymbol = new Map(movers.map((m) => [m.symbol, m]));
    expect(bySymbol.get('PROV')?.rankChangeSource).toBe('provider_reported');
    expect(bySymbol.get('PROV')?.observationWindowHours).toBe(24);
    expect(bySymbol.get('OWN')?.rankChangeSource).toBe('own_history');
    expect(bySymbol.get('OWN')?.observationWindowHours).toBe(120);
  });

  // Round-42 lane-review finding 2: without this, the card had no way to know a mover was a
  // warm-up-window delta and rendered it indistinguishable from a matured one.
  it('derives isWarmingUp from the source row\'s own historyDepth, never a default', () => {
    const rows = [
      row({
        securityId: 's1',
        symbol: 'WARM',
        rankChange: metric({ display: '50' }),
        historyDepth: { securityId: 's1', comparableSnapshots: 2, requiredForZscore: 14 },
      }),
      row({
        securityId: 's2',
        symbol: 'MATURE',
        rankChange: metric({ display: '20' }),
        historyDepth: { securityId: 's2', comparableSnapshots: 20, requiredForZscore: 14 },
      }),
    ];
    const movers = selectNotableMovers(rows, DEFAULT_OBSERVED_AT);
    const bySymbol = new Map(movers.map((m) => [m.symbol, m]));
    expect(bySymbol.get('WARM')?.isWarmingUp).toBe(true);
    expect(bySymbol.get('MATURE')?.isWarmingUp).toBe(false);
  });

  // Round-21 lane-review finding 2. `!row.isStale` alone is a fixed six-hour wall-clock window,
  // not membership in the most recent run — under any collection cadence shorter than that floor,
  // a security that fell off the board an hour ago is not yet `isStale` but was still not part of
  // the run whose own frontier `lastCollectedAt` names. Without this exclusion the card would lead
  // "the three largest moves this run" with a security that was not part of it.
  it('excludes a row that predates the collection frontier even though it is not yet six-hour stale', () => {
    const rows = [
      row({
        securityId: 's1',
        symbol: 'CHURN',
        isStale: false,
        observedAt: new Date(DEFAULT_OBSERVED_AT.getTime() - 60 * 60_000),
        rankChange: metric({ display: '85' }),
      }),
      row({ securityId: 's2', symbol: 'FRSH', isStale: false, rankChange: metric({ display: '2' }) }),
    ];
    const movers = selectNotableMovers(rows, DEFAULT_OBSERVED_AT);
    expect(movers.map((m) => m.symbol)).toEqual(['FRSH']);
  });
});

// Round-36 lane-review finding 1: a security whose board entries have never once parsed has no
// row at all (`buildRow` is only ever reached for a security with a snapshot), so this function
// is the only path by which that gap ever surfaces — derived from active securities against
// `observedSymbols`, never from `rows`.
//
// **Takes `observedSymbols`, not `rows` — round-38 lane-review finding 1, correcting round 36's
// own implementation.** "Absent from `rows`" is not "never observed": `buildRow` also returns
// `null` for a security whose observation genuinely exists but needs recovery it cannot perform
// with `configVersion === null`. `observedSymbols` is exactly "a snapshot was found," independent
// of whether a row could be built from it.
describe('deriveNeverCollectedMalformedSymbols — round-36 lane-review finding 1, round-38 lane-review finding 1', () => {
  it('lists an active security that is malformed and has no observation at all', () => {
    const securities = [{ symbol: 'GME' }, { symbol: 'AAPL' }];
    const malformedTickers = new Set(['GME']);
    expect(deriveNeverCollectedMalformedSymbols(securities, new Set(), malformedTickers)).toEqual(['GME']);
  });

  // Round-38 lane-review finding 1's own reproduction: `observedSymbols` is a fact about
  // Postgres, not about a row — this must exclude the ticker regardless of whether the caller
  // could actually build a row from that observation (e.g. a real but currently unrenderable
  // corpus, a missing active config version), which is exactly what taking `rows` instead of
  // `observedSymbols` (round 36's own implementation) got wrong.
  it('excludes a malformed ticker with a recorded observation, regardless of whether a row was built from it', () => {
    const securities = [{ symbol: 'GME' }];
    const malformedTickers = new Set(['GME']);
    expect(deriveNeverCollectedMalformedSymbols(securities, new Set(['GME']), malformedTickers)).toEqual([]);
  });

  it('is case-insensitive on both the security symbol and the recorded ticker', () => {
    const securities = [{ symbol: 'gme' }];
    const malformedTickers = new Set(['GME']);
    expect(deriveNeverCollectedMalformedSymbols(securities, new Set(), malformedTickers)).toEqual(['gme']);
  });

  it('returns an empty list when nothing active is malformed', () => {
    const securities = [{ symbol: 'GME' }];
    expect(deriveNeverCollectedMalformedSymbols(securities, new Set(), new Set())).toEqual([]);
  });
});

describe('hasNotableMoverExcludedForStaleness — round-11 lane-review finding 1', () => {
  it('is true when a stale row would otherwise have qualified for the movers list', () => {
    const rows = [row({ securityId: 's1', symbol: 'GONE', isStale: true, rankChange: metric({ display: '85' }) })];
    expect(hasNotableMoverExcludedForStaleness(rows, DEFAULT_OBSERVED_AT)).toBe(true);
  });

  it('is false when the stale row would not have qualified anyway (thin sample)', () => {
    const rows = [
      row({ securityId: 's1', symbol: 'GONE', isStale: true, isThinSample: true, rankChange: metric({ display: '85' }) }),
    ];
    expect(hasNotableMoverExcludedForStaleness(rows, DEFAULT_OBSERVED_AT)).toBe(false);
  });

  it('is false when the stale row could not compute a rank change at all', () => {
    const rows = [
      row({
        securityId: 's1',
        symbol: 'GONE',
        isStale: true,
        rankChange: metric({ display: null, eligibility: 'not_applicable' }),
      }),
    ];
    expect(hasNotableMoverExcludedForStaleness(rows, DEFAULT_OBSERVED_AT)).toBe(false);
  });

  it('is false when nothing is stale, even if the movers list happens to be empty for another reason', () => {
    const rows = [
      row({
        securityId: 's1',
        symbol: 'NEW',
        isStale: false,
        rankChange: metric({ display: null, eligibility: 'not_applicable' }),
      }),
    ];
    expect(hasNotableMoverExcludedForStaleness(rows, DEFAULT_OBSERVED_AT)).toBe(false);
  });

  // The precise scenario round-11 finding 1 traced live: a degraded run (page state 'degraded',
  // never 'stale' — pageState checks degraded first) whose only row is both stale and otherwise
  // notable-mover-eligible. The old `state === 'stale'` signal would read false here.
  it('is true under a row profile matching an outage long enough to also age its own rows past the floor', () => {
    const rows = [row({ securityId: 's1', symbol: 'GME', isStale: true, rankChange: metric({ display: '40' }) })];
    expect(hasNotableMoverExcludedForStaleness(rows, DEFAULT_OBSERVED_AT)).toBe(true);
  });

  // Round-14 lane-review finding 2: a cold-cache recovery (`buildRow`'s `materializeAttentionMetrics
  // ForSecurity` call, `now` the read's own already-stale wall clock) freezes the freshly-computed
  // artifact's own `eligibility` at `'stale'`, not `'ok'` (`calc/artifact.ts`: `args.stale === true
  // ? 'stale' : 'ok'`) — exactly the row this predicate exists to catch on the very first read
  // after a cold start. Requiring `eligibility === 'ok'` missed it.
  it('is true when the stale row\'s own frozen eligibility is "stale", not just "ok" (a cold-cache-recovery reading)', () => {
    const rows = [
      row({ securityId: 's1', symbol: 'GME', isStale: true, rankChange: metric({ display: '40', eligibility: 'stale' }) }),
    ];
    expect(hasNotableMoverExcludedForStaleness(rows, DEFAULT_OBSERVED_AT)).toBe(true);
  });

  // Round-21 lane-review finding 2: kept symmetric with `selectNotableMovers`'s own new exclusion
  // (this predicate's own doc promises the two never drift apart) — a row otherwise eligible but
  // for predating the collection frontier is exactly as much "excluded for a freshness reason" as
  // one past the six-hour floor.
  it('is true when the excluded row predates the collection frontier even though it is not yet six-hour stale', () => {
    const rows = [
      row({
        securityId: 's1',
        symbol: 'CHURN',
        isStale: false,
        observedAt: new Date(DEFAULT_OBSERVED_AT.getTime() - 60 * 60_000),
        rankChange: metric({ display: '40' }),
      }),
    ];
    expect(hasNotableMoverExcludedForStaleness(rows, DEFAULT_OBSERVED_AT)).toBe(true);
  });
});

describe('pageState — F08 §4.5', () => {
  it('is unavailable when nothing has ever been collected', () => {
    expect(pageState({ hasEverCollected: false, degraded: false, rowCount: 0 })).toBe('unavailable');
  });

  it('is unavailable when collection has run but produced no rows', () => {
    expect(pageState({ hasEverCollected: true, degraded: false, rowCount: 0 })).toBe('unavailable');
  });

  it('is degraded when the last collector run failed but rows still exist', () => {
    expect(pageState({ hasEverCollected: true, degraded: true, rowCount: 3 })).toBe('degraded');
  });

  it('is ok when rows exist and the last run succeeded', () => {
    expect(pageState({ hasEverCollected: true, degraded: false, rowCount: 3 })).toBe('ok');
  });

  // Lane-review finding 5 (original wording): the collection run's own age (derived at read
  // time, independent of any persisted artifact's own fixed eligibility) must move the whole
  // page's state, not be silently absorbed into "ok".
  it('is stale when the collection run itself is stale by the real clock and did not fail', () => {
    expect(pageState({ hasEverCollected: true, degraded: false, rowCount: 3, collectionStale: true })).toBe('stale');
  });

  it('degraded still outranks stale — a failed run is the more specific fact', () => {
    expect(pageState({ hasEverCollected: true, degraded: true, rowCount: 3, collectionStale: true })).toBe('degraded');
  });

  // Round-8 lane-review finding 3: this used to be driven by `rows.some(row => row.isStale)`,
  // which pinned the whole page to `stale` forever the moment any single security fell off
  // ApeWisdom's top-100 board — routine churn under D-30, not a collector problem. The collection
  // itself being recent must read `ok` regardless of how stale one now-untracked row's leftover
  // observation is.
  it('is ok, not stale, when the collection run is recent even though a row-level check would flag one row', () => {
    expect(pageState({ hasEverCollected: true, degraded: false, rowCount: 3, collectionStale: false })).toBe('ok');
  });
});

describe('pointerMatchesCurrent — lane-review round 5 finding 1', () => {
  it('recognizes a genuinely fresh pointer even though Postgres and Date.toISOString() format the identical instant differently', () => {
    // `repositories/artifacts.ts` formats a loaded input's observed_at at microsecond precision;
    // `Date.prototype.toISOString()` always emits millisecond precision. A string-equality
    // comparison between the two never matches for the identical instant — the regression a
    // first version of this function had, which turned "detect staleness" into "always discard".
    const artifact = artifactWithRankNow([rankNowInput('2026-08-30T10:00:00.000000Z')]);
    const current = snapshot('2026-08-30T10:00:00.000Z');
    expect(pointerMatchesCurrent(artifact, current)).toBe(true);
  });

  it('still detects a genuinely stale pointer describing an older observation', () => {
    const artifact = artifactWithRankNow([rankNowInput('2026-08-30T09:00:00.000000Z')]);
    const current = snapshot('2026-08-30T10:00:00.000Z');
    expect(pointerMatchesCurrent(artifact, current)).toBe(false);
  });

  it('treats a missing rank_now input as a non-match rather than throwing', () => {
    const artifact = artifactWithRankNow([]);
    const current = snapshot('2026-08-30T10:00:00.000Z');
    expect(pointerMatchesCurrent(artifact, current)).toBe(false);
  });

  // Round-14 lane-review finding 2: `observedAt` alone cannot distinguish an unchanged reading
  // from a provider *revision* of it — `repositories/attention.ts` stores a revision as a
  // successor row with the identical `observed_at` but a later `ingested_at`, and
  // `attentionSnapshotHistory`'s `distinct on (observed_at) … order by ingested_at desc` makes
  // that revised row `current` under the same `observedAt` an earlier pointer already matched.
  it('detects a provider revision — the identical observedAt, a later ingestedAt — as a non-match', () => {
    const artifact = artifactWithRankNow([rankNowInput('2026-08-30T10:00:00.000000Z')]);
    const current: AttentionSnapshot = {
      ...snapshot('2026-08-30T10:00:00.000Z'),
      ingestedAt: new Date('2026-08-30T10:10:00.000Z'),
    };
    expect(pointerMatchesCurrent(artifact, current)).toBe(false);
  });

  it('still matches when observedAt and ingestedAt both agree — an unrevised, genuinely fresh pointer', () => {
    const artifact = artifactWithRankNow([rankNowInput('2026-08-30T10:00:00.000000Z')]);
    const current = snapshot('2026-08-30T10:00:00.000Z');
    expect(current.ingestedAt.getTime()).toBe(new Date('2026-08-30T10:00:00.000000Z').getTime());
    expect(pointerMatchesCurrent(artifact, current)).toBe(true);
  });
});

/**
 * Round-8 lane-review finding 5: `deriveRankChangeProvenance`/`deriveHistoryDepth` had no unit
 * coverage of their own — a mutant that gutted both entirely left all 94 vitest attention tests
 * green, caught only by `tests/e2e/attention.spec.ts`, and its `windowHours` half was not caught
 * by anything at any level. Both functions are exported from `leaderboard.ts` for exactly this,
 * the same way `pointerMatchesCurrent` above is.
 */
function rankPriorInput(observedAt: string, providerField: 'rank' | 'rank_24h_ago'): CalculationInputValue {
  return {
    key: 'rank_prior',
    value: '12',
    unit: 'ranks',
    dataType: 'decimal',
    source: 'apewisdom/apewisdom',
    quality: 'ok',
    freshness: 'fresh',
    provenance: {
      provider: 'apewisdom',
      providerField,
      sourceUrl: null,
      observedAt,
      availableAt: observedAt,
      ingestedAt: observedAt,
      rawPayloadId: null,
      licenseClass: 'attribution_required',
      redactionClass: 'public',
    },
  };
}

describe('deriveRankChangeProvenance — round-8 lane-review finding 5', () => {
  it('computes the real elapsed hours for an own_history comparison, not just the source label', () => {
    const artifact = artifactWithRankNow([rankPriorInput('2026-08-30T09:00:00.000000Z', 'rank')]);
    const current = snapshot('2026-08-30T10:00:00.000Z');
    const result = deriveRankChangeProvenance(artifact, current);
    expect(result.source).toBe('own_history');
    expect(result.windowHours).toBeCloseTo(1, 10);
  });

  it('computes a sub-hour window correctly, not just whole-hour spans', () => {
    const artifact = artifactWithRankNow([rankPriorInput('2026-08-30T09:55:00.000000Z', 'rank')]);
    const current = snapshot('2026-08-30T10:00:00.000Z');
    const result = deriveRankChangeProvenance(artifact, current);
    expect(result.source).toBe('own_history');
    expect(result.windowHours).toBeCloseTo(5 / 60, 10);
  });

  it("falls back to the snapshot's own windowHours in the bootstrap case", () => {
    const artifact = artifactWithRankNow([rankPriorInput('2026-08-30T10:00:00.000000Z', 'rank_24h_ago')]);
    const current = snapshot('2026-08-30T10:00:00.000Z');
    const result = deriveRankChangeProvenance(artifact, current);
    expect(result.source).toBe('provider_reported');
    expect(result.windowHours).toBe(current.windowHours);
  });

  it('falls back to provider_reported when the rank_prior input is entirely absent', () => {
    const artifact = artifactWithRankNow([]);
    const current = snapshot('2026-08-30T10:00:00.000Z');
    const result = deriveRankChangeProvenance(artifact, current);
    expect(result.source).toBe('provider_reported');
    expect(result.windowHours).toBe(current.windowHours);
  });
});

describe('deriveHistoryDepth — round-8 lane-review finding 5', () => {
  function historyInput(key: string): CalculationInputValue {
    return { ...rankNowInput('2026-08-30T10:00:00.000000Z'), key };
  }

  it('counts only the history_ prefixed inputs, not every input on the artifact', () => {
    const artifact = artifactWithRankNow([historyInput('history_1'), historyInput('history_2'), historyInput('rank_now')]);
    expect(deriveHistoryDepth(artifact)).toBe(2);
  });

  it('is zero when there are no history_ inputs at all — the methodology-boundary case', () => {
    const artifact = artifactWithRankNow([historyInput('rank_now')]);
    expect(deriveHistoryDepth(artifact)).toBe(0);
  });

  it('reaches exactly 14 at the depth-14 z-score boundary', () => {
    const inputs = Array.from({ length: 14 }, (_, i) => historyInput(`history_${i}`));
    const artifact = artifactWithRankNow(inputs);
    expect(deriveHistoryDepth(artifact)).toBe(14);
  });
});

/**
 * Round-25 lane-review finding 2: `mentions_zscore`'s `CoverageLabel` used to be given
 * `window={null}` unconditionally, on the theory that no time window applies to a depth-gated
 * count — but the window is real and derivable from the same `history_N` inputs
 * `deriveHistoryDepth` already counts, each carrying its own `observedAt`.
 */
describe('deriveZscoreWindowHours — round-25 lane-review finding 2', () => {
  function historyInputAt(key: string, observedAt: string): CalculationInputValue {
    return { ...rankNowInput(observedAt), key };
  }

  it('computes the span from the oldest history_N input to the current observation', () => {
    const artifact = artifactWithRankNow([
      historyInputAt('history_0', '2026-08-29T10:00:00.000000Z'),
      historyInputAt('history_1', '2026-08-27T10:00:00.000000Z'),
      historyInputAt('history_2', '2026-08-30T09:00:00.000000Z'),
    ]);
    const current = snapshot('2026-08-30T10:00:00.000Z');
    // Oldest is history_1 at Aug 27 10:00; current is Aug 30 10:00 — 3 days = 72 hours.
    expect(deriveZscoreWindowHours(artifact, current)).toBeCloseTo(72, 10);
  });

  it('does not assume the last-indexed input is the oldest', () => {
    const artifact = artifactWithRankNow([
      historyInputAt('history_0', '2026-08-30T05:00:00.000000Z'),
      historyInputAt('history_1', '2026-08-28T10:00:00.000000Z'),
    ]);
    const current = snapshot('2026-08-30T10:00:00.000Z');
    expect(deriveZscoreWindowHours(artifact, current)).toBeCloseTo(48, 10);
  });

  it('is null when the artifact carries no history_ input at all', () => {
    const artifact = artifactWithRankNow([historyInputAt('rank_now', '2026-08-30T10:00:00.000000Z')]);
    const current = snapshot('2026-08-30T10:00:00.000Z');
    expect(deriveZscoreWindowHours(artifact, current)).toBeNull();
  });
});

/**
 * Round-29 lane-review finding 2. `attention.mentions_zscore`'s own `scaled_mad` step
 * (`calc/methods/attention-mentions-zscore.ts`) marks itself `status: 'clamped'` whenever the
 * epsilon floor, not a genuine spread, produced the denominator — routine for a low-mention
 * security's tail, where at least half the comparison window shares the median. Without this,
 * the floored value renders as a plain, `eligibility: 'ok'` number indistinguishable from one
 * computed off a real spread.
 */
describe('toMetricView — round-29 lane-review finding 2', () => {
  it('is false when no step on the artifact carries a clamped status', () => {
    const artifact = artifactWithRankNow([]);
    const view = toMetricView(artifact, 'attention.mentions_zscore', 'Anomaly (z-score)');
    expect(view.isClamped).toBe(false);
  });

  it('is true when the artifact carries a clamped step, regardless of which step it is', () => {
    const artifact: CalculationArtifact = {
      ...artifactWithRankNow([]),
      steps: [
        {
          index: 0,
          key: 'scaled_mad',
          parentKey: null,
          label: 'MAD scaled to a normal-consistent spread estimate, floored at epsilon',
          expression: 'max({mad_constant} * {history_log_mad}, {epsilon})',
          substituted: 'max(1.4826 * 0, 0.000001)',
          exactValue: '0.000001',
          displayValue: '0.000001',
          unit: 'log_mentions',
          roundingRule: 'ratio_6dp_half_even',
          status: 'clamped',
          operands: {},
          notes: [],
        },
      ],
    };
    const view = toMetricView(artifact, 'attention.mentions_zscore', 'Anomaly (z-score)');
    expect(view.isClamped).toBe(true);
  });
});

/**
 * Round-50 lane-review finding 2. `reason: artifact.abstention?.message ?? null` had no test at
 * any level — `tests/e2e/attention.spec.ts`'s methodology-boundary case only asserts
 * `data-eligibility="not_applicable"` and that `[data-abstained]` is visible, both of which stay
 * true if this line regressed to `reason: null`; `InspectableMetric`'s own generic fallback note
 * ("This metric does not apply here") would then silently replace the real, specific explanation
 * §4.2 requires this feature to render, not swallow. `tests/unit/ui/attention-table.test.ts`
 * (round 49) covers the component rendering a reason it is *handed*; this covers the seam that
 * hands it one from the real artifact.
 */
describe('toMetricView — round-50 lane-review finding 2', () => {
  it('carries the artifact\'s own abstention message through as the view\'s reason', () => {
    const artifact: CalculationArtifact = {
      ...artifactWithRankNow([]),
      result: null,
      eligibility: 'not_applicable',
      abstention: {
        reason: 'methodology_version_boundary',
        message:
          'The prior observation used a different ApeWisdom methodology version, so a rank change across the boundary is not shown.',
      },
    };
    const view = toMetricView(artifact, 'attention.rank_change', 'Δ Rank');
    expect(view.reason).toBe(
      'The prior observation used a different ApeWisdom methodology version, so a rank change across the boundary is not shown.',
    );
  });

  it('is null when the artifact carries no abstention', () => {
    const view = toMetricView(artifactWithRankNow([]), 'attention.rank_change', 'Δ Rank');
    expect(view.reason).toBeNull();
  });
});
