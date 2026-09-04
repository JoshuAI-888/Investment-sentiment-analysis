# RNI INTEGRATION Workstream Progress

**Writer:** coordinator/integrator only  
**Branch:** `feat/rni-integration-demo`  
**Status:** `CONTRACT_PR_PENDING`

## Tasks

| ID | Task | Status | Acceptance evidence |
|---|---|---|---|
| I00 | Refresh `main`, inspect dirty state and repeat pinned clean gate | `LOCAL_PASS_CI_PENDING` | Base `e4570e3` merged at `353021d`; local gates rerun |
| I01 | Review and merge `fix/require-ai-model-routes-live-mode` | `MERGED` | PR #2, `09ad439` |
| I02 | Freeze RNI contracts, fixtures, routes and migration allocation | `PASS_ON_MERGE` | Contract source SHA `9908eda` |
| I03 | Expand CI path filters for RNI prompts/agents/evals | `PASS_ON_MERGE` | `.github/workflows/ci.yml` includes actual `tests/eval/rni` path |
| I04 | Pin/verify pnpm 10.33.0 and build-script policy | `LOCAL_PASS_CI_PENDING` | Clean frozen install, lint, typecheck, test and build passed |
| I05 | Add forward universe migration and 600-member ceiling | `NOT_STARTED` | Forward/clean migration tests |
| I06 | Build FMP sync composition and minimal Settings route wiring | `NOT_STARTED` | >500 fixture + invalid-response tests |
| I07 | Compose DATA repositories and ENGINE services | `NOT_STARTED` | Integration contract tests |
| I08 | Compose SURFACE routes/nav/API with auth | `NOT_STARTED` | Authenticated preview e2e |
| I09 | Wire QStash jobs/manual idempotent refresh | `NOT_STARTED` | Signed redelivery/double-click tests |
| I10 | Seed RNI Direct routes and optional Gateway selection | `NOT_STARTED` | Legacy route unchanged; parity test |
| I11 | Run live Reddit, X and FMP gates | `NOT_STARTED` | Provider audit IDs and screenshots/log links |
| I12 | Full regression, preview, production approval and smoke | `NOT_STARTED` | `joshuai` approval + production evidence |

## Contract-freeze checklist

- [x] `RniPlatform` and coverage modes.
- [x] Source and bounded-content schemas.
- [x] Four dimensions and stance values.
- [x] Reddit/X platform-slice lifecycle.
- [x] Cross-source statuses and no-fallback rule.
- [x] Citation/publication contract.
- [x] Metric names, units and insufficient states.
- [x] FMP universe sync and 600 safety ceiling.
- [x] `RniReadService` plus command request.
- [x] Comparative, partial and FMP fixtures/contracts.
- [x] Stable errors, API routes and migration allocations.
- [x] CI RNI path filters.

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
| `.github/workflows/ci.yml` | Route actual RNI agent/prompt/eval paths into judge job | `f8a54c1` | workflow review; PR CI pending |
| `apps/web/scripts/check-copy.ts`, `scripts/checks/copy.ts` | Scan RNI UI and allow only required standalone heading | `f8a54c1` | unit tests and `check:copy` pass |
| `docs/**`, `README.md`, `CLAUDE.md`, root `AGENTS.md` | Scoped precedence and non-clashing lane guidance | `f8a54c1` | local-link validation and adversarial review |

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
| `f8a54c1` | Full RNI specification pack, ownership, fixture, copy/CI convergence | lint; full tests; build; copy and calculation checks |
| `9908eda` | Frozen typed contract additions and contract cases | typecheck; contract (77 passed, 22 database-dependent skipped locally) |
| `353021d` | Merge concurrent password-auth PR #4 while preserving both decision logs | lint; typecheck; contract; production build |

## Coordinator notes

- Never make another lane's code change to “save time”; return findings to that lane while its context is warm.
- Merge sequentially even though building is parallel.
- Update master progress after each merge or gate transition.
- DATA/ENGINE/SURFACE must not branch until the contract source SHA is visible on `main` with green CI.
