# 2026-09-05 — F11, research agent, verifier, and claim ledger

**Lane:** unallocated (Wave 3), built by a coordinator-dispatched lane-build agent in a worktree,
reviewed and merged by the coordinator in the same session.

## What merged

The research state machine (fine-grained `queued`/`gathering`/`analyzing`/`synthesizing`/
`verifying` plus five terminal states driving `research_event`; the coarse existing
`research_run.status` column tracks queued/running/terminal without a contract change — `abstained`
is mapped to `status='complete'` + `result.outcome='abstained'`, a deliberate, documented choice
since `contracts/research.ts`'s status enum has no `abstained` value and this feature does not own
that contract); a `ResearchModelClient` port structurally parallel to F10's `ModelClient` (F10's is
scoped to `relevance`/`entity_collision` only, D-21 — F11 could not widen it without touching
another lane's merged file, so it built its own rather than reaching in); D-34's cross-vendor
synthesis/verify rule enforced by an `assertDifferentVendors` runtime check, not just convention;
a real budget gate wired to `services/dashboard/budget.ts#checkGlobalBudget` before any priced
call; the eight deterministic checks (unit-tested individually, 27 cases) combined with a bounded
model-verification pass into one claim ledger; follow-up generation that reuses the already-built
evidence pack rather than re-retrieving; transactional run retraction (`requireAdmin`, audited,
deletes nothing, visible everywhere the run renders).

Purely additive: 26 new files, nothing outside `services/research/`, `repositories/research.ts`,
and `app/api/research/**` touched.

## Verification

Coordinator re-ran the full gate independently in the merge tree (not just the build agent's
report), against a real local Postgres 16: lint/typecheck clean; unit 1301/1301 on F11's own tree;
contract 109/109; integration 361/361; build clean. On the fully merged tree (F10 + F16a + F15 +
F11 together): unit 1391/1391 — arithmetic checks out exactly (1325 already-merged + 66 new);
lint/typecheck/build all clean. Merge produced zero conflicts (disjoint paths from every other
feature merged this session).

## A design choice worth flagging for `MEMORY.md` if the coordinator agrees

The `abstained`→`status='complete'` mapping, named above, is a genuine interpretive choice made
during the build rather than a contract change — recorded in `state-machine.ts`'s own docstring.
Not promoted to a numbered `MEMORY.md` decision in this pass; flagged here so a future session
can decide whether it warrants one.

## Corrections to F10's own session log

The build agent found and reported two things worth correcting in
`2026-09-05-f10-evidence-stance-pipeline.md`'s contract-request #2:

1. `cost_event.provider` is a plain `z.string().min(1)`, **not** gated by
   `contracts/provider.ts`'s exhaustive `ProviderId` union — that union only constrains
   `adapters/rate-limit.ts`'s bucket config, a different, narrower thing. F10's log stated this
   union was the reason LLM calls couldn't be wired into the shared cost ledger; F11 wired
   `cost_event` for real (including a `researchRunId` column that already existed on the schema,
   unused until now) with no contract change needed, contradicting that stated reason.
2. `env.ts`'s `AI_MODEL_SYNTHESIS`/`AI_MODEL_VERIFY` already exist as distinct config — not a gap.

Both left as a note here rather than edited into F10's own log (never silently reverse a prior
session's recorded reasoning — this file's role is to append the correction, not rewrite history).

## Contract requests

1. `services/llm/ports.ts`'s `ModelClient`/`ModelTask` should eventually widen to include
   `'synthesis' | 'followup' | 'verify'`, retiring F11's parallel `ResearchModelClient` — a later,
   coordinated change touching both F10's and F11's territory.
2. `services/evidence/pack.ts#buildEvidencePack` has no partial-result/cancellation path (its
   `Promise.all` is all-or-nothing) — F11 §4.2's "classification overrun: proceed with the
   classified subset" is only approximable as "proceed with zero classified" without either
   editing F10's merged file (out of this agent's bounds) or reimplementing its per-item driver.
   Real fix needs whoever next owns `services/evidence/`.

## Deferred (named trigger: F12 exists)

DoD items B3/B4/B6/B7/B8's measured gates need the evaluation-harness corpus — same shape as
F10's own B1/B2/B5 deferral. Also deferred: a dedicated perf suite (no p95 timing harness exists
for this feature yet) and an e2e spec (no Playwright browsers available in the build agent's
sandbox at the time).
