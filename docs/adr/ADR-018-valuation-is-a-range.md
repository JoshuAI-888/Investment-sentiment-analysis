# ADR-018 — "Undervalued" is a model-dependent range, not a fact

**Status:** Accepted. **Deferred under D-19** — F13 and F14 are not built in Waves 1–5.
**Source:** `../reference/SOURCE-PRD-v1.5.md` §1.1.

## Decision

Code calculates reproducible DCF, peer-multiple and analyst-consensus gaps, **only for eligible
operating companies with adequate data**. It displays model values, assumptions, range,
confidence and disagreement **separately** — never collapsed into one number.

`not_applicable` or `insufficient_data` is returned for: ETFs; financial firms under an
incompatible generic DCF; pre-revenue or highly unstable cash-flow companies; stale inputs;
insufficient peer sets. **No LLM calculates fair value.**

## Deferral (D-19)

F13 (valuation engine) and F14 (scenario governance) are deferred. The decision is recorded
here rather than only in the roadmap because the ADR would otherwise read as describing
shipped behaviour.

The deferral does not weaken the rule. When valuation is built, it is built to this ADR — and
the `not_applicable` list above is the part that gets negotiated away under time pressure, so
it is restated here as binding rather than advisory.

## Consequences

- F-09's reassignment gives this ADR its cross-check: FMP's own DCF and analyst-consensus
  endpoints, which this ADR already requires displaying separately.
