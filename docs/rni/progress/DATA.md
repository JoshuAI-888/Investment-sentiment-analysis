# RNI DATA Workstream Progress

**Writer:** DATA builder only  
**Branch:** `feat/rni-data-source-first`  
**Depends on:** merged RNI contract-freeze SHA  
**Status:** `NOT_STARTED`

## Owned paths

See `../RNI_BUILD_LOOP.md` §3.2. Any path outside that list requires a contract request.

## Tasks

| ID | Task | Status | Acceptance evidence |
|---|---|---|---|
| D01 | Canonical `rni_source_item` and retrieval/content tables | `NOT_STARTED` | Migration and repository tests |
| D02 | Source-security links and four-dimension observations | `NOT_STARTED` | Multi-ticker FK/uniqueness fixture |
| D03 | Claims, citations, themes, narratives and relationships | `NOT_STARTED` | No dangling citation/claim test |
| D04 | Independent Reddit/X `run_source_slice` persistence | `NOT_STARTED` | Platform-isolation constraints |
| D05 | Cross-source summary persistence without component mutation | `NOT_STARTED` | Divergence/partial-state repository test |
| D06 | Idempotent/concurrent inserts and transactional outbox | `NOT_STARTED` | Concurrent upsert + crash test |
| D07 | Bounded-content, tombstone and rejected-discovery states | `NOT_STARTED` | HTML rejection and tombstone tests |
| D08 | FMP >500-member fixture support for integration migration | `NOT_STARTED` | Valid/invalid atomic activation fixtures |
| D09 | Full DATA lane verification and handoff | `NOT_STARTED` | Report contract completed |

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
| — | — | none | — |

## Test evidence

| Suite | Status | Command/run link | Notes |
|---|---|---|---|
| migration clean apply | `NOT_STARTED` | — | — |
| migration forward apply | `NOT_STARTED` | — | — |
| repository unit | `NOT_STARTED` | — | — |
| database integration | `NOT_STARTED` | — | — |
| concurrency/idempotency | `NOT_STARTED` | — | — |
| repository required gate | `NOT_STARTED` | — | — |

## Review findings

| ID | Priority | Status | Finding | Resolution |
|---|---|---|---|---|
| — | — | — | — | — |

## Open risks/blockers

| Since | Status | Blocker | Owner | Attempted mitigation | Next check |
|---|---|---|---|---|---|
| — | — | none | — | — | — |

## Commits

| SHA | Summary | Tests |
|---|---|---|
| — | — | — |

## Handoff

```text
RNI LANE     DATA
BRANCH       feat/rni-data-source-first
BASE SHA     —
STATUS       NOT_STARTED
TASKS        0/9
TESTS        not run
CONTRACT     none
RISKS        none recorded
FILES        none
COMMITS      none
DEMO PROOF   none
```
