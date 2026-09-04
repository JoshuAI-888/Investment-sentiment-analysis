# Product Spec — Barebone Social Sentiment (LOCKED)

> **Scoped RNI addendum (2026-09-05):** this specification remains locked for the existing
> product. Within the paths and routes named by `features/RNI-00-CONTRACT.md`, that contract and
> `rni/PRD.md` take precedence: Reddit uses OpenAI Web Search, X is independent, the output has
> Reddit/X/combined sections, and the universe is the configurable current FMP S&P 500.

**Status:** Locked 2026-09-03. **Re-locked 2026-09-03** against a materially changed owner
intent — see `MEMORY.md` §1b (D-08…D-23) and `SPEC-REVIEW.md`. Changes require an entry in
`MEMORY.md` with rationale.
**Supersedes:** §1–§3 of `reference/SOURCE-PRD-v1.5.md` where they conflict.
**Derived from:** owner decisions of 2026-09-03 and 2026-09-03, and the rulings in
`00-ADVERSARIAL-REVIEW.md`.

---

## 1. The one-sentence product

A secured, single-operator web application that measures **cross-platform social attention and
narrative** on a US-equity universe — Reddit, X and Substack held as three separate axes — and
takes its operator from *"what is happening on this name right now?"* to a **source-backed,
numerically grounded, inspectable explanation** in under thirty seconds. It abstains, visibly,
when it does not have enough to say, and it distinguishes in the interface between what it
merely *describes* and what it has *validated*.

## 2. The thesis under test

**Re-locked 2026-09-03 per D-08.** The previous thesis — comprehension speed — is superseded and
retained as a *property* (Tier A criterion A1), not as the thing being proven.

> **Decision support with a falsifiable promotion path.** A measurement of cross-platform social
> attention and narrative is only worth acting on if you can tell which parts of it have been
> tested and which have not. This product measures three platforms on three separate axes, makes
> every number inspectable and reproducible, and carries an explicit, published mechanism by
> which a metric graduates from **described** to **validated** — and can fail to.

**What is being proven, in two stages (D-09):**

| Stage | Claim | Gate | When |
|---|---|---|---|
| **v1** | The measurements are accurate — stance labels match human labels, relevance is precise, the arithmetic is reproducible | Tier D1–D3 | Achievable at build time |
| **Promotion** | A given metric carries return information | Tier D4: point-in-time-correct backtest with published IC, Newey–West t and **momentum-residual IC** | ~12 months of accrued corpus (see §2.1) |

**The promotion rule, binding:**

> A metric may use predictive language **only** if a point-in-time-correct backtest with a
> published information coefficient, Newey–West t-statistic and momentum-residual IC stands
> behind it, versioned and linked from the Inspector. Every other metric carries the §6.4
> disclosure and abstains below threshold.

This is enforced structurally, not by policy: the evaluation harness sits between analytics and
presentation, so a metric without a backtest record physically cannot render predictive language.

### 2.1 The honest timing of stage two

Under D-16 collection is **forward-only** — no backfill, no archives. The corpus therefore starts
empty and accrues in wall-clock time. A cross-sectional IC at a meaningful sample size needs
roughly twelve months of dates.

**Stage two is a 2027 milestone.** It is stated here rather than implied so that "validated" does
not quietly settle into meaning "accuracy only" without anyone having decided that. Until stage
two runs, **every metric in the product carries the §6.4 disclosure**, without exception.

**What is explicitly NOT being proven:**

- That attention or narrative states predict returns — until and unless a specific metric passes
  Tier D4. That is a per-metric fact with a published record, never a property of the product.
- That the sampled stance represents Reddit, X, retail investors, or any population. Three
  sampling frames, three separate disclosures (§6.1, R-21).
- That the system is production-ready, licensed for redistribution, or operable at scale.

## 3. User and jobs

**Primary user.** An active self-directed investor following US equities. Comfortable with
price charts and news; not a quant; has no data terminal.

**Jobs to be done**, in priority order — the ordering is what the roadmap follows:

