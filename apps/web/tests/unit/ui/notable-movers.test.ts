import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NotableMovers } from '../../../src/ui/attention/NotableMovers';
import type { AttentionMetricView, NotableMoverView } from '../../../src/ui/attention/types';

function metric(overrides: Partial<AttentionMetricView> = {}): AttentionMetricView {
  return {
    calculationId: 'calc-1',
    metricId: 'attention.rank_change',
    label: 'Δ Rank',
    display: '18',
    unit: 'ranks',
    roundingRule: 'int_0dp_half_even',
    eligibility: 'ok',
    reason: null,
    isClamped: false,
    ...overrides,
  };
}

function mover(overrides: Partial<NotableMoverView> = {}): NotableMoverView {
  return {
    securityId: '00000000-0000-4000-8000-000000000001',
    symbol: 'GME',
    companyName: 'GameStop Corp.',
    rankChange: metric(),
    mentionDelta: metric({ calculationId: 'calc-2', metricId: 'attention.mention_delta', label: 'Δ Mentions', display: '790' }),
    rankChangeSource: 'own_history',
    observationWindowHours: 24,
    isWarmingUp: false,
    ...overrides,
  };
}

/**
 * Round-22 lane-review finding 1. `hasNotableMoverExcludedForStaleness` (round 21) now also fires
 * for a row that predates the collection frontier even when it is not yet six-hour `isStale` —
 * the old empty-state copy ("its observation is stale") was then a false claim about a row
 * `AttentionTable` renders as fresh on the same page. This pins the corrected, cause-neutral
 * wording that stays true under either cause.
 */
describe('NotableMovers — empty-state copy (round-22 lane-review finding 1)', () => {
  it('names both possible causes when excludedForStaleness is true, never asserting only "stale"', () => {
    const html = renderToStaticMarkup(createElement(NotableMovers, { movers: [], excludedForStaleness: true }));
    expect(html).toContain('data-notable-movers-empty');
    expect(html).toContain('stale');
    expect(html).toContain('not from this run');
    expect(html).not.toContain('clears the notable-mover bar');
  });

  it('states the ordinary bar when excludedForStaleness is false', () => {
    const html = renderToStaticMarkup(createElement(NotableMovers, { movers: [], excludedForStaleness: false }));
    expect(html).toContain('clears the notable-mover bar');
    expect(html).not.toContain('not from this run');
  });
});

/**
 * Round-31 lane-review finding 1. `NotableMovers`'s *populated* branch had no test at any level —
 * only `movers: []` was ever rendered here, `AttentionTable.tsx`'s own DoD-9 unit test
 * (`tests/unit/ui/attention-table.test.ts`) never covers this sibling component, the contract
 * tests only `zod`-parse hand-built objects, the integration tests assert `notableMovers` at the
 * service level without ever rendering it, and the one e2e assertion that touches a populated
 * card (`attention.spec.ts`'s `[data-inspectable-metric].first()` check) is a positional check
 * that silently falls through to the table's own Mentions cell if this component's own
 * `InspectableMetric` calls are ever deleted. Replacing either call with a bare
 * `{mover.rankChange.display}` would leave the whole suite green — this is a direct component-
 * render test closing that gap, the same pattern `attention-table.test.ts` already established.
 */
describe('NotableMovers — DoD item 9 / §6.2: every rendered metric is an InspectableMetric (round-31 lane-review finding 1)', () => {
  it('renders the Δ Rank cell through InspectableMetric, with its own calculation_id', () => {
    const html = renderToStaticMarkup(createElement(NotableMovers, { movers: [mover()], excludedForStaleness: false }));
    expect(html).toContain('data-inspectable-metric=""');
    expect(html).toContain('data-metric="attention.rank_change"');
    expect(html).toContain('data-calculation-id="calc-1"');
  });

  it('renders the Δ Mentions cell through InspectableMetric when present, with its own calculation_id', () => {
    const html = renderToStaticMarkup(createElement(NotableMovers, { movers: [mover()], excludedForStaleness: false }));
    expect(html).toContain('data-metric="attention.mention_delta"');
    expect(html).toContain('data-calculation-id="calc-2"');
  });

  it('omits the Δ Mentions cell, rather than rendering a bare number, when mentionDelta is null', () => {
    const html = renderToStaticMarkup(
      createElement(NotableMovers, { movers: [mover({ mentionDelta: null })], excludedForStaleness: false }),
    );
    expect(html).not.toContain('data-metric="attention.mention_delta"');
  });

  it('renders every mover on the page, not just the first', () => {
    const html = renderToStaticMarkup(
      createElement(NotableMovers, {
        movers: [
          mover({ securityId: 'sec-1', symbol: 'GME' }),
          mover({
            securityId: 'sec-2',
            symbol: 'AMC',
            rankChange: metric({ calculationId: 'calc-amc', display: '5' }),
            mentionDelta: null,
          }),
        ],
        excludedForStaleness: false,
      }),
    );
    const rankChangeMatches = html.match(/data-metric="attention\.rank_change"/g) ?? [];
    expect(rankChangeMatches).toHaveLength(2);
    expect(html).toContain('data-calculation-id="calc-amc"');
    expect(html).toContain('data-symbol="GME"');
    expect(html).toContain('data-symbol="AMC"');
  });
});

