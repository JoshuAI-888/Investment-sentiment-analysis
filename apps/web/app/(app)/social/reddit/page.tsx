import { redirect } from 'next/navigation';
import { requireUser, UnauthenticatedError, PasswordChangeRequiredError } from '@/services/auth';
import { APEWISDOM_WINDOW_HOURS } from '@/services/attention/collector';
import { assembleAttentionLeaderboard } from '@/services/attention/leaderboard';
import { DegradedPanel } from '@/ui/DegradedPanel';
import { AttentionTable } from '@/ui/attention/AttentionTable';
import { AttentionUnavailable } from '@/ui/attention/AttentionUnavailable';
import { ConfigVersionGapBanner } from '@/ui/attention/ConfigVersionGapBanner';
import { MethodologyBanner } from '@/ui/attention/MethodologyBanner';
import { NotableMovers } from '@/ui/attention/NotableMovers';

/**
 * F08 — the attention leaderboard, replacing F01's fixture shell.
 *
 * `requireUser()`, matching F07's `/dashboard`: a member+ surface, not admin-only, checked in
 * this page's own body per F02 §4.4's non-negotiable.
 */
export default async function Page() {
  try {
    await requireUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect('/sign-in');
    if (error instanceof PasswordChangeRequiredError) redirect('/change-password');
    throw error;
  }

  const leaderboard = await assembleAttentionLeaderboard();

  return (
    <main data-route="/social/reddit" data-state={leaderboard.state} className="mx-auto max-w-6xl space-y-8 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Attention leaderboard — ApeWisdom</h1>
        <MethodologyBanner
          providerMethodologyVersion={leaderboard.providerMethodologyVersion}
          boardSourceUrl={leaderboard.boardSourceUrl}
          boardMethodologyUrl={leaderboard.boardMethodologyUrl}
        />
      </div>

      {/*
        Round-36 lane-review finding 1. A security whose board entries have never once parsed has
        no `attention_snapshot` row, and therefore no row in `leaderboard.rows` to carry
        `wasMalformedLastRun` — it simply does not appear among the (up to) 100 rows below, with
        nothing on the page distinguishing "not currently on ApeWisdom's board" from "on the
        board, sending data this deployment cannot store." Rendered outside the state ternary
        below so it shows in every state, including `unavailable` (a universe whose every member's
        very first attempt was malformed reads `rows: []` exactly like a genuine cold start).

        **Says "successful" — round-37 lane-review finding 1, correcting round 36's own copy.**
        `KEYS.malformedTickers()` is written only on a successful provider contact
        (`pipeline.ts`), so under `state === 'degraded'` with `degradedReason ===
        'provider_unreachable'` this flag can be true while the *current* run never reached
        ApeWisdom at all — `AttentionTable.tsx`'s own per-row copy already carries this exact
        qualifier for the identical reason (round 35 lane-review finding 2), and this page-level
        banner must not drift from it and claim a run happened that did not.
      */}
      {leaderboard.neverCollectedMalformedSymbols.length > 0 ? (
        <p
          className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
          data-never-collected-malformed=""
        >
          The most recent successful collection run received data for{' '}
          {leaderboard.neverCollectedMalformedSymbols.join(', ')} that could not be parsed, so no
          observation has ever been recorded for {leaderboard.neverCollectedMalformedSymbols.length === 1 ? 'it' : 'them'}.
        </p>
      ) : null}

      {/*
        Round-42 lane-review finding 1, extracted into its own testable component by round-43
        finding 1, widened to fire on `activeConfigVersionMissing` alone by round-47 finding 1
        (a run where every security's Redis pointers are already warm leaves `configVersionGapSymbols`
        empty even with no active config version). Rendered outside the state ternary below, the
        same way `neverCollectedMalformedSymbols`'s banner is, so it shows regardless of which
        state the rest of the page ends up in. See `ConfigVersionGapBanner.tsx`'s own doc for why.
      */}
      <ConfigVersionGapBanner
        activeConfigVersionMissing={leaderboard.activeConfigVersionMissing}
        symbols={leaderboard.configVersionGapSymbols}
      />

      {leaderboard.state === 'degraded' ? (
        <div>
          {/*
            Round-12 lane-review finding 1: `DegradedPanel` is shared with F07/F09 and only ever
            says "a provider is currently unavailable" — true for a genuine fetch failure, false
            for the two other causes `degraded` covers (round 11/12 findings: a 200 response that
            yielded nothing usable, or one whose shape no longer matched the schema).
            `leaderboard.degradedMessage` is rendered here, on this feature's own page, rather
            than changing the shared panel's contract for every consumer.

            Round-13 lane-review finding 4: rendering `DegradedPanel` unconditionally then meant
            the page stated the shared panel's "a provider is currently unavailable" and this
            paragraph's accurate text in the same block for the two causes where the panel's claim
            is false — an operator reading the amber panel is still told to wait out an outage
            that is not happening. `degradedReason` (round 13's own addition to the contract) now
            gates the panel itself: it renders only for the one cause it actually describes.
          */}
          {leaderboard.degradedReason === 'provider_unreachable' ? <DegradedPanel providers={['apewisdom']} /> : null}
          {leaderboard.degradedMessage === null ? null : (
            <p
              className={
                leaderboard.degradedReason === 'provider_unreachable'
                  ? 'mt-2 text-sm text-amber-900'
                  : 'rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900'
              }
              data-degraded-message=""
            >
              {leaderboard.degradedMessage}
            </p>
          )}
        </div>
      ) : null}

      {leaderboard.state === 'unavailable' ? (
        <AttentionUnavailable
          reason={leaderboard.unavailableReason ?? 'never_collected'}
          degradedReason={leaderboard.degradedReason}
          degradedMessage={leaderboard.degradedMessage}
        />
      ) : (
        <>
          <section>
            <h2 className="text-lg font-semibold">Notable rank changes</h2>
            <p className="mb-2 text-xs text-neutral-500" data-notable-movers-caption="">
              {/*
                Round-14 lane-review finding 3: "this run" asserts every mover shown came from the
                most recent collection attempt. Under `state === 'degraded'`, that attempt is by
                construction not the source — a genuine fetch failure produced nothing new, so any
                movers rendered here are carried over from the last *successful* run instead
                (`degradedReason === 'provider_unreachable'`), or from data whose newest reading is
                simply unusable (the other two `degradedReason`s) — never "this run"'s own data.
              */}
              {leaderboard.state === 'degraded'
                ? 'The three largest moves from the last successful collection, before any explanation is attached.'
                : 'The three largest moves this run, before any explanation is attached.'}
            </p>
            <NotableMovers
              movers={leaderboard.notableMovers}
              excludedForStaleness={leaderboard.notableMoversExcludedForStaleness}
            />
          </section>

          <section>
            {/*
              Round-27 lane-review finding 3: F08 §4.2 requires "the page title and the table
              header" to both name ApeWisdom as the source — the h1 above does, but this section's
              own header named neither, so a reader scrolled past the notable-movers cards to the
              100-row board (D-30's seeded universe) saw mentions/upvotes/rank/deltas with no
              visible source at all once a row's z-score cell was hidden below the depth-14
              warm-up floor (`AttentionTable.tsx`'s own `CoverageLabel` is the only other
              per-row source, and only for rows at or above that depth). The methodology link and
              captured version are not repeated here — `MethodologyBanner` above already carries
              both, contiguous with the h1, for this whole page's one provider.
            */}
            <h2 className="text-lg font-semibold">Full board — ApeWisdom</h2>
            <AttentionTable
              rows={leaderboard.rows}
              degradedReason={leaderboard.degradedReason}
              lastCollectedAt={leaderboard.lastCollectedAt}
              providerWindowHours={APEWISDOM_WINDOW_HOURS}
            />
          </section>
        </>
      )}
    </main>
  );
}
