# Wave 3 — deterministic confidence and final publication gate

**Required base:** `<W2_ACCEPTED_SHA>`.

## Definition of the solution

The approved methodology maps exact durable facts into seven normalized components and four
penalties using decimal-safe pure functions. Missing required facts produce unavailable confidence,
not a fabricated zero. An immutable final assessment references exact E06, E07, staged E08/I07 and
Wave 2 readiness receipts without mutating those artifacts.

The lifecycle is:

```text
E06 metrics -> E07 convergence -> durable E08/I07 staged result
-> final confidence assessment -> publication decision -> atomic visibility
```

Both ticker and full-universe paths use the same gate. One platform cannot lend confidence to the
other; a combined result never numerically pools platform confidence.

## Execution order

1. W3-A coordinator freezes formula, assessment, decision and read contracts and migration schema.
2. Integrate and push `<W3_FOUNDATION_SHA>`.
3. W3-B ENGINE, W3-C DATA, and W3-D SURFACE may run in parallel from that exact SHA. Each owns a
   different lane and progress file.
4. As each builder finishes, run W3-LR against that isolated commit. Resolve and re-review every
   P0/P1 before integrating the commit.
5. Integrate accepted commits one at a time; run W3-E coordinator composition.
6. Run W3-R independent integrated review when a reviewer slot is available.

## Session W3-A — methodology and lifecycle foundation

**Title:** `RNI W3-A — confidence contract and final gate`
**Model:** `gpt-6-astra`
**Reasoning:** `xhigh`

```text
You are the sole RNI integration coordinator and migration/shared-contract writer for Wave 3-A.
Start from <W2_ACCEPTED_SHA>. Read the full RNI cold-start set, Wave 0 approved methodology,
Wave 2 receipt contracts, and docs/rni/closeout/WAVE-3-CONFIDENCE-AND-PUBLICATION.md.

Freeze the exact owner-approved raw inputs, denominators, normalization, valid ranges, missingness,
cutoffs, weights, caps, interactions and rounding for all seven components: provenance integrity,
evidence quality, security resolution, breadth/independence, model calibration, coverage/recency,
and contradiction handling. Freeze triggers and magnitudes for unresolved-material-claim,
high-noise, suspected-coordination and route-capability-degradation penalties. Reconcile these with
the frozen contract's descriptive factor names. Freeze bands, hard floors, inclusive publication
thresholds and below-threshold display behavior.

Add strict contracts and owner-approved golden vectors for an immutable post-E08 final assessment
and publication decision. It must reference exact E06/E07/staged E08 and readiness receipt IDs and
hashes, cutoff, method version, score or unavailable reason, hard-block reasons, and platform-
specific decision. Split durable E08 staging from visibility for ticker and full-universe paths.
Preserve existing artifacts rather than rewriting E06 or E07. Bind final decisions into D-RNI-33
release reconstruction and every citation/evidence read gate.

Implement only coordinator-owned contracts, reference fixtures and additive migration foundation.
Do not implement formulas, repository logic, UI, provider calls, live tests, production composition,
or touch excluded provisional files. Run contract, schema and clean/forward migration tests. Commit,
push, and return <W3_FOUNDATION_SHA>. Stop if any formula or threshold is not explicitly approved.
```

## Session W3-B — ENGINE confidence evaluator

**Title:** `RNI W3-B — deterministic confidence engine`
**Model:** `gpt-5.6-sol`
**Reasoning:** `high`

```text
You are the ENGINE builder for Wave 3-B. Start from <W3_FOUNDATION_SHA>. Read the full RNI
cold-start set, ENGINE progress, Wave 3, and the approved formula contract.

Implement decimal-safe pure normalization, component aggregation, penalties, caps, rounding, bands,
hard floors and final platform-specific publication decision exactly as frozen. Consume only exact
evidence vectors and readiness facts. Never use an LLM for arithmetic. Missing required facts must
return the approved unavailable result. Combined status may describe independently passing sources
but may not pool scores or lift a failing platform.

Add exact golden vectors and boundary tests below/equal/above every threshold, rounding and cap;
missing/zero inputs; duplicate/concentration penalties; zero-weight evidence; stale or mismatched
receipts; low-sample eval; opposing evidence; one passing platform; both failing; no-catalyst and
no-claim skips; valid score plus hard citation/rights failure; and E08 success with confidence
failure. Add metamorphic/monotonic checks only where the approved math guarantees them.

Do not edit persistence, migrations, contracts, UI, acquisition, provider code, production
composition, or excluded provisional files. Update only ENGINE progress. Run focused unit/contract/
eval, typecheck and lint, commit one reviewable change, and return the standard handoff.
```

## Session W3-C — DATA assessment and decision persistence

**Title:** `RNI W3-C — final assessment persistence`
**Model:** `gpt-5.6-sol`
**Reasoning:** `high`

