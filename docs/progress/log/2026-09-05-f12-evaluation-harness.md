# 2026-09-05 — F12, evaluation harness and LLM judge

**Lane:** unallocated (Wave 3), built by a coordinator-dispatched lane-build agent in a worktree,
reviewed and merged by the coordinator in the same session.

## Context

F10 and F11 both merged earlier the same day, satisfying F12's stated dependency and unblocking
the B1/B2/B5 (F10) and B3/B4/B6/B7/B8 (F11) measured DoD gates that had been deferred pending this
feature's existence.

## What merged

30 frozen, committed corpus packs conforming to F10's real `EvidencePack` type (10 clear-stance, 5
sarcasm/ambiguity, 5 ticker-collision, 5 conflicting-source, 5 thin-evidence, per
`05-TEST-STRATEGY.md` §5.1); 45 seeded-error answers (9 fault classes × 5, §5.2), each the
corpus's own gold answer plus one mutated/injected claim; a judge on its own new `AI_MODEL_JUDGE`
route (added to `env.ts`), temperature 0, blind to the synthesiser's prompt (tested by asserting
the exact payload sent to the judge contains no prompt-construction internals); the Tier C gate
(mean ≥ 4.0, a hard C2 ≥ 3 floor never averaged away — tested with a corpus that would pass on
mean alone but fail the floor, per the spec's own explicit warning); judge adversarial validation
(no seeded-error answer may score ≥ 4 on groundedness); MT-11's calibration script, which
correctly reports `PENDING` rather than a fabricated Spearman correlation, since no human scorer
was available in this session; per-run `EvalResult` storage (new migration `0015`, three tables)
for cross-run comparison.

Corpus labels are disclosed as LLM-assisted, pending the owner's human audit
(`docs/eval-corpus/LABELLING.md`) — see `MEMORY.md` D-40 for the full disclosure and why it is a
genuinely weaker position than D-35's own pattern, not an equivalent one.

## Two real numbers, one still open — see `MEMORY.md` D-40 for the full write-up

- **B8 (false-positive rate): 0.0000** (0/67), real, passes the ≤ 0.10 gate.
- **B7 (catch rate): 0.7778, deterministic-only** (35/45) — the two semantic-only fault classes
  need the model-verification pass, which needs a live model key this build session did not have.
  Recorded in `PROGRESS.md`'s global counters as not-yet-the-real-number, not as a pass.
- Tier C gate/judge mechanics: built and tested, but only against fixture judge responses,
  disclosed as such — not evidence of a live model's actual behavior.

## Verification

Coordinator re-ran the full gate independently in the merge tree: lint/typecheck clean; unit
1437/1437 on F12's own tree; contract 135/135 (against a real DB — 113 pass + 22 previously-
DB-gated now running for real); integration 391/391; `test:eval` 17/17; build clean (confirmed via
a backgrounded run after the default 120s tool timeout, monitored to completion, exit code 0). On
the fully merged tree (F10 + F16a + F15 + F11 + F16b + F12 together): unit 1472/1472 — arithmetic
checks out exactly (1426 already-merged + 46 new); lint/typecheck/build all clean. Merge produced
zero conflicts; migration `0015` did not collide with any other concurrently-built feature's
migration (F16b added none; the next free number on `main` was still `0015` at merge time).

## Real gaps found and disclosed, not papered over

1. **CI does not actually run `pnpm test:eval` for this code.** `.github/workflows/ci.yml`'s eval
   job path filter matches `agent/`, `analytics/`, RNI's own agent/analytics/convergence paths,
   and `prompts/` — none of which is where F10 (`services/evidence/`), F11
   (`services/research/`), or F12 (`services/eval/`) actually live. Flagged for whoever owns F01's
   CI config (not edited here — workflow files are F01-owned per `CLAUDE.md`).
2. `eval_run`/`eval_result`/`eval_calibration_score` are not in migration `0009`'s append-only
   enforcement list — insert-only by construction in the repository layer only, the same
   pre-`0009` state `research_event`/`claim_ledger` were briefly in. A future coordinated SPINE
   change could add DB-level enforcement.

## Decisions recorded

`MEMORY.md` D-40 — the judge's known limitation and the corpus-provenance gap relative to D-35,
written by the coordinator at the build agent's explicit request (it cannot write `MEMORY.md`
itself).

## Contract requests

None beyond the two gaps above and the CI trigger fix, which is really an F01 CI-config fix, not
a contract in the SPINE sense.
