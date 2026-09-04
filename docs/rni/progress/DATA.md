# RNI DATA Workstream Progress

**Writer:** DATA builder only  
**Branch:** `feat/rni-data-source-first`  
**Depends on:** merged RNI contract-freeze SHA  
**Status:** `IN_PROGRESS`

## Owned paths

See `../RNI_BUILD_LOOP.md` §3.2. Any path outside that list requires a contract request.

## Tasks

| ID | Task | Status | Acceptance evidence |
|---|---|---|---|
| D01 | Canonical `rni_source_item` and retrieval/content tables | `READY_FOR_REVIEW` | Migration `0020`; 7 PostgreSQL repository/constraint tests pass |
| D02 | Source-security links and four-dimension observations | `NOT_STARTED` | Multi-ticker FK/uniqueness fixture |
| D03 | Claims, citations, themes, narratives and relationships | `NOT_STARTED` | No dangling citation/claim test |
| D04 | Independent Reddit/X `run_source_slice` persistence | `NOT_STARTED` | Platform-isolation constraints |
| D05 | Cross-source summary persistence without component mutation | `NOT_STARTED` | Divergence/partial-state repository test |
| D06 | Idempotent/concurrent inserts and transactional outbox | `NOT_STARTED` | Concurrent upsert + crash test |
| D07 | Bounded-content, tombstone and rejected-discovery states | `NOT_STARTED` | HTML rejection and tombstone tests |
| D08 | FMP >500-member fixture support for integration migration   | `NOT_STARTED` | Valid/invalid atomic activation fixtures |
| D09 | Full DATA lane verification and handoff | `NOT_STARTED` | Report contract completed |

## Task evidence

### D01 — Canonical source, retrieval and content versions

- **Status:** `READY_FOR_REVIEW`
- **Files:** `apps/web/migrations/0020_rni_sources.sql`,
  `apps/web/src/rni/repositories/source-items.ts`,
  `apps/web/tests/integration/rni-persistence/source-items.test.ts`, and this progress file.
- **Tests:** `tsc --noEmit -p apps/web/tsconfig.json`; targeted ESLint; Vitest against a
  disposable PostgreSQL database (`7/7` passed); `git diff --check`.
- **Result:** canonical source identity is unique by platform/external ID and platform/URL;
  original URLs are retained; retrievals and changed bounded content are append-only; invalid
  platform provenance and whole-page HTML fail at database boundaries.
- **Risk:** CR-DATA-001 is additive but required before ENGINE can bind to the concrete adapter
  through a frozen port. D06 still owns the concurrent-upsert/outbox proof.
- **Handoff:** coordinator may review migration/repository semantics independently; no external
  service or credential is required.

## Required invariants

- One external source row, many security links and observations.
- Canonical URL is required for publishable Reddit/X evidence.
- Source transaction commits before downstream event is visible.
- Unique keys prevent duplicate sources, platform slices and observations.
- Reddit and X have different platform/source-slice identities.
- Combined rows reference but never overwrite component facts.
- No whole-page HTML or unrelated content is stored.
- No destructive rewrite of legacy `evidence_item`.

## Contract requests

| ID | Status | Request | Impact |
|---|---|---|---|
| CR-DATA-001 | `READY` | Freeze a source-persistence repository port that accepts `RniSourceItem` and returns the committed source identity plus idempotency outcome. | ENGINE persist-first workflow cannot bind to DATA without importing a DATA-private concrete adapter. |

### CR-DATA-001 — Source-persistence repository port

- **Current behaviour:** `apps/web/src/rni/contracts/index.ts` freezes `RniSourceItem` and
  `RniReadService.getEvidence`, but exposes no write/persistence interface for the ENGINE lane's
  injected source-first workflow.
- **Requested change:** add a frozen repository port accepting a validated `RniSourceItem` and
  returning the committed source ID plus whether the source, retrieval, and content version were
  newly inserted. The concrete DATA repository will remain in `apps/web/src/rni/repositories/**`.
- **Justification:** a DATA-private interface would become an undeclared cross-lane API, while
  duplicating the interface in ENGINE would violate the ownership boundary and could drift from
  the transaction/idempotency semantics.
- **Affected lanes:** DATA, ENGINE, and INTEGRATION composition; the comparative and duplicate-
  delivery fixtures.
- **Compatibility impact:** additive only; no existing frozen schema or read-service method needs
  to change.
- **Recommended acceptance test:** a fake implementing the frozen port and the concrete DATA
  adapter both accept the same `RniSourceItem`; duplicate delivery returns the original committed
  source ID, and semantic work receives no ID until the transaction commits.

## Test evidence

| Suite | Status | Command/run link | Notes |
|---|---|---|---|
| migration clean apply | `READY_FOR_REVIEW` | targeted D01 Vitest | Fresh schema applied through `0020`; 7/7 pass |
| migration forward apply | `NOT_STARTED` | — | D09 lane gate |
| repository unit | `READY_FOR_REVIEW` | typecheck + targeted ESLint | No errors |
| database integration | `READY_FOR_REVIEW` | targeted D01 Vitest | 7/7 pass against PostgreSQL |
| concurrency/idempotency | `NOT_STARTED` | — | D06 owns concurrent/outbox cases |
| repository required gate | `NOT_STARTED` | — | D09 lane gate |

## Review findings

| ID | Priority | Status | Finding | Resolution |
|---|---|---|---|---|
| — | — | — | — | — |

## Open risks/blockers

| Since | Status | Blocker | Owner | Attempted mitigation | Next check |
|---|---|---|---|---|---|
| 2026-09-05 | `READY` | CR-DATA-001: no frozen persistence repository port | coordinator | Concrete DATA adapter uses only frozen `RniSourceItem`; no contract edit made | Before ENGINE persistence binding |

## Commits

| SHA | Summary | Tests |
|---|---|---|
| this commit | D01 canonical source-first schema and repository | Typecheck, targeted lint, PostgreSQL 7/7 |

## Handoff

```text
RNI LANE     DATA
BRANCH       feat/rni-data-source-first
BASE SHA     86ec5b4757f45cbe96c651f413e8ff1109fef279
STATUS       PARTIAL
TASKS        1/9; D02-D09 incomplete
TESTS        D01 PostgreSQL integration 7/7; typecheck/lint pass
CONTRACT     CR-DATA-001
RISKS        frozen write port pending; concurrency/outbox deferred to D06
FILES        migration 0020; source-items repository; D01 persistence test; DATA.md
COMMITS      this commit (D01)
DEMO PROOF   duplicate source delivery returns one source; changed content appends a linked version
```
