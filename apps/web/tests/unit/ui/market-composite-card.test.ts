import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarketCompositeCard } from '../../../src/ui/dashboard/MarketCompositeCard';
import type { CompositeComponentView, DashboardMetricView, MarketCompositeCardView } from '../../../src/ui/dashboard/types';

function metric(overrides: Partial<DashboardMetricView> = {}): DashboardMetricView {
  return {
    calculationId: 'calc-1',
    metricId: 'news.sentiment',
    label: 'News sentiment',
    display: '0.200000',
    unit: 'sentiment_unit',
    roundingRule: 'ratio_6dp_half_even',
    eligibility: 'ok',
    reason: null,
    asOf: new Date('2026-08-30T12:00:00.000Z'),
    source: 'marketaux',
    n: 5,
    window: 'articles retrieved this refresh',
    observedAt: new Date('2026-08-30T11:00:00.000Z'),
    stale: false,
    ...overrides,
  };
}

function component(
  key: CompositeComponentView['key'],
  participated: boolean,
  overrides: Partial<CompositeComponentView> = {},
): CompositeComponentView {
  return {
    key,
    label: key,
    officialWeight: '0.25',
    renormalizedWeight: participated ? '0.25' : null,
    participated,
    metric: participated ? metric({ metricId: key }) : null,
    ...overrides,
  };
}

function render(view: MarketCompositeCardView): string {
  return renderToStaticMarkup(createElement(MarketCompositeCard, { view }));
}

describe('MarketCompositeCard — component-breakdown rendering (F07 §5)', () => {
  it('four participating components: every row is marked participated, none omitted', () => {
    const html = render({
      composite: metric({ metricId: 'market.composite' }),
      components: [
        component('news_sentiment', true),
        component('price_regime', true),
        component('sector_breadth_score', true),
        component('sampled_retail_stance', true),
      ],
    });
    expect(html).toContain('data-component-count="4"');
    expect(html.match(/data-participated="true"/g)).toHaveLength(4);
    expect(html).not.toContain('data-participated="false"');
    expect(html).not.toContain('omitted this cycle');
  });

  it('three participating components: the fourth renders visibly omitted, not hidden', () => {
    const html = render({
      composite: metric({ metricId: 'market.composite' }),
      components: [
        component('news_sentiment', true),
        component('price_regime', true),
        component('sector_breadth_score', true),
        component('sampled_retail_stance', false),
      ],
    });
    expect(html).toContain('data-component-count="3"');
    expect(html.match(/data-participated="true"/g)).toHaveLength(3);
    expect(html).toContain('data-participated="false"');
    expect(html).toContain('omitted this cycle');
  });

  it('two participating components: a visibly different breakdown from either case above', () => {
    const html = render({
      composite: metric({ metricId: 'market.composite' }),
      components: [
        component('news_sentiment', true),
        component('price_regime', true),
        component('sector_breadth_score', false),
        component('sampled_retail_stance', false),
      ],
    });
    expect(html).toContain('data-component-count="2"');
    expect(html.match(/data-participated="true"/g)).toHaveLength(2);
    expect(html.match(/data-participated="false"/g)).toHaveLength(2);
  });

  it('renders all four rows regardless of how many participated — never hides an omitted one', () => {
    const html = render({
      composite: metric({ metricId: 'market.composite' }),
      components: [
        component('news_sentiment', true),
        component('price_regime', false),
        component('sector_breadth_score', false),
        component('sampled_retail_stance', false),
      ],
    });
    expect(html.match(/data-composite-component="/g)).toHaveLength(4);
  });

  it('an absent composite renders an explicit empty note, not a crash', () => {
    const html = render({ composite: null, components: [component('news_sentiment', true)] });
    expect(html).toContain('data-market-composite-empty');
  });

  it('F07 §4.2 review finding 2: displays the renormalized weight, not the official one, when components are omitted', () => {
    // Official weights 0.35 (news) and 0.30 (price) sum to 0.65 when only these two participate
    // — renormalized: 0.35/0.65 = 0.538462, 0.30/0.65 = 0.461538.
    const html = render({
      composite: metric({ metricId: 'market.composite' }),
      components: [
        component('news_sentiment', true, { officialWeight: '0.35', renormalizedWeight: '0.538462' }),
        component('price_regime', true, { officialWeight: '0.30', renormalizedWeight: '0.461538' }),
        component('sector_breadth_score', false, { officialWeight: '0.25', renormalizedWeight: null }),
        component('sampled_retail_stance', false, { officialWeight: '0.10', renormalizedWeight: null }),
      ],
    });

    // The renormalized weight is what's displayed for a participating component — not merely
    // present somewhere, but rendered as the applied figure a reader sees without opening the
    // Inspector. A card that reverted to showing only `officialWeight` (0.35, 0.30) here would
    // fail this assertion.
    expect(html).toContain('0.538462');
    expect(html).toContain('0.461538');
    // The official weight is still shown too, clearly labeled, alongside the applied one.
    expect(html).toContain('official');
    expect(html).toContain('0.35');
    expect(html).toContain('0.30');
  });

  it('round-2 review finding 1: a component that loaded but abstained never shows its official weight as "applied"', () => {
    // The bug this reproduces: `component.metric === null` was the branch condition, but an
    // abstained artifact (eligibility !== 'ok') still has a non-null `metric` — only
    // `participated` is false. Such a component previously fell into the "applied" branch,
    // where the absent `renormalizedWeight` (no `contribution_<key>` step exists for a
    // non-participating component) fell back to `officialWeight`, displaying it as though it
    // had actually been applied this cycle.
    const html = render({
      composite: metric({ metricId: 'market.composite' }),
      components: [
        component('news_sentiment', true, { officialWeight: '0.538462', renormalizedWeight: '0.538462' }),
        {
          key: 'price_regime',
          label: 'price_regime',
          officialWeight: '0.30',
          renormalizedWeight: null,
          participated: false,
          metric: metric({ metricId: 'price_regime', eligibility: 'not_applicable', display: null }),
        },
        component('sector_breadth_score', false),
        component('sampled_retail_stance', false),
      ],
    });

    expect(html).toContain('data-participated="false"');
    // The abstained component must render the omitted message, never "Applied weight this
    // cycle: 0.30" — its official weight was never applied, and "unavailable" (never a silent
    // substitution of the official weight) is the honest state for the rare case of a
    // participating component missing its renormalized weight.
    expect(html).not.toMatch(/Applied weight this cycle: 0\.30\b/);
    expect(html).toContain('omitted this cycle');
  });
});
