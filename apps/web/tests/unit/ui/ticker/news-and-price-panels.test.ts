import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NewsAxisPanel } from '../../../../src/ui/ticker/NewsAxisPanel';
import { PriceAxisPanel } from '../../../../src/ui/ticker/PriceAxisPanel';
import type { AxisMetricView, PriceAxisView } from '../../../../src/ui/ticker/types';

function abstainedMetric(overrides: Partial<AxisMetricView> = {}): AxisMetricView {
  return {
    calculationId: 'calc-1',
    metricId: 'news.sentiment',
    label: 'News sentiment (entity-tagged)',
    display: null,
    unit: 'sentiment_unit',
    roundingRule: 'ratio_6dp_half_even',
    eligibility: 'insufficient_data',
    reason: '2 entity-tagged article(s) were found. At least 3 are required.',
    asOf: new Date('2026-09-01T00:00:00.000Z'),
    source: 'news',
    n: 2,
    window: 'articles retrieved this render',
    observedAt: null,
    stale: false,
    ...overrides,
  };
}

describe('NewsAxisPanel — F09 DoD: n<3 renders insufficient_data, never a number', () => {
  it('renders "No value" rather than a zero or a dash below the n=3 floor', () => {
    const html = renderToStaticMarkup(
      createElement(NewsAxisPanel, { news: { metric: abstainedMetric(), articleCount: 2, window: 'w' } }),
    );
    expect(html).toContain('data-abstained');
    expect(html).toContain('No value —');
    expect(html).not.toContain('>0<');
  });

  it('renders a real value at or above the floor', () => {
    const html = renderToStaticMarkup(
      createElement(NewsAxisPanel, {
        news: { metric: abstainedMetric({ display: '0.150000', eligibility: 'ok', reason: null, n: 4 }), articleCount: 4, window: 'w' },
      }),
    );
    expect(html).toContain('0.150000');
  });
});

function priceAxis(overrides: Partial<PriceAxisView> = {}): PriceAxisView {
  return {
    returns: [],
    horizonDisclosure: 'the horizons below are 7/30/90/180 calendar days, not the originally specified 5d/20d trading-day windows',
    volatility20: null,
    regime: null,
    rsi14: null,
    movingAverage20: null,
    movingAverage50: null,
    ...overrides,
  };
}

describe('PriceAxisPanel — the 5d/20d vs 7/30-calendar-day disclosure', () => {
  it('renders the horizon mismatch disclosure on every render', () => {
    const html = renderToStaticMarkup(createElement(PriceAxisPanel, { price: priceAxis() }));
    expect(html).toContain('data-horizon-disclosure');
    expect(html).toContain('7/30/90/180 calendar days');
  });

  it('renders the actual stored horizon, not a relabelled 5d/20d one', () => {
    const html = renderToStaticMarkup(
      createElement(PriceAxisPanel, {
        price: priceAxis({
          returns: [{ horizonCalendarDays: 7, totalReturn: '0.05', asOfDate: '2026-09-01', baselinePriceDate: '2026-08-25', qualityStatus: 'ok' }],
        }),
      }),
    );
    expect(html).toContain('7-day return');
    expect(html).not.toContain('5-day return');
  });

  /**
   * Round-2 lane-review finding 4: this marker had no test — deleting it left the suite green.
   * `totalReturn` is this deployment's own computed figure with no registered analytics method
   * backing it yet (see the module's own doc comment), so it must never be presented as if it
   * had the same Inspector-backed provenance as a genuine `InspectableMetric`.
   */
  it('discloses that a real return has no Inspector link, since no registered method backs it', () => {
    const html = renderToStaticMarkup(
      createElement(PriceAxisPanel, {
        price: priceAxis({
          returns: [{ horizonCalendarDays: 7, totalReturn: '0.05', asOfDate: '2026-09-01', baselinePriceDate: '2026-08-25', qualityStatus: 'ok' }],
        }),
      }),
    );
    expect(html).toContain('data-return-uninspectable');
  });

  it('does not render the uninspectable marker for an insufficient_data return (nothing to disclose)', () => {
    const html = renderToStaticMarkup(
      createElement(PriceAxisPanel, {
        price: priceAxis({
          returns: [{ horizonCalendarDays: 7, totalReturn: null, asOfDate: '2026-09-01', baselinePriceDate: '2026-08-25', qualityStatus: 'insufficient_data' }],
        }),
      }),
    );
    expect(html).not.toContain('data-return-uninspectable');
  });

  it('renders not_applicable honestly (unadjusted-close gate) rather than a computed number', () => {
    const notApplicable: AxisMetricView = {
      calculationId: 'calc-2',
      metricId: 'price.regime',
      label: 'Price regime (trend strength)',
      display: null,
      unit: 'trend_unit',
      roundingRule: 'ratio_6dp_half_even',
      eligibility: 'not_applicable',
      reason: "The price series is tagged 'close_unadjusted', not 'adjusted_close'.",
      asOf: new Date('2026-09-01T00:00:00.000Z'),
      source: 'market',
      n: 60,
      window: '21 sessions',
      observedAt: null,
      stale: false,
    };
    const html = renderToStaticMarkup(createElement(PriceAxisPanel, { price: priceAxis({ regime: notApplicable }) }));
    expect(html).toContain('data-eligibility="not_applicable"');
    expect(html).toContain('close_unadjusted');
  });
});
