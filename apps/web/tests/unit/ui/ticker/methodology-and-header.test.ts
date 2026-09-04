import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MethodologyPanel } from '../../../../src/ui/ticker/MethodologyPanel';
import { TickerHeaderCard } from '../../../../src/ui/ticker/TickerHeaderCard';
import { TickerRefused } from '../../../../src/ui/ticker/TickerRefused';
import type { MethodologyEntryView, TickerHeaderView } from '../../../../src/ui/ticker/types';

describe('MethodologyPanel — F09 §4.4', () => {
  it('reproduces the registry limitations verbatim, with a link to the Inspector', () => {
    const entry: MethodologyEntryView = {
      axis: 'stance_reddit',
      methodId: 'social.stance_reddit',
      methodVersion: '1.0.0',
      title: 'Stance of sampled snippets (Reddit)',
      source: 'Reddit',
      window: 'evidence retrieved this render',
      thresholds: [{ key: 'min_items', value: '5', unit: '' }],
      limitations: ['Computed over snippets selected by a relevance-ranked web search restricted to reddit.com.'],
      inspectorHref: '/calculations/calc-1',
    };
    const html = renderToStaticMarkup(createElement(MethodologyPanel, { entries: [entry] }));
    expect(html).toContain('data-methodology-limitations');
    expect(html).toContain('reddit.com');
    expect(html).toContain('min_items=5');
    expect(html).toContain('/calculations/calc-1');
  });

  it('renders an honest empty state before anything has been computed', () => {
    const html = renderToStaticMarkup(createElement(MethodologyPanel, { entries: [] }));
    expect(html).toContain('Nothing has been computed');
  });
});

describe('TickerHeaderCard', () => {
  function header(overrides: Partial<TickerHeaderView> = {}): TickerHeaderView {
    return {
      securityId: 's1',
      symbol: 'GME',
      name: 'GameStop',
      exchange: 'NYSE',
      assetType: 'equity',
      sector: 'Consumer',
      price: '24.50',
      changePercent: '1.25',
      session: 'eod',
      provider: 'fmp',
      observedAt: new Date('2026-09-01T00:00:00.000Z'),
      filingsHref: null,
      insiderTransactionsHref: null,
      ...overrides,
    };
  }

  it('renders the price and identity as raw facts', () => {
    const html = renderToStaticMarkup(createElement(TickerHeaderCard, { header: header() }));
    expect(html).toContain('GME');
    expect(html).toContain('$24.50');
    expect(html).toContain('1.25%');
  });

  it('renders an honest "no price on record" rather than a fabricated 0', () => {
    const html = renderToStaticMarkup(createElement(TickerHeaderCard, { header: header({ price: null, changePercent: null }) }));
    expect(html).toContain('No price on record');
  });

  it('never claims real-time or delayed status the schema cannot support', () => {
    const html = renderToStaticMarkup(createElement(TickerHeaderCard, { header: header() }));
    expect(html.toLowerCase()).not.toContain('real-time:');
    expect(html).toContain('does not record real-time-vs-delayed status');
  });

  /**
   * Round-4 lane-review finding 4: F09 §2 lists "insider and filings links (cut-line items 3 and
   * 2)" as In scope; this branch neither rendered nor disclosed them until now.
   */
  it('renders SEC filings and insider-transaction links when a CIK is on record', () => {
    const html = renderToStaticMarkup(
      createElement(TickerHeaderCard, {
        header: header({
          filingsHref: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193&type=&dateb=&owner=include&count=40',
          insiderTransactionsHref: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193&type=4&dateb=&owner=include&count=40',
        }),
      }),
    );
    expect(html).toContain('data-filings-link');
    expect(html).toContain('data-insider-transactions-link');
    expect(html).toContain('CIK=0000320193');
  });

  it('discloses honestly, with no broken link, when the security has no CIK on record', () => {
    const html = renderToStaticMarkup(
      createElement(TickerHeaderCard, { header: header({ filingsHref: null, insiderTransactionsHref: null }) }),
    );
    expect(html).not.toContain('data-filings-link');
    expect(html).not.toContain('data-insider-transactions-link');
    expect(html).toContain('No SEC CIK on record');
  });
});

describe('TickerRefused', () => {
  it('renders the refusal reason as a legible page, not an error-shaped dead end', () => {
    const html = renderToStaticMarkup(
      createElement(TickerRefused, {
        symbol: 'ZZZZ',
        refusal: { refused: true, reason: 'not_found', message: "No active security is on record for 'ZZZZ'." },
      }),
    );
    expect(html).toContain('data-refused="not_found"');
    expect(html).toContain('No active security is on record for');
    expect(html).toContain('ZZZZ');
  });
});
