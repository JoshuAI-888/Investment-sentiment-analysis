# RNI Master Progress

**Writer:** coordinator/integrator only  
**Production approver:** `joshuai`  
**Build loop:** [`RNI_BUILD_LOOP.md`](RNI_BUILD_LOOP.md)  
**Last updated:** 2026-09-05

## Current state

| Field | Value |
|---|---|
| Overall | `READY_FOR_PARALLEL_BUILD` |
| Current gate | `G3_DATA / G4_ENGINE / G5_SURFACE` |
| Target | approved overnight RNI vertical slice |
| Base branch | `main` |
| Base SHA | `e4570e3` merged into the contract branch at `353021d` |
| Route prerequisite | merged to `main` in PR #2 (`09ad439`) |
| Contract-freeze SHA | source `9908edacdbfd1fbdf628d701153f2ab8ec16c6c3`; merged by PR #5 at `dd28ea26853b1ecac05ee5feb3da28af1a1cb57b` |
| Production approval | not requested |

## Gates

| Gate | Status | Owner | Evidence / blocker |
|---|---|---|---|
| G0 repository preflight | `PASSED` | coordinator | PR #5 web/scorer CI, database integration, E2E, eval and Vercel preview green |
| G1 model-route branch merged | `PASSED` | coordinator | PR #2, main commit `09ad439` |
| G2 RNI contract frozen | `PASSED` | coordinator | PR #5 merged at `dd28ea2`; typed source contract at `9908eda` |
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
| INTEGRATION | `feat/rni-integration-demo` | `READY` | `INTEGRATION.md` | contract merge: `dd28ea2` |

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
| Scope and branch isolation | `PASSED` | `RNI-00-CONTRACT.md`, path ownership and scoped legacy banners; PR #5 |
| Source identity/persist-first/idempotency | `NOT_STARTED` | — |
| Reddit/X separation and combined honesty | `NOT_STARTED` | — |
| S&P 500/FMP universe migration | `NOT_STARTED` | — |
| Model route and CI | `PASSED` | PR #2 route validation; PR #5 RNI path filter and green eval |
| Toolchain reproducibility | `PASSED` | pinned pnpm 10.33 clean install plus PR #5 independent CI |
| Retention and citation safety | `NOT_STARTED` | — |
| Cost and 500+ symbol workload | `NOT_STARTED` | — |
| Authentication/deployment | `READY` | — |

## Merge log

| UTC time | Branch | Merge SHA | CI | Reviewer | Notes |
|---|---|---|---|---|---|
| 2026-09-04T13:26:04Z | `docs/rni-contract-convergence` | `dd28ea26853b1ecac05ee5feb3da28af1a1cb57b` | web, scorer, eval, Vercel green | coordinator | PR #5; opens G3–G5 |

## Coordinator log

Append one line per material transition; do not erase history.

- 2026-09-05 — specification and owner decisions complete; build not yet started.
- 2026-09-05 — contract pack, typed schemas, comparative fixture, copy-lint convergence and CI routing frozen at `9908eda`; DATA/ENGINE/SURFACE remain blocked until this branch merges to `main`.
- 2026-09-05 — merged concurrent password-auth PR #4 (`e4570e3`) into the contract branch, preserved D-37/D-38 and all D-RNI decisions, then reran lint, typecheck, contract and production build successfully.
- 2026-09-05 — PR #5 merged at `dd28ea2`; G0–G2 passed and DATA/ENGINE/SURFACE may branch from this common base.
