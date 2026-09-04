import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AggregateMetric } from '../../../src/ui/dashboard/AggregateMetric';
import type { DashboardMetricView } from '../../../src/ui/dashboard/types';

/**
 * F07 review finding 4. Product invariant §6.1 — "every aggregate on this page renders: source
 * name, `n`, observation window, and `observed_at` freshness" — was, before this file, checked
 * only in `tests/e2e/dashboard.spec.ts`, which does not currently run in CI (both its state
 * suites are `test.skip`-gated on `DATABASE_URL`, absent from `.github/workflows/ci.yml`'s
 * "End-to-end tests" step — see that file's own top-of-file comment). `metrics.test.ts` covers
 * the *projection* onto `DashboardMetric` but never renders a component, so deleting
 * `AggregateMetric`'s `CoverageLabel`/`FreshnessBadge` composition left every gate that actually
 * runs in CI green. This is a true component-render test, not a second projection test.
 */
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

function render(view: DashboardMetricView): string {
  return renderToStaticMarkup(createElement(AggregateMetric, { metric: view }));
}

describe('AggregateMetric — F07 §4.4/§6.1 labelling invariant', () => {
  it('renders the coverage label with real source, n and window values', () => {
    const html = render(metric());

    expect(html).toContain('data-coverage-label');
    expect(html).toContain('data-coverage-source');
    expect(html).toContain('marketaux');
    expect(html).toContain('data-coverage-n');
    expect(html).toContain('n=5');
    expect(html).toContain('data-coverage-window');
    expect(html).toContain('articles retrieved this refresh');
  });

  it('renders the freshness badge with the real observedAt value', () => {
    const html = render(metric());

    expect(html).toContain('data-freshness="fresh"');
    expect(html).toContain('2026-08-30T11:00:00.000Z');
  });

  it('renders the stale freshness marker, not the fresh one, when the metric is stale', () => {
    const html = render(metric({ stale: true }));

    expect(html).toContain('data-freshness="stale"');
    expect(html).toContain('refresh failed');
  });

  it('renders the InspectableMetric value alongside the coverage label and freshness badge, not instead of them', () => {
    const html = render(metric());

    expect(html).toContain('data-inspectable-metric');
    expect(html).toContain('data-coverage-label');
    expect(html).toContain('data-freshness');
  });
});
