import { describe, expect, it } from 'vitest';
import {
  attentionLeaderboardResponse,
  attentionRowView,
  historyDepth,
  notableMoverView,
} from '../../src/services/attention/contract';

const okMetric = {
  calculationId: '00000000-0000-4000-8000-000000000001',
  metricId: 'attention.rank_change',
  label: 'Δ Rank',
  display: '3',
  unit: 'ranks',
  roundingRule: 'int_0dp_half_even',
  eligibility: 'ok' as const,
  reason: null,
  isClamped: false,
};

const baseRow = {
  securityId: '00000000-0000-4000-8000-000000000002',
  symbol: 'GME',
  companyName: 'GameStop Corp.',
  mentions: { ...okMetric, metricId: 'attention.mentions_now', label: 'Mentions', display: '1204' },
  mentionDelta: { ...okMetric, metricId: 'attention.mention_delta', label: 'Δ Mentions', display: '304' },
  mentionGrowth: null,
  upvotes: { ...okMetric, metricId: 'attention.engagement_now', label: 'Upvotes', display: '8213' },
  rank: { ...okMetric, metricId: 'attention.rank_now', label: 'Rank', display: '1' },
  rankChange: okMetric,
  mentionsZscore: null,
  mentionsZscoreWindowHours: null,
  observedAt: '2026-09-01T00:00:00.000Z',
  observationWindowHours: 24,
  historyDepth: { securityId: '00000000-0000-4000-8000-000000000002', comparableSnapshots: 20, requiredForZscore: 14 as const },
  isNew: false,
  isDroppedFromBoard: false,
  isMethodologyBoundary: false,
  isThinSample: false,
  rankChangeSource: 'own_history' as const,
  isStale: false,
  wasMalformedLastRun: false,
};

describe('historyDepth — F08 §3', () => {
  it('parses a valid depth record', () => {
    expect(() =>
      historyDepth.parse({ securityId: baseRow.securityId, comparableSnapshots: 14, requiredForZscore: 14 }),
    ).not.toThrow();
  });

  it('rejects a negative comparable-snapshot count', () => {
    expect(() =>
      historyDepth.parse({ securityId: baseRow.securityId, comparableSnapshots: -1, requiredForZscore: 14 }),
    ).toThrow();
  });
});

describe('attentionRowView — F08 §3', () => {
  it('parses a fully-populated row', () => {
    expect(() => attentionRowView.parse(baseRow)).not.toThrow();
  });

  it('parses a row with an abstained rank change (a methodology boundary), display null', () => {
    expect(() =>
      attentionRowView.parse({
        ...baseRow,
        rankChange: { ...okMetric, display: null, eligibility: 'not_applicable', reason: 'methodology changed' },
        isMethodologyBoundary: true,
      }),
    ).not.toThrow();
  });

  it('rejects an eligibility value outside the contract\'s four', () => {
    expect(() => attentionRowView.parse({ ...baseRow, rankChange: { ...okMetric, eligibility: 'maybe' } })).toThrow();
  });

  // Round-33 lane-review finding 3: without this field, a row gives a reader no way to tell a
  // security dropped by a malformed-data bug from one that genuinely fell off the board.
  it('rejects a row missing wasMalformedLastRun', () => {
    const { wasMalformedLastRun: _omit, ...withoutFlag } = baseRow;
    expect(() => attentionRowView.parse(withoutFlag)).toThrow();
  });

  it('parses a row flagged as malformed on the last run', () => {
    expect(() => attentionRowView.parse({ ...baseRow, wasMalformedLastRun: true })).not.toThrow();
  });
});

// Round-33 lane-review finding 2: `NotableMoverView` needs the same source/window disclosure
// `AttentionRowView` already carries for the identical security, or the headline card ranks Δ
// Rank values from unlike spans and sources with no way for a reader to tell.
describe('notableMoverView — F08 §3 (round-33 lane-review finding 2)', () => {
  const baseMover = {
    securityId: baseRow.securityId,
    symbol: baseRow.symbol,
    companyName: baseRow.companyName,
    rankChange: okMetric,
    mentionDelta: baseRow.mentionDelta,
    rankChangeSource: 'own_history' as const,
    observationWindowHours: 24,
    isWarmingUp: false,
  };

  it('parses a fully-populated mover', () => {
    expect(() => notableMoverView.parse(baseMover)).not.toThrow();
  });

  it('rejects a mover missing rankChangeSource', () => {
    const { rankChangeSource: _omit, ...withoutSource } = baseMover;
    expect(() => notableMoverView.parse(withoutSource)).toThrow();
  });

  it('rejects a mover missing observationWindowHours', () => {
    const { observationWindowHours: _omit, ...withoutWindow } = baseMover;
    expect(() => notableMoverView.parse(withoutWindow)).toThrow();
  });

  // Round-42 lane-review finding 2: without this field the card had no way to know a mover was
  // a warm-up-window delta, and rendered it indistinguishable from a matured one.
  it('rejects a mover missing isWarmingUp', () => {
    const { isWarmingUp: _omit, ...withoutWarmingUp } = baseMover;
    expect(() => notableMoverView.parse(withoutWarmingUp)).toThrow();
  });
});

