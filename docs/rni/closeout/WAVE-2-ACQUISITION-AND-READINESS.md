# Wave 2 — manifest-bound acquisition and durable readiness

**Required base:** `<W1_ACCEPTED_SHA>`.

## Definition of the solution

The immutable worker manifest and approved policy deterministically produce a bounded acquisition
plan. Reddit remains community-first and X remains independent. Persisted execution/selection
receipts distinguish planned, attempted, accepted, rejected, deferred, truncated, failed, and
unavailable work without claiming exhaustive population coverage.

Immutable readiness receipts prove exact eval applicability, narrative completion, and existing
E08 catalyst/challenger completion. They bind manifest, policy, run, platform, security, cutoff,
exact evidence membership, stage/code authority, terminal result, and canonical input/output hashes.
A terminal receipt is not automatically successful or publishable.

Wave 2 must freeze lifecycle fields needed by Wave 3's final post-E08 confidence assessment even
though Wave 3 owns the numeric formulas and publication threshold.

## Execution order

1. W2-A coordinator contract/schema freeze runs alone.
2. Integrate and push `<W2_FOUNDATION_SHA>`.
3. Run W2-B DATA and W2-C ENGINE in parallel from that SHA.
4. As either builder finishes, run W2-LR against that isolated commit. Resolve and re-review every
   P0/P1 before the coordinator integrates it.
5. Integrate accepted commits sequentially, run W2-D coordinator composition, then W2-R integrated
   read-only review.

## Session W2-A — policy and receipt foundation

**Title:** `RNI W2-A — acquisition and readiness foundation`
**Model:** `gpt-6-astra`
**Reasoning:** `xhigh`

```text
You are the sole RNI integration coordinator and migration/shared-contract writer for Wave 2-A.
Start from <W1_ACCEPTED_SHA> and verify it is an ancestor of HEAD. Read the full RNI cold-start set,
the approved Wave 0 acquisition/readiness decisions, and
docs/rni/closeout/WAVE-2-ACQUISITION-AND-READINESS.md.

Freeze the approved manifest-bound acquisition policy and immutable receipt interfaces. Define
exact community-first/manual modes, canonical query/chunk construction, limits, ranking keys and
tie-breaks, exact and near-duplicate treatment, retries, truncation, rotation/fairness if approved,
coverage denominators, and complete/partial/failed/unavailable reducers separately for Reddit and
X. Bind policy/plan/selection hashes to exact manifest membership and D-RNI-34 capture identities.

Freeze eval, narrative and catalyst/challenger receipt subjects, exact membership, applicability,
sample floors, cutoff, expiration, terminal outcomes/reasons, stage/code authority, and input/output
hashes. Reuse accepted E08/I07 facts; do not create a second catalyst truth store. Do not introduce
a narrative model task unless Wave 0 separately approved its route, schema, envelope, price and eval
authority. Ensure the schema can be referenced by Wave 3's immutable final confidence assessment.

Implement only coordinator-owned shared contracts and the owner-approved additive migration
foundation. Assign ownership explicitly for worker-authority.ts, worker-manifest.ts, analytics
policy boundaries, composition roots and tests before builders start. Do not implement ranking or
formula logic, call providers, inspect secrets, enable production, or touch excluded provisional
files. Add strict schema/canonicalization fixtures and clean/forward migration checks, commit, push,
and return <W2_FOUNDATION_SHA>.
```

## Session W2-B — DATA plan and readiness persistence

**Title:** `RNI W2-B — acquisition receipt persistence`
**Model:** `gpt-5.6-sol`
**Reasoning:** `high`

```text
You are the DATA builder for Wave 2-B. Start from <W2_FOUNDATION_SHA>. Read the full RNI cold-start
set, DATA progress, Wave 2, and the approved policy/receipt contracts.

Implement DATA-owned immutable persistence and trusted selectors for acquisition plans, query
attempts/outcomes, candidate selection/rejection, coverage facts, and eval/narrative/catalyst
readiness receipts. Every row must bind the exact manifest/run/platform/security/policy/capture/
cutoff identities required by the frozen interface. Verify receipt membership by relational facts,
not caller JSON. Exact replay is idempotent; crossed replay fails. Preserve tenant/platform/source
isolation, transaction consistency, historical lineage, and D-RNI-34 content-version identity.

Test missing/extra/duplicate receipt members, crossed model/prompt/schema/tool/eval identities,
stale eval, sample-floor edges, self-declared pass, opposing claims merged as one narrative,
cross-platform/security/run evidence, post-cutoff support, skipped-as-success, pending versus
zero-candidate completion, SQL NULL bypasses, sequential/concurrent replay, and rollback. Keep
provider calls outside transactions.

Do not edit migrations/shared contracts/composition/ENGINE/UI/coordinator progress or excluded
provisional files. Update only DATA progress. Run focused and serialized PostgreSQL gates, commit
one reviewable change, and return the standard handoff or a narrow contract request.
```

