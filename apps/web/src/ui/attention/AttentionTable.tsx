'use client';

/**
 * F08 §4.3 — the leaderboard table. Attention and price are separate axes (source §3): this
 * table carries no price column today (see this feature's build report under `DEFERRED`).
 *
 * **Corrected — round-44 lane-review finding 3.** This comment previously said "no
 * `market_snapshot` repository read exists yet," which stopped being true when
 * `src/repositories/market.ts` (`marketSnapshotHistory`/`latestMarketSnapshot`, both storage-only,
 * no live provider call) merged onto this branch from `main` before round 2. The actual blocker is
 * that nothing calls `insertMarketSnapshot` anywhere in the app yet — F04's remaining market-data
 * collection wiring, a different feature in the COLLECT lane, not a SURFACE read-path gap. What
 * this table never does, with or without a price column, is blend attention and price into one
 * number.
 */
import { useMemo, useState } from 'react';
import { CoverageLabel } from '../CoverageLabel';
import { FreshnessBadge } from '../FreshnessBadge';
import { InspectableMetric } from '../InspectableMetric';
import { rankChangeCaption, windowLabel } from './format';
import type { AttentionDegradedReason, AttentionRowView } from './types';

/**
 * Lane-review finding 1: the caption always matches which fields actually fed `Δ Rank`
 * (`row.rankChangeSource`) — depth only ever adds a confidence qualifier on top of
 * `'own_history'`, it never relabels a locally-computed number as the provider's.
 *
 * **Built on the shared `rankChangeCaption` — round-42 lane-review finding 2, correcting round
 * 33's own split.** The warm-up layering used to happen only here, on the theory that
 * `NotableMoverView` "does not need" `historyDepth` — but `NotableMovers`'s card needed the
 * identical qualifier just as much, and round 42 moved the layering into the shared helper so
 * both surfaces stay in sync.
 */
function rankChangeSourceLabel(row: AttentionRowView): string {
  const warmingUp = row.historyDepth.comparableSnapshots < row.historyDepth.requiredForZscore;
  return rankChangeCaption(row.rankChangeSource, warmingUp);
}

export type AttentionTableProps = {
  readonly rows: readonly AttentionRowView[];
  /**
   * `leaderboard.degradedReason` — round-17 lane-review finding 1, corrected by round-21 finding
   * 1. `row.isStale` is a wall-clock fact about one security's own observation, entirely
   * independent of whether any refresh attempt failed: under D-30 the universe is 100 fixed names
   * and `match.ts` only snapshots a name while it is on ApeWisdom's current top-100 page, so a
   * name dropping off the board — routine churn, not an outage — ages past the staleness floor on
   * an otherwise perfectly healthy, current-minute collection. Passed down so the per-row badge
   * can tell "the collector is failing" from "this one reading is old, and the collector may be
   * fine" — see below.
   *
   * **Not the raw `degraded` boolean — round-21 lane-review finding 1.** `degraded` is `true` for
   * three distinct causes (`leaderboard.ts`): a genuine fetch failure, a 200 response with nothing
   * usable (`'no_new_data'`), and a 200 response whose shape no longer matched the schema
   * (`'provider_contract_changed'`). Round 13 already fixed this exact conflation at the page
   * level (`DegradedPanel` gated on `degradedReason`, not `degraded`) after finding the shared
   * panel's "a provider is currently unavailable" claim rendered for causes where it was false;
   * round 17 then reintroduced the identical conflation one component down by wiring the
   * undifferentiated boolean into this table's own "refresh failed" wording. Only
   * `'provider_unreachable'` means a refresh attempt did not complete — the other two causes
   * reached the provider and got an answer, so a frontier row stale under either of them takes the
   * same neutral "no newer collection run has completed" wording as an ordinary collection gap.
   */
  readonly degradedReason: AttentionDegradedReason | null;
  /**
   * `leaderboard.lastCollectedAt` — round-19 lane-review finding 1, correcting round 18's own
   * fix. Round 18 keyed the per-row copy on page-level facts alone (`degraded`/`collectionStale`),
   * but every one of a poll's matched securities shares the identical `observedAt`
   * (`collector.ts`'s single `options.now` stamped across the whole board fetch) — so a row's own
   * `observedAt` equalling `lastCollectedAt` is exactly "this reading is the most recent
   * collection attempt actually recorded," and a row *older* than `lastCollectedAt` is exactly
   * "at least one later run completed without this security" — independent of whatever the
   * *current* run's status is. Round 18's page-level-only branching told a security that fell off
   * the board three days before an outage that even started today either "no newer collection run
   * has completed since" (false — 99 other rows on the same page prove one did, hours ago) or, if
   * that outage happened to also be flagged `degraded`, "refresh failed" (also false — this row
   * would be exactly as old whether or not today's run succeeded). Comparing against this field is
   * what actually answers "is this row's own staleness explained by the collection's current
   * state, or did it go stale independently of it" — the question the two prior rounds each
   * approximated with a page-level proxy instead of asking directly.
   */
  readonly lastCollectedAt: Date | null;
  /**
   * `APEWISDOM_WINDOW_HOURS` — round-29 lane-review finding 1. Mentions and Upvotes are
   * ApeWisdom's own fixed rolling aggregates over this span (`collector.ts`'s own constant), an
   * entirely different number from `row.observationWindowHours` (this row's local Δ Rank/Δ
   * Mentions comparison span, which grows unbounded across D-30 board churn). Disclosed once, in
   * the column headers, rather than duplicated on every row — the value is the same for every
   * row today (a page-level provider constant, not a per-row fact) — so a reader cannot
   * conflate the two spans just because they sit in the same table.
   */
  readonly providerWindowHours: number;
};

