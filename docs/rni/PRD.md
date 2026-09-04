# Retail Narrative Intelligence Demo Product Requirements

**Status:** implementation-ready specification  
**Audience:** Milford investment team, product, engineering, data, model-risk, and operations  
**Last updated:** 2026-09-04  
**Related:** [ARCHITECTURE.md](ARCHITECTURE.md), [UI_SPEC.md](UI_SPEC.md), [DATA_MODEL_AND_LINEAGE.md](DATA_MODEL_AND_LINEAGE.md), [EVALS_AND_GUARDRAILS.md](EVALS_AND_GUARDRAILS.md)

## 1. Product decision

Build an internal research portal that detects, measures, and explains retail-investor narratives for named listed securities. The demo must work on live, publicly discoverable data for a ticker chosen in the room, while making coverage limits visible. Reddit and X are independent first-class sentiment sources. It is a source-backed research accelerator, not a trading system, recommendation engine, or complete social-media surveillance product.

The governing principle is **evidence before interpretation**. Every downstream observation, narrative, metric, and explanation must resolve to a persisted source record with an original URL. A result without a valid citation path is not publishable.

## 2. Problem and users

Investment analysts currently spend time searching noisy social discussion, separating memes from theses, resolving ticker ambiguity, checking whether a claimed catalyst is real, and explaining why attention changed. The product should compress that work into an auditable signal without disguising sampled social data as a complete population.

Primary users:

- **Investment analyst:** searches a ticker, reviews retail attention and four sentiment dimensions, opens evidence, compares windows, and asks follow-up questions through the portal or MCP.
- **Portfolio manager:** scans the radar for new, accelerating, fading, bullish, bearish, and disputed narratives; expects concise explanations with source links.
- **Research administrator:** controls sources, schedules, windows, themes, models, prompts, policies, thresholds, and releases.
- **Model-risk reviewer:** inspects lineage, prompt/model versions, evals, policy decisions, and failure samples.
- **Operator:** reviews run health, freshness, cost, retries, and data-source failures.

## 3. Goals and non-goals

### Goals

1. Analyze a named ticker and display its company name on every result surface.
2. Discover relevant Reddit posts and eligible comments through OpenAI Web Search using the initial versioned subreddit policy in §3.1, and independently acquire X posts through the existing X adapter, for an exact configured window defaulting to the last 24 hours.
3. Persist the original source URL and retrieval provenance before semantic analysis.
4. Create independent observations for every resolved security in a multi-ticker source.
5. Separate stock sentiment, company sentiment, trading intent, and theme sentiment.
6. Detect attention changes, recurring narratives, sarcasm, memes, spam, low-information claims, and coordination indicators without alleging manipulation.
7. Verify catalysts using primary or credible external sources and label fact, social claim, and inference separately.
8. Make every “why” explanation clickable back to evidence.
9. Support scheduled acquisition, freshness indicators, data-only refresh, full rerun, retry, and cancellation.
10. Expose governed read and run controls through a remote MCP server compatible with ChatGPT and Claude.
11. Provide eval results and human-readable suggestions for improvement without automatically changing prompts or policies.
12. Display Reddit sentiment, X sentiment, and a combined cross-source summary separately; one source must never operate as fallback or silent substitute for the other.
13. Use a current FMP-derived S&P 500 watchlist by default, allow on-demand analysis for any active constituent, preselect NVDA on first load, and govern future membership through Settings.

### 3.1 Initial Reddit Web Search coverage policy

The initial taxonomy is configuration, not hard-coded application logic. Each source row retains its exact subreddit; analytical community clusters are a separate versioned mapping.

**Primary — continuously included in every eligible scheduled discovery:** `r/wallstreetbets`, `r/pennystocks`, `r/Shortsqueeze`, `r/stocks`, `r/StockMarket`, `r/investing`, `r/Daytrading`, and `r/TheRaceTo10Million`.

**Concentrated — ticker-specific risk/attention monitoring:** `r/Superstonk`, `r/GME`, `r/amcstock`, `r/ASTSpaceMobile`, and `r/PLTR`. `r/Superstonk` and `r/GME` map to one analytical `GME_RETAIL_CLUSTER`; their exact source communities remain distinct for provenance, counts, filters, and audit.

**Sector/ticker communities:** `r/TeslaInvestorsClub`, `r/NVDA_Stock`, `r/RKLB`, `r/UraniumSqueeze`, `r/SPACs`, and `r/weedstocks`.

**Long-horizon/portfolio communities:** `r/ValueInvesting`, `r/Bogleheads`, `r/dividends`, `r/ETFs`, and `r/SecurityAnalysis`.

