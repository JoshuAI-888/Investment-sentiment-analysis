import type { AttentionDegradedReason, AttentionUnavailableReason } from './types';

/**
 * F08 §4.5 (F-05): "if there is no snapshot at all, the page states that attention data is
 * unavailable and directs the user to the parts of the product that still work (ticker pages,
 * news sentiment, price regime). It never renders an empty table with no explanation."
 *
 * **`reason` — round-10 lane-review finding 4.** `assembleAttentionLeaderboard` collapses two
 * causes into the same `state: 'unavailable'`: the ordinary cold start (no observation exists
 * anywhere) and a missing active `config_version` (an infrastructure fault, possibly over a
 * Postgres that already holds a populated corpus this read simply cannot render without one).
 * The two need different copy — "still warming up" is false, and actively misleading to an
 * operator, when the real cause is a configuration gap.
 *
 * **The onward list names only what exists today — round-19 lane-review finding 2.** F08 §4.5's
 * own spec text names three destinations ("ticker pages, news sentiment, price regime"), but two
 * of them are F09's, not built yet: `app/(app)/ticker/[symbol]/social/page.tsx` is still F01's
 * `RouteShell`, whose own copy says outright "It renders no data yet." Telling a reader those
 * "still work" when following the link finds a placeholder is the same false-coverage claim this
 * page exists to avoid making about attention data itself. Listing only the dashboard — genuinely
 * built, genuinely linked — until F09 ships is the honest version of this list; add the other two
 * back the day they render real data, not before.
 *
 * **`degradedMessage` — round-44 lane-review finding 2.** `reason === 'no_active_config_version'`
 * used to render the same static config-fault paragraph regardless of `degradedReason`, so a
 * config version superseded *during* a live ApeWisdom outage (round 28's own traced scenario —
 * `leaderboard.ts`'s `unavailableDegradedMessage`, pinned by an integration test) never told the
 * reader the second, independent fact. `leaderboard.ts` already composes the correct compound
 * sentence for exactly this case; this component renders it verbatim instead of re-deriving it,
 * so the two can never say something different about the same state.
 *
 * **Corrected — round-45 lane-review findings 1 and 3.** Round 44's own first attempt appended
 * "…that alone will not resolve this while the provider issue above also holds" — false in the
 * one state it fires: `pipeline.ts`'s early return on `activeConfig === null` means the collector
 * has not contacted ApeWisdom since, so `degradedReason` is frozen at whatever a run *before* the
 * config version was lost last wrote, with no TTL to expire it. The provider issue may have
 * resolved itself days ago; asserting it "also holds" and that activation "alone will not
 * resolve this" is an unfounded present-tense claim this component cannot back up, and it steers
 * an operator away from the one action that may in fact be the entire fix. The same appended
 * sentence also silently dropped the `provider_contract_changed` remedy the sibling branch below
 * gives for the identical `degradedReason` ("an operator likely needs to update the collector"),
 * making the two-fault state *less* actionable than either fault alone. Replaced with a sentence
 * that states only what is actually known — a config version is needed regardless, and a
 * `provider_contract_changed` collector update is needed regardless — without claiming anything
 * about whether the ApeWisdom-side fault is still ongoing.
 *
 * **The heading — round-46 lane-review finding 3, corrected by round-47 finding 2.** The bold
 * "Attention data is not available yet." rendered unconditionally, including for `reason ===
 * 'no_active_config_version'` — where it directly contradicts the paragraph immediately beneath
 * it ("not an ordinary cold start...an operator needs to activate one") and, whenever
 * `configVersionGapSymbols` is non-empty, the `ConfigVersionGapBanner` rendered directly above it,
 * which states outright that a recorded observation exists and could not be loaded. "Yet" is a
 * wait-it-out claim this state's own body copy was written specifically to rule out (round 10's
 * original finding).
 *
 * **Round 46's own fix keyed the heading on `reason` rather than on `needsOperatorAction` below —
 * round-47 finding 2.** That left the identical contradiction in place for `reason ===
 * 'never_collected'` combined with `degradedReason === 'provider_contract_changed'`: the body
 * paragraph already says "an operator likely needs to update the collector" (this is one of only
 * two states `needsOperatorAction` marks true, precisely because waiting will never help either
 * one), yet the heading still read "not available yet." Keying on `needsOperatorAction` itself —
 * the value that already decides every other honest/dishonest split on this component (the
 * "Until that's resolved" vs "While this accrues" line below) — makes the heading agree with it
 * by construction instead of re-deriving the same two-case split a second, divergent way.
 *
 * **`degradedReason` — round-25 lane-review finding 1, widened by round-26 finding 1.**
 * `state === 'unavailable'` means no observation exists anywhere, but that is compatible with a
 * collector that has run and is currently failing (`assembleAttentionLeaderboard` no longer
 * discards Redis's `degraded` bookkeeping just because zero rows exist). "The product is still
 * warming up" is a materially different — and false — claim from "the collector ran and hit a
 * problem": the first says nothing has happened yet, the second says something is actively wrong.
 *
 * Round 25 gave only `'provider_unreachable'` its own copy, on the theory that the other two
 * causes cannot fire with zero rows in practice. That theory was wrong for both: a 200 response
 * whose shape no longer matches the recorded schema (`'provider_contract_changed'`) is set on the
 * identical `!collected.ok` branch as `'provider_unreachable'` (`pipeline.ts`) and requires no
 * board entry to have been read at all, and a first-ever run whose board matched nothing
 * (`'no_new_data'`) persists nothing to Postgres by construction. Each of the three now gets its
 * own accurate copy, matching the same three-way distinction `leaderboard.ts`'s `degradedMessage`
 * already draws for the non-empty case — just phrased for "nothing has ever been recorded" rather
 * than "the rows below are the most recent successful observations."
 *
 * **The "While this accrues" line — round-27 lane-review finding 2, corrected by round-48 finding
 * 1.** Round 27's version asserted data is currently accumulating on its own — true for an
 * ordinary cold start and for the two causes the collector retries automatically
 * (`'provider_unreachable'`, `'no_new_data'`), but false for the two causes that need a human
 * before anything will ever accrue: `'no_active_config_version'` (the paragraph above it already
 * says "an operator needs to activate one") and `'provider_contract_changed'` ("an operator
 * likely needs to update the collector").
 *
 * **Round-48 finding 1: "retries automatically" and "accrues" were both false in this deployment,
 * not just for the two operator-action states.** `pipeline.ts`'s own doc comment states plainly
 * that nothing calls `runAttentionCollection` in production yet — the only caller anywhere is
 * `tests/integration/attention-pipeline.test.ts`, and `app/api/cron/dispatch/route.ts` is still
 * F01's fixture stub. There is no schedule for the collector to retry *on*, so `'It will keep
 * retrying on its own schedule.'` (removed from the `provider_unreachable` copy below) and
 * `'While this accrues'` both asserted an ongoing background process this deployment does not
 * have — the exact "plausible-looking empty state" D-16 exists to rule out, since a reader
 * concludes the correct action is to do nothing. What is actually known, and still worth
 * distinguishing, is only that these three causes do not *need* a human the way the other two do
 * — not that anything is happening without one. `'In the meantime'` states that distinction
 * without asserting progress.
 *
 * **Round-49 finding 2, left inconsistent by round 48's own fix.** The plain generic-cold-start
 * copy still said "the collector has not produced a reading, **or the product is still warming
 * up**" — the identical present-progressive claim round 48 removed from the footer line two
 * paragraphs below, for the identical reason: nothing collects in the background yet, so nothing
 * is "warming up" on its own. Removed the same way.
 *
 * **The heading — round-50 finding 1, completing rounds 47–49's own correction.** "Attention data
 * is not available **yet**" kept rendering for every `needsOperatorAction === false` state —
 * exactly the three states rounds 48/49 proved never self-resolve in this deployment, because
 * nothing calls `runAttentionCollection` in production at all (no dispatcher is wired — F16a).
 * "Yet" asserts the wait-it-out expectation those two rounds spent their entire fix removing from
 * the body and footer directly beneath it; leaving it in the one line that leads the component
 * undid the point of both fixes for a reader who reads no further than the heading. Since no
 * reason currently self-resolves without a human — deploying F16a, at minimum, regardless of
 * `needsOperatorAction` — there is no state left where "yet" is true. The heading is now the same
 * for all five; `needsOperatorAction` still distinguishes the footer ("Until that's resolved" vs
 * "In the meantime"), since some reasons need a specific action *beyond* that baseline gap
 * (activating a config version, updating the collector) and some do not.
 */
