# RNI SURFACE Workstream Progress

**Writer:** SURFACE builder only  
**Branch:** `feat/rni-surface-demo`  
**Depends on:** merged RNI contract-freeze SHA; fixture-backed `RniReadService`  
**Status:** `IN_PROGRESS` — S03 security detail blocked on a frozen read-boundary addition

## Owned paths

See `../RNI_BUILD_LOOP.md` §3.4. Shared layout/navigation and API composition remain integration-owned.

## Tasks

| ID  | Task                                                             | Status            | Acceptance evidence                        |
| --- | ---------------------------------------------------------------- | ----------------- | ------------------------------------------ |
| S01 | Typed fixture `RniReadService` and state catalogue               | `READY_FOR_MERGE` | Citation resolution contract tests         |
| S02 | Retail Radar with Reddit/X/combined columns                      | `READY_FOR_MERGE` | Coordinator accepted `c4899b8`             |
| S03 | Security detail and four dimensions per platform                 | `IN_PROGRESS`     | NVDA and divergence fixtures               |
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

| ID            | Status     | Request                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Impact                                                                            |
| ------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| CR-SURFACE-01 | `ACCEPTED` | I02B / D-RNI-12 (`264ea9c`) adds `getCitation(citationId)` returning frozen `RniCitation`. Consumers must resolve citation ID → citation source ID → bounded evidence, never equate citation and source IDs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | S01 must implement the additive method; this unblocks S04’s evidence-drawer flow. |
| CR-SURFACE-02 | `ACCEPTED` | D-RNI-13 / `84dca87` adds frozen `getRadarPage` query/page schemas and `referenceRadarPage`. The page has canonical ticker/company/exchange identity plus separate Reddit, X and combined cells; no pooled source count exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | S02 may use only this frozen response shape and fixture.                          |
| CR-SURFACE-03 | `OPEN`     | **Current behaviour:** frozen `RniReadService` exposes Radar cells and a three-section combined summary, but no per-security/per-platform `RniDimensionAssignment` read. **Requested change:** add a bounded security-detail read returning canonical security identity, separate Reddit and X dimension assignments for the four required keys, per-platform status/freshness/coverage/confidence, and citation IDs. **Justification:** S03 cannot truthfully render four dimensions per platform from the current read boundary. **Affected lanes:** SURFACE, DATA, ENGINE, INTEGRATION. **Compatibility:** additive read method/schema only; keep Radar unchanged. **Recommended acceptance:** NVDA fixture returns all four dimensions separately for Reddit and X, preserving divergent stances and citation IDs, and rejects missing/pooled platform data. | Blocks S03’s dimension detail while leaving S04–S10 unchanged.                    |

## Test evidence

| Suite                         | Status        | Command/run link                                                                                                                                                                       | Notes                                                                                 |
| ----------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| component/contract            | `PASSED`      | `apps/web/node_modules/.bin/tsc --noEmit`; `apps/web/node_modules/.bin/vitest run tests/contract/rni/contracts.test.ts --no-file-parallelism`                                          | Typecheck passed; frozen RNI contract suite passed (11/11).                           |
| focused lint                  | `PASSED`      | `apps/web/node_modules/.bin/eslint fixtures/rni-ui/read-service.ts src/rni/ui/RetailRadar.tsx 'app/(rni)/rni/page.tsx' tests/e2e/rni/read-service.spec.ts tests/e2e/rni/radar.spec.ts` | All S02 implementation and test files passed lint.                                    |
| production build              | `PASSED`      | `apps/web/node_modules/.bin/next build`                                                                                                                                                | Build passed and emitted the static `/rni` route.                                     |
| e2e happy path                | `PASSED`      | `E2E_BASE_URL=http://127.0.0.1:3001 apps/web/node_modules/.bin/playwright test tests/e2e/rni/read-service.spec.ts tests/e2e/rni/radar.spec.ts --project=chromium`                      | Chromium passed 4/4: fixture service (2), Radar desktop, and Radar narrow/keyboard.   |
| e2e partial/divergent/failure | `PASSED`      | `E2E_BASE_URL=http://127.0.0.1:3001 apps/web/node_modules/.bin/playwright test tests/e2e/rni/read-service.spec.ts tests/e2e/rni/radar.spec.ts --project=chromium`                      | NVDA proves divergent Reddit/X inputs; AMD proves X unavailable and combined partial. |
| accessibility/keyboard        | `PASSED`      | `E2E_BASE_URL=http://127.0.0.1:3001 apps/web/node_modules/.bin/playwright test tests/e2e/rni/read-service.spec.ts tests/e2e/rni/radar.spec.ts --project=chromium`                      | Keyboard tab traversal reaches a visible citation link.                               |
| narrow screen                 | `PASSED`      | `E2E_BASE_URL=http://127.0.0.1:3001 apps/web/node_modules/.bin/playwright test tests/e2e/rni/read-service.spec.ts tests/e2e/rni/radar.spec.ts --project=chromium`                      | At 375px the Radar stacks as cards without horizontal overflow.                       |
| repository required gate      | `NOT_STARTED` | —                                                                                                                                                                                      | —                                                                                     |

## Review findings