Admins may add, pause, weight, or cluster communities only through a draft source-configuration version followed by validation and approval. Concentrated communities must never dominate breadth: report both exact-community breadth and cluster-adjusted breadth, and apply concentration caps. “Monitor continuously” means included in each scheduled Web Search cadence, not an exhaustive firehose claim. The build has no Reddit Data API dependency and must not contain a dormant API path presented as the production solution.

### 3.2 X coverage policy

X is a separate sentiment datasource, acquired through the repository's existing X adapter and governed source configuration. It is not a Reddit fallback, discovery substitute, or enrichment call. X keeps its own retrieval status, coverage disclosure, timestamps, source IDs, observations, narratives, metrics, freshness, and citations.

The initial X scope is an administrator-maintained watch/query set; the specification does not invent accounts or claim platform-wide coverage. X failures do not trigger Reddit acquisition and Reddit failures do not trigger X acquisition. A combined result may be produced only after the two platform slices have independently reached a terminal state.

### Non-goals

- Exhaustive Reddit firehose coverage when using OpenAI Web Search.
- Treating X as a fallback for unavailable Reddit data, or vice versa.
- Personalized investment advice, trade execution, price targets, or suitability decisions.
- Proving market manipulation or identifying people behind accounts.
- Training a foundation model on Reddit content.
- Letting an administrator inject executable code through the settings portal.
- Automatically activating model, prompt, theme, weight, or policy changes without evaluation and approval.

## 4. Success criteria

### Product measures

- 100% of published explanation claims have at least one persisted citation ID and reachable original URL.
- 100% of published observations reference a source item, prompt version, model invocation, and methodology version.
- 100% of multi-ticker gold cases produce the expected per-security observations; no source-level sentiment is copied to all tickers.
- 100% of combined summaries expose their Reddit and X components, their independent freshness/coverage, and any disagreement.
- The active universe is an immutable FMP S&P 500 membership snapshot; every constituent resolves to the security master, and incomplete synchronization cannot activate.
- 0 findings publish when a blocking guardrail fails.
- ≥95% security-resolution accuracy and ≥0.80 macro-F1 for direction labels on the approved gold set before demo sign-off.
- P95 cached ticker-page query ≤2 seconds, excluding live refresh.
- Manual run request acknowledged ≤2 seconds; progress is asynchronous.
- Scheduled runs start within the scheduler polling interval plus two minutes under normal operation.

## 5. Core user journeys

### 5.1 Scan Retail Radar

The landing page shows security ticker plus legal/company name, Reddit sentiment, X sentiment, a combined cross-source summary, effective attention, attention z-score, direction change, confidence, freshness, and cited reasons. Each platform has its own sample count, coverage and freshness. Filters cover universe, exchange, sector, community, platform, primary window, comparison window, theme, confidence, and coverage mode. Clicking a row opens the security detail page; clicking any platform reason opens evidence filtered to that platform.

### 5.2 Analyze a ticker now

1. User enters a ticker or company name and selects any security in the active S&P 500 universe. First load preselects `NVDA — NVIDIA Corporation`.
2. The form displays primary window (default 1 day), optional comparison window, independent Reddit and X source scopes, and the effective AI route. OpenAI Direct is default for RNI model tasks; authorized users may choose Vercel AI Gateway for that run.
3. The UI estimates each source scope and labels Reddit as `REDDIT_SAMPLED_WEB_DISCOVERY` and X with the actual configured adapter coverage. These labels are not interchangeable.
4. The user starts the run. The server returns a run ID immediately.
5. Progress reports discovery, persistence, analysis, verification, metrics, guardrails, and publication.
6. The completed page displays three explicit sections: `Reddit sentiment`, `X sentiment`, and `Combined summary`. Either platform can independently show `INSUFFICIENT_EVIDENCE`; the combined section never treats the available platform as evidence from the missing one.

### 5.3 Understand why

Each score card and narrative exposes a “Why” action. The drawer lists contributing observations, weight, source type, excerpt, subreddit, source time, retrieval time, original URL, catalyst corroboration, and contrary evidence. The user can traverse signal → narrative → claim → security observation → mention → source → URL.

### 5.4 Compare sentiment over time

The user chooses a primary window and either a preceding equivalent window or trailing 7/14/30-day context. Charts display effective attention, sentiment index, breadth, narrative concentration, and confidence. Every chart states denominator, sample count, coverage mode, and last refresh. The user can inspect the records behind any point.

### 5.5 Explore raw data

