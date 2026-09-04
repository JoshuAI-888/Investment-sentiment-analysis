# Retail Narrative Intelligence — Development Plan

**Delivery target:** live RNI vertical-slice demo plus defensible architecture  
**Planning horizon:** overnight integration target; post-demo hardening remains explicit backlog  
**Branch strategy:** contract-first, path-exclusive workstreams, short-lived integration branches
**RNI overnight orchestration:** [RNI_BUILD_LOOP.md](RNI_BUILD_LOOP.md), [PROGRESS.md](PROGRESS.md), and `progress/*.md` override the generic workstream mechanics for the repository integration slice.

## 1. Definition of ready and done

A task is **ready** when its owner, intent, inputs/outputs, owned paths, dependencies, fixtures, acceptance tests, and non-goals are explicit.

A task is **done** only when:

- implementation and migration/type changes are committed in the owned paths;
- automated tests listed in the task pass;
- evidence/lineage and error states are tested where applicable;
- documentation and sample environment fields are updated;
- no secrets, source-page HTML, or unlicensed data are committed;
- observability and audit events exist for new runtime actions;
- review confirms accessibility/security/performance proportional to the change;
- the branch is rebased/merged after contract checks, with no acceptance criterion waived silently.

## 2. Repository target

```text
apps/web/app/(rni)/                 RNI portal pages
apps/web/app/api/rni/               authenticated RNI route handlers and MCP endpoint
apps/web/src/rni/contracts/         canonical Zod/TypeScript RNI contracts
apps/web/src/rni/repositories/      RNI persistence and read models
apps/web/src/rni/                   acquisition, agents, analytics and orchestration modules
apps/web/prompts/rni/               versioned prompts
apps/web/fixtures/rni/              sanitised provider and evaluation fixtures
apps/web/tests/**/rni/              RNI unit, contract, integration, eval and E2E suites
apps/web/migrations/0020–0024       reserved forward-only RNI migrations
docs/rni/                           specification, orchestration and progress
```

RNI remains inside the existing Next.js application and reuses its auth, database, jobs, audit,
provider and deployment infrastructure. Do not create a speculative monorepo package layer for
the overnight slice.

## 3. Branch and integration rules

- Branches are fixed by `RNI_BUILD_LOOP.md`: `feat/rni-data-source-first`,
  `feat/rni-engine-live-slice`, `feat/rni-surface-demo`, and `feat/rni-integration-demo`.
- One active owner per path. Cross-path contract changes go through
  `apps/web/src/rni/contracts` and the coordinator first.
- No workstream edits another workstream’s owned paths without a small coordination PR.
- Shared root files (`package.json`, lockfile, workspace config, root TypeScript config) are owned only by Foundation.
- Historical migrations remain immutable. DATA owns `0020–0023`; INTEGRATION owns `0024` for
  the forward universe-ceiling change.
- UI consumes mocked versioned contracts until APIs land.
- Feature flags protect unfinished end-to-end routes.
- Integrate in dependency order; contract tests run on every PR.

## 4. Parallel workstreams

| ID | Workstream / branch | Exclusive paths | Depends on |
|---|---|---|---|
| DATA | `feat/rni-data-source-first` | migrations `0020–0023`, RNI repositories and persistence tests | frozen contract |
| ENGINE | `feat/rni-engine-live-slice` | RNI acquisition, agents, analytics, convergence, prompts and evals | frozen contract; DATA ports |
| SURFACE | `feat/rni-surface-demo` | `(rni)` pages, RNI UI and E2E fixtures/tests | frozen read-service mocks |
| INTEGRATION | `feat/rni-integration-demo` | migration `0024`, shared wiring, CI, API composition and live gates | accepted lanes |

The precise single-writer map in `RNI_BUILD_LOOP.md` is binding if a task description below is
broader. Shared layouts and existing navigation are INTEGRATION-owned.

## 5. Contract freeze (Day 1 morning)

### T0.1 Workspace and CI

**Intent:** create a reproducible repository skeleton.  
**Owner:** W0.  
**Deliverables:** package manager lock, lint/type/test commands, CI matrix, environment example, ownership file.  
**Tests:** clean install; lint; typecheck; empty unit/integration suite; secret scan.  
**Close when:** another branch can install and run all checks from README alone.

