# RNI SURFACE Workstream Progress

**Writer:** SURFACE builder only  
**Branch:** `feat/rni-surface-demo`  
**Depends on:** merged RNI contract-freeze SHA; fixture-backed `RniReadService`  
**Status:** `IN_PROGRESS` — S04 evidence drawer ready for coordinator re-review; S05–S10 not started

## Owned paths

See `../RNI_BUILD_LOOP.md` §3.4. Shared layout/navigation and API composition remain integration-owned.

## Tasks

| ID  | Task                                                             | Status             | Acceptance evidence                        |
| --- | ---------------------------------------------------------------- | ------------------ | ------------------------------------------ |
| S01 | Typed fixture `RniReadService` and state catalogue               | `READY_FOR_MERGE`  | Citation resolution contract tests         |
| S02 | Retail Radar with Reddit/X/combined columns                      | `READY_FOR_MERGE`  | Coordinator accepted `c4899b8`             |
| S03 | Security detail and four dimensions per platform                 | `READY_FOR_MERGE`  | Coordinator accepted `b85d9c7`             |
| S04 | Evidence drawer with platform-labelled canonical citations       | `READY_FOR_REVIEW` | Citation provenance and SR-04 keyboard e2e |
| S05 | Raw data/lineage explorer                                        | `NOT_STARTED`      | Summary-to-source traversal e2e            |
| S06 | Per-platform freshness, run progress and partial/failure states  | `NOT_STARTED`      | State-matrix visual/e2e tests              |
| S07 | Manual ticker/full refresh controls and double-submit prevention | `NOT_STARTED`      | Idempotency UI test                        |
| S08 | S&P 500 search, NVDA default and universe Settings components    | `NOT_STARTED`      | Any-member search + staged preview fixture |
| S09 | Route/model display and Direct/Gateway future-run setting        | `NOT_STARTED`      | Setting/history immutability test          |
| S10 | Accessibility, responsive and full SURFACE handoff               | `NOT_STARTED`      | Required audits and lane report            |

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

| ID            | Status     | Request                                                                                                                                                                                                                            | Impact                                                                            |
| ------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| CR-SURFACE-01 | `ACCEPTED` | I02B / D-RNI-12 (`264ea9c`) adds `getCitation(citationId)` returning frozen `RniCitation`. Consumers must resolve citation ID → citation source ID → bounded evidence, never equate citation and source IDs.                       | S01 must implement the additive method; this unblocks S04’s evidence-drawer flow. |
| CR-SURFACE-02 | `ACCEPTED` | D-RNI-13 / `84dca87` adds frozen `getRadarPage` query/page schemas and `referenceRadarPage`. The page has canonical ticker/company/exchange identity plus separate Reddit, X and combined cells; no pooled source count exists.    | S02 may use only this frozen response shape and fixture.                          |
| CR-SURFACE-03 | `ACCEPTED` | D-RNI-14 / `ce80424` adds frozen `getSecurityDetail(runId, securityId)` with canonical identity, fixed Reddit/X detail records, exactly four cited platform-bound dimensions, and independent state/freshness/coverage/confidence. | S03 consumes only the additive read shape; Radar remains unchanged.               |

## Test evidence

