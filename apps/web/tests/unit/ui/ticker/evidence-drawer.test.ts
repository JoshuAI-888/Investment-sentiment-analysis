import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EvidenceDrawer } from '../../../../src/ui/ticker/EvidenceDrawer';
import type { EvidenceItemView } from '../../../../src/ui/ticker/types';

function item(overrides: Partial<EvidenceItemView> = {}): EvidenceItemView {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    dedupeKey: 'https://example.com/a|a title',
    sourceKind: 'news',
    provider: 'marketaux',
    publisher: 'Example Wire',
    title: 'A title',
    url: 'https://example.com/a',
    publishedAt: new Date('2026-08-30T00:00:00.000Z'),
    retrievedAt: new Date('2026-08-30T01:00:00.000Z'),
    snippet: 'the stored snippet as retrieved',
    relevance: '0.9',
    availability: 'available',
    lastCheckedAt: null,
    unreachableNote: null,
    ...overrides,
  };
}

describe('EvidenceDrawer — F09 §4.3 / F-19', () => {
  it('states how many items were retrieved and how many were used', () => {
    const html = renderToStaticMarkup(
      createElement(EvidenceDrawer, { evidence: { items: [item()], retrievedCount: 10, usedCount: 1, truncated: false, pageTruncated: false } }),
    );
    expect(html).toContain('retrieved 10');
    expect(html).toContain('used 1');
  });

  it('renders the stored snippet, provenance and dedupeKey for an available item', () => {
    const html = renderToStaticMarkup(
      createElement(EvidenceDrawer, { evidence: { items: [item()], retrievedCount: 1, usedCount: 1, truncated: false, pageTruncated: false } }),
    );
    expect(html).toContain('the stored snippet as retrieved');
    expect(html).toContain('data-dedupe-key');
    expect(html).toContain('Example Wire');
    expect(html).not.toContain('data-evidence-unreachable');
  });

  it('renders the honest F-19 marker, the stored snippet, and the link for an unreachable source', () => {
    const html = renderToStaticMarkup(
      createElement(EvidenceDrawer, {
        evidence: {
          items: [
            item({
              availability: 'unreachable',
              unreachableNote: 'source no longer reachable — snippet as retrieved on 2026-08-30',
            }),
          ],
          retrievedCount: 1,
          usedCount: 1,
          truncated: false,
          pageTruncated: false,
        },
      }),
    );
    expect(html).toContain('data-evidence-unreachable');
    expect(html).toContain('source no longer reachable — snippet as retrieved on 2026-08-30');
    // The stored snippet is still shown, never blanked.
    expect(html).toContain('the stored snippet as retrieved');
    // The link is still shown (F-19: "the link is still shown").
    expect(html).toContain('href="https://example.com/a"');
  });

  it.each(['removed', 'paywalled', 'unchecked'] as const)(
    'renders a non-blank, honest note for availability=%s',
    (availability) => {
      const html = renderToStaticMarkup(
        createElement(EvidenceDrawer, {
          evidence: {
            items: [item({ availability, unreachableNote: `${availability} — snippet as retrieved on 2026-08-30` })],
            retrievedCount: 1,
            usedCount: 1,
            truncated: false,
            pageTruncated: false,
          },
        }),
      );
      expect(html).toContain(`data-evidence-availability="${availability}"`);
      expect(html).toContain(`${availability} — snippet as retrieved on 2026-08-30`);
    },
  );

  it('renders an empty state rather than a blank drawer for a security with no evidence', () => {
    const html = renderToStaticMarkup(
      createElement(EvidenceDrawer, { evidence: { items: [], retrievedCount: 0, usedCount: 0, truncated: false, pageTruncated: false } }),
    );
    expect(html).toContain('No evidence is on record');
  });

  it('discloses truncation as a lower bound, not an exact total', () => {
    const html = renderToStaticMarkup(
      createElement(EvidenceDrawer, { evidence: { items: [item()], retrievedCount: 5000, usedCount: 1, truncated: true, pageTruncated: false } }),
    );
    expect(html).toContain('data-evidence-truncated');
    expect(html).toContain('lower bound');
  });

  /**
   * Round-2 lane-review finding 2: `pageTruncated` (more distinct evidence than fits the
   * 200-item page) is a different, far more common condition than `truncated` (the 5,000-row
   * scan limit itself). Without this disclosure, a heavily-covered ticker's stance/news counts
   * silently understated what was actually on record.
   */
  it('discloses when more distinct evidence exists than fits the page, independently of the scan-limit truncation flag', () => {
    const html = renderToStaticMarkup(
      createElement(EvidenceDrawer, {
        evidence: { items: [item()], retrievedCount: 250, usedCount: 200, truncated: false, pageTruncated: true },
      }),
    );
    expect(html).toContain('data-evidence-page-truncated');
    expect(html).not.toContain('data-evidence-truncated');
  });

  it('renders a null snippet as an honest placeholder, never blank', () => {
    const html = renderToStaticMarkup(
      createElement(EvidenceDrawer, {
        evidence: { items: [item({ snippet: null })], retrievedCount: 1, usedCount: 1, truncated: false, pageTruncated: false },
      }),
    );
    expect(html).toContain('No snippet was retained.');
  });
});
