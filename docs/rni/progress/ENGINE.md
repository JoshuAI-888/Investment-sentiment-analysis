# RNI ENGINE Workstream Progress

**Writer:** ENGINE builder only  
**Branch:** `feat/rni-engine-live-slice`  
**Depends on:** merged RNI contract-freeze SHA; injected fake repositories until DATA merge  
**Status:** `NOT_STARTED`

## Owned paths

See `../RNI_BUILD_LOOP.md` §3.3. Any path outside that list requires a contract request.

## Tasks

| ID | Task | Status | Acceptance evidence |
|---|---|---|---|
| E01 | Reddit OpenAI Web Search discovery and canonical candidate normalization | `NOT_STARTED` | Domain/window/dedup fixtures |
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
| discovery/adapter contract | `NOT_STARTED` | — | — |
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

## Commits

| SHA | Summary | Tests |
|---|---|---|
| — | — | — |

## Handoff

```text
RNI LANE     ENGINE
BRANCH       feat/rni-engine-live-slice
BASE SHA     —
STATUS       NOT_STARTED
TASKS        0/10
TESTS        not run
CONTRACT     none
RISKS        none recorded
FILES        none
COMMITS      none
DEMO PROOF   none
```
