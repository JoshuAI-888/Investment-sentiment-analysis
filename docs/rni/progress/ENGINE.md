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
| E01 | Reddit OpenAI Web Search discovery and canonical candidate normalization | `COMPLETE` | 16 focused tests: exact source/evidence binding, URL-only abstention, complete action lineage, half-open windows, dedup, frozen-source compatibility; coordinator accepted, current rebased `62ccc29` |
| E02 | Existing X adapter port and independent terminal source slice | `COMPLETE` | 20 focused tests: partial-success propagation, isolation, tenant-safe identity, retrieval/version lineage, A→B→A latest selection, half-open windows; coordinator accepted, current rebased `19d8e7c` |
| E03 | Persist-first workflow, retry, checkpoint and budget logic | `COMPLETE` | 17 focused tests: commit/checkpoint and enqueue/completion crashes, exact redelivery, lease heartbeat, retry not-before, bounded jitter, stable budget reservation, durable wall-time and hash integrity; coordinator accepted, current rebased `f3af838` |
| E04 | Security resolver and multi-security relationships | `COMPLETE` | 19 focused tests: exact NVDA/AMD offsets, governed bare-ticker abstention, duplicate-symbol ambiguity, committed-evidence-only inference, cited canonical relationship deduplication; coordinator accepted current rebased `3b89c7d` |
| E05 | Four-dimension classifier, themes, claims and noise labels | `COMPLETE` | 15 focused tests: isolated opposing security stance, four dimensions, mixed dimension/theme stance, source spans, taxonomy/policy versions, noise/exclusion labels, strict injection handling; coordinator accepted |
| E06 | Platform-specific deterministic analytics and confidence | `COMPLETE` | 18 focused tests: decimal golden vectors, platform/security isolation, positive-weight independent-source/breadth gates, half-open windows, low/zero bases, baseline winsorization/abstention, confidence readiness/caps, canonical replay/tamper; coordinator accepted, current rebased correction `d527aec` |
| E07 | Reddit/X convergence and agreement/divergence facts | `COMPLETE` | 21 focused tests: aligned/divergent/magnitude and dimension differences, scale imbalance without pooling, partial/unavailable/pending/insufficient/stale/unknown states, deterministic replay/tamper and frozen combined-state compatibility; coordinator accepted, current rebased `f7f1846` |
| E08 | Verification, challenger and three-part cited synthesis | `READY_FOR_REVIEW` | 31 focused tests: independent cutoff-aware support/counterevidence, exact source/run/security/analytics lineage, strongest countercase, no-model terminal paths, platform isolation/partial states, citation completeness, injection containment and deterministic replay; independent review PASS with no P0/P1/P2; CR-ENGINE-001 remains open for production persistence/composition |
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
| CR-ENGINE-001 | `OPEN` | Add the minimum durable catalyst-verification/publication lineage needed to bind a verification assessment and each supporting/contradicting citation to one run, security, model run, evidence role and verification cutoff; expose it through a coordinator-owned read/write composition rather than caller assertions | DATA/ENGINE/INTEGRATION; additive schema/port decision required before E08 can be production-composed, while ENGINE can continue pure validation/rendering against an injected fake |

### CR-ENGINE-001 — Durable catalyst verification and publication lineage

- **Current behaviour:** accepted migration `0022` stores `rni_evidence_claim` and
  `rni_claim_citation`; a citation can be joined to its claim/source/security and the claim has an
  epistemic status, but neither row owns a run. A run join exists only when a claim happens to be
  a `rni_narrative_membership` member. There is no verification-assessment/publication-sentence
  record, no durable supporting-versus-contradicting role, and no stored verification cutoff.
  `RniSourceItem` also intentionally identifies only Reddit/X post/comment evidence. Therefore an
  E08 caller cannot prove generic citation run ownership or persist a new verifier/challenger
  verdict from the accepted rows alone, and a social claim citation cannot safely self-verify.
- **Requested change:** coordinator to freeze the smallest additive DATA-owned representation and
  composition port that (a) persists a catalyst assessment for `(run, security, claim, model run,
  policy version, cutoff)`, (b) links each supporting/contradicting persisted citation with an
  explicit role, (c) exposes exact citation/source/run/security lineage plus the E07 analytics
  artifact identity for each platform-conclusion citation to ENGINE, and (d) stores
  sentence-to-citation publication trace or an equivalently enforceable summary trace. Decide
  separately whether verification is intentionally limited to independently persisted Reddit/X
  evidence or requires a rights-governed issuer/regulator/news source-kind expansion.
- **Justification:** T3.4 requires false/date-cutoff catalyst tests, strongest supported
  countercase and no unsupported sentence. Caller-declared ownership/role is not durable evidence;
  reusing the claim's own social citation as independent verification is circular; and “not found”
  must remain unverified rather than false.
- **Affected lanes:** DATA owns any additive migration/repository; ENGINE owns deterministic
  gates and injected model ports; INTEGRATION freezes/composes the boundary and publication rule;
  SURFACE consumes only the existing frozen cited summary/read shapes.
- **Compatibility impact:** additive if implemented as new assessment/link/trace rows and a narrow
  internal composition; existing frozen source, citation, summary and read-service shapes can
  remain unchanged. Expanding source kinds/platform semantics would be a separate explicit
  contract/source-rights decision and must not be inferred by ENGINE.
- **Recommended acceptance test:** persist a catalyst social claim plus separate pre-cutoff
  supporting and contradicting evidence; prove the read port returns only same-run/security
  lineage, exact source/citation identities and exact platform analytics-artifact identity; reject
  self-citation (including an alternate citation ID for the same source), cross-run/security/
  platform, post-cutoff and deleted/mismatched evidence; persist `supported`, `contradicted`,
  `contested` and `unverified` without mapping absence to false; then prove every non-coverage
  summary sentence resolves through its stored citation trace.