```text
You are the DATA builder for Wave 3-C. Start from <W3_FOUNDATION_SHA>. Read the full RNI cold-start
set, DATA progress, Wave 3, and the frozen assessment/publication contracts.

Implement immutable final-assessment and publication-decision persistence plus trusted selectors.
Relationally verify exact E06/E07/staged E08 and readiness receipt membership, method/config/cutoff,
platform/security/run authority, and rights/citation state. Callers provide intent or durable result
identity, not component scores or an arbitrary final hash. Preserve staging invisibility until the
atomic ticker or D-RNI-33 full-universe release commits.

Test missing/extra/duplicate/crossed artifact or receipt identities, stale assessment, changed
evidence after cutoff, exact replay, delayed retry, crash between staging/assessment/release,
concurrency, rights withdrawal, SQL NULL, below-threshold results, one-platform publication, and no
pre-release radar/detail/citation/evidence leak. Recompute membership from rows even when supplied
JSON is internally hash-consistent.

Do not edit migrations/shared contracts/ENGINE/UI/composition/coordinator progress or excluded
provisional files. Update only DATA progress. Run focused and serialized PostgreSQL tests, commit
one reviewable change, and return the standard handoff.
```

## Session W3-D — SURFACE confidence states

**Title:** `RNI W3-D — confidence presentation`
**Model:** `gpt-5.6-terra`
**Reasoning:** `medium`

```text
You are the SURFACE builder for Wave 3-D. Start from <W3_FOUNDATION_SHA>. Read the full RNI
cold-start set, SURFACE progress, Wave 3, UI_SPEC and the frozen read fixtures.

Consume only the frozen RniReadService confidence/publication fields. Present Reddit, X and combined
sections separately. Show pending, unavailable, failed, below-threshold/insufficient, partial and
publishable states exactly as approved, including freshness and coverage caveats. Never calculate
confidence, infer a missing platform, pool source counts, expose staged artifacts, or frame
confidence as price probability or investment advice.

Add fixture-backed responsive, keyboard and accessibility tests for missing receipts, one passing
platform, both failing, stale assessment, and citation traversal. Do not edit repositories,
analytics, migrations, shared contracts, API composition, provider code or excluded provisional
files. Update only SURFACE progress. Run focused component/browser/accessibility tests, production
build if required, commit one reviewable change, and return the standard handoff.
```

## Session W3-E — coordinator publication composition

**Title:** `RNI W3-E — final gate integration`
**Model:** `gpt-6-astra`
**Reasoning:** `high`

```text
As RNI integration coordinator, start after reviewed W3-B/C/D commits are integrated. Wire the
accepted final assessment between durable E08 staging and publication for both ticker and full-
universe paths. Extend D-RNI-33 reconstruction and all read gates to require the exact accepted
decision. Preserve rights revalidation, source-specific status, replay with zero extra model calls,
atomic visibility and the disabled production executor.

Run formula golden/boundary tests, PostgreSQL assessment/release/read visibility and direct-SQL
attacks serially, ticker and 501-member replay/crash/rights-withdrawal scenarios, RNI unit/contract/
eval, typecheck, lint, build and affected browser/accessibility tests. Update coordinator progress,
commit, push, and return <W3_INTEGRATED_SHA>.
```

## Session W3-LR — pre-integration lane review

**Title:** `RNI W3-LR — <ENGINE, DATA, or SURFACE> lane review`
**Model:** `gpt-6-astra`
**Reasoning:** `high`

```text
Review builder commit <BUILDER_SHA> for Wave 3 session <W3-B, W3-C, or W3-D> read-only before
integration. Read its exact prompt, approved contracts, lane ownership and handoff. Confirm the
commit descends from <W3_FOUNDATION_SHA>, touches only assigned paths/progress, implements no
unapproved formula/fallback/client arithmetic, and has the required narrow tests. Attack correctly
hashed crossed inputs and boundary/missingness/failure cases relevant to that lane. Do not edit or
integrate. Return file/line P0/P1/P2 findings and PASS only after P0/P1 fixes have been independently
re-reviewed.
```

## Session W3-R — independent review

**Title:** `RNI W3-R — confidence and publication review`
**Model:** `gpt-6-astra`
**Reasoning:** `xhigh`

```text
Review <W3_INTEGRATED_SHA> read-only. Recalculate owner-approved vectors independently and attack
precision, rounding, caps, missingness, duplicate inflation, crossed valid receipts, stale cutoffs,
unapproved fallbacks, E08-direct-to-publication paths, one-platform score lifting, staged-data read
bypasses, forged assessment JSON, rights races, ticker/full-universe divergence and replay model
redispatch. Confirm no client-side arithmetic and no confidence-as-price-probability copy. Return
file/line findings and PASS only after all P0/P1 findings are fixed and re-reviewed.
```

## Wave 3 exit gate

The coordinator pushes `<W3_ACCEPTED_SHA>`. This authorizes Wave 4 engineering only; it does not
authorize live providers, authority activation, deployment, or production promotion.
