# RNI INTEGRATION Workstream Progress

**Writer:** coordinator/integrator only  
**Branch:** `feat/rni-integration-demo`  
**Status:** `IN_PROGRESS`

## Tasks

| ID | Task | Status | Acceptance evidence |
|---|---|---|---|
| I00 | Refresh `main`, inspect dirty state and repeat pinned clean gate | `PASSED` | PR #5 CI and Vercel preview green on merged base |
| I01 | Review and merge `fix/require-ai-model-routes-live-mode` | `MERGED` | PR #2, `09ad439` |
| I02 | Freeze RNI contracts, fixtures, routes and migration allocation | `MERGED` | PR #5 merge `dd28ea2`; source SHA `9908eda` |
| I02A | Resolve CR-DATA-001 source-persistence port | `READY_FOR_REVIEW` | `6b67657`; additive frozen contract; fake-port duplicate delivery returns the committed identity |
| I02B | Resolve DATA/SURFACE contract requests | `READY_FOR_REVIEW` | D-RNI-09–12; narrow citation lookup plus explicit storage, pgvector, and universe-validation ownership decisions; contract 79 pass |
| I03 | Expand CI path filters for RNI prompts/agents/evals | `MERGED` | PR #5; actual `tests/eval/rni` path triggered and passed |
| I04 | Pin/verify pnpm 10.33.0 and build-script policy | `PASSED` | Clean frozen install and PR #5 web/scorer CI passed |
| I05 | Add forward universe migration and 600-member ceiling | `READY_FOR_REVIEW` | Clean + forward PostgreSQL migration tests pass; 600 accepted and 601 rejected in DB and Zod |
| I06 | Build FMP sync composition and minimal Settings route wiring | `READY_FOR_REVIEW` | 501-member fixture stages once; partial/duplicate/unresolved responses fail closed; admin route, build, and PostgreSQL gates pass |
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
| CR-DATA-001 | DATA | `ACCEPTED` | Freeze additive commit-returning persistence port; concrete DATA adapter must pass the same duplicate-delivery semantics | DATA, ENGINE, INTEGRATION | `6b67657` |
| CR-DATA-002 | DATA | `DEFERRED_TO_I07` | Keep storage-shaped semantic writes DATA-private until an implemented ENGINE consumer proves the smallest cross-lane port | DATA, ENGINE, INTEGRATION | I02B task commit |
| CR-DATA-003 | DATA | `RESOLVED_NO_CHANGE` | pgvector remains deferred for this vertical slice; relational claim/narrative storage proceeds without an extension or placeholder | DATA, ENGINE, INTEGRATION | I02B task commit |
| CR-DATA-004 | DATA | `RESOLVED_NO_CHANGE` | I06 synchronizer owns duplicate, completeness, NVDA, ambiguous, and unresolved validation; transport schema remains structural | DATA, INTEGRATION | `e535624` + I02B task commit |
| CR-SURFACE-01 | SURFACE | `ACCEPTED` | Add `RniReadService.getCitation(citationId)` returning frozen `RniCitation`; evidence remains a second source-ID read | DATA, SURFACE, INTEGRATION | I02B task commit |

### CR-DATA-001 decision

- **Current behaviour:** the frozen contract defined the persisted `RniSourceItem` but no write
  port, leaving DATA/ENGINE transaction ordering as an undeclared boundary.
- **Decision:** accept a narrow additive `RniSourcePersistencePort.commitSource` interface. Its
  promise resolves after commit and returns `sourceItemId`, `sourceInserted`,
  `retrievalInserted`, and `contentVersionInserted`.
- **Compatibility:** additive; existing source, read-service, route, and fixture shapes are
  unchanged. ENGINE must enqueue from the returned ID rather than the caller-proposed ID.
- **Affected lanes:** DATA implements the concrete port and its transaction/idempotency tests;
  ENGINE consumes it for E03; INTEGRATION composes it at I07.
- **Acceptance:** the frozen fake returns the original durable identity with all insertion flags
  false on duplicate delivery. DATA must run the same case against its concrete adapter before
  handoff.

### I02B decisions

- **CR-DATA-002:** defer a public semantic write port until I07 has an implemented ENGINE
  consumer. DATA's relational table inputs remain private; the coordinator will freeze only the
  minimum consumed boundary.
