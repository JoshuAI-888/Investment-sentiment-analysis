# RNI INTEGRATION Workstream Progress

**Writer:** coordinator/integrator only  
**Branch:** `feat/rni-integration-demo`  
**Status:** `READY_FOR_REVIEW`

## Tasks

| ID | Task | Status | Acceptance evidence |
|---|---|---|---|
| I00 | Refresh `main`, inspect dirty state and repeat pinned clean gate | `PASSED` | PR #5 CI and Vercel preview green on merged base |
| I01 | Review and merge `fix/require-ai-model-routes-live-mode` | `MERGED` | PR #2, `09ad439` |
| I02 | Freeze RNI contracts, fixtures, routes and migration allocation | `MERGED` | PR #5 merge `dd28ea2`; source SHA `9908eda` |
| I03 | Expand CI path filters for RNI prompts/agents/evals | `MERGED` | PR #5; actual `tests/eval/rni` path triggered and passed |
| I04 | Pin/verify pnpm 10.33.0 and build-script policy | `PASSED` | Clean frozen install and PR #5 web/scorer CI passed |
| I05 | Add forward universe migration and 600-member ceiling | `READY_FOR_REVIEW` | Clean + forward PostgreSQL migration tests pass; 600 accepted and 601 rejected in DB and Zod |
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
| `apps/web/migrations/0024_rni_universe_upgrade.sql` | Preserve historical universes while adding FMP lineage and raising the hard ceiling to 600 | I05 task commit | clean + forward PostgreSQL cases |
| `apps/web/src/contracts/config.ts`, `src/repositories/versions.ts` | Keep typed and application activation ceilings aligned with migration `0024` | I05 task commit | lint, typecheck, unit and integration suites |

## Review findings

| ID | Priority | Status | Finding | Resolution |
|---|---|---|---|---|
| — | — | — | — | — |

## Open risks/blockers

| Since | Status | Blocker | Owner | Attempted mitigation | Next check |
|---|---|---|---|---|---|
| 2026-09-05 | `READY` | FMP plan entitlement not yet probed | joshuai | Endpoint and fail-closed path specified | G7 |
| 2026-09-05 | `READY` | Migration `0024` has passed disposable local PostgreSQL only; ephemeral Neon forward apply remains a deployment gate | coordinator + joshuai | Clean and forward migration tests preserve the historical active version and enforce 600/601 | G6/G7 |

## Integration commits

| SHA | Summary | Tests |
|---|---|---|
| `f8a54c1` | Full RNI specification pack, ownership, fixture, copy/CI convergence | lint; full tests; build; copy and calculation checks |
| `9908eda` | Frozen typed contract additions and contract cases | typecheck; contract (77 passed, 22 database-dependent skipped locally) |
| `353021d` | Merge concurrent password-auth PR #4 while preserving both decision logs | lint; typecheck; contract; production build |
| `dd28ea2` | PR #5 contract-freeze merge to `main` | GitHub web/scorer/eval and Vercel preview green |
| I05 task commit | Forward-only universe lineage schema and 600-member ceiling | lint; typecheck; unit 1,172; contract 77 pass/22 DB-skipped; integration 358 pass/2 transient timing failures, both files green on immediate rerun (72 pass); I05 DB cases 3/3 pass |

## Coordinator notes

- Never make another lane's code change to “save time”; return findings to that lane while its context is warm.
- Merge sequentially even though building is parallel.
- Update master progress after each merge or gate transition.
- DATA/ENGINE/SURFACE may now branch from `dd28ea2`; the contract source SHA is on `main` with green CI.
- I05 keeps `approved_by` immutable version content; migration `0024` does not broaden the existing append-only trigger exceptions. A disposable PostgreSQL forward test retained the pre-upgrade 100-member active row byte-for-byte across the selected lifecycle fields.
- The full integration run had two unrelated timing-sensitive failures in existing attention and market successor tests; an immediate isolated rerun passed all 72 tests. No I05 test failed.

## I05 handoff

- **Files changed:** `apps/web/migrations/0024_rni_universe_upgrade.sql`,
  `apps/web/src/contracts/config.ts`, `apps/web/src/repositories/versions.ts`,
  `apps/web/tests/integration/versions.test.ts`,
  `apps/web/tests/integration/rni/universe-upgrade.test.ts`,
  `apps/web/tests/unit/contracts.test.ts`, and this tracker.
- **Behaviour:** the historical 100-member universe remains valid and unchanged; successor
  versions accept at most 600 members; FMP-origin members require provider symbol and company
  lineage; clean and forward migration paths expose auditable provider lineage columns.
- **Verification:** `pnpm lint`; `pnpm typecheck`; `pnpm test:unit` (1,172 pass);
  `pnpm test:contract` (77 pass, 22 database-dependent skipped); disposable PostgreSQL I05 +
  versions tests (12 pass); full disposable PostgreSQL integration run (358 pass, two existing
  timing failures), followed by both failed files passing on rerun (72 pass).
- **Risk/handoff:** run migration `0024` on an ephemeral Neon branch before preview. I06 must
  populate the new lineage fields and fail closed before creating a staged version; production
  activation remains human-owned by `joshuai`.