## Test evidence

| Suite | Status | Command/run link | Notes |
|---|---|---|---|
| discovery/adapter contract | `COMPLETE` | `corepack pnpm --dir apps/web exec vitest run tests/unit/rni/discovery/openai-web-search.test.ts tests/contract/rni/discovery.test.ts --no-file-parallelism` | 2 files, 16 tests passed after coordinator fixes; coordinator accepted, current rebased `62ccc29` |
| X adapter/source slice | `COMPLETE` | `corepack pnpm --dir apps/web exec vitest run tests/unit/rni/sources/x-source-slice.test.ts tests/contract/rni/x-source-slice.test.ts --no-file-parallelism` | 2 files, 20 tests passed after coordinator fixes; coordinator accepted, current rebased `19d8e7c` |
| workflow/idempotency | `COMPLETE` | `corepack pnpm --dir apps/web exec vitest run tests/unit/rni/workflow/persist-source.test.ts tests/contract/rni/persist-source-workflow.test.ts --no-file-parallelism` | 2 files, 17 tests passed; coordinator accepted, current rebased `f3af838` |
| security resolution/relationships | `COMPLETE` | `corepack pnpm --dir apps/web exec vitest run tests/unit/rni/observations/security-resolution.test.ts tests/contract/rni/security-resolution.test.ts tests/eval/rni/security-resolution.eval.test.ts --no-file-parallelism` | 3 files, 19 tests passed; coordinator accepted |
| semantic gold set | `COMPLETE` | `corepack pnpm --dir apps/web exec vitest run tests/unit/rni/observations/classifier.test.ts tests/contract/rni/semantic-classifier.test.ts tests/eval/rni/semantic-classifier.eval.test.ts --no-file-parallelism` | 3 files, 15 tests passed; coordinator accepted; live model-resistance eval remains E10 |
| analytics golden/replay | `COMPLETE` | `corepack pnpm --dir apps/web exec vitest run tests/unit/rni/analytics/platform-analytics.test.ts tests/contract/rni/platform-analytics.test.ts tests/eval/rni/platform-analytics.eval.test.ts --no-file-parallelism` | 3 files, 18/18 passed; coordinator accepted |
| cross-source isolation | `COMPLETE` | `corepack pnpm --dir apps/web exec vitest run tests/unit/rni/convergence/platform-convergence.test.ts tests/contract/rni/platform-convergence.test.ts tests/eval/rni/platform-convergence.eval.test.ts` | 3 files, 21/21 passed; independent re-review READY with no P0/P1/P2 findings; coordinator accepted |
| prompt injection/citations | `READY_FOR_REVIEW` | `corepack pnpm --dir apps/web exec vitest run tests/unit/rni/agents/cited-synthesis.test.ts tests/contract/rni/cited-synthesis.test.ts tests/eval/rni/cited-synthesis.eval.test.ts --no-file-parallelism` | 3 files, 31/31 passed; independent review PASS with no P0/P1/P2; production composition blocked on CR-ENGINE-001 |
| RNI eval | `NOT_STARTED` | — | — |
| repository required gate | `READY_FOR_REVIEW` | `corepack pnpm --dir apps/web lint`; serialized unit, contract, integration and eval commands | full lint/typecheck passed; unit 1,311/1,311; contract 103 passed/22 skipped; integration 44 passed/390 environment-gated skips; eval 7/7 |

## Review findings