| Suite                         | Status        | Command/run link                                                                                                                                                                                                                                                                                                                                                                                         | Notes                                                                                                                                                                |
| ----------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| component/contract            | `PASSED`      | `apps/web/node_modules/.bin/tsc --noEmit`; `apps/web/node_modules/.bin/vitest run tests/contract/rni/contracts.test.ts --no-file-parallelism`                                                                                                                                                                                                                                                            | Typecheck passed; frozen RNI contract suite passed (11/11).                                                                                                          |
| focused lint                  | `PASSED`      | `apps/web/node_modules/.bin/eslint fixtures/rni-ui/read-service.ts src/rni/ui/RetailRadar.tsx 'app/(rni)/rni/page.tsx' tests/e2e/rni/read-service.spec.ts tests/e2e/rni/radar.spec.ts`                                                                                                                                                                                                                   | All S02 implementation and test files passed lint.                                                                                                                   |
| production build              | `PASSED`      | `apps/web/node_modules/.bin/next build`                                                                                                                                                                                                                                                                                                                                                                  | Build passed and emitted the static `/rni` route.                                                                                                                    |
| e2e happy path                | `PASSED`      | `E2E_BASE_URL=http://127.0.0.1:3001 apps/web/node_modules/.bin/playwright test tests/e2e/rni/read-service.spec.ts tests/e2e/rni/radar.spec.ts --project=chromium`                                                                                                                                                                                                                                        | Chromium passed 4/4: fixture service (2), Radar desktop, and Radar narrow/keyboard.                                                                                  |
| e2e partial/divergent/failure | `PASSED`      | `E2E_BASE_URL=http://127.0.0.1:3001 apps/web/node_modules/.bin/playwright test tests/e2e/rni/read-service.spec.ts tests/e2e/rni/radar.spec.ts --project=chromium`                                                                                                                                                                                                                                        | NVDA proves divergent Reddit/X inputs; AMD proves X unavailable and combined partial.                                                                                |
| accessibility/keyboard        | `PASSED`      | `E2E_BASE_URL=http://127.0.0.1:3001 apps/web/node_modules/.bin/playwright test tests/e2e/rni/read-service.spec.ts tests/e2e/rni/radar.spec.ts --project=chromium`                                                                                                                                                                                                                                        | Keyboard tab traversal reaches a visible citation link.                                                                                                              |
| narrow screen                 | `PASSED`      | `E2E_BASE_URL=http://127.0.0.1:3001 apps/web/node_modules/.bin/playwright test tests/e2e/rni/read-service.spec.ts tests/e2e/rni/radar.spec.ts --project=chromium`                                                                                                                                                                                                                                        | At 375px the Radar stacks as cards without horizontal overflow.                                                                                                      |
| S03 component/contract        | `PASSED`      | `apps/web/node_modules/.bin/tsc --noEmit`; `apps/web/node_modules/.bin/eslint fixtures/rni-ui/read-service.ts src/rni/ui/SecurityDetail.tsx 'app/(rni)/rni/security/nvda/page.tsx' tests/e2e/rni/read-service.spec.ts tests/e2e/rni/security-detail.spec.ts`; `apps/web/node_modules/.bin/vitest run tests/contract/rni/contracts.test.ts --no-file-parallelism`                                         | Typecheck and focused lint passed; frozen RNI contract suite passed (13/13).                                                                                         |
| S03 browser/accessibility     | `PASSED`      | `E2E_BASE_URL=http://127.0.0.1:3002 apps/web/node_modules/.bin/playwright test tests/e2e/rni/read-service.spec.ts tests/e2e/rni/radar.spec.ts tests/e2e/rni/security-detail.spec.ts --project=chromium`                                                                                                                                                                                                  | Chromium passed 6/6: each platform has four dimensions, NVDA market-trading divergence, platform-labelled citations, 375px no overflow, and keyboard citation focus. |
| S04 component/contract        | `PASSED`      | `apps/web/node_modules/.bin/tsc --noEmit`; `apps/web/node_modules/.bin/eslint src/rni/ui/EvidenceCitation.tsx src/rni/ui/evidence.ts src/rni/ui/RetailRadar.tsx src/rni/ui/SecurityDetail.tsx 'app/(rni)/rni/page.tsx' 'app/(rni)/rni/security/nvda/page.tsx' tests/e2e/rni/evidence-drawer.spec.ts`; `apps/web/node_modules/.bin/vitest run tests/contract/rni/contracts.test.ts --no-file-parallelism` | Typecheck and focused lint passed; frozen RNI contract suite passed (13/13).                                                                                         |
| S04 browser/provenance        | `PASSED`      | `E2E_BASE_URL=http://127.0.0.1:3004 apps/web/node_modules/.bin/playwright test tests/e2e/rni/read-service.spec.ts tests/e2e/rni/radar.spec.ts tests/e2e/rni/security-detail.spec.ts tests/e2e/rni/evidence-drawer.spec.ts --project=chromium`                                                                                                                                                            | Chromium passed 9/9: provenance plus unique repeated-citation controls, focus entry, Tab/Shift+Tab containment, Escape dismissal, and trigger-focus restoration.     |
| repository required gate      | `NOT_STARTED` | —                                                                                                                                                                                                                                                                                                                                                                                                        | —                                                                                                                                                                    |

