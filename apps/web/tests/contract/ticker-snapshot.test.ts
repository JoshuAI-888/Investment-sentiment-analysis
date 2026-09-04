import { describe, expect, it } from 'vitest';
import {
  axisMetric,
  divergencePanel,
  evidenceDrawer,
  evidenceItemView,
  searchResponse,
  stanceFrame,
  tickerSnapshotResponse,
} from '../../src/services/ticker/contract';

const okMetric = {
  calculationId: '00000000-0000-4000-8000-000000000001',
  metricId: 'news.sentiment',
  label: 'News sentiment',
  display: '0.200000',
  unit: 'sentiment_unit',
  roundingRule: 'ratio_6dp_half_even',
  eligibility: 'ok' as const,
  reason: null,
  asOf: '2026-08-30T12:00:00.000Z',
  source: 'news',
  n: 5,
  window: 'articles retrieved this render',
  observedAt: '2026-08-30T11:00:00.000Z',
  stale: false,
};

describe('axisMetric', () => {
  it('parses a fully-populated ok metric', () => {
    expect(() => axisMetric.parse(okMetric)).not.toThrow();
  });

  it('parses an abstained metric with a null display and non-null reason', () => {
    expect(() =>
      axisMetric.parse({ ...okMetric, display: null, eligibility: 'insufficient_data', reason: 'n < 3' }),
    ).not.toThrow();
  });

  it('rejects an eligibility value outside the four the artifact type allows', () => {
    expect(() => axisMetric.parse({ ...okMetric, eligibility: 'maybe' })).toThrow();
  });
});

describe('evidenceItemView / evidenceDrawer', () => {
  const item = {
    id: '00000000-0000-4000-8000-000000000002',
    dedupeKey: 'https://example.com/a|a title',
    sourceKind: 'news',
    provider: 'marketaux',
    publisher: 'Example Wire',
    title: 'A title',
    url: 'https://example.com/a',
    publishedAt: '2026-08-30T00:00:00.000Z',
    retrievedAt: '2026-08-30T01:00:00.000Z',
    snippet: 'the stored snippet as retrieved',
    relevance: '0.9',
    availability: 'available' as const,
    lastCheckedAt: null,
    unreachableNote: null,
  };

  it('parses an available item', () => {
    expect(() => evidenceItemView.parse(item)).not.toThrow();
  });

  it('parses an unreachable item with a non-null unreachableNote and a non-null snippet', () => {
    expect(() =>
      evidenceItemView.parse({
        ...item,
        availability: 'unreachable',
        unreachableNote: 'source no longer reachable — snippet as retrieved on 2026-08-30',
      }),
    ).not.toThrow();
  });

  it('rejects an availability value outside the schema enum', () => {
    expect(() => evidenceItemView.parse({ ...item, availability: 'archived' })).toThrow();
  });

  it('parses a drawer with retrieved/used counts and a truncated flag', () => {
    expect(() =>
      evidenceDrawer.parse({ items: [item], retrievedCount: 10, usedCount: 1, truncated: true, pageTruncated: false }),
    ).not.toThrow();
  });
});

describe('stanceFrame', () => {
  it('parses a frame with a null metric (not yet computed) and its own disclosure', () => {
    expect(() =>
      stanceFrame.parse({
        axis: 'x',
        label: 'X',
        metric: null,
        sampleAdequacy: null,
        retrievedCount: 0,
        usedCount: 0,
        window: 'evidence retrieved this render',
        disclosure: 'This frame is a sample of watched-account X posts opened by a price trigger.',
        selectionBiasNotes: [],
      }),
    ).not.toThrow();
  });

  it('rejects an axis outside reddit/x/substack', () => {
    expect(() =>
      stanceFrame.parse({
        axis: 'stocktwits',
        label: 'Stocktwits',
        metric: null,
        sampleAdequacy: null,
        retrievedCount: 0,
        usedCount: 0,
        window: 'w',
        disclosure: 'd',
        selectionBiasNotes: [],
      }),
    ).toThrow();
  });
});