| ID | Priority | Status | Finding | Resolution |
|---|---|---|---|---|
| E01-R1-01 | P1 | `CLOSED` | Canonical URL membership did not bind model excerpt/time to the exact consulted source | Exact provider URL plus full-value-covering field-scoped URL-citation annotations are required; partial/overlapping spans fail closed, and otherwise the provider URL is emitted URL-only and interpretation-ineligible |
| E01-R1-02 | P1 | `CLOSED` | Malformed or source-less calls could be skipped, yielding an incomplete consulted-source trace | Every call now validates; search requires a sources array, supported non-search actions are traced, and unknown/malformed actions fail closed |
| E01-R1-03 | P2 | `CLOSED` | Injection test covered post-generation output handling, not model resistance before generation | Test and evidence now explicitly claim only output-handling/tool-configuration coverage; pre-generation model resistance remains E10 eval scope |
| E02-R1-01 | P1 | `CLOSED` | Existing adapter partial-success contract violations were erased by the RNI port | The composition port now intercepts and forwards each call's violations, carries explicit response completeness, and forces usable partial responses to X `partial` |
| E02-R1-02 | P1 | `CLOSED` | Unsalted mutable usernames were directly hashed as author identity | Default identity is omitted; an optional tenant-approved hasher receives only stable provider author ID, must return a valid lowercase SHA-256 digest, and never retains the raw ID/username |
| E02-R1-03 | P1 | `CLOSED` | Content-version candidates did not expose exactly one latest interpretation version and mishandled A→B→A | `candidates` now has exactly one latest version per external ID, `persistenceVersions` keeps every distinct byte version, and ordered transitions preserve A→B→A reversion lineage |
| E03-R1-01 | P1 | `CLOSED` | Commit/checkpoint crash could reserve source allowance twice and strand persisted evidence | Budget reservation now has a stable step/resource key and is explicitly idempotent across attempts and crash redelivery |
| E03-R1-02 | P1 | `CLOSED` | Lease was not renewed across potentially slow budget and commit work | The portable workflow port maintains heartbeat renewal across the full reserve/commit/checkpoint/enqueue/complete operation; interval must be positive and shorter than the lease |
| E03-R1-03 | P1 | `CLOSED` | Concurrent redelivery could bypass transient-error backoff | `claimStep` must durably enforce recorded `retryAt` as not-before; concurrent redelivery returns deferred until it passes |
| E03-R1-04 | P2 | `CLOSED` | Wall-time budget reset on each process delivery | Claims return the original durable `startedAt`; local and injected budget checks use cumulative elapsed time across redelivery |
| E03-R2-01 | P2 | `CLOSED` | Completed checkpoint validated output-hash format but not integrity | Redelivery recomputes the logical hash from the parsed durable source ID and interpretation idempotency key and fails closed on mismatch |
| E04-R1-01 | P1 | `CLOSED` | Public model-entry exports could bypass the committed-evidence reader | Public barrel exposes only the persisted-evidence composition entry; contract test pins the export boundary and exact durable evidence lookup |
| E04-R1-02 | P1 | `CLOSED` | A partial built-in ambiguous-ticker list could resolve ordinary uppercase prose | Resolver now requires a strict, versioned ambiguity policy from the governed caller and fails closed when it is absent; A, AI and IT challenge cases abstain |
| E04-R1-03 | P1 | `CLOSED` | Equivalent inverse/symmetric proposals with different evidence offsets were not deduplicated | Relations deduplicate by canonical logical identity, select the shortest then earliest valid covering span, and sort before deterministic ID allocation |
| E05-R1-01 | P1 | `CLOSED` | Model proposals were validated against numeric policy thresholds absent from their input | The complete pinned classification policy is part of each target-specific model input and exact input hash |
| E05-R1-02 | P1 | `CLOSED` | Observation input hashes did not represent the exact model-visible payload | One canonical payload containing policy, prompt/model provenance, platform, evidence, target/context mentions and enabled taxonomy is both SHA-256 hashed and passed unchanged |
| E05-R1-03 | P1 | `CLOSED` | Equivalent dimension assignments retained arbitrary model order | Valid assignments are normalized to the four frozen dimension keys before frozen observation construction; shuffled-output regression is exact |
| E05-R1-04 | P1 | `CLOSED` | Noise and semantic-quality labels lacked source support spans | Every noise assessment carries validated, nonblank persisted-source offsets and derived evidence text covering its target mention |
| E05-R2-01 | P2 | `CLOSED` | Claim and semantic-label challenge coverage omitted forbidden epistemic values and threshold disagreement | Strict schema rejects `verified_fact`, unknown claim types and aggregate fields; probability flags must match the pinned binary threshold |
| E06-R1-01 | P1 | `CLOSED` | Distinct duplicate-group copies could satisfy the independent-source evidence floor | A stable duplicate-group key now gates sentiment and confidence; group members must agree on cardinality and cannot declare fewer members than appear in-window |
| E06-R1-02 | P1 | `CLOSED` | Low-base display suppression also withheld frozen-contract velocity, while an unconstrained epsilon could distort positive-baseline change | Positive-rate velocity is calculated independently; low-base policy suppresses only percent display, and epsilon is positive and bounded by the low-base threshold |
| E06-R1-03 | P1 | `CLOSED` | Fractional confidence caps could produce divergent rounded 0–100 score, 0–1 score and band | Penalties/caps feed one half-even integer score; unit score and band derive only from that rounded value |
| E06-R2-01 | P2 | `CLOSED` | Replay coverage did not directly mutate frozen input or methodology snapshots | Regressions mutate each snapshot with unchanged hashes and require fail-closed input-hash mismatch |
| E06-R2-02 | P1 | `CLOSED` | A schema-valid zero effective-attention floor could publish confidence over zero-weight evidence | The floor is strictly positive and confidence independently abstains when total effective attention is zero |
| E06-CR-01 | P1 | `CLOSED` | Zero-weight observations could satisfy independent-source sentiment floors and remove effective breadth confidence caps | Raw distinct-source attention remains visible, while only positive-weight traces count toward sentiment independence, effective source/community/cluster/author/narrative breadth, HHI, staleness and confidence gates/caps |
| E06-CR-02 | P2 | `CLOSED` | Two analytics test files added a blank line at EOF, contradicting the branch-range diff-check claim | Removed only the extra EOF lines; focused 18/18, scoped typecheck/lint and `git diff --check 098f010` pass |
| E07-R1-01 | P1 | `CLOSED` | A terminal slice with unknown freshness could be treated as publishable | Cross-source publication now requires an explicit fresh data-through timestamp; one unknown platform is partial and two are insufficient |
| E07-R1-02 | P1 | `CLOSED` | Overall stance availability incorrectly gated independently available dimension comparisons | Terminal/fresh readiness is separate from overall comparability and every frozen dimension compares from its own two scores |
| E07-R1-03 | P1 | `CLOSED` | Zero effective attention could carry publishable sentiment while the useful zero-base scale fact was coupled to stance | Any publishable overall/dimension stance requires positive effective attention; terminal/fresh zero-attention insufficient slices still produce an independent unbounded scale fact |
| E07-R1-04 | P2 | `CLOSED` | Direction labels could contradict numeric score signs | Bullish scores must be positive and bearish scores negative at both overall and dimension boundaries; neutral remains threshold-policy compatible |
| E07-R1-05 | P2 | `CLOSED` | Replay coverage changed a hash without directly mutating the result payload | The regression now mutates the result status while retaining the original hash and fails closed on canonical result mismatch |
| E08-R1-01 | P1 | `CLOSED` | Alternate citation IDs could point to the catalyst claim's own source item and circularly support or contradict it | Verification now resolves every claim source item and rejects support/counterevidence with any overlapping source identity; duplicate-citation support and contradiction tests added |
| E08-R1-02 | P1 | `CLOSED` | Non-empty claims on entirely unavailable, stale or otherwise non-publishable platform slices still invoked the verifier | Platform eligibility now deterministically requires terminal publishable status, fresh evidence, a non-insufficient stance and score; when no claim is eligible, every claim becomes `unverified` and both inference ports are skipped |
| E08-R1-03 | P2 | `CLOSED` | Partial cross-source coverage only exercised an unavailable platform, not an explicitly publishable partial platform | Added a publishable X `partial` fixture proving separate Reddit complete/X partial conclusions and a combined partial state |

