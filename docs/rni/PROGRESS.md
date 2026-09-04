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
| G3 DATA accepted | `PASSED` | DATA + reviewer | merged sequentially at `254fe45`; coordinator type/contract plus fresh PostgreSQL DATA 41/41 pass |
| G4 ENGINE accepted | `IN_PROGRESS` | ENGINE + reviewer | E01 accepted at `b3e8220`; E02 corrections accepted at `0e229d6`; E03–E10 remain |
| G5 SURFACE accepted | `IN_PROGRESS` | SURFACE + reviewer | S01–S02 accepted; CR-SURFACE-03 accepted as D-RNI-14 and S03 unblocked; S03–S10 remain |
| G6 integrated preview | `NOT_STARTED` | coordinator | Depends G3–G5 |
| G7 live Reddit/X/FMP gates | `NOT_STARTED` | coordinator + joshuai | Depends G6 and configured credentials |
| G8 production approval | `NOT_STARTED` | joshuai | Depends all prior gates |

## Workstreams

| Workstream | Branch | Status | Progress file | Latest accepted commit |
|---|---|---|---|---|
| DATA | `feat/rni-data-source-first` | `MERGED_TO_INTEGRATION` | `DATA.md` | lane `5926601`; merge `254fe45` |
| ENGINE | `feat/rni-engine-live-slice` | `IN_PROGRESS`; E01–E02 accepted | `ENGINE.md` | `0e229d6`, must rebase current integration before E03 |
| SURFACE | `feat/rni-surface-demo` | `IN_PROGRESS`; S01–S02 accepted, S03 unblocked | `SURFACE.md` | S03 blocker `57fd90c`; rebase D-RNI-14 before implementation |
| INTEGRATION | `feat/rni-integration-demo` | `IN_PROGRESS` | `INTEGRATION.md` | I06R2 universe review corrections (D-RNI-15; current task commit) |

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
| Source identity/persist-first/idempotency | `PASSED` | DATA merged at `254fe45`; crossed keys fail closed, source port returns committed IDs, concurrent outbox tests pass |
| Reddit/X separation and combined honesty | `IN_PROGRESS` | ENGINE E01 source binding and SURFACE S02 Radar accepted; D-RNI-13 freezes source-separated cells; remaining pipeline/UI tasks open |
| S&P 500/FMP universe migration | `READY_FOR_REVIEW` | all six independent-review findings corrected; pre-fetch replay and clean 501-security bootstrap join approval/membership/count/date/lineage gates |
| Model route and CI | `PASSED` | PR #2 route validation; PR #5 RNI path filter and green eval |
| Toolchain reproducibility | `PASSED` | pinned pnpm 10.33 clean install plus PR #5 independent CI |
| Retention and citation safety | `IN_PROGRESS` | DATA claim/source FK and ENGINE source/content binding findings resolved; full publication gate remains later work |
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
- 2026-09-05 — accepted ENGINE E01 at `b3e8220`, closed its three initial findings, returned one same-security narrative-membership P1 to DATA, accepted SURFACE S01 at `71010bd`, and resolved CR-SURFACE-02 as D-RNI-13 with a cursor-paginated non-poolable Radar contract.
- 2026-09-05 — accepted and sequentially merged DATA at `254fe45` after all five findings closed, latest integration rebase confirmed, typecheck/full contract passed, and a fresh disposable PostgreSQL run passed all 41 RNI persistence tests.
- 2026-09-05 — reviewed ENGINE E02 `3b73f25`; held acceptance because usable partial X responses could be labelled complete, author identity hashing was unsalted/mutable, and content-version output did not identify exactly one latest interpretation candidate.
- 2026-09-05 — accepted SURFACE S02 at `c4899b8` after its same-commit tracker was reconciled; coordinator typecheck, focused lint, contract 11/11, production build and Chromium desktop/narrow/keyboard 4/4 all passed.
- 2026-09-05 — accepted ENGINE E02 corrections at `0e229d6`; partial-success signaling, tenant-safe stable identity and A→B→A latest-version semantics are covered by 20/20 independently rerun focused tests.
- 2026-09-05 — accepted CR-SURFACE-03 as D-RNI-14; the additive security-detail read freezes exactly four cited dimensions per independently labelled platform and rejects missing, pooled, relabelled or uncited publishable data.
- 2026-09-05 — independent review held I05/I06 on four P1 and two P2 universe findings: activation could alter/unapproved-stale membership, idempotency began after FMP, 500 rows passed, clean security bootstrap was absent, FMP lineage was DB-optional, and impossible dates passed structural validation.
- 2026-09-05 — closed universe findings IR-01/03/05/06: FMP activation now requires one-way admin approval, exact stored membership and current parent; PostgreSQL requires complete provider lineage; exactly 500 and impossible dates fail; fresh DB activation/version tests pass 14/14.
- 2026-09-05 — closed IR-02/04 as D-RNI-15: a durable command claim now precedes FMP dispatch and replays terminal outcomes with lineage; a reviewed hash-bound FMP profile import bootstraps a clean 501-security master. I05/I06 are ready for independent re-review.
