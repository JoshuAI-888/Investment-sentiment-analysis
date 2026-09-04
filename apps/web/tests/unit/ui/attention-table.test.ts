import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AttentionTable } from '../../../src/ui/attention/AttentionTable';
import type { AttentionMetricView, AttentionRowView } from '../../../src/services/attention/contract';
import type { AttentionDegradedReason } from '../../../src/ui/attention/types';

/**
 * Round-17 lane-review finding 2: no unit test at any level rendered `AttentionTable` — a mutant
 * replacing any of the Mentions/Upvotes/Rank cells with a bare `{row.mentions.display}` (no
 * `InspectableMetric`, no `calculation_id`, no Inspector link) left the whole suite green, since
 * the one e2e assertion that inspects `[data-inspectable-metric]` only ever checks the *first*
 * one on the page (the alphabetically-first row's Mentions cell) and every other e2e assertion is
 * keyed to a different metric (`rank_change`, `mention_delta`, `mention_growth`, `mentions_zscore`).
 * This is a true component-render test, the same pattern `tests/unit/ui/aggregate-metric.test.ts`
 * already established for F07's `AggregateMetric`.
 *
 * Also covers round-17 lane-review finding 1 (`degraded`'s effect on the per-row freshness copy —
 * see the second `describe` block).
 */
function metric(overrides: Partial<AttentionMetricView> = {}): AttentionMetricView {
  return {
    calculationId: 'calc-1',
    metricId: 'attention.rank_change',
    label: 'Δ Rank',
    display: '3',
    unit: 'ranks',
    roundingRule: 'int_0dp_half_even',
    eligibility: 'ok',
    reason: null,
    isClamped: false,
    ...overrides,
  };
}

function row(overrides: Partial<AttentionRowView> = {}): AttentionRowView {
  return {
    securityId: '00000000-0000-4000-8000-000000000001',
    symbol: 'GME',
    companyName: 'GameStop Corp.',
    mentions: metric({ calculationId: 'calc-mentions', metricId: 'attention.mentions_now', label: 'Mentions', display: '1204' }),
    mentionDelta: metric({ calculationId: 'calc-mention-delta', metricId: 'attention.mention_delta', label: 'Δ Mentions', display: '304' }),
    mentionGrowth: null,
    upvotes: metric({ calculationId: 'calc-upvotes', metricId: 'attention.engagement_now', label: 'Upvotes', display: '8213' }),
    rank: metric({ calculationId: 'calc-rank', metricId: 'attention.rank_now', label: 'Rank', display: '1' }),
    rankChange: metric({ calculationId: 'calc-rank-change' }),
    mentionsZscore: null,
    mentionsZscoreWindowHours: null,
    observedAt: OBSERVED_AT,
    observationWindowHours: 24,
    historyDepth: { securityId: '00000000-0000-4000-8000-000000000001', comparableSnapshots: 20, requiredForZscore: 14 },
    isNew: false,
    isDroppedFromBoard: false,
    isMethodologyBoundary: false,
    isThinSample: false,
    rankChangeSource: 'own_history',
    isStale: false,
    wasMalformedLastRun: false,
    ...overrides,
  };
}

const OBSERVED_AT = new Date('2026-09-01T00:00:00Z');

function render(
  rows: readonly AttentionRowView[],
  degradedReason: AttentionDegradedReason | null = null,
  lastCollectedAt: Date | null = OBSERVED_AT,
): string {
  return renderToStaticMarkup(
    createElement(AttentionTable, { rows, degradedReason, lastCollectedAt, providerWindowHours: 24 }),
  );
}