## Open risks/blockers

| Since | Status | Blocker | Owner | Attempted mitigation | Next check |
|---|---|---|---|---|---|
| 2026-09-05 | `OPEN` | Live X adapter smoke was not run because no approved `X_BEARER_TOKEN` or governed live query was available | coordinator | Existing adapter is composed through an injected port; fixture success/failure contracts pass without secrets | G4 live-smoke review |

## Task records

### E01 — Reddit OpenAI Web Search discovery and canonical candidate normalization

- **Status:** `COMPLETE`; coordinator accepted; current rebased `62ccc29`
- **Slice:** Added a Responses API Web Search request builder and injected transport boundary,
  strict structured-output parsing, complete per-call action/source validation, and deterministic
  Reddit post/comment URL normalization. Interpretation-eligible candidates require exact
  consulted-URL equality and URL-citation spans that fully cover both bounded content and
  publication time for that source. Partial, unbound, untimed, out-of-window, or otherwise
  ineligible consulted Reddit sources remain explicit URL-only records and cannot enter
  interpretation.
- **Files changed:**
  `apps/web/src/rni/discovery/{index,openai-web-search,reddit-url,types}.ts`,
  `apps/web/tests/unit/rni/discovery/openai-web-search.test.ts`,
  `apps/web/tests/unit/rni/discovery/fixtures/openai-web-search-response.json`,
  `apps/web/tests/contract/rni/discovery.test.ts`, and this tracker.
- **Tests/results:** focused unit + contract 16/16 passed; repository unit 1,186/1,186 passed;
  repository contract 78 passed and 22 pre-existing skips; `typecheck`, focused ESLint, full
  ESLint, and `git diff --check` passed.
- **Models/prompts:** no model ID is hard-coded; the caller supplies the evaluated Web Search
  model. Prompt version is now `rni-discovery-v2`; it requires exact source citations for excerpt
  and time, keeps Web Search as the only tool, uses `reddit.com` as the domain filter, applies a
  bounded tool/output budget, and retains explicit untrusted-source/no-sentiment instructions.
- **Token/latency evidence:** sanitized fixture records 820 input, 410 output and 512 cached input
  tokens; the injected-clock test records 42 ms. These are parser/telemetry fixtures, not live
  performance claims.
- **Risks/handoff:** `OPENAI_API_KEY` was absent, so the raw live Responses API spike remains a
  coordinator G7 deployment check. If live structured output lacks field-scoped URL citations,
  the adapter safely yields URL-only evidence rather than semantic input. Integration must inject
  the provider transport/model setting; E03 must persist accepted and URL-only/consulted-source
  records before semantic work. No DATA implementation detail is imported and no frozen contract
  change is required.

### E02 — Existing X adapter port and independent terminal source slice

- **Status:** `COMPLETE`; coordinator accepted; current rebased `19d8e7c`
- **Slice:** Added a composition port around the existing authorised X recent-search adapter and
  an X-only terminal source-slice runner. A governed query set is invoked without Reddit inputs;
  each returned post is deterministically filtered to the exact half-open UTC window, normalized
  to a stable X status URL, content-hashed, and carried with complete per-query retrieval rank,
  requested-at time, provider metadata/payload reference, capture metadata, and explicit provider
  response completeness. Same-content rediscovery updates mutable metadata while retaining every
  retrieval snapshot. All changed byte versions and ordered transitions go to E03 persistence,
  while exactly one latest version per external ID is eligible for interpretation. Author identity
  is omitted unless an injected tenant-approved policy hashes the stable provider author ID.
- **Files changed:** `apps/web/src/rni/sources/{index,types,x}.ts`,
  `apps/web/tests/unit/rni/sources/x-source-slice.test.ts`,
  `apps/web/tests/contract/rni/x-source-slice.test.ts`, and this tracker.
- **Tests/results:** focused unit + contract 20/20 passed; repository unit 1,204/1,204 passed;
  repository contract 80 passed and 22 pre-existing skips; `typecheck`, focused ESLint, full
  ESLint, and `git diff --check` passed. A read-only review found and closed content-version,
  retrieval-lineage, calculation-freshness, and mutable-metadata issues, then returned READY with
  no remaining P1/P2 findings.
- **Models/prompts/formulas:** no model or prompt is used or changed. Deterministic behavior is
  limited to SHA-256 content hashing, half-open timestamp filtering, identity/content
  deduplication, ordered version transitions, latest-metadata selection, completeness propagation,
  and terminal status mapping. Author hashing is supplied only by an injected approved policy.
- **Token/latency evidence:** no model tokens are consumed. The provider fixture carries 41 ms
  adapter latency as contract metadata; it is not a live performance measurement.
- **Risks/handoff:** the existing adapter exposes post IDs rather than native status URLs or a
  provider request ID, so the composition layer derives the stable `x.com/i/web/status/{id}` URL
  and preserves provider `payloadRef` in every retrieval. These are expressible through the
  frozen nullable/request metadata fields and require no contract change. Coordinator must run
  the separately governed live X smoke with an approved secret/query; no secret was committed.

