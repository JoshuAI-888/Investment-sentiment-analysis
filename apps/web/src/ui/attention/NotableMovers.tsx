/**
 * F08 §4.4 — the top three movers. "An evidence threshold applies before any narrative is
 * attached — in Wave 2 the card shows the metrics only; F11 later attaches the explanation."
 * No prose here, on purpose.
 */
import { InspectableMetric } from '../InspectableMetric';
import { rankChangeCaption, windowLabel } from './format';
import type { NotableMoverView } from './types';

export type NotableMoversProps = {
  readonly movers: readonly NotableMoverView[];
  /**
   * Round-10 lane-review finding 3. `selectNotableMovers` (round 9 finding 2) excludes a stale
   * row — correctly, since a security's stored `rank_change` eligibility can never be recomputed
   * back to `'stale'` for an unchanged observation, and without this exclusion a security that
   * fell off the board months ago could permanently lead this card. But the exclusion alone left
   * the empty-state copy misattributing the cause: with a stale board, every mover is excluded by
   * *this*, not by §4.4's stated bar (thin sample, an uncomputable rank change) — the generic
   * "no security clears the bar" message told a reader the wrong reason precisely in the one
   * state (a stopped-looking collector) D-16 cares most about disclosing accurately.
   *
   * **Not `state === 'stale'` — round-11 lane-review finding 1.** `pageState` checks `degraded`
   * before `collectionStale` and returns on the first match, so a provider outage that has lasted
   * past the staleness floor reads `state: 'degraded'`, never `'stale'`, even though every row is
   * by then individually stale too — an outage long enough to trigger this is the *more* likely
   * of the two doors, not an edge case. `excludedForStaleness` instead threads
   * `hasNotableMoverExcludedForStaleness`'s answer (`leaderboard.ts`) — computed from the exact
   * same per-row predicate `selectNotableMovers` filters on, so it can never drift from what
   * actually emptied (or shrank) this list, regardless of which page state fired.
   *
   * **The copy no longer says "every" — round-13 lane-review finding 3.** `hasNotableMoverExcludedForStaleness`
   * is an *any*, not an *all*: it is true the moment a single otherwise-eligible security is stale,
   * which under D-30's routine board churn (a name permanently off ApeWisdom's top 100 keeps a
   * permanently-stale last snapshot forever) is true indefinitely on an ordinary `state: 'ok'` page
   * with fresh rows sitting right beside it in the table. "Every observation on this board is
   * currently stale" was a second, opposite overclaim from the one round 10 fixed — this reader is
   * told the wrong thing about a *different* fact (all vs. false) using the same confident wording.
   *
   * **The copy no longer names "stale" as the only cause — round-22 lane-review finding 1.**
   * Round 21 widened the predicate this threads to also exclude a row that predates the collection
   * frontier (`observedAt < lastCollectedAt`) even when it is not yet six-hour `isStale` — under
   * any collection cadence shorter than that floor, a name that fell off the board an hour ago
   * satisfies the new branch while `AttentionTable`'s own cell for the identical security renders
   * `data-freshness="fresh"`. Asserting only "its observation is stale" is then a false claim
   * about a row the table on the same page calls fresh. Naming both causes the predicate now
   * covers — stale by the clock, or simply not carried into the most recent run — is true under
   * either one without the reader needing to know which fired.
   */
  readonly excludedForStaleness: boolean;
};

export function NotableMovers({ movers, excludedForStaleness }: NotableMoversProps) {
  if (movers.length === 0) {
    return (
      <p className="text-sm text-neutral-500" data-notable-movers-empty="">
        {excludedForStaleness
          ? 'No mover is shown: at least one otherwise-qualifying security was excluded because its observation is stale or not from this run.'
          : 'No security currently clears the notable-mover bar.'}
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-notable-movers="">
      {movers.map((mover) => (
        <div key={mover.securityId} className="rounded border border-neutral-200 p-3" data-notable-mover="" data-symbol={mover.symbol}>
          <p className="font-medium">
            {mover.symbol} <span className="font-normal text-neutral-500">{mover.companyName}</span>
          </p>
          <InspectableMetric
            metricId={mover.rankChange.metricId}
            calculationId={mover.rankChange.calculationId}
            label={mover.rankChange.label}
            display={mover.rankChange.display}
            unit={mover.rankChange.unit}
            roundingRule={mover.rankChange.roundingRule}
            eligibility={mover.rankChange.eligibility}
            reason={mover.rankChange.reason}
          />
          {/* Round-33 lane-review finding 1: `attention.rank_change`'s own `bounded_rank_delta`
              step clamps to the board size on the ordinary bootstrap path (an unbounded
              provider-reported `rank_24h_ago`), the same as the identical security's row in
              `AttentionTable.tsx` — this card renders the same disclosure. */}
          {mover.rankChange.isClamped ? (
            <p className="text-xs text-amber-700" data-rank-change-clamped="">
              Clamped: the measured move exceeds the board size, so this reflects the largest move
              the board can represent, not the true distance moved.
            </p>
          ) : null}
          {/* Round-33 lane-review finding 2: without a source and a window, this card ranked Δ
              Rank values computed over unlike spans and unlike sources as one undifferentiated
              list — the identical security's row in `AttentionTable.tsx` already discloses both.

              Round-42 lane-review finding 2: `rankChangeCaption` now also layers the depth-14
              warm-up qualifier `AttentionTable.tsx` already gave the same security's row — a
              two-observation `own_history` delta used to caption identically to a matured one on
              this card, the one surface that ranks deltas against each other by raw magnitude. */}
          <p className="mt-0.5 text-xs text-neutral-500" data-rank-change-source={mover.rankChangeSource}>
            {rankChangeCaption(mover.rankChangeSource, mover.isWarmingUp)}
          </p>
          <p className="text-xs text-neutral-500">
            {windowLabel(mover.observationWindowHours, 'comparison window (Δ Rank / Δ Mentions)')}
          </p>
          {mover.mentionDelta === null ? null : (
            <InspectableMetric
              metricId={mover.mentionDelta.metricId}
              calculationId={mover.mentionDelta.calculationId}
              label={mover.mentionDelta.label}
              display={mover.mentionDelta.display}
              unit={mover.mentionDelta.unit}
              roundingRule={mover.mentionDelta.roundingRule}
              eligibility={mover.mentionDelta.eligibility}
              reason={mover.mentionDelta.reason}
            />
          )}
        </div>
      ))}
    </div>
  );
}
