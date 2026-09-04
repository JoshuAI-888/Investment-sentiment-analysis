# Retail Narrative Intelligence — UI Specification

**Status:** Build-ready specification  
**Audience:** product, design, frontend, QA, investment users  
**Related:** [PRD](./PRD.md), [Architecture](./ARCHITECTURE.md), [Data model](./DATA_MODEL_AND_LINEAGE.md)

## 1. Experience principles

The portal is an evidence-led research interface, not a trading terminal. It must be understandable without knowledge of agents, embeddings, prompts, or database tables.

1. Every claim has a visible route to original evidence.
2. A ticker is always shown with company name, for example `NVDA — NVIDIA Corporation`.
3. “Freshness”, “confidence”, and “sentiment” are distinct concepts and never share a badge.
4. The primary window and comparison window are always visible beside a signal.
5. Model-produced content is labelled; deterministic metrics expose their formula and configuration version.
6. Incomplete or low-coverage results are shown as such, not made visually authoritative.
7. Destructive or costly actions require an explicit scope preview.
8. Reddit and X are displayed as independent sentiment sources; a combined summary never hides either component or treats one as fallback.

## 2. Information architecture

| Route | Page | Primary user question |
|---|---|---|
| `/` | Retail Radar | What is emerging, fading, or contested now? |
| `/security/[ticker]` | Security detail | What is retail saying about this company, why, and how has it changed? |
| `/themes` | Theme explorer | Which configured themes are moving across securities? |
| `/narratives/[id]` | Narrative detail | Which independent sources support or challenge this narrative? |
| `/data` | Evidence and raw-data explorer | Exactly what source material and metadata were captured? |
| `/runs` | Runs and freshness | Is the data current, and did processing succeed? |
| `/evals` | Quality and guardrails | How reliable is the current build and where does it fail? |
| `/settings` | Admin settings | Which sources, windows, themes, thresholds, prompts, schedules, and provider route apply? |
| `/methodology` | Methodology | How are metrics and confidence calculated? |

Navigation groups: **Research** (Radar, Securities, Themes), **Evidence** (Data Explorer, Runs), **Governance** (Evals, Methodology, Settings). Hide Governance write controls from read-only users.

## 3. Global shell

### 3.1 Header

- Product name and environment badge (`Demo`, `Preview`, `Production`).
- Global security search accepting ticker or company name, with disambiguation by exchange.
- Current data-through timestamp in the user’s timezone.
- Freshness badge: `Current`, `Delayed`, `Stale`, `Refreshing`, or `Failed`.
- User menu and role.

### 3.2 Global context bar

Shown on every research page:

- Primary window selector, default `Last 24 hours (1 day)`.
- Comparison window selector, default `Previous 7 days`, with options for prior equal period, 7 days, 14 days, and admin-defined presets.
- Coverage scope: sectors, regions, watchlists, communities, source types.
- Active universe badge: `S&P 500 — FMP`, constituent count and membership retrieval/as-of time. First load selects `NVDA — NVIDIA Corporation`.
- Methodology version and a link to the methodology page.
- `Refresh` action subject to role.

Changing context updates the URL query string so views are linkable and reproducible. A historical result uses the exact saved run configuration; it is never silently recomputed under current settings.

## 4. Retail Radar

### 4.1 Summary band

Show:

- last successful refresh and data-through time;
- sources discovered, sources usable, and coverage warnings;
- securities with meaningful signal;
- emerging and fading narrative counts;
- failed or partial pipeline stages.

### 4.2 Radar table

Columns:

| Column | Behaviour |
|---|---|
| Security | Ticker, company name, exchange; links to detail |
| Reddit sentiment | Reddit-only direction, sample count, coverage, freshness and reason |
| X sentiment | X-only direction, sample count, coverage, freshness and reason |
| Combined summary | Agreement, divergence, or partial cross-source status; never an unexplained average |
| Four dimensions | Compact cells for **stock**, **company**, **trading intent**, and **theme** sentiment |
| Attention | Current weighted attention plus change versus comparison window |
| Sentiment | Index from -100 to +100; distribution on hover/focus |
| Z-score | Standard deviations from that security’s historical attention baseline |
| Confidence | Defensibility band and numeric score, never forecast probability |
| Breadth | Independent authors, communities, source types, and concentration warning |
| Why | Two cited narrative snippets; every sentence citation-linked |
| Freshness | Data-through time and state |

