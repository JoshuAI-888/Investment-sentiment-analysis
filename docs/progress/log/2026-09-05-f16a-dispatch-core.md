# 2026-09-05 — F16a, dispatch core and trigger path

**Lane:** COLLECT, built by a coordinator-dispatched lane-build agent in a worktree (interrupted
once by a session-wide rate limit mid-build, resumed from the same worktree with all prior
uncommitted work intact), reviewed and merged by the coordinator in the same session.

## Context

MT-04 (QStash schedule) was confirmed created and firing by the owner earlier the same day,
unblocking this feature — its only recorded blocker. D-39 (also this day) discarded Reddit
sourcing for the legacy product; this feature's job-definition seed reflects that directly
(no Reddit job seeded).

## What merged

QStash signature verification via `@upstash/qstash`'s `Receiver` (added as a real dependency
rather than hand-rolled JWS, matching this codebase's judgment call each time a well-specified
crypto/protocol operation is needed); a Redis whole-tick dispatch lock (`dispatch-lock.ts`,
mirroring `rate-limit.ts`'s established INCR+EXPIRE idiom); DST-aware `nextDueAt` scheduling via
`cron-parser` (also added as a dependency); `JobService.execute` as the single path scheduled and
triggered runs both go through; the F16 §4.1b trigger path (evaluate → persist artifact →
eligibility check → budget check → refuse-and-record-`CoverageGap` or dispatch); a new,
explicitly cross-lane-authorized `calc/methods/market-spike-detection.ts` (F06 has not shipped a
spike method yet, and F16 §4.1b's DoD requires every evaluation, firing or not, to write a
`CalculationArtifact`); the daily Vercel Cron heartbeat (`vercel.json` + a new route); migration
`0014` seeding `market_data_poll`/`attention_poll`/`x_sampling_window` job rows.

## Verification

Coordinator re-ran the full gate independently in the merge tree (not just the build agent's own
report) against a real local Postgres 16: lint/typecheck clean; unit 1273/1273 on the merged tree
(1235 already-merged from F10, + 38 new here — arithmetic checks out exactly); contract 104/104;
integration 374/374; build clean. The merge with F10's already-landed work (package.json/
pnpm-lock.yaml both touched independently by each agent, since this worktree forked before either
F10 or an earlier main-branch `cron-parser` addition existed) resolved with no conflicts and a
`pnpm install --frozen-lockfile` confirming the merged lockfile is internally consistent.

## Real gaps found and disclosed, not papered over

1. **No production `config_version` bootstrap path exists anywhere in this codebase** (verified
   by grep: `insertConfigVersion`/`activateConfigVersion` are called only from tests). Migration
   0014's job-definition inserts are `SELECT`-gated on an active `config_version`, so they seed
   zero rows against a real, freshly-migrated production database until one is bootstrapped.
   Flagged for SPINE — see `progress/collect.md`'s Deferred table.
2. **`market.spike_detection` is not wired into `analytics/registry.ts`'s `MethodRegistry`** —
   invisible to `check:calc-coverage` and the Inspector's formula catalogue until F06 promotes or
   replaces it.
3. Heartbeat route auth is best-effort (Vercel's `CRON_SECRET` auto-injection doesn't match this
   route's `INTERNAL_DISPATCH_SECRET` naming) — documented in the route itself.
4. Retry scheduling does not yet honor `job_definition.backoff_policy`/`max_attempts` — a failed
   run advances to the next ordinary interval.

## One correction the build agent raised, verified true

The agent's brief referenced a MEMORY.md decision "D-39" by that exact number; the agent found no
such numbered entry on its (stale) worktree base and flagged the discrepancy rather than silently
assuming it existed. This was a real base-staleness issue, not a documentation error: the
worktree had branched from the repository's very first commit on this branch (before this
session's own D-39/MT-06 doc commits landed), not from the branch tip as intended — apparently a
timing/caching artifact of worktree creation, not something the coordinator can fully explain from
inside this session. D-39 does exist on `claude/rni-remaining-work-91aj0u` (added earlier this
session); the merge picked it up correctly since the coordinator, not the agent, performed the
merge from the actual current branch tip. Noted here so a future session knows this class of
worktree-staleness is possible and worth an explicit `git log`/`grep` sanity check before trusting
an agent's "this decision doesn't exist" report at face value — in this case the substance the
agent built to was correct regardless (Reddit genuinely out of scope), but the numbering
discrepancy could have masked a real problem in a different case.

## Deferred (named triggers)

See the four new rows added to `progress/collect.md`'s Deferred table.

## Contract requests

To SPINE: bootstrap a production `config_version`; review/promote `market.spike_detection`.
To F18 (unbuilt): `x-budget.ts` is the one file to update with real ceiling values when F18 lands.
