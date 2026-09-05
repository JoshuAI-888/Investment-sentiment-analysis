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
| I02F | Resolve CR-SURFACE-05 active-universe and staged-preview reads | `PASSED` | D-RNI-18; separate read-only service, bounded search and count-reconciled immutable impact; RNI 15/15, full contract 85/22 skipped |
| I02F1 | Close universe-read contract review findings | `PASSED` | Independent re-review READY at `098f010`; legacy/FMP union, FMP floor and impossible-impact rejection; focused 15/15, full contract 85/22 skipped |
| I02G | Resolve CR-ENGINE-001 catalyst publication lineage | `PASSED` | D-RNI-19; claim-bound point-in-time social corroboration, separate model invocations and sentence trace assigned to I07/migration 0024 |
| I02H | Resolve CR-SURFACE-06 future-run AI route settings | `PASSED` | D-RNI-20; server-resolved Direct/Gateway read plus intent-only successor-config command; RNI contract 17/17, full contract 87/22 skipped |
| I03 | Expand CI path filters for RNI prompts/agents/evals | `MERGED` | PR #5; actual `tests/eval/rni` path triggered and passed |
| I04 | Pin/verify pnpm 10.33.0 and build-script policy | `PASSED` | Clean frozen install and PR #5 web/scorer CI passed |
| I05 | Add forward universe migration and 600-member ceiling | `PASSED` | Independent re-review passed IR-01/03/05/06; focused validation 9 and fresh PostgreSQL activation/version gates 14 pass |
| I06 | Build FMP sync composition and minimal Settings route wiring | `PASSED` | Independent final review READY at `5950b53`; affected PostgreSQL 23/23 and focused 26/26 pass |
| I06R1 | Close universe activation, lineage and validation review findings | `PASSED` | One-way approval, stored-member/current-parent activation, lineage constraint, exact-500/date tests; PostgreSQL 14/14 |
| I06R2 | Add durable pre-fetch sync command and clean security bootstrap | `PASSED` | Pre-fetch claim, concurrent/replay one-fetch, terminal audits/lineage and clean 501-security import pass |
| I06R3 | Make command abandonment and stage completion fail-closed | `PASSED` | D-RNI-16; active conflict, stale terminalization, atomic rollback, invalid replay and bootstrap integrity tests pass |
| I06R4 | Retain abandoned-command provider lineage and prove bootstrap rollback | `PASSED` | typecheck/lint; PostgreSQL command/bootstrap 9/9; IR-10/11 resolved |
| I07 | Compose DATA repositories and ENGINE services | `IN_PROGRESS` | D10 semantic and D12 analytics/convergence adapters merged; final cited-synthesis adapter/composition remains |
| I07D | Close DATA D10 exact semantic-identity review findings | `PASSED` | Migration 0024 requires one exact SHA-256 E05 output identity per run/security observation; PostgreSQL schema/universe 23/23 |
| I07E | Compose trusted cited-synthesis persistence boundary | `PASSED` | SQL-free trusted prepare, zero-model accepted replay and opaque-preparation atomic commit; composition 13/13, independent re-review PASS |
| I08 | Compose SURFACE routes/nav/API with auth | `NOT_STARTED` | Authenticated preview e2e |
| I09 | Wire QStash jobs/manual idempotent refresh | `NOT_STARTED` | Signed redelivery/double-click tests |
| I10 | Seed RNI Direct routes and optional Gateway selection | `IN_PROGRESS` | I10A starts versioned Direct/Gateway resolution and pre-dispatch budget enforcement under D-RNI-21; live parity remains I11 |
| I10A | Enforce balanced runtime model policy and exact route lineage | `PASSED` | Direct default, five-task Terra/Sol low mapping, fresh capabilities, Gateway provider/canonical identity and stable cache semantics; unit/contract/eval regression and independent review pass |
| I10B | Persist immutable route capabilities and atomic RNI AI budgets | `PASSED` | Additive migration 0024 schema; PostgreSQL 11/11 focused and 129/129 RNI regression; transports remain I10C |
| I10C | Compose live Direct/Gateway transports and governed recorder | `IN_PROGRESS` | I10C1 transport/recorder passed; live capability discovery and successor staging remain I10C2; no live claim until I11 |
| I10C1 | Compose provider-pinned transports and governed recorder | `PASSED` | Direct and OpenAI-only Gateway Responses adapters, immutable run-config loading, pre-dispatch reservation and usage-based settlement; PostgreSQL 153/153 serial RNI sweep |
| I10C2 | Discover capability/price evidence and stage successor config | `IN_PROGRESS` | Append-only Direct/Gateway evidence and reviewable staging only; activation remains human-owned and live proof remains I11 |
| I10C2A | Discover and persist capability/price evidence | `PASSED` | Direct identity lookup plus Gateway catalogue parsing; four append-only capabilities, five hashed price components and three-search reservation; focused 42/42 plus PostgreSQL 14/14 |
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
- [x] `RniReadService`, universe reads and command request.
- [x] Comparative, partial and FMP fixtures/contracts.
- [x] Stable errors, API routes and migration allocations.
- [x] CI RNI path filters.

## Contract requests

