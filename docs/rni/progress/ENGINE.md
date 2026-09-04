# RNI ENGINE Workstream Progress

**Writer:** ENGINE builder only  
**Branch:** `feat/rni-engine-live-slice`  
**Depends on:** merged RNI contract-freeze SHA; injected fake repositories until DATA merge  
**Status:** `IN_PROGRESS`

## Owned paths

See `../RNI_BUILD_LOOP.md` §3.3. Any path outside that list requires a contract request.

## Tasks

| ID | Task | Status | Acceptance evidence |
|---|---|---|---|
| E01 | Reddit OpenAI Web Search discovery and canonical candidate normalization | `COMPLETE` | 16 focused tests: exact source/evidence binding, URL-only abstention, complete action lineage, half-open windows, dedup, frozen-source compatibility; coordinator accepted rebased `f499cba` |
| E02 | Existing X adapter port and independent terminal source slice | `COMPLETE` | 20 focused tests: partial-success propagation, isolation, tenant-safe identity, retrieval/version lineage, A→B→A latest selection, half-open windows; coordinator accepted rebased `581fcca` |
| E03 | Persist-first workflow, retry, checkpoint and budget logic | `READY_FOR_REVIEW` | 17 focused tests: commit/checkpoint and enqueue/completion crashes, exact redelivery, lease heartbeat, retry not-before, bounded jitter, stable budget reservation, durable wall-time and hash integrity |
| E04 | Security resolver and multi-security relationships | `NOT_STARTED` | NVDA/AMD comparative fixture |
| E05 | Four-dimension classifier, themes, claims and noise labels | `NOT_STARTED` | Gold/schema/injection tests |
| E06 | Platform-specific deterministic analytics and confidence | `NOT_STARTED` | Golden/replay/baseline tests |
| E07 | Reddit/X convergence and agreement/divergence facts | `NOT_STARTED` | Divergence/scale imbalance/partial tests |
| E08 | Verification, challenger and three-part cited synthesis | `NOT_STARTED` | Citation entailment/fail-closed tests |
| E09 | RNI model routes, prompts and caching-compatible stable prefixes | `NOT_STARTED` | Direct default/Gateway parity fixtures |
| E10 | RNI eval suite and full ENGINE handoff | `NOT_STARTED` | CI-trigger and lane report evidence |

## Required invariants

- Reddit uses Web Search only; no Reddit API code path.
- X runs independently and is never fallback.
- Interpretation accepts committed source IDs only.
- Stance is independent per security and dimension.
- Metrics are pure/versioned calculations.
- Combined facts never pool raw Reddit/X volumes.
- Missing platform yields `PARTIAL_CROSS_SOURCE`.
- Synthesis has Reddit, X and combined sections with platform-labelled citations.
- Source text is untrusted data and cannot change tools/system policy.

## Contract requests

| ID | Status | Request | Impact |
|---|---|---|---|
| — | — | none | — |

## Test evidence

| Suite | Status | Command/run link | Notes |
|---|---|---|---|
| discovery/adapter contract | `COMPLETE` | `corepack pnpm --dir apps/web exec vitest run tests/unit/rni/discovery/openai-web-search.test.ts tests/contract/rni/discovery.test.ts --no-file-parallelism` | 2 files, 16 tests passed after coordinator fixes; coordinator accepted rebased `f499cba` |
| X adapter/source slice | `COMPLETE` | `corepack pnpm --dir apps/web exec vitest run tests/unit/rni/sources/x-source-slice.test.ts tests/contract/rni/x-source-slice.test.ts --no-file-parallelism` | 2 files, 20 tests passed after coordinator fixes; coordinator accepted rebased `581fcca` |
| workflow/idempotency | `READY_FOR_REVIEW` | `corepack pnpm --dir apps/web exec vitest run tests/unit/rni/workflow/persist-source.test.ts tests/contract/rni/persist-source-workflow.test.ts --no-file-parallelism` | 2 files, 17 tests passed; independent read-only review returned READY with no P0/P1/P2 findings |
| semantic gold set | `NOT_STARTED` | — | — |
| analytics golden/replay | `NOT_STARTED` | — | — |
| cross-source isolation | `NOT_STARTED` | — | — |
| prompt injection/citations | `NOT_STARTED` | — | — |
| RNI eval | `NOT_STARTED` | — | — |
| repository required gate | `NOT_STARTED` | — | — |

