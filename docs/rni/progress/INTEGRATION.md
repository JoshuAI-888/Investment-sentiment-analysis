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
| I02B | Resolve DATA/SURFACE contract requests | `READY_FOR_REVIEW` | `264ea9c`; D-RNI-09–12; narrow citation lookup plus explicit storage, pgvector, and universe-validation ownership decisions; contract 79 pass |
| I02C | Resolve CR-SURFACE-02 Radar read shape | `PASSED` | `84dca87`; D-RNI-13; additive cursor page with security identity and non-poolable Reddit/X/combined cells; contract 81 pass |
| I02D | Resolve CR-SURFACE-03 security-detail dimension read | `PASSED` | D-RNI-14; additive complete/cited per-platform dimension shape; focused 13 pass, full contract 83 pass/22 DB-skipped |
| I02E | Resolve CR-SURFACE-04 idempotent manual-refresh command boundary | `PASSED` | D-RNI-17; additive intent-only request and server-resolved accepted/duplicate result; contract 14/14 |
| I03 | Expand CI path filters for RNI prompts/agents/evals | `MERGED` | PR #5; actual `tests/eval/rni` path triggered and passed |
| I04 | Pin/verify pnpm 10.33.0 and build-script policy | `PASSED` | Clean frozen install and PR #5 web/scorer CI passed |
| I05 | Add forward universe migration and 600-member ceiling | `PASSED` | Independent re-review passed IR-01/03/05/06; focused validation 9 and fresh PostgreSQL activation/version gates 14 pass |
| I06 | Build FMP sync composition and minimal Settings route wiring | `PASSED` | Independent final review READY at `5950b53`; affected PostgreSQL 23/23 and focused 26/26 pass |
| I06R1 | Close universe activation, lineage and validation review findings | `PASSED` | One-way approval, stored-member/current-parent activation, lineage constraint, exact-500/date tests; PostgreSQL 14/14 |
| I06R2 | Add durable pre-fetch sync command and clean security bootstrap | `PASSED` | Pre-fetch claim, concurrent/replay one-fetch, terminal audits/lineage and clean 501-security import pass |
| I06R3 | Make command abandonment and stage completion fail-closed | `PASSED` | D-RNI-16; active conflict, stale terminalization, atomic rollback, invalid replay and bootstrap integrity tests pass |
| I06R4 | Retain abandoned-command provider lineage and prove bootstrap rollback | `PASSED` | typecheck/lint; PostgreSQL command/bootstrap 9/9; IR-10/11 resolved |
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
| CR-DATA-002 | DATA | `DEFERRED_TO_I07` | Keep storage-shaped semantic writes DATA-private until an implemented ENGINE consumer proves the smallest cross-lane port | DATA, ENGINE, INTEGRATION | `264ea9c` |
| CR-DATA-003 | DATA | `RESOLVED_NO_CHANGE` | pgvector remains deferred for this vertical slice; relational claim/narrative storage proceeds without an extension or placeholder | DATA, ENGINE, INTEGRATION | `264ea9c` |
| CR-DATA-004 | DATA | `RESOLVED_NO_CHANGE` | I06 synchronizer owns duplicate, completeness, NVDA, ambiguous, and unresolved validation; transport schema remains structural | DATA, INTEGRATION | `e535624` + `264ea9c` |
| CR-SURFACE-01 | SURFACE | `ACCEPTED` | Add `RniReadService.getCitation(citationId)` returning frozen `RniCitation`; evidence remains a second source-ID read | DATA, SURFACE, INTEGRATION | `264ea9c` |
| CR-SURFACE-02 | SURFACE | `ACCEPTED` | Add a cursor-paginated Radar page with run lineage, security identity, two non-poolable platform-labelled cells, and explicit pending/aligned/divergent/partial/insufficient cross-source state | DATA, ENGINE, SURFACE, INTEGRATION | `84dca87` / D-RNI-13 |
| CR-SURFACE-03 | SURFACE | `ACCEPTED` | Add a bounded security-detail read with canonical identity and exactly four cited dimension assignments for each independently labelled platform | DATA, ENGINE, SURFACE, INTEGRATION | `ce80424` / D-RNI-14 |
| CR-SURFACE-04 | SURFACE | `ACCEPTED` | Add an idempotent manual-refresh command boundary for ticker/full scope; server owns auth/audit/active config/universe/model/window resolution and returns one durable run identity plus resolved preview | ENGINE, SURFACE, INTEGRATION | D-RNI-17 / current I02E commit |

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

