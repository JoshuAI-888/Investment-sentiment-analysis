# Spec Review — `barebones/` against the finalised intent

**Written 2026-09-03.** Reviews `docs/` (nine documents, 19 feature specs) against the
intent captured in `APPROACH-COMPARISON.md` §0. Companion to that report: it said *which*
approach; this says *what has to change in the spec package* to build it.

**Posture:** hostile, in the same spirit as `docs/00-ADVERSARIAL-REVIEW.md`. The goal
is to find the places where the current specification would produce a build that fails against
the *new* intent — not the intent it was written for.

**Status of every finding here:** proposed. Nothing in `docs/` has been changed. The
decision register in §7 is what needs owner answers before the specs are edited.

---

## 0. What changed since the spec was locked

`docs/` was locked on 2026-09-03 against a coherent, well-defended product intent:
**comprehension speed** (D-03). Six days later the owner stated a different intent. The spec
package is not wrong; it is answering a different question.

| | Intent the spec was locked against (D-03) | Intent stated 2026-09-03 |
|---|---|---|
| Thesis | Compress 5–20 min of stitching into <30 s | Institutional-grade, validated sentiment measurement |
| Prediction | Explicit non-goal; banned in copy; lint-enforced | "Validated" is the load-bearing word |
| Sources | Reddit (via proxy + search), news, market | X + Reddit + Substack, primary APIs |
| Time | Now, forward-only | Now **and** historical events |
| Surface | Next.js web dashboard | Claude MCP first; micro-UI; designed tool surface |
| Users | Open signup, multi-tenant, admin plane | One person |
| Market data | FMP Starter (EOD) | Real recent intraday |
| Budget | <$50/mo (Tier A criterion A9) | $100–1,000/mo |

Seven of eight rows moved. That is not a spec amendment; it is a re-lock of D-03 and everything
downstream of it.

---

## 1. Business intent review

### 1.1 What this actually is

A **single-user research instrument**. No revenue, no customers, no SLA obligation, no
counterparty. The only return is *better decisions by one person*. That has three consequences
the spec package does not currently reflect:

1. **The cost is real and should be stated as one number.** ~$420–910/month of subscriptions
   plus 180–240 hours of build. At the midpoint that is **~$8,000/year plus ~200 hours**. The
   spec's Tier A criterion A9 ("expected monthly spend < $50") is now off by an order of
   magnitude and should be replaced by a budget the owner actually chose, not inherited.