## Review findings

| ID | Priority | Status | Finding | Resolution |
|---|---|---|---|---|
| E01-R1-01 | P1 | `CLOSED` | Canonical URL membership did not bind model excerpt/time to the exact consulted source | Exact provider URL plus full-value-covering field-scoped URL-citation annotations are required; partial/overlapping spans fail closed, and otherwise the provider URL is emitted URL-only and interpretation-ineligible |
| E01-R1-02 | P1 | `CLOSED` | Malformed or source-less calls could be skipped, yielding an incomplete consulted-source trace | Every call now validates; search requires a sources array, supported non-search actions are traced, and unknown/malformed actions fail closed |
| E01-R1-03 | P2 | `CLOSED` | Injection test covered post-generation output handling, not model resistance before generation | Test and evidence now explicitly claim only output-handling/tool-configuration coverage; pre-generation model resistance remains E10 eval scope |
| E02-R1-01 | P1 | `CLOSED` | Existing adapter partial-success contract violations were erased by the RNI port | The composition port now intercepts and forwards each call's violations, carries explicit response completeness, and forces usable partial responses to X `partial` |
| E02-R1-02 | P1 | `CLOSED` | Unsalted mutable usernames were directly hashed as author identity | Default identity is omitted; an optional tenant-approved hasher receives only stable provider author ID, must return a valid lowercase SHA-256 digest, and never retains the raw ID/username |
| E02-R1-03 | P1 | `CLOSED` | Content-version candidates did not expose exactly one latest interpretation version and mishandled A→B→A | `candidates` now has exactly one latest version per external ID, `persistenceVersions` keeps every distinct byte version, and ordered transitions preserve A→B→A reversion lineage |
| E03-R1-01 | P1 | `CLOSED` | Commit/checkpoint crash could reserve source allowance twice and strand persisted evidence | Budget reservation now has a stable step/resource key and is explicitly idempotent across attempts and crash redelivery |
| E03-R1-02 | P1 | `CLOSED` | Lease was not renewed across potentially slow budget and commit work | The portable workflow port maintains heartbeat renewal across the full reserve/commit/checkpoint/enqueue/complete operation; interval must be positive and shorter than the lease |
| E03-R1-03 | P1 | `CLOSED` | Concurrent redelivery could bypass transient-error backoff | `claimStep` must durably enforce recorded `retryAt` as not-before; concurrent redelivery returns deferred until it passes |
| E03-R1-04 | P2 | `CLOSED` | Wall-time budget reset on each process delivery | Claims return the original durable `startedAt`; local and injected budget checks use cumulative elapsed time across redelivery |
| E03-R2-01 | P2 | `CLOSED` | Completed checkpoint validated output-hash format but not integrity | Redelivery recomputes the logical hash from the parsed durable source ID and interpretation idempotency key and fails closed on mismatch |

## Open risks/blockers

| Since | Status | Blocker | Owner | Attempted mitigation | Next check |
|---|---|---|---|---|---|
| 2026-09-05 | `OPEN` | Live X adapter smoke was not run because no approved `X_BEARER_TOKEN` or governed live query was available | coordinator | Existing adapter is composed through an injected port; fixture success/failure contracts pass without secrets | G4 live-smoke review |

## Task records

### E01 — Reddit OpenAI Web Search discovery and canonical candidate normalization

- **Status:** `COMPLETE`; coordinator accepted rebased `f499cba`
- **Slice:** Added a Responses API Web Search request builder and injected transport boundary,
  strict structured-output parsing, complete per-call action/source validation, and deterministic
  Reddit post/comment URL normalization. Interpretation-eligible candidates require exact
  consulted-URL equality and URL-citation spans that fully cover both bounded content and
  publication time for that source. Partial, unbound, untimed, out-of-window, or otherwise
  ineligible consulted Reddit sources remain explicit URL-only records and cannot enter
  interpretation.
- **Files changed:**
  `apps/web/src/rni/discovery/{index,openai-web-search,reddit-url,types}.ts`,
  `apps/web/tests/unit/rni/discovery/openai-web-search.test.ts`,
  `apps/web/tests/unit/rni/discovery/fixtures/openai-web-search-response.json`,
  `apps/web/tests/contract/rni/discovery.test.ts`, and this tracker.
