# RNI INTEGRATION Workstream Progress

**Writer:** coordinator/integrator only  
**Branch:** `feat/rni-integration-demo`  
**Status:** `READY`

## Tasks

| ID | Task | Status | Acceptance evidence |
|---|---|---|---|
| I00 | Refresh `main`, inspect dirty state and repeat pinned clean gate | `READY` | Preflight transcript/CI link |
| I01 | Review and merge `fix/require-ai-model-routes-live-mode` | `READY` | Merge SHA |
| I02 | Freeze RNI contracts, fixtures, routes and migration allocation | `NOT_STARTED` | Contract PR/CI/merge SHA |
| I03 | Expand CI path filters for RNI prompts/agents/evals | `NOT_STARTED` | Intentional trigger proof |
| I04 | Pin/verify pnpm 10.33.0 and build-script policy | `NOT_STARTED` | Clean frozen install/build |
| I05 | Add forward universe migration and 600-member ceiling | `NOT_STARTED` | Forward/clean migration tests |
| I06 | Build FMP sync composition and minimal Settings route wiring | `NOT_STARTED` | >500 fixture + invalid-response tests |
| I07 | Compose DATA repositories and ENGINE services | `NOT_STARTED` | Integration contract tests |
| I08 | Compose SURFACE routes/nav/API with auth | `NOT_STARTED` | Authenticated preview e2e |
| I09 | Wire QStash jobs/manual idempotent refresh | `NOT_STARTED` | Signed redelivery/double-click tests |
| I10 | Seed RNI Direct routes and optional Gateway selection | `NOT_STARTED` | Legacy route unchanged; parity test |
| I11 | Run live Reddit, X and FMP gates | `NOT_STARTED` | Provider audit IDs and screenshots/log links |
| I12 | Full regression, preview, production approval and smoke | `NOT_STARTED` | `joshuai` approval + production evidence |

## Contract-freeze checklist

- [ ] `RniPlatform` and coverage modes.
- [ ] Source and bounded-content schemas.
- [ ] Four dimensions and stance values.
- [ ] Reddit/X platform-slice lifecycle.
- [ ] Cross-source statuses and no-fallback rule.
- [ ] Citation/publication contract.
- [ ] Metric names, units and insufficient states.
- [ ] FMP universe sync and 600 safety ceiling.
- [ ] `RniReadService` plus command ports.
- [ ] Comparative, divergence, partial and FMP fixtures.
- [ ] Stable errors, API routes and migration allocations.
- [ ] CI RNI path filters.

## Contract requests

| ID | From | Status | Decision | Affected lanes | Contract SHA |
|---|---|---|---|---|---|
| — | — | — | none | — | — |

## Lane intake

| Lane | Review | Rebased | CI | Ownership clean | Merge status |
|---|---|---|---|---|---|
| DATA | `NOT_STARTED` | no | — | — | — |
| ENGINE | `NOT_STARTED` | no | — | — | — |
| SURFACE | `NOT_STARTED` | no | — | — | — |

## Live/deployment gates

| Gate | Status | Owner | Evidence |
|---|---|---|---|
| OpenAI Web Search five-source persistence | `NOT_STARTED` | coordinator | — |
| X independent adapter smoke | `NOT_STARTED` | coordinator | — |
| FMP authenticated current constituent probe | `NOT_STARTED` | coordinator + joshuai | — |
| S&P 500 universe impact approval | `NOT_STARTED` | joshuai | — |
| Production admin login | `NOT_STARTED` | joshuai | — |
| Preview full story | `NOT_STARTED` | coordinator | — |
| Production promotion | `NOT_STARTED` | joshuai | — |
| Production smoke | `NOT_STARTED` | coordinator | — |

## Shared-file change log

| File | Reason | Commit | Verified by |
|---|---|---|---|
| — | — | — | — |

## Review findings

| ID | Priority | Status | Finding | Resolution |
|---|---|---|---|---|
| — | — | — | — | — |

## Open risks/blockers

| Since | Status | Blocker | Owner | Attempted mitigation | Next check |
|---|---|---|---|---|---|
| 2026-09-05 | `READY` | FMP plan entitlement not yet probed | joshuai | Endpoint and fail-closed path specified | G7 |

## Integration commits

| SHA | Summary | Tests |
|---|---|---|
| — | — | — |

## Coordinator notes

- Never make another lane's code change to “save time”; return findings to that lane while its context is warm.
- Merge sequentially even though building is parallel.
- Update master progress after each merge or gate transition.
