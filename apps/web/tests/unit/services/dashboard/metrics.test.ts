import { describe, expect, it } from 'vitest';
import type { CalculationArtifact, CalculationInputValue, CalculationStepRecord } from '../../../../src/calc/artifact';
import {
  freshestObservedAt,
  pageState,
  renormalizedComponentWeight,
  toDashboardMetric,
} from '../../../../src/services/dashboard/metrics';

function input(key: string, observedAt: string | null): CalculationInputValue {
  return {
    key,
    value: '1',
    unit: null,
    dataType: 'decimal',
    source: 'test',
    quality: 'ok',
    freshness: 'fresh',
    provenance: {
      provider: 'test',
      providerField: null,
      sourceUrl: null,
      observedAt,
      availableAt: observedAt,
      ingestedAt: observedAt,
      rawPayloadId: null,
      licenseClass: 'internal_fixture',
      redactionClass: 'public',
    },
  };
}

function artifact(overrides: Partial<CalculationArtifact> = {}): CalculationArtifact {
  return {
    calculationId: 'calc-1',
    methodId: 'price.regime',
    methodVersion: '1.0.0',
    subject: { kind: 'security', id: 'sec-1', label: 'AAPL' },
    asOf: '2026-08-30T12:00:00.000Z',
    inputs: [],
    assumptions: [],
    steps: [],
    result: { exact: '0.5', display: '0.500000', roundingRule: 'ratio_6dp_half_even', unit: 'trend_unit' },
    abstention: null,
    eligibility: 'ok',
    inputHash: 'h1',
    resultHash: 'h2',
    configVersion: '1',
    scenario: { kind: 'official' },
    points: null,
    warnings: [],
    retentionClass: 'standard',
    computedAt: '2026-08-30T12:00:01.000Z',
    ...overrides,
  };
}

describe('toDashboardMetric — label formatting', () => {
  it('reports n as the count of close_* series inputs for price.regime', () => {
    const a = artifact({
      inputs: [input('close_0', '2026-08-01T00:00:00.000Z'), input('close_1', '2026-08-02T00:00:00.000Z'), input('quote_kind', null)],
    });
    const metric = toDashboardMetric(a, 'Price regime');
    expect(metric.n).toBe(2);
    expect(metric.source).toBe('market');
    expect(metric.window).toBe('21 trading sessions');
  });

  it('reports n as the count of entity_sentiment_* inputs for news.sentiment', () => {
    const a = artifact({
      methodId: 'news.sentiment',
      inputs: [input('entity_sentiment_0', '2026-08-28T00:00:00.000Z'), input('relevance_0', null), input('age_hours_0', null)],
    });
    const metric = toDashboardMetric(a, 'News sentiment');
    expect(metric.n).toBe(1);
    expect(metric.source).toBe('marketaux');
  });

  it('reports n as sector_etfs_with_data for market.sector_breadth', () => {
    const a = artifact({
      methodId: 'market.sector_breadth',
      inputs: [
        { ...input('sector_etfs_with_data', null), value: '7' },
        { ...input('positive_sector_etfs', null), value: '3' },
      ],
    });
    const metric = toDashboardMetric(a, 'Sector breadth');
    expect(metric.n).toBe(7);
    expect(metric.source).toContain('internal');
  });

  it('reports n as the number of declared inputs for market.composite', () => {
    const a = artifact({
      methodId: 'market.composite',
      inputs: [input('news_sentiment', null), input('price_regime', null)],
    });
    const metric = toDashboardMetric(a, 'Market composite');
    expect(metric.n).toBe(2);
  });

  it('carries the calculationId, display and eligibility straight from the artifact', () => {
    const metric = toDashboardMetric(artifact(), 'Price regime');
    expect(metric.calculationId).toBe('calc-1');
    expect(metric.display).toBe('0.500000');
    expect(metric.eligibility).toBe('ok');
    expect(metric.stale).toBe(false);
  });

  it('carries the abstention reason as the metric reason, and a null display, when abstained', () => {
    const a = artifact({
      eligibility: 'insufficient_data',
      result: null,
      abstention: { reason: 'below_sample_threshold', message: 'not enough data' },
    });
    const metric = toDashboardMetric(a, 'Price regime');
    expect(metric.display).toBeNull();
    expect(metric.reason).toBe('not enough data');
  });

  it('marks stale when the artifact eligibility is stale', () => {
    const metric = toDashboardMetric(artifact({ eligibility: 'stale' }), 'Price regime');
    expect(metric.stale).toBe(true);
  });
});