## Review findings

| ID    | Priority | Status     | Finding                                                                                                                   | Resolution                                                                                                                                    |
| ----- | -------- | ---------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| SR-01 | P1       | `RESOLVED` | Refreshing fixture returned a summary before both platform slices reached a terminal state.                               | Removed the summary; consumers derive the durable refresh state from run and platform-slice reads.                                            |
| SR-02 | P2       | `RESOLVED` | Initial test parsed fixture objects directly instead of exercising each successful service method and state relationship. | Targeted Playwright test now reads through the service across every catalogue state and asserts partial/refresh isolation.                    |
| SR-03 | P1       | `RESOLVED` | I02B added `getCitation`, making the pre-I02B fixture service structurally incomplete after rebase.                       | Fixture now resolves citation → source ID → bounded evidence and asserts platform, URL and evidence-text relationships.                       |
| SR-04 | P1       | `RESOLVED` | Evidence dialogs reused a citation-ID-derived DOM ID and did not complete focus handling.                                 | Per-instance `useId` controls plus focus entry, Tab/Shift+Tab containment, Escape dismissal, and trigger restoration are covered in Chromium. |

## Open risks/blockers

| Since      | Status     | Blocker                                                                                                        | Owner                       | Attempted mitigation                                                                               | Next check                     |
| ---------- | ---------- | -------------------------------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------ |
| 2026-09-05 | `OPEN`     | Fixture-only `/rni` composition requires the integration read service before live-data use.                    | INTEGRATION / SURFACE       | S04 resolves every displayed citation through the frozen read service and bounded source evidence. | Integration composition review |
| 2026-09-05 | `RESOLVED` | Static citation anchors did not provide citation → source → evidence provenance.                               | SURFACE                     | S04 renders platform-labelled evidence drawers from the frozen citation and evidence reads.        | Coordinator review of S04      |
| 2026-09-05 | `RESOLVED` | S03 needed four per-platform dimension assignments, which the previous frozen `RniReadService` could not read. | DATA / ENGINE / INTEGRATION | D-RNI-14 added `getSecurityDetail`; S03 uses it without direct repository access.                  | Coordinator review of S03      |

## Commits

| SHA       | Summary                                               | Tests                                                      |
| --------- | ----------------------------------------------------- | ---------------------------------------------------------- |
| `98a1064` | S01 fixture service rebased onto I02B                 | typecheck; contract 7; fixture Playwright 2                |
| `903a9da` | S01 citation-read compatibility                       | typecheck; contract 9; fixture Playwright 2                |
| `ec80ba1` | S02 source-separated Retail Radar                     | typecheck; lint; contract 11; build; Chromium Playwright 4 |
| `b85d9c7` | S03 platform-bound security detail                    | typecheck; lint; contract 13; build; Chromium Playwright 6 |
| `8bedac8` | S04 citation evidence drawer                          | typecheck; lint; contract 13; build; Chromium Playwright 8 |
| `CURRENT` | S04 dialog accessibility correction (see branch HEAD) | typecheck; lint; contract 13; build; Chromium Playwright 9 |

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
- **Handoff:** coordinator accepted the pre-rebase S02 commit `c4899b8`; its rebased lane commit is `ec80ba1` and is ready for merge.

## S03 delivery record

