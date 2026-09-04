/**
 * The rendered-metric manifest — the other half of `check:calc-coverage` (F01 §4.4, F05 §4.8).
 *
 * `scripts/checks/load.ts` imports this file by path and has done since F01. The check fails a
 * metric whose `methodId` is `null` or names a method that is not in `analytics/registry.ts` —
 * which is the executable form of *"a number rendered without `InspectableMetric` fails
 * `check:calc-coverage`"*.
 *
 * ── What belongs here, and what does not ────────────────────────────────────────────────────
 *
 * A **product surface** that renders a specific metric — the dashboard, the leaderboard, a
 * ticker detail chart — lists it here, once, with the method that produces it. Those surfaces
 * are Wave 2 (F07–F09), so this list starts empty of them.
 *
 * The **Inspector** does not appear here, and the reason is not an exemption. It renders
 * whichever method the artifact it was handed names, so there is no static pair to declare; what
 * makes it safe is upstream — an artifact cannot exist without a registered method, because
 * `services/calculations.ts` refuses to bind a descriptor with no arithmetic and refuses
 * arithmetic with no descriptor. A metric id it could render but that is not registered is not
 * reachable.
 *
 * Adding an entry here with `methodId: null` is how a surface declares, deliberately and
 * visibly, that it renders a number from nowhere. The check then fails, which is the point.
 */

export type RenderedMetric = {
  readonly id: string;
  /** The registered method that produces it. `null` fails the check, by design. */
  readonly methodId: string | null;
  readonly renderedIn: string;
};