- **CR-DATA-003:** confirm the existing pgvector deferral. Migration `0022` carries relational
  lineage only; a later embedding phase requires its own migration and Neon capability gate.
- **CR-DATA-004:** assign resolution semantics to the integration synchronizer implemented in
  I06. The frozen universe candidate remains a structural transport schema.
- **CR-SURFACE-01:** accept one additive citation lookup. A consumer resolves citation ID to the
  frozen citation record and then source ID to bounded evidence, without repository access.

## Lane intake

| Lane | Review | Rebased | CI | Ownership clean | Merge status |
|---|---|---|---|---|---|
| DATA | `CHANGES_REQUESTED` | no | local lane gates green; full integration legacy race reported | yes | held on DR-01–04 and CR-DATA-001 conformance |
| ENGINE | `CHANGES_REQUESTED` | no | focused 10, unit 1,180, contract 78, lint/type pass | yes | held on ER-01–03 source-lineage findings |
| SURFACE | `S01_APPROVED` | no | contract 7 + fixture Playwright 2 pass | yes | held for merge order and I02B rebase; S02 may proceed |

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
| `apps/web/migrations/0024_rni_universe_upgrade.sql` | Preserve historical universes while adding FMP lineage and raising the hard ceiling to 600 | `a7b13b6` | clean + forward PostgreSQL cases |
| `apps/web/src/contracts/config.ts`, `src/repositories/versions.ts` | Keep typed and application activation ceilings aligned with migration `0024` | `a7b13b6` | lint, typecheck, unit and integration suites |
| `apps/web/src/rni/contracts/index.ts`, `src/rni/testing/reference-fixtures.ts` | Resolve CR-DATA-001 with one commit-returning source-persistence boundary | `6b67657` | RNI contract test + full contract suite |
| `docs/features/RNI-00-CONTRACT.md`, `docs/MEMORY.md` | Record the accepted cross-lane persistence rule as D-RNI-08 | `6b67657` | contract/doc review |
| `apps/web/migrations/0024_rni_universe_upgrade.sql`, `src/repositories/versions.ts` | Make FMP snapshot staging immutable, auditable, payload-idempotent, and independent of activation | `e535624` | disposable PostgreSQL 501-member stage/replay test |
| `apps/web/src/adapters/fmp-universe.ts`, `src/rni/universe/**`, `app/api/rni/universe/sync/route.ts` | Compose authenticated FMP retrieval, strict validation, security-master resolution, and admin-only staging | `e535624` | adapter/unit, service/route integration, lint, typecheck, production build |
| `apps/web/app/(admin)/admin/settings/universe/page.tsx` | Identify the FMP-current preset and preserve separate human-approved activation on the existing Settings route | `e535624` | `check:copy`; production build route manifest |
| `apps/web/src/rni/contracts/index.ts`, `src/rni/testing/reference-fixtures.ts` | Resolve CR-SURFACE-01 with citation-ID lookup through the frozen read service | I02B task commit | RNI contract 9 pass; full contract 79 pass/22 DB-skipped |
| `docs/features/RNI-00-CONTRACT.md`, `docs/MEMORY.md` | Record CR-DATA-002–004 and CR-SURFACE-01 outcomes as D-RNI-09–12 | I02B task commit | contract/doc review |

## Review findings

| ID | Priority | Status | Finding | Resolution |
|---|---|---|---|---|
| DR-01 | P1 | `OPEN` | Conflicting source external ID and canonical URL can resolve to different rows but the repository silently chooses one | Returned to DATA; require crossed-natural-key failure test |
| DR-02 | P1 | `OPEN` | Citation FK does not require the cited source to equal its claim source | Returned to DATA; require composite claim/source FK and mismatch test |
| DR-03 | P1 | `OPEN` | Concrete runs accept nonexistent config/universe version strings | Returned to DATA; require existing-version FKs and rejection test |
| DR-04 | P2 | `OPEN` | Terminal tombstone timestamp/reason remain directly mutable at the database boundary | Returned to DATA; make terminal metadata immutable after transition |
| ER-01 | P1 | `OPEN` | Model-supplied excerpt/time is not bound to the exact consulted Web Search source | Returned to ENGINE; require exact provenance or URL-only abstention |
| ER-02 | P1 | `OPEN` | A multi-call response can omit one action's source trace and still succeed | Returned to ENGINE; validate every Web Search action fail-closed |
| ER-03 | P2 | `OPEN` | Prompt-injection fixture starts after provider generation but was described as an end-to-end guard | Returned to ENGINE; add pre-generation eval or narrow claim |

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
| `a7b13b6` | Forward-only universe lineage schema and 600-member ceiling | lint; typecheck; unit 1,172; contract 77 pass/22 DB-skipped; integration 358 pass/2 transient timing failures, both files green on immediate rerun (72 pass); I05 DB cases 3/3 pass |
| `6b67657` | Accept CR-DATA-001 and freeze the commit-returning persistence port | lint; typecheck; RNI contract 8 pass; full contract 78 pass/22 DB-skipped |
| `e535624` | Stage validated current FMP S&P 500 snapshots without activating them | lint; typecheck; unit 1,175; contract 78 pass/22 DB-skipped; RNI service/route 16 pass; PostgreSQL universe 4 pass + versions 9 pass; `check:copy`; production build |
| I02B task commit | Resolve remaining initial lane contract requests and freeze citation lookup | lint; typecheck; RNI contract 9 pass; full contract 79 pass/22 DB-skipped |