### E03 — Persist-first workflow, retry, checkpoint and budget logic

- **Status:** `COMPLETE`; coordinator accepted; current rebased `f3af838`
- **Slice:** Added the portable operational `RniWorkflowPort` around the existing durable
  job/queue composition boundary while consuming the frozen `RniSourcePersistencePort` directly.
  The runner claims the `(run, stage, subject, version)` step, maintains its lease heartbeat,
  reserves budget idempotently, commits bounded source evidence, checkpoints the DATA-returned
  durable ID, and only then enqueues an ID-only semantic job. Completed redelivery returns the
  verified checkpoint; stale-lease recovery, commit/checkpoint and enqueue/completion crashes,
  transient retry not-before, permanent failure and budget stops are fail-closed.
- **Files changed:** `apps/web/src/rni/workflow/{index,persist-source,types}.ts`,
  `apps/web/tests/unit/rni/workflow/persist-source.test.ts`,
  `apps/web/tests/contract/rni/persist-source-workflow.test.ts`, and this tracker.
- **Tests/results:** focused workflow unit + contract 17/17 passed; serialized repository unit
  1,223/1,223 passed; repository contract 88 passed and 22 pre-existing skips; `typecheck`, focused
  ESLint and `git diff --check` passed. The default parallel unit command twice exposed the known
  cross-file `__float_probe__.ts` create/remove race in `codebase-invariants.test.ts`; the
  no-file-parallelism rerun passed every unit. Independent read-only review returned READY with no
  P0/P1/P2 findings.
- **Models/prompts/formulas:** no model or prompt is used or changed. Deterministic formulas are
  canonical SHA-256 input/output and step/dispatch/reservation keys; full-jitter retry delay
  `floor(random * min(cap, base * factor^(attempt - 1)))`; a three-attempt default ceiling;
  30-second cumulative durable wall-time; and a 10-second lease with 3-second heartbeat cadence.
  The caller-proposed source UUID is excluded from the input hash and semantic dispatch.
- **Token/latency evidence:** this persist stage estimates and reserves zero input/output tokens
  and zero model cost while using the shared generic token/cost/source/time budget dimensions.
  Focused fixture execution completed in 438 ms; this is test runtime, not live queue latency.
- **Risks/handoff:** integration must implement `RniWorkflowPort` over the repository's existing
  durable job/queue tables, including atomic lease/checkpoint/not-before rules and idempotent
  semantic enqueue. No lane-local source persistence interface, DATA-private import, migration,
  frozen contract change or contract request was introduced. E04 consumes only the committed
  durable evidence read boundary.

### E04 — Security resolver and multi-security relationships

- **Status:** `COMPLETE`; coordinator accepted current rebased `3b89c7d`
- **Slice:** Added pure exact-ticker and company-alias mention resolution with exact source offsets,
  active-candidate filtering, overlap resolution, duplicate-symbol abstention and a required
  versioned bare-ticker ambiguity policy. The only public model-capable composition path first
  reads and validates the exact durable source item through the frozen read service. For sources
  resolving at least two distinct securities, an injected bounded inference port may propose
  comparative relationships; deterministic validation then rejects invented IDs, malformed or
  non-covering evidence spans, canonicalizes inverse/symmetric relations and binds exact persisted
  evidence text.
- **Files changed:** `apps/web/src/rni/observations/{index,relationships,resolve-source,resolver,types}.ts`,
  `apps/web/tests/unit/rni/observations/security-resolution.test.ts`,
  `apps/web/tests/contract/rni/security-resolution.test.ts`,
  `apps/web/tests/eval/rni/security-resolution.eval.test.ts`, and this tracker.
- **Tests/results:** after rebase onto integration `fec8c46`, focused unit + contract + eval 19/19
  passed; serialized repository unit 1,242/1,242 passed; repository contract 91 passed and 22
  pre-existing skips; repository integration 44 passed and 390 environment-gated skips; repository
  eval 1/1 passed; `typecheck`, focused ESLint, full ESLint and `git diff --check` passed. Independent
  read-only review returned READY with no P0/P1/P2 findings after all three initial P1s were closed.
- **Models/prompts/formulas:** no model ID or prompt is added or changed; E09 owns production model
  routes and prompts. The injected relationship port returns proposals only. Deterministic behavior
  is exact boundary-aware ticker/alias matching, longest supported non-overlapping span selection,
  cashtag-required abstention from a required versioned ambiguity set, inverse
  `less_preferred_than` to `preferred_over` normalization, symmetric-ID ordering, logical relation
  deduplication, shortest-then-earliest evidence selection and stable relation ordering/occurrence.
- **Token/latency evidence:** no live model was called and no production token observation is
  claimed. On the final base, the focused fake/in-memory fixture suite completed in 1.71 s; full
  serialized unit in 20.51 s, contract in 4.75 s, integration in 9.45 s and eval in 1.17 s.
- **Risks/handoff:** integration must inject the governed universe candidates and a complete,
  versioned ambiguity policy; the resolver intentionally has no partial default. E09 must supply
  the evaluated model route/prompt behind the bounded inference port. No DATA-private import,
  shared schema, frozen contract change or contract request is required.

### E05 — Four-dimension classifier, themes, claims and noise labels