- **Tests/results:** focused unit + contract 16/16 passed; repository unit 1,186/1,186 passed;
  repository contract 78 passed and 22 pre-existing skips; `typecheck`, focused ESLint, full
  ESLint, and `git diff --check` passed.
- **Models/prompts:** no model ID is hard-coded; the caller supplies the evaluated Web Search
  model. Prompt version is now `rni-discovery-v2`; it requires exact source citations for excerpt
  and time, keeps Web Search as the only tool, uses `reddit.com` as the domain filter, applies a
  bounded tool/output budget, and retains explicit untrusted-source/no-sentiment instructions.
- **Token/latency evidence:** sanitized fixture records 820 input, 410 output and 512 cached input
  tokens; the injected-clock test records 42 ms. These are parser/telemetry fixtures, not live
  performance claims.
- **Risks/handoff:** `OPENAI_API_KEY` was absent, so the raw live Responses API spike remains a
  coordinator G7 deployment check. If live structured output lacks field-scoped URL citations,
  the adapter safely yields URL-only evidence rather than semantic input. Integration must inject
  the provider transport/model setting; E03 must persist accepted and URL-only/consulted-source
  records before semantic work. No DATA implementation detail is imported and no frozen contract
  change is required.

### E02 — Existing X adapter port and independent terminal source slice

- **Status:** `COMPLETE`; coordinator accepted rebased `581fcca`
- **Slice:** Added a composition port around the existing authorised X recent-search adapter and
  an X-only terminal source-slice runner. A governed query set is invoked without Reddit inputs;
  each returned post is deterministically filtered to the exact half-open UTC window, normalized
  to a stable X status URL, content-hashed, and carried with complete per-query retrieval rank,
  requested-at time, provider metadata/payload reference, capture metadata, and explicit provider
  response completeness. Same-content rediscovery updates mutable metadata while retaining every
  retrieval snapshot. All changed byte versions and ordered transitions go to E03 persistence,
  while exactly one latest version per external ID is eligible for interpretation. Author identity
  is omitted unless an injected tenant-approved policy hashes the stable provider author ID.
- **Files changed:** `apps/web/src/rni/sources/{index,types,x}.ts`,
  `apps/web/tests/unit/rni/sources/x-source-slice.test.ts`,
  `apps/web/tests/contract/rni/x-source-slice.test.ts`, and this tracker.
- **Tests/results:** focused unit + contract 20/20 passed; repository unit 1,204/1,204 passed;
  repository contract 80 passed and 22 pre-existing skips; `typecheck`, focused ESLint, full
  ESLint, and `git diff --check` passed. A read-only review found and closed content-version,
  retrieval-lineage, calculation-freshness, and mutable-metadata issues, then returned READY with
  no remaining P1/P2 findings.
- **Models/prompts/formulas:** no model or prompt is used or changed. Deterministic behavior is
  limited to SHA-256 content hashing, half-open timestamp filtering, identity/content
  deduplication, ordered version transitions, latest-metadata selection, completeness propagation,
  and terminal status mapping. Author hashing is supplied only by an injected approved policy.
- **Token/latency evidence:** no model tokens are consumed. The provider fixture carries 41 ms
  adapter latency as contract metadata; it is not a live performance measurement.
- **Risks/handoff:** the existing adapter exposes post IDs rather than native status URLs or a
  provider request ID, so the composition layer derives the stable `x.com/i/web/status/{id}` URL
  and preserves provider `payloadRef` in every retrieval. These are expressible through the
  frozen nullable/request metadata fields and require no contract change. Coordinator must run
  the separately governed live X smoke with an approved secret/query; no secret was committed.

### E03 — Persist-first workflow, retry, checkpoint and budget logic

- **Status:** `READY_FOR_REVIEW`
- **Slice:** Added the portable operational `RniWorkflowPort` around the existing durable
  job/queue composition boundary while consuming the frozen `RniSourcePersistencePort` directly.
  The runner claims the `(run, stage, subject, version)` step, maintains its lease heartbeat,
  reserves budget idempotently, commits bounded source evidence, checkpoints the DATA-returned
  durable ID, and only then enqueues an ID-only semantic job. Completed redelivery returns the
  verified checkpoint; stale-lease recovery, commit/checkpoint and enqueue/completion crashes,
  transient retry not-before, permanent failure and budget stops are fail-closed.
