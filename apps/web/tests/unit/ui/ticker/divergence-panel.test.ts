import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DivergencePanel } from '../../../../src/ui/ticker/DivergencePanel';
import type { DivergencePanelView } from '../../../../src/ui/ticker/types';

/** Verbatim, product invariant §6.4. */
const DISCLOSURE_LINE =
  'This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.';

function render(view: DivergencePanelView): string {
  return renderToStaticMarkup(createElement(DivergencePanel, { divergence: view }));
}

describe('DivergencePanel — product invariant §6.4', () => {
  it('renders the §6.4 disclosure line verbatim when a divergence state is available', () => {
    const html = render({
      available: true,
      metricId: 'market.divergence_state',
      calculationId: 'calc-1',
      state: 'confirming_interest',
      interpretation: 'Attention and price are moving in the same direction; causality is unproven.',
      disclosure: DISCLOSURE_LINE,
      socialAxisDisclosure: "The stance input to this state is Reddit's sampled frame alone.",
      observedAt: new Date('2026-09-01T00:00:00.000Z'),
      stale: false,
    });

    expect(html).toContain('data-divergence-disclosure');
    expect(html).toContain(DISCLOSURE_LINE);
    expect(html).toContain('data-divergence-state="confirming_interest"');
  });

  /**
   * Round-4 lane-review finding 2: `interpretation` reads as an unqualified claim about "stance"
   * (e.g. "Discussion is optimistic…"), but the social leg is Reddit's sampled frame alone — D-14's
   * three platforms are never blended. This disclosure must render alongside it, not just exist
   * on the service object.
   */
  it('discloses that the stance input is Reddit alone, not a blend of all three D-14 frames', () => {
    const html = render({
      available: true,
      metricId: 'market.divergence_state',
      calculationId: 'calc-1',
      state: 'bullish_discussion_weak_tape',
      interpretation: 'Discussion is optimistic while price action is negative.',
      disclosure: DISCLOSURE_LINE,
      socialAxisDisclosure: "The stance input to this state is Reddit's sampled frame alone — X and Substack are not included.",
      observedAt: new Date('2026-09-01T00:00:00.000Z'),
      stale: false,
    });

    expect(html).toContain('data-divergence-social-axis-disclosure');
    expect(html).toContain('sampled frame alone');
  });

  it('links to the Inspector for the divergence artifact', () => {
    const html = render({
      available: true,
      metricId: 'market.divergence_state',
      calculationId: 'calc-xyz',
      state: 'no_clear_pattern',
      interpretation: 'x',
      disclosure: DISCLOSURE_LINE,
      socialAxisDisclosure: "The stance input to this state is Reddit's sampled frame alone.",
      observedAt: new Date('2026-09-01T00:00:00.000Z'),
      stale: false,
    });
    expect(html).toContain('/calculations/calc-xyz');
  });

  /**
   * Round-4 lane-review finding 3: this panel used to compose neither `CoverageLabel` nor
   * `FreshnessBadge` — the only metric surface on the page that didn't — and its artifact's
   * synthesized inputs all carried `observedAt: null`, making it structurally incapable of ever
   * showing stale regardless of how old the underlying attention/stance/price data actually was.
   */
  it('discloses staleness via FreshnessBadge, the same as every other metric on the page', () => {
    const fresh = render({
      available: true,
      metricId: 'market.divergence_state',
      calculationId: 'calc-1',
      state: 'confirming_interest',
      interpretation: 'x',
      disclosure: DISCLOSURE_LINE,
      socialAxisDisclosure: "The stance input to this state is Reddit's sampled frame alone.",
      observedAt: new Date('2026-09-01T00:00:00.000Z'),
      stale: false,
    });
    expect(fresh).toContain('data-freshness="fresh"');

    const stale = render({
      available: true,
      metricId: 'market.divergence_state',
      calculationId: 'calc-1',
      state: 'confirming_interest',
      interpretation: 'x',
      disclosure: DISCLOSURE_LINE,
      socialAxisDisclosure: "The stance input to this state is Reddit's sampled frame alone.",
      observedAt: new Date('2026-01-01T00:00:00.000Z'),
      stale: true,
    });
    expect(stale).toContain('data-freshness="stale"');
    expect(stale).toContain('refresh failed');
  });

  it('renders a plain, honest reason when not enough data exists — no fabricated state', () => {
    const html = render({ available: false, reason: 'The attention direction is not yet determinable.' });
    expect(html).toContain('data-divergence-unavailable');
    expect(html).toContain('The attention direction is not yet determinable.');
    expect(html).not.toContain('data-divergence-state');
  });
});