describe('divergencePanel', () => {
  it('parses the available branch', () => {
    expect(() =>
      divergencePanel.parse({
        available: true,
        metricId: 'market.divergence_state',
        calculationId: '00000000-0000-4000-8000-000000000003',
        state: 'confirming_interest',
        interpretation: 'Attention and price are moving in the same direction; causality is unproven.',
        disclosure:
          'This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.',
        socialAxisDisclosure: "The stance input to this state is Reddit's sampled frame alone.",
        observedAt: new Date('2026-09-01T00:00:00.000Z'),
        stale: false,
      }),
    ).not.toThrow();
  });

  it('rejects the available branch missing its socialAxisDisclosure', () => {
    expect(() =>
      divergencePanel.parse({
        available: true,
        metricId: 'market.divergence_state',
        calculationId: '00000000-0000-4000-8000-000000000003',
        state: 'confirming_interest',
        interpretation: 'x',
        disclosure:
          'This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.',
      }),
    ).toThrow();
  });

  it('parses the unavailable branch with a reason and no state', () => {
    expect(() => divergencePanel.parse({ available: false, reason: 'not enough data yet' })).not.toThrow();
  });

  it('rejects the available branch missing its disclosure', () => {
    expect(() =>
      divergencePanel.parse({
        available: true,
        metricId: 'market.divergence_state',
        calculationId: '00000000-0000-4000-8000-000000000003',
        state: 'confirming_interest',
        interpretation: 'x',
      }),
    ).toThrow();
  });
});

describe('tickerSnapshotResponse', () => {
  it('parses the refused branch', () => {
    expect(() =>
      tickerSnapshotResponse.parse({
        resolved: false,
        refusal: { refused: true, reason: 'not_found', message: "No active security is on record for 'ZZZZ'." },
      }),
    ).not.toThrow();
  });

  it('parses a fully resolved response', () => {
    const resolved = {
      resolved: true as const,
      header: {
        securityId: '00000000-0000-4000-8000-000000000004',
        symbol: 'GME',
        name: 'GameStop',
        exchange: 'NYSE',
        assetType: 'equity' as const,
        sector: 'Consumer',
        price: '24.50',
        changePercent: '1.25',
        session: 'eod' as const,
        provider: 'fmp',
        observedAt: '2026-08-30T00:00:00.000Z',
        filingsHref: null,
        insiderTransactionsHref: null,
      },
      attention: {
        mentions: null,
        rank: null,
        observedAt: null,
        mentionDelta: null,
        rankChange: null,
        chartSegments: [],
        coverageDisclosure: 'no coverage floor is recorded yet for reddit',
        gapCount: 0,
      },
      stance: [],
      news: { metric: null, articleCount: 0, window: 'articles retrieved this render' },
      price: {
        returns: [],
        horizonDisclosure: 'the horizons below are 7/30/90/180 calendar days, not 5d/20d trading days',
        volatility20: null,
        regime: null,
        rsi14: null,
        movingAverage20: null,
        movingAverage50: null,
      },
      divergence: { available: false, reason: 'not enough data yet' },
      evidence: { items: [], retrievedCount: 0, usedCount: 0, truncated: false, pageTruncated: false },
      methodology: [],
      asOf: '2026-08-30T00:00:00.000Z',
    };

    expect(() => tickerSnapshotResponse.parse(resolved)).not.toThrow();
  });
});

describe('searchResponse', () => {
  it('parses zero results', () => {
    expect(() => searchResponse.parse({ query: 'zz', results: [] })).not.toThrow();
  });

  it('parses a result with a null eligibilityState (no profile snapshot yet)', () => {
    expect(() =>
      searchResponse.parse({
        query: 'GM',
        results: [
          {
            id: '00000000-0000-4000-8000-000000000005',
            symbol: 'GME',
            name: 'GameStop',
            exchange: 'NYSE',
            assetType: 'equity',
            eligibilityState: null,
          },
        ],
      }),
    ).not.toThrow();
  });
});