Default sort: publishable signals by absolute attention z-score, then confidence. Users may sort/filter by sector, region, theme, direction, confidence, freshness, source type, or watchlist.

### 4.3 Metric explanations

Tooltips and keyboard-accessible popovers use plain language:

- **Sentiment index:** evidence-weighted stance from -100 (bearish) to +100 (bullish); zero can mean neutral or balanced disagreement.
- **Attention change:** difference in weighted attention between selected windows; it is not price volume.
- **Z-score:** how unusual current attention is relative to the security’s own history. `+2` means roughly two baseline standard deviations above normal, subject to the configured robust calculation.
- **Breadth:** how widely the narrative is independently observed. Ten reposts from one source are not ten independent confirmations.
- **Confidence:** how defensible the published interpretation is given provenance, evidence quality, resolution, calibration, breadth, coverage, and contradictions. It is not expected return or probability of price movement.

## 5. Security detail

Header: ticker, legal/display company name, exchange, identifiers, aliases, current windows, freshness, and coverage warning.

### 5.1 Overview

- A three-part source summary: **Reddit sentiment**, **X sentiment**, and **Combined summary**. Each source card has its own direction, four dimensions, sample count, coverage, confidence, freshness and cited explanation.
- The combined card shows `Aligned`, `Divergent`, `Partial`, or `Insufficient`, cites both source sets when available, and never relabels a single-source result as combined.
- Attention and sentiment timelines with visible gaps; no interpolation across missing runs.
- Narrative lifecycle lane: `new`, `emerging`, `established`, `fading`, `resurgent`.
- Bull case and strongest challenger case side by side, both cited.
- Catalyst verification panel separating `verified`, `partially verified`, `unverified`, and `contradicted` claims.

### 5.2 Four dimensions

1. **Stock sentiment:** stance toward the security’s likely market performance or valuation.
2. **Company sentiment:** stance toward the business, management, products, or fundamentals.
3. **Trading-intent sentiment:** expressed intended action, timeframe, and conviction; never treated as executed position data.
4. **Theme sentiment:** stance toward configured themes associated with the security.

A source may be bullish on the company but bearish on the stock valuation. The UI must show these independently and must not collapse them into a single label without displaying the component values.

### 5.3 Evidence drawer

Selecting any metric, claim, or chart point opens the evidence drawer with:

- original-source link, host, community, author display value if captured, and post/comment ID;
- platform badge (`Reddit`, `X`, or external verification source); combined-summary citations remain grouped by platform;
- published time and precision (`exact`, `day`, `relative`, `unknown`);
- captured post or comment text only—not page chrome or whole HTML;
- capture level and capture timestamp;
- excerpt spans used for the observation;
- model output, model/version, prompt version, and review status;
- deterministic contribution and applied weights;
- catalyst sources and challenger evidence;
- `View complete lineage` link.

Deleted or unavailable originals retain the captured permitted evidence and show `Original no longer available`; they are never represented as currently accessible.

## 6. Theme explorer

The default taxonomy is admin-seeded and editable. Themes display name, description, inclusion/exclusion examples, parent, active dates, aliases, and version.

Views:

- theme heatmap by security and four sentiment dimensions;
- emerging/fading ranking by attention change and z-score;
- narrative clusters within a theme;
- evidence breadth and concentration;
- taxonomy-change impact preview.

Adding or editing a theme creates a draft taxonomy version. The UI shows a sample reclassification against a frozen evaluation set before activation. Activation affects new runs; historical classifications retain their original taxonomy version. Admins may start an explicit backfill.

## 7. Evidence and raw-data explorer

### 7.1 Purpose

This view proves what was persisted and makes source-to-publication traceability inspectable. “Raw” means the bounded source item returned by discovery—not an archived webpage.

### 7.2 Default table

Columns:

