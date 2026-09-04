# RNI SURFACE Workstream Progress

**Writer:** SURFACE builder only  
**Branch:** `feat/rni-surface-demo`  
**Depends on:** merged RNI contract-freeze SHA; fixture-backed `RniReadService`  
**Status:** `NOT_STARTED`

## Owned paths

See `../RNI_BUILD_LOOP.md` §3.4. Shared layout/navigation and API composition remain integration-owned.

## Tasks

| ID | Task | Status | Acceptance evidence |
|---|---|---|---|
| S01 | Typed fixture `RniReadService` and state catalogue | `NOT_STARTED` | Component contract tests |
| S02 | Retail Radar with Reddit/X/combined columns | `NOT_STARTED` | Desktop/narrow/keyboard tests |
| S03 | Security detail and four dimensions per platform | `NOT_STARTED` | NVDA and divergence fixtures |
| S04 | Evidence drawer with platform-labelled canonical citations | `NOT_STARTED` | Citation navigation e2e |
| S05 | Raw data/lineage explorer | `NOT_STARTED` | Summary-to-source traversal e2e |
| S06 | Per-platform freshness, run progress and partial/failure states | `NOT_STARTED` | State-matrix visual/e2e tests |
| S07 | Manual ticker/full refresh controls and double-submit prevention | `NOT_STARTED` | Idempotency UI test |
| S08 | S&P 500 search, NVDA default and universe Settings components | `NOT_STARTED` | Any-member search + staged preview fixture |
| S09 | Route/model display and Direct/Gateway future-run setting | `NOT_STARTED` | Setting/history immutability test |
| S10 | Accessibility, responsive and full SURFACE handoff | `NOT_STARTED` | Required audits and lane report |

## Required invariants

- Every ticker is shown with company name.
- NVDA is initial selection; search covers active S&P 500 membership.
- Reddit, X and combined sections are always distinct.
- Missing source never looks neutral or combined-complete.
- Divergence remains prominent.
- Every “why” statement has clickable citations filtered by platform.
- Freshness, coverage and confidence are separate labels.
- Sampled Reddit coverage disclosure is persistent.
- Settings uses local versioned data; page render never fans out to FMP.
- Costly/manual actions preview scope and prevent double submission.

## Contract requests

| ID | Status | Request | Impact |
|---|---|---|---|
| — | — | none | — |

## Test evidence

| Suite | Status | Command/run link | Notes |
|---|---|---|---|
| component/contract | `NOT_STARTED` | — | — |
| e2e happy path | `NOT_STARTED` | — | — |
| e2e partial/divergent/failure | `NOT_STARTED` | — | — |
| accessibility/keyboard | `NOT_STARTED` | — | — |
| narrow screen | `NOT_STARTED` | — | — |
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
RNI LANE     SURFACE
BRANCH       feat/rni-surface-demo
BASE SHA     —
STATUS       NOT_STARTED
TASKS        0/10
TESTS        not run
CONTRACT     none
RISKS        none recorded
FILES        none
COMMITS      none
DEMO PROOF   none
```
