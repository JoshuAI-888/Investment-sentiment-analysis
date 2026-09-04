import { describe, expect, it } from 'vitest';
import {
  dashboardMetric,
  dashboardResponse,
  refreshResponse,
} from '../../src/services/dashboard/contract';

const okMetric = {
  calculationId: '00000000-0000-4000-8000-000000000001',
  metricId: 'market.composite',
  label: 'Market composite',
  display: '0.190000',
  unit: 'score_unit',
  roundingRule: 'ratio_6dp_half_even',
  eligibility: 'ok' as const,
  reason: null,
  asOf: '2026-08-30T12:00:00.000Z',
  source: 'internal — weighted blend of component methods',
  n: 3,
  window: 'this refresh cycle',
  observedAt: '2026-08-30T11:00:00.000Z',
  stale: false,
};

describe('dashboardMetric', () => {
  it('parses a fully-populated ok metric', () => {
    expect(() => dashboardMetric.parse(okMetric)).not.toThrow();
  });

  it('parses an abstained metric with a null display and non-null reason', () => {
    expect(() =>
      dashboardMetric.parse({ ...okMetric, display: null, eligibility: 'insufficient_data', reason: 'not enough data' }),
    ).not.toThrow();
  });

  it('rejects an eligibility value outside the four the artifact type allows', () => {
    expect(() => dashboardMetric.parse({ ...okMetric, eligibility: 'maybe' })).toThrow();
  });
});

describe('dashboardResponse', () => {
  const base = {
    state: 'fresh' as const,
    computedDepth: 1,
    marketComposite: {
      composite: okMetric,
      components: [
        {
          key: 'news_sentiment' as const,
          label: 'News sentiment',
          officialWeight: '0.35',
          renormalizedWeight: '0.538462',
          participated: true,
          metric: okMetric,
        },
        {
          key: 'sampled_retail_stance' as const,
          label: 'Sampled retail stance',
          officialWeight: '0.10',
          renormalizedWeight: null,
          participated: false,
          metric: null,
        },
      ],
    },
    sectorTiles: [
      { sectorKey: 'technology', sectorLabel: 'Technology', tickerSymbol: 'XLK', newsSentiment: okMetric, priceRegime: null },
    ],
    degradedProviders: [] as string[],
    lastRefusal: null,
    providerMode: 'fixture' as const,
  };

  it('parses a full, well-formed dashboard response', () => {
    expect(() => dashboardResponse.parse(base)).not.toThrow();
  });

  it('parses the empty (cold-start) response, composite and every tile metric null', () => {
    expect(() =>
      dashboardResponse.parse({
        ...base,
        state: 'empty',
        computedDepth: 0,
        marketComposite: { composite: null, components: [] },
        sectorTiles: [],
      }),
    ).not.toThrow();
  });

  it('parses a populated lastRefusal', () => {
    expect(() =>
      dashboardResponse.parse({ ...base, lastRefusal: { refused: true, reason: 'budget', message: 'over the ceiling' } }),
    ).not.toThrow();
  });

  it('rejects an unknown page state', () => {
    expect(() => dashboardResponse.parse({ ...base, state: 'broken' })).toThrow();
  });
});

describe('refreshResponse', () => {
  it('parses an ok result', () => {
    expect(() => refreshResponse.parse({ status: 'ok', computedAt: '2026-08-30T12:00:00.000Z' })).not.toThrow();
  });

  it('parses a refused result with a reason and message', () => {
    expect(() =>
      refreshResponse.parse({ status: 'refused', reason: 'rate_limited', message: 'try again shortly' }),
    ).not.toThrow();
  });

  it('parses an infrastructure error result', () => {
    expect(() => refreshResponse.parse({ status: 'error', message: 'no active config version' })).not.toThrow();
  });

  it('rejects a refused result with no message', () => {
    expect(() => refreshResponse.parse({ status: 'refused', reason: 'budget', message: '' })).toThrow();
  });
});