- **Files changed:** `apps/web/fixtures/rni-ui/read-service.ts`, `apps/web/app/(rni)/rni/security/nvda/page.tsx`, `apps/web/src/rni/ui/SecurityDetail.tsx`, `apps/web/tests/e2e/rni/read-service.spec.ts`, `apps/web/tests/e2e/rni/security-detail.spec.ts`, and this lane tracker.
- **Result:** `/rni/security/nvda` reads only frozen `getSecurityDetail` fixture data. Reddit and X each show their independently reported status, source count, freshness, confidence, coverage, platform summary, and exactly four fixed dimensions. The NVDA market-trading fixture is Reddit bullish versus X bearish; every publishable rationale keeps its platform-labelled citation link.
- **Verification:** typecheck, focused lint, frozen contract tests (13/13), and production build passed. Chromium passed the exact S03 browser command above (6/6), including desktop divergence, narrow no-overflow, and keyboard citation focus.
- **Risk:** the route remains fixture-composed until integration injects a live `RniReadService`; S04 must replace static citation anchors with citation → source → evidence navigation.
- **Handoff:** coordinator accepted S03 at `b85d9c7`; S04 is ready for coordinator review.

## S04 delivery record

- **Files changed:** `apps/web/app/(rni)/rni/page.tsx`, `apps/web/app/(rni)/rni/security/nvda/page.tsx`, `apps/web/src/rni/ui/EvidenceCitation.tsx`, `apps/web/src/rni/ui/evidence.ts`, `apps/web/src/rni/ui/RetailRadar.tsx`, `apps/web/src/rni/ui/SecurityDetail.tsx`, `apps/web/tests/e2e/rni/evidence-drawer.spec.ts`, and this lane tracker.
- **Result:** every Radar, combined-summary, platform-summary, and dimension citation opens a platform-labelled evidence drawer. Routes resolve `citationId → citation.sourceItemId → getEvidence(sourceItemId)` before rendering. The drawer presents only the frozen citation passage, canonical source URL, and bounded source evidence; it rejects a platform, URL, or bounded-text mismatch instead of treating a citation ID as a source ID.
- **Verification:** typecheck, focused lint, frozen contract tests (13/13), and production build passed. Chromium passed the exact S04 browser command above (9/9), including X Radar and Reddit dimension provenance navigation plus unique dialog controls and complete keyboard focus behavior.
- **Risk:** the route remains fixture-composed until integration injects a live `RniReadService`; no direct DATA repository access was added.
- **Handoff:** SR-04 is resolved and S04 is ready for coordinator re-review. S05 remains `NOT_STARTED`.

## Handoff

```text
RNI LANE     SURFACE
BRANCH       feat/rni-surface-demo
BASE SHA     ce80424
STATUS       PARTIAL
TASKS        S01–S03 ready for merge; S04 ready for coordinator review; S05–S10 not started
TESTS        typecheck: pass; focused lint: pass; RNI contract: 13 pass; production build: pass; Chromium Playwright: 9 pass
CONTRACT     CR-SURFACE-01 accepted at 264ea9c; CR-SURFACE-02 accepted at 84dca87; CR-SURFACE-03 accepted as D-RNI-14 at ce80424
RISKS        Integration must inject the live read service; S05 will add raw-data/lineage exploration without exposing unbounded content
FILES        apps/web/fixtures/rni-ui/read-service.ts; apps/web/app/(rni)/rni/page.tsx; apps/web/src/rni/ui/RetailRadar.tsx; apps/web/app/(rni)/rni/security/nvda/page.tsx; apps/web/src/rni/ui/SecurityDetail.tsx; apps/web/src/rni/ui/EvidenceCitation.tsx; apps/web/src/rni/ui/evidence.ts; apps/web/tests/e2e/rni/read-service.spec.ts; apps/web/tests/e2e/rni/radar.spec.ts; apps/web/tests/e2e/rni/security-detail.spec.ts; apps/web/tests/e2e/rni/evidence-drawer.spec.ts; docs/rni/progress/SURFACE.md
COMMITS      98a1064; 903a9da; ec80ba1; b85d9c7; 8bedac8; CURRENT (S04 SR-04 correction; see branch HEAD)
DEMO PROOF   `/rni` and `/rni/security/nvda` citations open platform-labelled drawers that expose each citation’s canonical URL and bounded source evidence; the X fixture citation resolves to source item `…024` rather than its citation ID `…016`
```