- **Files changed:** `apps/web/src/rni/workflow/{index,persist-source,types}.ts`,
  `apps/web/tests/unit/rni/workflow/persist-source.test.ts`,
  `apps/web/tests/contract/rni/persist-source-workflow.test.ts`, and this tracker.
- **Tests/results:** focused workflow unit + contract 17/17 passed; serialized repository unit
  1,223/1,223 passed; repository contract 88 passed and 22 pre-existing skips; `typecheck`, focused
  ESLint and `git diff --check` passed. The default parallel unit command twice exposed the known
  cross-file `__float_probe__.ts` create/remove race in `codebase-invariants.test.ts`; the
  no-file-parallelism rerun passed every unit. Independent read-only review returned READY with no
  P0/P1/P2 findings.
- **Models/prompts/formulas:** no model or prompt is used or changed. Deterministic formulas are
  canonical SHA-256 input/output and step/dispatch/reservation keys; full-jitter retry delay
  `floor(random * min(cap, base * factor^(attempt - 1)))`; a three-attempt default ceiling;
  30-second cumulative durable wall-time; and a 10-second lease with 3-second heartbeat cadence.
  The caller-proposed source UUID is excluded from the input hash and semantic dispatch.
- **Token/latency evidence:** this persist stage estimates and reserves zero input/output tokens
  and zero model cost while using the shared generic token/cost/source/time budget dimensions.
  Focused fixture execution completed in 438 ms; this is test runtime, not live queue latency.
- **Risks/handoff:** integration must implement `RniWorkflowPort` over the repository's existing
  durable job/queue tables, including atomic lease/checkpoint/not-before rules and idempotent
  semantic enqueue. No lane-local source persistence interface, DATA-private import, migration,
  frozen contract change or contract request was introduced. E04 has not started.

## Commits

| SHA | Summary | Tests |
|---|---|---|
| `1645fd3` | E01 Web Search discovery and canonical candidate normalization | focused 10/10; unit 1,180/1,180; contract 78 passed/22 skipped; typecheck/lint passed |
| `44e1bcb` | E01 exact evidence binding and complete action lineage | focused 15/15; unit 1,185/1,185; contract 78 passed/22 skipped; typecheck/lint passed |
| `f499cba` | E01 full citation-span coverage; coordinator accepted | focused 16/16; unit 1,186/1,186; contract 78 passed/22 skipped; typecheck/lint passed |
| `f380904` | E02 independent X adapter/source slice | focused 16/16; unit 1,200/1,200; contract 80 passed/22 skipped; typecheck/lint passed |
| `581fcca` | E02 partial signal, tenant-safe identity and explicit latest/version lineage; coordinator accepted | focused 20/20; unit 1,204/1,204; contract 80 passed/22 skipped; typecheck/lint passed |
| this task commit | E03 persist-first durable workflow slice | focused 17/17; serialized unit 1,223/1,223; contract 88 passed/22 skipped; typecheck/focused lint passed |

## Handoff

```text
RNI LANE     ENGINE
BRANCH       feat/rni-engine-live-slice
BASE SHA     ce80424 (integration base required before handoff)
STATUS       PARTIAL
TASKS        3/10; E04-E10 not started
TESTS        E01 focused 16/16; E02 focused 20/20; E03 focused 17/17; serialized unit 1,223/1,223; contract 88 passed/22 skipped; typecheck/focused lint pass
CONTRACT     none
RISKS        live Web Search/X smokes pending approved credentials; coordinator must compose the portable workflow port; default parallel unit runner has a pre-existing __float_probe__.ts scan race, serialized gate passes
FILES        src/rni/{discovery,sources,workflow}/**; tests/unit/rni/{discovery,sources,workflow}/**; tests/contract/rni/{discovery,x-source-slice,persist-source-workflow}.test.ts; docs/rni/progress/ENGINE.md
COMMITS      rebased E01/E02 series through 581fcca, plus E03 task commit
DEMO PROOF   citation-bound Reddit; independent X terminal states; commit-before-ID-only-interpret crash/redelivery fixtures
```