| ID | From | Status | Decision | Affected lanes | Contract SHA |
|---|---|---|---|---|---|
| CR-DATA-001 | DATA | `ACCEPTED` | Freeze additive commit-returning persistence port; concrete DATA adapter must pass the same duplicate-delivery semantics | DATA, ENGINE, INTEGRATION | `6b67657` |
| CR-DATA-002 | DATA | `ACCEPTED_FOR_I07` | D-RNI-22 freezes one atomic complete-E05-result port; storage rows stay DATA-private and the coordinator wrapper commits only after every security classifies | DATA, ENGINE, INTEGRATION | D-RNI-22 / current I07A commit |
| CR-DATA-003 | DATA | `RESOLVED_NO_CHANGE` | pgvector remains deferred for this vertical slice; relational claim/narrative storage proceeds without an extension or placeholder | DATA, ENGINE, INTEGRATION | `264ea9c` |
| CR-DATA-004 | DATA | `RESOLVED_NO_CHANGE` | I06 synchronizer owns duplicate, completeness, NVDA, ambiguous, and unresolved validation; transport schema remains structural | DATA, INTEGRATION | `e535624` + `264ea9c` |
| CR-DATA-005 | DATA | `ACCEPTED` | D-RNI-23 defines E07 overall stance from persisted E05 overall scores and the exact committed E06 weight trace; DATA validates the projection and rejects caller-only changes | DATA, ENGINE, INTEGRATION | D-RNI-23 |
| CR-ENGINE-001 | ENGINE | `ACCEPTED_FOR_I07` | Persist claim-bound point-in-time corroboration, separate verifier/challenger invocations, citation roles, analytics lineage and ordered sentence trace; no P0 source-kind expansion or factual-verification copy | DATA, ENGINE, INTEGRATION | D-RNI-19 / current I02G commit |
| CR-SURFACE-01 | SURFACE | `ACCEPTED` | Add `RniReadService.getCitation(citationId)` returning frozen `RniCitation`; evidence remains a second source-ID read | DATA, SURFACE, INTEGRATION | `264ea9c` |
| CR-SURFACE-02 | SURFACE | `ACCEPTED` | Add a cursor-paginated Radar page with run lineage, security identity, two non-poolable platform-labelled cells, and explicit pending/aligned/divergent/partial/insufficient cross-source state | DATA, ENGINE, SURFACE, INTEGRATION | `84dca87` / D-RNI-13 |
| CR-SURFACE-03 | SURFACE | `ACCEPTED` | Add a bounded security-detail read with canonical identity and exactly four cited dimension assignments for each independently labelled platform | DATA, ENGINE, SURFACE, INTEGRATION | `ce80424` / D-RNI-14 |
| CR-SURFACE-04 | SURFACE | `ACCEPTED` | Add an idempotent manual-refresh command boundary for ticker/full scope; server owns auth/audit/active config/universe/model/window resolution and returns one durable run identity plus resolved preview | ENGINE, SURFACE, INTEGRATION | D-RNI-17 / current I02E commit |
| CR-SURFACE-05 | SURFACE | `ACCEPTED` | Add a separate read-only universe service for active metadata/default, bounded any-member search, and immutable staged impact preview; legacy first-deployment parent remains representable; no provider or activation access | DATA, SURFACE, INTEGRATION | D-RNI-18 / current I02F1 correction |
| CR-SURFACE-06 | SURFACE | `ACCEPTED` | Add a future-run route setting read plus idempotent intent-only command; server resolves availability/models and creates a successor config without rewriting historical runs | ENGINE, SURFACE, INTEGRATION | D-RNI-20 / current I02H commit |

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

- **CR-DATA-002:** accepted as D-RNI-22 now that I07 has the concrete E05 consumer. The
  integration-owned `RniSemanticPersistencePort` accepts one durable run/source identity and the
  complete validated E05 result, commits it atomically and returns storage-selected identities.
  DATA's relational table inputs remain private; exact replay returns the original IDs and a
  crossed semantic identity fails closed.
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

### CR-SURFACE-05 decision

- **Current behaviour:** frozen universe candidate values supported synchronization, but surfaces
  could not read current membership, select NVDA by contract, search beyond Radar results or show
  an immutable staged impact without reaching into integration-owned repositories.
- **Decision:** accept a separate additive `RniUniverseReadService`. It exposes the active legacy
  or FMP version and NVDA default, case-insensitive ticker/company search over only that version
  with a 50-member ceiling, and a staged FMP preview whose full canonical add/remove sets reconcile
  counts. FMP reads require the validated 501–600 range and provider lineage.
- **Compatibility:** existing `RniReadService`, commands and candidate transport are unchanged.
  The new service cannot call a provider, synchronize, approve or activate a version.
- **Affected lanes:** SURFACE consumes the reference values for S08; INTEGRATION composes live
  repository reads at I08; DATA storage ownership is unchanged.
- **Acceptance:** the fixture contract returns NVDA, finds non-Radar MSFT from uppercase company
  search, represents a 100→501 legacy/FMP transition and rejects undersized FMP, staged
  identity/parent/count and impossible over-add/remove impacts; typecheck/lint, RNI 15/15 and full
  contract 85 pass with 22 database-only skips.

### CR-ENGINE-001 decision

- **Current behaviour:** accepted claim/citation rows do not own generic run membership,
  assessment cutoff, claim-specific evidence role, model invocation, analytics-artifact lineage or
  sentence trace. E08's first handoff therefore relied on caller-declared claim/cutoff/model values.
- **Decision:** D-RNI-19 accepts the additive persistence boundary for I07. Before integration
  merge, coordinator-owned migration `0024` will append separate model-invocation, claim-bound
  assessment/citation-role, analytics-lineage, challenger-selection and ordered publication-trace
  storage. The smallest frozen port will resolve trusted persisted inputs and commit accepted
  outputs; ENGINE remains SQL-free.
- **Source rights/publication:** P0 remains Reddit/X only. Separate retained social evidence may be
  labelled `corroborating` or `counterevidence`, never independent factual verification. A future
  primary/news source requires another explicit source-rights and source-kind decision.
- **Point in time:** claim evidence must be discovered and observed by the assessment cutoff;
  corroborating/counterevidence also requires a verified non-null publication time by the cutoff.
  Later evidence cannot enter that claim's model input. Publication revalidates platform-canonical
  URLs and the active rights-policy version; missing evidence remains unverified.
- **Compatibility/ownership:** the frozen portal summary/read shapes and source vocabulary remain
  unchanged. I07 composes the port and persistence; DATA may implement only the accepted
  repository adapter after rebasing, and ENGINE corrects its pure injected boundary without SQL.
- **Acceptance:** reject caller-altered claim/cutoff/model lineage, late-discovered/observed or
  unknown-publication corroboration, wrong-host/search-result URLs, inactive rights policies,
  self-citation and cross-run/security roles; persist/replay separate verifier/challenger runs and
  prove every non-coverage sentence resolves through stored citation edges.

### CR-SURFACE-06 decision

- **Current behaviour:** `RniAiRoute` existed only on immutable run records. SURFACE could neither
  read the active future-run route/model resolution nor request an audited change without inventing
  a client-owned config mutation.
- **Decision:** D-RNI-20 accepts additive `RniAiRouteSettingsService` schemas and service. The read
  returns active config/version/effective time, selected route, unique task-level resolved model
  identities and exactly one availability record for Direct and Gateway. The command accepts only
  idempotency key, route and bounded reason and returns the successor config setting.
- **Ownership:** SURFACE implements only fixture-backed presentation. I08 owns authenticated API
  composition; I10 owns capability checks, model mapping and route execution. Credentials and
  model selection remain server-owned. Gateway model identifiers are configured, not hardcoded.
- **Compatibility:** default Direct behavior and existing run/request/read shapes are unchanged.
  Success creates a new config version for later runs; prior run route/config and model-call
  lineage are immutable. Exact replay is duplicate and crossed-key intent fails.