### CR-SURFACE-02 decision

- **Current behaviour:** the frozen service could read one summary by opaque security ID but
  could not enumerate Radar rows or render ticker, company and exchange identity.
- **Decision:** accept an additive `getRadarPage` cursor boundary. Each row owns canonical
  security identity, fixed Reddit/X platform cells and one explicit cross-source cell.
- **Compatibility:** existing read methods are unchanged. There is no shared source-count field;
  missing, pending and insufficient platforms cannot be relabelled as aligned/divergent output.
- **Affected lanes:** SURFACE implements the fixture/UI consumer; DATA and ENGINE eventually
  produce the storage/service projection; INTEGRATION composes the authenticated route at I08.
- **Acceptance:** the frozen NVDA/AMD page preserves a Reddit/X divergence, a one-platform
  partial result, independent sample counts and cursor semantics; fallback, relabelled and pooled
  shapes fail contract parsing.

### CR-SURFACE-03 decision

- **Current behaviour:** the frozen service exposed Radar cells and three-part summaries but no
  per-security, per-platform dimension assignments.
- **Decision:** accept additive `getSecurityDetail(runId, securityId)`. The result carries
  canonical security identity plus fixed Reddit/X records, each with exactly one assignment for
  all four frozen dimensions and independent state, count, coverage, confidence, freshness,
  summary and citation fields.
- **Compatibility:** existing read methods and Radar shapes are unchanged. Publishable dimensions
  require citations; insufficient dimensions are unscored; a non-publishable platform cannot
  carry a publishable dimension. There is no pooled count or unlabeled platform collection.
- **Affected lanes:** SURFACE implements the fixture/UI consumer; ENGINE produces assignments and
  citations; DATA/INTEGRATION later project the live read model.
- **Acceptance:** the NVDA fixture has all four dimensions for both sources and preserves a
  bullish-Reddit/bearish-X trading stance. Missing dimensions, pooled counts, cross-labelled
  platforms and uncited publishable assignments fail contract parsing.

### CR-SURFACE-04 decision

- **Current behaviour:** frozen reads and the ticker-oriented `rniRunRequest` could not express
  full-universe intent or accepted-versus-duplicate command results, so S07 could only simulate a
  write outside a shared boundary.
- **Decision:** accept additive `RniCommandService.requestManualRefresh`, with a required key and
  ticker/full intent. The result returns a durable run ID, exact-key disposition and a resolved
  canonical ticker or active-universe preview. A crossed-key scope must fail closed.
- **Ownership:** SURFACE may implement the fixture control and pending/double-submit behaviour;
  I09 owns authz, CSRF, audit, durable queue/run composition and server-side config/window/model
  binding. Existing read and run-request shapes are unchanged.
- **Acceptance:** typecheck/focused lint pass; RNI contract 14/14 and full contract 84 pass with 22
  database-only skips.

## Lane intake

| Lane | Review | Rebased | CI | Ownership clean | Merge status |
|---|---|---|---|---|---|
| DATA | `ACCEPTED` | yes at `4ab744e` | coordinator: typecheck, contract 81/22 skipped, fresh PostgreSQL 41/41 | yes | merged sequentially at `254fe45`; DR-01–05 closed |
| ENGINE | `E05_APPROVED` | yes through integration `6309b62`; next task rebases to `fec8c46` | builder serialized unit 1,254 + contract 93/22 skipped + integration 44/390 skipped + eval 2/2; coordinator typecheck/lint and focused 15/15 | yes | E01–E05 accepted through `5d9b8f3`; E06 active; lane remains held |
| SURFACE | `S06_APPROVED` | yes through I02D (`ce80424`) | builder typecheck/lint/contract/build/Chromium 11/11; coordinator repeated typecheck/lint/contract 13/13 and Chromium 11/11 | yes | S01–S06 accepted through `ffd5119`; S07 active; lane remains held |

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
| `apps/web/src/rni/contracts/index.ts`, `src/rni/testing/reference-fixtures.ts` | Resolve CR-SURFACE-01 with citation-ID lookup through the frozen read service | `264ea9c` | RNI contract 9 pass; full contract 79 pass/22 DB-skipped |
| `docs/features/RNI-00-CONTRACT.md`, `docs/MEMORY.md` | Record CR-DATA-002–004 and CR-SURFACE-01 outcomes as D-RNI-09–12 | `264ea9c` | contract/doc review |
| `apps/web/src/rni/contracts/index.ts`, `src/rni/testing/reference-fixtures.ts` | Resolve CR-SURFACE-02 with cursor-paginated, source-separated Radar reads | `84dca87` | typecheck; RNI contract 11 pass; full contract 81 pass/22 DB-skipped |
| `docs/features/RNI-00-CONTRACT.md`, `docs/MEMORY.md` | Record the non-poolable Radar read rule as D-RNI-13 | `84dca87` | contract/doc review |
| `apps/web/src/rni/contracts/index.ts`, `src/rni/testing/reference-fixtures.ts` | Resolve CR-SURFACE-03 with complete, cited, per-platform dimension reads | `CURRENT` | typecheck; lint; RNI contract 13 pass; full contract 83 pass/22 DB-skipped |
| `docs/features/RNI-00-CONTRACT.md`, `docs/MEMORY.md` | Record the security-detail dimension rule as D-RNI-14 | `CURRENT` | contract/doc review |
| `apps/web/migrations/0024_rni_universe_upgrade.sql`, `src/repositories/versions.ts`, `src/rni/universe/validate.ts` | Close activation, lineage and completeness review findings | `CURRENT` | typecheck; lint; validation 9; fresh PostgreSQL universe/versions 14 |

