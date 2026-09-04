import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConfigVersionGapBanner } from '../../../src/ui/attention/ConfigVersionGapBanner';

/**
 * Round-43 lane-review finding 1. This banner lived inline in `page.tsx` (a Next.js Server
 * Component, unreachable from a unit test), so nothing at any level rendered it — deleting it
 * left the full gate green. Extracted so this test can actually catch that regression.
 */
describe('ConfigVersionGapBanner — round-42 lane-review finding 1, round-43 lane-review finding 1', () => {
  it('renders nothing when the config version is not missing, regardless of symbols', () => {
    const html = renderToStaticMarkup(
      createElement(ConfigVersionGapBanner, { activeConfigVersionMissing: false, symbols: [] }),
    );
    expect(html).toBe('');
  });

  it('names the affected symbol and states the cause for a single symbol', () => {
    const html = renderToStaticMarkup(
      createElement(ConfigVersionGapBanner, { activeConfigVersionMissing: true, symbols: ['NVDA'] }),
    );
    expect(html).toContain('data-config-version-gap=""');
    expect(html).toContain('NVDA');
    expect(html).toContain('no active config version');
    expect(html).toContain('has a recorded observation');
    expect(html).not.toContain('have a recorded observation');
  });

  it('pluralizes correctly and names every affected symbol for more than one', () => {
    const html = renderToStaticMarkup(
      createElement(ConfigVersionGapBanner, { activeConfigVersionMissing: true, symbols: ['GME', 'AAPL'] }),
    );
    expect(html).toContain('GME, AAPL');
    expect(html).toContain('have a recorded observation');
    expect(html).not.toContain('has a recorded observation');
  });

  // Round-47 lane-review finding 1: `symbols` alone can under-disclose the fault — a run where
  // every tracked security's Redis pointers are already warm builds every row successfully even
  // with no active config version, leaving `symbols: []`. This banner must still say so.
  describe('activeConfigVersionMissing with no specific symbol affected (round-47 lane-review finding 1)', () => {
    it('still renders, naming the collector-level fault rather than nothing', () => {
      const html = renderToStaticMarkup(
        createElement(ConfigVersionGapBanner, { activeConfigVersionMissing: true, symbols: [] }),
      );
      expect(html).toContain('data-config-version-gap=""');
      expect(html).toContain('no active config version');
      expect(html).toContain('An operator needs to activate one');
    });

    // Round-49 lane-review finding 2: "so the collector cannot run again until an operator
    // activates one" and "in the meantime" both read as "activation resumes collection," which is
    // not true of this deployment — nothing calls `runAttentionCollection` in production at all
    // yet (no dispatcher is wired). Activation is necessary, not sufficient; the banner must not
    // claim otherwise.
    it('never claims activation alone resumes collection', () => {
      const html = renderToStaticMarkup(
        createElement(ConfigVersionGapBanner, { activeConfigVersionMissing: true, symbols: [] }),
      );
      expect(html).not.toContain('collector cannot run again until');
      expect(html).not.toContain('in the meantime');
    });

    it('never claims a specific security has an unloaded observation when none is named', () => {
      const html = renderToStaticMarkup(
        createElement(ConfigVersionGapBanner, { activeConfigVersionMissing: true, symbols: [] }),
      );
      expect(html).not.toContain('has a recorded observation');
      expect(html).not.toContain('have a recorded observation');
    });
  });
});
