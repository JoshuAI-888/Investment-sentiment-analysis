# RNI SURFACE Workstream Progress

**Writer:** SURFACE builder only  
**Branch:** `feat/rni-surface-demo`  
**Depends on:** merged RNI contract-freeze SHA; fixture-backed `RniReadService`  
**Status:** `BLOCKED` — S02 awaits a frozen Radar read shape

## Owned paths

See `../RNI_BUILD_LOOP.md` §3.4. Shared layout/navigation and API composition remain integration-owned.

## Tasks

| ID  | Task                                                             | Status            | Acceptance evidence                        |
| --- | ---------------------------------------------------------------- | ----------------- | ------------------------------------------ |
| S01 | Typed fixture `RniReadService` and state catalogue               | `READY_FOR_MERGE` | Citation resolution contract tests         |
| S02 | Retail Radar with Reddit/X/combined columns                      | `BLOCKED`         | Desktop/narrow/keyboard tests              |
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

| ID            | Status     | Request                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Impact                                                                            |
| ------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| CR-SURFACE-01 | `ACCEPTED` | I02B / D-RNI-12 (`264ea9c`) adds `getCitation(citationId)` returning frozen `RniCitation`. Consumers must resolve citation ID → citation source ID → bounded evidence, never equate citation and source IDs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | S01 must implement the additive method; this unblocks S04’s evidence-drawer flow. |
| CR-SURFACE-02 | `OPEN`     | **Current behaviour:** `RniReadService` can read one run, its global platform slices, one security summary by opaque security ID, citations and evidence. It cannot enumerate Radar securities, map a security ID to ticker/company/exchange, or return per-security Reddit/X/combined display records for a selected run. **Requested change:** add an additive, paginated Radar read method and frozen response shape containing run identity/freshness plus per-security identity (ID, ticker, company name, exchange), independently labelled Reddit and X result states, and combined status/summary. **Justification:** S02 cannot show mandatory ticker-plus-company Radar rows or independently calculated source columns from the existing methods without importing repositories or inventing a SURFACE-only read model. **Affected lanes:** DATA read model, ENGINE/fixture production, INTEGRATION route composition, SURFACE. **Compatibility:** additive only; existing read-service consumers remain valid. **Recommended acceptance test:** an RNI fixture returns NVDA and AMD rows with company names, preserves Reddit/X divergence or partial/unavailable state per row, and rejects any synthetic source fallback or source-count pooling. | Blocks S02; no implementation can proceed within the frozen boundary.             |

## Test evidence

| Suite                         | Status        | Command/run link                                                                                                                              | Notes                                                                                                            |
| ----------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| component/contract            | `PASSED`      | `apps/web/node_modules/.bin/tsc --noEmit`; `apps/web/node_modules/.bin/vitest run tests/contract/rni/contracts.test.ts --no-file-parallelism` | Type check passed; rebased frozen RNI contract suite passed (9 tests).                                           |
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
| SR-03 | P1       | `RESOLVED` | I02B added `getCitation`, making the pre-I02B fixture service structurally incomplete after rebase.                       | Fixture now resolves citation → source ID → bounded evidence and asserts platform, URL and evidence-text relationships.    |

## Open risks/blockers

| Since      | Status    | Blocker                                               | Owner       | Attempted mitigation                                                                                                              | Next check                                             |
| ---------- | --------- | ----------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 2026-09-05 | `BLOCKED` | S02 has no frozen Radar/security-identity read shape. | coordinator | Inspected all `RniReadService` methods and frozen schemas after rebasing I02B; no direct repository/provider import is permitted. | Coordinator accepts, rejects or narrows CR-SURFACE-02. |

## Commits

| SHA       | Summary                               | Tests                                       |
| --------- | ------------------------------------- | ------------------------------------------- |
| `3220e0d` | S01 fixture service rebased onto I02B | typecheck; contract 7; fixture Playwright 2 |
| `71010bd` | S01 citation-read compatibility       | typecheck; contract 9; fixture Playwright 2 |

## S01 delivery record

- **Files changed:** `apps/web/fixtures/rni-ui/read-service.ts`, `apps/web/tests/e2e/rni/read-service.spec.ts`, and this lane tracker.
- **Result:** fixture-only `RniReadService` covers complete, empty, partial, refreshing, stale, failed, and unpublished states; every state retains one Reddit and one X slice and returns defensive copies. The active refresh state deliberately has no combined summary.
- **Contract compatibility:** after rebasing on I02B (`264ea9c`), `FixtureRniReadService` implements `getCitation`. Tests prove a citation resolves to a same-platform source record whose bounded evidence contains the cited text; citation IDs are not treated as source IDs.
- **Risk:** S01 has no open contract blocker. S04 must consume the same citation flow when it adds UI navigation.
- **Handoff:** coordinator-approved fixture-only slice; citation compatibility committed at `71010bd` and ready for merge.

## Handoff

```text
RNI LANE     SURFACE
BRANCH       feat/rni-surface-demo
BASE SHA     264ea9c
STATUS       PARTIAL
TASKS        S01 ready for merge; S02 blocked on CR-SURFACE-02; S03–S10 not started
TESTS        typecheck: pass; RNI contract: 9 pass; fixture service Playwright: 2 pass
CONTRACT     CR-SURFACE-01 accepted at 264ea9c; CR-SURFACE-02 open
RISKS        S02 blocked pending a Radar read shape; S04 must use citation → source → evidence flow
FILES        apps/web/fixtures/rni-ui/read-service.ts; apps/web/tests/e2e/rni/read-service.spec.ts; docs/rni/progress/SURFACE.md
COMMITS      3220e0d; 71010bd
DEMO PROOF   Fixture service returns independent Reddit/X slices for complete, partial, active-refresh, stale, failed and unpublished states
```