## Review findings

| ID | Priority | Status | Finding | Resolution |
|---|---|---|---|---|
| DR-01 | P1 | `RESOLVED` | Conflicting source external ID and canonical URL can resolve to different rows but the repository silently chooses one | `cb60846` rejects crossed natural keys and proves no retrieval is attached |
| DR-02 | P1 | `RESOLVED` | Citation FK does not require the cited source to equal its claim source | `cb60846` adds the composite claim/source FK and mismatch test |
| DR-03 | P1 | `RESOLVED` | Concrete runs accept nonexistent config/universe version strings | `cb60846` uses bigint version FKs and seeds real version lineage in tests |
| DR-04 | P2 | `RESOLVED` | Terminal tombstone timestamp/reason remain directly mutable at the database boundary | `cb60846` makes all terminal tombstone fields immutable and tests direct SQL rejection |
| DR-05 | P1 | `RESOLVED` | Narrative membership can attach a claim for one security to a narrative for another security | `5926601` enforces same-security membership, with null/global membership limited to null/global claims, and adds the opposing-security negative test |
| ER-01 | P1 | `RESOLVED` | Model-supplied excerpt/time is not bound to the exact consulted Web Search source | `58e5828` requires exact consulted URL and full field-scoped citations; `b3e8220` closes partial-span overlap |
| ER-02 | P1 | `RESOLVED` | A multi-call response can omit one action's source trace and still succeed | `58e5828` validates every action and fails closed on malformed/incomplete traces |
| ER-03 | P2 | `RESOLVED` | Prompt-injection fixture starts after provider generation but was described as an end-to-end guard | Claim narrowed to tool/output handling; pre-generation model resistance is explicitly E10 eval scope |
| ER-04 | P1 | `RESOLVED` | Existing X adapter reports usable partial responses out-of-band, but the RNI port erases that signal and may label the slice complete | `0e229d6` intercepts and forwards per-call violations, propagates completeness and maps usable partial data to a partial slice |
| ER-05 | P1 | `RESOLVED` | X authors are unsalted SHA-256 hashes of mutable usernames rather than tenant-scoped hashes of stable identity | `0e229d6` omits identity by default and permits only an injected tenant policy over stable provider author ID, with tenant/rename/privacy tests |
| ER-06 | P1 | `RESOLVED` | X content-version candidates do not identify exactly one latest interpretation version and A→B→A leaves B latest | `0e229d6` separates persistence versions from one latest interpretation candidate and records ordered A→B→A transitions |
| SR-04 | P2 | `RESOLVED` | S02's first commit left its task/evidence/handoff record stale and did not identify the actual browser gate | `c4899b8` amends the task commit with exact type, lint, contract, build and Chromium evidence plus complete files/risks/handoff |
| SR-05 | P1 | `RESOLVED` | S04 evidence dialogs reused citation-derived DOM IDs and lacked complete keyboard focus handling | `6c0df68` uses per-instance controls and proves focus entry/containment/Escape/restoration in Chromium 9/9 |
| IR-01 | P1 | `RESOLVED` | Universe activation can publish an unapproved, stale-parent or caller-altered FMP snapshot and can diverge selected count from stored members | FMP approval is one-way; activation requires the recorded admin, current parent, exact stored-member set and count; negative DB tests pass |
| IR-02 | P1 | `RESOLVED` | FMP synchronization claims idempotency only after the external provider call and payload-hash reuse does not bind a new key | Command is committed before fetch; concurrent/later replay performs one fetch per key; expected and unexpected terminal outcomes retain audit and provider/payload/version lineage |
| IR-03 | P1 | `RESOLVED` | An exactly 500-row FMP response passes the contract's greater-than-500 completeness gate | Minimum is 501 and the 500-row boundary test fails closed |
| IR-04 | P1 | `RESOLVED` | A clean deployment has only the 100-security legacy seed and cannot resolve a complete current FMP snapshot | Hash-bound reviewed FMP profile import transactionally creates/reuses 501–600 canonical identities; clean-schema 501-member sync passes |
| IR-05 | P2 | `RESOLVED` | Database columns allow an FMP universe version without endpoint, retrieval time, payload hash or provider-call lineage | Migration 0024 conditionally requires the full FMP lineage tuple; generic repository input cannot create FMP versions; direct insert fails |
| IR-06 | P2 | `RESOLVED` | Structurally valid but impossible constituent dates can reach PostgreSQL as unhandled timestamp errors | Validation requires an actual round-tripping calendar date and reports affected symbols; impossible-date test passes |
| IR-07 | P1 | `RESOLVED` | Claimed commands can remain permanently running after process termination and five-second replays can fail during a valid slow call | Active duplicate returns retryable conflict immediately; expired claim terminalizes with failure/replay audits and no provider call |
| IR-08 | P1 | `RESOLVED` | Staging commits separately from command completion and can leave an orphaned version or missing command lineage | Stage/reuse and successful command completion share one transaction; forced completion failure rolls both back before terminal failure is recorded |
| IR-09 | P2 | `RESOLVED` | Invalid-snapshot terminal persistence lacks a PostgreSQL replay/lineage assertion | Exact-500 database case binds provider/payload, records failure audit, creates no version and replays without fetch |
| IR-10 | P2 | `RESOLVED` | Bootstrap conflict, compatible reuse, rollback and append-only lineage branches lack acceptance coverage | Each conflict case now inserts a unique security before a later identity conflict and proves security/import/member/audit rollback |
| IR-11 | P2 | `RESOLVED` | A worker abandoned after provider dispatch can leave the terminal command without its already-persisted provider-call identity | Provider log and running-command binding share one transaction; post-dispatch abandonment retains the identity without refetch |

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
| `264ea9c` | Resolve remaining initial lane contract requests and freeze citation lookup | lint; typecheck; RNI contract 9 pass; full contract 79 pass/22 DB-skipped |
| `84dca87` | Accept CR-SURFACE-02 and freeze non-poolable Radar pagination | typecheck; focused/full lint; RNI contract 11 pass; full contract 81 pass/22 DB-skipped |
| `254fe45` | Merge accepted DATA lane into integration | coordinator typecheck; full contract 81 pass/22 DB-skipped; fresh PostgreSQL DATA 41/41 |
| `2607140` | Record DATA lane acceptance and close G3 | coordinator review and merged verification evidence |
| `6470823` | Record ENGINE E02 review findings | semantic review against source coverage, privacy and content-version requirements |
| `86db21e` | Close I06R2 with durable pre-fetch commands and governed security bootstrap | typecheck; focused lint; unit 1,179; contract 83 pass/22 DB-skipped; fresh PostgreSQL affected universe/version gates 17/17 |
| `CURRENT` | Record ENGINE E03 and SURFACE S03 coordinator acceptance | coordinator focused E03 17/17; typecheck; RNI contract 13/13; ownership/base/diff review |
| `58eef41` | Close I06R3 command lifecycle and atomicity findings | focused 42; unit 1,179; contract 83/22 skipped; fresh PostgreSQL affected 22; full integration 429/433 then failed-file 71/72 and isolated timing case pass |
| `5950b53` | Close I06R4 provider-lineage and rollback-evidence findings | typecheck; focused lint; focused 26/26; fresh PostgreSQL affected 23/23; independent READY |
| `CURRENT` | Accept SURFACE S04 evidence drawer and keyboard correction | typecheck; focused lint; RNI contract 13/13; Chromium 9/9; ownership/base/diff review |
| `CURRENT` | Accept SURFACE S05 bounded lineage explorer | typecheck; focused lint; RNI contract 13/13; Chromium 10/10; ownership/base/diff review |
| `CURRENT` | Accept ENGINE E04 security resolution and comparative relations | typecheck; focused lint; unit/contract/eval 19/19; ownership/base/diff review |
| `CURRENT` | Accept SURFACE S06 independent source-state matrix | typecheck; focused lint; RNI contract 13/13; Chromium 11/11; ownership/base/diff review |
| `CURRENT` | Resolve CR-SURFACE-04 with idempotent manual-refresh command | typecheck; focused lint; RNI contract 14/14; full contract 84/22 skipped |
| `CURRENT` | Accept ENGINE E05 target-isolated semantic classifier | typecheck; focused lint; unit/contract/eval 15/15; ownership/base/diff review |

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
- ENGINE E01 is accepted at `b3e8220` after an independent 16-test rerun; E02 is unblocked.
- CR-SURFACE-02 is accepted as D-RNI-13. SURFACE may consume I02C and start S02 without importing
  DATA repositories or inventing a local Radar response shape.
