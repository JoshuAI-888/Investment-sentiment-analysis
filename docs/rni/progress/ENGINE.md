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
| E01 | Reddit OpenAI Web Search discovery and canonical candidate normalization | `COMPLETE` | 16 focused tests: exact source/evidence binding, URL-only abstention, complete action lineage, half-open windows, dedup, frozen-source compatibility; coordinator accepted `b3e8220` |
| E02 | Existing X adapter port and independent terminal source slice | `READY_FOR_REVIEW` | 16 focused success/failure, isolation, lineage, versioning and half-open-window tests |
| E03 | Persist-first workflow, retry, checkpoint and budget logic | `NOT_STARTED` | Crash/redelivery tests |
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
| discovery/adapter contract | `READY_FOR_REVIEW` | `corepack pnpm --dir apps/web exec vitest run tests/unit/rni/discovery/openai-web-search.test.ts tests/contract/rni/discovery.test.ts --no-file-parallelism` | 2 files, 16 tests passed after coordinator fixes |
| X adapter/source slice | `READY_FOR_REVIEW` | `corepack pnpm --dir apps/web exec vitest run tests/unit/rni/sources/x-source-slice.test.ts tests/contract/rni/x-source-slice.test.ts --no-file-parallelism` | 2 files, 16 tests passed; read-only review found no remaining P1/P2 issues |
| workflow/idempotency | `NOT_STARTED` | — | — |
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

## Open risks/blockers

| Since | Status | Blocker | Owner | Attempted mitigation | Next check |
|---|---|---|---|---|---|
| 2026-09-05 | `OPEN` | Live X adapter smoke was not run because no approved `X_BEARER_TOKEN` or governed live query was available | coordinator | Existing adapter is composed through an injected port; fixture success/failure contracts pass without secrets | G4 live-smoke review |

## Task records

### E01 — Reddit OpenAI Web Search discovery and canonical candidate normalization

- **Status:** `COMPLETE`; coordinator accepted `b3e8220`
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

- **Status:** `READY_FOR_REVIEW`
- **Slice:** Added a composition port around the existing authorised X recent-search adapter and
  an X-only terminal source-slice runner. A governed query set is invoked without Reddit inputs;
  each returned post is deterministically filtered to the exact half-open UTC window, normalized
  to a stable X status URL, content-hashed, and carried with complete per-query retrieval rank,
  requested-at time, provider metadata/payload reference, and capture metadata. Same-content
  rediscovery updates mutable metadata while retaining every retrieval snapshot; changed bytes
  create a separately returned candidate linked by the prior content hash for E03 persistence.
- **Files changed:** `apps/web/src/rni/sources/{index,types,x}.ts`,
  `apps/web/tests/unit/rni/sources/x-source-slice.test.ts`,
  `apps/web/tests/contract/rni/x-source-slice.test.ts`, and this tracker.
- **Tests/results:** focused unit + contract 16/16 passed; repository unit 1,200/1,200 passed;
  repository contract 80 passed and 22 pre-existing skips; `typecheck`, focused ESLint, full
  ESLint, and `git diff --check` passed. A read-only review found and closed content-version,
  retrieval-lineage, calculation-freshness, and mutable-metadata issues, then returned READY with
  no remaining P1/P2 findings.
- **Models/prompts/formulas:** no model or prompt is used or changed. Deterministic behavior is
  limited to SHA-256 content/handle hashing, half-open timestamp filtering, identity/content
  deduplication, version linkage, latest-metadata selection, and terminal status mapping.
- **Token/latency evidence:** no model tokens are consumed. The provider fixture carries 41 ms
  adapter latency as contract metadata; it is not a live performance measurement.
- **Risks/handoff:** the existing adapter exposes post IDs rather than native status URLs or a
  provider request ID, so the composition layer derives the stable `x.com/i/web/status/{id}` URL
  and preserves provider `payloadRef` in every retrieval. These are expressible through the
  frozen nullable/request metadata fields and require no contract change. Coordinator must run
  the separately governed live X smoke with an approved secret/query; no secret was committed.

## Commits

| SHA | Summary | Tests |
|---|---|---|
| `a181461` | E01 Web Search discovery and canonical candidate normalization | focused 10/10; unit 1,180/1,180; contract 78 passed/22 skipped; typecheck/lint passed |
| `58e5828` | E01 exact evidence binding and complete action lineage | focused 15/15; unit 1,185/1,185; contract 78 passed/22 skipped; typecheck/lint passed |
| `b3e8220` | E01 full citation-span coverage; coordinator accepted | focused 16/16; unit 1,186/1,186; contract 78 passed/22 skipped; typecheck/lint passed |
| this task commit | E02 independent X adapter/source slice | focused 16/16; unit 1,200/1,200; contract 80 passed/22 skipped; typecheck/lint passed |

## Handoff

```text
RNI LANE     ENGINE
BRANCH       feat/rni-engine-live-slice
BASE SHA     86ec5b4757f45cbe96c651f413e8ff1109fef279
STATUS       PARTIAL
TASKS        2/10; E03-E10 incomplete
TESTS        E01 focused 16/16; E02 focused 16/16; unit 1,200/1,200; contract 80 passed/22 skipped; typecheck/lint pass
CONTRACT     none
RISKS        live Web Search and X adapter smokes pending coordinator because approved credentials were unavailable
FILES        src/rni/{discovery,sources}/**; tests/unit/rni/{discovery,sources}/**; tests/contract/rni/{discovery,x-source-slice}.test.ts; docs/rni/progress/ENGINE.md
COMMITS      a181461, 58e5828, b3e8220, plus E02 task commit
DEMO PROOF   Reddit citation-bound fixture plus independent X complete/partial/unavailable/failed fixtures; no fallback or cross-platform pooling
```