### T0.2 Canonical contracts

**Intent:** prevent parallel teams inventing incompatible objects.  
**Owner:** W0.  
**Deliverables:** JSON Schemas/types for `Run`, `SourceItem`, `Security`, `SecurityMention`, `Observation`, `Claim`, `Narrative`, `Metric`, `Confidence`, `Citation`, `Publication`, MCP envelope, freshness.  
**Tests:** schema examples validate; generated types are current; backward compatibility snapshot.  
**Close when:** the worked NVDA/AMD comparative fixture validates end to end.

### T0.3 Interface ADRs

**Intent:** pin decisions that affect every branch.  
**Deliverables:** route selection, source-first transaction, timestamps, versioning, citation grammar, idempotency keys, source capture levels.  
**Tests:** ADR links present in contract docstrings.  
**Close when:** open interface questions have an owner and deadline or accepted decision.

## 6. Data workstream

### T1.1 Neon schema and RLS

**Purpose:** implement tables, keys, indexes, pgvector extension, configuration versions, audit and tenant isolation from `DATA_MODEL_AND_LINEAGE.md`.  
**Owned paths:** `apps/web/migrations/0020_*` through `0023_*`,
`apps/web/src/rni/repositories/**`, and matching RNI persistence tests.  
**Tests:** migration up/down on disposable branch; FK/unique/check constraints; tenant A cannot access tenant B; source URL/content hash dedup; pgvector query plan smoke test.  
**Acceptance:** every publication citation reaches a source item; one source supports multiple security observations; no observation can predate source persistence.

### T1.2 Repository/query layer

**Purpose:** typed, transaction-safe persistence and read models.  
**Tests:** concurrency/idempotency; cursor pagination; source insert followed by interpretation transaction; tombstone/availability; historical configuration reads.  
**Acceptance:** duplicate queue delivery cannot create duplicate semantic objects.

### T1.3 Sanitised fixture pack

**Purpose:** common test proof without redistributing full external pages.  
**Tests:** fixtures contain canonical dummy/original test URLs, bounded text, capture level, timestamp precision, two-ticker observations, citations.  
**Acceptance:** no whole-page HTML, cookies, hidden content, or unnecessary personal data.

## 7. Pipeline workstream

### T2.0 FMP S&P 500 universe synchronization

**Purpose:** replace the existing 100-social-name cap/seed with an immutable, configurable current S&P 500 universe derived from FMP while reusing the canonical security master.  
**Tests:** authenticated endpoint fixture above 500 rows; response schema; duplicate/share-class handling; symbol/exchange resolution; empty/partial/stale response; 600-member ceiling; atomic activation; historical-version preservation; NVDA default; any-member on-demand run.  
**Acceptance:** FMP provider call and payload hash are auditable; invalid sync leaves the active universe unchanged; Settings shows and can stage/activate membership; `joshuai` is the production approver.

### T2.1 Run state machine and durable stages

**Purpose:** resumable `discover → persist → analyse → verify → challenge → gate → publish`.  
**Tests:** stage retry, stale lease recovery, crash after source insert, duplicate event, cancellation, partial failure, budget exhaustion.  
**Acceptance:** persisted checkpoints resume safely and exact stage/run state appears in UI/API.

### T2.2 Discovery adapter and source contract

**Purpose:** bounded Reddit discovery through OpenAI Web Search with canonical URL preservation, plus integration of the existing X adapter as a wholly independent sentiment stream. There is no Reddit API dependency and neither platform is a fallback.  
**Tests:** approved-domain Reddit query, complete source-list request, URL canonicalization, post/comment ID parsing, excerpt-only capture, X adapter contract, independent per-platform checkpoints/failures, timestamp precision, rate limit.  
**Acceptance:** source row commits before any model interpretation; full webpage HTML is rejected; Reddit and X produce separate terminal source slices.

### T2.3 Deterministic analytics

**Purpose:** implement weighted sentiment, attention change, z-score, breadth/HHI, narrative lifecycle, confidence components/caps separately for Reddit and X, followed by explicit agreement/divergence facts.  
**Tests:** platform-isolation, golden formula vectors, zero denominators, missing baselines, winsorization, timezone boundaries, parameter version reproduction, Reddit/X disagreement, one-source failure.  
**Acceptance:** recomputing each platform from saved inputs and config returns bit-for-bit equivalent rounded metrics; convergence never silently pools raw counts.

