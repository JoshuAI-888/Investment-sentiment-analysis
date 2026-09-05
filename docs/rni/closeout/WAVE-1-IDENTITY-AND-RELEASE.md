# Wave 1 — evidence identity, semantic completion, and atomic release

**Required base:** `<W0_CHECKPOINT_SHA>` containing explicit owner approvals and frozen interfaces.

## Definition of the solution

Wave 1 closes three coupled correctness blockers:

- D-RNI-34 represents stable sources, immutable content versions, all retrieval provenance, and
  manifest-bound semantic work without reusing stale spans or membership.
- Comparative sources complete through a durable, canonical per-security manifest plus resolver,
  abstention, and relationship-stage outcomes derived from persisted rows.
- D-RNI-33 rebuilds the complete full-universe release index from relational facts in PostgreSQL,
  then null-safely rejects any different caller representation before visibility changes.

The production executor remains disabled after this wave.

## Execution order

1. Run W1-A alone. It is the sole shared-contract and migration writer.
2. Integrate and push W1-A as `<W1_FOUNDATION_SHA>`.
3. Run W1-B (DATA) and W1-C (ENGINE) in parallel from that exact SHA.
4. As either builder finishes, run W1-LR against that isolated commit. Resolve and re-review every
   P0/P1 before integrating each accepted builder sequentially.
5. Run W1-D coordinator composition and integrated tests.
6. Run W1-R as an independent read-only review; resolve and re-review every P0/P1.

## Session W1-A — shared schema and database authority

**Title:** `RNI W1-A — identity and release foundation`
**Model:** `gpt-6-astra`
**Reasoning:** `xhigh`

```text
You are the sole RNI integration coordinator and sole migration writer for Wave 1-A. Start from
<W0_CHECKPOINT_SHA> in an isolated worktree and verify it is an ancestor of HEAD. Read the full
RNI cold-start set plus docs/rni/closeout/WAVE-1-IDENTITY-AND-RELEASE.md and every owner-approved
decision it cites.

Implement only the coordinator-owned shared foundation for the approved D-RNI-34 capture/work
identity, multi-security completion manifest, and D-RNI-33 database reconstruction. Freeze exact
ports, strict schemas, canonical sorting/hashing, resolver/abstention/relationship terminal
outcomes, content-version subject identity, and historical compatibility. If Migration 0024 is
already applied in any target environment, create the owner-approved forward migration instead of
rewriting history; otherwise change only the migration explicitly authorized by the decision.

For D-RNI-33, make PostgreSQL reconstruct exact run/plan/manifest/universe/member/cutoff identity,
the ordered member set, selected synthesis/convergence identities and hashes, Reddit/X slice
identities and terminal outcomes, counts, status, member-index hash, aggregate hash, receipt,
terminal execution state, and released budget from trusted rows. Use explicit required-key/type
checks and IS DISTINCT FROM so SQL NULL cannot bypass rejection. Preserve commit-time rights
revalidation and atomic visibility.

Add direct-SQL adversarial tests for missing, extra, duplicate, reordered, crossed, null, wrong-type,
and internally self-consistent forged release JSON. Add clean and forward migration cases. Do not
edit DATA/ENGINE/SURFACE progress files, provider code, confidence/acquisition policy, production
composition, authority values, or the excluded provisional files. Do not enable production.

Run focused contract and PostgreSQL tests serially. Commit and return <W1_FOUNDATION_SHA> only if
the interfaces can express every approved fixture and the database rejects caller-only authority.
Stop if approval is missing, migration history is unresolved, or a forward migration allocation
has not been authorized.
```

## Session W1-B — DATA persistence

**Title:** `RNI W1-B — durable evidence and semantic persistence`
**Model:** `gpt-5.6-sol`
**Reasoning:** `high`

```text
You are the DATA builder for Wave 1-B. Start from <W1_FOUNDATION_SHA> in an isolated worktree and
verify it is an ancestor of HEAD. Read the full RNI cold-start set, docs/rni/progress/DATA.md,
docs/rni/closeout/WAVE-1-IDENTITY-AND-RELEASE.md, and the approved Wave 0 decisions.

Implement only DATA-owned repositories and persistence tests against the frozen interfaces. Work
in two sequential milestones: (1) source/retrieval/content-association/outbox/checkpoint identity;
(2) semantic resolver, exact per-security observation membership, relationship outcome, aggregate
completion, and any assigned full-universe selector/publication repository adaptation. Derive
completion from durable rows; a caller may not choose the completion hash.

Support first capture, exact retry, a new retrieval with unchanged content, changed content,
A→B→A, same content across runs under exact authority, comparative NVDA/AMD output, valid empty
relationship result, deterministic relationship skip, and unresolved-only abstention. Reject
crossed source/retrieval/content/event/policy/run/platform/security identities, missing or extra
members, stale spans, conflicting replay, partial semantic output, and failed relationships
disguised as empty output. Prove sequential and concurrent behavior and all crash boundaries.

Provider calls are forbidden. Do not edit shared contracts, migrations, composition/semantic.ts,
composition/types.ts, ENGINE files, master/integration progress, production factories, or the two
excluded provisional files. Update only docs/rni/progress/DATA.md with the exact state you commit.
If a frozen interface is insufficient, record one narrow contract request and stop that dependent
work rather than forking the contract locally.

Run narrow repository tests, normal-origin PostgreSQL tests, clean/forward migration regression,
and the assigned DATA gate serially. Commit one reviewable change and return the standard handoff.
Do not claim end-to-end completion before coordinator integration.
```

