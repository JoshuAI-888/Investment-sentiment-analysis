# F12 evaluation corpus — labelling disclosure

**This corpus's v1 labels are LLM-assisted and are pending the owner's human audit.** Every pack
under `apps/web/fixtures/eval-corpus/packs/` carries `labelSource: "llm_assisted_pending_human_audit"`
on its own record — not a footnote elsewhere, the field the corpus loader itself validates
(`apps/web/src/services/eval/schema.ts#evalLabelSource`) and that a caller reading the pack sees
directly. This document exists so no future reader mistakes any number this corpus produces for
one backed by blind human labelling.

## What actually happened

`docs/MEMORY.md` **D-35** ("The v1 labelled set is LLM-assisted with human audit, and the assist
is disclosed") establishes this repository's pattern for exactly this problem, for a different
labelled set (F02's stance-accuracy corpus, Tier D1). F12 needed ≥30 human-labelled evidence
packs (§4.1) and a human-audited seeded-error corpus (§4.2), and no human was available in the
sandbox that built this feature. Rather than fabricate labels and present them as blind
human judgement, the corpus was built the way D-35 already decided this repository handles the
problem: **drafted by an LLM-driven agent, disclosed as such, and left pending a human audit
pass** — not silently treated as equivalent to D-35's own two-stage process (human-labelled
subset drawn first, LLM labels the remainder, every disagreement adjudicated by a human).

**This is a weaker position than D-35's, and that difference is itself disclosed, not smoothed
over.** D-35's process has an independent, human-only anchor subset precisely so the corpus's
accuracy number means something even though an LLM assisted with the rest. **F12's v1 corpus has
no such anchor yet** — every pack's evidence, labels, and gold answer were drafted by the same
kind of system (an LLM-driven build agent) that the corpus is meant to grade. That is the
circularity D-35's own text names ("a forgiving labeller and a forgiving classifier agree, and the
agreement reads as accuracy") one level further in: here, the same agent drafted both halves.

## What this corpus can and cannot support until it is audited

- **Can:** exercise the harness's own logic — corpus format validation, the Tier C gate's mean/C2-
  floor/Tier-B-violation math, the seeded-error corpus's structure, the deterministic verifier
  measured for real against real (if synthetic) fault injections, the judge's blindness
  construction. All of `apps/web/tests/eval/` and `apps/web/tests/unit/services/eval/` test the
  *harness*, and they do so honestly regardless of the corpus's own provenance.
- **Cannot, until audited:** stand as evidence that the Tier D1 stance-accuracy bar, the Tier C
  judge gate, or B7/B8's verifier numbers reflect anything about the product's real accuracy
  against real evidence. A judge scoring well against a gold answer the same kind of system wrote
  is a test of the *harness's internal consistency*, not of the product.

## What "audited" would mean, and the trigger to do it

Per D-35's own criteria, adapted: an owner (or another qualified human) reads every pack's
evidence text and labels, and every seeded-error answer's injected fault, and confirms or
corrects them. A revised corpus after that pass should:

1. Record the audit — who, when, what changed — in this file or a dated addendum to it.
2. Change `labelSource` on every audited pack to a new, distinct value (e.g.
   `"llm_assisted_human_audited"`) — never silently keep the pending value once the pending state
   is no longer true.
3. Report per-bucket disagreement rates the way D-35 requires for its own corpus: "a suspiciously
   low rate is evidence of correlation, not of quality."

**Trigger to revisit:** before any number this corpus produces (Tier D1 stance accuracy, the Tier
C judge gate, B7/B8) is cited as evidence of the product's real quality — in `MEMORY.md`,
`PROGRESS.md`, or anywhere user-facing. Using the harness to develop and debug itself needs no
audit; using its output as a quality claim does.

## Where the corpus lives

- `apps/web/fixtures/eval-corpus/packs/*.json` — the ≥30 frozen evidence packs (F12 §4.1), each
  `{ meta, pack }` where `pack` conforms to F10's real `EvidencePack` (`apps/web/src/services/evidence/types.ts`).
- `apps/web/fixtures/eval-corpus/seeded-errors/*.json` — the ≥40 seeded-error answers (F12 §4.2),
  each `{ meta, output }` where `output` conforms to F11's real `SynthesisOutput`.
- `apps/web/fixtures/llm/judge/*.json` — deliberately authored fixture judge responses, one per
  corpus item, selected by id. **These are a second, separate disclosure**: they let
  `pnpm test:eval` exercise the harness for free and deterministically, but they are not a live
  model's actual output — see `apps/web/scripts/eval/generate-corpus.ts`'s own docstring and this
  feature's build report for what running the harness against a real judge model would need.
- `apps/web/scripts/eval/generate-corpus.ts` — the generator that produced every file above. Not
  run in CI, not imported from any production or test path. Regenerating the corpus is "a
  deliberate, reviewed PR that also re-labels it" (F12 §4.1), never a build side effect.