export const metrics: readonly RenderedMetric[] = [
  // F07 — the dashboard (`app/(app)/dashboard`). The market composite card and its component
  // breakdown, plus each of the 11 sector proxy tiles' two metrics.
  { id: 'dashboard.market_composite', methodId: 'market.composite', renderedIn: 'app/(app)/dashboard' },
  { id: 'dashboard.market_composite.news_sentiment', methodId: 'news.sentiment', renderedIn: 'app/(app)/dashboard' },
  { id: 'dashboard.market_composite.price_regime', methodId: 'price.regime', renderedIn: 'app/(app)/dashboard' },
  {
    id: 'dashboard.market_composite.sector_breadth_score',
    methodId: 'market.sector_breadth',
    renderedIn: 'app/(app)/dashboard',
  },
  { id: 'dashboard.sector_tile.news_sentiment', methodId: 'news.sentiment', renderedIn: 'app/(app)/dashboard' },
  { id: 'dashboard.sector_tile.price_regime', methodId: 'price.regime', renderedIn: 'app/(app)/dashboard' },

  // F09 — the ticker detail page (`app/(app)/ticker/[symbol]/social`). Every computed axis
  // metric, including `market.divergence_state`; raw stored facts (header price, mentions,
  // rank) are deliberately not listed here — no registered method backs them, so
  // `InspectableMetric` cannot honestly wrap them.
  //
  // `price_return_snapshot.total_return` is a *different* case, not this one — round-1
  // lane-review finding 3 corrected an earlier version of this comment that lumped it in with
  // the raw facts above. It is this deployment's own computed figure (its own `methodVersion`/
  // `adjustmentStatus`/`baselinePriceDate`), not a vendor print — it is simply missing a
  // registered `analytics/registry.ts` method to back it, which only SPINE may add
  // (`02-ARCHITECTURE-CONTRACTS.md` §3). See `ui/ticker/PriceAxisPanel.tsx`'s own doc comment and
  // this feature's CONTRACTS report for the cross-lane dependency; adding an entry here with
  // `methodId: null` would fail `check:calc-coverage` for a gap this lane cannot close alone.
  //
  // Naming 'market.divergence_state' below is what makes `check:copy`'s `/divergence/i` scan
  // treat this data manifest as "renders a divergence state", the same as an actual page — the
  // check does not distinguish the two, so the exact text has to appear here too, verbatim, on
  // one line: "This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast."
  { id: 'ticker.attention.mention_delta', methodId: 'attention.mention_delta', renderedIn: 'app/(app)/ticker/[symbol]/social' },
  { id: 'ticker.attention.rank_change', methodId: 'attention.rank_change', renderedIn: 'app/(app)/ticker/[symbol]/social' },
  { id: 'ticker.stance.reddit', methodId: 'social.stance_reddit', renderedIn: 'app/(app)/ticker/[symbol]/social' },
  { id: 'ticker.stance.x', methodId: 'social.stance_x', renderedIn: 'app/(app)/ticker/[symbol]/social' },
  { id: 'ticker.stance.substack', methodId: 'social.stance_substack', renderedIn: 'app/(app)/ticker/[symbol]/social' },
  { id: 'ticker.news', methodId: 'news.sentiment', renderedIn: 'app/(app)/ticker/[symbol]/social' },
  { id: 'ticker.price.regime', methodId: 'price.regime', renderedIn: 'app/(app)/ticker/[symbol]/social' },
  { id: 'ticker.price.volatility_20', methodId: 'price.volatility_20', renderedIn: 'app/(app)/ticker/[symbol]/social' },
  { id: 'ticker.price.rsi_14', methodId: 'technical.rsi_14', renderedIn: 'app/(app)/ticker/[symbol]/social' },
  { id: 'ticker.price.moving_average_20', methodId: 'technical.moving_average_20', renderedIn: 'app/(app)/ticker/[symbol]/social' },
  { id: 'ticker.price.moving_average_50', methodId: 'technical.moving_average_50', renderedIn: 'app/(app)/ticker/[symbol]/social' },
  { id: 'ticker.divergence_state', methodId: 'market.divergence_state', renderedIn: 'app/(app)/ticker/[symbol]/social' },

  // F08 — the attention leaderboard (`app/(app)/social/reddit`, `ui/attention/AttentionTable.tsx`
  // and `ui/attention/NotableMovers.tsx`). Five entries name a method that genuinely computes the
  // cell's own headline result. Three more (`mentions_now`, `rank_now`, `engagement_now`) are raw
  // observed facts, not computed results — `leaderboard.ts#toRawMetricView`'s own doc comment
  // records the judgment call restated here because this is the file that is supposed to state
  // it: each carries whichever artifact actually declared it as a frozen input, not a method of
  // its own, since none of the three was itself computed.
  //
  // **`mentions_now`/`rank_now` carry `attention.rank_change`'s id** (`rankChangeInputs` in
  // `services/attention/inputs.ts` declares both). **`engagement_now` carries
  // `attention.engagement_per_mention`'s id, unconditionally** (`engagementPerMentionInputs`
  // declares it) — **lane-review round 5 finding 3**, correcting an earlier version of this file
  // that named `rank_change` for all three. Round 7 finding 2 then removed the one case that used
  // to make this an "in the normal case" hedge: `leaderboard.ts#buildRow`'s
  // `engagementSource = engagementArtifact ?? rankChangeArtifact` fallback (round-8 finding 4
  // caught this comment still describing it as live behaviour, three rounds after removal) — a
  // missing or stale `engagement_per_mention` Redis pointer now forces full-row recovery before
  // this cell is ever built, so `engagementArtifact` is guaranteed non-null here and the id is
  // always `attention.engagement_per_mention`'s own. `check:calc-coverage` only verifies a
  // registered method exists for each id, not which artifact a read-time branch might pick, so
  // this manifest is still the file responsible for stating the claim precisely. Opening "How
  // this was calculated" on any of the three therefore opens whichever Inspector actually carries
  // the figure, not a gap check:calc-coverage should ever be asked to paper over with a separate,
  // fabricated method for a value that was never computed at all (lane-review round 2 finding 2:
  // this feature rendered thirteen metric cells across the two components above and registered
  // none of them, leaving the check inert for this surface).
  { id: 'attention.mentions_now', methodId: 'attention.rank_change', renderedIn: 'ui/attention/AttentionTable.tsx' },
  { id: 'attention.rank_now', methodId: 'attention.rank_change', renderedIn: 'ui/attention/AttentionTable.tsx' },
  {
    id: 'attention.engagement_now',
    methodId: 'attention.engagement_per_mention',
    renderedIn: 'ui/attention/AttentionTable.tsx',
  },
  {
    id: 'attention.rank_change',
    methodId: 'attention.rank_change',
    renderedIn: 'ui/attention/AttentionTable.tsx, ui/attention/NotableMovers.tsx',
  },
  {
    id: 'attention.mention_delta',
    methodId: 'attention.mention_delta',
    renderedIn: 'ui/attention/AttentionTable.tsx, ui/attention/NotableMovers.tsx',
  },
  {
    id: 'attention.mention_growth',
    methodId: 'attention.mention_growth',
    renderedIn: 'ui/attention/AttentionTable.tsx',
  },
  {
    id: 'attention.mentions_zscore',
    methodId: 'attention.mentions_zscore',
    renderedIn: 'ui/attention/AttentionTable.tsx',
  },
];