## Session W1-C — ENGINE semantic manifest

**Title:** `RNI W1-C — semantic completion engine`
**Model:** `gpt-5.6-sol`
**Reasoning:** `high`

```text
You are the ENGINE builder for Wave 1-C. Start from <W1_FOUNDATION_SHA> in an isolated worktree and
verify it is an ancestor of HEAD. Read the full RNI cold-start set, docs/rni/progress/ENGINE.md,
docs/rni/closeout/WAVE-1-IDENTITY-AND-RELEASE.md, and the approved Wave 0 decisions.

Implement only ENGINE-owned pure validation, canonical manifest construction, workflow consumers,
and unit/contract fixtures for the frozen semantic-completion interface. Preserve one independent
classification for every resolved security and a separate relationship outcome. Canonically sort
exact decimal strings and unique identities; reordered equivalent inputs must hash identically.
Represent single-security relationship skip, valid empty multi-security relationship result, and
unresolved-only abstention exactly as approved. A relationship provider failure is never an empty
success. Changed content cannot inherit old membership, spans, model input, or completion.

Use the NVDA bullish/AMD bearish preferred-over fixture. Test missing/extra/duplicate security,
shared observation IDs, wrong input hash, precision changes, reversed/cross-platform relation,
missing relationship stage, prompt injection, stale parent attempt, and exact replay with no model
redispatch. Do not implement SQL, repositories, confidence, acquisition policy, UI, shared
composition, production enablement, or touch the excluded provisional files. Update only
docs/rni/progress/ENGINE.md with the state you commit.

If a frozen interface is insufficient, record one narrow contract request and stop dependent work.
Run focused unit/contract/eval regressions, typecheck, and scoped lint. Commit one reviewable change
and return the standard handoff. DATA persistence may be incomplete in your worktree; do not fake it.
```

## Session W1-D — coordinator composition

**Title:** `RNI W1-D — identity integration`
**Model:** `gpt-6-astra`
**Reasoning:** `high`

```text
You are the RNI integration coordinator for Wave 1-D. Start only after the reviewed W1-B and W1-C
commits have been integrated onto the pushed integration checkpoint. Read the full cold-start set
and Wave 1 file. Inventory the combined diff and confirm no ownership crossing.

Wire only coordinator-owned composition/semantic.ts, composition/types.ts, shared ports, release
read gates, and other explicitly integration-owned seams needed to connect the accepted DATA and
ENGINE changes. Preserve source commit before semantic dispatch, provider I/O outside transactions,
exact manifest/lease/deadline authority, independent Reddit/X state, commit-time rights checks, and
atomic release visibility. Keep getProductionRniWorkerExecutor() unavailable.

Run the integrated comparative source from durable capture through semantic completion, independent
platform analytics, cited staged output, and exact replay without duplicates or additional model
calls. Run D-RNI-33 direct-SQL attacks, D-RNI-34 replay/concurrency/crash tests, clean/forward
migration tests, tracked RNI PostgreSQL serially, RNI unit/contract/eval, typecheck and lint. Update
only coordinator-owned progress, commit, push, and return <W1_INTEGRATED_SHA>.
```

Before the integrated review, use this prompt for each isolated builder commit.

## Session W1-LR — pre-integration lane review

**Title:** `RNI W1-LR — <DATA or ENGINE> lane review`
**Model:** `gpt-6-astra`
**Reasoning:** `high`

```text
Review builder commit <BUILDER_SHA> for Wave 1 session <W1-B or W1-C> read-only before integration.
Read its exact prompt, approved decisions, frozen interfaces, lane ownership and handoff. Confirm it
descends from <W1_FOUNDATION_SHA>, touches only assigned paths/progress, and has all required narrow
tests. Attack correctly hashed crossed capture/security/relationship identities, stale membership,
caller-controlled completion and replay/concurrency gaps relevant to that lane. Do not edit or
integrate. Return file/line P0/P1/P2 findings and PASS only after P0/P1 fixes are independently
re-reviewed.
```

## Session W1-R — independent adversarial review

**Title:** `RNI W1-R — identity and release review`
**Model:** `gpt-6-astra`
**Reasoning:** `xhigh`

```text
Review <W1_INTEGRATED_SHA> read-only against the approved Wave 0 decisions and Wave 1 acceptance
plan. Do not edit, commit, call providers, inspect secrets, or update progress.

Attack valid-looking and correctly hashed but crossed identities; same-content later retrieval;
changed content and A→B→A; stale spans; partial classifications; unresolved and relationship skip
semantics; failed relation presented as empty; caller-chosen checkpoint hash; stale parent/child
lease; SQL NULL; forged self-consistent aggregate JSON; N−1/extra/reordered/cross-platform members;
rights withdrawal; transaction rollback; and pre-release citation/evidence visibility.

Return P0/P1/P2 findings with exact file/line evidence and missing tests. Return PASS only if direct
database bypass tests, concurrency, clean/forward migration, comparative replay, and atomic release
visibility all pass. Confirm the production executor remains disabled.
```

## Wave 1 exit gate

Every P0/P1 is resolved and independently re-reviewed; the coordinator pushes
`<W1_ACCEPTED_SHA>`. Wave 2 must start from that SHA.