### T2.4 Scheduler/manual-run API

**Purpose:** cron/manual triggers produce the same bounded run request.  
**Tests:** UTC/timezone conversion, DST preview, signature/secret, double click, cron redelivery, overlapping scope, run-now.  
**Acceptance:** no duplicate run work; freshness timestamps distinguish attempt/success/data-through/computed.

## 8. Agent workstream

### T3.1 Provider adapters

**Purpose:** OpenAI Direct default, optional Vercel AI Gateway with identical internal envelope.  
**Tests:** route precedence, structured output, resolved model/provider capture, retry classes, configured fallback, token/cache/cost collection.  
**Acceptance:** route never changes silently; future-run setting behaviour verified.

### T3.2 Resolver and classifier

**Purpose:** all-security extraction and independent four-dimensional per-security observations.  
**Tests:** comparative fixture; ticker collisions; quoted speech; sarcasm; no mention; strict schema; evidence offsets.  
**Acceptance:** bullish NVDA/bearish AMD produces two observations without stance leakage.

### T3.3 Claims, themes, narratives

**Purpose:** atomic cited claims, dynamic versioned taxonomy, embedding candidates, LLM adjudication.  
**Tests:** paraphrase, opposition, repost, new theme, inactive theme, historical version.  
**Acceptance:** cluster membership and rationale trace to claims and source spans.

### T3.4 Verification, challenger, synthesis

**Purpose:** evidence-backed catalyst status, strongest supported countercase, and three-part sentence-cited explanation: Reddit sentiment, X sentiment, combined summary.  
**Tests:** false/date-cutoff catalyst; no counterevidence; uncited sentence; unavailable source; prompt injection; platform disagreement; partial cross-source state; citation-platform mismatch.  
**Acceptance:** synthesiser has no unconstrained web tool, cannot publish unsupported factual text, never uses one platform as fallback, and preserves separate platform conclusions.

### T3.5 Prompt/cache registry

**Purpose:** versioned prompts/schemas/tools, stable prefixes, cache keys, admin drafts.  
**Tests:** prefix hash stability, version invalidation, tenant isolation, cache metrics.  
**Acceptance:** prompt activation requires successful eval approval.

## 9. Portal workstreams

### T4.1 Research shell and Radar

**Owner:** W4.  
**Purpose:** nontechnical overview with windows, four dimensions, citations, freshness.  
**Tests:** contract mocks, sorting/filtering, company name everywhere, insufficient-evidence state, responsive/accessibility.  
**Acceptance:** a nontechnical tester can answer “what changed and why?” and open original evidence in three actions or fewer.

### T4.2 Security, theme, narrative views

**Tests:** independent dimensions, chart gaps, challenger, verified/unverified labels, historical taxonomy.  
**Acceptance:** all explanation sentences expose citations and lineage.

### T4.3 Evidence/raw-data explorer

**Tests:** columns/filters, escaped content, source spans, model lineage, no HTML rendering, role access.  
**Acceptance:** user can trace source → two observations → narrative → metric → publication.

### T5.1 Runs/freshness/manual refresh

**Owner:** W5.  
**Tests:** status states, durable navigation, estimate/confirmation, idempotency, partial failures.  
**Acceptance:** last attempt/success/data-through/computed are distinct and correct.

### T5.2 Settings, schedules, evals

**Tests:** draft-preview-approve-activate, permissions, DST, route future-only, eval regression, audit.  
**Acceptance:** active settings cannot be mutated in place and AI suggestions cannot self-activate.

## 10. MCP workstream

### T6.1 Server baseline and OAuth

**Tests:** MCP initialize, Streamable HTTP, protected-resource metadata, PKCE/DCR path, token audience, RLS identity, protocol errors.  
**Acceptance:** current ChatGPT and Claude test clients authenticate and call a read tool without cross-tenant exposure.

### T6.2 Read tools/resources/prompts

**Tests:** schemas, cursors, citation envelope, stale warnings, resource URI encoding, client lacking resources.  
**Acceptance:** named-security analysis can be completed entirely from governed stored data with citations.

### T6.3 Mutation tools