type SortKey = 'rank_change' | 'mention_change';

/**
 * Round-30 lane-review finding 1. Sorts by **absolute** magnitude, matching `NotableMovers`'s own
 * ranking (`selectNotableMovers`) — a security that fell 40 places belongs beside one that rose
 * 40, both above one that moved 3, on the page whose stated job (§1, J1) is "which stocks are
 * gaining retail attention fastest." A signed sort would put every fall at the bottom regardless
 * of size. Unlike `NotableMovers`, which captions this honestly ("the three largest moves"), the
 * button here carried no equivalent label — a reader clicking "Δ Rank" with no other cue could
 * reasonably expect an ascending/descending numeric sort and be surprised a large negative move
 * sorts near the top. The per-header "largest move, either direction" caption (always visible,
 * not only while active — the ambiguity exists whether or not this sort is currently applied)
 * and `aria-sort="other"` (never `"ascending"`/`"descending"`, since this is not that) now state
 * the actual semantics rather than leaving them to be inferred from behaviour.
 */
function sortValue(row: AttentionRowView, key: SortKey): number {
  const view = key === 'rank_change' ? row.rankChange : row.mentionDelta;
  if (view === null || view.display === null) return Number.NEGATIVE_INFINITY;
  return Math.abs(Number(view.display));
}