- **Acceptance:** update Direct to configured Gateway, reread it, prove task models are resolved,
  reject unavailable Gateway/client model injection, replay exactly, reject crossed-key scope, and
  show an existing Direct run unchanged while a later run uses the successor Gateway config.

### Owner-approved I10 model and budget baseline

- **Decision:** D-RNI-21 keeps Direct as the default; `gpt-5.6-terra` with low reasoning serves
  discovery, relationship and classification, while `gpt-5.6-sol` with low reasoning serves
  verifier and challenger. Gateway is explicit same-OpenAI-family parity only, with configured
  slugs capability-checked at I10 and no silent cross-provider or unevaluated-model fallback.
- **Budget:** hard maximums are USD 2/manual ticker run, USD 25/full-universe run and USD 50 per
  rolling 24 hours; warn at USD 300/calendar month and stop at USD 500/calendar month. The RNI AI
  ledger includes model-token and OpenAI Web Search tool charges, with worst-case pre-dispatch
  reservation. X and FMP commercial charges stay outside this ledger.
- **Compatibility:** no frozen API shape changes. Historical run/config/model/cost lineage remains
  immutable. Any later model or limit change requires a successor version after evaluation.
- **Acceptance:** I10 must prove Direct default resolution, configured Gateway parity, unavailable-
  model fail-closed behavior, exact per-task model/reasoning lineage, hard-limit rejection, monthly
  warning observability and historical replay across a successor configuration.

## Lane intake

