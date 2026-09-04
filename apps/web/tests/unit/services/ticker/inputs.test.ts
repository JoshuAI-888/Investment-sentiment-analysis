import { describe, expect, it } from 'vitest';
import type { AttentionSnapshot, MarketSnapshot } from '../../../../src/contracts/security';
import type { EvidenceItem } from '../../../../src/contracts/evidence';
import {
  attentionInputs,
  newsInputsFromEvidence,
  officialAssumptions,
  priceSeriesInputs,
  stanceInputsFromEvidence,
} from '../../../../src/services/ticker/inputs';

function attentionRow(overrides: Partial<AttentionSnapshot> = {}): AttentionSnapshot {
  return {
    securityId: '00000000-0000-4000-8000-000000000001',
    source: 'reddit',
    rank: 12,
    rankPrior: 20,
    mentions: 100,
    mentionsPrior: 80,
    engagement: 500,
    windowHours: 24,
    coverageClass: 'pov_index',
    providerMethodologyVersion: 'v1',
    observedAt: new Date('2026-09-01T00:00:00.000Z'),
    ingestedAt: new Date('2026-09-01T00:05:00.000Z'),
    rawHash: 'h1',
    ...overrides,
  };
}

function evidenceRow(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id: '00000000-0000-4000-8000-000000000002',
    securityId: '00000000-0000-4000-8000-000000000001',
    evidenceType: 'social_result',
    provider: 'reddit',
    title: 'a post',
    snippet: 'a snippet',
    sourceUrl: 'https://reddit.example/x',
    publisher: null,
    authorRef: null,
    stanceLabel: 'bullish',
    stanceScore: '0.8',
    relevanceScore: '0.9',
    publishedAt: new Date('2026-09-01T00:00:00.000Z'),
    availableAt: new Date('2026-09-01T00:00:00.000Z'),
    ingestedAt: new Date('2026-09-01T00:05:00.000Z'),
    lastCheckedAt: null,
    availability: 'available',
    licenseClass: 'own_collected',
    coverageClass: 'licensed_sample',
    rawHash: 'h2',
    metadata: {},
    ...overrides,
  };
}

function marketRow(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    securityId: '00000000-0000-4000-8000-000000000001',
    price: '10.00',
    changePercent: '1.00',
    session: 'eod',
    provider: 'fmp',
    observedAt: new Date('2026-09-01T00:00:00.000Z'),
    ingestedAt: new Date('2026-09-01T00:05:00.000Z'),
    rawHash: 'h3',
    ...overrides,
  };
}

describe('attentionInputs', () => {
  it('declares rank/mentions now-and-prior from one row', () => {
    const inputs = attentionInputs(attentionRow(), null);
    expect(inputs.find((i) => i.key === 'rank_now')?.value).toBe('12');
    expect(inputs.find((i) => i.key === 'rank_prior')?.value).toBe('20');
    expect(inputs.find((i) => i.key === 'mentions_now')?.value).toBe('100');
    expect(inputs.find((i) => i.key === 'mentions_prior')?.value).toBe('80');
  });

  it('declares a null rank/rankPrior as "0" (absent from board), the same sentinel attention.rank_change@1.1.0 expects', () => {
    const inputs = attentionInputs(attentionRow({ rank: null, rankPrior: null }), null);
    expect(inputs.find((i) => i.key === 'rank_now')?.value).toBe('0');
    expect(inputs.find((i) => i.key === 'rank_prior')?.value).toBe('0');
  });

  it('uses the current row methodology for both sides when there is no prior row', () => {
    const inputs = attentionInputs(attentionRow({ providerMethodologyVersion: 'v2' }), null);
    expect(inputs.find((i) => i.key === 'methodology_version_now')?.value).toBe('v2');
    expect(inputs.find((i) => i.key === 'methodology_version_prior')?.value).toBe('v2');
  });

  it('uses the prior row own methodology version when a genuine prior observation exists', () => {
    const prior = attentionRow({ providerMethodologyVersion: 'v1' });
    const latest = attentionRow({ providerMethodologyVersion: 'v2' });
    const inputs = attentionInputs(latest, prior);
    expect(inputs.find((i) => i.key === 'methodology_version_now')?.value).toBe('v2');
    expect(inputs.find((i) => i.key === 'methodology_version_prior')?.value).toBe('v1');
  });
});

