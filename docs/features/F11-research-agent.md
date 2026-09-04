# F11 — Research Agent, Verifier, and Claim Ledger

> **Amended 2026-09-03 by the re-lock.** **D-10:** this feature is retained as the **measurement path** as well as the web research flow. Tiers B and C run against it in CI and are the only evidence that F21's MCP tool surface can be used honestly — an MCP server owns no render boundary, so B4 is unmeasurable without this.
> See `../MEMORY.md` §1b for the decisions and `../SPEC-REVIEW.md` for the reasoning.

**Wave:** 3 · **Lane:** unallocated — assigned at the Wave 2 gate · **Estimate:** 20–26 h · **Depends on:** F10
**Blocking manual task:** `../DEPLOY.md` **MT-06**.

## 1. Purpose

The thesis. Jobs J2, J3, J6, J7: a user asks about a ticker and gets a streamed,
source-backed, verified explanation in under thirty seconds — or a clear abstention.

## 2. Scope

**In:** the research state machine; typed parallel fetch; progress streaming; the synthesis
prompt and schema; the **deterministic verifier** (the part that actually works); the bounded
model verification pass; the claim ledger; follow-up generation; the staged latency budget
and partial-result path; run persistence and reload; **run retraction** (F-20).

**Out:** the evaluation harness that measures all of this (F12); evidence retrieval (F10).

## 3. Contracts

**Consumes:** `EvidencePack`, `ClassifiedItem` (F10); F06 methods; `ModelClient`.
**Produces:** `ResearchRun` state machine (`../02-ARCHITECTURE-CONTRACTS.md` §4.5),
`ClaimLedgerEntry`, the streaming event contract, the deterministic check suite.

## 4. Build spec

### 4.1 State machine

Per source §10.1, extended by the review:

```
queued → gathering → analyzing → synthesizing → verifying → complete
                                              ↘ verification_failed   (F-10)
              ↘ abstained (insufficient evidence)
              ↘ degraded (deterministic metrics only; prose timed out or withheld)
              ↘ failed
complete|degraded → retracted   (operator action, F-20)
```

Runs are append-only; every transition writes a `research_event`. A run survives reload
because the events are the source of truth, not the stream.

### 4.2 Staged latency budget (F-12)

The 30 s p95 is decomposed and each stage is individually bounded and measured:

| Stage | Budget | On overrun |
|---|---|---|
| Fan-out (parallel provider fetch) | 8 s | proceed with what returned; record the gap |
| Deterministic analysis | 1 s | hard failure — this is local computation |
| Classification | 6 s | proceed with classified subset; record `n` actually classified |
| Synthesis | 10 s | **`degraded`**: metrics stand, prose withheld |
| Verification | 4 s | **`verification_failed`**: metrics stand, prose withheld |
| **Total wall clock** | **30 s hard cap** | whatever has completed is returned |

Deterministic metrics stream **first** and remain regardless of what happens to the prose.
A user always gets numbers; prose is the part that can be withheld.

### 4.3 Streaming

First progress event in < 1 s (Tier A1). High-level, user-meaningful events only — never
raw model tokens, never tool arguments, never anything that leaks a provider payload.

### 4.4 Synthesis

Strict zod schema: summary; up to three narrative themes each with ≥ 2 supporting evidence
IDs (a single-source theme is labelled `single-source`); a bullish case; a bearish case;
what changed; what to monitor. Every field's claims carry evidence IDs or metric IDs.

Hard prompt constraints: no recommendations, no price targets, no probability language, no
causal assertion without a cited source. The system prompt is versioned and recorded per run.

### 4.5 The verifier — deterministic first

The deterministic checks are the real control. All eight from `../05-TEST-STRATEGY.md` §6,
each unit-tested, each running on **every production answer**:

1. every numeric token string-matches a stored metric at display rounding;
2. every citation marker resolves to an `evidence_item` in this run's pack;
3. every cited item's `retrievedAt` is inside the run's declared window;
4. no banned vocabulary;
5. no stance asserted where n < 5;
6. no claim references a ticker outside the subject set;
7. date claims are consistent with cited evidence timestamps;
8. stated freshness matches the oldest input's `observed_at`.