| Lane | Review | Rebased | CI | Ownership clean | Merge status |
|---|---|---|---|---|---|
| DATA | `ACCEPTED_THROUGH_D12` | D12 based `5a75969`; merged onto current integration | coordinator D12 15/15 then combined D12/I10B 26/26, typecheck/lint/diff; independent review PASS | yes | D12 merge `59ab04a`; CR-DATA-005 resolved by D-RNI-23 |
| ENGINE | `ACCEPTED` | yes at `e52052f`; final handoff `62eab1d` | coordinator focused E10 plus E08 57/1 live skip, full eval 18/1 live skip, typecheck/lint/diff pass; independent review PASS | yes | E01–E10 merged sequentially at `62eab1d`; ER-20–23 closed |
| SURFACE | `ACCEPTED` | yes at `01a088c`; code `c224c78`, tracker head `b60ec14` | coordinator typecheck/lint and expanded RNI contract 37/37; builder production build and complete Chromium 22/22; prior independent review PASS | yes | S01–S10 merged sequentially at `b60ec14` |

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
| ER-07 | P1 | `RESOLVED` | A zero-weight second source/group/community can satisfy the independent-source floor and remove single-source confidence caps while only one source contributes effective evidence | `ecbf049` derives effective source/community/cluster/author/narrative breadth from positive-weight traces; mixed positive/zero regression keeps sentiment/confidence insufficient at floor two |
| ER-08 | P2 | `RESOLVED` | E06 added two test files with blank lines at EOF, contradicting its branch-range diff-check claim | `ecbf049` removes only the EOF lines; `git diff --check 098f010..ecbf049` passes |
| ER-09 | P2 | `RESOLVED_BEFORE_HANDOFF` | The first observed E07 commit added a blank line at EOF in `convergence/types.ts` | The exact handoff `d1ef93a` removes the blank line; branch-range diff check passes |
| ER-10 | P1 | `RESOLVED` | E08 accepts old content first discovered/observed after a claim cutoff, does not cutoff-check claim evidence and exposes future evidence to the verifier before output validation | `b96162a` binds one trusted assessment cutoff, rejects future convergence/claim inputs and filters claim-specific corroboration/counterevidence before either model sees it |
| ER-11 | P1 | `RESOLVED` | Reddit/X-only corroboration publishes as an independently verified factual catalyst | `b96162a` uses explicit corroboration roles and bounded social-corroboration copy; in-scope output cannot claim factual verification |
| ER-12 | P1 | `RESOLVED` | Claim text/cutoff and one shared model-run descriptor are caller assertions; the trusted reader cannot prove persisted claim input or distinct verifier/challenger invocation lineage | `b96162a` revalidates exact persisted claims and separate trusted verifier/challenger invocation descriptors, with tamper/missing/swap tests |
| ER-13 | P1 | `RESOLVED` | Citation URL equality alone accepts consistently wrong-host/search-result lineage and does not bind the active rights policy | `b96162a` validates native Reddit/X canonical identity while preserving the stored original citation URL and requires the trusted active rights-policy version |
| ER-14 | P1 | `RESOLVED` | E09 routes only verifier/challenger while active relationship and classifier inference ports remain outside the governed model route/prompt boundary | `c4668b3` registers and adapts all five active tasks through the selected immutable route and recorder; focused Direct/Gateway tests pass |
| ER-15 | P1 | `RESOLVED` | Corrected task parsers were strict, but literal dynamic-input closing sentinels remained spoofable inside model-visible content | `80a5d2b` uses one byte-length/base64url envelope and adversarial generic/discovery tests prove embedded tags remain inert |
| ER-16 | P1 | `RESOLVED` | Reconstructed discovery/verification v1 definitions did not replay the originally accepted prompt bytes | `80a5d2b` preserves version-owned prompt/schema/serializer snapshots and compares exact accepted discovery-v1 and verification-v1 requests after successors exist |
| ER-17 | P1 | `RESOLVED` | `80a5d2b` retained billed telemetry but persisted attacker-controlled/provider failure text | `9a8a8f8` records one of six allowlisted codes with fixed bounded messages, rethrows original errors transiently, and proves hostile keys/values and fake secrets never enter durable generic/discovery failures |
| ER-18 | P1 | `RESOLVED` | E05 observation and E09 dispatch hashes previously used different JSON serialization | `80a5d2b` shares canonical serialization/hashing and proves each two-security observation hash equals its recorded exact dispatched-input hash and distinct call ID |
| ER-19 | P1 | `RESOLVED` | `apps/web/src/rni/model-input.ts` sat outside the ENGINE-owned subtrees in RNI_BUILD_LOOP §3.3 | `9a8a8f8` moves the serializer to `src/rni/agents/model-input.ts`; all imports resolve there and no ownership expansion remains |
| ER-20 | P1 | `RESOLVED` | E10 verifier/challenger live cases used fixture model/prompt descriptors, injected into a trusted methodology field and submitted empty claim evidence | `e41106a` uses active Sol verification/challenger v2 descriptors plus valid persisted Reddit/X evidence and production synthesis preparation with complete run/security/cutoff lineage |
| ER-21 | P1 | `RESOLVED` | E10 live validation read only the first output text, ignored additional/unknown output items and accepted uncited or wrong-community Reddit candidates | `e41106a` enforces one governed response envelope and production discovery citation/source/community binding, with extra-text, unknown-item, uncited and wrong-community negatives |
| ER-22 | P2 | `RESOLVED` | The D-RNI-21 Direct-default/low-reasoning eval compared test-local literals and an explicitly supplied route, so it proved no production behavior | `e41106a` labels the check as an evaluator expectation snapshot and explicitly defers production route behavior to I10 |
| ER-23 | P1 | `RESOLVED` | E10 semantic resistance accepted top-level insufficient classification with bullish dimensions, and verifier validation accepted duplicate assessments while omitting an expected claim | `62eab1d` matches the complete production insufficiency shape, requires exact unique verifier claim-ID equality and adds deterministic bullish-dimension and duplicate/omission negatives |
| ICR-01 | P1 | `RESOLVED` | D-RNI-18 cannot represent the preserved 100-member legacy active parent of the first staged FMP candidate, while undersized FMP versions pass | Active is an explicit legacy/FMP union; FMP active/staged variants require 501–600 and a 100→501 fixture passes |
| ICR-02 | P1 | `RESOLVED` | Balanced arithmetic permits complete impact arrays that remove more members than active or add more members than staged | Frozen schema rejects both bounds; I08 retains repository-backed membership-set acceptance |
| SR-04 | P2 | `RESOLVED` | S02's first commit left its task/evidence/handoff record stale and did not identify the actual browser gate | `c4899b8` amends the task commit with exact type, lint, contract, build and Chromium evidence plus complete files/risks/handoff |
| SR-05 | P1 | `RESOLVED` | S04 evidence dialogs reused citation-derived DOM IDs and lacked complete keyboard focus handling | `6c0df68` uses per-instance controls and proves focus entry/containment/Escape/restoration in Chromium 9/9 |
| SR-06 | P1 | `RESOLVED` | S07 revealed scope only after submission and permanently reused one key per scope | `55b01ef` previews ticker/full scope before action and uses a new key for each intentional request |
| SR-07 | P1 | `RESOLVED` | S07's 25 ms fixture made double-submit browser coverage timing-dependent | `a28121e` injects a deferred command and proves both controls remain disabled until explicit release; Chromium 4/4 twice |
| SR-08 | P1 | `RESOLVED` | S07 emitted its deferred fixture harness as an unguarded production route | `babd940` forces request-time evaluation and returns not-found outside validated fixture mode; guard test passes |
| SR-09 | P1 | `RESOLVED` | S08 constructed the fixture universe service inside the production client component, leaving I08 no server-side live-composition seam | `f929ab8` composes `RniUniverseReadService` in the server page and keeps the UI props-only |
| SR-10 | P1 | `RESOLVED` | Fixture search hardcoded exact MSFT tokens, ignored limit and did not parse the frozen query/result | `f929ab8` parses the frozen query, searches an explicit catalogue by case-insensitive ticker/company substring, enforces limit/hasMore and covers initial/partial/mixed-case/empty/over-limit reads |
| SR-11 | P1 | `RESOLVED` | Staged Settings discarded canonical added/removed identities and rendered counts only | `f929ab8` renders canonical ticker/company/exchange additions and removals with an explicit empty state; Chromium asserts PLTR and distinct versions |
| SR-12 | P1 | `RESOLVED` | S08 claimed READY without its required test row, task record, risks, resolved blocker, commits or current handoff | `f929ab8` reconciles the complete S08 lane record in the same commit |
| SR-13 | P2 | `RESOLVED` | S08 browser coverage used programmatic fill and dynamic search results had no announced status | `f929ab8` adds a labelled polite status and Chromium Tab/type/Tab/Enter submission coverage |
| SR-14 | P2 | `RESOLVED` | S08 implemented legacy-active source/retrieval copy but tested only the FMP active variant | `f929ab8` routes both variants through a pure presentation helper and directly covers the legacy/null-retrieval branch without a production fixture selector |
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
| `CURRENT` | Accept SURFACE S07 idempotent manual-refresh controls | typecheck; focused lint; RNI contract 14/14; guard 1/1; deterministic Chromium 4/4 twice |
| `CURRENT` | Resolve CR-SURFACE-05 with read-only universe selection boundary | typecheck; focused lint; RNI contract 15/15; full contract 85/22 skipped |
| `CURRENT` | Review ENGINE E06 platform analytics | typecheck; focused lint; focused unit/contract/eval 17/17; ER-07 returned |
| `CURRENT` | Accept corrected ENGINE E06 platform analytics | typecheck; focused lint; focused unit/contract/eval 18/18; branch diff check; ownership/base review |
| `CURRENT` | Review SURFACE S08 universe settings | typecheck; focused lint; RNI contract 15/15; production build; Chromium 1/1; SR-09–12 returned |
| `CURRENT` | Close I02F universe-read P1 review findings | typecheck; focused lint; RNI contract 15/15; full contract 85/22 skipped; independent re-review READY at `098f010` |
| `CURRENT` | Accept ENGINE E07 deterministic cross-source facts | typecheck; focused lint; unit/contract/eval 21/21; branch diff check; ownership/base review |
| `CURRENT` | Accept corrected SURFACE S08 universe settings | typecheck; focused lint; RNI contract 15/15; production build; Chromium 3/3; independent adversarial review READY; ownership/base/diff review |
| `CURRENT` | Resolve CR-ENGINE-001 as D-RNI-19 and return E08 ER-10–13 | first handoff typecheck; scoped lint; focused unit/contract/eval 31/31; branch diff check; independent adversarial review CHANGES REQUESTED |
| `CURRENT` | Resolve CR-SURFACE-06 as D-RNI-20 and freeze future-run route settings | typecheck; focused lint; RNI contract 17/17; full contract 87/22 skipped; exact replay/crossed-key/history tests |
| `CURRENT` | Accept corrected ENGINE E08 cited synthesis | final `b96162a` descends `a8ed02e`; code byte-identical to reviewed `3132589`; typecheck; scoped lint; focused unit/contract/eval 46/46; branch diff check; independent adversarial review READY |
| `CURRENT` | Review ENGINE E09 model routing and prompt registry | `a6177d3` descends `f4f7318`; typecheck; scoped lint; focused router plus E08 regression 57/57; branch diff check; independent adversarial review CHANGES REQUESTED on ER-14–17 |
| `CURRENT` | Lock owner-approved RNI model and AI-spend baseline as D-RNI-21 | Direct default; Terra/low discovery/relationship/classification; Sol/low verifier/challenger; Gateway parity without silent fallback; USD 2/25/50 hard and USD 300 warning/500 monthly stop; documentation validation |
| `CURRENT` | Re-review corrected ENGINE E09 routing | `c4668b3` descends `bdb23ce`; coordinator focused router 17/17, E08 regression 46/46, typecheck/scoped lint/diff pass; ER-14 closed, independent adversarial review CHANGES REQUESTED on ER-15–18 |
| `CURRENT` | Accept SURFACE S09 future-run AI route settings | `8d1d943` descends `bdb23ce`; coordinator typecheck/lint, RNI contract 17/17, production build and Chromium 3/3; independent adversarial review PASS; S10 remains |
| `CURRENT` | Accept final SURFACE S10 accessibility/responsive audit | `c68980b` descends `87742d0`; ownership/diff, typecheck, focused lint, RNI contract 17/17, production build and Chromium 22/22 pass; independent adversarial review PASS |
| `CURRENT` | Record SURFACE accepted-state handoff | tracker-only `5d9cd3d` marks S01–S10 ready for merge; clean branch remains unmerged behind ENGINE |
| `CURRENT` | Re-review ENGINE E09 ER-15–18 correction | `80a5d2b` descends `00e0d23`; coordinator typecheck/scoped lint and affected 97/97 pass; ER-15/16/18 close, independent adversarial review CHANGES REQUESTED on persisted error sanitization and out-of-lane serializer placement |

