# 2026-09-05 — the Substack collector (MT-08's missing collection half)

**Lane:** COLLECT, built by a coordinator-dispatched lane-build agent in a worktree, reviewed and
merged by the coordinator in the same session; two small integration gaps the build agent
correctly could not close from inside its own lane bounds were fixed by the coordinator in a
direct follow-up commit.

## Context

Reddit is discarded for the legacy product (D-39). Substack is now the only zero-lead-time text
channel, and the owner already confirmed a 13-publication list (`DEPLOY.md` MT-15) — but no
Substack *collector* existed to poll it. F16a's own session log had already flagged this exact gap
("Substack not seeded — no collector service exists yet") as the reason its job-seed migration
(`0014`) didn't include a Substack job. This is that missing piece.

## What merged

`services/collect/substack-publications.ts` — the 13 `{sector, publication, subdomain}` entries
transcribed verbatim from `DEPLOY.md`'s owner-signed-off table (10 of 11 GICS sectors, Utilities a
disclosed gap), plus D-29's selection-basis text for the Inspector. `services/collect/
substack-collector.ts` — mirrors `market/collector.ts`/`attention/collector.ts`'s per-item
isolation ("one publication's failure never stops the others, always finishes the full list,
reports honestly per item"). **Dedup is guid-scoped**, `(publicationSlug, guid)` — a deliberate,
disclosed departure from the other two collectors' full-payload hashing, named in the module's own
doc along with its consequence (a silent post-publish edit is not re-captured). Full
`content:encoded` HTML is persisted unt truncated (D-17), through the existing, unmodified
`insertEvidenceItem`. Every item carries `securityId: null` — matching text to a security is
`services/evidence|research|llm` territory this lane may not touch; sector/publication/guid are
recorded in metadata instead. A new `runSubstackPoll` bridge in `services/jobs/collectors.ts`
follows `runAttentionPoll`'s exact shape. Migration `0016` seeds the `substack_poll` job
definition, gated on an active `config_version` the same way `0014` already is (same disclosed
bootstrap gap, not newly introduced here).

## Two integration gaps closed by the coordinator, not the build agent

The build agent correctly identified that `job-service.ts`'s `DISPATCH_TABLE` and
`architecture/manifest.ts` were both outside its authorized COLLECT-lane paths (`DISPATCH_TABLE`
is F16a's dispatch-core internals; the manifest is F17's) and reported exactly what one-line change
each needed rather than reaching across the boundary itself. The coordinator made both changes
directly in a follow-up commit (`9ce2fd7`): registering `SUBSTACK_POLL_JOB_KEY` in
`DISPATCH_TABLE` (identical shape to `ATTENTION_POLL_JOB_KEY`'s own entry) and adding the Substack
poll job's pipeline/topology entries to the manifest, which stopped F17's CI reconciliation test
from correctly flagging the job as unregistered. This is exactly the kind of cross-lane final
wiring the repository's own `INTEGRATION` role exists for.

## Verification

Coordinator re-ran the full gate independently in the merge tree: lint/typecheck clean; unit
1507/1508 on the collector's own tree (the one failure being the expected, disclosed architecture-
reconciliation flag — resolved by the follow-up commit, confirmed 1508/1508 clean afterward);
contract 141/141; integration 424/424; build clean (verified via a backgrounded run, monitored to
completion). Merge produced zero conflicts (no path overlap with F18 or F21, both building
concurrently at the time).

## Contract requests

None beyond the two gaps closed above.