| # | Job | Served by |
|---|---|---|
| J1 | "Show me which stocks are gaining retail attention fastest." | F08 leaderboard |
| J2 | "Explain why this ticker moved up the ranking." | F11 research agent |
| J3 | "Separate the loudest narrative from the best-supported one." | F10 evidence + F11 synthesis |
| J4 | "Compare social stance with price action and news sentiment." | F06 analytics, F09 ticker page |
| J5 | "Show me exactly how this number was calculated and what changes under my assumptions." | F05 Inspector, F14 scenarios |
| J6 | "Tell me what would confirm or falsify what I'm looking at." | F11, under §6.4 disclosure |
| J7 | "Let me ask a follow-up without losing the evidence already gathered." | F11 follow-ups |
| J8 | "Give me a defensible valuation range, or tell me you can't." | F13 valuation |

**Secondary user — the operator (owner).** Needs to see what the system is doing, change the
universe and configuration safely, and know what it is costing. Served by F15/F16/F18.

## 4. Success criteria

Three tiers. **All three must pass.** Tier A alone was the source PRD's entire bar; on its
own it cannot fail on quality (`00-ADVERSARIAL-REVIEW.md` F-02).

### Tier A — Mechanical (necessary, not sufficient)

| ID | Criterion | Measured by |
|---|---|---|
| A1 | Completed research answer ≤ **30 s p95**; first progress event < **1 s** | F19 perf suite |
| A2 | Cached dashboard p95 < 2 s; ticker snapshot p95 < 3 s | F19 perf suite |
| A3 | ≥ 20 configured tickers have price context and an attention record | F19 smoke |
| A4 | Every displayed number resolves to a stored provider field or a versioned calculation | CI coverage check, F05 |
| A5 | Every deterministic value opens an Inspector artifact whose frozen replay reproduces its hash | F05 replay suite |
| A6 | Re-running against identical stored inputs yields identical deterministic metrics | F06 golden suite |
| A7 | A provider failure produces an explicit degraded state, never invented content or a blank page | F18 chaos suite |
| A8 | Personal assumptions survive sign-out, stay account-isolated, and reset to official | F14 E2E |
| A9 | Expected monthly spend < **$350** (D-20), enforced by the pre-dispatch check in §6.6 | F18 cost ledger |
| A10 | Collector uptime ≥ 99% measured weekly; any gap > 1 h is recorded as a **permanent coverage hole** and rendered (D-16) | F18, F22 |

### Tier B — Correctness (the LLM release gates, promoted)

Adopted from source §14.4 and extended. Run against the frozen evaluation corpus in F12.

| ID | Criterion | Threshold |
|---|---|---|
| B1 | Ticker relevance precision on retrieved evidence | ≥ 0.95 |
| B2 | Stance macro-F1 on relevant, non-unclear items | ≥ 0.80 |
| B3 | Material claims with no supporting evidence or metric reference | **0** |
| B4 | Displayed numeric claims that do not string-match a stored metric at display rounding | **0** |
| B5 | Thin-sample cases (n < 5) that emit a formal stance score | **0** |
| B6 | Personalized buy/sell recommendations, price targets, or certainty claims | **0** |
| B7 | Verifier catch rate on the seeded-error corpus | ≥ 0.90 |
| B8 | Verifier false-positive rate on known-good answers | ≤ 0.10 |

### Tier C — Comprehension (the thesis itself)

The product's stated outcome is an *explanation*. This tier tests the explanation.
Owner-selected method: **automated LLM judge**, built in F12, run in CI on every research
change. See `05-TEST-STRATEGY.md` §5 for the harness and `00-ADVERSARIAL-REVIEW.md` F-22 for
why it is also calibrated.

Each answer in the evaluation corpus is scored 1–5 on four axes:

| Axis | Question the judge answers |
|---|---|
| C1 Direction | Does the answer state the attention/price/stance directions the stored metrics actually show? |
| C2 Groundedness | Does each narrative claim follow from the cited evidence, judged against the evidence text only? |
| C3 Restraint | Does it avoid asserting causation, prediction, or confidence the data does not support? |
| C4 Actionability | Is "what to monitor next" specific, observable, and derived from this ticker's situation? |

