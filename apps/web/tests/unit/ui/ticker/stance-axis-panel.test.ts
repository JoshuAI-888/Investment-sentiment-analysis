import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StanceAxisPanel } from '../../../../src/ui/ticker/StanceAxisPanel';
import type { StanceFrameView } from '../../../../src/ui/ticker/types';

function frame(overrides: Partial<StanceFrameView> = {}): StanceFrameView {
  return {
    axis: 'reddit',
    label: 'Reddit',
    metric: null,
    sampleAdequacy: null,
    retrievedCount: 0,
    usedCount: 0,
    window: 'evidence retrieved this render',
    disclosure: 'This frame is an observed sample of Reddit comments and posts.',
    selectionBiasNotes: [],
    ...overrides,
  };
}

describe('StanceAxisPanel — D-14 three per-frame disclosures', () => {
  it('renders a selection-bias note in the DOM for every frame, even when not yet computed', () => {
    const html = renderToStaticMarkup(
      createElement(StanceAxisPanel, {
        frames: [
          frame({ axis: 'reddit', disclosure: 'reddit disclosure text' }),
          frame({ axis: 'x', disclosure: 'x disclosure text' }),
          frame({ axis: 'substack', disclosure: 'substack disclosure text' }),
        ],
      }),
    );

    expect(html).toContain('data-selection-bias-note');
    expect(html).toContain('reddit disclosure text');
    expect(html).toContain('x disclosure text');
    expect(html).toContain('substack disclosure text');
    expect(html).toContain('data-stance-frame="reddit"');
    expect(html).toContain('data-stance-frame="x"');
    expect(html).toContain('data-stance-frame="substack"');
  });

  it('never blends the three frames into one number — each renders its own metric or its own not-computed state', () => {
    const html = renderToStaticMarkup(
      createElement(StanceAxisPanel, {
        frames: [
          frame({
            axis: 'reddit',
            metric: {
              calculationId: 'c1',
              metricId: 'social.stance_reddit',
              label: 'Stance of sampled snippets (Reddit)',
              display: '0.200000',
              unit: 'stance_unit',
              roundingRule: 'ratio_6dp_half_even',
              eligibility: 'ok',
              reason: null,
              asOf: new Date('2026-09-01T00:00:00.000Z'),
              source: 'reddit',
              n: 8,
              window: 'evidence retrieved this render',
              observedAt: new Date('2026-09-01T00:00:00.000Z'),
              stale: false,
            },
          }),
          frame({ axis: 'x' }),
          frame({ axis: 'substack' }),
        ],
      }),
    );

    expect(html).toContain('data-inspectable-metric');
    expect(html).toContain('data-stance-not-computed');
  });

  /**
   * Round-3 lane-review finding 6: `selectionBiasNotes` (the method registry's own
   * `limitations[]`) was computed, contracted and asserted against the service object, but no
   * component rendered it — `data-selection-bias-note` renders a different field (`disclosure`).
   */
  it('renders each of a frame\'s selectionBiasNotes, distinct from the D-14 disclosure sentence', () => {
    const html = renderToStaticMarkup(
      createElement(StanceAxisPanel, {
        frames: [
          frame({
            axis: 'reddit',
            disclosure: 'the D-14 sampling-mechanics sentence',
            selectionBiasNotes: ['limitation one from the registry', 'limitation two from the registry'],
          }),
        ],
      }),
    );

    expect(html).toContain('data-method-limitations');
    expect(html).toContain('limitation one from the registry');
    expect(html).toContain('limitation two from the registry');
    // Both render — this is not a replacement for the D-14 sentence.
    expect(html).toContain('the D-14 sampling-mechanics sentence');
  });

  it('renders no limitations list when a frame has none (not yet computed)', () => {
    const html = renderToStaticMarkup(
      createElement(StanceAxisPanel, { frames: [frame({ axis: 'reddit', selectionBiasNotes: [] })] }),
    );
    expect(html).not.toContain('data-method-limitations');
  });
});