2. **There is no second user to be protected from you, and no you to be protected from second
   users.** Roughly 50–70 hours of the 180–240 exists to defend a multi-tenant threat model
   (F-04's open-signup cost liability, OTP throttling, per-account budgets, share-grant
   revocation, the ~20-surface admin plane, MT-10's legal review). See §3 W6.

3. **The falsification test is the whole product.** An instrument that cannot return "this
   doesn't work" is a confirmation device. `finsent` is the only artifact in the repository with
   one, and it has already used it — the null scenario reached a raw-IC Newey–West t of +2.15
   and was rejected by momentum-residual IC at t = +1.44. That discipline is what "institutional
   grade" means, and it is currently absent from `barebones/`.

### 1.2 The question the spec cannot answer for you

**What decision would you make differently?** The spec's success criteria measure latency,
traceability, stance F1 and explanation quality. None of them measures whether the system
changed an action. For a personal research instrument that is the only measure that matters, and
it is the one criterion a spec cannot write for you.

Related, and harder: **the original thesis may still be the right one.** D-03 chose comprehension
speed over alpha for a defensible reason — alpha requires a backtest, and a backtest requires a
corpus you do not have. If the honest answer to "what decision would you make differently" is
"I'd understand a move faster," then D-03 was correct and most of §7's decisions collapse into
"build what's specced, add Substack." That possibility is not rhetorical; it should be tested
before 200 hours are committed.

### 1.3 Build vs. buy, stated honestly

At $700/month the market does not sell what is described here. Licensed cross-platform social
sentiment with an inspectable calculation trail and an MCP surface is not a product you can
purchase; ICE Reddit Signals and the enterprise listening suites are quote-priced institutional
products well above this budget, and none of them expose an agent tool surface. **The build case
survives.** What does not survive is a claim that building is *cheaper* — it is roughly
$8k/year either way. It is chosen for fit and control, not economy.

### 1.4 Maintenance drag

Eight provider adapters, a 27-table schema, a pinned model runtime and a historical corpus is a
system with ongoing maintenance load, owned by one person who is also its only user. The X API
changed its read cap between the research note being written and this review. Reddit closed
self-service API registration in late 2025. **Budget for maintenance explicitly**, or the
instrument decays into a dashboard showing stale numbers with a confident provenance trail —
which is worse than no dashboard.

---

## 2. The three findings that reshape the build

### FIND-1 — MCP delivery dissolves the enforcement boundary the trust architecture depends on

**This is the most important finding in this review.**

`barebones/` enforces honesty at the **render boundary**. The server decides what prose reaches
the user: §6.3 withholds prose that fails verification (`verification_failed`); §6.4 mandates a
verbatim disclosure line on every divergence state; F19's copy lint fails the build on banned
vocabulary. Every one of those controls assumes the system owns the last mile.

**An MCP server does not own the last mile.** It returns tool results to a host it does not
control, and the host's model writes the prose. Concretely, against the current spec:

| Control | On the web surface | On the MCP surface |
|---|---|---|
| §6.4 disclosure line, verbatim | Enforced — emitted by the method | **Advisory.** The model may paraphrase or omit it |
| Copy lint bans "signal", price targets | Fails the build | **Cannot lint the host's output** |
| Prose withheld on verification failure | Enforced — server withholds | **Nothing to withhold.** The model already has the data |
| Tier B4 "numeric claims must string-match a stored metric" | Measurable, gate-able | **Unmeasurable in production** |
| §6.3 abstention | Enforced | Partly — see mitigations |

Four mitigations exist, in descending strength:

1. **The model can only quote numbers it was given.** If tools return computed metrics with a
   `calculation_id` and *never* return raw corpora the model could aggregate itself, fabricating
   an aggregate is structurally hard. This is enforceable and it is the strongest control
   available. It has a design consequence: `list_supporting_evidence` must return *bounded,
   already-classified* items, never a bulk text dump.
2. **Abstention still works.** A tool returning `insufficient_data` gives the model nothing to
   embellish. §6.3 survives the transition largely intact.
3. **MCP Apps restores a render boundary for the numbers.** A `ui://` resource is *your* HTML,
   rendered by the host in a sandboxed iframe. The disclosure line, the `n`, the window, the
   coverage caveat and the "selected by relevance, not a representative sample" sentence are in
   markup you control. **This is why MCP Apps matters for more than aesthetics: it is the
   compliance mechanism that makes MCP delivery compatible with §6.1 and §6.4.** It does not
   constrain the model's surrounding prose, only the rendered artifact.
4. **Carry the constraints in the payload.** Every tool result includes structured
   `coverage`, `n`, `window`, `limitations[]` and `must_not_claim[]` fields. Advisory, but it
   makes the honest reading the path of least resistance.

**The resolution that keeps both:** build F11's server-side synthesis and verifier anyway — not
as the usage path, but as the **evaluation path**. The web app becomes the test harness that
measures whether the tool surface *can* be used honestly (Tier B and Tier C run against it in
CI), while MCP is how you actually use it. That preserves every measurement in the current spec
and costs nothing extra, because F11 and F12 were already budgeted.

### FIND-2 — A hosted LLM classifier cannot back a historical series

The spec makes the LLM the sole stance engine (R-19 cut the Hugging Face path; F10 §4.4 batches
one structured call per pack at temperature 0). `02-ARCHITECTURE-CONTRACTS.md` §1 lists as
**forbidden in P0**: "any Python service, any local model runtime."

That is defensible for a forward-only, comprehension-speed product. It is not defensible for
this one, for a reason that has nothing to do with cost:

**A historical sentiment series must be recomputable, and it cannot be if the classifier is a
hosted model that gets deprecated.** Model IDs retire. When the model behind your 2026 scores is
gone, your 2026 scores cannot be reproduced, cannot be re-derived under a corrected method, and
cannot be compared like-for-like with 2027 scores computed by its successor. Every
`CalculationArtifact` in the corpus becomes unverifiable at exactly the moment you most need it —
when a backtest asks whether the series means anything.

FinBERT pinned to a commit SHA is reproducible indefinitely. So is Twitter-RoBERTa. Note that
`conf/config.yaml` in `finsent` already has the right shape (`model_revision`) and the wrong
value (`PINNED_COMMIT_SHA`, still a literal placeholder — a live defect).

So the "forbidden in P0" line has to break. Three ways to break it, in order of preference:

| Option | Cost | Reproducible | Fits Vercel |
|---|---|---|---|
| **(a) Small Python inference service** (Fly/Railway/Modal), pinned SHAs | ~$10–30/mo | ✓ Fully | Separate service; breaks §1 |
| (b) ONNX / transformers.js in the Node runtime | $0 | ✓ Fully | Cold starts, memory pressure |
| (c) Hosted inference API with pinned model versions | ~$20–50/mo | ~ Depends on the vendor's retention | ✓ |

Recommendation: **(a)**, with the LLM retained for *investigation and narration only* — which is
also the research note's core principle and what keeps the Claude line item at $50–200 rather
than $500+.

Secondary consequence: this is the second reason to keep a server-side path (FIND-1 was the
first). The classifier service is infrastructure the MCP server needs regardless of surface.

### FIND-3 — Your budget buys a spike detector, not an intraday gauge

"Near real time" needs a number, and the number is set by X's pay-per-use price, not by choice.

At **$0.005 per Post read**, with ~21 trading days/month, and assuming ~40% discarded to
spam/bot/off-topic filtering (the research note flags X's spam exposure as high):

| X budget/mo | Reads/mo | Usable/trading day | 30 tickers | 10 tickers | 5 tickers |
|---|---|---|---|---|---|
| $150 | 30,000 | ~860 | 29/day | 86/day | 172/day |
| $300 | 60,000 | ~1,710 | 57/day | 171/day | 342/day |
| $400 | 80,000 | ~2,290 | 76/day | 229/day | 457/day |

Now bucket a 6.5-hour session, against the spec's own `n ≥ 5 ⇒ stance score` threshold (§6.3):

| Bucket | 30 tickers @ $300 | 10 tickers @ $300 | 5 tickers @ $300 |
|---|---|---|---|
| Daily | 57 ✓ | 171 ✓ | 342 ✓ |
| Hourly | 8.8 ~ | 26 ✓ | 53 ✓ |
| 15-minute | 2.2 ✗ abstains | 6.5 ~ | 13 ✓ |
| 5-minute | 0.7 ✗ | 2.2 ✗ | 4.4 ✗ abstains |

**Three readings of this table, all uncomfortable:**

1. **5-minute intraday X sentiment is not purchasable at this budget for any universe.** Not
   "expensive" — arithmetically unavailable at a sample size that clears the spec's own
   abstention threshold.
2. **You choose two of three: broad universe, intraday resolution, statistical adequacy.** The
   budget fixes their product. This is the single hardest constraint in the plan and it is not
   negotiable by engineering.
3. **Posts are not uniformly distributed** — they cluster hard around news. So the flat averages
   above overstate quiet tickers and understate active ones. Most buckets on most tickers will
   correctly abstain.

Reading (3) is actually the good news, and it points at the right product shape:

> **The interesting instrument is not a continuous intraday sentiment line. It is a spike
> detector.** Most of the time there is nothing to say, and the abstention machinery already
> specced is doing exactly the right work by saying so. `explain_spike` — already in the research
> note's tool list — is the correct primary tool.

And it yields an architecture that follows directly from the cost structure:

> **Price-triggered social sampling.** Polygon.io Stocks Advanced gives real-time SIP with
> *unlimited* API calls at a flat $199/month. Volume and price moves are therefore free to watch
> continuously. Spend scarce X reads only when Polygon says something is happening. Reddit
> (100 QPM, free non-commercial) and Substack RSS (free) poll continuously because they cost
> nothing to poll.

Three sources, three cost structures, three collection strategies:

| Source | Cost shape | Strategy |
|---|---|---|
| Reddit Data API | Free, abundant (100 QPM ≈ 144k queries/day) | Poll broadly and continuously |
| Substack RSS | Free, slow (publication cadence) | Poll on a daily-ish schedule |
| X API | $0.005/read, scarce | **Sample on trigger only** |
| Polygon.io | Flat $199, unlimited calls | Poll continuously; it is the trigger |

That is a materially different collector design from anything in the current spec, and it is a
5–10× efficiency gain on the X line item.

---

## 3. What is weak

Ordered by how much it costs to leave unfixed.

| # | Weakness | Where | Consequence |
|---|---|---|---|
| **W1** | **The thesis no longer matches the intent.** D-03 locks "comprehension speed" and explicitly rejects signal/alpha because backtesting is a non-goal. Tier C measures explanation quality. | `MEMORY.md` D-03, `01-PRODUCT-SPEC.md` §2, §4 Tier C | The entire success-criteria structure measures the wrong thing. Must be re-locked first; everything else is downstream |
| **W2** | **The source stack is a proxy stack.** ApeWisdom is unlicensed, SLA-free, scans its own unstable subreddit list. Linkup is a search engine pointed at reddit.com. Neither is a primary source | `MEMORY.md` R-03, F04, F10 | F-05's ruling — "accept the dependency; there is no licensed alternative at this budget" — **is now false.** The Reddit Data API free non-commercial tier exists and the owner qualifies. That ruling should be reversed, not amended |
| **W3** | **No historical capability, by construction.** MT-08 requires 14 days of warm-up; retention is ≤500-char snippets "as retrieved, never re-fetched"; backfill is an explicit non-goal | `DEPLOY.md` MT-08, F10 §4.1, `01-PRODUCT-SPEC.md` §7 | I3 is impossible as specced, and it is the one thing that cannot be retrofitted. Either the corpus was captured or it wasn't |
| **W4** | **No X. No Substack.** X/Stocktwits are hidden flags and "live X sentiment" is in the copy lint's banned list. Substack appears zero times in the entire package | `01-PRODUCT-SPEC.md` §5, §6.1 | Two of the three platforms asked for are absent, one of them banned |
| **W5** | **The stance number rests on the weakest possible input** — 5–12 relevance-ranked search snippets. F-03 correctly rules this is not a sample from any population | F-03, F10 §4.1 | With the Reddit API you get actual comment trees, scores and timestamps. The F-03 problem does not disappear but it becomes tractable, and the current design forecloses the fix |
| **W6** | **Multi-tenant machinery for a single user.** F02's threat model (open signup → unmetered spend), OTP throttling, `pending` tier, per-account budgets, share grants, issue queue, ~20 audited admin mutation surfaces, MT-10 legal review | F02, F14, F15, `DEPLOY.md` MT-09/MT-10 | **~50–70 h of ~180–240 h** defending against a threat that does not exist. But see R4: parts of this are reproducibility infrastructure and must survive the cut |
| **W7** | **No intraday market data.** FMP Starter is not that, and Marketaux is news | F04 §4.3, `02-ARCHITECTURE-CONTRACTS.md` §1 | I5 unserved. Polygon closes it at $199/mo — but that alone is 4× the entire A9 budget |
| **W8** | **The abstention thresholds are calibrated to the old sampling regime.** `n ≥ 5 ⇒ stance`, `n ≥ 3 ⇒ news sentiment`, `n_eff ≥ 8` were set against a 5–12 snippet budget | §6.3, F-03, F-08 | Against real Reddit volume `n ≥ 5` is met trivially and stops protecting anything; against X at 15-minute resolution it abstains almost always. **A threshold calibrated to one sampling regime is meaningless in another** and all three need re-deriving |
| **W9** | **The 27-table schema was designed for the old source set.** Adding three platforms, full-body retention, PIT bitemporality and a backfill corpus is not a migration | `02-ARCHITECTURE-CONTRACTS.md` §5, F03 | The ingest half is a redesign. The *conventions* (surrogate keys, bitemporal, decimal-as-numeric, append-only) are all correct and survive |
| **W10** | **No fixture strategy for social streams.** `PROVIDER_MODE=fixture` is excellent for request/response APIs. Recording a fixture for "the X firehose over a watchlist" or a paginated Reddit comment tree is a different problem | F04 §4.2, `05-TEST-STRATEGY.md` | CI determinism is a headline strength of the package and it silently does not extend to the new sources |
| **W11** | **Tier A criterion A9 (`< $50/mo`) is now wrong by 10–20×**, and it is a *gate* | `01-PRODUCT-SPEC.md` §4 A9 | Left as-is it fails on day one. Replace the number; **keep the discipline** (§6.6 pre-dispatch budget check), which matters *more* now that X charges per read |
| **W12** | **Aggregating three platforms into one number is not meaningful.** A Substack essay, a WSB comment and a FinTwit cashtag post are different kinds of evidence with different sampling frames | Implied by §8.2 arithmetic, F06 | Averaging them produces a number that means nothing. Note this is *platform* separation, distinct from the cohort question the owner deferred |

---

## 4. What is unclear — needs an owner answer

| # | Question | Blocks | Why it cannot be defaulted |
|---|---|---|---|
| **U1** | **What does "validated" have to mean?** Reproducible? Classification-accurate? Return-predictive? | Everything | Three different products, three different costs, three different failure modes. §7 D-09 |
| **U2** | **How far back is "historical"?** Weeks / months / multiple years | Storage design, retention, backfill sources, §6.1 | Weeks changes nothing. Years means Arctic Shift for Reddit, archive crawling for Substack, and **X forward-only** — an asymmetry that must be visible in every cross-platform historical view or the comparison is quietly dishonest |
| **U3** | **What is "near real time" in minutes?** | Collector cadence, X spend, abstention thresholds | See FIND-3. The answer is constrained, not free |
| **U4** | **Universe size?** | X spend, temporal resolution, storage | FIND-3: universe × resolution × adequacy is a fixed product |
| **U5** | **Is the web dashboard still wanted, or is MCP the product?** | Roadmap order, ~34–46 h of Wave 2 | §7 D-10 |
| **U6** | **Single user forever, or might someone else use it?** | ~50–70 h | §7 D-11. "Maybe later" is the expensive answer; it means building for two |
| **U7** | **"Institutional grade" — methodological or operational?** | Infrastructure choices | PIT correctness, look-ahead prevention and published IC are ~free once designed in. Uptime, redundancy and SLA are not, and are hard to justify for one user. If Neon's free tier is down mid-session, is that a defect or a Tuesday? |
| **U8** | **Hours per week?** | Cut line | 180–240 h at 10 h/wk is 18–24 weeks. At 5 h/wk it is a year, and the cut line in `03-ROADMAP.md` §4 must be re-ordered and applied *now*, not on overrun |
| **U9** | **Is the scraped-archive route acceptable?** Arctic Shift / PullPush are archives of scraped Reddit data | Historical backfill | **Closed by D-16** — forward-only collection rules out historical backfill by any means. Live Reddit scraping is now permitted; §6.1's scraping prohibition for Reddit has been lifted |
| **U10** | **Cohort segmentation** — the owner said "aggregate first." Does that apply to *platforms* too? | Schema | It should not. Platform separation is nearly free now and a schema migration later. §7 D-14 |
| **U11** | **`finsent`: kill, port the harness, or keep Databricks running?** | ~0 vs ~20 h vs ongoing cost | The harness is pure pandas/numpy and ports cleanly. Databricks for one person is hard to justify |
| **U12** | **If validation returns NO-GO, do you stop?** | Whether §7 D-09 means anything | If the answer is no, you do not want validation, you want confirmation — and you should skip Stage 4 and save the 3–4 weeks honestly rather than build a gate you will override |

---

## 5. What needs refinement

| # | Item | Refinement |
|---|---|---|
| **R1** | **Tier C (the LLM judge)** measures explanation quality — correct for D-03, insufficient for the new thesis | Keep it (it still tests the narration layer) and **add a Tier D: measurement fidelity** — stance accuracy against a labelled set, inter-source agreement, and eventually IC. Tier C without Tier D grades the prose about a number nobody checked |
| **R2** | **`sample_adequacy` (R-01)** was designed for one sampling frame | Extend to three, each with its own honest label: Reddit = *observed sample of a comment population*; X = *watched-account sample*, never "X sentiment"; Substack = *curated publication set*. The F-03 discipline is right; it now has to be applied three times with three different caveats |
| **R3** | **Retention policy** (≤500 chars, as retrieved, never re-fetched, no backfill) | Split by source and by rights. Reddit and Substack: full bodies, own-collected, personal use. **X: store Post IDs + your derived scores + a bounded snippet, and re-hydrate on demand** — that is the compliant pattern under X's developer terms and it also happens to be the cheap one |
| **R4** | **The W6 cut must distinguish two things that look alike** | *Multi-tenancy* infrastructure (signup, OTP throttle, per-account budgets, share grants, account isolation) → cut. *Reproducibility* infrastructure (config versioning, universe versioning, audit trail with actor and before/after, rollback target, frozen config per run) → **keep in full.** It is not admin polish; it is what lets you answer "what produced this number in March" |
| **R5** | **`03-ROADMAP.md` §4 cut line** is ordered for the old product | Re-order against the new intent. Under MCP-first, F07/F09 move up the cut list and F13/F14 come into question |
| **R6** | **`MethodRegistry` gains a third consumer** | It currently drives the Inspector, the formula catalogue, the assumption validator and the Architecture Explorer. Add: **the MCP tool catalogue.** That needs JSON Schema (not just zod), a `whenToUse` field with selection semantics, and worked examples — which is I7 solved structurally rather than by prompt engineering |
| **R7** | **Tier A A1 (30 s p95)** was a web-streaming budget | On MCP the host has its own timeout behaviour and the 2026-07-28 RC's Tasks extension exists precisely for long-running work. Re-derive the latency budget per surface |
| **R8** | **`finsent`'s `model_revision: "PINNED_COMMIT_SHA"`** is still a literal placeholder | A live reproducibility defect in the artifact that sells reproducibility. Set it before anything is computed that you intend to keep |

---

## 6. SWOT, recomputed against the finalised intent

The SWOTs in `APPROACH-COMPARISON.md` §7 evaluated each artifact on its own terms. This
re-scores them on one question: **how much of it survives contact with the stated intent?**

### barebones — adopt the contracts, replace the product

| | |
|---|---|
| **Strength that survives intact** | `CalculationArtifact`, `MethodRegistry`, decimal-only analytics, hash-verified frozen replay, abstention as a first-class state, pre-dispatch budget checks, per-feature DoD, the `ProviderResult<T>` adapter contract, the fixture/live-smoke split. **This is the part you cannot retrofit and the reason to adopt it at all.** |
| **Weakness that is now fatal** | The source stack (W2), the absence of history (W3), the missing platforms (W4), the multi-tenant apparatus (W6), and D-03 itself (W1) |
| **Opportunity the new intent creates** | Non-commercial use kills four manual tasks and all four open questions. `MethodRegistry` → MCP tool catalogue is nearly free. MCP Apps makes the Inspector artifact a first-class UI payload rather than a web-only page |
| **Threat the new intent creates** | **The trust invariants become advisory on the MCP surface (FIND-1).** The package's own F-01 warns that under pressure the trust invariants are exactly what gets silently dropped — and MCP delivery removes the mechanism that made them non-droppable |

**Verdict: adopt as the spine. Roughly 40% survives unchanged, 35% needs rework, 25% should be cut.**

### Research note — adopt the source strategy wholesale

| | |
|---|---|
| **Strength that survives intact** | The only artifact covering all three platforms. Compliance-first routing (official APIs, not scrapers). Channel separation — X = velocity, Reddit = conviction, Substack = expert narrative — which is precisely W12's fix. The six-tool read-only surface is already an MCP design. The "deterministic data layer, LLM as investigator" principle, arrived at independently of barebones |
| **Weakness barebones supplies the fix for** | No build discipline, no schema, no PIT, no cost ceilings, no product surface. Every one of those is a barebones strength. **The two artifacts are unusually complementary** |
| **Opportunity** | Drops into `ProviderResult<T>` with no architectural friction. Substack RSS is free, officially supported, needs no approval, and can start collecting today |
| **Threat** | Platform terms move fast — the X cap moved 2M→3M since it was written. Reddit's free-tier approval is a slow opaque queue that gates an entire channel and has a real chance of silent rejection. **Start that application before anything else** |

**Verdict: adopt the intake layer wholesale. ~90% survives; what it lacks, barebones has.**

### finsent — harvest the harness, kill the rest

| | |
|---|---|
| **Strength that survives intact** | The evaluation harness: PIT correctness with `assert_no_lookahead` and a test proving the guard fires, cross-sectional IC, Newey–West t, decay curve, **momentum-residualised IC**, horizon-normalised P&L. Plus the M0 null-scenario pattern — *a gate that cannot fail is not a gate* — which generalises far beyond this codebase |
| **Weakness** | Zero social ingestion. Never run on real data. No CI. Exact-ticker-match entity resolution, no syndication collapse, flat 10bps costs, no out-of-sample holdout, no multiple-testing correction. Databricks is heavy infrastructure for one person |
| **Opportunity** | The harness is pure pandas/numpy and ports cleanly to any feature — including social ones. **Momentum-residualisation is exactly the test that says whether social sentiment is a distinct factor or repackaged momentum**, which is the cheapest possible falsification of this entire project |
| **Threat** | Its own unresolved Challenge 1 — that 40-day sentiment drift may be ~collinear with 12-1 price momentum. If that is true for social sentiment too, the answer is "you already own this factor," and it is better to learn it in week 2 than week 25 |

**Verdict: harvest the harness (~15%), kill the Databricks pipeline (~85%). And run Challenge 1
early — it is ~2 days against data that already exists and it can invalidate the thesis cheaply.**

---

## 7. Decision register

Continues `docs/MEMORY.md`'s numbering. Each needs an owner ruling before the specs
are edited. Recommendations are mine; the reasoning is above.

| # | Decision | Options | Recommendation |
|---|---|---|---|
| **D-08** | **Re-lock the thesis** | (a) Keep D-03 comprehension speed · (b) Sentiment measurement fidelity · (c) Decision support with a validated promotion path | **(c)** — "trustworthy cross-platform attention and narrative measurement, with a falsifiable promotion path from *described* to *validated*." Preserves the D-03 honesty discipline while making "institutional grade" mean something |
| **D-09** | **What "validated" requires** | (a) Provenance + replay only · (b) + classification accuracy vs. a labelled set · (c) + return-predictivity (IC, NW-t, momentum-residual) | **(b) as the v1 gate, (c) as a per-metric promotion.** (c) needs a corpus that does not exist yet, so it cannot gate v1 — but the PIT hooks must be built from commit one because they cannot be retrofitted |
| **D-10** | **Primary surface and agent locus** | (a) Web-first as specced · (b) MCP-first, web as eval harness · (c) Both in parallel | **(b)** — and note this is not just ordering: per FIND-1 the web surface must survive as the *measurement* path even if MCP is the *usage* path |
| **D-11** | **Tenancy** | (a) Multi-tenant as specced · (b) Single-user hardened · (c) Local-only, no auth | **(b)** — keep auth (it is on the public internet in front of paid providers), cut signup/OTP-throttle/per-account-budgets/share-grants, **keep config versioning + audit + rollback as reproducibility infrastructure** (R4) |
| **D-12** | **Source stack** | (a) Keep ApeWisdom + Linkup · (b) Replace with Reddit API + Substack RSS + governed X · (c) Both | **(b)**, with ApeWisdom retained *only* as an independent cross-check on attention rank — which is a better use for it than being the single point of failure F-05 flagged |
| **D-13** | **Classifier runtime** | (a) LLM only (as specced) · (b) Pinned local models in a small Python service · (c) Hosted inference with pinned versions | **(b)** — per FIND-2 this is a reproducibility requirement, not a cost optimisation. Requires breaking `02-ARCHITECTURE-CONTRACTS.md` §1's "no Python service, no local model runtime" |
| **D-14** | **Platform aggregation** | (a) One blended number · (b) Three separate axes, optional headline composite | **(b)** — free now, a schema migration later (W12). Distinct from the cohort question, which stays deferred as the owner chose |
| **D-15** | **Collection strategy** | (a) Uniform polling · (b) Price-triggered sampling for X, continuous for free sources | **(b)** — per FIND-3, a 5–10× efficiency gain on the X budget that falls directly out of the cost structure |
| **D-16** | **History depth and backfill** | (a) Forward-only · (b) Backfill Reddit + Substack, X forward-only · (c) Maximum archive depth | **Blocked on U2.** Whatever the answer, the X asymmetry must be a rendered state, not a footnote |
| **D-17** | **Retention** | (a) ≤500-char snippets as specced · (b) Full bodies · (c) Split by source rights | **(c)** — full bodies for Reddit/Substack; IDs + scores + bounded snippet with on-demand re-hydration for X (R3) |
| **D-18** | **`finsent`** | (a) Keep Databricks · (b) Port the harness only · (c) Kill entirely | **(b)** — and run its Challenge 1 (momentum collinearity) early, before Stage 4 |
| **D-19** | **Valuation engine (F13) + scenario governance (F14)** | (a) Keep (D-04 locked them) · (b) Defer past v1 · (c) Cut | **(b)** — 30–38 h locked under D-04 for a different product. Nothing in the stated intent asks for DCF. Worth an explicit owner ruling rather than a quiet drop |
| **D-20** | **Budget gate** | Replace A9 (`< $50/mo`) with a real ceiling | **Set the number, keep §6.6's pre-dispatch discipline** — which matters more now, not less, because X bills per read |

---

## 8. What this does to the feature registry

Not a re-plan — a first pass at where the 19 features land, to show the *shape* of the change.

| ID | Feature | Fate under the recommendations above |
|---|---|---|
| F01 | Foundation and quality gates | **Keep, extend** — CI now spans a second (Python) service; add MCP contract lint |
| F02 | Auth, authorization, lifecycle | **Heavy cut** — keep OTP sign-in, cut open signup, `pending` tier, throttle machinery, per-account budgets |
| F03 | Persistence and domain contracts | **Redesign the ingest half**; keep every convention (bitemporal, surrogate keys, decimal, append-only) |
| F04 | Provider platform | **Keep the wrapper wholesale**, replace the adapter set (+Reddit, +Substack, +X, +Polygon; −ApeWisdom to cross-check, −Linkup) |
| F05 | Calculation kernel and Inspector | **Keep unchanged.** The crown jewel |
| F06 | Deterministic analytics | **Keep, extend** to three platform axes; re-derive every threshold (W8) |
| F07 | Dashboard and composites | **Defer** past the MCP surface |
| F08 | Attention leaderboard | **Keep, re-source** — Reddit API primary, ApeWisdom as cross-check |
| F09 | Ticker detail and evidence drawer | **Defer** — but its evidence-drawer *contract* is needed by the MCP tools |
| F10 | Evidence and stance pipeline | **Rework** — real corpora, not search snippets; pinned classifier; three sampling frames |
| F11 | Research agent and verifier | **Reframe** — becomes the evaluation path (FIND-1), not the usage path |
| F12 | Evaluation harness and judge | **Keep, merge** with finsent's harness; add Tier D (R1) |
| F13 | Valuation engine | **Question** (D-19) |
| F14 | Scenario governance | **Reduce** — keep official/personal scenarios, cut sharing and the issue queue |
| F15 | Admin control plane | **Heavy cut** — keep config/universe versioning, audit and rollback; cut the ~20-surface UI |
| F16 | Scheduler and dispatcher | **Keep**; cadence and trigger logic change per D-15 |
| F17 | Architecture Explorer | **Defer** |
| F18 | Cost, budgets, degradation | **Keep — promote.** More load-bearing now that X bills per read |
| F19 | Release hardening | **Keep**; copy-lint scope changes per FIND-1 |
| **F20** | *new* — Pinned classifier service | FinBERT + Twitter-RoBERTa, pinned SHAs, deterministic, versioned |
| **F21** | *new* — MCP server + MCP Apps components | The tool surface, generated from `MethodRegistry` |
| **F22** | *new* — Historical corpus and PIT store | Backfill + point-in-time discipline. **Cannot be retrofitted** |

**Net effort: roughly unchanged at ~190–250 h.** The cuts (multi-tenancy, valuation, deferred
dashboard) approximately pay for the additions (four adapters, classifier service, MCP surface,
historical corpus). **This is not a bigger build. It is a differently-shaped one** — which is
exactly why re-specifying now is cheaper than discovering it in Wave 3.

---

## 9. The grill

Questions the spec cannot answer. They are in rough order of how much damage a wrong answer does.

1. **Name one decision from the last twelve months this system would have changed.** Not a
   feeling — a position sized differently, a name avoided, an entry timed differently. If you
   cannot name one, the honest build is much smaller than this one.
2. **If Stage 4 returns NO-GO — momentum-residual IC says social sentiment is repackaged
   momentum — do you shut it down?** If not, do not build the gate. Build the dashboard, enjoy
   it, and stop calling it validated.
3. **How many hours per week, honestly?** At 5 h/wk this is a year-long project and the cut line
   has to be applied on day one, not on overrun.
4. **What is the marginal value over twenty minutes a day of reading the subreddits yourself?**
   This is D-03's question and it never stopped being a good one. If the answer is "it sees
   things I would miss," which things, and how would you know it saw them?
5. **F13 + F14 are 30–38 hours of DCF and scenario machinery locked under D-04 for a different
   product.** Nothing you have said since asks for valuation. Keep or defer?
6. **Who fixes this in six months when X changes its API?** You are the only user and the only
   maintainer. Eight adapters, a 27-table schema, a pinned model service and a growing corpus is
   real ongoing load.
7. **"Institutional grade" — methodological or operational?** PIT correctness and published ICs
   are ~free if designed in. Uptime and redundancy are not, and are hard to justify for one user.
8. **You said "aggregate first" about cohorts. Does that extend to platforms?** It should not —
   averaging a Substack essay with a WSB comment produces a number that means nothing, and it is
   free to separate now and a migration later.
9. **Are you willing to run Challenge 1 first?** ~2 days against data that already exists,
   testing whether sentiment drift is collinear with price momentum. It is the cheapest possible
   way to find out this project is unnecessary.

---

## 10. What happens next

1. Owner answers D-08, D-09, D-10 and D-16 — the four that gate everything else.
2. Remaining decisions are ruled on, defaults accepted or overridden.
3. `docs/MEMORY.md` gains D-08…D-22 with rationale, **and** supersedure entries for
   D-03, D-04, R-03 and R-19 — following the package's own protocol, which is most of the value
   of having adopted it.
4. `01-PRODUCT-SPEC.md` §2, §4, §5 and §6.1 are re-locked.
5. `02-ARCHITECTURE-CONTRACTS.md` §1 (the forbidden list) and §5 (the data model) are amended.
6. `03-ROADMAP.md` is re-waved; F20–F22 are written; the cut line is re-ordered.
7. `DEPLOY.md` gains the Reddit API application as MT-13 and marks it **do this first** — it is
   free, it is the longest-lead item in the plan, and it gates an entire channel.

---

## 11. Decisions taken — round 1 (2026-09-03)

| # | Decision | Ruling | vs. recommendation |
|---|---|---|---|
| **D-09** | What "validated" requires | **Classification accuracy vs. a labelled set as the v1 gate; return-predictivity (IC, NW-t, momentum-residual) as a per-metric promotion.** PIT hooks built from commit one | As recommended |
| **D-10** | Primary surface | **Web first, roadmap wave order preserved.** MCP is an additive surface built on a proven service layer | **Overrides** the MCP-first recommendation |
| **D-16** | History depth | **Forward-only. No backfill, no archives.** Collection starts now | **Overrides** the ~2-year backfill recommendation |
| **D-15** | Collection strategy | **Broad watch, deep on trigger.** 50–100 tickers watched continuously on free sources + Polygon; X reads spent only on price/volume movement | As recommended |

### 11.1 What D-10 (web first) resolves

**FIND-1 stops being a v1 problem.** With the web app as the primary surface the render boundary
is intact: §6.4's disclosure is emitted by the method, prose that fails verification is withheld,
and F19's copy lint governs everything a user sees. Every trust invariant stays enforceable in
code through Waves 1–5.

This is a defensible ordering on its own terms, and stronger than "MCP is nice to have": **build
the enforcement machinery first, then add the surface that cannot enforce, with the measurement
harness already in place to police it.** F11's synthesis and verifier remain the usage path, so
their 20–26 h stays fully load-bearing — there is no saving there, but there is no re-framing
either.

**Cost, stated once.** I2/I6/I7 — the MCP surface, the micro-UI, the designed tool surface —
land last instead of first. On the current wave structure that is ~25 weeks rather than ~10, and
the dashboard is designed before there is any evidence of which metrics get reached for.

**Mitigation that respects the ruling:** slot the MCP surface as **F21, immediately after F12**,
rather than after Wave 5. Wave 3's exit is the first moment the tool surface has something honest
to expose *and* the evaluation harness exists to measure how it is used. That lands MCP around
week 15 without violating F-11's walking-skeleton discipline, which is the actual substance of
the web-first choice.

### 11.2 What D-16 (forward-only) resolves, and what it makes harder

**Resolved:** §6.1's no-scraping invariant for X and Stocktwits survives **intact and unamended**. Historical backfill — Arctic Shift, PullPush, archive crawl — remains out of scope under D-16's forward-only ruling. U9 closes. That is a real simplification.

**Made harder, in three ways:**

1. **The collector start date is now the most time-critical item in the entire plan.** Every day
   not collecting is corpus that can never be recovered. `DEPLOY.md` MT-08 currently sits eighth
   in the checklist; it belongs first, above MT-00.

2. **D-09's promotion path is pushed out roughly 12 months.** Return-predictivity needs a corpus
   with enough dates for a meaningful IC. Forward-only means that corpus starts empty.
   Realistically the returns half of Tier D is a **2027 conversation**, and the spec should say so
   in those words rather than leave it implied — otherwise "validated" quietly means "accuracy
   only" forever without anyone having decided that.

3. **Retention (D-17) becomes materially more consequential, not less.** With backfill available,
   a bad retention decision is repairable. Forward-only means *capture it right on day one or
   lose it permanently*. See 11.4 — this is now the highest-stakes remaining open decision.

**And I3 is narrowed.** "Look at historical events" now means events after the collector start
date. That is honest and buildable, but it must be written into `01-PRODUCT-SPEC.md` §7 as a
stated limitation, and every historical view should carry a coverage floor —
*"coverage begins {collector_start_date}"* — in the same spirit as §6.1's other coverage labels.

### 11.3 NEW FINDING — the retention policy contradicts forward-only history

`02-ARCHITECTURE-CONTRACTS.md` §5 sets retention at **raw 7 days, normalized 90 days**,
artifacts 90 days except where claimed.

Under forward-only collection that policy is self-defeating. **If normalized social data is
deleted at 90 days, the corpus never exceeds 90 days, and the D-09 promotion path can never
run** — the thing being built is destroyed on a rolling basis by the retention rule.

**The social corpus is not retained data. It is the asset.** §5 must be rewritten to make the
normalized social corpus and its derived scores **permanent**, with retention applying only to
raw provider payloads (where rights require it) and to superseded calculation artifacts.

This is exactly the class of invariant the package's own F-01 warns gets silently dropped: it is
one line in a table, it contradicts nothing visible, and it quietly forecloses the headline goal.

### 11.4 NEW FINDING — Neon's free tier does not survive the corpus

`00-ADVERSARIAL-REVIEW.md` F-07 gated storage at **< 300 MB against Neon Free's 0.5 GB**, and
projected calculation artifacts alone at ~30 MB per series. That projection assumed ≤500-char
snippets and 90-day retention. Under D-15's 50–100 ticker universe with a permanent corpus:

| Source | Volume estimate | Stored bytes/item | Per month |
|---|---|---|---|
| Reddit (long-tailed: ~10 heavy names, ~90 thin) | 6,000–10,000 items/day | ~500 B | **90–150 MB** |
| Substack (20–50 feeds, long bodies, low count) | ~30 posts/day | ~8 KB | ~12 MB |
| X (trigger-sampled; IDs + scores + bounded snippet) | ~1,700/day | ~300 B | ~15 MB |
| **Social subtotal** | | | **~120–180 MB/month, permanent** |

Plus normalized market/news rows, Polygon price series, and calculation artifacts.

**Neon Free (0.5 GB) is exhausted in roughly three to four months and never recovers, because
the corpus is permanent by design.** Neon Launch (10 GB, ~$19/month) holds roughly five years at
this rate and fits the budget without argument. The alternative shape — object storage for raw
bodies with Postgres holding only normalized and derived rows — is cheaper still but adds a
storage tier in Wave 1.

Either way, **F-07's `< 300 MB` gate is obsolete and must be replaced with a growth-rate budget
measured in MB/month, not a fixed ceiling.** A fixed ceiling is the wrong instrument for a corpus
that is supposed to grow forever.

### 11.5 NEW FINDING — D-15 pulls Polygon into Wave 1

Price-triggered sampling makes **Polygon the trigger**, not a later enrichment. Wave 1's adapter
set is currently FMP + ApeWisdom; the walking skeleton cannot demonstrate the collection strategy
without price/volume in place. Polygon moves into F04's Wave 1 adapter list, and the trigger
logic itself becomes a named Wave 1 deliverable rather than part of F16's scheduler.

Second-order: the 50–100 ticker universe sits **at** `MT-07`'s hard cap of 100, not at its
default of 30. Every quota, storage and cost projection in the package was computed against 30.

### 11.6 Defaults now taken, absent objection

| # | Decision | Default |
|---|---|---|
| **D-08** | Thesis | Re-locked as **decision support with a validated promotion path** — implied by D-09 and superseding D-03's comprehension-speed lock. D-03's honesty discipline is retained in full |
| **D-12** | Source stack | Reddit Data API + Substack RSS + governed X watchlist + Polygon. ApeWisdom retained **only** as an independent cross-check on attention rank; Linkup dropped. Reverses R-03 and the F-05 ruling |
| **D-14** | Platform aggregation | Three separate axes (Reddit / X / Substack), optional headline composite. Never one blended number |
| **D-18** | finsent | Port the evaluation harness as a versioned module with its own tests. Kill the Databricks pipeline. Run Challenge 1 (momentum collinearity) early |
| **D-20** | Budget | Replace Tier A's A9 (`< $50/mo`) with a real ceiling; **keep §6.6's pre-dispatch check**, which matters more now that X bills per read and Neon has a paid tier |
| **F21 placement** | MCP surface | Immediately after F12 (Wave 3 exit), not after Wave 5 — see 11.1 |

---

## 12. Decisions taken — round 2, and the finalised position

| # | Decision | Ruling |
|---|---|---|
| **D-08** | Thesis | **Decision support with a validated promotion path.** Supersedes D-03. D-03's honesty discipline retained in full |
| **D-11** | Tenancy | **Single-user hardened.** OTP auth kept; open signup, `pending` tier, OTP throttle machinery, per-account budgets, share grants and the issue queue cut. Config/universe versioning, audit with actor and before/after, and rollback kept in full as reproducibility infrastructure |
| **D-12** | Source stack | **Reddit Data API + Substack RSS + governed X watchlist + delayed intraday market data.** ApeWisdom demoted to an independent cross-check on attention rank; Linkup dropped. Reverses R-03 and the F-05 ruling |
| **D-13** | Classifier runtime | **Pinned models in a decoupled Python service.** Collection never blocks on scoring; an unscored backlog is queued, never substituted. Scorer outage produces §6.3 abstention, not a different method's number. LLM enters only as **registered complementary methods**, not fallback |
| **D-14** | Platform aggregation | **Three separate axes.** Optional headline composite; never one blended number |
| **D-17** | Retention | **Split by source rights.** Full bodies for Reddit and Substack. X: Post IDs + derived scores + bounded snippet, re-hydrated on demand, with the **snippet as X's canonical scoring unit** so the series stays self-consistent |
| **D-18** | finsent | **Port the evaluation harness** as a versioned module with its own tests. Kill the Databricks pipeline. Run Challenge 1 (momentum collinearity) early |
| **D-19** | F13 / F14 | **Deferred past v1** with a named trigger. F05's Inspector still serves J5 |
| **D-20** | Budget | **$350/month ceiling**, enforced by §6.6's pre-dispatch check. See 12.2 |
| **D-21** | LLM method scope | **Relevance filtering and ticker-collision disambiguation only** in v1. Sarcasm detection and long-form Substack stance deferred with a named trigger |
| **D-22** | Capacity | **20+ h/week.** Full five-wave structure survives; the cut line stays a contingency, not a plan |

### 12.1 D-13 in detail — decoupled scoring

```
collector ──→ raw item store ──→ scoring queue ──→ pinned scorer service
                    ▲          (full bodies, D-17)         │
             never blocked by                              ▼
             scorer availability                    scored corpus
```

**Rules, binding:**

1. Collection never depends on the scorer. A scorer outage produces an unscored backlog, not
   lost data — recoverable precisely because D-17 retains the bodies.
2. **No silent substitution.** A scorer outage renders §6.3 abstention and F18's degraded mode.
   Showing "no stance — scorer unavailable since {ts}" is more honest than a number produced by
   a different method.
3. Every score carries `scorer_id` + `scorer_version` (e.g. `finbert@<sha>`). D-09's IC
   computation filters to a single pinned scorer; a methodologically heterogeneous series is
   never admitted to a validated metric.
4. **Capacity fallback is a hook, not a build.** If the queue backs up during a high-volume
   event, LLM-scoring the backlog and re-scoring later is permitted — writing a **successor
   artifact** per §4.2, never recomputing in place. Provision the `scorer_provenance` column in
   Wave 1; build the path only if the queue actually backs up.
5. LLM methods are registered in `MethodRegistry` with their own versions, so the Inspector shows
   which method produced which field.

**Re-scoreability by source:** Reddit and Substack are re-scoreable from full bodies
indefinitely. X is re-scoreable from the bounded snippet, which is why the snippet is X's
canonical scoring unit — FinBERT-on-snippet stays self-consistent across the whole X series.
Posts deleted upstream and purged are the one unrecoverable case.

### 12.2 D-20 in detail — the $350 budget and what it trims

Polygon Stocks Advanced at $199 is 57% of a $350 ceiling. The two viable shapes:

| | Real-time SIP | **Delayed tier (chosen)** |
|---|---:|---:|
| Market data | $199 Polygon Advanced + $22 FMP | ~$80 combined |
| Neon Launch | $19 | $19 |
| Scoring service | $15 | $15 |
| Claude | $50 | $80 |
| **X API** | **$45 ≈ 9k reads/mo** | **$150 ≈ 30k reads/mo ≈ 1,430/trading day** |
| Reddit · Substack · Vercel Hobby | $0 | $0 |
| **Total** | $350 | $350 |

**The trade is real-time tape versus 3.3× the X sample, and X wins on an asymmetry:** X reads
convert directly into statistical power and are the binding constraint on every threshold in
FIND-3. Real-time price does not, for this use case — D-15's trigger asks whether a name is
moving unusually, and social reaction lags price by minutes to hours, so a delayed trigger loses
almost nothing when what it triggers is a sample of what people said *after* the move.

**This trims I5, and the trim is stated rather than absorbed.** The requirement was "real recent
intraday data." What is delivered is intraday-*resolution* market context on a delay, not
real-time tape. **Named upgrade trigger:** any intention to act intraday off this system. It is a
~$120/month step with no rebuild — the adapter interface is unchanged, only the tier.

### 12.3 What $350 does to the product's shape

**X becomes a minority channel.** ~30k reads/month against Reddit's ~144k free queries per *day*.
The centre of gravity is Reddit + Substack, with X as trigger-sampled colour. Two consequences:

- **The governed X account taxonomy defers.** Scoring issuer/IR, executives, regulators,
  credentialed journalists, verifiable analysts and retail as separate categories is real
  engineering and is over-built for ~5% of the corpus. **v1 is a flat watchlist plus cashtag
  queries over the active universe**, labelled *watched-account sample* per §6.1. The category
  taxonomy gets a named trigger: X exceeds 15% of scored items, or a cohort question becomes
  load-bearing.
- **Every X-derived metric abstains more often than the Reddit equivalents.** That is correct
  behaviour, and it must be visibly different in the UI rather than averaged away — which D-14's
  three-axis separation already handles.

**Time-rich, money-poor is the favourable version of this constraint.** 20+ h/week against $350
favours building over buying, weights the product toward the free abundant sources, and lets the
corpus accrue for free while D-09's promotion path waits on wall-clock time that was going to
pass anyway.

### 12.4 Revised effort

| | Hours |
|---|---:|
| Original baseline | 180–240 |
| − D-11 multi-tenancy cut (F02 partial, F14 cut, F15 heavy cut) | −50 to −70 |
| − D-19 F13/F14 deferred | −30 to −38 |
| + New adapters (Reddit, Substack, X, market data; − ApeWisdom demoted, − Linkup) | +10 to +16 |
| + F20 pinned scorer service and queue | +14 to +18 |
| + F21 MCP server and MCP Apps components | +16 to +22 |
| + F22 PIT corpus, permanent retention, coverage-floor rendering | +12 to +16 |
| + Trigger logic promoted into Wave 1 | +6 to +10 |
| **Revised** | **~160–210 h ≈ 8–10 weeks at 20 h/week** |

At 20 h/week F13 and F14 are affordable again. D-19 defers them anyway; the deferral is a scope
judgement, not a capacity one, and it is reversible without penalty.