**Tests:** scopes, confirmation metadata, idempotency, budgets, schedule version conflict, order rejection.  
**Acceptance:** mutations are auditable and cannot expand beyond bounded requested scope.

## 11. Eval workstream

### T7.1 Annotation guide and frozen set

**Tests:** inter-annotator agreement, adjudication completeness, leakage/duplicate analysis, slices.  
**Acceptance:** each core gate has sufficient real examples and known uncertainty.

### T7.2 Automated evaluation harness

**Tests:** metric unit tests, calibrated model grader, deterministic release gate, regression report.  
**Acceptance:** candidate versus active prompt/model/config comparison is one repeatable command/job.

### T7.3 Adversarial and product eval

**Tests:** all scenarios in `EVALS_AND_GUARDRAILS.md`, plus timed nontechnical usability and named-ticker live demo.  
**Acceptance:** critical failures block release and link to examples.

## 12. Deployment workstream

### T8.1 Infrastructure templates

**Tests:** preview/prod separation, env validation, Neon branch, migration dry run, cron auth, least privilege, backup/restore drill.  
**Acceptance:** a second engineer can deploy from `DEPLOY.md` with only documented human steps.

### T8.2 Observability and incident runbooks

**Tests:** injected provider/database/source failure; alerts; cost threshold; stale run; trace from request to source.  
**Acceptance:** owners can identify failing stage and last safe checkpoint without database archaeology.

## 13. Five-day sequence

| Day | Critical path | Parallel work |
|---|---|---|
| 1 | W0 contracts/repo; W1 schema start | UI mocks, eval guide, deployment accounts/source review |
| 2 | source persistence + run state; provider adapter | Radar/security UI, MCP/OAuth skeleton, frozen fixtures |
| 3 | resolver/classifier + metrics + citations | data explorer/admin UI, MCP reads, adversarial tests |
| 4 | verification/challenger/synthesis + full integration | schedules, eval dashboard, deploy preview, performance |
| 5 | named-ticker rehearsal, fixes, release gates | architecture review, rollback drill, demo/presentation preparation |

De-scope order if time is constrained: broad source coverage, mutation MCP tools, advanced theme heatmaps, backfill UI. Never de-scope provenance, citations, independent multi-security classification, deterministic metric tests, honest freshness, or access controls.

## 14. Integration plan

1. W0 merges contracts and fixture IDs.
2. W1 merges schema/query layer.
3. W2 and W3 merge behind flags with contract tests.
4. W4/W5 replace mocks route by route.
5. W6 binds tools to the same application services, not duplicate SQL logic.
6. W7 runs release gates on frozen configuration.
7. W8 deploys preview; W9 runs full story.
8. Fixes go through owning branches; integration does not accumulate undocumented business logic.

## 15. End-to-end acceptance story

Given one persisted comparative post that says NVIDIA is preferred to AMD, when a full run executes:

1. canonical source URL and bounded content commit first;
2. NVIDIA and AMD resolve separately;
3. independent stock/company/trading-intent/theme observations are stored with spans;
4. comparative relation is stored;
5. claims join appropriate narratives without repost inflation;
6. deterministic metrics use the selected 1-day and comparison windows;
7. catalyst/challenger sources are persisted before verdict;
8. confidence and guardrails decide publication;
9. Radar and security pages show ticker + company, four dimensions, freshness, citations;
10. Data Explorer and MCP trace each claim to the original URL;
11. duplicate execution creates no duplicate records;
12. a missing citation, stale discovery, or ambiguous symbol visibly blocks/limits publication.

## 16. Final release checklist

- [ ] All hard eval and guardrail gates pass.
- [ ] Named-ticker demo rehearsed from a clean browser/session.
- [ ] Original URLs and bounded evidence visible; no whole pages stored.
- [ ] Multi-ticker stance leakage test passes.
- [ ] OpenAI Direct default and gateway toggle tested.
- [ ] Cron, manual refresh, rerun, freshness, partial failure tested.
- [ ] Retail-accessible source/terms matrix approved; no institutional feed dependency.
- [ ] MCP tested with both clients.
- [ ] Accessibility smoke and security/tenant isolation pass.
- [ ] Cost/token/cache report reviewed.
- [ ] Rollback and source/provider failure demo rehearsed.
- [ ] Human interventions completed in `DEPLOY.md`.