describe('freshestObservedAt — freshness thresholds', () => {
  it('is null when no input carries an observedAt', () => {
    expect(freshestObservedAt(artifact({ inputs: [input('a', null)] }))).toBeNull();
  });

  it('picks the latest observedAt among several inputs', () => {
    const a = artifact({
      inputs: [input('a', '2026-08-01T00:00:00.000Z'), input('b', '2026-08-15T00:00:00.000Z'), input('c', '2026-08-10T00:00:00.000Z')],
    });
    expect(freshestObservedAt(a)).toBe('2026-08-15T00:00:00.000Z');
  });
});

describe('pageState', () => {
  const ok = { eligibility: 'ok' as const };
  const insufficient = { eligibility: 'insufficient_data' as const };
  const stale = { eligibility: 'stale' as const };

  it('is empty when nothing has ever been computed, regardless of anything else', () => {
    expect(pageState({ hasEverComputed: false, degradedProviders: ['market'], metrics: [ok] })).toBe('empty');
  });

  it('is degraded when a provider is down, even if every metric is ok', () => {
    expect(pageState({ hasEverComputed: true, degradedProviders: ['market'], metrics: [ok] })).toBe('degraded');
  });

  it('is stale when any metric is stale and nothing is degraded', () => {
    expect(pageState({ hasEverComputed: true, degradedProviders: [], metrics: [ok, stale] })).toBe('stale');
  });

  it('is insufficient when a metric abstained and nothing is stale or degraded', () => {
    expect(pageState({ hasEverComputed: true, degradedProviders: [], metrics: [ok, insufficient] })).toBe('insufficient');
  });

  it('is fresh only when every metric is ok and nothing is degraded', () => {
    expect(pageState({ hasEverComputed: true, degradedProviders: [], metrics: [ok, ok] })).toBe('fresh');
  });
});

function contributionStep(componentKey: string, overrides: Partial<CalculationStepRecord> = {}): CalculationStepRecord {
  return {
    index: 0,
    key: `contribution_${componentKey}`,
    parentKey: null,
    label: `Contribution of ${componentKey}`,
    expression: `{${componentKey}} * ({official_weight} / {participating_weight_sum})`,
    substituted: '',
    exactValue: '0',
    displayValue: '0.000000',
    unit: 'composite_unit',
    roundingRule: 'ratio_6dp_half_even',
    status: 'applied',
    operands: { official_weight: '0.35', participating_weight_sum: '0.65' },
    notes: [],
    ...overrides,
  };
}

describe('renormalizedComponentWeight — F07 review finding 2 (round 1) / round-2 verification finding 2', () => {
  // Round 2 of lane-review found this function had zero direct test coverage — mutating its
  // step-key lookup left every other test in this suite green. These pin the function itself,
  // not just the UI that happens to call it.

  it('divides official_weight by participating_weight_sum, matching calc/methods/market-composite.ts §4.5', () => {
    // Two of four components participate: official weights 0.35 (news) and 0.30 (price) sum to
    // 0.65 — renormalized: 0.35/0.65 = 0.538462, matching the card's own doc-comment example.
    const a = artifact({
      methodId: 'market.composite',
      steps: [contributionStep('news_sentiment', { operands: { official_weight: '0.35', participating_weight_sum: '0.65' } })],
    });
    expect(renormalizedComponentWeight(a, 'news_sentiment')).toBe('0.538462');
  });

  it('returns null for a component with no contribution step — it did not participate', () => {
    const a = artifact({ methodId: 'market.composite', steps: [contributionStep('news_sentiment')] });
    expect(renormalizedComponentWeight(a, 'sampled_retail_stance')).toBeNull();
  });

  it('returns null if participating_weight_sum is zero rather than dividing by it', () => {
    const a = artifact({
      methodId: 'market.composite',
      steps: [contributionStep('news_sentiment', { operands: { official_weight: '0.35', participating_weight_sum: '0' } })],
    });
    expect(renormalizedComponentWeight(a, 'news_sentiment')).toBeNull();
  });

  it('returns null if the step is missing either operand', () => {
    const a = artifact({
      methodId: 'market.composite',
      steps: [contributionStep('news_sentiment', { operands: { official_weight: '0.35' } })],
    });
    expect(renormalizedComponentWeight(a, 'news_sentiment')).toBeNull();
  });

  it('reads the step keyed to the requested component, not merely the first step present', () => {
    // Reproduces round 2's own mutation probe: a step-key lookup drifting out of sync with
    // `calc/methods/market-composite.ts`'s real `contribution_<key>` naming must be caught here.
    const a = artifact({
      methodId: 'market.composite',
      steps: [
        contributionStep('news_sentiment', { operands: { official_weight: '0.35', participating_weight_sum: '0.65' } }),
        contributionStep('price_regime', { operands: { official_weight: '0.30', participating_weight_sum: '0.65' } }),
      ],
    });
    expect(renormalizedComponentWeight(a, 'news_sentiment')).toBe('0.538462');
    expect(renormalizedComponentWeight(a, 'price_regime')).toBe('0.461538');
  });
});
