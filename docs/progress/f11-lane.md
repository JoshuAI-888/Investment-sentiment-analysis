# Lane F11 — research agent, verifier, claim ledger

**Written by:** the coordinator only (`../06-PARALLEL-LANES.md` §4). A lane agent reports; it
never edits this file.
**Temporary lane** (D-42), scoped like RNI's DATA/ENGINE/SURFACE split, not the legacy
SPINE/COLLECT/SURFACE partition.
**Owns these source paths:** `apps/web/src/services/research/`, `apps/web/app/api/research/**`,
its own tests under `apps/web/tests/{unit,contract,integration}/services/research/`.
**Never touches:** `src/contracts/`, `src/repositories/`, `migrations/`, `src/services/evidence/`.

## Feature

| ID | Feature | Wave | Status | Notes |
|---|---|---|---|---|
| F11 | Research agent and verifier | 3 | **`merged`** 2026-09-04 | Spec: `../features/F11-research-agent.md`. Built in worktree `agent-aeee9785b5aa2c7c7`, merged to `claude/remaining-work-analysis-z6uecn` |

## Definition of Done — 9/13

- [x] First progress event < 1s; every stage individually bounded.
- [ ] **Total ≤ 30s p95** — unmeasured; needs `test:perf` (Wave-5, F19) and real F10 timing.
- [x] Deterministic metrics stream first and survive any prose failure.
- [x] All eight deterministic checks run on every answer and are individually unit-tested (widened post-review: checks 4/5/6 had real bypasses, closed).
- [x] Verifier error or timeout ⇒ `verification_failed` with prose withheld. Tested.
- [x] Unverified prose can reach a user by no code path (post-review fix: a theme's `title` used to bypass every check by never entering a `claim` — now folded into the checked pipeline).
- [x] Claim ledger populated; every material claim carries evidence or metric IDs.
- [x] Themes with one source are labelled `single-source`.
- [x] Follow-ups reuse the pack and never re-retrieve.
- [ ] **Zero recommendations, price targets, or probability language (B6)** — the deterministic mechanism is built and unit-tested (widened post-review to close real gaps); the actual Tier-B gate measurement needs F12's real corpus run.
- [ ] **Retraction works, is visible everywhere the run renders, and deletes nothing** — the mechanism, entry point (`/api/research/[runId]/retract`), authorization, optimistic-concurrency check and audit trail are all built and tested (closed post-review: originally had no caller and no audit write). "Everywhere the run renders" stays unverified beyond this lane's own surface — no UI renders a research run anywhere in this codebase yet.
- [x] Every run is budget-checked before its first priced call (closed post-review: cost tracking was entirely missing — `cost.ts`'s estimator and `research_run.cost_usd` accumulator added).
- [ ] **B3, B4, B6, B7, B8 pass on the F12 corpus** — blocked; needs a live run against F12's real harness.

**Moved from checked to unchecked during review:** "all ten states implemented; every transition
writes an event; runs survive reload" — the state machine and event-append are correct and
tested, but "survive reload" specifically is not: persistence is in-memory only (see below), and
the original reload test only proved event-replay ordering within one process.

## Contract requests (open)

| Request | Status |
|---|---|
| `src/repositories/research.ts` — no repository writes `research_run`/`research_event`/`claim_ledger` rows | **Open.** An in-memory `ResearchRepositoryPort` implementation stands in (`composition.ts`), explicitly documented as process-lifetime-only |
| `src/repositories/calculations.ts` has no "list subject's latest metrics" query | **Open** |
| No shared `ModelClient` in `src/contracts/` | **Acknowledged, not resolved this session** — see `MEMORY.md` D-43's convergence decision |
| No generic `audit_event` writer exists (only one built for a different table) | **Open.** `AuditPort`'s shape is the target; `createConsoleAuditLog()` is a labelled console-based stand-in |

## Test evidence

| Suite | Result |
|---|---|
| unit | pass (part of the merged tree's 129 files / 1434 tests) |
| contract | pass |
| integration | pass (DB-dependent cases correctly skip locally) |
| build | pass |
| e2e | not run — needs a live dev server + DB, unavailable this session |

## Review

One adversarial `lane-review` round, 10 findings, all fixed and regression-tested before merge —
including two real security/correctness bugs: no per-run ownership check on the read routes
(cross-user data leak) and no cost tracking on either priced model call. Full findings and fixes:
`MEMORY.md` D-43.

## Deferred

| Item | Reason | Trigger |
|---|---|---|
| Real (non-in-memory) persistence | No `src/repositories/research.ts` exists | SPINE adds it; swap the in-memory port, no orchestrator change needed |
| Real F10 evidence integration | F10 built in a parallel worktree; F11 built against the frozen contract with its own dev fixtures | F10 merged (done) — swap `dev-fixtures.ts`'s evidence port for F10's real pack builder |
| Real per-subject metrics | `repositories/calculations.ts` has no query for it | SPINE adds it |
| True background/async execution, multi-connection live tailing | F16a's job dispatcher doesn't exist | F16a lands |
| Total 30s p95 measurement | Needs `test:perf` and real F10 timing | F19 (Wave 5) |
| B3/B4/B6/B7/B8 real gate numbers | Needs F12's real corpus and a live run | F12's real ≥30-pack corpus |
| A real `audit_event` writer for `research_run` | Only a different table's writer exists | SPINE |

## Commits

Merged as `merge: F11 — research agent, verifier, and claim ledger` into
`claude/remaining-work-analysis-z6uecn`, plus a coordinator follow-up threading
`frameDisclosure.truncated` through this lane's test fixtures.

## Handoff

```text
LANE         F11
FEATURE      F11 — research agent and verifier
STATUS       merged
DoD          9/13 checked
```
