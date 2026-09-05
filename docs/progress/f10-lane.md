# Lane F10 — evidence pipeline and stance classification

**Written by:** the coordinator only (`../06-PARALLEL-LANES.md` §4). A lane agent reports; it
never edits this file.
**Temporary lane** (D-42), scoped like RNI's DATA/ENGINE/SURFACE split, not the legacy
SPINE/COLLECT/SURFACE partition.
**Owns these source paths:** `apps/web/src/services/evidence/`, `apps/web/fixtures/evidence-pack/`,
its own tests under `apps/web/tests/{unit,contract,integration}/services/evidence/`.
**Never touches:** `src/contracts/`, `src/repositories/`, `migrations/`.

## Feature

| ID | Feature | Wave | Status | Notes |
|---|---|---|---|---|
| F10 | Evidence and stance pipeline | 3 | **`merged`** 2026-09-04 | Spec: `../features/F10-evidence-stance-pipeline.md`. Built in worktree `agent-aa176a4eac94ca3d3`, merged to `claude/remaining-work-analysis-z6uecn` |

## Definition of Done — 9/11

- [x] Retrieval is domain-restricted, date-bounded, and never scrapes (out of scope — F04 owns it; this feature only reads what's stored).
- [x] Snippets are capped and no full content is stored (bounded ≤30 items; per-source retention rules respected).
- [x] Dedupe works across sources; retrieved and used counts are recorded and rendered — fixed post-review: dedupe is strictly within-axis (cross-axis dedupe was a D-14 violation, caught and fixed).
- [x] Ticker-collision guard is tested on every ambiguous token in the fixture matrix (AI/ON/IT/ALL).
- [x] Classification uses a strict schema at temperature 0, with model/route/prompt version and cost recorded per call.
- [x] A schema-invalid response never becomes a stance.
- [x] `unclear` and sarcasm items contribute zero direction and stay in diagnostics (sarcasm detection itself remains deferred, D-21 — this is a passthrough case, not fully exercised).
- [x] `retrievalQuery` and `retrievalWindow` are on the pack and visible downstream.
- [x] The "not a representative sample" statement is attached to the pack, not to UI copy.
- [ ] **B1, B2 and B5 pass on the F12 corpus** — F12's harness exists now (merged same day) but running F10 against it live, end to end, was not attempted this session. Trigger: a live run of F12's harness against F10's real pack builder.
- [ ] **Availability checker updates state only; snippets are immutable** — the decision logic (`availability-checker.ts`) is built and fully tested; no repository function exists to persist the result. Trigger: `repositories/evidence.ts` gains an `updateEvidenceAvailability`-shaped write (SPINE).

## Contract requests (resolved)

| Request | Status | Resolution |
|---|---|---|
| `frameDisclosure` has no field for a truncated scan | **Resolved** | `truncated: boolean` added to `contracts/evidence-pack.ts` at merge time (D-43); wired through `frames.ts` |
| `ModelClient` (ARCH §4.6) is stale re: D-21 | **Acknowledged, not resolved** | This lane built its own scoped `ModelBackend`; convergence with F11's `ModelClient` deferred as named technical debt (D-43) |
| LLM methods not visible in the shared Inspector | **Not resolved** | Needs SPINE-owned changes to `calc/registry.ts` or `services/inspector.ts`; not attempted this session |

## Test evidence

| Suite | Result |
|---|---|
| unit | pass (part of the merged tree's 129 files / 1434 tests) |
| contract | pass |
| integration | pass (DB-dependent case correctly skips locally) |
| build | pass |

## Review

One adversarial `lane-review` round, 7 findings, all fixed and regression-tested before merge —
including a real D-14 invariant break (cross-axis dedupe was pooling two sampling frames into
one). Full findings and fixes: `MEMORY.md` D-43.

## Deferred

| Item | Reason | Trigger |
|---|---|---|
| B1/B2/B5 on F12's corpus | Needs a live run against F12's harness | F12's harness + real corpus, run against F10 |
| Availability-checker persistence | No repository write exists | SPINE adds `updateEvidenceAvailability` |
| `GatewayModelBackend` live smoke test | No live call made this session (fixtures-first per `04-BUILD-LOOP.md` §2.3) | Manual smoke test post-deploy with a real `AI_GATEWAY_API_KEY` |
| `recordModelCallCost` auto-wiring to `cost_event` | Built and tested, not auto-invoked — needs a caller with real request context | F11 or F16a supplies that context |
| Reddit/X frame-disclosure metadata field names | Best-effort guess (`subreddit`, `treeComplete`, `watchlistVersion`, `triggerEventId`) — F16a doesn't exist to define the real shape | F16a lands |

## Commits

Merged as `merge: F10 — evidence pipeline and stance classification` into
`claude/remaining-work-analysis-z6uecn`, plus a coordinator follow-up adding
`frameDisclosure.truncated`.

## Handoff

```text
LANE         F10
FEATURE      F10 — evidence and stance pipeline
STATUS       merged
DoD          9/11 checked
```