| `CURRENT` | Accept final ENGINE E09 routing correction | `9a8a8f8` descends `25023b9`; coordinator typecheck/scoped lint, affected 97/97, diff/ownership/frozen-contract checks and independent adversarial review PASS; ER-14–19 closed |
| `CURRENT` | Review ENGINE E10 release/live-resistance eval | `e5293f2` descends `bb151ff`; unit 1,345, contract 107/22 skipped, available integration 44/390 skipped, eval 12/1 live skip, typecheck/full lint/diff/CI-scope pass; independent adversarial review CHANGES REQUESTED on ER-20–22 |
| `CURRENT` | Re-review corrected ENGINE E10 live-resistance semantics | `e41106a` descends `6b4902c`; focused E10 9/1 live skip, E08 46/46, full eval 16/1 live skip, typecheck/full lint/diff/ownership pass; ER-20–22 closed, independent adversarial review CHANGES REQUESTED on ER-23 |
| `CURRENT` | Accept and merge final ENGINE E10 | `62eab1d` descends `e52052f`; coordinator focused E10 plus E08 57/1 live skip, full eval 18/1 live skip, typecheck/lint/diff pass; independent adversarial review PASS; ER-20–23 closed |
| `CURRENT` | Refresh, accept and merge final SURFACE lane | code `c224c78`, tracker/merge head `b60ec14` descends `01a088c`; coordinator typecheck/focused lint/expanded RNI contract 37/37 pass; builder build and Chromium 22/22 pass |
| `CURRENT` | Start I07 DATA/ENGINE composition | all three lanes merged in required order; resolve CR-DATA-002 only from the concrete E05 consumer and prove the smallest durable boundary with integration contracts |
| `CURRENT` | Freeze I07 semantic composition as D-RNI-22 | SQL-free complete-E05-result port plus persist-after-all-security wrapper; focused integration 3/3, typecheck and scoped lint pass; DATA transaction adapter remains |
| `CURRENT` | Add D-RNI-22 semantic storage to migration 0024 | nullable historical-compatible claim dimension, immutable run/observation membership and exact E05 quality sidecar; clean/forward disposable PostgreSQL migration gate 5/5 |
| `CURRENT` | Compose E06/E07 artifact persistence boundary | Reddit/X artifacts commit independently; convergence binds their exact complete-artifact hashes and rejects crossed storage identity; focused composition 5/5, typecheck/scoped lint pass |
| `CURRENT` | Persist D-RNI-19 cited-synthesis lineage in migration 0024 | PostgreSQL schema/universe 23/23; typecheck/scoped lint/diff pass; four adversarial P1 findings closed; independent re-review PASS; broader persistence 38/41 because three superseded D05 standalone-write expectations now reach the intended trace guard and are assigned to DATA D11 |
| `CURRENT` | Start I07D after DATA D10 adversarial review | D10 focused 9/9 and DATA 50/50 pass, but review found storage-rounding identity collision plus incomplete four-dimension/input-hash-set validation; shared hash column assigned to coordinator and adapter corrections returned to DATA |
| `CURRENT` | Complete I07D shared exact semantic identity | required SHA-256 `semantic_output_hash` on immutable run-observation membership; synthesis/universe PostgreSQL 23/23, typecheck/scoped lint/diff pass; DATA owns canonical producer and remaining shape/replay tests |
| `CURRENT` | Start I07E cited-synthesis composition | define the smallest trusted preparation, accepted replay and exact atomic-commit identity boundary around E08 while DATA adapters proceed independently |
| `CURRENT` | Complete I07E cited-synthesis composition | focused composition 13/13, typecheck/scoped lint/diff pass; initial P1/P2 replay/preparation/failure findings corrected; independent re-review PASS |
| `CURRENT` | Re-review DATA D10/D11 corrected handoff | `825e68c` based `a161b6b`; coordinator focused 13/13, full DATA 50/50, typecheck/lint/diff pass; D11 and original D10 findings close, but cross-run exact-hash attachment remains P1 and was returned to DATA |
| `CURRENT` | Accept and merge final DATA D10/D11 | final `7dd9454` rebased on `2099936`; cross-run identity finding closed; coordinator post-merge DATA/composition/PostgreSQL 87/87, typecheck/focused lint/diff pass; independent re-review PASS |
| `CURRENT` | Start I10A versioned route and budget enforcement | D-RNI-21 is owner-approved; implement Direct-default task resolution, capability-gated same-family Gateway parity and atomic pre-dispatch USD 2/25/50/500 enforcement with USD 300 warning; no credential values enter code or trackers |
| `CURRENT` | Complete I10A runtime route policy | Direct defaults to exact Terra/Sol task mapping with low reasoning; all invocations retain dispatch, canonical model, capability and policy lineage; Gateway discovery requires actual OpenAI provider metadata; unit 1,360, contract 107/22 skipped, RNI eval 18/1 live skip, typecheck/lint/diff and independent re-review PASS |
| `CURRENT` | Start I10B persisted routing and AI budget substrate | Extend coordinator-owned migration 0024 only: immutable capability/config/run lineage plus atomic worst-case reservation, settlement, rolling-day/month enforcement and once-only warning evidence under D-RNI-21 |
| `CURRENT` | Resolve CR-DATA-005 overall convergence provenance | D-RNI-23 makes overall platform stance a deterministic weighted projection of persisted E05 overall scores through the exact E06 current weight trace; no frozen contract or schema expansion |
| `CURRENT` | Complete I10B persisted routing and AI budget substrate | Migration 0024 preserves activation and per-call capability snapshots, exact run/config/task lineage, synthesis invocation identity, numeric reservation/settlement, 2/25/50/300/500 enforcement and once-only monthly warnings; focused 11/11 and full RNI PostgreSQL 129/129 |
| `CURRENT` | Accept and merge DATA D12 analytics/convergence persistence | corrected tip `cf2b635` closes exact observation/component/slice lineage and D-RNI-23 overall projection findings; coordinator D12 15/15 and post-merge D12/I10B 26/26 with typecheck/lint/diff pass; merge `59ab04a` |
| `CURRENT` | Start I10C live transport/configuration composition | Add server-only Direct and provider-pinned Gateway adapters, capability discovery/config loading and an I10B-backed invocation recorder; credentials are environment-only and live evidence remains I11 |
| `CURRENT` | Complete I10C1 governed transport and recorder composition | Direct and OpenAI-only Gateway adapters validate exact provider/model routing; immutable run routes survive successor activation; reservation precedes dispatch and settlement uses provider token/tool telemetry rather than provider-reported cost |
| `CURRENT` | Start I10C2 capability and successor-staging composition | Discover exact Direct/Gateway model identities and current price evidence into append-only records, then create an immutable staged successor for review without activating it or claiming live parity |
| `CURRENT` | Complete I10C2A catalogue and price evidence | D-RNI-24; Direct lookup plus Gateway catalogue yield four append-only capability snapshots and five exact hashed price components; discovery reserves all three governed Web Search calls; focused 42/42 and PostgreSQL 14/14 |