The Data Explorer supports governed tables/views, filters, sorting, cursor pagination, CSV export subject to role and retention policy, JSON record view, and lineage traversal. Original URLs are prominent. Raw author names are not required; default storage is a salted tenant-scoped hash when permitted.

### 5.6 Configure methodology

An administrator edits a draft version of analysis windows, source weights, sentiment thresholds, confidence weights, theme taxonomy, agent definitions, prompts, and guardrail policies. The portal validates ranges and schemas, shows affected evals, runs a regression suite, and requires a reviewer to activate the version. Existing runs remain pinned to the older immutable version.

### 5.7 Schedule and refresh

An administrator creates schedules in the portal using timezone-aware controls. The repository's QStash heartbeat reads due schedules, claims them atomically, and starts a durable workflow. Reddit and X acquisition jobs are independently observable and converge only at the combined-summary stage. Users can run:

- **Refresh data:** discover and persist new eligible source items, then process only new or changed evidence.
- **Recompute:** reuse persisted eligible source content with a selected methodology/prompt/model version; no web retrieval.
- **Full rerun:** new discovery plus complete downstream processing.

All modes require an idempotency key, show cost/scope, and preserve prior results.

## 6. Functional requirements

### FR-1 Security identity

- Every display uses `TICKER — Company legal/display name`; ticker alone is insufficient.
- Resolution uses exchange, currency, security type, active dates, and aliases.
- Ambiguous symbols such as common English words require context or user selection.
- Each observation stores the security-master version and resolution confidence.

### FR-2 Windows

- Default primary window is `[as_of - 24h, as_of)`.
- Admin may configure integer day presets; exact UTC timestamps are persisted.
- Derived windows include `previous_equivalent` and optional `trailing_context`.
- The discovery request receives timestamps, not the word “recent.”
- Replayed runs use the original `as_of`, timezone, and window boundaries.

### FR-3 Evidence-first discovery

- Discovery returns source candidates and consulted sources from the provider response.
- The ingestion boundary first upserts the URL, canonical URL, platform ID if known, retrieval query, source timestamps if known, retrieved excerpt or permitted content, content hash, retrieval trace, provider request ID, and capture status.
- Only after commit may a source ID enter the semantic queue.
- URL-only records may support coverage diagnostics but cannot support sentiment until analyzable text is persisted.
- Deleted/unavailable sources retain provenance metadata and tombstone status subject to source terms; display obeys takedown policy.

