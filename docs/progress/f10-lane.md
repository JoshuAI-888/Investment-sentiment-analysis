# Lane F10 — evidence pipeline and stance classification

**Written by:** the coordinator only (`../06-PARALLEL-LANES.md` §4). A lane agent reports; it
never edits this file.
**Temporary lane** (D-42), scoped like RNI's DATA/ENGINE/SURFACE split, not the legacy
SPINE/COLLECT/SURFACE partition — F10/F11/F12 don't fit that partition.
**Owns these source paths:** `apps/web/src/services/evidence/` (new), `apps/web/fixtures/evidence-pack/`
(new), its own tests under `apps/web/tests/{unit,contract,integration}/services/evidence/`.
**Never touches:** `src/contracts/`, `src/repositories/`, `migrations/` — a needed change there is
reported, not made (`../06-PARALLEL-LANES.md` §8). Frozen contracts it consumes:
`src/contracts/evidence-pack.ts`, `src/contracts/evidence.ts`, `src/contracts/primitives.ts`,
`src/adapters/scorer.ts` (`MEMORY.md` D-42).

## Feature

| ID | Feature | Wave | Status | PR | Notes |
|---|---|---|---|---|---|
| F10 | Evidence and stance pipeline | 3 | `in progress` | — | Spec: `../features/F10-evidence-stance-pipeline.md`. Dispatched 2026-09-04 |

## Blocked

| Feature | Blocker | What unblocks it |
|---|---|---|
| — | none | — |

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
LANE         F10
FEATURE      F10 — evidence and stance pipeline
STATUS       dispatched
DoD          0/11 checked
```