## Session W2-C — ENGINE planning and reducers

**Title:** `RNI W2-C — bounded acquisition engine`
**Model:** `gpt-5.6-sol`
**Reasoning:** `high`

```text
You are the ENGINE builder for Wave 2-C. Start from <W2_FOUNDATION_SHA>. Read the full RNI
cold-start set, ENGINE progress, Wave 2, and the approved acquisition/readiness contracts.

Implement pure deterministic plan construction, ranking, dedup/selection, coverage/status reducers,
and readiness-result construction with injected clocks and provider ports. Produce an exact trace of
planned, attempted, rejected, selected, deferred, truncated and failed work. Reddit is
community-first; do not generate ticker×subreddit scheduled searches. X is independent and never a
fallback or reallocation target. Equivalent unordered inputs must yield the same canonical plan and
selection hashes. Use only approved numeric limits and rules.

Test a fixed 501-member universe and ticker mode, query/tool budget boundaries, retry exhaustion,
provider truncation, zero-results-after-complete versus unattempted/failed, duplicate URLs,
post/comment distinction, cross-query X duplicates, A→B→A content, comparative sources, independent
platform failure, malicious provider ranking/content, crossed manifest/lease/deadline, and source
commit before model dispatch. Build narrative readiness deterministically unless an approved model
stage exists; do not invent one.

Do not implement SQL, shared contracts, persistence, UI, confidence formulas, production wiring,
or touch excluded provisional files. Update only ENGINE progress. Run focused unit/contract/eval,
typecheck and lint, commit one reviewable change, and return the standard handoff.
```

## Session W2-D — coordinator composition

**Title:** `RNI W2-D — acquisition integration`
**Model:** `gpt-6-astra`
**Reasoning:** `high`

```text
As RNI integration coordinator, start only after reviewed W2-B and W2-C commits are integrated.
Wire the accepted planner, provider ports, persistence, checkpoints, budget reservation and readiness
selectors through coordinator-owned composition. Provider I/O must occur outside database
transactions. Persist a source before any semantic model call. Preserve independent platform
leases, status, budgets and failures. Do not enable the production executor yet.

Run deterministic fake-provider tests, exact receipt persistence, 501-member plan boundaries,
retry/redelivery/concurrency, source-first crash recovery, rights/policy crossings, RNI unit/contract/
eval, serialized PostgreSQL, typecheck and lint. Update coordinator progress, commit, push, and
return <W2_INTEGRATED_SHA>.
```

## Session W2-LR — pre-integration lane review

**Title:** `RNI W2-LR — <DATA or ENGINE> lane review`
**Model:** `gpt-6-astra`
**Reasoning:** `high`

```text
Review builder commit <BUILDER_SHA> for Wave 2 session <W2-B or W2-C> read-only before integration.
Read its exact prompt, approved contracts, lane ownership and handoff. Confirm the commit descends
from <W2_FOUNDATION_SHA>, touches only assigned paths/progress, contains no invented policy, and has
the required narrow tests. Attack valid-looking crossed identities, nondeterministic ordering,
receipt self-assertion, independent-platform violations and missing failure cases relevant to that
lane. Do not edit or integrate. Return file/line P0/P1/P2 findings and PASS only after P0/P1 fixes
have been independently re-reviewed.
```

## Session W2-R — independent review

**Title:** `RNI W2-R — acquisition and receipt review`
**Model:** `gpt-6-astra`
**Reasoning:** `xhigh`

```text
Review <W2_INTEGRATED_SHA> read-only. Attack correctly hashed but crossed manifest, platform,
security, content, cutoff, eval and narrative identities; query-budget overflow; retry laundering;
provider-order nondeterminism; hidden ticker×subreddit fan-out; Reddit/X fallback or reallocation;
zero-result status inflation; near-duplicate inflation; self-declared receipts; SQL NULL bypasses;
post-cutoff evidence; and provider I/O inside transactions. Confirm no unapproved model task or
numeric policy appeared. Return file/line findings and PASS only after all Wave 2 exit tests pass.
```

## Wave 2 exit gate

The coordinator pushes `<W2_ACCEPTED_SHA>` after all P0/P1 findings are re-reviewed. Passing Wave 2
does not authorize confidence, production execution, live providers, or publication.