**Gate:** mean ≥ **4.0** across the corpus, with **no single answer below 3** on C2
(groundedness), and zero Tier-B violations. A C2 failure is treated as a defect, not a score.

**Calibration (non-blocking, one-off):** owner hand-scores 20 answers; judge/human Spearman
correlation ≥ 0.7 or the thresholds are raised. `DEPLOY.md` MT-11.

**What Tier C does not do.** It grades the *prose about* a number. It cannot tell you the number
was right. That is Tier D's job, and Tier C without Tier D is a well-written account of an
unchecked measurement.

### Tier D — Measurement fidelity (added 2026-09-03 per D-09)

The tier that makes "validated" mean something. D1–D3 gate v1; D4 is the per-metric promotion.

| ID | Criterion | Threshold | Gates |
|---|---|---|---|
| D1 | Stance accuracy against a hand-labelled set, **per platform axis** — a single blended figure is not admissible (D-14) | macro-F1 ≥ 0.80 per axis | v1 |
| D2 | Inter-scorer stability: re-running the pinned scorer on identical stored inputs reproduces identical scores | exact | v1 |
| D3 | **Scorer provenance completeness** — every stored score carries `scorer_id` + `scorer_version`, and no series admitted to a metric mixes scorers (D-13) | 100% | v1 |
| D4 | **Promotion gate.** Point-in-time-correct backtest: cross-sectional IC, Newey–West t-statistic, decay curve, and **momentum-residualised IC** | Published, versioned, linked from the Inspector. A metric failing D4 stays disclaimed — it is not removed | per metric, ~2027 |

**D4's null discipline, adopted from the ported harness (D-18).** The evaluation must run a null
scenario that it is *required to fail*. A gate that cannot fail is not a gate
(`00-ADVERSARIAL-REVIEW.md` F-02, and finsent's own finding: a null case reached raw-IC
Newey–West t = +2.15 and was rejected only by the momentum-residual control at t = +1.44).
**Raw IC alone is not an acceptable promotion criterion.**

**D1's labelled set is not yet specified** — size, labeller and sampling method are `MEMORY.md`
OQ-7 and must be settled before F12 starts, or D1 is unmeasurable.

## 5. Scope

### In scope (all five waves)

Everything the owner elected to keep: the dashboard and composites, the attention
leaderboard, the ticker detail page, the agentic research flow with evidence and verifier,
the **Calculation Inspector across every deterministic metric**, the **DCF/peer valuation
engine**, the **governed admin control plane with the QStash dispatcher**, and the
**Architecture Explorer**. Sequenced across five waves in `03-ROADMAP.md`.

### Out of scope

Unchanged from source §2.4, plus these additions from the review:

- Hugging Face shadow evaluation and any local model runtime (F-21 — deferred to a
  post-PoV spike).
- Alpha Vantage as a systematic validator (F-09 — retained only behind `FEATURE_CONGRESS`).
- **Stocktwits:** hidden feature flag, never inferred from web snippets.
- Alerts, portfolio/broker integration, native mobile, multilingual, options flow, vector search
  in P0, Databricks/Kafka/Kubernetes.
- **Public signup, multi-tenancy, share grants, the issue queue** (D-11 — one operator).
- **Historical backfill** (D-16 — forward-only).
- **Cohort segmentation within a platform** — retail vs. institutional vs. influencer. Platform
  separation is in scope and mandatory (D-14); cohort separation is deferred.
- **The governed X account taxonomy** (D-23) — v1 is a flat watchlist plus cashtag queries.

### Newly in scope (2026-09-03)

| Item | Decision | Feature |
|---|---|---|
| X (governed watchlist), Reddit Data API, Substack RSS, delayed intraday market data | D-12 | F04 |
| **Pinned classification models in a decoupled Python service** — a named exception to the forbidden list | D-13 | **F20** |
| **MCP server and MCP Apps components**, placed immediately after F12 | D-10 | **F21** |
| **Point-in-time corpus with permanent retention and coverage-floor rendering** | D-16, D-17 | **F22** |
| Price-triggered sampling — market data moves into Wave 1 as the trigger | D-15 | F04, F08 |
| Ported evaluation harness (PIT, IC, Newey–West, momentum-residual) | D-18 | F12 |

