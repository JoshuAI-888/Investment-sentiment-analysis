# RNI Master Progress

**Writer:** coordinator/integrator only  
**Production approver:** `joshuai`  
**Build loop:** [`RNI_BUILD_LOOP.md`](RNI_BUILD_LOOP.md)  
**Last updated:** 2026-09-05

## Current state

| Field | Value |
|---|---|
| Overall | `CONTRACT_FROZEN_ON_MERGE` |
| Current gate | `G3_DATA / G4_ENGINE / G5_SURFACE` after this branch reaches `main` |
| Target | approved overnight RNI vertical slice |
| Base branch | `main` |
| Base SHA | `e4570e3` merged into the contract branch at `353021d` |
| Route prerequisite | merged to `main` in PR #2 (`09ad439`) |
| Contract-freeze SHA | `9908edacdbfd1fbdf628d701153f2ab8ec16c6c3` (effective once merged to `main`) |
| Production approval | not requested |

## Gates

| Gate | Status | Owner | Evidence / blocker |
|---|---|---|---|
| G0 repository preflight | `LOCAL_PASS_CI_PENDING` | coordinator | pnpm 10.33 frozen install, lint, typecheck, full test, build and checks passed; database cases await PR CI |
| G1 model-route branch merged | `PASSED` | coordinator | PR #2, main commit `09ad439` |
| G2 RNI contract frozen | `PASS_ON_MERGE` | coordinator | Typed contract/fixtures/tests at `9908eda`; builders still wait for this branch on `main` |
| G3 DATA accepted | `NOT_STARTED` | DATA + reviewer | Depends G2 |
| G4 ENGINE accepted | `NOT_STARTED` | ENGINE + reviewer | Depends G2; live composition depends G3 |
| G5 SURFACE accepted | `NOT_STARTED` | SURFACE + reviewer | Depends G2; fixture service permitted |
| G6 integrated preview | `NOT_STARTED` | coordinator | Depends G3–G5 |
| G7 live Reddit/X/FMP gates | `NOT_STARTED` | coordinator + joshuai | Depends G6 and configured credentials |
| G8 production approval | `NOT_STARTED` | joshuai | Depends all prior gates |

## Workstreams

| Workstream | Branch | Status | Progress file | Latest accepted commit |
|---|---|---|---|---|
| DATA | `feat/rni-data-source-first` | `NOT_STARTED` | `DATA.md` | — |
| ENGINE | `feat/rni-engine-live-slice` | `NOT_STARTED` | `ENGINE.md` | — |
| SURFACE | `feat/rni-surface-demo` | `NOT_STARTED` | `SURFACE.md` | — |
| INTEGRATION | `feat/rni-integration-demo` | `IN_PROGRESS` | `INTEGRATION.md` | contract: `9908eda` |

## Confirmed product decisions

- Scope: isolated RNI vertical slice.
- Reddit: OpenAI Web Search only; no Reddit API dependency.
- X: independent datasource; never fallback.
- Output: Reddit sentiment, X sentiment, combined summary.
- RNI AI route: OpenAI Direct default; Gateway optional.
- Universe: current FMP S&P 500, configurable; NVDA selected by default.
- Retention: bounded relevant post/comment/X content and metadata only.
- MCP: read-only contract/skeleton for this release.
- Disclosures: sampled Reddit and configured X coverage.
- Release authority: `joshuai`.

## Open external verifications

| Verification | Owner | Status | Pass condition |
|---|---|---|---|
| FMP entitlement | joshuai | `READY` | Authenticated `/stable/sp500-constituent` response validates and is audited |
| X live access | coordinator | `READY` | Independent adapter smoke with configured `X_BEARER_TOKEN` |
| OpenAI Web Search | coordinator | `READY` | Five-source source-first persistence spike |
| Production login | joshuai | `READY` | Allowlisted operator signs in successfully |

## Critical/High risk closure

The canonical matrix is [`INTEGRATION_PLAN.md`](INTEGRATION_PLAN.md) §10. Coordinator adds evidence links here only after gates pass.

| Risk group | Status | Evidence |
|---|---|---|
| Scope and branch isolation | `PASSED_ON_MERGE` | `RNI-00-CONTRACT.md`, path ownership and scoped legacy banners |
| Source identity/persist-first/idempotency | `NOT_STARTED` | — |
| Reddit/X separation and combined honesty | `NOT_STARTED` | — |
| S&P 500/FMP universe migration | `NOT_STARTED` | — |
| Model route and CI | `PASSED_ON_MERGE` | PR #2 route validation; RNI eval path filter in contract branch |
| Toolchain reproducibility | `LOCAL_PASS_CI_PENDING` | pinned pnpm 10.33 clean install and full local gates |
| Retention and citation safety | `NOT_STARTED` | — |
| Cost and 500+ symbol workload | `NOT_STARTED` | — |
| Authentication/deployment | `READY` | — |

## Merge log

| UTC time | Branch | Merge SHA | CI | Reviewer | Notes |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

## Coordinator log

Append one line per material transition; do not erase history.

- 2026-09-05 — specification and owner decisions complete; build not yet started.
- 2026-09-05 — contract pack, typed schemas, comparative fixture, copy-lint convergence and CI routing frozen at `9908eda`; DATA/ENGINE/SURFACE remain blocked until this branch merges to `main`.
- 2026-09-05 — merged concurrent password-auth PR #4 (`e4570e3`) into the contract branch, preserved D-37/D-38 and all D-RNI decisions, then reran lint, typecheck, contract and production build successfully.
