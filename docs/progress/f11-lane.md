# Lane F11 — research agent, verifier, claim ledger

**Written by:** the coordinator only (`../06-PARALLEL-LANES.md` §4). A lane agent reports; it
never edits this file.
**Temporary lane** (D-42), scoped like RNI's DATA/ENGINE/SURFACE split, not the legacy
SPINE/COLLECT/SURFACE partition.
**Owns these source paths:** `apps/web/src/services/research/` (new), `apps/web/app/api/research/**`
(F01 §4.6's own placeholder names F11 as the owner), its own tests under
`apps/web/tests/{unit,contract,integration}/services/research/`.
**Never touches:** `src/contracts/`, `src/repositories/`, `migrations/`. Frozen contracts it
consumes: `src/contracts/evidence-pack.ts` (F10's output), `src/contracts/research.ts`
(`researchRun`, `researchEvent`, `claimLedgerEntry` — already merged, consume as-is, do not
redefine). `MEMORY.md` D-42.

## Feature

| ID | Feature | Wave | Status | PR | Notes |
|---|---|---|---|---|---|
| F11 | Research agent and verifier | 3 | `in progress` | — | Spec: `../features/F11-research-agent.md`. Depends on F10 (in progress in parallel — build against the frozen `EvidencePack` contract, not F10's actual code, until F10 merges). Dispatched 2026-09-04 |

## Blocked

| Feature | Blocker | What unblocks it |
|---|---|---|
| — | none — building against the frozen contract in parallel with F10 | F10 merging is needed before F11 can integration-test against real F10 output rather than a fixture `EvidencePack` |

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
LANE         F11
FEATURE      F11 — research agent and verifier
STATUS       dispatched
DoD          0/13 checked
```
