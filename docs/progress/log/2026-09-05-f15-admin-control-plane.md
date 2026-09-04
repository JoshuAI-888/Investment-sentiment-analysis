# 2026-09-05 — F15, governed admin control plane (partial)

**Lane:** SURFACE, built by a coordinator-dispatched lane-build agent in a worktree (interrupted
once by a session-wide rate limit mid-build, resumed from the same worktree with all prior
uncommitted work intact), reviewed and merged by the coordinator in the same session.

## What merged

The uniform 8-step mutation contract (`services/admin/mutation.ts`: authorize → validate → 
optimistic-concurrency check → dry-run impact preview → capture reason → write new version →
activate in a transaction → audit_event → invalidate cache → return rollback target), built as
one reusable pipeline and enumerated-tested (`registry.test.ts` asserts every registered mutation
performs all eight steps) rather than copy-pasted per surface, per §4.1's own explicit warning
that a bespoke mutation is a review failure even if it works.

Eight of the twelve `/admin` sub-surfaces from §2's `In` list: status/overview, the universe
selector (draft → preview → activate → rollback, server-enforced 100-symbol cap, zero provider
calls per rendered row), settings (typed catalogue including D-15's operator-editable trigger
thresholds, versioned), audit trail (read), cost ledger view (unpriced never renders `$0.00`),
data explorer (rights-checked, retention-aware, every access audited including a zero-row
access), calculation issues (resolution produces a successor artifact, never mutates the
original). Models is read-only — its mutation was deferred for time. Data sources, jobs
(F16b-owned, deliberately untouched), user assumptions, and coverage/replay queues were not
built this pass.

Seven new, purely additive repositories (`audit.ts`, `settings.ts`, `models.ts`,
`data-explorer.ts`, `cost-breakdown.ts`, `universe-table.ts`, `calculation-issues.ts`) — nothing
in `src/repositories/` outside these new files was edited.

## A real bug found and fixed during the build

`updateSettingMutation`/`rollbackSettingsMutation` inserted the draft `config_version` inside the
pipeline's own outer transaction, but `activateConfigVersion` (SPINE's, existing) opens a
*separate* transaction and could not see the still-uncommitted row — every settings write would
have failed activation in production. Fixed by committing the draft insert in its own transaction
before activation runs. Caught by the agent's own integration test against a real Postgres, not
by the coordinator's review — disclosed in the agent's report rather than silently fixed and
unmentioned.

## Verification

Coordinator re-ran the full gate independently in the merge tree (not just the build agent's own
report), against a real local Postgres 16: lint/typecheck clean; unit 1223/1223 on F15's own
tree, 1325/1325 on the fully merged tree (F10 + F16a + F15 together — arithmetic checks out
exactly: 1273 + 52 new); contract 109/109; integration 364/364; build clean. Merge with F10's and
F16a's already-landed work produced zero conflicts (disjoint paths — `app/(admin)/**`,
`app/api/admin/**`, `src/services/admin/`, `src/ui/admin/`, seven new repository files).

## Known design tradeoff, flagged rather than silently decided

Settings budget defaults were seeded to D-32's $290/$320/$350 (the currently-correct, re-derived
figures), not F15 §4.7's own literal text, which still reads the stale pre-D-20 $80/$90/$100.
The spec text is now out of date against its own product's numbers; F18 (next SURFACE feature
after F16b) is the natural place to reconcile the spec's own wording, not this pass.

## Deferred (named trigger: a future pass, time-budget-limited this session)

- The 20,000-row universe-selector p95 performance benchmark — no seeded dataset exists yet to
  measure against; DoD item otherwise fully built (draft/preview/activate/rollback all work, zero
  provider calls per row is structurally true, just not load-tested).
- Models mutation (route/UI both read-only today).
- User-assumption and coverage/replay governance queues (§4.6) — not started.

## Contract requests

None — the agent reported everything F15 needed already existed in `src/contracts/`.

## Same worktree-staleness note as F16a's log

This worktree also branched from the repository's original first commit on this branch (`86ec5b4`),
not the branch tip at dispatch time — the same class of issue recorded in
`2026-09-05-f16a-dispatch-core.md`. No functional consequence here (F15 touches no file either
F10 or F16a touched), but noted again since it is now a confirmed, repeatable pattern across two
independent worktree dispatches in the same session, not a one-off.
