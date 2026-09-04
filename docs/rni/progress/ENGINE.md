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
| E01 | Reddit OpenAI Web Search discovery and canonical candidate normalization | `COMPLETE` | 16 focused tests: exact source/evidence binding, URL-only abstention, complete action lineage, half-open windows, dedup, frozen-source compatibility; coordinator accepted, current rebased `6e932b7` |
| E02 | Existing X adapter port and independent terminal source slice | `COMPLETE` | 20 focused tests: partial-success propagation, isolation, tenant-safe identity, retrieval/version lineage, A→B→A latest selection, half-open windows; coordinator accepted, current rebased `ce503bd` |
| E03 | Persist-first workflow, retry, checkpoint and budget logic | `COMPLETE` | 17 focused tests: commit/checkpoint and enqueue/completion crashes, exact redelivery, lease heartbeat, retry not-before, bounded jitter, stable budget reservation, durable wall-time and hash integrity; coordinator accepted, current rebased `a32c04b` |
| E04 | Security resolver and multi-security relationships | `COMPLETE` | 19 focused tests: exact NVDA/AMD offsets, governed bare-ticker abstention, duplicate-symbol ambiguity, committed-evidence-only inference, cited canonical relationship deduplication; coordinator accepted current rebased `26205f4` |
| E05 | Four-dimension classifier, themes, claims and noise labels | `COMPLETE` | 15 focused tests: isolated opposing security stance, four dimensions, mixed dimension/theme stance, source spans, taxonomy/policy versions, noise/exclusion labels, strict injection handling; coordinator accepted |
| E06 | Platform-specific deterministic analytics and confidence | `COMPLETE` | 18 focused tests: decimal golden vectors, platform/security isolation, positive-weight independent-source/breadth gates, half-open windows, low/zero bases, baseline winsorization/abstention, confidence readiness/caps, canonical replay/tamper; coordinator accepted, current rebased correction in this commit |
| E07 | Reddit/X convergence and agreement/divergence facts | `IN_PROGRESS` | Divergence/scale imbalance/partial tests |
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
| discovery/adapter contract | `COMPLETE` | `corepack pnpm --dir apps/web exec vitest run tests/unit/rni/discovery/openai-web-search.test.ts tests/contract/rni/discovery.test.ts --no-file-parallelism` | 2 files, 16 tests passed after coordinator fixes; coordinator accepted, current rebased `6e932b7` |
| X adapter/source slice | `COMPLETE` | `corepack pnpm --dir apps/web exec vitest run tests/unit/rni/sources/x-source-slice.test.ts tests/contract/rni/x-source-slice.test.ts --no-file-parallelism` | 2 files, 20 tests passed after coordinator fixes; coordinator accepted, current rebased `ce503bd` |
| workflow/idempotency | `COMPLETE` | `corepack pnpm --dir apps/web exec vitest run tests/unit/rni/workflow/persist-source.test.ts tests/contract/rni/persist-source-workflow.test.ts --no-file-parallelism` | 2 files, 17 tests passed; coordinator accepted, current rebased `a32c04b` |
| security resolution/relationships | `COMPLETE` | `corepack pnpm --dir apps/web exec vitest run tests/unit/rni/observations/security-resolution.test.ts tests/contract/rni/security-resolution.test.ts tests/eval/rni/security-resolution.eval.test.ts --no-file-parallelism` | 3 files, 19 tests passed; coordinator accepted |
| semantic gold set | `COMPLETE` | `corepack pnpm --dir apps/web exec vitest run tests/unit/rni/observations/classifier.test.ts tests/contract/rni/semantic-classifier.test.ts tests/eval/rni/semantic-classifier.eval.test.ts --no-file-parallelism` | 3 files, 15 tests passed; coordinator accepted; live model-resistance eval remains E10 |
| analytics golden/replay | `COMPLETE` | `corepack pnpm --dir apps/web exec vitest run tests/unit/rni/analytics/platform-analytics.test.ts tests/contract/rni/platform-analytics.test.ts tests/eval/rni/platform-analytics.eval.test.ts --no-file-parallelism` | 3 files, 18/18 passed; coordinator accepted |
| cross-source isolation | `IN_PROGRESS` | — | E07 marked before implementation |
| prompt injection/citations | `NOT_STARTED` | — | — |
| RNI eval | `NOT_STARTED` | — | — |
| repository required gate | `NOT_STARTED` | — | — |

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

## Open risks/blockers

| Since | Status | Blocker | Owner | Attempted mitigation | Next check |
|---|---|---|---|---|---|
| 2026-09-05 | `OPEN` | Live X adapter smoke was not run because no approved `X_BEARER_TOKEN` or governed live query was available | coordinator | Existing adapter is composed through an injected port; fixture success/failure contracts pass without secrets | G4 live-smoke review |

