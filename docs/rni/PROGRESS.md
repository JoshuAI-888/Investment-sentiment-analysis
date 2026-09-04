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
| G4 ENGINE accepted | `IN_PROGRESS` | ENGINE + reviewer | E01–E08 accepted through `b96162a`; E09–E10 remain |
| G5 SURFACE accepted | `ACCEPTED_WAITING_ORDER` | SURFACE + reviewer | S01–S10 accepted; code `c68980b`, final tracker `5d9cd3d`; merge waits behind ENGINE |
| G6 integrated preview | `NOT_STARTED` | coordinator | Depends G3–G5 |
| G7 live Reddit/X/FMP gates | `NOT_STARTED` | coordinator + joshuai | Depends G6 and configured credentials |
| G8 production approval | `NOT_STARTED` | joshuai | Depends all prior gates |

## Workstreams

| Workstream | Branch | Status | Progress file | Latest accepted commit |
|---|---|---|---|---|
| DATA | `feat/rni-data-source-first` | `MERGED_TO_INTEGRATION` | `DATA.md` | lane `5926601`; merge `254fe45` |
| ENGINE | `feat/rni-engine-live-slice` | `IN_PROGRESS`; E01–E08 accepted | `ENGINE.md` | `b96162a` |
| SURFACE | `feat/rni-surface-demo` | `READY_FOR_MERGE`; waits behind ENGINE | `SURFACE.md` | code `c68980b`; lane head `5d9cd3d` |
| INTEGRATION | `feat/rni-integration-demo` | `IN_PROGRESS` | `INTEGRATION.md` | I06 passed at `5950b53`; current coordinator record follows |

## Confirmed product decisions

- Scope: isolated RNI vertical slice.
- Reddit: OpenAI Web Search only; no Reddit API dependency.
- X: independent datasource; never fallback.
- Output: Reddit sentiment, X sentiment, combined summary.
- RNI AI route: OpenAI Direct default; Gateway optional.
- Balanced model policy: Terra/low for discovery, relationship and classification; Sol/low for
  verification and challenger; Gateway is explicit same-family parity with no silent fallback.
