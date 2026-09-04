# Retail Narrative Intelligence — Existing Repository Integration Plan

**Target repository:** [`JoshuAI-888/investment-sentiment-analysis`](https://github.com/JoshuAI-888/investment-sentiment-analysis)  
**Reviewed branch:** `main` at `2f2bb96a3752d3b4dfe20f72b8bf06fe7a570f20`  
**Review date:** 5 September 2026 (Pacific/Auckland)  
**Delivery constraint:** working demonstration by 6 September 2026  
**Recommendation:** add an isolated Retail Narrative Intelligence (RNI) vertical slice; do not merge the full specification into the existing feature roadmap overnight.

**Owner decisions confirmed:** 5 September 2026 by `joshuai`.

**Execution control:** [RNI_BUILD_LOOP.md](RNI_BUILD_LOOP.md) with the coordinator tracker in [PROGRESS.md](PROGRESS.md) and workstream trackers under `progress/`.

---

## 1. Executive decision

The existing repository is a strong foundation, but it is not an empty shell. It already makes binding architectural decisions about evidence identity, sentiment scoring, scheduling, AI routing, terminology, deployment, and parallel ownership. Several of those decisions contradict the new RNI specification.

The fastest safe route is:

1. Freeze a small set of shared contracts in a short integration commit.
2. Add RNI behind a namespaced module and namespaced routes.
3. Run three non-overlapping branches in parallel: data, engine, and surface.
4. Allow one integrator to own every shared/hot file and all merges.
5. Define tomorrow's outcome as a live, cited vertical slice—not the full production backlog.

Do **not**:

- rewrite the existing `evidence_item` model overnight;
- change the repository-wide AI default from Gateway to Direct;
- introduce a second scheduler, ticker master, authentication model, calculation framework, or audit framework;
- promise continuous coverage of every subreddit through OpenAI Web Search;
- treat the existing X datasource as a fallback for Reddit or pool the two before calculating platform-specific sentiment;
- claim the full RNI specification, MCP surface, dynamic administration, and production hardening are complete tomorrow.

### Feasibility verdict

| Scope | By tomorrow? | Verdict |
|---|---:|---|
| One live end-to-end RNI vertical slice with citations | Yes, with disciplined scope | Commit to this |
| All 24 communities continuously monitored | No | Configure them now; label Web Search coverage as sampled |
| Reddit through OpenAI Web Search | Yes, sampled | This is the only Reddit acquisition path; there is no Reddit API dependency |
| X as an independent sentiment stream | Yes, using the existing adapter | Preserve separate processing, metrics, freshness and citations |
| Any current S&P 500 security | Yes for search/on-demand analysis | FMP-derived versioned universe; NVDA selected by default |
| Full admin configurability, scheduling UI, and historical replay | No | Use defaults plus manual run/freshness |
| Comprehensive production MCP implementation | No | Contract/skeleton only, or defer |
| Full original specification pack | No | Existing repository estimates 160–210 hours / 8–10 weeks |

---

## 2. What already exists and should be reused

The repository is materially ahead of a greenfield build:

- Next.js 15 / React 19 web application deployed on Vercel.
- Neon PostgreSQL migrations and typed repositories.
- Better Auth OTP and a single-operator security posture.
- Deterministic calculation artifacts and an Inspector/replay pattern.
- Attention, velocity, z-score, breadth, sentiment, and sample-adequacy analytics.
- A pinned Python sentiment scorer service using FinBERT and Twitter-RoBERTa.
- Provider adapter contracts and seven non-Reddit adapters.
- Research runs, research events, claim ledger, provider-call logs, model routes, cost events, jobs, and job runs.
- Dashboard, ticker/evidence views, data explorer, job/model/settings administration routes.
- QStash/Upstash queue architecture.
- A mature feature-loop and three-lane branch/worktree model.
- A green remote CI baseline. The latest inspected `main` workflow completed successfully in approximately four minutes.

Relevant source documents:

- [Architecture contracts](https://github.com/JoshuAI-888/investment-sentiment-analysis/blob/main/docs/02-ARCHITECTURE-CONTRACTS.md)
- [Roadmap](https://github.com/JoshuAI-888/investment-sentiment-analysis/blob/main/docs/03-ROADMAP.md)
- [Parallel lanes](https://github.com/JoshuAI-888/investment-sentiment-analysis/blob/main/docs/06-PARALLEL-LANES.md)
- [Deployment runbook](https://github.com/JoshuAI-888/investment-sentiment-analysis/blob/main/DEPLOY.md)
- [CI workflow](https://github.com/JoshuAI-888/investment-sentiment-analysis/blob/main/.github/workflows/ci.yml)

### Current delivery state that matters

The codebase has a healthy foundation, but the live-data and agent layers are incomplete:

- `/api/cron/dispatch` currently returns a fixture placeholder rather than performing the live dispatch.
- Reddit API onboarding is an unresolved legacy task and is no longer relevant to the RNI build; RNI must not depend on it.
- The evidence stance pipeline, research agent, eval harness, and MCP feature are not complete.
- The deployed product is documented as operating in fixture mode.
- The repository records no production corpus, no calibrated judge corpus, and no configured live LLM evaluation baseline.
- The admin allowlist is documented as empty in Vercel, so production sign-in may be unavailable until a human configures it.

This means the RNI work can use the existing foundations, but it cannot assume that the unbuilt roadmap items will materialise as dependencies overnight.

---

## 3. Required convergence versus safe separation

### Must converge with the existing repository

These concerns must have one owner and one implementation. Duplicating them would create incompatible truth systems.

| Concern | Existing authority to reuse | RNI integration rule |
|---|---|---|
| Security identity | Existing `security` master | Every RNI mention resolves to the existing `security.id`; no second ticker table |
| Monitored universe | Existing `universe_version` / `universe_member` | Replace the 100-social-name seed with an FMP-current S&P 500 version; preserve historical versions |
| Authentication | Better Auth and current operator policy | RNI pages use the existing session/allowlist guard |
| Run identity | `research_run` | One RNI execution links to a repository run; fine-grained stages go into `research_event` |
| Audit trail | `research_event`, `provider_call_log`, `cost_event` | Record discovery, persistence, AI calls, analytics, publication, degradation, and failure |
| Model routing | `model_route` and config versions | Add RNI task routes; do not replace the global routing mechanism |
| Calculation provenance | `CalculationArtifact` and Inspector | All displayed RNI numbers use the existing calculation envelope and replay conventions |
| Job control | `job_definition` and `job_run` | Manual RNI refresh and future schedules create normal job runs |
| Scheduling | QStash/Upstash architecture | Do not add Vercel Cron as a parallel scheduler |
| Provider boundary | Existing `ProviderResult` contract | Web Search adapter returns a compatible bounded discovery envelope |
| X acquisition | Existing X adapter | Reuse as an independent first-class source; do not invoke or label it as Reddit fallback |
| UI shell | Existing app layout, navigation, auth, empty/error/loading conventions | Add RNI pages within the current application |
| Production gates | Existing CI plus RNI tests | Update path filters so RNI agent/eval changes cannot bypass eval checks |
| Product language | Existing copy rules | Prefer “state”, “pattern”, or “observation”; avoid a repository-wide redefinition of “signal” |

### Can remain a separate RNI build lane

| Isolated concern | Proposed namespace |
|---|---|
| Canonical source-first persistence | migrations `0020–0024`, tables prefixed `rni_` |
| OpenAI Web Search discovery adapter | `apps/web/src/rni/discovery/**` |
| Cross-source convergence | `apps/web/src/rni/convergence/**`; consumes completed Reddit and X slices without pooling raw counts |
| Source extraction and bounded-content policy | `apps/web/src/rni/sources/**` |
| Per-security, per-dimension observations | `apps/web/src/rni/observations/**` |
| RNI prompts, tool schemas, and agents | `apps/web/src/rni/agents/**` |
| Narrative/theme clustering | `apps/web/src/rni/narratives/**` |
| RNI deterministic formulas | `apps/web/src/rni/analytics/**` |
| RNI workflow orchestration | `apps/web/src/rni/workflow/**` |
| RNI UI components | `apps/web/src/rni/ui/**` |
| RNI pages | `apps/web/app/(rni)/**` |
| RNI fixtures and evaluation corpus | `apps/web/fixtures/rni/**`, `apps/web/tests/eval/rni/**` |
| Initial community/source policy | versioned RNI configuration seed |
| FMP S&P 500 synchronizer | `apps/web/src/rni/universe/**`; writes only through the existing universe repository/contracts |
| Task-specific Direct/Gateway preference | RNI `model_route` rows/config version |

This separation is architectural, not organisational only. RNI must expose a small public contract and otherwise remain invisible to existing modules.

---

## 4. Specification contradictions and required resolutions

### C1 — Source identity: one source versus one source-security row

**Existing behaviour:** `evidence_item` is security-specific. Repository commentary describes a multi-ticker item as the same raw payload persisted once per ticker, with logical identity `(provider, raw_hash, security_id)`.

**RNI requirement:** persist one immutable original source before interpretation, then attach many security mentions and many per-security observations.

**Resolution:** do not coerce `evidence_item` into the new role. Add:

```text
rni_source_item 1 ──< rni_source_security >── 1 security
        │                     │
        │                     └──< rni_observation
        ├──< rni_claim ──< rni_claim_citation
        └──< rni_source_capture
```

If a post says “NVDA is the quality winner; AMD is overvalued”, persist one source, two source-security links, a bullish company/stock observation for NVDA, a bearish company/stock observation for AMD, and an optional `preferred_over` relationship.

### C2 — Canonical URLs are optional today

**Existing behaviour:** `evidence_item.source_url` is nullable, including a stated allowance for comments without permalinks.

**RNI requirement:** every published explanation must cite a traceable original URL, and discovery is persisted before downstream AI processing.

**Resolution:** `rni_source_item.canonical_url` is `NOT NULL`. A Reddit comment is eligible only when a stable comment permalink can be constructed and stored. If no canonical URL exists, the item may be recorded in a rejected-discovery audit event but cannot enter interpretation or publication.

### C3 — Duplicate prevention is not concurrency-safe

**Existing behaviour:** migration 0013 adds a non-unique index for `(provider, raw_hash, security_id)`; the repository acknowledges that concurrent inserts can duplicate evidence.

**RNI requirement:** reruns and parallel discovery must not duplicate the canonical source.

**Resolution:** enforce database uniqueness, not application-only deduplication:

```sql
unique (platform, external_object_type, external_id)
unique (source_item_id, security_id)
unique (source_item_id, security_id, dimension, model_route_id, prompt_version)
```

Use `INSERT ... ON CONFLICT ...` and return the existing source ID. Persisting the source and durable discovery event must commit before an AI job is enqueued.

### C4 — Permanent full-body retention conflicts with the new persistence rule

**Existing behaviour:** architecture text calls for permanent full bodies for Reddit/Substack. Another F10 completion statement says snippets are capped and full content is not stored. The repository is internally inconsistent.

**RNI requirement:** do not persist whole web pages; retain the post/comment and relevant metadata only.

**Resolution:** use a bounded capture policy:

- never store HTML pages, navigation, advertisements, recommendation widgets, or unrelated comments;
- store post title, self-text or selected comment text, author pseudonym/hash, timestamps, subreddit, score/comment metadata available at capture time, canonical URL, external IDs, query provenance, and capture timestamp;
- cap retained text by policy and keep a content hash of the captured text;
- identify whether the capture is `post`, `comment`, or `excerpt` and whether it is complete within the provider result;
- store discovery search-result text separately from the canonical content capture;
- support tombstone/deletion status without silently deleting analytic provenance.

### C5 — One aggregate stance versus four dimensions

**Existing behaviour:** `sentiment_snapshot` exposes aggregate positive/neutral/negative sampled-social stance.

**RNI requirement:** stock-price sentiment, company/fundamental sentiment, trading-intent sentiment, and theme sentiment must be distinct.

**Resolution:** RNI observations are per `(source, security, dimension)`. Do not extend the existing aggregate snapshot until the RNI semantics are proven. A later compatibility view can aggregate RNI observations into the existing stance output.

### C6 — Confidence terminology collision

**Existing behaviour:** the repository intentionally uses `sample_adequacy`, avoiding a vague “confidence” label.

**RNI requirement:** a defensibility confidence engine.

**Resolution:** retain `sample_adequacy` for statistical coverage. Add `evidence_confidence` for publication defensibility, with named components and a calculation artifact. Never display a single unlabeled “confidence” percentage.

### C7 — AI routing defaults conflict

**Existing behaviour:** the repository defaults globally to Vercel AI Gateway with a direct-provider fallback.

**RNI requirement:** OpenAI Direct by default; user can select Vercel AI Gateway in settings.

**Resolution:** do not flip the repository-wide default. Seed RNI-specific task routes such as `rni.discovery`, `rni.classify`, `rni.verify`, `rni.challenge`, and `rni.synthesise` with `transport=direct_openai`. The setting creates a new config version for future runs; it does not rewrite historical provenance or affect legacy tasks.

### C8 — LLM scope conflicts with deterministic scorer design

**Existing behaviour:** v1 limits the LLM mainly to relevance/ticker-collision resolution; stance is produced by a pinned deterministic Python service.

**RNI requirement:** independent multi-dimensional semantic observations, claims, themes, catalyst verification, challenger, and synthesis agents.

**Resolution:** keep existing sentiment scoring intact. RNI agents produce structured semantic observations; deterministic code then validates, aggregates, thresholds, and publishes. The existing scorer can be recorded as an additional stance feature or cross-check, not silently replaced.

### C9 — OpenAI Web Search is not equivalent to continuous Reddit monitoring

**Existing blocker:** official Reddit API approval is not complete.

**RNI desire:** continuously monitor 24 named communities.

**Resolution:** use OpenAI Web Search as the RNI Reddit path. Persist its query, search window, search result/citation metadata, canonical Reddit URL, and capture status. The UI must say `Reddit — sampled web discovery`, never “complete Reddit coverage”. Remove Reddit API access from RNI prerequisites, acceptance criteria, deployment gates and future runtime assumptions.

### C9A — X must not be a Reddit fallback

**Existing asset:** the repository already has an X adapter and treats social platforms as separate analytical axes.

**RNI requirement:** X sentiment, Reddit sentiment and a combined summary must all be visible.

**Resolution:** create independently terminal `REDDIT` and `X` source slices for each security/window. Each owns its own acquisition status, sample count, observations, narratives, deterministic metrics, confidence, freshness and citations. Only after both are terminal may a convergence step create agreement/divergence facts and a cited combined narrative. If one source is unavailable, show the available source unchanged and mark the combined section `PARTIAL_CROSS_SOURCE`; never substitute, backfill or relabel.

### C10 — Scheduler conflict

**Existing architecture:** QStash and job tables.

**New pack:** includes Vercel deployment concepts and may be read as permitting Vercel Cron.

**Resolution:** one scheduler only. Implement manual refresh through the existing job system and use QStash when scheduling is enabled. Vercel Cron is not introduced.

### C11 — Vector-store scope conflict

**Existing roadmap:** pgvector is deferred until corpus scale or retrieval quality proves it necessary.

**RNI pack:** specifies Neon + pgvector for clustering/retrieval.

**Resolution for tomorrow:** no vector dependency. Use deterministic normalized claim keys, exact/lexical similarity, and bounded LLM adjudication for the demonstration. Preserve an embedding field/interface in the design, not the migration. Reconsider pgvector only with a measured retrieval benchmark.

### C12 — Tenancy conflict

**Existing product:** single operator; no multi-tenancy.

**RNI pack:** some security guidance assumes tenant isolation/RLS.

**Resolution for tomorrow:** use the existing operator model. Do not introduce tenant IDs or RLS without a real tenant requirement and a dedicated migration/security review.

### C13 — UI vocabulary conflict

**Existing repository:** copy validation discourages or bans “signal” language in favor of careful observational language.

**RNI pack:** repeatedly uses “signal”.

**Resolution:** UI copy says “retail state”, “attention pattern”, “observed stance”, and
“captured sample”. The required standalone RNI heading `Reddit sentiment` has a path-scoped lint
exception only under `(rni)`/`src/rni/ui`; the same phrase inside a sentence remains banned unless
it explicitly names the observed sample. `check:copy` now scans the RNI UI directory and tests
both the narrow exception and the retained legacy/RNI prose ban. Technical internal identifiers
may retain `signal` only where the repository lint permits it.

### C14 — Pending model-route branch can collide

The unmerged branch `fix/require-ai-model-routes-live-mode` changes live-mode requirements for `AI_MODEL_FAST`, `AI_MODEL_SYNTHESIS`, and `AI_MODEL_VERIFY`. It overlaps exactly with RNI model-routing and environment validation.

**Confirmed resolution:** merge that branch first. RNI branches rebase onto the merge and must not edit shared environment validation independently.

### C15 — Existing 100-symbol universe contradicts the S&P 500 requirement

**Existing behaviour:** `UNIVERSE_MAX_SYMBOLS = 100`, migration `0006` enforces `selected_count <= 100`, and the seed is 100 stocks chosen from Reddit/ApeWisdom attention. That creates selection bias and cannot contain the current S&P 500 membership. The full universe settings surface is also still an unbuilt F15 item.

**Confirmed resolution:** the integration lane owns a forward migration, contract/repository update and minimal settings UI:

- use FMP's current [`/stable/sp500-constituent`](https://site.financialmodelingprep.com/developer/docs/stable/sp-500) response as the external membership source;
- persist the raw-response hash, retrieval time, provider request/call record and normalized membership snapshot;
- resolve each returned symbol/company against the existing security master; never create a second ticker catalogue;
- create a new immutable universe version rather than mutating the existing 100-name version;
- set a database/code safety ceiling of 600 members, sufficient for constituent share classes and ordinary composition churn; keep the active cap configurable up to that ceiling;
- default the active preset to `S&P 500 — FMP current`, and default the selected security to `NVDA — NVIDIA Corporation`;
- allow an administrator to stage, preview and activate a different eligible membership set in Settings, with `joshuai` as production approver;
- record added/removed constituents and never rewrite historical run membership;
- block activation on partial, empty, duplicate, ambiguous or unresolved FMP responses.

S&P 500 membership does not imply 500 per-ticker Web Search calls. Scheduled Reddit discovery remains source/community-first and maps captured mentions to the active universe. On-demand analysis accepts any active S&P 500 security. X acquisition uses its independently governed query/watch strategy. Both expose their actual coverage.

---

## 5. Tomorrow's definition of “demo complete”

The following is the maximum defensible overnight commitment.

### Included

1. A user enters or selects a ticker and a one-day default discovery window. Any security in the active FMP-derived S&P 500 universe is eligible; NVDA is preselected on first load.
2. The system performs OpenAI Direct Web Search for Reddit using the configured subreddit policy and independently invokes the existing X adapter using its configured watch/query policy.
3. Every accepted result is persisted as a canonical, bounded `rni_source_item` before any downstream AI interpretation.
4. A comparative post creates one source and separate observations for every resolved security.
5. Structured RNI processing produces four dimensions: stock, company, trading intent, and theme.
6. Deterministic aggregation produces separate Reddit and X attention, change/velocity where a comparison window exists, breadth, sentiment index, z-score only when a valid baseline exists, sample adequacy, and evidence confidence.
7. The user sees three explicit outputs: Reddit sentiment, X sentiment and a combined summary. The combined summary preserves divergence, platform-specific limitations and platform-labelled citations.
8. The UI includes:
   - Retail Radar;
   - security/company detail;
   - cited explanation and evidence drawer;
   - raw RNI data explorer;
   - last refresh, source window, run state, route/model, and sample-coverage label;
   - manual full run and ticker rerun;
   - honest insufficient/degraded states.
9. The initial 24-community source policy is seeded and visible:
   - continuous priority: wallstreetbets, pennystocks, Shortsqueeze, stocks, StockMarket, investing, Daytrading, TheRaceTo10Million;
   - concentrated: Superstonk + GME as one GME concentration cluster, amcstock, ASTSpaceMobile, PLTR;
   - specialist: TeslaInvestorsClub, NVDA_Stock, RKLB, UraniumSqueeze, SPACs, weedstocks;
   - long-term: ValueInvesting, Bogleheads, dividends, ETFs, SecurityAnalysis.
10. A fixture and at least one live example prove source-first persistence, multi-ticker classification, citations, and rerun idempotency.
11. Remote CI and a deployed smoke test pass.
12. Settings displays the active S&P 500 universe version, FMP as its source, constituent count, retrieved/activated times and pending changes; `joshuai` can stage and activate a new version.

### Explicitly deferred

- Claiming continuous or exhaustive monitoring of all communities.
- Exhaustive Reddit comment-thread collection; no Reddit API path is assumed.
- Historical backfill and long-baseline z-scores.
- Full schedule editor; a seeded schedule may be enabled after the manual path is stable.
- Dynamic theme taxonomy editing and safe corpus-wide recategorisation.
- Production-calibrated confidence thresholds.
- Full comprehensive MCP implementation; provide a contract or read-only thin slice only.
- pgvector and semantic search at scale.
- Multi-tenant RLS.
- External sources beyond Reddit Web Search, the existing independent X adapter, and required verification sources.
- Full security/load/chaos hardening.

The UI and demo script must identify these as deferred, not silently simulate them.

---

## 6. Branch and worktree plan

### Phase 0 — one short convergence commit (H0–H1)

**Owner:** integrator only  
**Branch:** `feat/rni-00-contract-freeze`

The integrator creates or reserves:

- `docs/features/RNI-00-CONTRACT.md` — immutable overnight contract.
- `apps/web/src/rni/contracts/index.ts` — public Zod/TypeScript schemas only.
- migration numbers `0020` through `0024`.
- route namespace `(rni)` and API namespace `/api/rni/**`.
- fixed fixture IDs and the comparative test example.
- RNI task names in the existing model-route vocabulary.
- source policy version `rni-source-policy-v1`.
- the FMP S&P 500 universe contract, migration/ceiling change and ownership of the minimal universe settings surface.
- CI path triggers for `apps/web/src/rni/**`, `apps/web/tests/eval/rni/**`, and `apps/web/prompts/rni/**`.
- an addendum to parallel-lane ownership documenting the temporary RNI lanes.

No builder starts until this commit is merged into the common base.

### Lane A — RNI data

**Branch:** `feat/rni-data-source-first`  
**Owns:**

- `apps/web/migrations/0020_rni_source.sql`
- `apps/web/migrations/0021_rni_observation.sql`
- `apps/web/migrations/0022_rni_narrative.sql`
- the reserved forward migration changing the existing universe ceiling and adding membership-source lineage, as allocated by the integrator
- `apps/web/src/rni/repositories/**`
- `apps/web/tests/integration/rni-persistence/**`

**Must not touch:** app routes, agents, analytics, `env.ts`, package manifests, lockfile, shared calculation registry.

**Deliverable:** canonical source, source-security links, observations, claims/citations, narratives/themes, independent `REDDIT`/`X` run-source slices, versioned source policies, idempotent repositories, deletion/tombstone state.

**Acceptance tests:**

- concurrent inserts of the same Reddit external ID yield one source row;
- comparative fixture yields one source, two security links, and independent observations;
- source transaction commits before an interpretation job can claim it;
- no source can become publishable without canonical URL and captured content/excerpt;
- every claim citation resolves through a foreign key to a persisted source;
- rerunning the same source does not inflate attention counts.
- X and Reddit rows remain distinguishable by platform and cannot be joined into the wrong platform slice.
- a dated FMP fixture above 500 entries resolves to one immutable universe version without exceeding the 600-member safety ceiling;
- partial, duplicate, empty, ambiguous or unresolved constituent responses fail activation atomically.

### Lane B — RNI engine

**Branch:** `feat/rni-engine-live-slice`  
**Owns:**

- `apps/web/src/rni/discovery/**`
- `apps/web/src/rni/sources/**`
- `apps/web/src/rni/agents/**`
- `apps/web/src/rni/observations/**`
- `apps/web/src/rni/narratives/**`
- `apps/web/src/rni/analytics/**`
- `apps/web/src/rni/convergence/**`
- `apps/web/src/rni/workflow/**`
- `apps/web/tests/unit/rni/**`
- `apps/web/tests/contract/rni/**`
- `apps/web/tests/eval/rni/**`

**Must not touch:** SQL migrations, app pages, shared environment/package/lock files, legacy scorer, legacy analytics.

**Dependency rule:** repositories, clock, model caller, web-search caller, and job writer are injected behind the frozen interfaces. Until Lane A merges, tests use in-memory fakes.

**Deliverable:** bounded Reddit Web Search discovery, integration with the existing independent X adapter, URL/content validation, multi-security extraction, four-dimensional observations, per-platform deterministic aggregations, cross-source agreement/divergence, evidence confidence, citation-enforced three-part synthesis, degraded-state policy.

**Acceptance tests:**

- discovery result without a canonical Reddit URL is rejected before interpretation;
- prompt injection inside post text cannot change system instructions or tool permissions;
- structured output fails closed on unknown dimension/stance/ticker;
- NVDA-versus-AMD fixture assigns distinct stances without duplicating the source;
- explanation generator cannot emit an uncited factual clause;
- z-score is withheld when baseline history is insufficient;
- deterministic calculations replay byte-for-byte from stored inputs and config;
- Direct OpenAI is selected for RNI by default and Gateway can be selected through injected route config;
- timeout/rate-limit/provider failure produces a visible degraded state, not fabricated results.
- Reddit bullish/X bearish produces two unchanged platform results and a divergent combined summary.
- failure of one platform produces `PARTIAL_CROSS_SOURCE`; it never triggers the other platform as fallback.

### Lane C — RNI surface

**Branch:** `feat/rni-surface-demo`  
**Owns:**

- `apps/web/app/(rni)/**`
- `apps/web/src/rni/ui/**`
- `apps/web/tests/e2e/rni/**`
- RNI-specific Storybook/visual fixtures if the repo uses them

**Must not touch:** migrations, repositories, engine, shared navigation/layout, `env.ts`, package manifests, lockfile.

**Dependency rule:** build against a fixture-backed `RniReadService` defined in the frozen contract. The integrator swaps in the live composition root.

**Deliverable:** Radar, security detail, three-part Reddit/X/combined commentary, evidence/citation view, raw data explorer, per-platform freshness/run status, manual refresh controls, route setting display/toggle, empty/loading/error/degraded states.

**Acceptance tests:**

- every ticker label includes company name;
- default window displays “last 24 hours”; comparison window is clearly separate;
- “why” content has clickable canonical citations;
- data explorer can trace summary → observation → source → URL → run/config/model;
- freshness distinguishes `fresh`, `stale`, `refreshing`, `failed`, and `never run`;
- manual refresh requires confirmation when it would launch a full run and prevents accidental double submission;
- sampled Web Search data is never presented as complete Reddit coverage;
- Reddit sentiment, X sentiment and combined summary are separately labelled on Radar and security detail;
- each platform has independent sample counts, coverage, freshness and citation filters;
- a missing or disagreeing platform remains visible in the combined commentary;
- keyboard, focus, narrow-screen, and no-JavaScript/error fallbacks meet the existing app conventions.

### Integrator lane — shared composition only

**Branch:** `feat/rni-integration-demo`  
**Owner:** one named integrator; never delegated concurrently.

Only this lane may edit:

- `apps/web/src/env.ts`
- `apps/web/package.json`
- lockfile/workspace configuration
- `.github/workflows/ci.yml`
- shared navigation/layout
- route registries and API composition roots
- `apps/web/src/calc/registry.ts`
- `apps/web/src/ui/metric-manifest.ts`
- queue dispatcher and job registration
- model-route/config seeds
- existing universe contract/repository ceiling, FMP sync composition and minimal Settings route wiring
- root progress/memory/roadmap documents

**Merge order:** contract freeze → data → engine → surface → integration. Each lane rebases on the latest integration base immediately before review; builders never merge each other.

---

## 7. Hour-by-hour execution envelope

This schedule assumes three builders plus one integrator/reviewer and a stable deployment account.

| Elapsed | Integrator | Data lane | Engine lane | Surface lane |
|---:|---|---|---|---|
| H0–H1 | Freeze contracts, resolve pending route branch, reserve files/migrations | Review contract | Review contract | Review contract + fixture service |
| H1–H5 | Unblock, review, prepare shared composition | Tables, repositories, integration tests | Discovery, agents, pure analytics, contract tests | Fixture-backed screens and e2e |
| H5–H7 | Merge data, wire service interfaces | Fix review findings | Rebase; replace fake repositories | Rebase; keep fixture toggle |
| H7–H9 | Merge engine and surface; wire model route/jobs/nav | Support only | Fix integration findings | Fix integration findings |
| H9–H11 | Run full gate and one controlled live smoke | Assist diagnostics | Assist diagnostics | Assist diagnostics |
| H11–H13 | Deploy preview/production, verify auth/config/citations | Stand by | Stand by | Run browser smoke/accessibility |
| H13–H16 | Repair buffer, demo data capture, rehearse honest demo | Targeted fixes | Targeted fixes | Targeted fixes |

If Phase 0 exceeds one hour because contracts are disputed, cut scope immediately. Do not let three builders implement three interpretations.

---

## 8. Integration contract to freeze

The contract should be intentionally small:

```ts
type RniDimension = 'stock' | 'company' | 'trading_intent' | 'theme';
type RniStance = 'bullish' | 'bearish' | 'mixed' | 'neutral' | 'unclear';
type RniCoverage = 'reddit_sampled_web_discovery' | 'x_configured_sample';
type RniPlatform = 'reddit' | 'x';
type RniCrossSourceStatus =
  | 'complete_cross_source'
  | 'divergent_cross_source'
  | 'partial_cross_source'
  | 'insufficient_cross_source';

interface RniSourceCandidate {
  platform: RniPlatform;
  externalObjectType: 'post' | 'comment';
  externalId: string;
  canonicalUrl: string;
  community: string;
  title?: string;
  capturedText: string;
  captureLevel: 'complete_post' | 'complete_comment' | 'bounded_excerpt';
  publishedAt?: string;
  timestampPrecision: 'exact' | 'date' | 'unknown';
  discoveredAt: string;
  capturedAt: string;
  queryId: string;
  metadata: Record<string, unknown>;
}

interface RniObservationInput {
  sourceId: string;
  securityId: string;
  dimension: RniDimension;
  stance: RniStance;
  score: number;
  evidenceText: string;
  modelRouteId: string;
  promptVersion: string;
}

interface RniReadService {
  radar(query: RadarQuery): Promise<RadarResult>; // Reddit + X + combined
  securityDetail(query: SecurityQuery): Promise<SecurityDetail>; // three explicit sections
  sourceDetail(sourceId: string): Promise<SourceDetail>;
  runDetail(runId: string): Promise<RunDetail>;
}
```

The contract must also define:

- source eligibility and rejection codes;
- metric formulas/units and insufficient-data behaviour;
- citation shape;
- run stage and failure vocabulary;
- stable error envelope;
- exact configuration snapshot attached to a run;
- one reference comparative fixture with expected outputs.
- platform-slice and cross-source status semantics, including disagreement and one-source failure.

Anything not needed across lanes stays private.

---

## 9. OpenAI Web Search persistence test

The Web Search output is fit for discovery only if the application performs a second, controlled normalization step. The model response itself must not become the evidence record.

### Required sequence

1. Generate bounded queries from ticker/company, source policy, and `[window_start, window_end)`.
2. Execute Web Search and store a provider-call log: query, route, model, timestamps, status, token/cost data, and returned citation metadata.
3. Accept only canonical Reddit post/comment URLs in the configured communities.
4. Resolve redirects and normalize URL identity without removing the post/comment identifier.
5. Capture only the relevant post or comment fields—not the entire webpage.
6. Insert/upsert `rni_source_item` and durable discovery event.
7. Commit the transaction.
8. Enqueue/continue security resolution and interpretation using only the persisted `source_id`.
9. Preserve any citation returned by Web Search as discovery provenance, while the canonical Reddit URL is the user-facing evidence citation.

### Persist

- canonical URL and external post/comment IDs;
- subreddit and object type;
- post title and bounded self-text, or bounded relevant comment text;
- published/captured/discovered timestamps and precision;
- available author pseudonym/hash and engagement metadata with capture timestamp;
- search query ID and provider-call ID;
- content hash, capture level, truncation flag, language, deletion/tombstone state;
- rights/policy version and retrieval method.

### Do not persist

- full rendered HTML;
- page chrome, ads, navigation, suggested posts, unrelated comments;
- OpenAI-generated paraphrase as though it were the original post;
- hidden page content or personal data not needed for the analysis;
- an untraceable excerpt without a canonical source URL.

### Go/no-go proof

Use at least five live samples, including one comparative post and one comment permalink. A sample passes only if a reviewer can start from the database row, open the canonical URL, locate the captured text, verify the relevant metadata, and reproduce every downstream citation. If live page retrieval cannot verify the captured text, show the source as `discovered_unverified` and exclude it from publishable synthesis.

---

## 10. Risks and confirmed closure paths

Every identified risk has a chosen mitigation, one accountable owner and objective evidence required to close it. “Confirmed” means the path is approved; it does not mean the implementation gate may be skipped.

| Severity | Risk | Confirmed path | Owner | Closure evidence |
|---|---|---|---|---|
| Critical | Tomorrow interpreted as full specification | Ship only Section 5's vertical slice | joshuai + integrator | Scope copied into contract PR; deferred list visible |
| Critical | Duplicate sources across tickers/runs | Canonical source plus database uniqueness/upsert | DATA | Concurrent-insert and rerun tests pass |
| Critical | AI runs before source commit | Transactional persist-first boundary; downstream accepts `source_id` only | DATA + ENGINE | Crash-after-insert/outbox test passes |
| Critical | Web Search presented as continuous Reddit coverage | `REDDIT_SAMPLED_WEB_DISCOVERY` everywhere | SURFACE | Copy/e2e assertions and demo disclosure pass |
| Critical | X used as fallback or silently pooled | Independent terminal slices; converge afterward | ENGINE | Divergence and one-source-failure tests pass |
| Critical | Existing 100-name universe blocks S&P 500 | Forward migration, 600 safety ceiling, FMP immutable snapshot | Integrator + DATA | >500-member fixture and production capability probe pass |
| High | Model-route branch collides mid-build | Merge `fix/require-ai-model-routes-live-mode` before contract freeze | Integrator | Merge SHA recorded; all RNI branches share base |
| High | Global Gateway default is changed | RNI-only Direct task routes; legacy route unchanged | Integrator | Route config diff and legacy regression test pass |
| High | RNI agent changes bypass eval CI | Extend CI path filters during contract freeze | Integrator | Deliberate RNI prompt change triggers eval job |
| High | Agent package-manager mismatch | Corepack with pinned pnpm 10.33.0 | Integrator | Clean-checkout frozen install/build passes |
| High | `esbuild`/`sharp` scripts skipped | Validate supported workspace build-script policy under pinned pnpm | Integrator | Clean build proves both dependencies usable |
| High | Full-page retention/privacy exposure | Approved bounded source policy and tombstones | DATA | Persistence tests reject HTML/page chrome |
| High | Legacy `evidence_item` rewritten overnight | Isolated `rni_` tables; later bridge only | DATA | Migration diff contains no destructive legacy-table rewrite |
| High | FMP response stale/partial/blocked | Authenticated probe, atomic validation, last-good version and stale UI | Integrator + joshuai | Provider audit plus successful production activation approval |
| High | 500+ listings exceed search/X budget | Source-first Reddit discovery, independent bounded X, on-demand ticker runs, hard budgets | ENGINE + integrator | Impact preview and max-cost/load test pass |
| High | Confidence conflates coverage and defensibility | Separate sample adequacy and evidence confidence | ENGINE + SURFACE | Metric manifest and UI tests show both labels |
| Medium | Z-score lacks sufficient history | Withhold below minimum baseline | ENGINE | Insufficient-baseline golden test passes |
| Medium | Shared-file branch conflicts | Integrator is sole writer of hot files | Integrator | Lane file lists contain no shared-file violations |
| Medium | Theme edits rewrite history | Version taxonomy; editor/backfill deferred | Integrator | Historical fixture remains pinned and unchanged |
| Medium | Source prompt injection changes behaviour | Content-as-data delimiters, strict schemas, allowlisted tools | ENGINE | Prompt-injection suite passes |
| Medium | X volume dominates combined result | Calculate platforms independently; no raw-count pooling | ENGINE | Scale-imbalance metamorphic test passes |
| Medium | Manual refresh double-submits | Idempotency key and active-run UI lock | ENGINE + SURFACE | Double-click/redelivery test creates one run |
| Medium | Admin cannot sign in | Confirmed allowlist configuration | joshuai | Successful production operator login |

---

## 11. Quality gates before merge

### Contract gate

- Public schemas compile and are consumed without importing another lane's internals.
- Comparative fixture expected result is signed off.
- Calculation semantics and missing-data rules are frozen.

### Data gate

- Forward migration and clean-database migration pass.
- Idempotency is proven under concurrent inserts.
- Citation foreign keys cannot dangle.
- No full HTML/page capture is stored.

### Engine gate

- Unit, contract, prompt-injection, and structured-output tests pass.
- All deterministic results replay from stored inputs/config.
- One source can safely produce multiple security observations.
- Uncited synthesis fails closed.

### Surface gate

- Fixture-backed e2e passes before integration.
- Source lineage is navigable end to end.
- Freshness, scope, coverage, route, and degraded states are visible.
- Company name appears with every ticker.
- Settings shows the active FMP-derived universe version and requires impact preview plus approval for activation.

### Integration gate

- All repository verification commands pass from a clean checkout with pinned package manager.
- Python scorer image still builds.
- Existing dashboard/ticker workflows have no regression.
- CI eval filters are exercised by an intentional RNI prompt/test change.
- One controlled live run succeeds and one failure path is demonstrated.
- The live result shows Reddit, X and combined sections; a divergence or single-source failure fixture proves no fallback occurs.
- FMP capability and current-constituent probe passes; the selected count exceeds the old 100 limit, NVDA is present, and an arbitrary sampled constituent can start an on-demand run.
- Preview/production smoke verifies auth, manual refresh, citation links, and data explorer.

### Demo honesty gate

The demo presenter must be able to answer:

- Which sources were actually sampled?
- When was the last successful refresh?
- Which model route and prompt/config versions produced this output?
- Which values are deterministic calculations versus AI interpretations?
- Why is each claim shown, and which original URLs support it?
- What is incomplete or unavailable?

If any answer is hidden or simulated, the demo is not complete.

---

## 12. Confirmed decisions and human gates

| Decision/gate | Status | Owner | Completion evidence |
|---|---|---|---|
| Isolated overnight RNI vertical slice | Confirmed | joshuai | This plan and contract-freeze PR |
| Reddit through OpenAI Web Search only | Confirmed | joshuai | No Reddit API dependency in code/env/deploy checks |
| Existing X adapter is a separate datasource | Confirmed | joshuai | Independent source-slice contract and live adapter smoke |
| OpenAI Direct default; Gateway optional | Confirmed | joshuai | Activated RNI model-route version and route-parity test |
| Merge `fix/require-ai-model-routes-live-mode` | Confirmed | integrator | Branch merged before RNI contract branch |
| Vercel, Neon and QStash access | Confirmed | joshuai | Preview health, migration and signed queue smoke |
| Production admin allowlist | Confirmed | joshuai | Successful operator sign-in |
| Active watchlist is current S&P 500; NVDA default; configurable in Settings | Confirmed | joshuai | FMP snapshot/universe version, settings screen and any-member run test |
| Bounded Reddit/X content retention | Confirmed | joshuai | Activated policy version and no-whole-page persistence test |
| MCP is contract/read-only skeleton for tomorrow | Confirmed | joshuai | MCP scope contains no production mutation tools |
| Sampled Reddit and configured-X disclosures | Confirmed | joshuai | UI/e2e disclosure assertions |
| Migration and production release authority | Confirmed | joshuai | Approval audit actor is `joshuai` |
| FMP credential and `/stable/sp500-constituent` plan entitlement | **Deployment verification required** | joshuai | Authenticated probe returns non-empty valid current constituents and is recorded in provider-call audit |

All architecture risks now have an assigned mitigation, owner and objective closure evidence. The FMP capability probe is the only outstanding external verification; failure does not activate an unverified universe. The last known good immutable universe remains visible as stale, and production promotion is blocked until the probe passes.

---

## 13. Final recommendation

Proceed with the isolated RNI vertical slice if—and only if—the team accepts the narrowed definition of completion. The existing repository's architectural controls are worth preserving. The greatest schedule risk is not coding volume; it is allowing shared definitions to drift across parallel branches.

The decisive first hour is therefore contract work:

- one source identity;
- one security identity;
- exact observation dimensions;
- exact citation rule;
- exact calculation/missing-data semantics;
- exact model-route policy;
- exact branch ownership.

Once those are frozen, the data, engine, and surface work are genuinely parallel. Without that freeze, “parallel” will mean three incompatible implementations that consume the final hours in integration.