OpenAI documents that Web Search can return sourced citations, domain-filtered results, and the complete consulted `sources` list. The implementation must request and store `web_search_call.action.sources`; it must not infer or fabricate URLs. See [OpenAI Web Search](https://developers.openai.com/api/docs/guides/tools-web-search).

### FR-4 Multi-security semantics

- A source creates zero-to-many `security_mention` records.
- A resolved mention creates one `sentiment_observation` per applicable fixed dimension.
- Direction and magnitude are independently classified for each security.
- Comparative language creates directed relationships such as `PREFERRED_OVER`, `LESS_ATTRACTIVE_THAN`, `LONG_SHORT`, `BENEFICIARY_OF`, `COMPETITOR_OF`, `SYMPATHY_PLAY`, or `CORRELATED_WITH`.
- Theme sentiment may be shared while stock/company sentiment differs.

### FR-5 Fixed dimensions and configurable themes

Fixed methodology dimensions are:

1. **Stock sentiment:** attractiveness of the security at the referenced price/time.
2. **Company sentiment:** view of business quality, execution, management, products, or fundamentals.
3. **Trading intent:** expressed or implied buy/sell/hold/short/options behavior.
4. **Theme sentiment:** view of a named macro, sector, technology, or market theme as connected to the security.

Admins may add, rename, nest, synonymize, disable, and threshold theme definitions. Theme edits create a version and can trigger a scoped reclassification. Fixed dimensions can change only through a methodology-version release.

### FR-6 Noise and independence

- Per-source semantic labels: sarcasm probability, meme probability, spam probability, investment-information score, assertion strength, and evidence quality.
- Duplicate/near-duplicate claims are grouped using content hashes and embeddings.
- Repeated statements in one narrative count as attention but not as independent theses.
- Coordination is reported only as `LOW|MEDIUM|HIGH` indicators with the contributing features. The UI must state that high risk does not prove manipulation.

### FR-7 Deterministic analytics

Counts, effective attention, sentiment indices, attention change, velocity, z-score, breadth, concentration, confidence, and policy decisions are pure functions over persisted inputs. Formulas and parameters are in [DATA_MODEL_AND_LINEAGE.md](DATA_MODEL_AND_LINEAGE.md). Each metric stores code version, methodology version, inputs, and calculation trace.

### FR-8 Catalyst verification and challenger

- Social claims are checked against company investor relations, SEC EDGAR, exchange/regulator sources, and configured credible news/data providers.
- Evidence is labeled `VERIFIED_FACT`, `SOURCE_CLAIM`, `ANALYTICAL_INFERENCE`, `CONTRADICTED`, or `UNVERIFIED`.
- A challenger stage must surface the strongest contrary evidence or explicitly record that none was found within scope.
- Lack of contrary evidence is not proof the thesis is correct.

SEC exposes unauthenticated submissions and XBRL company-facts APIs suitable for primary-source verification; the deployment must still comply with SEC fair-access guidance. See [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces).

### FR-9 Explanations and citations

- Synthesis receives only approved metric records and a citation manifest.
- It cannot alter rankings or metric values.
- Each factual or source-derived sentence references one or more citation IDs.
- A deterministic validator verifies IDs, tenant access, source existence, URL presence, claim support links, and allowed evidence status.
- Unsupported sentences are removed or the finding is withheld; retries cannot silently relax the policy.

### FR-10 Routing

- Tenant default is `OPENAI_DIRECT`.
- Admin setting may enable `VERCEL_AI_GATEWAY`; authorized users may override per run.
- Route, provider, model, capability profile, prompt version, token usage, cached tokens, latency, cost where available, and request ID are immutable run metadata.
- Gateway failover is disabled for eval baselines unless explicitly testing failover; production fallback must record the actual provider/model.

### FR-11 Runs and freshness

- Run states: `QUEUED`, `DISCOVERING`, `PERSISTING`, `ANALYSING`, `VERIFYING`, `CALCULATING`, `GATING`, `PUBLISHED`, `PARTIAL`, `FAILED`, `CANCELLED`.
- Freshness is computed independently for acquisition, analysis, and publication.
- Failed sources and stale signals are visible; last-success time must never be replaced by last-attempt time.
- Manual operations require role checks, rate limits, and audit log.

### FR-12 Settings and governance

Portal settings include source set, windows, schedule, route/model profiles, agent prompt drafts, tool allowlists, theme taxonomy, source and community weights, metric parameters, confidence weights, policy definitions, freshness thresholds, retention, and export permissions.

Universe settings include the active FMP S&P 500 snapshot, membership source/retrieval time, staged additions/removals, eligibility failures, constituent count, estimated acquisition impact and rollback. Activation creates a new immutable universe version and requires approval; historical runs retain their original version.

All settings are typed, range-validated, versioned, diffable, attributable, reversible by activating a previous version, and subject to separation of duties. Free-form prompts are allowed only in draft; activation requires eval gates. Policy rules use a constrained expression model, not SQL or JavaScript.

### FR-13 Evals

- Dashboard shows overall and slice metrics, confidence intervals where practical, baseline delta, cost, latency, failures, and data/model/prompt versions.
- Suggestions cite the failure clusters that motivated them and propose a draft change or new gold examples.
- Suggestions never self-activate.
- Full requirements are in [EVALS_AND_GUARDRAILS.md](EVALS_AND_GUARDRAILS.md).

### FR-14 MCP

- Remote Streamable HTTP server with OAuth 2.1 and scoped access.
- Read-only tools are enabled by default; run and administration tools require explicit scopes and client approval.
- All explanatory responses include evidence resource links and original URLs.
- Contract is defined in [MCP_SPEC.md](MCP_SPEC.md).

## 7. External data requirements

| Data | Demo source | Production source | Purpose and caveat |
|---|---|---|---|
| Reddit discovery | OpenAI Web Search restricted to configured communities | OpenAI Web Search or another explicitly approved non-Reddit-API public-search source | Search is sampled and not a firehose. The product does not depend on Reddit Data API access. |
| X sentiment | Existing repository X adapter and configured watch/query set | The same governed X datasource or a separately approved X provider | Independent sentiment slice with its own provenance, coverage, rate limits and freshness; never a Reddit fallback. |
| Security master | Seeded public/retail-accessible list | Public exchange/issuer/regulator identifiers plus a reviewed retail-accessible product if needed | Resolves ticker, exchange, legal name, CIK/LEI/FIGI, aliases, and corporate actions. |
| S&P 500 membership | FMP [`/stable/sp500-constituent`](https://site.financialmodelingprep.com/developer/docs/stable/sp-500) | Same endpoint with authenticated entitlement and recorded freshness | Default configurable watchlist. Response must be complete, validated and versioned before activation; FMP is the membership source, not a sentiment source. |
| Regulatory filings | SEC EDGAR for US issuers | SEC plus relevant non-US regulators | Primary catalyst verification. |
| Company announcements | Public investor-relations pages/RSS | Same, with retail-accessible aggregation if approved | Primary-source announcements and earnings materials. |
| News | OpenAI Web Search with a public publisher allowlist | Public/retail subscription sources whose terms permit the use | Corroboration; paywall, citation, and redistribution limits remain visible. |
| Prices/volume | Public delayed data or a retail-accessible API | Reviewed retail product/API obtainable by an individual | Price context, abnormal move, and event alignment; social sentiment is never a price forecast. |
| Short interest/options | Public FINRA/exchange data or omit | Reviewed public/retail source only | Validates squeeze/options claims; timestamps and publication lags must be visible. |
| FX/calendars | Static/public exchange calendars | Public or retail-accessible reference source | Normalizes market sessions and currencies. |

## 8. Coverage and disclosure contract

Every platform slice carries its own coverage record. Initial values include:

- `REDDIT_SAMPLED_WEB_DISCOVERY`: public Web Search sample; no completeness claim.
- `X_CONFIGURED_SAMPLE`: evidence returned by the configured X adapter/watch set; no platform-wide completeness claim.
- `RETAIL_API_PARTIAL`: approved retail-accessible API with known endpoint/rate/window limitations.
- `USER_PROVIDED`: uploaded or pasted evidence.

Radar rankings may compare only records with compatible platform, coverage mode, and windows. Combined summaries carry both component coverage records and must not invent a single blended completeness claim. The UI must state: “Retail discussion is noisy opinion. Reddit and X coverage may be incomplete and differ. Findings are research leads, not investment advice.”

## 9. Acceptance scenarios

### A. Live named ticker

Given an active configured ticker and a one-day window, when an analyst runs analysis, then the portal persists at least the discovery trace and original URLs before classification, displays the company name, and publishes only cited findings or `INSUFFICIENT_EVIDENCE`.

### B. Multi-ticker comparison

Given “Broadcom is the better company but AVGO is expensive; I would rather buy NVDA calls,” then one source item produces AVGO and NVDA mentions; AVGO company sentiment may be positive while AVGO stock sentiment is negative; NVDA trading intent is positive; the relationship is `NVDA PREFERRED_OVER AVGO`; all objects trace to the same URL.

### C. Sarcasm

Given “LULU should pivot to AI leggings 🚀,” then sarcasm/meme probability is high, investment-information score is low, and its effective weight is below the configured threshold even if literal lexical sentiment is positive.

### D. Unsupported explanation

Given synthesis output with a citation ID that is absent or does not support the sentence, the citation validator fails and publication is blocked.

### E. Schedule and retry

Given two scheduler heartbeats for the same due time, an atomic claim and idempotency key create one run. A failed retry does not duplicate source, observation, or metric rows.

### F. Route parity

Given the same frozen evidence and prompt/model capability profile, OpenAI Direct and Vercel AI Gateway outputs both validate against the same schema and lineage tests; actual route/provider metadata remains distinguishable.

### G. Honest failure

Given unavailable sources or too few observations, the portal shows coverage gaps, last successful refresh, failed-source count, and withheld signal reason without inventing a rank.

### H. Independent X and Reddit results

Given Reddit is bullish and X is bearish for the same security and window, the portal shows both platform results unchanged and the combined summary says the sources disagree, with separately labelled citations. Given one platform fails, the other remains visible, while the combined summary is marked `PARTIAL_CROSS_SOURCE` and names the missing platform; no fallback occurs.

### I. Current configurable S&P 500 universe

Given a valid authenticated FMP constituent response, synchronization resolves every member to the canonical security master, records the provider response hash and retrieval time, and stages a new immutable universe version. Activation requires an impact preview and `joshuai` approval. An empty, partial, duplicate, ambiguous or over-ceiling response leaves the prior active universe unchanged. Any activated member can be analysed on demand; NVDA is the initial UI selection.

## 10. Release gates

- Legal approval for source acquisition and retention.
- Security review for authentication, RLS, secrets, MCP OAuth, SSRF, prompt injection, and exports.
- Required eval thresholds pass on frozen gold and adversarial sets.
- Live smoke run succeeds for at least three known tickers and one intentionally sparse ticker.
- Restore, rollback, scheduler idempotency, and source-takedown drills succeed.
- `ARCHITECTURAL_REVIEW.md` has no unowned critical finding.