- DATA is accepted and merged at `254fe45`. All five coordinator findings are closed, ownership
  is clean, and the merged state passes typecheck, the full contract suite and all 41 DATA tests
  against a fresh disposable PostgreSQL cluster. CR-DATA-002 remains deliberately deferred until
  I07 has ENGINE E05's concrete consumer.
- ENGINE E02 `3b73f25` was initially held on ER-04–06: integration could not erase partial
  provider coverage, violate the tenant-salted author policy, or enqueue more than the final
  content version for interpretation.
- ENGINE E02 corrections are accepted at `0e229d6`; ER-04–06 are closed. Coordinator focused
  unit/contract tests pass 20/20 with clean typecheck and lint. Before E03, ENGINE must rebase on
  current integration so persist-first workflow uses the merged DATA repositories and frozen
  commit-returning source port rather than a lane-local substitute.
- SURFACE S02 is accepted at `c4899b8`. It consumes only the frozen Radar page, keeps Reddit/X
  counts, freshness, coverage and confidence visibly separate, and preserves divergent/partial
  combined states. Coordinator typecheck, focused lint, contract 11/11, production build and
  Chromium desktop/narrow/keyboard tests 4/4 pass. The branch remains unmerged until the lane is
  complete and the prescribed DATA→ENGINE→SURFACE order permits it.