describe('attentionLeaderboardResponse — F08 §3', () => {
  it('parses an "ok" response with rows and notable movers', () => {
    expect(() =>
      attentionLeaderboardResponse.parse({
        state: 'ok',
        providerMethodologyVersion: 'apewisdom-2026-09',
        lastCollectedAt: '2026-09-01T00:00:00.000Z',
        rows: [baseRow],
        notableMovers: [
          {
            securityId: baseRow.securityId,
            symbol: baseRow.symbol,
            companyName: baseRow.companyName,
            rankChange: okMetric,
            mentionDelta: baseRow.mentionDelta,
            rankChangeSource: baseRow.rankChangeSource,
            isWarmingUp: false,
            observationWindowHours: baseRow.observationWindowHours,
          },
        ],
        degraded: false,
        degradedMessage: null,
        degradedReason: null,
        unavailableReason: null,
        notableMoversExcludedForStaleness: false,
        boardSourceUrl: 'https://apewisdom.io/',
        boardMethodologyUrl: 'https://apewisdom.io/methodology/',
        neverCollectedMalformedSymbols: [],
        configVersionGapSymbols: [],
        activeConfigVersionMissing: false,
      }),
    ).not.toThrow();
  });

  it('parses the "unavailable" cold-start response with empty rows', () => {
    expect(() =>
      attentionLeaderboardResponse.parse({
        state: 'unavailable',
        providerMethodologyVersion: null,
        lastCollectedAt: null,
        rows: [],
        notableMovers: [],
        degraded: false,
        degradedMessage: null,
        degradedReason: null,
        unavailableReason: 'never_collected',
        notableMoversExcludedForStaleness: false,
        boardSourceUrl: 'https://apewisdom.io/',
        boardMethodologyUrl: 'https://apewisdom.io/methodology/',
        neverCollectedMalformedSymbols: [],
        configVersionGapSymbols: [],
        activeConfigVersionMissing: false,
      }),
    ).not.toThrow();
  });

  // Round-10 lane-review finding 4: the two causes `state: 'unavailable'` collapses (never
  // collected vs. a missing active config version over a possibly-populated corpus) need
  // distinct copy — this asserts the contract actually carries which one fired.
  it('parses the "unavailable" response with the no_active_config_version reason', () => {
    expect(() =>
      attentionLeaderboardResponse.parse({
        state: 'unavailable',
        providerMethodologyVersion: null,
        lastCollectedAt: null,
        rows: [],
        notableMovers: [],
        degraded: false,
        degradedMessage: null,
        degradedReason: null,
        unavailableReason: 'no_active_config_version',
        notableMoversExcludedForStaleness: false,
        boardSourceUrl: 'https://apewisdom.io/',
        boardMethodologyUrl: 'https://apewisdom.io/methodology/',
        neverCollectedMalformedSymbols: [],
        configVersionGapSymbols: [],
        activeConfigVersionMissing: false,
      }),
    ).not.toThrow();
  });

  // Round-11 lane-review finding 1: asserts the contract carries the staleness-exclusion signal
  // even under `state: 'degraded'` — the more common of the two doors that empties this list.
  it('parses a "degraded" response with notableMoversExcludedForStaleness true', () => {
    expect(() =>
      attentionLeaderboardResponse.parse({
        state: 'degraded',
        providerMethodologyVersion: 'apewisdom-2026-09',
        lastCollectedAt: '2026-09-01T00:00:00.000Z',
        rows: [{ ...baseRow, isStale: true }],
        notableMovers: [],
        degraded: true,
        degradedMessage: 'ApeWisdom could not be reached on the last collection run.',
        degradedReason: 'provider_unreachable',
        unavailableReason: null,
        notableMoversExcludedForStaleness: true,
        boardSourceUrl: 'https://apewisdom.io/',
        boardMethodologyUrl: 'https://apewisdom.io/methodology/',
        neverCollectedMalformedSymbols: [],
        configVersionGapSymbols: [],
        activeConfigVersionMissing: false,
      }),
    ).not.toThrow();
  });

  // Round-13 lane-review finding 4: the contract carries `degradedReason` itself now, not just
  // the message text derived from it — this is what `page.tsx` uses to decide whether the
  // shared `DegradedPanel`'s "provider unavailable" claim belongs on the page at all.
  it.each(['no_new_data', 'provider_contract_changed'] as const)(
    'parses a "degraded" response with degradedReason %s',
    (reason) => {
      expect(() =>
        attentionLeaderboardResponse.parse({
          state: 'degraded',
          providerMethodologyVersion: 'apewisdom-2026-09',
          lastCollectedAt: '2026-09-01T00:00:00.000Z',
          rows: [baseRow],
          notableMovers: [],
          degraded: true,
          degradedMessage: 'ApeWisdom was reached on the last collection run, but nothing new could be added.',
          degradedReason: reason,
          unavailableReason: null,
          notableMoversExcludedForStaleness: false,
          boardSourceUrl: 'https://apewisdom.io/',
          boardMethodologyUrl: 'https://apewisdom.io/methodology/',
          neverCollectedMalformedSymbols: [],
          configVersionGapSymbols: [],
          activeConfigVersionMissing: false,
        }),
      ).not.toThrow();
    },
  );

  // Round-36 lane-review finding 1: a security whose board entries have never once parsed has no
  // row at all, so this page-level field is the only way that gap ever reaches the response.
  it('rejects a response missing neverCollectedMalformedSymbols', () => {
    const valid = {
      state: 'ok' as const,
      providerMethodologyVersion: 'apewisdom-2026-09',
      lastCollectedAt: '2026-09-01T00:00:00.000Z',
      rows: [baseRow],
      notableMovers: [],
      degraded: false,
      degradedMessage: null,
      degradedReason: null,
      unavailableReason: null,
      notableMoversExcludedForStaleness: false,
      boardSourceUrl: 'https://apewisdom.io/',
      boardMethodologyUrl: 'https://apewisdom.io/methodology/',
      neverCollectedMalformedSymbols: ['NVDA'],
      configVersionGapSymbols: [],
      activeConfigVersionMissing: false,
    };
    expect(() => attentionLeaderboardResponse.parse(valid)).not.toThrow();
    const { neverCollectedMalformedSymbols: _omit, ...withoutField } = valid;
    expect(() => attentionLeaderboardResponse.parse(withoutField)).toThrow();
  });

  // Round-42 lane-review finding 1: a security with a real observation but no row (a missing
  // active config version) had no field on this response to disclose it at all.
  it('rejects a response missing configVersionGapSymbols', () => {
    const valid = {
      state: 'ok' as const,
      providerMethodologyVersion: 'apewisdom-2026-09',
      lastCollectedAt: '2026-09-01T00:00:00.000Z',
      rows: [baseRow],
      notableMovers: [],
      degraded: false,
      degradedMessage: null,
      degradedReason: null,
      unavailableReason: null,
      notableMoversExcludedForStaleness: false,
      boardSourceUrl: 'https://apewisdom.io/',
      boardMethodologyUrl: 'https://apewisdom.io/methodology/',
      neverCollectedMalformedSymbols: [],
      configVersionGapSymbols: ['NVDA'],
      activeConfigVersionMissing: true,
    };
    expect(() => attentionLeaderboardResponse.parse(valid)).not.toThrow();
    const { configVersionGapSymbols: _omit, ...withoutField } = valid;
    expect(() => attentionLeaderboardResponse.parse(withoutField)).toThrow();
  });

  // Round-47 lane-review finding 1: `configVersionGapSymbols` alone under-discloses the fault —
  // a run where every tracked security's Redis pointers are already warm builds every row
  // successfully even with no active config version, leaving `configVersionGapSymbols: []`. This
  // page-level field is what still says so.
  it('rejects a response missing activeConfigVersionMissing', () => {
    const valid = {
      state: 'ok' as const,
      providerMethodologyVersion: 'apewisdom-2026-09',
      lastCollectedAt: '2026-09-01T00:00:00.000Z',
      rows: [baseRow],
      notableMovers: [],
      degraded: false,
      degradedMessage: null,
      degradedReason: null,
      unavailableReason: null,
      notableMoversExcludedForStaleness: false,
      boardSourceUrl: 'https://apewisdom.io/',
      boardMethodologyUrl: 'https://apewisdom.io/methodology/',
      neverCollectedMalformedSymbols: [],
      configVersionGapSymbols: [],
      activeConfigVersionMissing: true,
    };
    expect(() => attentionLeaderboardResponse.parse(valid)).not.toThrow();
    const { activeConfigVersionMissing: _omit, ...withoutField } = valid;
    expect(() => attentionLeaderboardResponse.parse(withoutField)).toThrow();
  });
});