### Deliberately deferred, with a named trigger

| Item | Trigger to reconsider |
|---|---|
| Vercel Pro | The first sustained p99 timeout. **No longer gated on a public demo** (D-11) |
| Marketaux Basic | Two consecutive days of quota exhaustion in the ledger |
| pgvector | Evidence corpus > 50k items **and** a measured retrieval-quality deficit |
| Public signup | **Out of scope** under D-11, not deferred |
| **Real-time market data** (~+$120/mo) | Any intention to act intraday off this system. No rebuild — the adapter interface is unchanged, only the tier (D-20) |
| **Governed X account taxonomy** | X exceeds 15% of scored items, or a cohort question becomes load-bearing (D-23) |
| **Sarcasm detection, long-form Substack stance** | Measured error attributable to either (D-21) |
| **F13 valuation / F14 scenario governance** | A valuation question becomes load-bearing in use, or v1 ships with capacity to spare (D-19) |

## 6. Product invariants

Binding on every feature. A PR that breaks one does not merge, regardless of its tests.

### 6.1 Honesty of coverage
- Never "all Reddit," "Reddit-wide," "live X sentiment," "consensus," or "market sentiment"
  unqualified. Use **observed Reddit sample**, **sampled social stance**, **coverage-limited**,
  **sector proxy**, **representative sampled sources**.
- Every aggregate displays its `n`, its window, and its source.
- **No scraping of X or Stocktwits, ever, under any deadline pressure.** D-16's
  forward-only ruling removes the only pressure that was ever going to test it.

**Three sampling frames, three disclosures (D-14, R-21).** The platforms are not
interchangeable and their aggregates are never blended into one stored number:

| Axis | Honest label | Disclosure it carries |
|---|---|---|
| Reddit | **observed sample of a comment population** | Subreddits polled, window, `n`. Closer to a census of a thread than to a search ranking — but still not a sample of "retail" |
| X | **watched-account sample** — never "X sentiment" | The watchlist is curated and has survivorship and paid-promotion bias. Trigger-sampled, so coverage is *event-conditional*, not continuous |
| Substack | **curated publication set** | Which publications, selected by whom, on what basis (OQ-8). A convenience sample of chosen authors |

- **A composite across axes may be displayed. It is never the stored primitive**, and it renders
  its three components alongside it.
- **Coverage floor (D-16).** Every historical view carries *"coverage begins
  {collector_start_date}"*. Where an axis started later than another — X in particular — the
  view shows the per-axis floor. **A cross-platform historical comparison that hides a coverage
  asymmetry is dishonest**, and this is the mechanism that prevents it.

### 6.2 Determinism of numbers
- **LLMs never calculate.** Returns, deltas, aggregates, shrinkage, adequacy, composites,
  technicals and valuation are pure functions with golden fixtures. No LLM import may appear
  in an analytics module; enforced by lint (F01).
- Every displayed deterministic value carries a `calculation_id` resolving to an immutable
  artifact with inputs, ordered steps, exact decimal, display rounding, provenance and hash.
- Artifacts are never recomputed in place. Fresh data creates a successor.

### 6.3 Evidence or silence
- Every material factual claim resolves to an `evidence_item` or a `calculation_id`.
- Below threshold, the system **abstains** — a stated abstention, not a hedge and not a
  smaller number. n < 5 relevant items ⇒ no stance score. n < 3 entity-tagged articles ⇒
  news sentiment is `insufficient_data`.
- Prose that fails verification is withheld; deterministic metrics still render.

### 6.4 No advice, and no implied forecast without a published backtest
**Amended 2026-09-03 per D-08/D-09.** The disclosure is now a *default state a metric can leave
by passing Tier D4*, rather than a permanent property of the product. Everything else stands.

- No personalized buy/sell, no price targets, no probability language, no "strong buy" or
  "risk-on". **These remain banned unconditionally** — passing D4 never licenses advice.