describe('stanceInputsFromEvidence', () => {
  const asOf = new Date('2026-09-02T00:00:00.000Z');

  it('excludes an item that was never classified (null stanceLabel) from n', () => {
    const items = [evidenceRow(), evidenceRow({ id: 'x', stanceLabel: null, stanceScore: null })];
    const inputs = stanceInputsFromEvidence(items, asOf);
    expect(inputs.filter((i) => i.key.startsWith('signed_'))).toHaveLength(1);
  });

  it('maps bullish to signed=1, bearish to signed=-1, neutral to signed=0', () => {
    const items = [
      evidenceRow({ stanceLabel: 'bullish' }),
      evidenceRow({ stanceLabel: 'bearish' }),
      evidenceRow({ stanceLabel: 'neutral' }),
    ];
    const inputs = stanceInputsFromEvidence(items, asOf);
    expect(inputs.find((i) => i.key === 'signed_0')?.value).toBe('1');
    expect(inputs.find((i) => i.key === 'signed_1')?.value).toBe('-1');
    expect(inputs.find((i) => i.key === 'signed_2')?.value).toBe('0');
  });

  it('reads stanceScore as classifier confidence and relevanceScore as relevance', () => {
    const inputs = stanceInputsFromEvidence([evidenceRow({ stanceScore: '0.42', relevanceScore: '0.77' })], asOf);
    expect(inputs.find((i) => i.key === 'confidence_0')?.value).toBe('0.42');
    expect(inputs.find((i) => i.key === 'relevance_0')?.value).toBe('0.77');
  });

  it('computes a non-negative age in hours from availableAt', () => {
    const inputs = stanceInputsFromEvidence(
      [evidenceRow({ availableAt: new Date('2026-09-01T00:00:00.000Z') })],
      asOf,
    );
    const ageHours = Number(inputs.find((i) => i.key === 'age_hours_0')?.value);
    expect(ageHours).toBeCloseTo(24, 5);
  });

  it('declares zero inputs for an empty item list', () => {
    expect(stanceInputsFromEvidence([], asOf)).toHaveLength(0);
  });
});

describe('newsInputsFromEvidence', () => {
  const asOf = new Date('2026-09-02T00:00:00.000Z');

  it('derives entity_sentiment as sign(stanceLabel) * stanceScore', () => {
    const inputs = newsInputsFromEvidence([evidenceRow({ stanceLabel: 'bearish', stanceScore: '0.6' })], asOf);
    expect(inputs.find((i) => i.key === 'entity_sentiment_0')?.value).toBe('-0.6');
  });

  it('excludes an unclassified article from n', () => {
    const items = [evidenceRow(), evidenceRow({ id: 'y', relevanceScore: null })];
    const inputs = newsInputsFromEvidence(items, asOf);
    expect(inputs.filter((i) => i.key.startsWith('entity_sentiment_'))).toHaveLength(1);
  });
});

describe('priceSeriesInputs', () => {
  it('orders closes chronologically and keeps exactly the requested window (most-recent-first repo order in)', () => {
    // Repository order is most-recent-first: index 0 is the newest bar.
    const bars = [
      marketRow({ price: '3', observedAt: new Date('2026-09-03T00:00:00.000Z') }),
      marketRow({ price: '2', observedAt: new Date('2026-09-02T00:00:00.000Z') }),
      marketRow({ price: '1', observedAt: new Date('2026-09-01T00:00:00.000Z') }),
    ];
    const inputs = priceSeriesInputs(bars, 3);
    expect(inputs.find((i) => i.key === 'close_0')?.value).toBe('1');
    expect(inputs.find((i) => i.key === 'close_1')?.value).toBe('2');
    expect(inputs.find((i) => i.key === 'close_2')?.value).toBe('3');
  });

  it('declares quote_kind honestly as unadjusted, never as adjusted_close', () => {
    const inputs = priceSeriesInputs([marketRow()], 1);
    const quoteKind = inputs.find((i) => i.key === 'quote_kind');
    expect(quoteKind?.value).toBe('close_unadjusted');
    expect(quoteKind?.dataType).toBe('identity');
  });

  it('declares fewer than window closes when fewer bars exist, never fabricating one', () => {
    const inputs = priceSeriesInputs([marketRow()], 21);
    expect(inputs.filter((i) => i.key.startsWith('close_'))).toHaveLength(1);
  });
});

describe('officialAssumptions', () => {
  it('resolves attention.mention_delta to no assumptions', () => {
    expect(officialAssumptions('attention.mention_delta')).toHaveLength(0);
  });

  it('resolves social.stance_reddit to min_items and display_floor', () => {
    const assumptions = officialAssumptions('social.stance_reddit');
    expect(assumptions.map((a) => a.key).sort()).toEqual(['display_floor', 'min_items']);
    expect(assumptions.find((a) => a.key === 'min_items')?.value).toBe('5');
  });
});