- evidence ID;
- platform/source type;
- canonical original URL;
- external post/comment ID;
- community/channel;
- title;
- author display identifier, nullable;
- source publication time plus precision;
- first discovered and captured timestamps;
- capture level (`URL_ONLY`, `INDEXED_EXCERPT`, `POST_BODY`, `COMMENT_BODY`, `TRANSCRIPT_SEGMENT`);
- text length and content hash;
- language;
- ingestion status and exclusion reason;
- mentioned securities as ticker + company;
- observation count;
- run ID and discovery provider;
- latest availability check.

Filters include source type, date, capture level, run, community, security, theme, processing state, exclusion reason, exact URL, and evidence ID. Full-text search is role-gated and redacts sensitive operational fields.

### 7.3 Source record page

Tabs:

- **Captured evidence:** returned title/body/comment/transcript segment and metadata.
- **Observations:** one row per source-security pair and sentiment dimension.
- **Claims and themes:** extracted spans, relations, and taxonomy versions.
- **Lineage:** upstream discovery call and downstream narratives, metrics, explanations, and publications.
- **Model calls:** redacted request/response envelope, model snapshot, tokens, cache use, cost, schema and prompt versions.
- **Audit:** changes, access, retention, and tombstone events.

The UI must never render arbitrary source HTML. Display captured text as escaped plain text. External links open with safe-link protections.

### 7.4 Citation interaction

Every explanation sentence has one or more numbered citation chips. Selecting a chip opens the exact supporting evidence span. Citations distinguish:

- **Primary evidence** — original forum post/comment, video/transcript, newsletter, filing, company release.
- **Verification evidence** — regulator, issuer, exchange, or reputable public news corroboration.
- **Analytical provenance** — metric/run/configuration, not a factual source.

The publish action is disabled when any factual sentence lacks an evidence relation.

## 8. Runs, freshness, refresh, and scheduling

### 8.1 Freshness model

Display four timestamps separately:

1. `last_attempt_at`;
2. `last_success_at`;
3. `data_through_at`—latest source publication time included;
4. `computed_at`—when analytics finished.

States are computed from the active SLA profile:

- **Current:** success and data-through lag within target.
- **Delayed:** within warning threshold.
- **Stale:** beyond stale threshold.
- **Refreshing:** active run with heartbeat inside lease.
- **Failed:** latest attempt terminally failed and no healthy newer run.
- **Partial:** completed with missing source/stage coverage.

### 8.2 Manual actions

The refresh menu offers:

- **Discover new evidence** — fetch sources since a selected watermark; no reclassification of old evidence.
- **Recompute analysis** — reuse immutable evidence and rerun selected downstream stages under a chosen configuration version.
- **Full run** — discover, persist, analyse, verify, evaluate, and publish.
- **Backfill** — admin-only bounded historical run.

Before submission show scope, estimated sources/model calls, estimated token/cost band, route (`OpenAI Direct` by default), configuration version, and idempotency key. Buttons become progress links, not spinners that lose state on navigation.

### 8.3 Scheduling

Admins configure cadence, timezone, active window, scope, source limits, primary/comparison windows, provider route, budget, and notification policy. Show the next five expected run times in both schedule and user timezone. Persist timezone and daylight-saving interpretation; server execution is converted to UTC.

Each schedule has `Run now`, `Pause`, `Resume`, `Clone`, and audit history. Concurrent identical scheduled/manual runs coalesce or reject with a clear reason.

## 9. Evals and guardrails UI

- Overall readiness state: `pass`, `pass with warnings`, `fail`.
- Quality scores by task: security resolution, per-dimension sentiment, claim extraction, theme assignment, narrative clustering, citation entailment, catalyst verification, challenger quality, refusal/abstention.
- Coverage and calibration charts with evaluation-set version and run date.
- Guardrail failures link to affected evidence and publication.
- AI-generated improvement suggestions are visually separated from measured scores and require human approval before changing settings.
- Regression comparison between candidate and production prompt/model/configuration.

## 10. Settings portal

Sections:

