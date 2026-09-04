# RNI SURFACE Workstream Progress

**Writer:** SURFACE builder only  
**Branch:** `feat/rni-surface-demo`  
**Depends on:** merged RNI contract-freeze SHA; fixture-backed `RniReadService`  
**Status:** `IN_PROGRESS` — S01 typed fixture read service and state catalogue

## Owned paths

See `../RNI_BUILD_LOOP.md` §3.4. Shared layout/navigation and API composition remain integration-owned.

## Tasks

| ID  | Task                                                             | Status            | Acceptance evidence                        |
| --- | ---------------------------------------------------------------- | ----------------- | ------------------------------------------ |
| S01 | Typed fixture `RniReadService` and state catalogue               | `READY_FOR_MERGE` | Component contract tests                   |
| S02 | Retail Radar with Reddit/X/combined columns                      | `NOT_STARTED`     | Desktop/narrow/keyboard tests              |
| S03 | Security detail and four dimensions per platform                 | `NOT_STARTED`     | NVDA and divergence fixtures               |
| S04 | Evidence drawer with platform-labelled canonical citations       | `NOT_STARTED`     | Citation navigation e2e                    |
| S05 | Raw data/lineage explorer                                        | `NOT_STARTED`     | Summary-to-source traversal e2e            |
| S06 | Per-platform freshness, run progress and partial/failure states  | `NOT_STARTED`     | State-matrix visual/e2e tests              |
| S07 | Manual ticker/full refresh controls and double-submit prevention | `NOT_STARTED`     | Idempotency UI test                        |
| S08 | S&P 500 search, NVDA default and universe Settings components    | `NOT_STARTED`     | Any-member search + staged preview fixture |
| S09 | Route/model display and Direct/Gateway future-run setting        | `NOT_STARTED`     | Setting/history immutability test          |
| S10 | Accessibility, responsive and full SURFACE handoff               | `NOT_STARTED`     | Required audits and lane report            |

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

| ID            | Status | Request                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Impact                                                                             |
| ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| CR-SURFACE-01 | `OPEN` | **Current behaviour:** `RniReadService.getSecuritySummary()` returns citation IDs only, while `getEvidence()` accepts a `sourceItemId`; the frozen interface has no citation lookup or citation-to-source/span relation. **Requested change:** add a read-only citation-resolution method or include citation records (source item ID, platform, canonical URL and supporting span) in the security-summary read shape. **Justification:** the SURFACE evidence drawer and mandatory clickable source citations cannot resolve a summary citation through the existing interface without bypassing the service or guessing that a citation ID is a source ID. **Affected lanes:** SURFACE, DATA read model, INTEGRATION API composition, ENGINE synthesis fixtures. **Compatibility:** additive response/method only; existing consumers remain valid. **Recommended acceptance test:** a summary citation opens its persisted source item and exact bounded supporting span, rejects a mismatched platform/source, and never fetches a repository directly. | Blocks S04 and cited explanation rendering; S01 fixture service remains unblocked. |

## Test evidence

| Suite                         | Status        | Command/run link                                                                                                                              | Notes                                                                                                            |
| ----------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| component/contract            | `PASSED`      | `apps/web/node_modules/.bin/tsc --noEmit`; `apps/web/node_modules/.bin/vitest run tests/contract/rni/contracts.test.ts --no-file-parallelism` | Type check passed; frozen RNI contract suite passed (7 tests).                                                   |
| e2e happy path                | `PASSED`      | `E2E_BASE_URL=http://127.0.0.1:1 apps/web/node_modules/.bin/playwright test tests/e2e/rni/read-service.spec.ts --project=chromium`            | Fixture read-service contract passed (2 tests).                                                                  |
| e2e partial/divergent/failure | `PASSED`      | Same targeted Playwright fixture suite                                                                                                        | Exercises independent partial/unavailable and active refresh states; full surface divergence UI remains S02/S03. |
| accessibility/keyboard        | `NOT_STARTED` | —                                                                                                                                             | —                                                                                                                |
| narrow screen                 | `NOT_STARTED` | —                                                                                                                                             | —                                                                                                                |
| repository required gate      | `NOT_STARTED` | —                                                                                                                                             | —                                                                                                                |

## Review findings

| ID    | Priority | Status     | Finding                                                                                                                   | Resolution                                                                                                                 |
| ----- | -------- | ---------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| SR-01 | P1       | `RESOLVED` | Refreshing fixture returned a summary before both platform slices reached a terminal state.                               | Removed the summary; consumers derive the durable refresh state from run and platform-slice reads.                         |
| SR-02 | P2       | `RESOLVED` | Initial test parsed fixture objects directly instead of exercising each successful service method and state relationship. | Targeted Playwright test now reads through the service across every catalogue state and asserts partial/refresh isolation. |

## Open risks/blockers

| Since | Status | Blocker | Owner | Attempted mitigation | Next check |
| ----- | ------ | ------- | ----- | -------------------- | ---------- |
| —     | —      | none    | —     | —                    | —          |

## Commits

| SHA | Summary | Tests |
| --- | ------- | ----- |
| —   | —       | —     |

## S01 delivery record

- **Files changed:** `apps/web/fixtures/rni-ui/read-service.ts`, `apps/web/tests/e2e/rni/read-service.spec.ts`, and this lane tracker.
- **Result:** fixture-only `RniReadService` covers complete, empty, partial, refreshing, stale, failed, and unpublished states; every state retains one Reddit and one X slice and returns defensive copies. The active refresh state deliberately has no combined summary.
- **Risk:** `CR-SURFACE-01` blocks citation navigation and cited explanation rendering, but not S01.
- **Handoff:** independent re-review passed after resolving SR-01 and SR-02; no routes or UI components are added in S01.

## Handoff

```text
RNI LANE     SURFACE
BRANCH       feat/rni-surface-demo
BASE SHA     —
STATUS       PARTIAL
TASKS        S01 ready for coordinator review; S02–S10 not started
TESTS        typecheck: pass; RNI contract: 7 pass; fixture service Playwright: 2 pass
CONTRACT     CR-SURFACE-01 open
RISKS        Citation resolution is not representable through the frozen read service
FILES        apps/web/fixtures/rni-ui/read-service.ts; apps/web/tests/e2e/rni/read-service.spec.ts; docs/rni/progress/SURFACE.md
COMMITS      pending S01 review
DEMO PROOF   Fixture service returns independent Reddit/X slices for complete, partial, active-refresh, stale, failed and unpublished states
```
