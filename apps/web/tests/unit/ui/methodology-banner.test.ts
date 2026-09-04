import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MethodologyBanner } from '../../../src/ui/attention/MethodologyBanner';

const BASE_PROPS = {
  boardSourceUrl: 'https://apewisdom.io',
  boardMethodologyUrl: 'https://apewisdom.io/methodology',
};

function render(providerMethodologyVersion: string | null): string {
  return renderToStaticMarkup(createElement(MethodologyBanner, { ...BASE_PROPS, providerMethodologyVersion }));
}

/**
 * Round-48 lane-review finding 2. `providerMethodologyVersion` is not something ApeWisdom
 * publishes — `collector.ts`'s `APEWISDOM_METHODOLOGY_VERSION` doc comment says plainly that
 * ApeWisdom publishes no version of its own ranking algorithm, and the adapter's own schema
 * parses no version field from the wire at all. Rendered with no disclosure, directly beside a
 * link to ApeWisdom's own methodology page, a reader has no way to tell this constant from a
 * value ApeWisdom actually versions, and would reasonably (and wrongly) conclude an unchanged
 * value means ApeWisdom's methodology is unchanged. No test rendered this component directly
 * before this round — only `tests/e2e/attention.spec.ts` did, and only for presence of the link
 * and the version text, never for this disclosure.
 */
describe('MethodologyBanner — round-48 lane-review finding 2', () => {
  it('discloses that the version is this deployment\'s own record, not something ApeWisdom publishes', () => {
    const html = render('apewisdom-2026-09');
    expect(html).toContain('data-methodology-version=""');
    expect(html).toContain('apewisdom-2026-09');
    expect(html).toContain('ApeWisdom publishes no version of its own ranking methodology');
    expect(html).toContain('this deployment');
  });

  it('renders no disclosure, and no version span, when no version is known', () => {
    const html = render(null);
    expect(html).not.toContain('data-methodology-version');
    expect(html).not.toContain('ApeWisdom publishes no version');
  });

  it('always names the source and links its methodology, regardless of version disclosure', () => {
    const html = render(null);
    expect(html).toContain('data-source-link="apewisdom"');
    expect(html).toContain('data-methodology-link=""');
    expect(html).toContain('observed Reddit sample — coverage-limited');
  });
});