- Initial RNI AI limits: USD 2/manual ticker run, USD 25/full-universe run, USD 50/rolling day,
  USD 300/month warning and USD 500/month hard stop (D-RNI-21).
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
| S&P 500/FMP universe migration | `PASSED` | I05/I06 independently accepted; affected PostgreSQL 23/23, focused 26/26; deployment gates remain G6/G7 |
| Model route and CI | `PASSED` | PR #2 route validation; PR #5 RNI path filter and green eval |
| Toolchain reproducibility | `PASSED` | pinned pnpm 10.33 clean install plus PR #5 independent CI |
| Retention and citation safety | `IN_PROGRESS` | DATA claim/source FK and ENGINE source/content binding findings resolved; full publication gate remains later work |
| Cost and 500+ symbol workload | `POLICY_LOCKED` | D-RNI-21 owner-approved limits; I10 enforcement and measured full-universe calibration pending |
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
- 2026-09-05 — accepted ENGINE E03 at `1597eea` after coordinator base/ownership review and focused 17/17 rerun; accepted SURFACE S03 at `b85d9c7` after D-RNI-14 consumption review, typecheck and RNI contract 13/13. Builders advanced to E04/S04; lane merges remain held.
- 2026-09-05 — independent re-review passed I05 and held I06 on abandoned running commands plus non-atomic stage/terminal persistence. I06R3 opened for audited no-redispatch stale terminalization, atomic staging, and missing database branch coverage.
- 2026-09-05 — closed I06 re-review IR-07–10 as D-RNI-16: active duplicates return retry timing without refetch, abandoned claims terminalize without redispatch, staging and command success are atomic, and PostgreSQL covers invalid replay plus bootstrap conflicts/immutability. I06 is ready for final re-review.
- 2026-09-05 — closed final I06 findings at `5950b53`: provider attempts bind transactionally before adapter return and survive post-dispatch abandonment; insert-then-conflict bootstrap rollback is self-contained. Independent review returned READY, so I05/I06 and the universe implementation risk pass; external migration/entitlement/source-rights checks remain G6/G7.
- 2026-09-05 — accepted SURFACE S04 at `6c0df68` after returning duplicate dialog IDs and incomplete keyboard focus as SR-05; coordinator typecheck/lint/contract 13/13 and Chromium provenance/accessibility 9/9 pass. SURFACE advanced to S05 and remains unmerged.
- 2026-09-05 — accepted SURFACE S05 at `d4c1a09`: frozen read-service traversal exposes only citation-linked bounded evidence and canonical URLs, while unavailable X stays explicitly uncited. Coordinator typecheck/lint/contract 13/13 and complete focused Chromium 10/10 pass; SURFACE advanced to S06 and remains unmerged.
- 2026-09-05 — accepted ENGINE E04 at final-base `4f57f01` (implementation reviewed at pre-amend `59a936f`): committed bounded evidence is the sole public resolution entry, exact security resolution requires a versioned ambiguity policy, and comparative relations fail closed on IDs/spans before deterministic canonicalization. Coordinator typecheck/lint and unit/contract/eval 19/19 pass; ENGINE advanced to E05 and remains unmerged.
- 2026-09-05 — accepted SURFACE S06 at `ffd5119`: run and source state remain independently labelled for Reddit/X across partial, refreshing, stale, failed, unpublished and empty fixtures; in-progress sources expose no derived combined result. Coordinator typecheck/lint/contract 13/13 and Chromium 11/11 pass; SURFACE advanced to S07 and remains unmerged.
- 2026-09-05 — accepted CR-SURFACE-04 for I02E/D-RNI-17: the additive manual-refresh command accepts only an idempotency key plus ticker/full scope; server composition owns auth, audit, active config/universe/window resolution and returns one durable run identity with accepted/duplicate disposition and resolved scope preview.
- 2026-09-05 — accepted ENGINE E05 at `5d9b8f3`: committed bounded evidence is classified once per target security through an exact hashed no-tool payload; four dimensions, policy/taxonomy versions, source-bound claims/themes/noise and non-publishable citation proposals fail closed. Coordinator typecheck/lint and unit/contract/eval 15/15 pass; ENGINE advanced to E06 and remains unmerged.
- 2026-09-05 — accepted SURFACE S07 through `babd940` after returning post-submit-only scope/fixed keys, a timing-dependent pending assertion, and an unguarded fixture route. D-RNI-17 service replay/crossed-key tests, pre-submit 501/ticker scope, fresh intentional keys, controlled pending disable and runtime fixture denial now pass; coordinator type/lint/contract 14/14, guard 1/1 and Chromium 4/4 twice. SURFACE advanced to S08 and remains unmerged.
- 2026-09-05 — accepted CR-SURFACE-05 as D-RNI-18: a separate frozen universe read service exposes active FMP metadata with NVDA default, bounded case-insensitive active-member search and an immutable staged child with complete count-reconciled impact. Typecheck/lint, RNI contract 15/15 and full contract 85/22 skipped pass; SURFACE S08 is unblocked after rebase.
- 2026-09-05 — adversarial review returned D-RNI-18 on ICR-01/02 before SURFACE consumption: the initial 100-member legacy→FMP preview was unrepresentable and balanced impossible impact sets passed. I02F1 now distinguishes legacy/FMP active lineage, requires 501–600 for FMP reads and rejects over-add/remove impacts; independent re-review is pending before the superseding SHA is issued.
- 2026-09-05 — independent I02F1 re-review returned READY at `098f010`: the 100→501 legacy/FMP transition, 501–600 bounds, impossible-impact rejection and read-only provider/mutation isolation pass with focused contract 15/15 plus type/lint. CR-SURFACE-05 is fully accepted and S08 may resume from the superseding integration head.
- 2026-09-05 — accepted ENGINE E06 at `ecbf049` after returning ER-07/08: positive-weight traces now gate effective source/community/narrative breadth, sentiment independence and confidence while raw distinct-source attention stays visible; EOF-only diff failures were removed. Coordinator type/lint, focused unit/contract/eval 18/18 and branch diff check pass; ENGINE advances to E07 after rebase and remains unmerged.
- 2026-09-05 — accepted ENGINE E07 at `d1ef93a`: deterministic convergence preserves independently labelled Reddit/X snapshots, emits no pooled metric, maps explicit terminal/freshness coverage into combined state, and binds replay to canonical input/result hashes. Coordinator type/lint, focused unit/contract/eval 21/21 and branch diff check pass; ENGINE advances to E08 and remains unmerged.
- 2026-09-05 — accepted SURFACE S08 at `f929ab8` after SR-09–14 correction: the server owns the frozen universe-read seam, the UI is props-only, parsed search is bounded and version-bound, active legacy/FMP lineage plus staged identity impact remain explicit, and keyboard/live-status/legacy branches are covered. Coordinator type/lint, RNI contract 15/15, production build and Chromium 3/3 pass; independent adversarial review returned READY. SURFACE advances to S09 and remains unmerged.
- 2026-09-05 — accepted CR-ENGINE-001 as D-RNI-19 for I07: P0 keeps Reddit/X source rights and labels separate social evidence as corroboration, while migration `0024` and the integration port must persist exact claim/cutoff, separate verifier/challenger invocations, claim-specific citation roles, analytics lineage and ordered sentence trace. E08 `70dcfed` remains changes-requested on ER-10–13 despite focused 31/31: hindsight evidence, factual-verification overstatement, caller-declared claim/model lineage and incomplete URL/rights validation must fail closed before acceptance.
- 2026-09-05 — accepted CR-SURFACE-06 as D-RNI-20: a frozen future-run route service exposes the active config, Direct/Gateway availability and server-resolved task models without secrets; its intent-only idempotent command creates a successor config and never rewrites historical runs. Typecheck/lint, RNI contract 17/17 and full contract 87/22 skipped pass; SURFACE S09 is unblocked after rebase.
- 2026-09-05 — accepted corrected ENGINE E08 at final handoff `b96162a` (code reviewed at byte-identical `3132589`): a trusted common cutoff excludes future evidence from claim-specific verifier inputs, Reddit/X evidence is bounded social corroboration rather than factual verification, persisted claims and distinct verifier/challenger invocations are revalidated, and native canonical identity plus original citation URLs and the active rights policy fail closed. Coordinator typecheck/lint and focused unit/contract/eval 46/46 pass; independent adversarial review returned READY. ENGINE advances to E09 and remains unmerged.
- 2026-09-05 — reviewed ENGINE E09 `a6177d3`; focused router plus E08 regression 57/57, typecheck, lint and diff checks pass, but independent review returned four P1s. E09 must route every active ENGINE model stage, strictly parse/delimit task inputs, retain historical prompt definitions and durably finalize both successful and failed model-call attempts with complete prompt/tool/budget lineage. E01–E08 remain accepted; E09 is changes requested and E10 has not started.
- 2026-09-05 — owner approved D-RNI-21: Direct remains the RNI default; Terra/low serves discovery, relationship and classification; Sol/low serves verifier/challenger; Gateway is explicit same-family parity without silent fallback. Initial AI-spend limits are USD 2/manual run, USD 25/full-universe run, USD 50/rolling day, USD 300/month warning and USD 500/month hard stop; I10 implementation and measured calibration remain pending.
- 2026-09-05 — re-reviewed corrected ENGINE E09 `c4668b3`: route coverage is now complete and focused router 17/17 plus E08 regression 46/46, typecheck, scoped lint and diff check pass. Acceptance remains held on ER-15–18 because literal evidence delimiters are spoofable, reconstructed v1 prompts do not reproduce accepted historical bytes, classifier observation and dispatch hashes diverge, and failed post-response validation discards billed telemetry. E01–E08 remain accepted; E10 remains not started.
- 2026-09-05 — accepted SURFACE S09 `8d1d943` after coordinator typecheck/lint, frozen contracts 17/17, production build and Chromium 3/3 plus independent adversarial PASS. Future route changes create successor configuration only, historical lineage remains immutable and the UI stays compatible with D-RNI-21 server-resolved task mappings. S10 remains before lane merge; the builder must clean an unrelated uncommitted package-policy mutation and rebase current integration.
- 2026-09-05 — accepted final SURFACE S10 code at `c68980b`, with accepted-state tracker head `5d9cd3d`: ownership/diff checks, typecheck, focused lint, frozen contracts 17/17, production build and complete RNI Chromium 22/22 pass; independent adversarial review returned PASS. All seven surfaces have one H1, no scoped axe violations and no 375px overflow; unavailable Gateway is disabled with its labelled reason. G5 is accepted but the branch waits behind ENGINE in the required merge order.
- 2026-09-05 — re-reviewed ENGINE E09 correction `80a5d2b`: exact historical prompt replay, base64url input containment and classifier hash parity now pass, and failed calls retain billed telemetry; coordinator typecheck/lint plus affected 97/97 are green. E09 remains held on ER-17/19 because durable errors still include attacker-controlled/provider exception text and the new serializer sits outside an ENGINE-owned subtree. E10 remains not started.
