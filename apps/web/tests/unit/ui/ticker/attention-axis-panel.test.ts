import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AttentionAxisPanel } from '../../../../src/ui/ticker/AttentionAxisPanel';
import type { AttentionAxisView } from '../../../../src/ui/ticker/types';

function baseAxis(overrides: Partial<AttentionAxisView> = {}): AttentionAxisView {
  return {
    mentions: null,
    rank: null,
    observedAt: null,
    mentionDelta: null,
    rankChange: null,
    chartSegments: [],
    coverageDisclosure: 'no coverage floor is recorded yet for reddit',
    gapCount: 0,
    ...overrides,
  };
}

describe('AttentionAxisPanel', () => {
  it('renders an honest empty state when nothing has ever been observed', () => {
    const html = renderToStaticMarkup(createElement(AttentionAxisPanel, { attention: baseAxis() }));
    expect(html).toContain('data-attention-empty');
    expect(html).not.toContain('data-attention-mentions');
  });

  it('renders mentions and rank as raw facts when an observation exists', () => {
    const html = renderToStaticMarkup(
      createElement(AttentionAxisPanel, { attention: baseAxis({ mentions: 42, rank: 7 }) }),
    );
    expect(html).toContain('data-attention-mentions="42"');
    expect(html).toContain('data-attention-rank="7"');
  });

  it('renders "not on the board" rather than a fabricated rank when absent', () => {
    const html = renderToStaticMarkup(
      createElement(AttentionAxisPanel, { attention: baseAxis({ mentions: 5, rank: null }) }),
    );
    expect(html).toContain('not on the board');
  });

  it('renders the coverage floor disclosure on every render (F22 §4.4)', () => {
    const html = renderToStaticMarkup(createElement(AttentionAxisPanel, { attention: baseAxis() }));
    expect(html).toContain('data-coverage-disclosure');
    expect(html).toContain('no coverage floor is recorded yet');
  });

  it('renders coverage gaps as separate chart segments, never as one connected series, and discloses the gap count', () => {
    const html = renderToStaticMarkup(
      createElement(AttentionAxisPanel, {
        attention: baseAxis({
          mentions: 10,
          rank: 1,
          gapCount: 1,
          coverageDisclosure: 'coverage begins 2026-08-01 for reddit',
          chartSegments: [
            [{ observedAt: new Date('2026-08-01T00:00:00.000Z'), mentions: 3, rank: 5 }],
            [{ observedAt: new Date('2026-08-05T00:00:00.000Z'), mentions: 10, rank: 1 }],
          ],
        }),
      }),
    );
    expect(html).toContain('data-chart-segment="0"');
    expect(html).toContain('data-chart-segment="1"');
    expect(html).toContain('data-gap-count="1"');
    expect(html).toContain('data-gap-disclosure');
    expect(html).toContain('never interpolated across');
  });

  it('renders no gap disclosure when there are no recorded gaps', () => {
    const html = renderToStaticMarkup(
      createElement(AttentionAxisPanel, {
        attention: baseAxis({
          mentions: 10,
          rank: 1,
          chartSegments: [[{ observedAt: new Date('2026-08-01T00:00:00.000Z'), mentions: 3, rank: 5 }]],
        }),
      }),
    );
    expect(html).not.toContain('data-gap-disclosure');
  });
});