describe('AttentionTable — DoD item 9 / §6.2: every numeric cell is an InspectableMetric', () => {
  it('renders the Mentions cell through InspectableMetric, with its own calculation_id', () => {
    const html = render([row()]);
    expect(html).toContain('data-metric="attention.mentions_now"');
    expect(html).toContain('data-calculation-id="calc-mentions"');
  });

  it('renders the Upvotes cell through InspectableMetric, with its own calculation_id', () => {
    const html = render([row()]);
    expect(html).toContain('data-metric="attention.engagement_now"');
    expect(html).toContain('data-calculation-id="calc-upvotes"');
  });

  it('renders the Rank cell through InspectableMetric, with its own calculation_id', () => {
    const html = render([row()]);
    expect(html).toContain('data-metric="attention.rank_now"');
    expect(html).toContain('data-calculation-id="calc-rank"');
  });

  it('renders every row-level InspectableMetric, not just the first row on the page', () => {
    const html = render([
      row({ securityId: '00000000-0000-4000-8000-000000000001', symbol: 'AAA' }),
      row({
        securityId: '00000000-0000-4000-8000-000000000002',
        symbol: 'ZZZ',
        mentions: metric({ calculationId: 'calc-mentions-2', metricId: 'attention.mentions_now', label: 'Mentions', display: '77' }),
      }),
    ]);
    const mentionsMatches = html.match(/data-metric="attention\.mentions_now"/g) ?? [];
    expect(mentionsMatches).toHaveLength(2);
    expect(html).toContain('data-calculation-id="calc-mentions-2"');
  });
});

// Round-49 lane-review finding 3: F08 §4.4's minimum-base rule ("prior mentions < 5 ⇒ absolute
// delta only") had no test that would fail if `AttentionTable.tsx` stopped rendering the growth
// cell for a row where the rule actually fired — the row factory hardcodes `mentionGrowth: null`
// and no test overrode it, so a change suppressing any non-`ok` growth cell (e.g.
// `row.mentionGrowth === null || row.mentionGrowth.eligibility !== 'ok' ? null : ...`) would pass
// the entire gate green while silently swallowing the exact abstention this rule exists to
// disclose. `tests/e2e/attention.spec.ts` only ever exercises the eligible case (GME).
describe('AttentionTable — an abstained mention_growth cell is disclosed, not swallowed (round-49 lane-review finding 3)', () => {
  const abstainedGrowth = metric({
    calculationId: 'calc-growth',
    metricId: 'attention.mention_growth',
    label: 'Mention growth',
    display: null,
    eligibility: 'insufficient_data',
    reason:
      'The prior window had 3 mention(s). At least 5 are required before growth is shown as a ratio, because a ratio over a handful of mentions swings enormously for a change of one or two. The absolute change (attention.mention_delta) is shown instead.',
  });

  it('renders the abstained growth cell through InspectableMetric, with its own calculation_id and reason', () => {
    const html = render([row({ mentionGrowth: abstainedGrowth })]);
    expect(html).toContain('data-metric="attention.mention_growth"');
    expect(html).toContain('data-calculation-id="calc-growth"');
    expect(html).toContain('data-eligibility="insufficient_data"');
    expect(html).toContain('data-abstained=""');
    expect(html).toContain('The prior window had 3 mention(s)');
  });

  it('renders no mention_growth metric at all when the row carries none', () => {
    const html = render([row({ mentionGrowth: null })]);
    expect(html).not.toContain('data-metric="attention.mention_growth"');
  });
});

// Round-25 lane-review finding 2: the z-score's `CoverageLabel` used to be given `window={null}`
// unconditionally, so `n=30` read identically whether the underlying observations spanned a
// month (today's daily-ish cadence) or 2.5 hours (F16a's future 5-minute one). §6.1 requires
// every rendered aggregate to carry its real window, the same as `Δ Rank`'s own Observed cell.
describe('AttentionTable — the mentions z-score renders its real window, not "window not recorded" (round-25 lane-review finding 2)', () => {
  it('renders a whole-hour window label derived from mentionsZscoreWindowHours', () => {
    const html = render([
      row({
        mentionsZscore: metric({ calculationId: 'calc-zscore', metricId: 'attention.mentions_zscore', label: 'Anomaly (z-score)', display: '2.1' }),
        mentionsZscoreWindowHours: 5,
        historyDepth: { securityId: '00000000-0000-4000-8000-000000000001', comparableSnapshots: 20, requiredForZscore: 14 },
      }),
    ]);
    expect(html).toContain('data-coverage-window=""');
    expect(html).toContain('5-hour observation window');
    expect(html).not.toContain('window not recorded');
  });

  it('renders a minute-scale window once F16a-style cadence makes the same n span under an hour', () => {
    const html = render([
      row({
        mentionsZscore: metric({ calculationId: 'calc-zscore', metricId: 'attention.mentions_zscore', label: 'Anomaly (z-score)', display: '2.1' }),
        mentionsZscoreWindowHours: 2.5,
        historyDepth: { securityId: '00000000-0000-4000-8000-000000000001', comparableSnapshots: 30, requiredForZscore: 14 },
      }),
    ]);
    expect(html).toContain('2.5-hour observation window');
  });
});