export type AttentionUnavailableProps = {
  readonly reason: AttentionUnavailableReason;
  readonly degradedReason?: AttentionDegradedReason | null;
  /**
   * Round-44 lane-review finding 2. Only consulted when `reason === 'no_active_config_version'`
   * and `degradedReason` is non-null — `leaderboard.ts`'s `unavailableDegradedMessage`, the one
   * place that already knows how to state both concurrent faults in one sentence.
   */
  readonly degradedMessage?: string | null;
};

export function AttentionUnavailable({ reason, degradedReason = null, degradedMessage = null }: AttentionUnavailableProps) {
  const needsOperatorAction = reason === 'no_active_config_version' || degradedReason === 'provider_contract_changed';
  return (
    <div className="rounded border border-neutral-200 bg-neutral-50 p-6 text-sm text-neutral-700" data-attention-unavailable="" data-unavailable-reason={reason}>
      <p className="font-semibold">Attention data cannot be shown.</p>
      {reason === 'no_active_config_version' ? (
        <p className="mt-1" data-degraded-reason={degradedReason ?? undefined}>
          {degradedReason === null || degradedMessage === null
            ? 'This is a configuration fault, not an ordinary cold start: there is no active config version to record a calculation against, which may be hiding attention data this deployment has already collected. An operator needs to activate one.'
            : `${degradedMessage} An operator needs to activate a config version${
                degradedReason === 'provider_contract_changed'
                  ? ", and the collector likely also needs an update for ApeWisdom's API"
                  : ''
              }.`}
        </p>
      ) : degradedReason === 'provider_unreachable' ? (
        <p className="mt-1" data-degraded-reason={degradedReason}>
          No observation from ApeWisdom has been recorded for any tracked security yet. This is not
          an ordinary cold start: the collector attempted a run and could not reach ApeWisdom.
        </p>
      ) : degradedReason === 'provider_contract_changed' ? (
        <p className="mt-1" data-degraded-reason={degradedReason}>
          No observation from ApeWisdom has been recorded for any tracked security yet. This is not
          an ordinary cold start: the collector attempted a run, but ApeWisdom's response no longer
          matched the expected shape — the provider may have changed its API. An operator likely
          needs to update the collector.
        </p>
      ) : degradedReason === 'no_new_data' ? (
        <p className="mt-1" data-degraded-reason={degradedReason}>
          No observation from ApeWisdom has been recorded for any tracked security yet. This is not
          an ordinary cold start: the collector attempted a run and reached ApeWisdom, but the board
          was empty, or every entry on it was malformed or matched no tracked security, so nothing
          could be recorded.
        </p>
      ) : (
        <p className="mt-1">
          No observation from ApeWisdom has been recorded for any tracked security yet. This is not
          an error in what you are looking at — no collection run has produced one.
        </p>
      )}
      <p className="mt-3" data-needs-operator-action={needsOperatorAction}>
        {needsOperatorAction
          ? "Until that's resolved, these parts of the product still work:"
          : 'In the meantime, these parts of the product still work:'}
      </p>
      <ul className="mt-2 list-disc pl-5">
        <li>
          <a className="underline decoration-dotted" href="/dashboard">
            The dashboard
          </a>{' '}
          — market and sector composites.
        </li>
      </ul>
    </div>
  );
}
