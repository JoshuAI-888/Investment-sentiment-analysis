# 2026-09-05 — F10, evidence pipeline and stance classification

**Lane:** unallocated (Wave 3), built by a coordinator-dispatched solo lane-build agent in a
worktree, reviewed and merged by the coordinator in the same session.

## Context

MT-06 (LLM access, Vercel AI Gateway) was confirmed provisioned by the owner earlier the same
day, unblocking F10/F11/F12 (and, through F12, F21). D-39 (also this day) discarded Reddit-Data-
API sourcing for the legacy product entirely — F10 had to be built with that already true, not
retrofitted later.

## What merged

Evidence normalization, dedupe and relevance across the three axes; the evidence-pack builder
(bounded, ordered, with `retrievedCount`/`usedCount`/`retrievalQuery`/`retrievalWindow`); the two
D-21 LLM methods (relevance filtering, ticker-collision disambiguation) via a new
`services/llm/model-client.ts` `ModelClient` port (fixture + Vercel AI Gateway live
implementations, budget-check-before-call, structured-output validation, drop-to-`unclear` on a
schema-invalid response rather than guessing); the three per-axis disclosures (`disclosure.ts`) —
Reddit's is the honest not-collected statement gated on a `REDDIT_COLLECTED = false` constant,
per D-39; the availability checker (state-only writes, snippet content immutable by type).

Purely additive: 20 new source/fixture files, 7 new test files, nothing existing edited. 64 new
unit tests; full unit suite 1235/1235 passing; lint/typecheck/build all clean;
`check:calc-coverage`/`check:bundle`/`check:copy` all pass. Independently re-run by the
coordinator in the merged worktree before merging (not just taken on the agent's report):
lint, typecheck, `tests/unit/evidence` + `tests/unit/services/llm` (64/64), full `test:unit`
(1235/1235), and `build` — all matched the agent's own report exactly.

**Not run, in either the agent's session or the coordinator's verification:** `test:e2e` and any
DB-backed integration test (no Postgres/dev server in this sandbox). The pack builder and
availability checker are pure/port-based by design specifically so their logic doesn't depend on
one; a true `evidenceForSecurity` → `buildEvidencePack` wiring test against a live DB is a real
gap, not built here.

## Deferred (named trigger)

DoD's B1/B2/B5 numeric gates need a real F12 evaluation corpus, which does not exist yet — F12 is
next in the Wave 3 queue behind F11. Named trigger: F12 exists.

## Contract requests for whoever picks these up

1. `repositories/evidence.ts` needs `updateEvidenceAvailability(itemId, {availability,
   lastCheckedAt})` — only insert/read exist today. `availability.ts` is built and tested against
   an injected port in the meantime (mirrors F20's `ScoreStorePort` precedent).
2. LLM calls do not flow through `provider_call_log`/`cost_event` the way every other provider
   does. The agent attempted adding `'llm'` to `contracts/provider.ts`'s `providerId` and reverted
   it — `adapters/rate-limit.ts`'s exhaustive `Record<ProviderId, BucketConfig>` (COLLECT-owned)
   is not safely append-only from every consumer's point of view. `services/llm/ports.ts` defines
   its own budget/cost/call-log port shapes instead, keyed on `ModelTask`. Unifying these into the
   shared cost ledger is a coordinated SPINE+COLLECT change, not made here.
3. `contracts/evidence.ts` has no exported `Availability` type (only the zod schema) — worked
   around locally rather than editing the contract file.

## Decision recorded

Not a `MEMORY.md`-worthy product decision on its own — the `ModelClient` port shape and the
declined `ProviderId` change are implementation choices consistent with this codebase's existing
"decouple via a port when the owning lane hasn't built the real thing yet" pattern (the same
reasoning `services/jobs/ports.ts` and `services/dashboard/redis.ts` already document). No product
invariant, contract, or decision-log entry changed.
