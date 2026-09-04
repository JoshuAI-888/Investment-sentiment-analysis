# F12 — Evaluation Harness and LLM Judge

> **RNI scope:** RNI prompts, analytics and convergence changes trigger the RNI frozen eval suite
> and citation/independence guardrails defined in `../rni/EVALS_AND_GUARDRAILS.md`.

> **Amended 2026-09-03 by the re-lock.** **D-09:** adds **Tier D** (measurement fidelity) — per-axis stance accuracy, scorer reproducibility, scorer-provenance completeness, and the D4 promotion backtest. **D-18:** ports finsent's evaluation harness (PIT, IC, Newey–West, momentum-residual IC) as a versioned module with its own tests. **D-18 also requires the null scenario that must fail** — raw IC alone is not an acceptable promotion criterion. Blocked additionally on **OQ-7** (the labelled set is unspecified).
> See `../MEMORY.md` §1b for the decisions and `../SPEC-REVIEW.md` for the reasoning.

**Wave:** 3 · **Lane:** unallocated — assigned at the Wave 2 gate · **Estimate:** 12–16 h · **Depends on:** F11
**Manual task:** `../DEPLOY.md` **MT-11** (one-time human calibration, non-blocking).

## 1. Purpose

The only feature whose output is a *number about the product's quality*. Without it, Tier B
and Tier C of `../01-PRODUCT-SPEC.md` §4 are aspirations and the success criteria revert to
the unfalsifiable set the review rejected (`../00-ADVERSARIAL-REVIEW.md` F-02, F-22).

## 2. Scope

**In:** the frozen evaluation corpus; human labels; the seeded-error corpus; the verifier
measurement; the LLM judge and its rubric; the CI integration; the calibration script;
result storage and run-to-run comparison.

**Out:** the behaviours being measured (F10, F11).

## 3. Contracts

**Consumes:** `EvidencePack` (F10), research output and the claim ledger (F11).
**Produces:** the corpus format; `EvalResult`; the judge schema; the CI gate.

## 4. Build spec

### 4.1 Corpus

≥ 30 frozen packs, committed, per `../05-TEST-STRATEGY.md` §5.1: 10 clear stance, 5 sarcasm/
ambiguity, 5 ticker-collision, 5 conflicting-source, 5 thin-evidence. Each carries human
labels for per-item stance and relevance, plus acceptable claims, required abstentions, and
the stored metric values the prose must match.

Packs are **frozen artifacts**, not live retrievals. A pack is regenerated only by a
deliberate, reviewed PR that also re-labels it.

### 4.2 Seeded-error corpus

≥ 40 answers with one injected fault each, across the nine fault classes in
`../05-TEST-STRATEGY.md` §5.2. Used twice, for two different purposes:

- to **measure the verifier**: catch rate ≥ 0.90 (B7), false-positive rate ≤ 0.10 (B8);
- to **validate the judge**: a judge scoring a seeded-error answer ≥ 4 on groundedness is
  itself a defect and fails the harness.

The second use is what stops the judge from being the unfalsifiable gate the review warned
about.

### 4.3 The judge

A different model from the synthesiser, on its own task route, temperature 0. Sees only: the
answer, the evidence text, and the stored metric values — **not** the synthesiser's prompt or
reasoning, so it cannot be persuaded by them.

Schema: `{c1, c2, c3, c4: 1..5, violations: string[], rationale: string}` against the four
axes in `../01-PRODUCT-SPEC.md` §4 Tier C.

**Gate:** mean ≥ 4.0 across the corpus; **no answer below 3 on C2 (groundedness)**; zero
Tier-B violations. A C2 failure is a defect to fix, not a score to average away.

### 4.4 Calibration (MT-11)

A script that samples 20 answers for the owner to hand-score on the same rubric, then reports
Spearman correlation between human and judge. Below 0.7, the judge's thresholds are raised
rather than trusted, and the fact is recorded in `../MEMORY.md`. Non-blocking to the loop;
blocking to any claim that the Tier C gate means something.

### 4.5 Determinism and drift

Temperature 0; model IDs recorded per eval run; corpus frozen. A model-route change re-runs
the whole corpus and records the delta in `../MEMORY.md`. Results are stored per run so a
threshold change can be re-evaluated without re-running the models. An unexplained
score movement between runs is investigated, not accepted.

### 4.6 CI

`pnpm test:eval` runs on any PR touching `agent/`, `prompts/`, or `analytics/`, and nightly.
It prints a per-axis table and the Tier B/C verdicts, and fails the build on a gate breach.

## 5. Test plan

| Level | Cases |
|---|---|
| Unit | rubric parsing; score aggregation; Spearman implementation; gate logic incl. the "no C2 below 3" rule |
| Contract | judge response schema; corpus format validation |
| Integration | full harness against the frozen corpus; a deliberately-broken answer fails the gate; verifier metrics computed from the seeded set |
| E2E | — |
| Feature-specific | **judge adversarial validation**: the judge must not score any seeded-error answer ≥ 4 on C2 |

## 6. Definition of Done

- [ ] ≥ 30 labelled packs across all five buckets, committed and frozen.
- [ ] ≥ 40 seeded-error answers across all nine fault classes.
- [ ] Verifier measured: B7 ≥ 0.90 and B8 ≤ 0.10, reported as numbers in `../PROGRESS.md`.
- [ ] Judge implemented on a separate route at temperature 0, blind to the synthesis prompt.
- [ ] Tier C gate enforced: mean ≥ 4.0, no C2 below 3, zero Tier-B violations.
- [ ] Judge adversarial validation passes — no seeded error scores ≥ 4 on C2.
- [ ] Calibration script exists and its result (or its pending status) is recorded.
- [ ] `test:eval` runs in CI on the right triggers and fails on a gate breach.
- [ ] Eval results are stored per run and comparable across runs.
- [ ] The judge's known limitation is documented in `../MEMORY.md`, not only in this spec.

## 7. PR review steps

1. Read ten corpus labels yourself. Do you agree with them? Bad labels make every downstream
   number meaningless.
2. Confirm the judge cannot see the synthesis prompt — check the input construction.
3. Run the judge on three seeded-error answers manually; confirm it catches them.
4. Break the gate deliberately (lower an answer's quality); confirm CI fails.
5. Confirm the corpus is frozen and cannot be regenerated as a build side effect.

## 8. Risks and open questions

| Risk | Mitigation |
|---|---|
| The judge is forgiving of fluent-but-wrong prose (F-22) | Adversarial validation against seeded errors; human calibration MT-11; the C2 floor |
| Human labels are inconsistent | Written labelling guide committed alongside the corpus |
| Corpus overfits the current prompt | Refresh a portion each wave; record the change in `../MEMORY.md` |
| Eval cost per CI run | Conditional trigger; temperature 0; results cached per answer hash |
