import { describe, expect, it } from 'vitest';
import { flattenMetrics } from '@/services/research/metrics';
import type { TickerSnapshotResponse, AxisMetric } from '@/services/ticker/contract';

function okMetric(overrides: Partial<AxisMetric> = {}): AxisMetric {
  return {
    calculationId: 'calc-1',
    metricId: 'attention.rank_change',
    label: 'Rank change',
    display: '3',
    unit: '',
    roundingRule: 'integer',
    eligibility: 'ok',
    reason: null,
    asOf: new Date('2026-08-31T00:00:00.000Z'),
    source: 'reddit',
    n: 1,
    window: '24 h',
    observedAt: new Date('2026-08-31T00:00:00.000Z'),
    stale: false,
    ...overrides,
  };
}

function snapshotWith(overrides: Partial<Extract<TickerSnapshotResponse, { resolved: true }>> = {}): TickerSnapshotResponse {
  return {
    resolved: true,
    header: {
      securityId: '00000000-0000-4000-8000-000000000001',
      symbol: 'AAPL',
      name: 'Apple Inc.',
      exchange: 'NASDAQ',
      assetType: 'equity',
      sector: null,
      price: null,
      changePercent: null,
      session: null,
      provider: null,
      observedAt: null,
      filingsHref: null,
      insiderTransactionsHref: null,
    },
    attention: { mentions: null, rank: null, observedAt: null, mentionDelta: null, rankChange: null, chartSegments: [], coverageDisclosure: '', gapCount: 0 },
    stance: [],
    news: { metric: null, articleCount: 0, window: 'articles retrieved this render' },
    price: { returns: [], horizonDisclosure: 'd', volatility20: null, regime: null, rsi14: null, movingAverage20: null, movingAverage50: null },
    divergence: { available: false, reason: 'no data' },
    evidence: { items: [], retrievedCount: 0, usedCount: 0, truncated: false, pageTruncated: false },
    methodology: [],
    asOf: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('flattenMetrics', () => {
  it('returns an empty list for an unresolved (refused) snapshot', () => {
    expect(flattenMetrics({ resolved: false, refusal: { refused: true, reason: 'not_found', message: 'x' } })).toEqual([]);
  });

  it('includes an eligible metric with its display value', () => {
    const snapshot = snapshotWith({ attention: { mentions: 10, rank: 5, observedAt: new Date(), mentionDelta: null, rankChange: okMetric(), chartSegments: [], coverageDisclosure: '', gapCount: 0 } });
    const facts = flattenMetrics(snapshot);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.metricId).toBe('attention.rank_change');
    expect(facts[0]?.display).toBe('3');
  });

  it('excludes an ineligible (abstained) metric — there is no display value to cite', () => {
    const snapshot = snapshotWith({
      attention: { mentions: 10, rank: 5, observedAt: new Date(), mentionDelta: null, rankChange: okMetric({ eligibility: 'insufficient_data', display: null }), chartSegments: [], coverageDisclosure: '', gapCount: 0 },
    });
    expect(flattenMetrics(snapshot)).toEqual([]);
  });

  it('includes the divergence panel metric only when it is available', () => {
    const snapshot = snapshotWith({
      divergence: { available: true, metricId: 'market.divergence_state', calculationId: 'calc-9', state: 'confirming', interpretation: 'x', disclosure: 'x', socialAxisDisclosure: 'x', observedAt: new Date(), stale: false },
    });
    const facts = flattenMetrics(snapshot);
    expect(facts.some((fact) => fact.metricId === 'market.divergence_state' && fact.display === 'confirming')).toBe(true);
  });

  it('never includes a stance metric with a thin sample as citable — n travels through unchanged', () => {
    const snapshot = snapshotWith({
      stance: [
        { axis: 'x', label: 'X', metric: okMetric({ metricId: 'social.stance_x', n: 3, display: '0.100000' }), sampleAdequacy: null, retrievedCount: 3, usedCount: 3, window: 'w', disclosure: 'd', selectionBiasNotes: [] },
      ],
    });
    const facts = flattenMetrics(snapshot);
    expect(facts[0]?.n).toBe(3);
  });
});