- **Every metric that has not passed Tier D4** — which today is every metric — and every
  divergence state and "what to monitor" block carries verbatim:
  *"This is a description of what is currently observable. It has not been tested against
  historical returns and is not a forecast."*
- **A metric that has passed Tier D4** may state its tested relationship, and must render its
  IC, its Newey–West t-statistic, its sample period and a link to the versioned backtest record.
  A claim without that record is a build failure, not a copy choice.
- The word "signal" stays banned in user-facing copy; "state" or "pattern" is used.
- A copy lint (F19) fails the build on the banned vocabulary, and additionally fails on
  **predictive vocabulary appearing on a metric with no D4 record** — the lint reads the method
  registry, so this is checkable rather than editorial.

### 6.7 Scoring is reproducible, and never silently substituted (D-13)
- Stance scores come from **models pinned to a commit SHA**. A hosted model whose ID can be
  retired may not produce a score that enters the corpus.
- **Collection never blocks on scoring.** A scorer outage produces an unscored backlog, not lost
  data.
- **No silent substitution.** A scorer outage renders §6.3 abstention and F18's degraded mode.
  "No stance — scorer unavailable since {ts}" is correct; a number from a different method is not.
- Every score carries `scorer_id` + `scorer_version`. **No series admitted to a metric mixes
  scorers** (Tier D3).
- Re-scoring writes a **successor artifact** (§6.2). Artifacts are never recomputed in place.

### 6.8 The corpus is permanent (D-16, D-17)
- The normalized social corpus and its derived scores are **retained indefinitely**. They are the
  asset, not retained data. Retention applies to raw provider payloads and superseded artifacts.
- Storage is governed by a **growth-rate budget in MB/month**, measured, not by a fixed ceiling.
- Full bodies are retained for Reddit and Substack. For X: Post IDs, derived scores and a bounded
  snippet, re-hydrated on demand, **with the snippet as X's canonical scoring unit** so the X
  series stays self-consistent under re-scoring.
- **A collection gap is a permanent coverage hole.** It is recorded, rendered, and never
  interpolated across (A10).

### 6.5 Least privilege and governed change
- Secrets are deployment-controlled and never editable, readable, or echoed from the browser.
- Admin authorization is checked server-side on every admin read and every mutation.
- Every configuration, universe, model-route and budget change is versioned and records
  actor, reason, before/after, environment and rollback target.
- Users and admins may edit only registered, bounded assumptions. Source data is immutable
  from every UI path.

### 6.6 Cost is bounded before the call, not after
- Every priced provider call passes a server-side budget check *before* dispatch.
- Budgets exist per account as well as globally.
- Unknown or unpriced usage is displayed as unpriced. It never renders as `$0.00`.

## 7. What "done" means for the product

The product is done when the Wave 5 release gate in `03-ROADMAP.md` passes — source §20's
Definition of Done, amended only where D-11 voids a multi-tenant item — **and** Tiers A, B, C and
**D1–D3** pass.

**Tier D4 is explicitly not part of "done."** It is a per-metric promotion that becomes runnable
roughly twelve months after the collector starts (§2.1). v1 ships with every metric disclaimed,
and that is the correct state, not a shortfall.

The product is **not** production-ready at that point, and under D-11 it is not intended to be.
Remaining: commercial display rights, licensed social coverage, deletion/takedown handling at
scale, provider SLAs, private-network infrastructure, manipulation controls, model evaluation at
scale, and operational support.

**Known permanent limitations, to be stated in the release notes:**

- **History begins at the collector start date.** There is no backfill and there will not be
  (D-16). Questions about events before that date are unanswerable by construction.
- **X coverage is event-conditional, not continuous** (D-15). Its series is a record of what was
  said around triggered moves, not of what was said.
- **X coverage began later than Reddit and Substack** if the collector start dates differ, and
  every cross-platform historical view must render that asymmetry (§6.1).
- **The stance measurement is of sampled material, not of a population** — three frames, three
  disclosures, and no amount of sample size fixes it (`00-ADVERSARIAL-REVIEW.md` F-03).