Then **one bounded model pass** for what code cannot check: does each claim actually follow
from its cited evidence? Strict schema, temperature 0, its own task route.

**F-10, binding:** a verifier error or timeout means the run lands in `verification_failed`
and **prose is withheld**. It never publishes unverified prose. This is a tested behaviour,
not an inferred one.

### 4.6 Claim ledger

Every material claim → `{claimId, text, kind, evidenceIds[], metricIds[], verifierVerdict}`.
The ledger is what makes "every claim resolves to a source" auditable rather than aspirational,
and it is what a retraction later points at.

### 4.7 Follow-ups

Template-driven, optionally rewritten by the model, and **only questions the system can
actually answer** from its own data. A follow-up reuses the existing pack — it does not
re-retrieve, and it does not re-spend.

### 4.8 Retraction (F-20)

An operator can mark a run `retracted` with a reason and an actor. The retraction is visible
everywhere the run renders, including any shared snapshot. Nothing is deleted: the run, its
claims, its evidence links and its artifacts remain for audit. A runbook entry accompanies it.

## 5. Test plan

| Level | Cases |
|---|---|
| Unit | each of the eight deterministic checks, positive and negative; state transitions incl. every terminal state; budget overrun per stage |
| Contract | synthesis and verifier response schemas; streaming event schema |
| Integration | run persists and replays from events after a simulated reload; a synthesis timeout yields `degraded` with metrics intact; a verifier timeout yields `verification_failed` with prose withheld; retraction propagates to every render surface |
| E2E | user triggers a run, sees progress < 1 s, gets an answer ≤ 30 s; reload mid-run recovers; thin evidence produces a stated abstention; **a run refused by the global budget check states why** |
| Feature-specific | B3, B4, B6, B7, B8 on the F12 corpus; per-stage latency recorded and asserted |

## 6. Definition of Done

- [ ] All ten states implemented; every transition writes an event; runs survive reload.
- [ ] First progress event < 1 s; total ≤ 30 s p95; every stage individually bounded.
- [ ] Deterministic metrics stream first and survive any prose failure.
- [ ] All eight deterministic checks run on every answer and are individually unit-tested.
- [ ] Verifier error or timeout ⇒ `verification_failed` with prose withheld. Tested.
- [ ] Unverified prose can reach a user by **no** code path.
- [ ] Claim ledger populated; every material claim carries evidence or metric IDs.
- [ ] Themes with one source are labelled `single-source`.
- [ ] Follow-ups reuse the pack and never re-retrieve.
- [ ] Zero recommendations, price targets, or probability language (B6).
- [ ] Retraction works, is visible everywhere the run renders, and deletes nothing.
- [ ] Every run is budget-checked before its first priced call.
- [ ] B3, B4, B6, B7, B8 pass on the F12 corpus.

## 7. PR review steps

1. Trace every path from synthesis output to the browser. Is there one where prose renders
   without a passed verification? That is a merge blocker.
2. Force a verifier timeout; confirm `verification_failed` and that numbers still render.
3. Read the eight deterministic checks against `../05-TEST-STRATEGY.md` §6 — any missing?
4. Read the system prompt for anything that invites a recommendation or a forecast.
5. Confirm streamed events carry no payload, prompt, or tool detail.
6. Retract a run; confirm every surface shows it and nothing was deleted.

## 8. Risks and open questions

| Risk | Mitigation |
|---|---|
| 30 s p95 is tight on Hobby (F-12) | Staged budget, partial results, `degraded` as a first-class outcome; Pro is MT-09 |
| The model verifier is itself fallible (F-10) | Deterministic checks carry the load; the model pass is measured on seeded errors (B7/B8) |
| Cost per run (F-04) | **Re-based by D-11:** the tier and per-account budgets are cut; the **global** ceiling plus pre-dispatch checks carry it. With one actor the global ledger *is* the per-account ledger |
| A confident wrong answer reaches a user (F-20) | Retraction path, claim ledger, and the runbook |