// Round-29 lane-review finding 1: the row-level window label used to say "N-hour observation
// window" unqualified, which a reader could take as covering Mentions/Upvotes too — but those are
// ApeWisdom's own fixed rolling aggregates (a page-level provider constant), while the row-level
// number is this row's own Δ Rank/Δ Mentions comparison span, which grows unbounded across D-30
// board churn. Disambiguated by wording (the row-level label now says "comparison window") and by
// disclosing the provider's own window once, in the Mentions/Upvotes column headers.
describe('AttentionTable — the provider window and the row-level comparison window are never conflated (round-29 lane-review finding 1)', () => {
  it('discloses the provider window once, in the Mentions and Upvotes column headers', () => {
    const html = render([row()]);
    expect(html).toContain('data-provider-window="24"');
    const providerWindowMatches = html.match(/24-hour window, ApeWisdom/g) ?? [];
    expect(providerWindowMatches).toHaveLength(2);
  });

  it('labels the row-level span as a comparison window, never the bare "observation window" a reader could take for the provider\'s own', () => {
    const html = render([row({ observationWindowHours: 120 })]);
    expect(html).toContain('120-hour comparison window');
    expect(html).not.toContain('120-hour observation window');
  });
});

// Round-29 lane-review finding 2: a z-score whose denominator hit the epsilon floor
// (`toMetricView`'s `isClamped`, derived from the artifact's own `scaled_mad` step status) used
// to render identically to one computed off a genuine spread — no visible difference from a
// real anomaly, on the product's most visible surface.
describe('AttentionTable — a floored z-score denominator is disclosed, not silent (round-29 lane-review finding 2)', () => {
  it('shows the floored notice when mentionsZscore.isClamped is true', () => {
    const html = render([
      row({
        mentionsZscore: metric({
          calculationId: 'calc-zscore',
          metricId: 'attention.mentions_zscore',
          label: 'Anomaly (z-score)',
          display: '31749.126',
          isClamped: true,
        }),
        mentionsZscoreWindowHours: 720,
        historyDepth: { securityId: '00000000-0000-4000-8000-000000000001', comparableSnapshots: 30, requiredForZscore: 14 },
      }),
    ]);
    expect(html).toContain('data-zscore-clamped=""');
    expect(html).toContain('Floored');
  });

  it('shows no floored notice when mentionsZscore.isClamped is false', () => {
    const html = render([
      row({
        mentionsZscore: metric({
          calculationId: 'calc-zscore',
          metricId: 'attention.mentions_zscore',
          label: 'Anomaly (z-score)',
          display: '2.1',
          isClamped: false,
        }),
        mentionsZscoreWindowHours: 720,
        historyDepth: { securityId: '00000000-0000-4000-8000-000000000001', comparableSnapshots: 30, requiredForZscore: 14 },
      }),
    ]);
    expect(html).not.toContain('data-zscore-clamped');
    expect(html).not.toContain('Floored');
  });
});

// A row "at the collection frontier" has `observedAt === lastCollectedAt` — it was part of the
// most recent collection attempt actually recorded. A "churned" row's `observedAt` predates
// `lastCollectedAt` — a later run already completed without it (D-30 board churn).
// Round-33 lane-review finding 1: `attention.rank_change`'s own `bounded_rank_delta` step clamps
// to the board size on the ordinary bootstrap path (an unbounded provider-reported
// `rank_24h_ago`), the same mechanism as the z-score's own epsilon floor above — but only the
// z-score's clamp was disclosed, so a clamped Δ Rank rendered as a plain, unmarked number a
// 100-name board can never legitimately produce.
describe('AttentionTable — a clamped rank change is disclosed, not silent (round-33 lane-review finding 1)', () => {
  it('shows the clamped notice when rankChange.isClamped is true', () => {
    const html = render([row({ rankChange: metric({ display: '100', isClamped: true }) })]);
    expect(html).toContain('data-rank-change-clamped=""');
    expect(html).toContain('Clamped');
  });

  it('shows no clamped notice when rankChange.isClamped is false', () => {
    const html = render([row({ rankChange: metric({ display: '3', isClamped: false }) })]);
    expect(html).not.toContain('data-rank-change-clamped');
    expect(html).not.toContain('Clamped:');
  });
});