## I10A handoff

- **Status:** `PASSED`; I10 remains `IN_PROGRESS` for versioned database configuration,
  capability snapshots, transports and budget reservation/settlement.
- **Files changed:** `apps/web/src/rni/config/model-policy.ts`,
  `apps/web/src/rni/config/index.ts`, `apps/web/src/rni/agents/model-router.ts`,
  `apps/web/src/rni/discovery/openai-web-search.ts`, `apps/web/src/rni/discovery/types.ts`, and
  focused unit/contract/eval tests.
- **Tests run:** full unit 1,360/1,360; full contract 107/107 with 22 database-gated skips;
  RNI eval 18/18 with one credential-gated live skip; TypeScript; scoped ESLint; diff check.
- **Result:** Direct is the default when route intent is absent. Runtime policy must resolve all
  five tasks exactly once: Terra/low for discovery, relationship and classifier; Sol/low for
  verifier and challenger. Capability evidence must be fresh and complete. Gateway dispatch
  slugs remain configured data while canonical OpenAI identity and actual provider metadata are
  independently validated; capability-only refreshes retain prompt-cache identity.
- **Risks/handoff:** no credential was read and no live provider claim is made. I10B must persist
  immutable capability/config lineage and atomic budget reservations; I11 must prove live Direct
  and Gateway responses. Frozen contracts were not changed. Independent review returned PASS
  after Direct alias, Gateway-provider, arbitrary-config, cache-key and telemetry findings closed.

## I10B handoff

- **Status:** `PASSED`; I10 remains `IN_PROGRESS` for I10C live Direct/Gateway transport,
  configuration activation and application adapters.
- **Files changed:** `apps/web/migrations/0024_rni_universe_upgrade.sql` and
  `apps/web/tests/integration/rni/model-routing-budget.test.ts`.
- **Tests run:** focused I10B PostgreSQL 11/11; complete RNI PostgreSQL integration 129/129;
  full unit 1,360/1,360; full contract 107/107 with 22 database-gated skips; RNI eval 18/18
  with one credential-gated live skip; TypeScript, scoped ESLint and diff check.
- **Result:** config activation requires the exact five balanced routes, no fallback, approved
  policy versions/limits and fresh OpenAI capability evidence. Capability refreshes append new
  snapshots without rewriting the active config; every invocation pins the fresh exact snapshot
  it used. A database-serialized reservation prices maximum input/output plus the discovery Web
  Search call, permits exact boundaries and denies over-limit or unpriced dispatches. Settlement
  supersedes the estimate once; absent/ambiguous settlement retains the reservation. Verifier and
  challenger ledger IDs must equal their prepared synthesis invocation IDs.
- **Risks/handoff:** migration 0024 still requires an ephemeral Neon rehearsal before preview.
  I10C must expose these functions only through server-owned adapters and stage a successor
  configuration from live capability discovery; production activation remains an explicit human
  action and I11 owns provider request evidence. Frozen RNI contracts and credentials were
  untouched.

## I10C1 handoff

- **Status:** `PASSED`; I10 remains `IN_PROGRESS` for I10C2 capability discovery, price evidence
  and successor configuration staging. No live provider or deployment claim is made.
- **Files changed:** `apps/web/src/env.ts`, `apps/web/src/repositories/versions.ts`,
  `apps/web/src/services/jobs/{index,rni-model-runtime}.ts`, migration `0024`, focused environment,
  transport and PostgreSQL route/budget tests, this tracker, the master tracker and deployment
  runbook.
- **Tests run:** focused environment/transport 39/39; focused PostgreSQL route/budget plus
  transport 20/20; complete serialized RNI PostgreSQL integration 153/153; full unit
  1,362/1,362; full contract 107/107 with 22 database-gated skips; RNI eval 18/18 with one
  credential-gated live skip; TypeScript, scoped ESLint and diff check.
- **Result:** live processes require the Direct-default OpenAI credential independently of the
  legacy application transport. Direct sends governed Responses requests. Gateway sends the same
  evaluated OpenAI family with an explicit OpenAI-only provider filter, no model fallback and
  fail-closed validation of returned provider/model-attempt metadata. One immutable five-task run
  config is loaded from fresh capability evidence. Every invocation reserves the applicable
  I10B price-book maximum before dispatch and settles only from complete token and Web Search
  telemetry; provider-reported cost is retained as telemetry but cannot settle the ledger.