// Round-33 lane-review finding 1: this card's rankChange can clamp exactly like the identical
// security's row in `AttentionTable.tsx` — the disclosure was present there but missing here.
describe('NotableMovers — a clamped rank change is disclosed, not silent (round-33 lane-review finding 1)', () => {
  it('shows the clamped notice when rankChange.isClamped is true', () => {
    const html = renderToStaticMarkup(
      createElement(NotableMovers, { movers: [mover({ rankChange: metric({ isClamped: true }) })], excludedForStaleness: false }),
    );
    expect(html).toContain('data-rank-change-clamped=""');
    expect(html).toContain('Clamped');
  });

  it('shows no clamped notice when rankChange.isClamped is false', () => {
    const html = renderToStaticMarkup(
      createElement(NotableMovers, { movers: [mover({ rankChange: metric({ isClamped: false }) })], excludedForStaleness: false }),
    );
    expect(html).not.toContain('data-rank-change-clamped');
  });
});

// Round-33 lane-review finding 2: without a source and a window, this card ranked Δ Rank values
// computed over unlike spans and unlike sources as one undifferentiated list.
describe('NotableMovers — discloses the same source and window AttentionTable gives the identical security (round-33 lane-review finding 2)', () => {
  it('renders the provider-defined caption for a provider_reported mover', () => {
    const html = renderToStaticMarkup(
      createElement(NotableMovers, {
        movers: [mover({ rankChangeSource: 'provider_reported', observationWindowHours: 24 })],
        excludedForStaleness: false,
      }),
    );
    expect(html).toContain('data-rank-change-source="provider_reported"');
    expect(html).toContain('provider-defined');
    expect(html).toContain('24-hour comparison window');
  });

  it('renders the own-comparison caption and a churned window for an own_history mover', () => {
    const html = renderToStaticMarkup(
      createElement(NotableMovers, {
        movers: [mover({ rankChangeSource: 'own_history', observationWindowHours: 120 })],
        excludedForStaleness: false,
      }),
    );
    expect(html).toContain('data-rank-change-source="own_history"');
    expect(html).toContain('this deployment');
    expect(html).toContain('own comparison');
    expect(html).toContain('120-hour comparison window');
  });

  // Round-42 lane-review finding 2: without the warm-up qualifier, a two-observation
  // `own_history` delta captioned identically to a matured one on this card — the one surface
  // that ranks deltas against each other by raw magnitude.
  it('appends the warm-up qualifier for an own_history mover below the depth-14 floor', () => {
    const html = renderToStaticMarkup(
      createElement(NotableMovers, {
        movers: [mover({ rankChangeSource: 'own_history', isWarmingUp: true })],
        excludedForStaleness: false,
      }),
    );
    expect(html).toContain('warm-up window');
  });

  it('omits the warm-up qualifier for an own_history mover at or above the depth-14 floor', () => {
    const html = renderToStaticMarkup(
      createElement(NotableMovers, {
        movers: [mover({ rankChangeSource: 'own_history', isWarmingUp: false })],
        excludedForStaleness: false,
      }),
    );
    expect(html).not.toContain('warm-up window');
  });

  it('never appends the warm-up qualifier for a provider_reported mover', () => {
    const html = renderToStaticMarkup(
      createElement(NotableMovers, {
        movers: [mover({ rankChangeSource: 'provider_reported', isWarmingUp: true })],
        excludedForStaleness: false,
      }),
    );
    expect(html).not.toContain('warm-up window');
  });
});