// Round-33 lane-review finding 3: a security that predates the collection frontier because the
// last run received data for it that failed to parse is not "no longer on ApeWisdom's tracked
// board" — it is on the board, sending unparseable data, which is a materially different (and
// actionable) cause from routine D-30 churn.
describe('AttentionTable — a malformed-data drop is disclosed distinctly from routine board churn (round-33 lane-review finding 3)', () => {
  const churnedAt = new Date(OBSERVED_AT.getTime() - 3 * 24 * 60 * 60_000);

  it('states the malformed-data cause, not routine churn, when wasMalformedLastRun is true', () => {
    const html = render([row({ isStale: true, observedAt: churnedAt, wasMalformedLastRun: true })], null, OBSERVED_AT);
    expect(html).toContain('data-freshness="stale"');
    expect(html).toContain('data-malformed-last-run=""');
    expect(html).toContain('could not be parsed');
    expect(html).not.toContain('may simply no longer be');
  });

  it('states the ordinary churn wording when wasMalformedLastRun is false', () => {
    const html = render([row({ isStale: true, observedAt: churnedAt, wasMalformedLastRun: false })], null, OBSERVED_AT);
    expect(html).toContain('data-freshness="stale"');
    expect(html).not.toContain('data-malformed-last-run');
    expect(html).not.toContain('could not be parsed');
    expect(html).toContain('may simply no longer be');
  });

  // Round-34 lane-review finding 2a, correcting round 33's own fix: an all-malformed run leaves
  // every row *at* the frontier (`lastCollectedAt` never advances), which the original placement
  // never checked — the malformed flag must fire there too, not only for a churned row.
  it('states the malformed-data cause for a row at the frontier, not the vague "no newer run" wording', () => {
    const html = render(
      [row({ isStale: true, observedAt: OBSERVED_AT, wasMalformedLastRun: true })],
      'no_new_data',
      OBSERVED_AT,
    );
    expect(html).toContain('data-malformed-last-run=""');
    expect(html).toContain('could not be parsed');
    expect(html).not.toContain('no newer collection run has completed');
  });

  // Round-35 lane-review finding 2, correcting round 34's own fix: round 34 suppressed this
  // disclosure once `degradedReason === 'provider_unreachable'`, reasoning that a later total
  // outage makes the flag stale — but the copy already says "the most recent **successful**
  // collection run," which stays true regardless of a later failure, since `pipeline.ts` writes
  // `KEYS.malformedTickers()` on every successful contact and never touches it on a failed one —
  // exactly the same durability `KEYS.lastCollectedAt()` already has. Suppressing it fell through
  // to "may simply no longer be on the board," a claim the last successful run's own evidence
  // directly contradicts.
  it('still states the malformed-data cause even when the current run has since failed outright', () => {
    const html = render(
      [row({ isStale: true, observedAt: churnedAt, wasMalformedLastRun: true })],
      'provider_unreachable',
      OBSERVED_AT,
    );
    expect(html).toContain('data-malformed-last-run=""');
    expect(html).toContain('could not be parsed');
    expect(html).not.toContain('may simply no longer be');
  });

  // Round-39 lane-review finding 1, correcting rounds 34/35's own placement: the whole freshness
  // ternary — the malformed branch included — was gated on `row.isStale ||
  // row.rankChange.eligibility === 'stale'`. A row this exact run just dropped as malformed is
  // not yet stale by either measure (its frozen artifact still reads `eligibility: 'ok'` for up
  // to six hours), so the disclosure never fired during that entire window and the cell fell to
  // the ordinary fresh badge — a plausible-looking normal render for a security the collector
  // cannot currently store.
  it('states the malformed-data cause immediately, even before the row would otherwise read stale', () => {
    const html = render(
      [row({ isStale: false, observedAt: OBSERVED_AT, wasMalformedLastRun: true })],
      null,
      OBSERVED_AT,
    );
    expect(html).toContain('data-malformed-last-run=""');
    expect(html).toContain('could not be parsed');
    // Round-40 lane-review finding 2, correcting round 39's own fix: this row is not stale by
    // either measure, so `data-freshness` must read "fresh", not "stale" — `NotableMovers.tsx`'s
    // own empty-state copy relies on this exact attribute value for a fresh, non-frontier row.
    expect(html).toContain('data-freshness="fresh"');
    expect(html).not.toContain('data-freshness="stale"');
    // Round-40 lane-review finding 1: a fresh row must never claim it is "older than its refresh
    // window" — that clause is true only on the stale branch, pinned separately below.
    expect(html).not.toContain('older than its refresh window');
  });

  // Round-40 lane-review finding 1, correcting round 39's own fix: round 39 dropped the "older
  // than its refresh window" clause and misdated the parse failure to the row's own (possibly
  // days-old) `observedAt` rather than to the run that actually caused it. A genuinely stale,
  // malformed-flagged row must state both facts — the reading is overdue, and separately, the
  // most recent successful run could not parse this security.
  it('states both facts for a genuinely stale, malformed-flagged row: the reading is overdue and separately unparseable', () => {
    const staleChurnedAt = new Date(OBSERVED_AT.getTime() - 3 * 24 * 60 * 60_000);
    const html = render(
      [row({ isStale: true, observedAt: staleChurnedAt, wasMalformedLastRun: true })],
      null,
      OBSERVED_AT,
    );
    expect(html).toContain('data-freshness="stale"');
    expect(html).toContain('data-malformed-last-run=""');
    expect(html).toContain('older than its refresh window');
    expect(html).toContain('could not be parsed');
  });
});

