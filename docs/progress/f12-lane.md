# Lane F12 — evaluation harness and LLM judge

**Written by:** the coordinator only (`../06-PARALLEL-LANES.md` §4). A lane agent reports; it
never edits this file.
**Temporary lane** (D-42), scoped like RNI's DATA/ENGINE/SURFACE split, not the legacy
SPINE/COLLECT/SURFACE partition.
**Owns these source paths:** `apps/web/src/services/eval/`, `apps/web/tests/eval/`,
`apps/web/fixtures/eval/`, `apps/web/scripts/calibration-report.ts`.
**Never touches:** `src/contracts/`, `src/repositories/`, `migrations/`, `src/services/evidence/`,
`src/services/research/`, `.github/workflows/` (the CI path-filter/nightly-trigger fix this lane's
review surfaced was made by the coordinator directly — see `MEMORY.md` D-43).

## Feature

| ID | Feature | Wave | Status | Notes |
|---|---|---|---|---|
| F12 | Evaluation harness and judge | 3 | **`merged`** 2026-09-04 | Spec: `../features/F12-evaluation-harness.md`. Built in worktree `agent-ab958a9c7ff0de21d`, merged to `claude/remaining-work-analysis-z6uecn` |

## Definition of Done — 5/10

- [ ] **≥30 labelled packs across all five buckets, committed and frozen** — a 10-pack starter corpus (2/bucket) was built instead, deliberately: the real ≥30-pack corpus needs real (D-35-methodology) labelling this lane was not asked to fabricate. Trigger: F10+F11 live plus a real labelling pass.
- [ ] **≥40 seeded-error answers across all nine fault classes** — 9 answers built (all nine fault classes now covered, up from 8/9 after the judge-input fix below). Same trigger as above.
- [ ] **Verifier measured: B7 ≥ 0.90 and B8 ≤ 0.10, reported in PROGRESS.md** — the arithmetic is built and unit-tested (B8's denominator bug found and fixed in review — it was counting duplicate base answers as distinct), but only against a fixture stand-in verifier. Trigger: F11's real verifier, wired into the existing `Verifier` port.
- [x] Judge implemented on a separate route, temperature 0, blind to the synthesis prompt (blindness test was vacuous pre-review — rewritten to actually plant and check for a canary through every field the judge does and doesn't read).
- [x] Tier C gate enforced: mean ≥ 4.0, no C2 below 3, zero Tier-B violations (fixed post-review: was float arithmetic that self-contradicted exactly at the 4.0 threshold; now `decimal.js`, matching `verifier-harness.ts`'s existing discipline).
- [x] Judge adversarial validation passes — no seeded error scores ≥4 on C2 (fixed post-review: the judge previously couldn't see evidence IDs or dates at all, making two fault classes structurally unjudgeable; `JudgeInput` now carries both).
- [x] Calibration script exists and its result (pending) is recorded (`scripts/calibration-report.ts` — did not exist pre-review; added, with the missing four-axis-to-scalar reduction function).
- [ ] `test:eval` runs in CI on the right triggers and fails on a gate breach — **mostly resolved outside this lane**: the coordinator widened CI's path filter and added the nightly trigger this lane's review flagged (`.github/workflows/` isn't this lane's path). `test:eval` itself genuinely gate-breaks (proven: a deliberately-broken answer fails it).
- [x] Eval results are stored per run and comparable across runs (file-based `EvalResultStore`, decimal-safe comparison after the Tier C gate fix).
- [ ] **The judge's known limitation is documented in MEMORY.md, not only in this spec** — done as part of this merge; see `MEMORY.md` D-43.

**New this pass, not in the original spec's 10 items but assigned to F12 by name** (`PROGRESS.md`
global counters, D-09's Tier D amendment): **Tier D1 (per-axis stance macro-F1 ≥0.80)** — was
entirely unbuilt and not even flagged as deferred after the first build pass; caught in review,
now built for real (`stance-accuracy.ts`) and reported, though its current numbers are informational
artifacts of the small hand-authored starter corpus, not a measurement.

## Test evidence

| Suite | Result |
|---|---|
| unit | pass (part of the merged tree's 129 files / 1434 tests) |
| contract | pass |
| integration | pass |
| eval (`test:eval`) | pass, 6/6 — includes a real gate-breaking case (a deliberately-broken answer fails the Tier C gate) |
| build | pass |

## Review

Two adversarial `lane-review` rounds' worth of scrutiny across the merge (one full round, 8
findings, all fixed and regression-tested) — including a float-arithmetic bug that made the Tier
C gate self-contradict at its own threshold, corpus fixtures that were sloppy find-replace clones
of each other, and a judge input shape that made two of the nine seeded-error fault classes
structurally unjudgeable. Full findings and fixes: `MEMORY.md` D-43.

## Deferred

| Item | Reason | Trigger |
|---|---|---|
| Real ≥30-pack labelled corpus | Needs real human/D-35-methodology labelling | F10+F11 live, then a labelling pass |
| Real ≥40-answer seeded-error set | Generated from the real corpus | Same as above |
| Real B7/B8 against F11's actual verifier | Only measured against a fixture stand-in | F11's real verifier wired into the `Verifier` port |
| A real Tier C gate run against a live judge and F11's real synthesized answers | No live judge model route exists | F10+F11 live plus a real judge model route |
| D-18/Tier-D4's backtest harness | Confirmed **not** part of F12's own DoD (`01-PRODUCT-SPEC.md` Tier D: "~2027") | A separate, future feature slice — not this lane's gap |
| D1's per-axis stance-accuracy on a real labelled set | Current numbers are starter-corpus artifacts | Same labelling pass as the ≥30-pack corpus |

## Commits

Merged as `merge: F12 — evaluation harness and LLM judge` into
`claude/remaining-work-analysis-z6uecn`, plus a coordinator follow-up threading
`frameDisclosure.truncated` through the ten frozen corpus packs, and a separate coordinator
commit widening CI's eval job.

## Handoff

```text
LANE         F12
FEATURE      F12 — evaluation harness and judge
STATUS       merged
DoD          5/10 checked
```