- **Status:** `COMPLETE`; coordinator accepted
- **Slice:** Added a persisted-evidence semantic boundary that validates exact resolved mention
  text/offsets, then makes one bounded no-tool classifier call per unique security so comparative
  sources cannot blend stances. Strict proposals produce all four frozen dimensions, atomic claim
  candidates, enabled versioned theme assignments, and source-bound sarcasm/meme/spam,
  information-value, assertion-strength, evidence-quality and uncertainty assessments. Claims,
  themes and noise quote exact persisted spans. Claim-linked citation proposals derive the
  original URL and evidence text from the persisted source and remain explicitly non-publishable
  until I07 supplies the coordinator-frozen atomic semantic write port.
- **Files changed:** `apps/web/src/rni/observations/{classifier,index,types}.ts`,
  `apps/web/tests/unit/rni/observations/classifier.test.ts`,
  `apps/web/tests/contract/rni/semantic-classifier.test.ts`,
  `apps/web/tests/eval/rni/semantic-classifier.eval.test.ts`, and this tracker.
- **Tests/results:** after rebase onto integration `fec8c46`, focused unit + contract + synthetic
  eval 15/15 passed; serialized repository unit 1,254/1,254 passed; repository contract 94 passed and 22 pre-existing skips; repository
  integration 44 passed and 390 environment-gated skips; repository eval 2/2 passed; `typecheck`,
  focused ESLint, full ESLint and `git diff --check` passed. Independent read-only re-review
  returned READY with no P0/P1/P2 findings after all four initial P1s and the P2 gaps were closed.
- **Models/prompts/formulas:** no model implementation, model ID or prompt file is added or changed;
  E09 owns production routes/prompts. The injected port receives caller-pinned prompt/model
  provenance and the complete numeric classification policy. Deterministic rules map score sign
  and absolute magnitude through `neutralMaxAbsoluteScore`/`strongMinAbsoluteScore`, map semantic
  booleans through `binaryLabelThreshold`, enforce per-theme confidence thresholds, normalize
  dimensions to frozen order, bind all semantic spans to persisted evidence, and SHA-256 hash the
  exact canonical per-security model input. Sarcasm/meme labels do not force abstention; explicit
  spam/off-topic/unresolved-context exclusion does.
- **Token/latency evidence:** no live model was called and no production token count is claimed.
  On the final base, the focused fake/in-memory suite completed in 1.33 s; full serialized unit in
  19.76 s, contract in 4.43 s, integration in 8.13 s and eval in 822 ms.
- **Risks/handoff:** I07 must freeze the smallest atomic write port that persists observations,
  claims, theme assignments and claim citations from these proposals and returns durable IDs.
  E09 must implement the model route/prompt, and E10 must evaluate real pre-generation injection
  resistance; current injection coverage proves strict output handling and an empty tool allowlist
  only. No DATA-private import, shared schema, frozen contract change or contract request is needed.

### E06 — Platform-specific deterministic analytics and confidence

- **Status:** `COMPLETE`; coordinator accepted; current rebased correction `d527aec`
- **Slice:** Added a pure one-platform/one-security analytics artifact boundary. It validates
  exact half-open current/comparison windows, persisted source/mention uniqueness, stable
  duplicate groups and comparable historical baselines; then emits distinct-source attention,
  separately weighted effective attention, four frozen-order dimension sentiment indices,
  source-count change, comparable-rate velocity, breadth, cluster-adjusted breadth, narrative HHI,
  winsorized attention z-score and evidence confidence. Reddit and X can never share an input or
  artifact, and replay consumes only the frozen canonical input/methodology snapshots.
- **Files changed:** `apps/web/src/rni/analytics/{calculate,index,types}.ts`,
  `apps/web/tests/unit/rni/analytics/{fixtures,platform-analytics.test}.ts`,
  `apps/web/tests/contract/rni/platform-analytics.test.ts`,
  `apps/web/tests/eval/rni/platform-analytics.eval.test.ts`, and this tracker.
- **Tests/results:** focused unit + contract + deterministic eval 17/17 passed; serialized
  repository unit 1,269/1,269 passed; repository contract 97 passed and 22 pre-existing skips;
  repository integration 44 passed and 390 environment-gated skips; repository eval 3/3 passed;
  `typecheck`, focused ESLint, full ESLint and `git diff --check` passed. Independent read-only
  review returned READY with no remaining P0/P1/P2 findings after five findings were closed. The
  coordinator's E06-CR-01 correction was independently re-reviewed READY after its regression;
  E06-CR-02 removed two EOF-only blank lines and the full base-to-head diff check now passes.
- **Models/prompts/formulas:** no LLM, model route or prompt is used or changed. Decimal-safe
  formulas implement quality/noise/duplicate/freshness observation weight; distinct-source and
  effective attention; weighted dimension means ×100; absolute and percent attention change;
  frozen-contract relative rate velocity plus separately named rate acceleration; exact-community,
  cluster, author and independent-narrative breadth; narrative HHI; nearest-rank winsorized
  `log1p(effective_attention)` sample z-score with six-decimal half-even rounding; and weighted
  confidence components minus penalties, deterministic caps, integer half-even score, frozen
  unit-decimal mapping and bands. All parameters and rounding conventions are versioned.
- **Token/latency evidence:** zero model tokens and zero model latency. On the final pre-handoff
  base, the final focused fake/in-memory suite completed in 606 ms; full serialized unit in
  20.02 s, contract in 4.43 s, integration in 8.11 s and eval in 1.01 s.
- **Risks/handoff:** confidence stays null until narrative and catalyst stages are explicitly
  terminal and the positive effective-attention/independent-source floors pass. E07/E08 must
  supply their deterministic component snapshots; integration must persist the artifact through
  a coordinator-owned/frozen write composition if required. This slice returns internal artifacts
  only, imports no DATA-private repository, emits no combined metric, changes no frozen contract
  and raises no contract request. Frozen contract precedence names relative rate change as
  `velocity`; the DATA model's rate delta remains separately named `acceleration`.