describe('AttentionTable — freshness copy for a row at the collection frontier (round-17/18/19 lane-review finding 1)', () => {
  it('shows the shared "refresh failed" wording when the last collector run genuinely failed', () => {
    const html = render([row({ isStale: true })], 'provider_unreachable', OBSERVED_AT);
    expect(html).toContain('data-freshness="stale"');
    expect(html).toContain('refresh failed');
  });

  it('states the collection gap, without claiming a cause, when no run has completed since', () => {
    const html = render([row({ isStale: true })], null, OBSERVED_AT);
    expect(html).toContain('data-freshness="stale"');
    expect(html).not.toContain('refresh failed');
    expect(html).not.toContain('running normally');
    expect(html).toContain('no newer collection run has completed');
  });

  it('renders the ordinary fresh badge for a fresh row regardless of the page-level degraded reason', () => {
    const html = render([row({ isStale: false })], 'provider_unreachable', OBSERVED_AT);
    expect(html).toContain('data-freshness="fresh"');
    expect(html).not.toContain('refresh failed');
  });
});

// Round-21 lane-review finding 1, correcting round 17's own fix: `degraded` (the boolean this
// component previously took) is true for three distinct causes — a genuine fetch failure, a 200
// response with nothing usable ('no_new_data'), and a 200 response whose shape no longer matched
// the schema ('provider_contract_changed') — and only the first means a refresh attempt did not
// complete. Round 13 already fixed the identical conflation for the shared `DegradedPanel`; round
// 17 reintroduced it one component down by wiring the undifferentiated boolean into this table's
// "refresh failed" wording.
describe('AttentionTable — freshness copy distinguishes degradedReason (round-21 lane-review finding 1)', () => {
  it.each(['no_new_data', 'provider_contract_changed'] as const)(
    'never shows "refresh failed" for a frontier row when degradedReason is %s',
    (reason) => {
      const html = render([row({ isStale: true })], reason, OBSERVED_AT);
      expect(html).toContain('data-freshness="stale"');
      expect(html).not.toContain('refresh failed');
      expect(html).toContain('no newer collection run has completed');
    },
  );

  it('shows "refresh failed" only for provider_unreachable', () => {
    const html = render([row({ isStale: true })], 'provider_unreachable', OBSERVED_AT);
    expect(html).toContain('refresh failed');
  });
});

