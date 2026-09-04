import { describe, expect, it } from 'vitest';
import type { DailyBar } from '../../../../src/adapters/market';
import type { MarketauxArticle } from '../../../../src/adapters/marketaux';
import {
  marketCompositeInputs,
  newsSentimentInputs,
  officialAssumptions,
  priceRegimeInputs,
  sectorBreadthInputs,
} from '../../../../src/services/dashboard/inputs';

function bar(date: string, close: number): DailyBar {
  return { date, open: close, high: close, low: close, close, volume: 1 };
}

describe('priceRegimeInputs', () => {
  it('orders closes chronologically regardless of the (newest-first) input order', () => {
    const bars = [bar('2026-08-28', 3), bar('2026-08-27', 2), bar('2026-08-26', 1)];
    const inputs = priceRegimeInputs('AAPL', bars);
    expect(inputs.find((i) => i.key === 'close_0')?.value).toBe('1');
    expect(inputs.find((i) => i.key === 'close_1')?.value).toBe('2');
    expect(inputs.find((i) => i.key === 'close_2')?.value).toBe('3');
  });

  it('declares quote_kind honestly as unadjusted, never as adjusted_close', () => {
    const inputs = priceRegimeInputs('AAPL', [bar('2026-08-28', 1)]);
    const quoteKind = inputs.find((i) => i.key === 'quote_kind');
    expect(quoteKind?.value).not.toBe('adjusted_close');
    expect(quoteKind?.dataType).toBe('identity');
  });

  it('declares zero close_* inputs for an empty bar list', () => {
    const inputs = priceRegimeInputs('AAPL', []);
    expect(inputs.filter((i) => i.key.startsWith('close_'))).toHaveLength(0);
    expect(inputs).toHaveLength(1); // just quote_kind
  });
});

describe('newsSentimentInputs', () => {
  function article(symbol: string, sentimentScore: number | null): MarketauxArticle {
    return {
      uuid: `u-${symbol}-${String(sentimentScore)}`,
      title: 't',
      url: 'https://example.test',
      publishedAt: '2026-08-28T00:00:00.000Z',
      entities: [{ symbol, name: 'n', sentimentScore }],
    };
  }

  const now = new Date('2026-08-30T00:00:00.000Z');

  it('only counts entities matching the requested symbol', () => {
    const inputs = newsSentimentInputs('AAPL', [article('AAPL', 0.5), article('MSFT', 0.9)], now);
    expect(inputs.filter((i) => i.key.startsWith('entity_sentiment_'))).toHaveLength(1);
  });

  it('excludes an entity with a null sentiment score — Marketaux does not score every entity', () => {
    const inputs = newsSentimentInputs('AAPL', [article('AAPL', null), article('AAPL', 0.4)], now);
    expect(inputs.filter((i) => i.key.startsWith('entity_sentiment_'))).toHaveLength(1);
    expect(inputs.find((i) => i.key === 'entity_sentiment_0')?.value).toBe('0.4');
  });

  it('declares one relevance and one age_hours input per tagged article', () => {
    const inputs = newsSentimentInputs('AAPL', [article('AAPL', 0.4)], now);
    expect(inputs.find((i) => i.key === 'relevance_0')).toBeDefined();
    expect(inputs.find((i) => i.key === 'age_hours_0')).toBeDefined();
  });

  it('F07 review finding 5: relevance and age_hours get their own provenance, not the real article\'s Marketaux one', () => {
    const inputs = newsSentimentInputs('AAPL', [article('AAPL', 0.4)], now);
    const sentiment = inputs.find((i) => i.key === 'entity_sentiment_0');
    const relevance = inputs.find((i) => i.key === 'relevance_0');
    const ageHoursInput = inputs.find((i) => i.key === 'age_hours_0');

    // The real, provider-sourced field keeps its honest Marketaux attribution.
    expect(sentiment?.source).toBe('marketaux');
    expect(sentiment?.provenance.provider).toBe('marketaux');
    expect(sentiment?.provenance.providerField).toBe('entities[].sentiment_score');

    // Neither synthesized value borrows that attribution — this is the bug: both used to share
    // `sentiment`'s exact provenance object, including a `providerField` and `sourceUrl` that
    // field never supplied for these values.
    for (const synthesized of [relevance, ageHoursInput]) {
      expect(synthesized?.source).toBe('internal');
      expect(synthesized?.provenance.provider).toBe('internal');
      expect(synthesized?.provenance.providerField).not.toBe('entities[].sentiment_score');
      expect(synthesized?.provenance.sourceUrl).toBeNull();
    }
    expect(relevance?.provenance.providerField).toBe('derived:relevance_placeholder');
    expect(ageHoursInput?.provenance.providerField).toBe('derived:age_hours_from_published_at');

    // Neither is stamped `quality: 'ok'` as though it came verified from the provider the way
    // `entity_sentiment_0` genuinely does.
    expect(relevance?.quality).not.toBe('ok');
    expect(ageHoursInput?.quality).not.toBe('ok');
  });
});

