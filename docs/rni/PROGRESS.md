# RNI Master Progress

**Writer:** coordinator/integrator only  
**Production approver:** `joshuai`  
**Build loop:** [`RNI_BUILD_LOOP.md`](RNI_BUILD_LOOP.md)  
**Last updated:** 2026-09-05

## Current state

| Field | Value |
|---|---|
| Overall | `PARALLEL_BUILD_REVIEW` |
| Current gate | `G3_DATA / G4_ENGINE / G5_SURFACE` |
| Target | approved overnight RNI vertical slice |
| Base branch | `main` |
| Base SHA | `86ec5b4757f45cbe96c651f413e8ff1109fef279` on `main` |
| Route prerequisite | merged to `main` in PR #2 (`09ad439`) |
| Contract-freeze SHA | source `9908edacdbfd1fbdf628d701153f2ab8ec16c6c3`; merged by PR #5 at `dd28ea26853b1ecac05ee5feb3da28af1a1cb57b` |
| Production approval | not requested |

## Gates

| Gate | Status | Owner | Evidence / blocker |
|---|---|---|---|
| G0 repository preflight | `PASSED` | coordinator | PR #5 web/scorer CI, database integration, E2E, eval and Vercel preview green |
| G1 model-route branch merged | `PASSED` | coordinator | PR #2, main commit `09ad439` |
| G2 RNI contract frozen | `PASSED` | coordinator | PR #5 merged at `dd28ea2`; typed source contract at `9908eda` |
| G3 DATA accepted | `CHANGES_REQUESTED` | DATA + reviewer | `5362337` handoff held on source/citation/version lineage and frozen-port conformance |
| G4 ENGINE accepted | `CHANGES_REQUESTED` | ENGINE + reviewer | `a181461` held on Web Search source/content binding and complete consulted-source trace |
| G5 SURFACE accepted | `IN_PROGRESS` | SURFACE + reviewer | S01 `6992706` approved; lane incomplete and held behind merge order |
| G6 integrated preview | `NOT_STARTED` | coordinator | Depends G3–G5 |
| G7 live Reddit/X/FMP gates | `NOT_STARTED` | coordinator + joshuai | Depends G6 and configured credentials |
| G8 production approval | `NOT_STARTED` | joshuai | Depends all prior gates |

## Workstreams

| Workstream | Branch | Status | Progress file | Latest accepted commit |
|---|---|---|---|---|
| DATA | `feat/rni-data-source-first` | `CHANGES_REQUESTED` | `DATA.md` | — |
| ENGINE | `feat/rni-engine-live-slice` | `CHANGES_REQUESTED` | `ENGINE.md` | — |
| SURFACE | `feat/rni-surface-demo` | `IN_PROGRESS`; S01 approved | `SURFACE.md` | task `6992706`, awaiting lane completion/order |
| INTEGRATION | `feat/rni-integration-demo` | `IN_PROGRESS` | `INTEGRATION.md` | local coordinator contract `264ea9c` |

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
| Source identity/persist-first/idempotency | `CHANGES_REQUESTED` | DATA handoff proves concurrency/outbox ordering; crossed natural-key conflict and frozen-port conformance remain open |
| Reddit/X separation and combined honesty | `NOT_STARTED` | — |
| S&P 500/FMP universe migration | `READY_FOR_REVIEW` | integration commits `a7b13b6`, `e535624`; local PostgreSQL 501-member stage/replay and 600/601 gates pass |
| Model route and CI | `PASSED` | PR #2 route validation; PR #5 RNI path filter and green eval |
| Toolchain reproducibility | `PASSED` | pinned pnpm 10.33 clean install plus PR #5 independent CI |
| Retention and citation safety | `CHANGES_REQUESTED` | bounded-content/database guards pass; DATA claim/source composite FK and ENGINE source/content binding remain open |
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
- 2026-09-05 — reviewed DATA `5362337`, ENGINE `a181461`, and SURFACE `6992706`; returned DATA/ENGINE P1 lineage findings, approved fixture-only SURFACE S01, resolved CR-DATA-001–004 and CR-SURFACE-01 through coordinator commits `6b67657`/`264ea9c`, and held all lane merges in the prescribed order.