| Section | Editable settings |
|---|---|
| AI route | OpenAI Direct default; Vercel AI Gateway optional; model per task; timeout/retry/budget |
| Coverage | active FMP S&P 500 version, constituent count, retrieved/activated time, staged membership changes, sectors, exchanges, watchlists, ticker/company mappings |
| Sources | public source types, communities, allow/deny domains, retail-access and terms review status |
| Windows | primary days default 1; comparison presets; historical baseline length |
| Themes | taxonomy, aliases, examples, thresholds, lifecycle |
| Metrics | weights, winsorisation, minimum observations, z-score baseline, concentration thresholds |
| Confidence | component weights, caps, penalties, publish bands |
| Agents | versioned system prompt, schema, allowed tools, model, temperature/reasoning settings |
| Guardrails | versioned policies and publishing thresholds |
| Schedules | cadence, timezone, scope, budgets |
| Retention | source-type-specific retention and deletion policies |

All edits use draft → validate → preview impact → approve → activate. Secrets are never displayed after entry. Changing the route in Settings affects future runs only.

The universe page loads from the local security master and active/staged universe versions; rendering never fans out to FMP per row. `Sync current S&P 500` performs one governed server-side FMP constituent refresh, validates every member, and creates a draft. It shows added/removed/unresolved names, estimated Reddit/X workload, source timestamp and provider-call audit ID. Only `joshuai` can activate production. A failed or partial sync leaves the active universe unchanged.

## 11. Role model

| Capability | Viewer | Analyst | Admin |
|---|---:|---:|---:|
| View published research/citations | Yes | Yes | Yes |
| View raw bounded evidence | Scoped | Yes | Yes |
| Export cited view | Yes | Yes | Yes |
| Start bounded analysis | No | Yes | Yes |
| Recompute | No | Yes | Yes |
| Edit drafts | No | No | Yes |
| Activate prompts/policies/schedules | No | No | Yes, with approval rule |
| View costs/model envelopes | No | Scoped | Yes |

## 12. Accessibility, responsiveness, and visual integrity

- WCAG 2.2 AA target; full keyboard navigation and visible focus.
- Do not communicate bullish/bearish or freshness by colour alone; pair colour with text/icon.
- Tables have a compact desktop mode and stacked mobile cards.
- Charts include accessible tables and explanations.
- All times show timezone on hover/focus and can be switched.
- Preserve at least 4.5:1 text contrast.
- Respect reduced motion.
- Loading uses skeletons only for short reads; long jobs show durable run status.

## 13. Error and empty states

- No mentions: “No usable evidence in this scope,” not “neutral sentiment.”
- One social platform unavailable: keep the available platform result visible; mark the combined summary `Partial — [platform] unavailable`; never display fallback language.
- Reddit/X disagreement: preserve both directions and show `Sources diverge`, followed by the leading cited explanation for each platform.
- Low coverage: show which source classes failed and suppress ranking if configured minimums fail.
- Ambiguous ticker: ask the user to select security; never guess silently.
- Provider failure: show retry status and whether fallback was used.
- Citation unavailable: retain evidence ID and captured excerpt with availability state.
- Stale data: persistent page banner with last healthy run and refresh option.
- Partial run: identify exact completed and failed stages.

## 14. UI acceptance tests

1. Every ticker occurrence in research views includes company name or exposes it in the same component at narrow widths.
2. A two-ticker post opens one source record containing two security mentions and independent observation rows.
3. Every factual explanation sentence opens one or more supporting evidence spans and original URL.
4. The raw explorer never stores or renders a whole webpage/HTML document.
5. Changing the primary window changes discovery parameters for a new run; opening an old run preserves its saved window.
6. Freshness shows all four timestamps and differentiates stale, partial, failed, and refreshing.
7. Manual full run is idempotent under double submission and remains observable after navigation.
8. Schedule preview handles daylight-saving transitions correctly.
9. Non-admin users cannot activate a prompt, policy, source, or schedule.
10. Theme activation leaves historical classifications bound to their original taxonomy version.
11. Screen-reader and keyboard tests cover citation chips, table sorting, drawers, charts, and confirmation dialogs.
12. A publication with an uncited factual sentence fails both API validation and UI publication flow.