- **Risks/handoff:** capability catalogue discovery, price evidence and successor staging remain
  I10C2. Ambiguous calls deliberately retain their reservation for reconciliation. The disposable
  PostgreSQL suites share schema state and therefore require `--no-file-parallelism`; the initial
  parallel sweep collided during resets, while the serialized complete sweep passed 153/153.
  No credential value was read or stored and no frozen contract changed.

## I10C2A handoff

- **Status:** `PASSED`; I10C2 remains `IN_PROGRESS` for input-bound enforcement and successor
  staging. Activation and live Responses parity remain I11/human gates.
- **Files changed:** `apps/web/src/services/jobs/{index,rni-model-catalogue}.ts`,
  `apps/web/src/repositories/versions.ts`, migration `0024`, focused catalogue and PostgreSQL
  route/budget tests, D-RNI-24, deployment runbook and both coordinator trackers.
- **Tests run:** focused environment/catalogue/runtime 42/42; focused PostgreSQL route, catalogue
  and budget 14/14; TypeScript, scoped ESLint and diff check.
- **Result:** refresh confirms each approved canonical model through authenticated Direct model
  lookup and derives the corresponding Gateway dispatch slug, ownership, Responses v4, low
  reasoning and Web Search metadata from the public catalogue. Four observed capability snapshots
  and five price components are recorded append-only with raw response hashes. Token prices retain
  their documented per-token units; Web Search is normalized from USD per 1,000 searches to USD
  per search. Reservation now prices all three discovery tool calls and settlement rejects a
  fourth. Repeated exact evidence is idempotent; a crossed capability or price identity fails.
- **Risks/handoff:** catalogue evidence is preflight, not live parity. I11 must prove actual
  structured Responses and Web Search behavior before activation. Initial route staging needs an
  owner-approved per-call input-token/byte envelope and route hard cap; the global 2/25/50/300/500
  policy is already fixed. Base prices may be used only below the recorded first tier boundary.
  No credentials were recorded and no frozen contract changed.

## I07A handoff

- **Status:** `COMPLETE`; I07 remains `IN_PROGRESS` for the DATA adapter and D-RNI-19 durable
  assessment/publication composition. The matching additive schema now exists in migration 0024.
- **Files changed:** `apps/web/src/rni/composition/{index,semantic,types}.ts`,
  `apps/web/tests/integration/rni/composition/semantic-composition.test.ts`, D-RNI-22 and the two
  coordinator trackers.
- **Behaviour:** the coordinator wrapper validates a durable run identity, reads already-committed
  bounded evidence through E05, preserves independent multi-security outputs and calls one atomic
  semantic persistence port only after every classification succeeds. The port receives no
  table-shaped inputs and must return storage-selected identities on exact replay.
- **Verification:** focused semantic composition integration 3/3, typecheck, scoped ESLint,
  `git diff --check` and clean/forward disposable PostgreSQL migration gate 5/5 pass.
- **Risks/handoff:** no database adapter is claimed yet. DATA must implement one transaction over
  the existing observations/claims/source-citations/themes plus migration 0024's claim dimension,
  run membership and noise-quality sidecar, with exact replay and crossed-content rejection. I07
  must separately complete D-RNI-19 analytics, invocation, assessment and sentence-citation
  persistence; I10 still owns active model and rights-policy resolution.

## I07B handoff

- **Status:** `COMPLETE`; I07 remains `IN_PROGRESS` for concrete artifact and cited-publication
  persistence.
- **Files changed:** `apps/web/src/rni/composition/{artifacts,index,types}.ts`,
  `apps/web/tests/integration/rni/composition/artifact-composition.test.ts` and coordinator
  trackers.
- **Behaviour:** deterministic E06 results are persisted as separate Reddit and X artifacts before
  E07 composition. E07 receives the canonical hash returned by storage for each complete artifact;
  the wrapper rejects any storage identity that does not equal the bytes it submitted.
- **Verification:** complete focused I07 composition 5/5, typecheck, scoped ESLint and
  `git diff --check` pass.
- **Risks/handoff:** the port has no SQL adapter yet. Migration 0024 and the eventual adapter must
  enforce run/security/platform/slice identity and exact replay. D-RNI-19 cited-synthesis inputs,
  invocation lifecycle, assessments and ordered publication trace remain the next I07 slice.

## I07C handoff

- **Status:** `COMPLETE`; I07 remains `IN_PROGRESS` for the DATA adapters and SQL-free
  cited-synthesis composition.
- **Files changed:** `apps/web/migrations/0024_rni_universe_upgrade.sql`,
  `apps/web/tests/integration/rni/composition/synthesis-schema.test.ts`, D-RNI-19 and the two
  coordinator trackers.
- **Behaviour:** migration 0024 now persists separate Reddit/X analytics artifacts and their exact
  convergence inputs; a trusted run/security/cutoff/policy claim batch; distinct verifier and
  challenger invocations persisted before dispatch; claim-specific social, corroborating and
  counterevidence roles; catalyst assessments; challenger selection; immutable synthesis
  snapshots; and ordered statement-to-citation edges. Deferred constraints require new combined
  summaries and their exact section status/text/citation projection to commit with the complete
  trace. Publication rechecks point-in-time source rights, canonical Reddit/X identity and
  allowlisted terminal usage metadata.
- **Verification:** disposable PostgreSQL D-RNI-19 18/18 plus universe upgrade 5/5 (23/23), web
  typecheck, scoped ESLint and `git diff --check` pass. Initial independent review returned four
  P1 findings; all four were corrected and independent focused re-review returned `PASS`. The
  broader RNI persistence suite is 38/41: only the three historical D05 tests that expect the now-
  forbidden standalone summary writer fail at the new trace constraint.
- **Risks/handoff:** the database cannot recompute application canonical hashes; DATA adapters
  must canonicalize snapshots and reject crossed replay. Active-config rights revalidation and
  model-route/budget reservation remain I10 composition responsibilities. DATA D11 must retire
  the otherwise-unused standalone summary write export and replace its obsolete success tests;
  final publication uses the atomic cited-synthesis adapter. No frozen public contract or
  source-kind vocabulary changed.

## I07D handoff

- **Status:** `COMPLETE`; DATA D10 remains `CHANGES_REQUESTED` until its adapter consumes the
  shared identity and closes both reviewer findings.
- **Files changed:** `apps/web/migrations/0024_rni_universe_upgrade.sql`,
  `apps/web/tests/integration/rni/{universe-upgrade.test.ts,composition/synthesis-schema.test.ts}`,
  D-RNI-22 and coordinator trackers.
