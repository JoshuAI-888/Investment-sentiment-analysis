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
| E01 | Reddit OpenAI Web Search discovery and canonical candidate normalization | `READY_FOR_REVIEW` | 10 focused tests: domain/window/provider-source guards, post/comment identity, dedup, bounded capture, injection isolation, frozen-source compatibility |
| E02 | Existing X adapter port and independent terminal source slice | `NOT_STARTED` | X success/failure contract tests |
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
| discovery/adapter contract | `READY_FOR_REVIEW` | `corepack pnpm --dir apps/web exec vitest run tests/unit/rni/discovery/openai-web-search.test.ts tests/contract/rni/discovery.test.ts --no-file-parallelism` | 2 files, 10 tests passed |
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
| — | — | — | — | — |

## Open risks/blockers

| Since | Status | Blocker | Owner | Attempted mitigation | Next check |
|---|---|---|---|---|---|
| — | — | none | — | — | — |

## Task records

### E01 — Reddit OpenAI Web Search discovery and canonical candidate normalization

- **Status:** `READY_FOR_REVIEW`
- **Slice:** Added a Responses API Web Search request builder and injected transport boundary,
  strict structured-output parsing, full consulted-source extraction, and deterministic Reddit
  post/comment URL normalization. Candidates fail closed unless they are Reddit URLs from a
  configured community, present in `web_search_call.action.sources`, inside the exact half-open
  window when timestamped, and backed by bounded non-HTML content.
- **Files changed:**
  `apps/web/src/rni/discovery/{index,openai-web-search,reddit-url,types}.ts`,
  `apps/web/tests/unit/rni/discovery/openai-web-search.test.ts`,
  `apps/web/tests/unit/rni/discovery/fixtures/openai-web-search-response.json`,
  `apps/web/tests/contract/rni/discovery.test.ts`, and this tracker.
- **Tests/results:** focused unit + contract 10/10 passed; repository unit 1,180/1,180 passed;
  repository contract 78 passed and 22 pre-existing skips; `typecheck`, focused ESLint, full
  ESLint, and `git diff --check` passed.
- **Models/prompts:** no model ID is hard-coded; the caller supplies the evaluated Web Search
  model. Added stable prompt/schema version `rni-discovery-v1`, Web Search as the only tool,
  `reddit.com` as the domain filter, a bounded tool/output budget, and explicit untrusted-source
  and no-sentiment instructions.
- **Token/latency evidence:** sanitized fixture records 820 input, 410 output and 512 cached input
  tokens; the injected-clock test records 42 ms. These are parser/telemetry fixtures, not live
  performance claims.
- **Risks/handoff:** `OPENAI_API_KEY` was absent, so the raw live Responses API spike remains a
  coordinator G7 deployment check. Integration must inject the provider transport/model setting;
  E03 must persist accepted and consulted-source records before semantic work. No DATA
  implementation detail is imported and no frozen contract change is required.

## Commits

| SHA | Summary | Tests |
|---|---|---|
| this task commit | E01 Web Search discovery and canonical candidate normalization | focused 10/10; unit 1,180/1,180; contract 78 passed/22 skipped; typecheck/lint passed |

## Handoff

```text
RNI LANE     ENGINE
BRANCH       feat/rni-engine-live-slice
BASE SHA     86ec5b4757f45cbe96c651f413e8ff1109fef279
STATUS       PARTIAL
TASKS        1/10; E02-E10 incomplete
TESTS        E01 focused 10/10; unit 1,180/1,180; contract 78 passed/22 skipped; typecheck/lint pass
CONTRACT     none
RISKS        live Web Search spike pending coordinator G7 because no OPENAI_API_KEY was available
FILES        src/rni/discovery/**; tests/unit/rni/discovery/**; tests/contract/rni/discovery.test.ts; docs/rni/progress/ENGINE.md
COMMITS      this task commit
DEMO PROOF   sanitized Responses fixture yields one bounded deduplicated in-window r/stocks candidate and rejects five unsafe/ineligible candidates
```
