# ADR-008 — LLMs do not calculate

**Status:** Accepted. **Load-bearing, and enforced by lint rather than by convention.**
**Source:** `../reference/SOURCE-PRD-v1.5.md` §1.1.

## Decision

Code computes returns, rank changes, aggregates, shrinkage, confidence, sample rules and state
classification. The LLM classifies sampled text into a strict schema, synthesizes approved
evidence, and generates follow-up questions. It does not compute a number that reaches a user.

## How it is enforced

This ADR is the one most likely to erode quietly, because the eroding change always looks
small. It is therefore mechanised in three places:

1. **`no-llm-in-analytics`** (F01 §4.3) — an import from `agent/` or a model SDK inside
   `analytics/` or `calc/` fails the build.
2. **`no-float-in-analytics`** — those modules use decimals, never floats. A raw JS `number`
   in an analytics module is a review failure (`../../CLAUDE.md`).
3. **`layer-direction`** — analytics depends only on contracts
   (`../02-ARCHITECTURE-CONTRACTS.md` §3), so there is no path by which a model call reaches it.

Product invariant §6.2 states the same rule from the product side, and F05's Inspector is what
makes a violation visible: a value produced by a model has no reproducible artifact to show.

## A vocabulary note

The original text says code computes "signal states". That is **internal** vocabulary. The word
`signal` is **banned in user-facing copy** by product invariant §6.4 and by `check:copy` — the
rendered term is "state" or "pattern".

## Amendment

**D-13 narrows the LLM's remaining role further.** Stance classification moved to the pinned
scorer service (F20), so the LLM no longer produces the stance scores that enter the corpus at
all. What it retains is synthesis, follow-up generation and verification.