- **Behaviour:** every immutable run/source/security observation membership now requires a
  lowercase SHA-256 identity of the complete exact canonical per-security E05 output. This keeps
  values that round to the same historical NUMERIC(5,4) storage representation from replaying as
  identical. The public E05 and frozen RNI contracts are unchanged.
- **Verification:** disposable PostgreSQL cited-synthesis 18/18 plus universe upgrade 5/5
  (23/23), web typecheck, scoped ESLint and `git diff --check` pass.
- **Risks/handoff:** DATA must calculate the hash from the unrounded full per-security result,
  persist and compare it on replay, require exactly the four frozen dimensions and require exact
  observation/input-hash security-key equality. Classifier invocation FK lineage remains for the
  I10 model-call adapter; no credential is needed for these deterministic gates.

## I07E handoff

- **Status:** `COMPLETE`; I07 remains `IN_PROGRESS` for concrete DATA persistence and I10's
  active route/rights/budget composition.
- **Files changed:** `apps/web/src/rni/composition/{cited-synthesis,index,types}.ts`,
  `apps/web/tests/integration/rni/composition/cited-synthesis-composition.test.ts` and coordinator
  trackers.
- **Behaviour:** callers provide only run, security, convergence hash, idempotency key and time.
  Persistence returns either a trusted E08 request plus opaque durable preparation identity, or
  an already accepted artifact. Accepted retries replay with zero model calls and exact stored-
  versus-replayed hash equality. Fresh artifacts publish only through `commitAccepted` carrying
  the opaque preparation identity; crossed returned summary/artifact identity fails closed, and
  verifier or challenger failure performs no publication commit.
- **Verification:** complete SQL-free I07 composition 13/13, web typecheck, scoped ESLint and
  `git diff --check` pass. Initial independent review returned two P1s and one P2; exact replay
  hashing, preparation-bound commit and both failure tests close them, with focused re-review
  `PASS`.
- **Risks/handoff:** the concrete DATA adapter must bind `preparationId` to the original
  idempotency claim, request snapshot and final atomic graph under concurrency. I10 supplies the
  immutable run configuration, active-rights recheck, routed inference ports and budget
  reservation; no credential or frozen-contract change was needed here.

## DATA D10/D11 coordinator acceptance

- **Status:** `MERGED` at `7dd9454`; all DATA semantic-persistence review findings are closed.
- **Files merged:** `apps/web/src/rni/repositories/{semantic-persistence,summaries}.ts`, their two
  DATA PostgreSQL suites and `docs/rni/progress/DATA.md`.
- **Behaviour:** the D-RNI-22 adapter commits complete multi-security E05 output atomically,
  stores exact unrounded per-security identities, serializes durable observation identities across
  runs, returns original IDs on exact replay, and rejects crossed children/precision/lineage with
  no partial membership. The obsolete standalone combined-summary writer fails before SQL while
  the read path remains compatible with historical rows.
- **Verification:** final branch D10 11/11, D11 3/3 and DATA 51/51; coordinator post-merge combined
  DATA/composition/schema/universe PostgreSQL gate 87/87; web typecheck, focused ESLint,
  `git diff --check`, ownership/base/frozen-contract checks and independent re-review pass.
- **Risks/handoff:** model invocation foreign-key lineage and active route/rights/budget locking
  remain in the upcoming concrete model/publication adapters. No DATA blocker or open contract
  request remains.

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
- CR-SURFACE-05 is accepted as D-RNI-18. SURFACE must rebase the I02F contract before S08 and may
  consume only the reference active/search/staged values; live repository composition remains I08.
- ENGINE E06 `3d6688e` is held on ER-07: raw zero-weight observations may remain visible in raw
  attention, but cannot manufacture effective source/community breadth for sentiment or confidence.
- ENGINE E06 is accepted at `ecbf049`: positive-weight traces now govern effective independence,
  breadth, concentration and freshness, while raw distinct-source attention remains unchanged.
- SURFACE S08 `43f261a` is held on SR-09–13 despite its 1/1 happy path: the UI must remain live-
  composable, the fixture search must enforce the frozen bound, canonical impact must be visible,
  and the same commit must carry complete lane evidence.
- I02F1 closes ICR-01/02 with an explicit legacy/FMP active union, a 501-member FMP floor and
  impossible over-add/remove rejection. Surface must use the superseding commit, not `03f8afc`.
- ENGINE E07 is accepted at `d1ef93a`: the versioned artifact preserves exact Reddit/X inputs,
  emits only non-pooled agreement, divergence, scale, freshness and coverage facts, fails closed
  for unknown/unready evidence, and replays from canonical snapshots. Focused 21/21 plus
  typecheck, scoped lint and branch diff check pass; E08 may begin after rebasing this coordinator
  record.
- SURFACE S09 is accepted at `8d1d943`: the fixture-backed Settings route displays server-resolved
  task lineage, exposes Direct/Gateway availability, and creates only a future successor config
  while preserving historical run lineage. Coordinator and independent review found no actionable
  issue; Chromium passes 3/3. The lane must remove its uncommitted `pnpm-workspace.yaml` mutation,
  rebase current integration and complete S10 before the SURFACE merge gate.
- SURFACE S10 and the full rebased lane are accepted at `c68980b`. The worktree is clean; all seven
  routes pass a narrow-screen heading/overflow/scoped-axe sweep, existing interaction coverage
  remains green in the complete 22-test Chromium suite, and the guarded unavailable-Gateway state
  is directly covered. Shared navigation/layout accessibility remains I08/G6 work. The branch is
  ready but must wait for ENGINE to merge first.

## I02F handoff

- **Files changed:** frozen RNI contracts and reference fixtures; RNI contract test; product
  contract; D-RNI-18; coordinator trackers.
- **Behaviour:** the additive universe service returns legacy-or-FMP active metadata with NVDA as
  default, bounded case-insensitive active-member search and a distinct immutable FMP staged child
  whose complete possible add/remove sets reconcile its 501–600 count. It exposes no provider or
  mutation operation.
- **Verification:** typecheck and focused lint pass; RNI contract 15/15; full contract 85 pass with
  22 database-only skips; independent ICR-01/02 re-review returned READY at `098f010`.
- **Risk/handoff:** I08 must project these reads from the active/staged repository state, retain
  version binding and verify added/removed identities against both stored memberships. SURFACE owns
  fixture/UI/browser coverage after rebasing onto the I02F1 correction.

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