- CR-SURFACE-03 is accepted as D-RNI-14. SURFACE must rebase the I02D contract before resuming
  S03, implement the fixture service method, and render dimensions only from the fixed Reddit/X
  detail records. The live DATA projection remains I07/I08 integration work.
- IR-02/04 are closed as D-RNI-15. The universe command is durably claimed before FMP dispatch
  and binds terminal provider/payload/version lineage; the reviewed profile import bootstraps a
  clean 501–600-security canonical master without activating a universe. I05/I06 are ready for
  independent re-review.
- ENGINE E03 is accepted at `1597eea`: the portable stage uses the frozen commit-returning source
  port, checkpoints only DATA's durable identity and covers lease/budget/retry/hash/crash rules;
  coordinator focused tests pass 17/17. SURFACE S03 is accepted at `b85d9c7`: the fixture detail
  consumes D-RNI-14 and renders four independently cited dimensions per platform; typecheck and
  RNI contract 13/13 pass. Both lanes remain unmerged and advance to E04/S04.
- I06R3 closes re-review IR-07–10 as D-RNI-16. Active duplicate commands return immediately with
  retry timing, abandoned claims terminalize without redispatch, and staging plus command success
  are atomic. PostgreSQL also proves invalid replay lineage, compatible bootstrap reuse,
  conflict rollback and append-only import mappings. I06 is ready for independent re-review.

## I06R3 handoff

- **Files changed:** migration `0024`; universe command/version and security repositories; FMP
  sync composition and HTTP route; focused service, route and PostgreSQL tests; deployment runbook;
  D-RNI-16; coordinator trackers.
- **Behaviour:** active same-key requests return a retryable `CONFLICT` without waiting or
  refetching. An expired claim becomes an audited terminal failure and is never automatically
  redispatched. Valid staging/reuse and command success share one transaction. Expected invalid
  snapshots remain replayable with provider/payload lineage and no version. Bootstrap identity
  ambiguity rolls back completely and import/member lineage is append-only.
- **Verification:** typecheck, focused lint and focused service/route/validation/contract tests
  42/42; serialized full unit 1,179/1,179; contract 83 pass with 22 database-only skips; fresh
  PostgreSQL affected command/bootstrap/universe/version suites 22/22. Full integration produced
  429/433 before the alias compatibility correction; the three failed files then passed 71/72
  with one known timing-sensitive attention case, which passed in exact isolation.