| ID    | Priority | Status     | Finding                                                                                                                   | Resolution                                                                                                                 |
| ----- | -------- | ---------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| SR-01 | P1       | `RESOLVED` | Refreshing fixture returned a summary before both platform slices reached a terminal state.                               | Removed the summary; consumers derive the durable refresh state from run and platform-slice reads.                         |
| SR-02 | P2       | `RESOLVED` | Initial test parsed fixture objects directly instead of exercising each successful service method and state relationship. | Targeted Playwright test now reads through the service across every catalogue state and asserts partial/refresh isolation. |
| SR-03 | P1       | `RESOLVED` | I02B added `getCitation`, making the pre-I02B fixture service structurally incomplete after rebase.                       | Fixture now resolves citation → source ID → bounded evidence and asserts platform, URL and evidence-text relationships.    |

## Open risks/blockers

| Since      | Status    | Blocker                                                                                                                                        | Owner                       | Attempted mitigation                                                                     | Next check                               |
| ---------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------- |
| 2026-09-05 | `OPEN`    | Fixture-only `/rni` composition and static citation anchors require the integration read service and S04 evidence drawer before live-data use. | INTEGRATION / SURFACE       | S02 uses only frozen `RniReadService.getRadarPage` and keeps every source distinct.      | S04 / integration composition review     |
| 2026-09-05 | `BLOCKED` | S03 needs four per-platform dimension assignments, which the frozen `RniReadService` cannot read.                                              | DATA / ENGINE / INTEGRATION | Recorded CR-SURFACE-03; no out-of-contract UI fixture or direct repository access added. | Coordinator disposition of CR-SURFACE-03 |

## Commits

| SHA       | Summary                                             | Tests                                                      |
| --------- | --------------------------------------------------- | ---------------------------------------------------------- |
| `52652e3` | S01 fixture service rebased onto I02B               | typecheck; contract 7; fixture Playwright 2                |
| `f73a17a` | S01 citation-read compatibility                     | typecheck; contract 9; fixture Playwright 2                |
| `CURRENT` | S02 source-separated Retail Radar (see branch HEAD) | typecheck; lint; contract 11; build; Chromium Playwright 4 |

## S01 delivery record

- **Files changed:** `apps/web/fixtures/rni-ui/read-service.ts`, `apps/web/tests/e2e/rni/read-service.spec.ts`, and this lane tracker.
- **Result:** fixture-only `RniReadService` covers complete, empty, partial, refreshing, stale, failed, and unpublished states; every state retains one Reddit and one X slice and returns defensive copies. The active refresh state deliberately has no combined summary.
- **Contract compatibility:** after rebasing on I02B (`264ea9c`), `FixtureRniReadService` implements `getCitation`. Tests prove a citation resolves to a same-platform source record whose bounded evidence contains the cited text; citation IDs are not treated as source IDs.
- **Risk:** S01 has no open contract blocker. S04 must consume the same citation flow when it adds UI navigation.
- **Handoff:** coordinator-approved fixture-only slice; citation compatibility is committed at `f73a17a` and ready for merge.

## S02 delivery record

- **Files changed:** `apps/web/fixtures/rni-ui/read-service.ts`, `apps/web/app/(rni)/rni/page.tsx`, `apps/web/src/rni/ui/RetailRadar.tsx`, `apps/web/tests/e2e/rni/read-service.spec.ts`, `apps/web/tests/e2e/rni/radar.spec.ts`, and this lane tracker.
- **Result:** `/rni` reads only frozen `getRadarPage` fixture data and renders ticker, company, exchange, individually labelled Reddit/X cells, and the derived combined cell. NVDA makes Reddit/X divergence explicit; AMD makes X unavailability and combined partial status explicit. No source counts are pooled or substituted.
- **Verification:** typecheck, focused lint, frozen contract tests (11/11), and production build passed. Chromium passed the exact focused command above (4/4), including desktop identity/divergence and 375px keyboard/no-overflow checks.
- **Risk:** the route remains fixture-composed until integration injects a live `RniReadService`; citation anchors provide source-labelled links but S04 must add citation → source → evidence navigation.
- **Handoff:** coordinator accepted S02 at `c4899b8`; S03 is now `IN_PROGRESS` pending CR-SURFACE-03.

## Handoff

```text
RNI LANE     SURFACE
BRANCH       feat/rni-surface-demo
BASE SHA     4ab744e
STATUS       BLOCKED
TASKS        S01 and S02 ready for merge; S03 in progress but blocked on CR-SURFACE-03; S04–S10 not started
TESTS        typecheck: pass; focused lint: pass; RNI contract: 11 pass; production build: pass; Chromium Playwright: 4 pass
CONTRACT     CR-SURFACE-01 accepted at 264ea9c; CR-SURFACE-02 accepted at 84dca87; CR-SURFACE-03 open
RISKS        S03 needs an additive detail read for four per-platform dimensions; S04 must replace static citation anchors with citation → source → evidence navigation; integration must inject the live read service
FILES        apps/web/fixtures/rni-ui/read-service.ts; apps/web/app/(rni)/rni/page.tsx; apps/web/src/rni/ui/RetailRadar.tsx; apps/web/tests/e2e/rni/read-service.spec.ts; apps/web/tests/e2e/rni/radar.spec.ts; docs/rni/progress/SURFACE.md
COMMITS      52652e3; f73a17a; CURRENT (S02 task commit; see branch HEAD)
DEMO PROOF   `/rni` fixture Radar shows NVDA — NVIDIA Corporation with Reddit bullish / X bearish / divergent and AMD — Advanced Micro Devices with X unavailable / combined partial; 375px cards and keyboard citation focus pass
```
