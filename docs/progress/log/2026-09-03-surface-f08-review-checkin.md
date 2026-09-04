# 2026-09-03 — surface — F08 attention leaderboard: review-loop check-in (not yet merged)

F08 (attention leaderboard) is built and pushed to `feat/F08-attention-leaderboard`, but has not
merged. This entry records the state of an unusually long adversarial `lane-review` loop —
**32 rounds so far, every one of them finding and fixing at least one genuine issue** — so the
package's own state files stay accurate mid-loop rather than only at a merge boundary.

## What's built

The collector (`src/services/attention/collector.ts`), the compute pipeline
(`compute.ts`/`pipeline.ts`), the read path (`leaderboard.ts`), `GET /api/social/reddit`, and the
UI (`AttentionTable`, `NotableMovers`, `AttentionUnavailable`, `MethodologyBanner`,
`app/(app)/social/reddit/page.tsx`). Full gate (typecheck, lint, unit/contract/integration tests
against a real Postgres, build, e2e including an axe accessibility pass and a stress variant,
all three `check:*` scripts) is green on every round's commit, including the current one.

## Why 32 rounds, and what they found

Coordinator applies each round's fixes directly (a harness worktree-isolation constraint means a
freshly spawned build agent cannot reach this branch's existing worktree), verifies every single
fix by reverting it, confirming the specific new/updated test fails for the right reason, then
restoring it — no exceptions across all 32 rounds — then dispatches a fresh adversarial
`lane-review` round against the new commit.

Three areas absorbed most of the rounds, each converging only after being attacked from several
different angles:

- **Rounds 14–22: the "collection frontier" whack-a-mole.** Per-row freshness copy (has this
  reading gone stale because the collector is failing, or because the security simply fell off
  ApeWisdom's tracked board — routine churn under D-30, not an outage?) took nine rounds to get
  right, each fix at one page/component layer resurfacing as the identical bug one layer down or
  in the wrong direction (round 17 → 18 → 19 → 20 is the clearest chain: three consecutive rounds
  each found the previous round's own fix newly false in a different reachable state). Converged
  on comparing a row's own `observedAt` against `leaderboard.lastCollectedAt` — the "collection
  frontier" concept — as the one comparison that actually answers the question directly instead
  of approximating it with a page-level proxy. Worth a `MEMORY.md` pattern entry once this merges.
- **Rounds 24–28: "degraded state over zero rows" honesty.** `assembleAttentionLeaderboard`'s
  `rows.length === 0` early return kept discarding or mis-describing a real, current provider
  outage recorded in Redis — round 25 found the return hardcoded `degraded: false`; round 26 found
  the fix covered only one of three `degradedReason` values; round 27 found the fixed message
  still claimed rows existed when `rows: []`; round 28 found it separately claimed "no observation
  has ever been recorded" even when the true cause was a superseded config version hiding a real
  corpus. Round 32 closed the last sibling: a `no_new_data` message asserting a vacuous truth
  ("every entry was malformed/unmatched") over a genuinely empty board response.
- **Rounds 29–30: rendering honesty outside the degraded paths.** A row-level window label
  conflated the local Δ Rank/Δ Mentions comparison span with ApeWisdom's fixed 24-hour rolling
  aggregate, understating a churned row's staleness by up to 5x; a z-score whose denominator hit
  an epsilon floor rendered as a plain number indistinguishable from a genuine ~31,000-sigma
  anomaly; a magnitude-based column sort carried no visible or accessible disclosure of its own
  semantics; a dead, unboundedly expensive query ran on every collector poll for a value nothing
  in production read.

The remaining rounds (1–13, 23, 24, 28, 31) each closed one narrower, self-contained defect rather
than a chain — among them: duplicate-ticker handling on one board response (round 23), int4-range
validation on provider-supplied numbers (round 24), a missing auth test on the API route
(round 28), and a missing component-render test on `NotableMovers` mirroring one already closed on
`AttentionTable` (round 31).

## Not F08's to fix, routed or left alone

- `apps/web/scripts/checks/storage-projection.ts`'s under-count edge case — already-accepted
  informational (non-gating) gap; reported cross-lane, not re-opened.
- `scripts/checks/copy.ts`'s `stripComments` two documented latent false-negative classes
  (template-literal interpolation, a bare regex literal) — accepted residuals, neither reachable
  in today's scan roots.
- §6.4's disclosure-line wording ambiguity (spans F07, already merged) — routed cross-lane,
  pending a `MEMORY.md` R-15 scoping read.
- Two ApeWisdom fixture files added to COLLECT-owned `fixtures/` during early F08 rounds — routed
  cross-lane.
- `pipeline.ts` has nothing invoking `runAttentionCollection` (F16a/COLLECT's dispatcher, blocked
  on MT-04) — the copy that says "it will keep retrying on its own schedule" is accordingly not
  yet true; recorded as a live gap that resolves itself the moment F16a lands, not an F08 defect.
- The deferred price/Δprice/5-day-trend column's stated blocker ("no `market_snapshot` repository
  exists yet") went stale mid-loop — `src/repositories/market.ts` merged from `main` (PR #10)
  partway through this loop. Noted, not acted on: building the column is new feature work, out of
  scope for a review-and-fix loop, and F08's own `DEFERRED` tracking already names it.

## Merged mid-loop

`main` merged into the branch cleanly at round 32 (`4cee1a7`), picking up PR #10's SPINE
repositories (`market.ts`, `evidence.ts`, `sentiment.ts`, an extended `security.ts`) — none of
which F08 consumes, confirmed by round 32's own review.

## State as of this entry

HEAD: `e4bf17b` on `feat/F08-attention-leaderboard`, pushed. Round 32's fix (the `no_new_data`
vacuous-truth message) is in; round 33's review is the next step. No PR opened yet — this lane's
own practice opens the PR only once a review round returns a clean pass. Wave 2's own gate stays
"not reached" regardless of how this loop concludes: it also needs the collector to have actually
run against real data, which needs MT-13/MT-15 (owner actions, still open).