- **Risk/handoff:** authenticated FMP entitlement, secure profile-export source-rights review and
  ephemeral Neon forward migration remain deployment gates. A terminal abandoned key requires
  intentional operator inspection and a new key. No frozen contract changed.

## I06R4 handoff

- **Files changed:** universe command repository/composition; PostgreSQL command/bootstrap tests;
  deployment runbook; D-RNI-16; coordinator trackers.
- **Behaviour:** every persisted FMP call-log row is bound to the running command in the same
  transaction. If the worker is later abandoned, the terminal failure retains that provider
  identity and replay never redispatches. Bootstrap conflict tests insert a new canonical security
  before a later CIK/exchange ambiguity and prove the whole security/import/member/audit write set
  rolls back.
- **Verification:** typecheck and focused lint pass; fresh PostgreSQL command/bootstrap suite 9/9.
- **Risk/handoff:** independent final review returned READY with no actionable findings. The
  external entitlement/source-rights/forward-migration gates remain; no frozen contract changed.

## I06R2 handoff

- **Files changed:** migration `0024`; universe-command and security repositories; FMP sync
  composition/service; security-bootstrap CLI; focused unit/integration tests; deployment runbook;
  D-RNI-15; coordinator trackers.
- **Behaviour:** every environment/idempotency key is committed before FMP dispatch. Concurrent
  and later deliveries replay the same expected result without another fetch; provider,
  validation, success and unexpected post-fetch outcomes retain command audits and available
  provider/payload/version lineage. A reviewed, exact-hash-bound 501–600 FMP profile export
  transactionally creates or compatibly reuses canonical security identities and records an
  auditable import/replay without changing the active universe.
- **Verification:** typecheck and focused lint pass; focused sync/bootstrap 8/8; serialized full
  unit 1,179/1,179; contract 83 pass with 22 database-dependent skips; fresh disposable
  PostgreSQL command/bootstrap, universe-upgrade and version suites 17/17.
- **Risk/handoff:** authenticated FMP entitlement and an ephemeral Neon forward migration remain
  deployment gates. The bootstrap export is a human-reviewed secure artifact and must not be
  committed. I06 is ready for independent re-review; no frozen contract changed.

## I06R1 handoff

- **Files changed:** migration `0024`, universe version repository, FMP validation, activation and
  validation integration tests, and coordinator trackers.
- **Behaviour:** FMP lineage is mandatory in PostgreSQL; exactly 500 constituents and impossible
  dates fail validation; approval is a one-way staged lifecycle action; activation requires the
  recorded admin approver, the still-current parent, and exact equality between caller IDs,
  stored membership and immutable selected count.
- **Verification:** typecheck and focused lint pass; validation 9/9; fresh disposable PostgreSQL
  universe-upgrade plus legacy version/activation suites 14/14.
- **Risk/handoff:** I06 remains changes-requested until I06R2 claims idempotency before the FMP
  call and provides the clean 501-security bootstrap/import path. No frozen contract changed.

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
  identity, resolves every constituent against active canonical securities, requires 501–600
  unique members including NVDA, and creates an immutable staged version with impact preview and
  member lineage. Provider, partial, duplicate, unresolved, or ambiguous outcomes never replace
  the active universe. The stage helper reuses a request key or payload hash; I06R2 adds the
  required durable claim before the external call and binds every terminal outcome to the key.
- **Verification:** `pnpm lint`; `pnpm typecheck`; `pnpm test:unit` (1,175 pass);
  `pnpm test:contract` (78 pass, 22 database-dependent skipped); focused RNI service/route tests
  (16 pass); disposable PostgreSQL migration/staging tests (4 pass) and shared versions tests
  (9 pass); `pnpm check:copy`; `pnpm build` with `/api/rni/universe/sync` and
  `/admin/settings/universe` in the route manifest.
- **Risk/handoff:** the authenticated live FMP entitlement/capability probe and ephemeral Neon
  migration remain G7/G6 gates. The Settings page only identifies the governed preset and staging
  rule in this slice; activation UI/composition remains separate and must require `joshuai` in
  production. I06R2–R4 now provide the governed clean-deployment bootstrap, durable command,
  atomic stage completion, abandoned-command recovery and retained provider-call lineage; final
  independent review returned READY at `5950b53`.
