# Lane F12 — evaluation harness and LLM judge

**Written by:** the coordinator only (`../06-PARALLEL-LANES.md` §4). A lane agent reports; it
never edits this file.
**Temporary lane** (D-42), scoped like RNI's DATA/ENGINE/SURFACE split, not the legacy
SPINE/COLLECT/SURFACE partition.
**Owns these source paths:** `apps/web/src/services/eval/` (new), `apps/web/tests/eval/`
(currently vacuous — `test:eval` passes with `--passWithNoTests`), its own contracts
(`EvalResult`, the corpus format — **not frozen**, nothing outside this lane consumes them, so
this lane defines and owns them; do not put them in `src/contracts/`, keep them alongside the
harness under `src/services/eval/`).
**Never touches:** `src/contracts/`, `src/repositories/`, `migrations/`. Frozen contracts it
consumes: `src/contracts/evidence-pack.ts` (F10), `src/contracts/research.ts` (F11's
`researchRun`/`claimLedgerEntry`). `MEMORY.md` D-42.

## Feature

| ID | Feature | Wave | Status | PR | Notes |
|---|---|---|---|---|---|
| F12 | Evaluation harness and judge | 3 | `in progress` | — | Spec: `../features/F12-evaluation-harness.md`. Depends on F11 (in progress in parallel — build the harness machinery and corpus scaffolding now; the full ≥30-pack labelled corpus and real gate runs need F10/F11's actual merged output). Dispatched 2026-09-04 |

## Blocked

| Feature | Blocker | What unblocks it |
|---|---|---|
| — | none for harness scaffolding | The Tier B/C gates themselves (B1-B8, judge calibration) cannot run for real until F10 and F11 both merge — this lane can build the harness, corpus format, judge, and CI wiring against fixtures in the meantime |

## Test evidence

| Suite | Status | Notes |
|---|---|---|
| unit | pending | — |
| contract | pending | — |
| integration | pending | — |

## Commits

| SHA | Summary | Tests |
|---|---|---|
| — | — | — |

## Handoff

```text
LANE         F12
FEATURE      F12 — evaluation harness and judge
STATUS       dispatched
DoD          0/10 checked
```