// Round-19 lane-review finding 1, correcting round 18's own fix: `collectionStale` (a page-level
// fact) cannot tell "this row is the collection frontier, gone stale" from "this row predates the
// frontier entirely" — a security that fell off the board days before the page-wide gap even
// started is exactly as stale either way, and round 18's page-level-only branching told it "no
// newer collection run has completed since" even while dozens of other rows on the same page
// carried a much fresher `observedAt`, proving one had. `lastCollectedAt` (the exact `observedAt`
// every row in the most recent successful run shares) is what actually distinguishes the two.
describe('AttentionTable — freshness copy for a row that predates the collection frontier (round-19 lane-review finding 1)', () => {
  const churnedRow = row({ isStale: true, observedAt: new Date(OBSERVED_AT.getTime() - 3 * 24 * 60 * 60_000) });

  it('never claims "no newer collection run has completed" for a row a later run already excluded', () => {
    const html = render([churnedRow], null, OBSERVED_AT);
    expect(html).toContain('data-freshness="stale"');
    expect(html).not.toContain('no newer collection run has completed');
    expect(html).not.toContain('refresh failed');
    expect(html).toContain('a later collection run has completed without this security');
  });

  it('never claims "refresh failed" for the same churned row even when the current run is degraded', () => {
    const html = render([churnedRow], 'provider_unreachable', OBSERVED_AT);
    expect(html).not.toContain('refresh failed');
    expect(html).toContain('a later collection run has completed without this security');
  });

  it('a churned row and a frontier row on the same page never make contradictory claims', () => {
    const frontierRow = row({
      securityId: '00000000-0000-4000-8000-000000000002',
      symbol: 'ZZZ',
      isStale: true,
      observedAt: OBSERVED_AT,
    });
    const html = render([churnedRow, frontierRow], null, OBSERVED_AT);
    // The churned row states a later run excluded it; the frontier row states none has come yet —
    // both true simultaneously, and neither implies the other is lying about the page's history.
    expect(html).toContain('a later collection run has completed without this security');
    expect(html).toContain('no newer collection run has completed');
  });
});

// Round-20 lane-review finding 1, correcting round 19's own fix: exact equality between
// `row.observedAt` and `lastCollectedAt` treats a row *newer* than the recorded frontier
// identically to a churned (older) one — both fall into the `else` branch and both get told "a
// later collection run has completed without this security," which is false for a row that is
// itself the newest observation on record. Reachable whenever `leaderboard.ts`'s own
// `lastCollectedAt` (Redis's bookkeeping key, preferred unconditionally over Postgres) falls
// behind Postgres — an interruption between `pipeline.ts`'s snapshot writes and its later
// `redis.set`, or a serverless instance whose in-memory Redis never saw a run another instance's
// Postgres write already reflects.
describe('AttentionTable — freshness copy for a row newer than the recorded frontier (round-20 lane-review finding 1)', () => {
  it('never claims a later run excluded a row that is itself newer than lastCollectedAt', () => {
    const newerRow = row({ isStale: true, observedAt: new Date(OBSERVED_AT.getTime() + 60_000) });
    const html = render([newerRow], null, OBSERVED_AT);
    expect(html).toContain('data-freshness="stale"');
    expect(html).not.toContain('a later collection run has completed without this security');
    expect(html).not.toContain('refresh failed');
    expect(html).toContain('no newer collection run has completed');
  });
});

// Round-30 lane-review finding 1: the Δ Rank/Δ Mentions sort buttons order by absolute magnitude
// (matching `NotableMovers`'s own ranking), but carried no visible or accessible disclosure of
// that — a reader could reasonably expect an ascending/descending numeric sort instead. This
// component is rendered with `renderToStaticMarkup`, so a click cannot be simulated here (the
// actual reordering behaviour has its own e2e coverage); this test covers what a static render
// can prove — the disclosure text and the initial, honest `aria-sort="none"` state.
describe('AttentionTable — the magnitude sort discloses its own semantics (round-30 lane-review finding 1)', () => {
  it('captions both sort buttons as "largest move, either direction", not left to be inferred', () => {
    const html = render([row()]);
    const captionMatches = html.match(/largest move, either direction/g) ?? [];
    expect(captionMatches).toHaveLength(2);
  });

  it('marks both sortable headers aria-sort="none" before any sort is applied', () => {
    const html = render([row()]);
    expect(html).toContain('data-sort-button="mention_change"');
    expect(html).toContain('data-sort-button="rank_change"');
    const noneMatches = html.match(/aria-sort="none"/g) ?? [];
    expect(noneMatches).toHaveLength(2);
    expect(html).not.toContain('aria-sort="other"');
  });
});