### E07 — Reddit/X convergence and agreement/divergence facts

- **Status:** `COMPLETE`; coordinator accepted; current rebased `f7f1846`
- **Slice:** Added a pure, versioned cross-source fact artifact that accepts exactly one Reddit
  and one X platform slice for the same run, security, methodology and window. It preserves both
  normalized platform inputs, derives explicit overall and four-dimension agreement facts,
  reports scale imbalance using separately labelled effective-attention magnitudes, and maps
  freshness/coverage into pending, partial, insufficient, aligned or divergent states. It emits
  no synthesis, citation, confidence or pooled platform metric; E08 owns cited explanation.
- **Files changed:** `apps/web/src/rni/convergence/{converge,index,types}.ts`,
  `apps/web/tests/unit/rni/convergence/{fixtures,platform-convergence.test}.ts`,
  `apps/web/tests/contract/rni/platform-convergence.test.ts`,
  `apps/web/tests/eval/rni/platform-convergence.eval.test.ts`, and this tracker.
- **Tests/results:** focused unit + contract + deterministic eval 21/21 passed; serialized
  repository unit 1,285/1,285 passed; repository contract 100 passed and 22 pre-existing skips;
  repository integration 44 passed and 390 environment-gated skips; repository eval 5/5 passed;
  `typecheck`, scoped ESLint, full ESLint and `git diff --check` passed. Independent read-only
  review found three P1 and two P2 issues around unknown freshness, dimension availability,
  zero-attention sentiment, sign consistency and direct replay mutation; all were closed and the
  re-review returned READY with no remaining P0/P1/P2 findings.
- **Models/prompts/formulas:** no LLM, model route or prompt is used or changed. Decimal-safe
  direction facts use `reddit_score - x_score`, group frozen stances as bullish/neutral/bearish,
  and classify aligned below the versioned absolute-delta floor, mixed at a material same-group
  magnitude difference, or divergent for opposing directions/material neutral-direction gaps.
  Any mixed/divergent available overall or dimension fact yields divergent combined state.
  Scale ratio is `max(reddit_effective_attention, x_effective_attention) / min(...)`, with an
  explicit unbounded state for a one-sided zero and unavailable for two zeros or an unready slice.
  Evidence is stale only when age hours strictly exceeds the versioned boundary; unknown is not
  publishable. Status precedence is non-terminal pending, neither publishable insufficient,
  one publishable or any disclosed platform gap partial, material disagreement divergent, else
  aligned complete. Canonical request/result hashes and replay bind all inputs and policy versions.
- **Token/latency evidence:** zero model tokens and zero model latency. On the final pre-handoff
  base, the focused fake/in-memory suite completed in 389 ms; full serialized unit in 17.89 s,
  contract in 2.08 s, integration in 5.25 s and eval in 339 ms.
- **Risks/handoff:** the integration caller must supply the versioned divergence, scale and stale
  thresholds and inputs derived from independently persisted platform analytics; E08 must create
  every human-facing explanation from persisted citations and must not reinterpret these facts as
  a pooled sentiment metric. The artifact remains an internal ENGINE type, imports no DATA-private
  repository, changes no frozen contract and raises no contract request.

### E08 — Verification, challenger and three-part cited synthesis

- **Status:** `READY_FOR_REVIEW`; independent read-only review PASS with no P0/P1/P2;
  production persistence/composition remains blocked on `CR-ENGINE-001`.
- **Slice:** Added two injected structured-inference ports for catalyst verification and challenger
  selection, followed by a deterministic citation-gated renderer for the frozen Reddit, X and
  combined summary sections. The renderer replays the E07 artifact, preserves its exact separate
  platform records, permits no model-authored publication text or tools, and publishes only
  persisted citation/source identities resolved through a trusted lineage reader. Terminal runs
  with zero eligible claims skip both inference calls; absence of verification remains
  `unverified`, never false.
- **Files changed:** `apps/web/src/rni/agents/{index,synthesis,types}.ts`,
  `apps/web/tests/unit/rni/agents/{fixtures,cited-synthesis.test}.ts`,
  `apps/web/tests/contract/rni/cited-synthesis.test.ts`,
  `apps/web/tests/eval/rni/cited-synthesis.eval.test.ts`, and this tracker.
- **Tests/results:** focused unit + contract + synthetic eval 31/31 passed; serialized repository
  unit 1,311/1,311 passed; repository contract 103 passed and 22 pre-existing environment skips;
  repository integration 44 passed and 390 environment-gated skips; repository eval 7/7 passed;
  `typecheck`, scoped ESLint, full ESLint and `git diff --check` passed. Independent review reran
  typecheck, scoped ESLint, focused 31/31 and diff check, then returned PASS with no P0/P1/P2.
- **Models/prompts changed:** no production model ID, model route or prompt file changed; E09 owns
  those. E08 introduces separate injected verifier/challenger ports and requires caller-supplied,
  persisted `modelRunId`, `modelId`, `promptVersion` and `policyVersion`. Model inputs label source
  content untrusted, expose an empty tool allowlist and forbid model text publication; tests use
  fake structured verdicts only.
- **Deterministic publication rules:** a platform is verification-eligible only when its E07 slice
  is `complete` or `partial`, freshness is `fresh`, stance is not `insufficient`, and stance score
  exists. Support requires a separately persisted `independent_verification` citation at or before
  the claim cutoff; contradiction requires `counterevidence`; neither may reuse any claim source
  item under another citation ID. A cutoff after synthesis creation fails closed. The challenger
  may publish exactly one selected contradicted/contested claim with the exact verified
  counterevidence set, return bounded `no_supported_challenge_found` only when support exists and
  no contradiction exists, or return `insufficient`. Combined status is insufficient when both
  platforms are insufficient, partial when either platform/E07 state is partial or insufficient,
  and otherwise complete. Every non-coverage sentence has at least one persisted citation; there
  is no pooled sentiment/attention/count metric. Canonical request, model-input, challenger-input
  and result hashes make the artifact replayable and tamper-evident.
