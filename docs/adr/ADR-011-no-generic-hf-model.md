# ADR-011 — No single generic Hugging Face model is the product's sentiment engine

**Status:** **Superseded twice** — cut by F-21, then replaced by D-13.
**Source:** `../reference/SOURCE-PRD-v1.5.md` §1.1.

## Original decision

Keep the strict-schema LLM classifier for the small evidence sample, and record Hugging Face
candidates in **shadow evaluation**. The production target routes formal financial text,
English financial-social text and multilingual social text to separately validated
classifiers, with LLM escalation for ambiguous items. Candidates were provisional and none
could be promoted on model-card metrics alone.

## Supersedure 1 — F-21 cut the shadow evaluation entirely

The shadow evaluation was conditional on slack in a plan that had none, gated on a labelled
dataset assigned to a different work package, and had **no promotion decision date**. It would
have been built as a stub and never evaluated, while costing seven environment variables and a
model-routing branch.

**Ruling:** cut from Waves 1–5. The LLM classifier becomes the sole stance engine; the HF work
becomes a post-PoV research spike with an entry condition (the F12 labelled set must exist, and
the LLM classifier's cost must be measured, so there is a baseline to beat). **The seven `HF_*`
environment variables are removed from F01's schema** — and F01's DoD asserts that none appears
anywhere in the codebase.

## Supersedure 2 — D-13 reversed F-21's conclusion, not its reasoning

D-13 makes **pinned Hugging Face models the stance engine**, in a separate service (F20). This
contradicts F-21's ruling that "the LLM classifier is the sole stance engine", and the
contradiction is recorded here rather than smoothed over, because a reader arriving from F-21
needs to see that the ruling expired rather than that it was forgotten.

What changed is the requirement, not the analysis. F-21's objection was to an **unevaluated,
unowned, optional** shadow track. D-13's models are neither optional nor unpinned:

- Two models, both loaded **by commit SHA, never by tag**, with a boot assertion that fails on
  a tag, a branch or an absent revision.
- `ProsusAI/finbert@<sha>` for prose; `cardiffnlp/twitter-roberta-base-sentiment-latest@<sha>`
  for short-form.
- Determinism is **Tier D2** and is tested: byte-identical scores across runs *and* across
  batch sizes. Approximately-equal is a failure.
- Every score carries `scorer_id` and `scorer_version`, and **no series admitted to a metric
  mixes scorers** (Tier D3).

The original ADR's actual thesis — *no single generic model is the engine, and nothing is
promoted on model-card metrics alone* — survives both supersedures intact. What was rejected
was a research track with no exit; what was adopted was a pinned, tested, provenance-carrying
engine.

## The one thing this does not restore

`FEATURE_HF_SHADOW` is **not** in F01's environment schema. R-19 cut shadow evaluation, D-13
did not bring it back, and a flag governing nothing is a flag someone will eventually switch on.