## Task records

### E01 — Reddit OpenAI Web Search discovery and canonical candidate normalization

- **Status:** `COMPLETE`; coordinator accepted; current rebased `6e932b7`
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

- **Status:** `COMPLETE`; coordinator accepted; current rebased `ce503bd`
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

- **Status:** `COMPLETE`; coordinator accepted; current rebased `a32c04b`
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

- **Status:** `COMPLETE`; coordinator accepted current rebased `26205f4`
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

- **Status:** `COMPLETE`; coordinator accepted; current rebased correction in this commit
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

## Commits

| SHA | Summary | Tests |
|---|---|---|
| `1a1da7d` | E01 Web Search discovery and canonical candidate normalization | focused 10/10; unit 1,180/1,180; contract 78 passed/22 skipped; typecheck/lint passed |
| `fa70d33` | E01 exact evidence binding and complete action lineage | focused 15/15; unit 1,185/1,185; contract 78 passed/22 skipped; typecheck/lint passed |
| `6e932b7` | E01 full citation-span coverage; coordinator accepted | focused 16/16; unit 1,186/1,186; contract 78 passed/22 skipped; typecheck/lint passed |
| `46ff9e2` | E02 independent X adapter/source slice | focused 16/16; unit 1,200/1,200; contract 80 passed/22 skipped; typecheck/lint passed |
| `ce503bd` | E02 partial signal, tenant-safe identity and explicit latest/version lineage; coordinator accepted | focused 20/20; unit 1,204/1,204; contract 80 passed/22 skipped; typecheck/lint passed |
| `a32c04b` | E03 persist-first durable workflow slice; coordinator accepted | focused 17/17; serialized unit 1,223/1,223; contract 88 passed/22 skipped; typecheck/focused lint passed |
| `26205f4` | E04 deterministic security resolution and cited comparative relationships; coordinator accepted | focused 19/19; serialized unit 1,242/1,242; contract 91 passed/22 skipped; integration 44 passed/390 skipped; eval 1/1; typecheck/lint passed |
| `ab5e171` | E05 isolated four-dimension classification and semantic proposals; coordinator accepted | focused 15/15; serialized unit 1,254/1,254; contract 94 passed/22 skipped; integration 44 passed/390 skipped; eval 2/2; typecheck/lint passed |
| `25d1195` | E06 platform-specific deterministic analytics and evidence confidence | focused 17/17; serialized unit 1,268/1,268; contract 97 passed/22 skipped; integration 44 passed/390 skipped; eval 3/3; typecheck/lint passed |
| this task commit | E06 positive-weight effective-independence correction; coordinator accepted | focused 18/18; serialized unit 1,269/1,269; contract 97 passed/22 skipped; integration 44 passed/390 skipped; eval 3/3; typecheck/lint passed |

## Handoff

```text
RNI LANE     ENGINE
BRANCH       feat/rni-engine-live-slice
BASE SHA     a26cac5 (latest feat/rni-integration-demo at final verification)
STATUS       PARTIAL
TASKS        6/10; E01-E06 coordinator accepted; E07 in progress; E08-E10 not started
TESTS        E01 focused 16/16; E02 focused 20/20; E03 focused 17/17; E04 focused 19/19; E05 focused 15/15; E06 focused 18/18; serialized unit 1,269/1,269; contract 97 passed/22 skipped; integration 44 passed/390 skipped; eval 3/3; typecheck/full lint pass
CONTRACT     none
RISKS        live Web Search/X smokes pending approved credentials; coordinator must compose workflow, ambiguity policy and I07 semantic persistence; E09/E10 own evaluated model prompts and live injection resistance
FILES        src/rni/{discovery,sources,workflow,observations,analytics}/**; tests/unit/rni/{discovery,sources,workflow,observations,analytics}/**; tests/contract/rni/{discovery,x-source-slice,persist-source-workflow,security-resolution,semantic-classifier,platform-analytics}.test.ts; tests/eval/rni/{security-resolution,semantic-classifier,platform-analytics}.eval.test.ts; docs/rni/progress/ENGINE.md
COMMITS      rebased E01/E02 series through ce503bd, E03 a32c04b, E04 26205f4, E05 ab5e171, E06 25d1195 plus accepted correction in this commit
DEMO PROOF   citation-bound Reddit; independent X terminal states; commit-before-ID-only-interpret; persisted NVDA/AMD exact mentions, cited canonical preference, isolated opposing classification and reproducible platform-bound analytics/confidence
```