## Coordinator notes

- Never make another lane's code change to “save time”; return findings to that lane while its context is warm.
- Merge sequentially even though building is parallel.
- Update master progress after each merge or gate transition.
- DATA/ENGINE/SURFACE may now branch from `dd28ea2`; the contract source SHA is on `main` with green CI.
- I05 keeps `approved_by` immutable version content; migration `0024` does not broaden the existing append-only trigger exceptions. A disposable PostgreSQL forward test retained the pre-upgrade 100-member active row byte-for-byte across the selected lifecycle fields.
- The full integration run had two unrelated timing-sensitive failures in existing attention and market successor tests; an immediate isolated rerun passed all 72 tests. No I05 test failed.
- CR-DATA-001 is accepted as D-RNI-08. Builders should rebase/cherry-pick the I02A contract commit
  before implementing the concrete DATA port or ENGINE E03; neither lane should define a local
  substitute interface.
- I06 uses the existing security master as the only identity authority. It records every FMP
  attempt in `provider_call_log`, rejects incomplete or ambiguous responses before a version is
  created, and only stages an immutable candidate. No code path in this task activates it.
- The database tests that reset the shared public schema must run serially. A parallel diagnostic
  invocation collided during schema reset; the isolated universe and versions gates both passed.
- DATA and ENGINE handoffs were reviewed against the frozen contract and returned with open P1
  lineage findings; neither branch is merged. SURFACE S01 is approved as a fixture-only slice,
  but waits behind merge order and must consume I02B before citation work.

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

## I06 handoff

- **Files changed:** `apps/web/src/adapters/fmp-universe.ts`,
  `apps/web/src/rni/universe/{composition,sync,validate}.ts`,
  `apps/web/app/api/rni/universe/sync/route.ts`,
  `apps/web/app/(admin)/admin/settings/universe/page.tsx`,
  `apps/web/src/repositories/versions.ts`, migration `0024`, four focused integration tests,
  one adapter unit test, and this tracker.
- **Behaviour:** the admin-only, same-origin POST command requires an idempotency key, retrieves
  FMP's current constituent response through the governed wrapper, persists the provider-call
  identity, resolves every constituent against active canonical securities, requires 500–600
  unique members including NVDA, and creates an immutable staged version with impact preview and
  member lineage. Provider, partial, duplicate, unresolved, or ambiguous outcomes never replace
  the active universe. Replays by request key or payload hash return the original staged version.
- **Verification:** `pnpm lint`; `pnpm typecheck`; `pnpm test:unit` (1,175 pass);
  `pnpm test:contract` (78 pass, 22 database-dependent skipped); focused RNI service/route tests
  (16 pass); disposable PostgreSQL migration/staging tests (4 pass) and shared versions tests
  (9 pass); `pnpm check:copy`; `pnpm build` with `/api/rni/universe/sync` and
  `/admin/settings/universe` in the route manifest.
- **Risk/handoff:** the authenticated live FMP entitlement/capability probe and ephemeral Neon
  migration remain G7/G6 gates. The Settings page only identifies the governed preset and staging
  rule in this slice; activation UI/composition remains separate and must require `joshuai` in
  production. The active security master must already contain unambiguous records for every FMP
  constituent before a live candidate can stage.
