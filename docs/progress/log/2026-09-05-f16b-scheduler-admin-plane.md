# 2026-09-05 — F16b, scheduler admin plane

**Lane:** SURFACE, built by a coordinator-dispatched lane-build agent in a worktree (this one
correctly ran `git fetch && git reset --hard origin/claude/rni-remaining-work-91aj0u` before
starting, per an explicit instruction added after two earlier worktrees this session were found
to have branched from a stale point — its base, `6e77907`, was genuinely the branch tip at
dispatch time), reviewed and merged by the coordinator in the same session.

## What merged

Admin-editable job rows (due times, cadence, enabled state, retry policy, per-job budget ceiling)
routed through F15's existing uniform mutation pipeline (`services/admin/mutation.ts`) rather than
a second, parallel mutation mechanism; a dry run proven to make zero external calls against a job
with a *real* dispatch handler wired in (not a vacuous stub that would pass trivially); a next-run
preview that calls F16a's own `computeNextDueAt` directly, so DST correctness is inherited rather
than re-derived; an additive extension to `repositories/jobs.ts` (`findJobDefinitionById`,
`listJobDefinitions`, `updateJobDefinition` with optimistic concurrency on `(id, version)`) — the
same kind of solo-session cross-lane gap-fill that file's own module doc already documents as
precedent.

## A real concurrency scenario tested, not just asserted

Because `updateJobDefinition` is now a *second* writer of `job_definition` (the dispatcher's own
`advanceJobDefinitionSchedule` being the first), the agent wrote a genuinely concurrent
dispatcher-vs-admin-edit race test rather than treating optimistic concurrency as a formality —
`tests/integration/jobs.test.ts`'s new describe block, confirmed present and passing in the
coordinator's own re-run.

## ADR-013 verification

"The admin can never rewrite the QStash schedule or `vercel.json`" was checked two ways: a direct
grep across every new file for schedule-mutating API calls or filesystem writes (zero matches
except doc-comment prose naming the constraint), and an extension of F16a's own
`adr-013-invariants.test.ts` to cover this feature's files too. `git status` on `src/services/jobs/`
(F16a's dispatch-core internals) showed zero diff from this build, confirming the boundary held.

## Verification

Coordinator re-ran the full gate independently in the merge tree: lint/typecheck clean (the agent
had already fixed 3 `exactOptionalPropertyTypes` errors itself); unit 1360/1360 on F16b's own
tree; contract 114/114; integration 402/402; build clean. On the fully merged tree (F10 + F16a +
F15 + F11 + F16b): unit 1426/1426 — arithmetic checks out exactly (1391 + 35 new); lint/typecheck/
build clean. Merge produced zero conflicts.

## Scoping choices disclosed, not silent

- `maxCallsPerRun` is not exposed as admin-editable — only `maxCostUsdPerRun`. §4.2 names "per-job
  budget ceiling" in the singular, and F18 (not yet built) is the more natural owner of call-count
  ceilings specifically.
- The dry-run action is authorized and audited directly rather than routed through the mutation
  pipeline — it writes no `job_definition` state, so the pipeline's optimistic-concurrency/
  versioned-write/rollback-target machinery has nothing to apply to. Mirrors F15's own precedent
  for `auditAdminAccess` on read-only data-explorer access.
- "Due times" was interpreted as a direct `nextDueAt` override; `scheduleType`/`scheduleExpression`
  must be edited together, never partially, to keep the row internally consistent.

## Contract requests

None — everything needed already existed in `src/contracts/operations.ts` and
`src/contracts/primitives.ts`.