export function AttentionTable({ rows, degradedReason, lastCollectedAt, providerWindowHours }: AttentionTableProps) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);

  const sorted = useMemo(() => {
    if (sortKey === null) return rows;
    return [...rows].sort((a, b) => sortValue(b, sortKey) - sortValue(a, sortKey));
  }, [rows, sortKey]);

  return (
    <table className="w-full text-sm" data-attention-table="">
      <thead>
        <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
          <th className="py-2 pr-3">Symbol</th>
          <th className="py-2 pr-3">Company</th>
          <th className="py-2 pr-3" data-provider-window={providerWindowHours}>
            Mentions
            <span className="block text-[10px] font-normal normal-case text-neutral-600">
              {windowLabel(providerWindowHours, 'window, ApeWisdom')}
            </span>
          </th>
          <th className="py-2 pr-3" aria-sort={sortKey === 'mention_change' ? 'other' : 'none'}>
            <button
              type="button"
              data-sort-button="mention_change"
              data-sort-active={sortKey === 'mention_change'}
              aria-pressed={sortKey === 'mention_change'}
              onClick={() => setSortKey('mention_change')}
              className="underline decoration-dotted"
            >
              Δ Mentions{sortKey === 'mention_change' ? ' ▾' : ''}
            </button>
            <span className="block text-[10px] font-normal normal-case text-neutral-600">
              largest move, either direction
            </span>
          </th>
          <th className="py-2 pr-3">
            Upvotes
            <span className="block text-[10px] font-normal normal-case text-neutral-600">
              {windowLabel(providerWindowHours, 'window, ApeWisdom')}
            </span>
          </th>
          <th className="py-2 pr-3">Rank</th>
          <th className="py-2 pr-3" aria-sort={sortKey === 'rank_change' ? 'other' : 'none'}>
            <button
              type="button"
              data-sort-button="rank_change"
              data-sort-active={sortKey === 'rank_change'}
              aria-pressed={sortKey === 'rank_change'}
              onClick={() => setSortKey('rank_change')}
              className="underline decoration-dotted"
            >
              Δ Rank{sortKey === 'rank_change' ? ' ▾' : ''}
            </button>
            <span className="block text-[10px] font-normal normal-case text-neutral-600">
              largest move, either direction
            </span>
          </th>
          <th className="py-2 pr-3">Anomaly</th>
          <th className="py-2 pr-3">Observed</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((row) => (
          <tr
            key={row.securityId}
            className="border-b border-neutral-100 align-top"
            data-attention-row=""
            data-symbol={row.symbol}
            data-thin-sample={row.isThinSample}
            data-new={row.isNew}
            data-dropped={row.isDroppedFromBoard}
            data-methodology-boundary={row.isMethodologyBoundary}
          >
            <td className="py-2 pr-3 font-medium">{row.symbol}</td>
            <td className="py-2 pr-3">{row.companyName}</td>
            <td className="py-2 pr-3">
              <InspectableMetric
                metricId={row.mentions.metricId}
                calculationId={row.mentions.calculationId}
                label={row.mentions.label}
                display={row.mentions.display}
                unit={row.mentions.unit}
                roundingRule={row.mentions.roundingRule}
                eligibility={row.mentions.eligibility}
                reason={row.mentions.reason}
              />
            </td>
            <td className="py-2 pr-3">
              {row.isNew ? (
                <span data-new-badge="" className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">
                  New
                </span>
              ) : row.mentionDelta === null ? (
                <span className="text-xs text-neutral-500">not available</span>
              ) : (
                <InspectableMetric
                  metricId={row.mentionDelta.metricId}
                  calculationId={row.mentionDelta.calculationId}
                  label={row.mentionDelta.label}
                  display={row.mentionDelta.display}
                  unit={row.mentionDelta.unit}
                  roundingRule={row.mentionDelta.roundingRule}
                  eligibility={row.mentionDelta.eligibility}
                  reason={row.mentionDelta.reason}
                />
              )}
              {row.isThinSample ? (
                <span data-thin-sample-badge="" className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                  Thin sample
                </span>
              ) : null}
              {/* F08 §4.4's minimum-base rule ("prior mentions < 5 ⇒ absolute delta only") is a
                  choice between two numbers — rendering growth here is what gives that rule
                  something to be correct about (lane-review finding 7). `InspectableMetric`
                  itself renders the suppression honestly when `mentionGrowth`'s own eligibility
                  is not `ok` (the exact case the minimum-base rule produces). */}
              {row.mentionGrowth === null ? null : (
                <InspectableMetric
                  metricId={row.mentionGrowth.metricId}
                  calculationId={row.mentionGrowth.calculationId}
                  label={row.mentionGrowth.label}
                  display={row.mentionGrowth.display}
                  unit={row.mentionGrowth.unit}
                  roundingRule={row.mentionGrowth.roundingRule}
                  eligibility={row.mentionGrowth.eligibility}
                  reason={row.mentionGrowth.reason}
                />
              )}
            </td>
            <td className="py-2 pr-3">
              <InspectableMetric
                metricId={row.upvotes.metricId}
                calculationId={row.upvotes.calculationId}
                label={row.upvotes.label}
                display={row.upvotes.display}
                unit={row.upvotes.unit}
                roundingRule={row.upvotes.roundingRule}
                eligibility={row.upvotes.eligibility}
                reason={row.upvotes.reason}
              />
            </td>
            <td className="py-2 pr-3">
              <InspectableMetric
                metricId={row.rank.metricId}
                calculationId={row.rank.calculationId}
                label={row.rank.label}
                display={row.rank.display}
                unit={row.rank.unit}
                roundingRule={row.rank.roundingRule}
                eligibility={row.rank.eligibility}
                reason={row.rank.reason}
              />
            </td>
            <td className="py-2 pr-3">
              <InspectableMetric
                metricId={row.rankChange.metricId}
                calculationId={row.rankChange.calculationId}
                label={row.rankChange.label}
                display={row.rankChange.display}
                unit={row.rankChange.unit}
                roundingRule={row.rankChange.roundingRule}
                eligibility={row.rankChange.eligibility}
                reason={row.rankChange.reason}
              />
              <p className="mt-0.5 text-xs text-neutral-500" data-rank-change-source={row.rankChangeSource}>
                {rankChangeSourceLabel(row)}
              </p>
              {/* Round-33 lane-review finding 1. `attention.rank_change`'s own `bounded_rank_delta`
                  step (`calc/methods/attention-rank-change-v1_1.ts`) clamps to the board size
                  whenever a measured move exceeds it — reachable on the ordinary bootstrap path,
                  where `rank_prior` is ApeWisdom's own unbounded `rank_24h_ago` rather than a
                  locally-tracked predecessor. Before this, only the z-score's own clamp (above)
                  was disclosed here; a clamped Δ Rank rendered as a plain, unmarked number a
                  100-name board can never legitimately produce (e.g. exactly "100 ranks" for a
                  move of 805) — the identical "visible in the trace, invisible on the surface"
                  gap round 29 closed for the z-score, one column over. */}
              {row.rankChange.isClamped ? (
                <p className="text-xs text-amber-700" data-rank-change-clamped="">
                  Clamped: the measured move exceeds the board size, so this reflects the largest
                  move the board can represent, not the true distance moved.
                </p>
              ) : null}
            </td>
            <td className="py-2 pr-3">
              {row.historyDepth.comparableSnapshots < row.historyDepth.requiredForZscore ? (
                <span data-zscore-warming-up="" className="text-xs text-neutral-500">
                  warming up ({row.historyDepth.comparableSnapshots}/{row.historyDepth.requiredForZscore})
                </span>
              ) : row.mentionsZscore === null ? (
                <span className="text-xs text-neutral-500">not available</span>
              ) : (
                <>
                  <InspectableMetric
                    metricId={row.mentionsZscore.metricId}
                    calculationId={row.mentionsZscore.calculationId}
                    label={row.mentionsZscore.label}
                    display={row.mentionsZscore.display}
                    unit={row.mentionsZscore.unit}
                    roundingRule={row.mentionsZscore.roundingRule}
                    eligibility={row.mentionsZscore.eligibility}
                    reason={row.mentionsZscore.reason}
                  />
                  {/* Round-29 lane-review finding 2. `attention.mentions_zscore`'s own denominator
                      is floored at `epsilon` whenever at least half the comparison window shares
                      the median (routine for a low-mention security's tail,
                      `calc/methods/attention-mentions-zscore.ts`'s `scaled_mad` step) — a value
                      built on that floor renders as a plain, `eligibility: 'ok'` number
                      indistinguishable from one computed off a genuine spread, which is exactly
                      how a division-guard artifact reads as a real anomaly of tens of thousands
                      of sigma. `isClamped` (`leaderboard.ts#toMetricView`) reads the artifact's
                      own step status rather than re-deriving the epsilon check here. */}
                  {row.mentionsZscore.isClamped ? (
                    <p className="text-xs text-amber-700" data-zscore-clamped="">
                      Floored: recent mentions are too uniform to estimate a real spread, so this
                      number reflects the floor, not a genuine anomaly magnitude.
                    </p>
                  ) : null}
                  {/* §6.1: every aggregate renders its source, n and window — not only while it is
                      hidden below the depth-14 floor (lane-review round 3 finding 4: an earlier
                      version showed "warming up (n/14)" below the floor but rendered the bare
                      z-score value with no visible n once it appeared, which is exactly when a
                      reader most needs to know how much history it is computed over).
                      `CoverageLabel` is the shared component F07 already built for this.

                      Round-25 lane-review finding 2: this used to pass `window={null}` on the
                      theory that "no time window applies to a depth-gated count" — but the window
                      is real and derivable (`row.mentionsZscoreWindowHours`,
                      `leaderboard.ts#deriveZscoreWindowHours`), and rendering `null` here made the
                      identical `n=30` label mean either "a month" (today's daily-ish cadence) or
                      "2.5 hours" (F16a's future 5-minute one) with no way for a reader to tell
                      which. `windowLabel` is the same helper the Observed cell already uses. */}
                  <CoverageLabel
                    source="apewisdom"
                    n={row.historyDepth.comparableSnapshots}
                    window={
                      row.mentionsZscoreWindowHours === null
                        ? null
                        : windowLabel(row.mentionsZscoreWindowHours, 'observation window')
                    }
                  />
                </>
              )}
            </td>
            <td
              className="py-2 pr-3"
              data-observation-window={windowLabel(row.observationWindowHours, 'comparison window')}
            >
              {/* `row.isStale` is derived at read time from the real clock (lane-review finding
                  5) — it is deliberately independent of `rankChange.eligibility`, which a
                  persisted artifact can never update once its inputs stop changing.

                  Round-17 lane-review finding 1: the shared `FreshnessBadge`'s stale copy says
                  "refresh failed" — accurate for F07, where `stale` only ever reflects a refresh
                  attempt that genuinely did not complete in time. Here, `row.isStale`/`eligibility
                  === 'stale'` fire just as often for a name that simply fell off ApeWisdom's
                  tracked top-100 (D-30's routine churn) while the collector ran fine for every
                  other security — a false "refresh failed" on the one page whose own §4.2
                  purpose is honest framing.

                  Round-18 lane-review finding 1, correcting round 17's own fix, then round-19
                  finding 1, correcting round 18's own fix in turn: neither `degraded` nor
                  `collectionStale` (a page-level fact) can tell "this row's staleness is explained
                  by the collection's current state" from "this row went stale independently of it,
                  before the current run even started" — a security that fell off the board three
                  days ago is exactly as stale whether today's run just succeeded, is degraded, or
                  hasn't run in six hours, and page-level branching told it all three of those
                  things at different rounds, each one false. `atCollectionFrontier` asks the
                  question directly: every security a poll actually matches shares the identical
                  `observedAt` (`collector.ts`'s one `options.now` for the whole board fetch), so a
                  row whose `observedAt` equals `lastCollectedAt` *is* the most recent collection
                  attempt on record, and one older than it means a later run already completed
                  without this security. Only a frontier row's staleness is a fact about the
                  collection's own current state; every other stale row's is a fact about the
                  security alone, regardless of what the collector is doing right now.

                  Round-20 lane-review finding 1, correcting round 19's own fix: the comparison was
                  exact equality, so a row *newer* than `lastCollectedAt` fell into the same "a
                  later run already excluded it" branch as a genuinely churned (older) row — both
                  false, and reachable whenever `leaderboard.ts`'s own `lastCollectedAt` derivation
                  (Redis's bookkeeping key, preferred unconditionally over Postgres's own
                  `latestObservedAt`) falls behind Postgres: an interruption between
                  `pipeline.ts`'s snapshot writes and its later `redis.set(KEYS.lastCollectedAt())`
                  call, or — per `services/dashboard/redis.ts`'s own documented limit — a
                  serverless instance whose in-memory Redis fallback never saw the run that another
                  instance's Postgres write already reflects. `&gt;=` is what "at or beyond the
                  recorded frontier" actually requires: a row cannot have been passed over by a
                  later run that is, at best, exactly as new as it is.

                  Round-21 lane-review finding 1: `degraded` (used here previously) is `true` for
                  three distinct causes, and only `'provider_unreachable'` means a refresh attempt
                  did not complete — the other two (`'no_new_data'`, `'provider_contract_changed'`)
                  reached the provider and got an answer, so a frontier row stale under either one
                  is not a "refresh failed" case (round 13 fixed the identical conflation for the
                  shared `DegradedPanel`; this was the same mistake one component down).
                  `data-freshness="stale"` is kept on every stale branch so nothing that reads that
                  attribute needs to know which copy fired.

                  Round-33 lane-review finding 3: a row that predates the frontier used to be told
                  only one cause ("may simply no longer be on ApeWisdom's tracked board") — false
                  whenever `row.wasMalformedLastRun` is the real cause, since the security is still
                  on the board and still sending data the last run simply could not parse
                  (`pipeline.ts`'s `KEYS.malformedTickers()`). That is not routine D-30 churn, and
                  telling a reader it might be routes them away from a live data-quality bug.

                  **`wasMalformedLastRun` is checked outside this cell's `isStale` gate, not
                  nested only inside the churned branch — round-39 lane-review finding 1,
                  correcting rounds 34/35's own placement, itself corrected by round 40 (rounds 34/
                  35/39 each got one half of this right and the other half wrong).** `pipeline.ts`
                  never flags a ticker this exact run wrote (round 35 finding 1's own fix), so a
                  malformed flag always describes a security whose `observedAt` predates the run
                  that set it — but *how much* it predates it is read-time-dependent: a read taken
                  minutes after the malformed run can still be well inside the six-hour staleness
                  floor (`isStale: false`), while a read taken hours later is genuinely stale. Round
                  39 collapsed both into one `isStale`-independent branch with one wording, which
                  got the *fresh* case's reachability right but then (a) dated a same-run-or-later
                  parse failure to a possibly days-old `observedAt` with no "this reading is older
                  than its refresh window" clause even when it demonstrably is, and (b) hardcoded
                  `data-freshness="stale"` for a row that is not stale by either measure —
                  `NotableMovers.tsx`'s own doc for its empty-state copy relies on exactly this
                  attribute reading `"fresh"` for a fresh, non-frontier row. Split back into two
                  branches below: the stale one keeps the "older than its refresh window" clause
                  and `data-freshness="stale"` (restoring rounds 34/35's own, correct wording for
                  that case); the fresh one is new, states the same underlying fact without falsely
                  implying the reading itself is overdue, and carries `data-freshness="fresh"`. */}
              {(row.isStale || row.rankChange.eligibility === 'stale') ? (
                row.wasMalformedLastRun ? (
                  <p className="text-xs text-amber-700" data-freshness="stale" data-malformed-last-run="">
                    As of {row.observedAt.toISOString()}, this reading is older than its refresh
                    window — the most recent successful collection run received data for this
                    security that could not be parsed, so no new observation was recorded. It has
                    not necessarily left ApeWisdom&rsquo;s tracked board.
                  </p>
                ) : lastCollectedAt !== null && row.observedAt.getTime() >= lastCollectedAt.getTime() ? (
                  degradedReason === 'provider_unreachable' ? (
                    <FreshnessBadge observedAt={row.observedAt} stale={true} />
                  ) : (
                    <p className="text-xs text-amber-700" data-freshness="stale">
                      As of {row.observedAt.toISOString()}, this reading is older than its refresh
                      window — no newer collection run has completed since.
                    </p>
                  )
                ) : (
                  <p className="text-xs text-amber-700" data-freshness="stale">
                    As of {row.observedAt.toISOString()}, this reading is older than its refresh
                    window — a later collection run has completed without this security, which may
                    simply no longer be on ApeWisdom&rsquo;s tracked board.
                  </p>
                )
              ) : row.wasMalformedLastRun ? (
                <p className="text-xs text-amber-700" data-freshness="fresh" data-malformed-last-run="">
                  Observed {row.observedAt.toISOString()} — still within its refresh window. The
                  most recent successful collection run separately received data for this security
                  that could not be parsed, so this reading has not been updated since. It has not
                  necessarily left ApeWisdom&rsquo;s tracked board.
                </p>
              ) : (
                <FreshnessBadge observedAt={row.observedAt} stale={false} />
              )}
              <p className="text-xs text-neutral-500">
                {windowLabel(row.observationWindowHours, 'comparison window (Δ Rank / Δ Mentions)')}
              </p>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