describe('sectorBreadthInputs', () => {
  it('counts only ok-eligibility regimes as having data', () => {
    const inputs = sectorBreadthInputs([
      { eligibility: 'ok', exact: '0.5' },
      { eligibility: 'insufficient_data', exact: null },
      { eligibility: 'ok', exact: '-0.1' },
    ]);
    expect(inputs.find((i) => i.key === 'sector_etfs_with_data')?.value).toBe('2');
  });

  it('counts positive as exact >= 0.35 among the ones with data', () => {
    const inputs = sectorBreadthInputs([
      { eligibility: 'ok', exact: '0.5' },
      { eligibility: 'ok', exact: '0.1' },
      { eligibility: 'ok', exact: '0.35' },
    ]);
    expect(inputs.find((i) => i.key === 'positive_sector_etfs')?.value).toBe('2');
  });

  it('reports zero-and-zero for an empty list, not a divide-by-zero input', () => {
    const inputs = sectorBreadthInputs([]);
    expect(inputs.find((i) => i.key === 'sector_etfs_with_data')?.value).toBe('0');
    expect(inputs.find((i) => i.key === 'positive_sector_etfs')?.value).toBe('0');
  });

  it('F07 review finding 7 (round 2): the 0.35 boundary is an exact decimal comparison, not a float one', () => {
    // `0.34999999999999999` is mathematically less than 0.35 — a correct decimal comparison
    // must exclude it. But `Number('0.34999999999999999')` rounds, via IEEE-754 double
    // precision, to the exact same bit pattern as `Number('0.35')` (both are the double
    // 0.34999999999999997779...), so `Number('0.34999999999999999') >= Number('0.35')` is
    // `true` in plain JS — a false positive a float comparison cannot avoid. This is the
    // boundary value round 2 of lane-review asked for: the round-1 test used `'0.35'` compared
    // against itself, which cannot discriminate `Number()` from `Dec` because there is nothing
    // for the two representations to disagree about at that exact point.
    const inputs = sectorBreadthInputs([{ eligibility: 'ok', exact: '0.34999999999999999' }]);
    expect(inputs.find((i) => i.key === 'positive_sector_etfs')?.value).toBe('0');
  });
});

describe('marketCompositeInputs', () => {
  it('declares exactly one input per participating component, keyed by component key', () => {
    const inputs = marketCompositeInputs([
      { key: 'news_sentiment', exact: '0.2' },
      { key: 'price_regime', exact: '0.5' },
    ]);
    expect(inputs).toHaveLength(2);
    expect(inputs.find((i) => i.key === 'news_sentiment')?.value).toBe('0.2');
  });

  it('declares nothing for an empty participant list', () => {
    expect(marketCompositeInputs([])).toHaveLength(0);
  });
});

describe('officialAssumptions', () => {
  it('resolves news.sentiment.min_articles from the registry, source official_default', () => {
    const assumptions = officialAssumptions('news.sentiment');
    const minArticles = assumptions.find((a) => a.key === 'min_articles');
    expect(minArticles?.value).toBe('3');
    expect(minArticles?.source).toBe('official_default');
  });

  it('returns an empty array for a method with no official assumptions', () => {
    expect(officialAssumptions('price.regime')).toHaveLength(0);
  });
});