- **Token/latency evidence:** zero live model calls, provider tokens or provider latency; all
  inference was injected/fake. The final focused suite completed in 544 ms; full serialized unit
  in 18.78 s, contract in 2.30 s, integration in 5.24 s and eval in 677 ms.
- **Risks/handoff:** `CR-ENGINE-001` is required before production composition because accepted
  DATA rows cannot durably prove generic citation run/security ownership, evidence role,
  verification cutoff, exact E07 analytics-artifact lineage, assessment persistence or
  sentence-to-citation publication trace. The implementation intentionally accepts an injected
  trusted lineage port and does not import unmerged DATA-private details. Any issuer/regulator/
  exchange evidence expansion is a separate source-rights/contract decision. E09 still owns live
  model routing, prompts, budgets and cache-compatible prefixes; E10 owns the full live eval gate.

## Commits

| SHA | Summary | Tests |
|---|---|---|
| `6e2a5d0` | E01 Web Search discovery and canonical candidate normalization | focused 10/10; unit 1,180/1,180; contract 78 passed/22 skipped; typecheck/lint passed |
| `447300d` | E01 exact evidence binding and complete action lineage | focused 15/15; unit 1,185/1,185; contract 78 passed/22 skipped; typecheck/lint passed |
| `62ccc29` | E01 full citation-span coverage; coordinator accepted | focused 16/16; unit 1,186/1,186; contract 78 passed/22 skipped; typecheck/lint passed |
| `9a74c63` | E02 independent X source slice | focused 16/16; unit 1,200/1,200; contract 80 passed/22 skipped; typecheck/lint passed |
| `19d8e7c` | E02 partial signal, tenant-safe identity and explicit latest/version lineage; coordinator accepted | focused 20/20; unit 1,204/1,204; contract 80 passed/22 skipped; typecheck/lint passed |
| `f3af838` | E03 persist-first durable workflow slice; coordinator accepted | focused 17/17; serialized unit 1,223/1,223; contract 88 passed/22 skipped; typecheck/focused lint passed |
| `3b89c7d` | E04 deterministic security resolution and cited comparative relationships; coordinator accepted | focused 19/19; serialized unit 1,242/1,242; contract 91 passed/22 skipped; integration 44 passed/390 skipped; eval 1/1; typecheck/lint passed |
| `68f35e9` | E05 isolated four-dimension classification and semantic proposals; coordinator accepted | focused 15/15; serialized unit 1,254/1,254; contract 94 passed/22 skipped; integration 44 passed/390 skipped; eval 2/2; typecheck/lint passed |
| `db225d5` | E06 platform-specific deterministic analytics and evidence confidence | focused 17/17; serialized unit 1,268/1,268; contract 97 passed/22 skipped; integration 44 passed/390 skipped; eval 3/3; typecheck/lint passed |
| `d527aec` | E06 positive-weight effective-independence correction; coordinator accepted | focused 18/18; serialized unit 1,269/1,269; contract 97 passed/22 skipped; integration 44 passed/390 skipped; eval 3/3; typecheck/lint passed |
| `f7f1846` | E07 deterministic Reddit/X convergence facts without pooled metrics; coordinator accepted | focused 21/21; serialized unit 1,285/1,285; contract 100 passed/22 skipped; integration 44 passed/390 skipped; eval 5/5; typecheck/lint passed |
| this task commit | E08 citation-gated verification, challenger and deterministic three-part synthesis | focused 31/31; serialized unit 1,311/1,311; contract 103 passed/22 skipped; integration 44 passed/390 skipped; eval 7/7; typecheck/lint passed; independent review PASS |

## Handoff

```text
RNI LANE     ENGINE
BRANCH       feat/rni-engine-live-slice
BASE SHA     e010124 (latest feat/rni-integration-demo at E08 start)
STATUS       PARTIAL; E08 ready for coordinator review with CR-ENGINE-001 open
TASKS        8/10; E01-E07 coordinator accepted; E08 ready for review; E09-E10 not started
TESTS        E08 focused 31/31; serialized unit 1,311/1,311; contract 103 passed/22 skipped; integration 44 passed/390 skipped; eval 7/7; typecheck/scoped+full lint/diff check pass; independent review PASS
CONTRACT     CR-ENGINE-001 OPEN — durable verification/publication lineage and production composition
RISKS        E08 pure gates are ready but cannot be production-composed until CR-ENGINE-001; live Web Search/X smokes pending approved credentials; E09/E10 own model routes/prompts/budgets/cache and live eval resistance
FILES        src/rni/{discovery,sources,workflow,observations,analytics,convergence,agents}/**; tests/unit/rni/{discovery,sources,workflow,observations,analytics,convergence,agents}/**; RNI contract/eval tests; docs/rni/progress/ENGINE.md
COMMITS      rebased E01/E02 series through 19d8e7c, E03 f3af838, E04 3b89c7d, E05 68f35e9, E06 db225d5 plus accepted correction d527aec, E07 f7f1846, E08 in this task commit
DEMO PROOF   citation-bound discovery through separate platform facts; E08 replays E07, verifies catalysts only from separate cutoff-aware persisted sources, selects one cited countercase and renders three citation-complete sections without pooled metrics or model prose
```
