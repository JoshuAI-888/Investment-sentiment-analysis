# Memory — Decision Log and Handoff

**Purpose:** the durable *why*. `PROGRESS.md` says what state the build is in; this file says
why it is that shape, and what a successor needs to know that the code does not say.

**How to use this file.** Append. Never delete rationale — mark a decision `Superseded`, move
it to §4, and summarise. Record any decision you had to think about for more than a minute.
Read this first on a cold start.

**Provenance warning.** What the owner explicitly decided on 2026-09-03 is listed in §1.
Everything in §2 is a ruling made by the reviewing agent under the owner's direction, with
rationale reconstructed at authoring time. Treat §2 as the maintainers' best reading and
correct it where a decision-maker says otherwise.

---

## 1. Owner decisions (explicit, 2026-09-03)

### D-01 — This work lives in `barebones/`, and the host repository is a mistake
> **Structurally superseded by D-25 (2026-09-03).** The reasoning holds; the layout it
> prescribed does not. The package now owns the repository root and finsent is archived at
> `archive/finsent/`, so the separation D-01 demanded is achieved by removal rather than by a
> subfolder. `DEPLOY.md` MT-01 is resolved.
The owner selected `Investment-sentiment-analysis` in error. That repository contains an
unrelated Python/Databricks sentiment-drift research pipeline with its own `docs/spec.md`,
`docs/memory.md` and `docs/progress.md` and its own locked decisions. **None of those apply
here.** All work goes in `barebones/`, which is self-contained and intended to be lifted into
its own repository. Nothing in `barebones/` may import from, extend, or reference the
repository root's `src/`, `app/`, `jobs/`, `conf/` or `docs/`.
**Status:** ✓ Locked. Migration is `DEPLOY.md` MT-01.

### D-02 — Scope is kept; the timeline extends
Presented with the finding that the source PRD's 48-hour / 42–54-hour budget is off by
roughly a factor of four (`00-ADVERSARIAL-REVIEW.md` F-01), the owner chose to keep full
scope and re-baseline the timeline rather than cut features.
**Consequence:** five waves, nineteen features, ~180–240 engineering hours.
**Status:** ✓ Locked.

### D-03 — The thesis is comprehension speed
Not alpha, not agentic-engineering capability. The product proves that a user can go from
"what is attention doing?" to a source-backed explanation in under thirty seconds *without
sacrificing accuracy*.
**Rejected:** trust/auditability as the primary thesis (it is a means here, not the end);
signal/alpha potential (requires backtesting, an explicit non-goal); agentic engineering
capability (would make the product a test fixture).
**Status:** ✓ Locked. Drives `01-PRODUCT-SPEC.md` §2 and Tier C.

### D-04 — All four challenged components stay in scope
Calculation Inspector across every deterministic metric; the DCF/peer valuation engine; the
governed admin console with the QStash dispatcher; the Architecture Explorer. The owner
explicitly declined to cut any of them.
**Consequence:** they are sequenced (F05/F13/F14, F15/F16, F17) rather than dropped, and the
Inspector is built as shared infrastructure in Wave 1 rather than retrofitted — retrofitting
is how it would have been quietly lost.
**Status:** ✓ Locked.

### D-05 — Build loop: one PR per feature with a self-review gate
The agent selects the next unblocked feature, builds to spec, runs the full test plan,
runs the adversarial self-review checklist, opens a PR, and merges when CI is green and the
DoD is genuinely complete. The owner spot-checks rather than approving every PR.
**Rejected:** one PR per wave (large diffs, late defects); mandatory human approval per PR
(the loop stalls when the owner is away); trunk-based with no PRs (no audit artifact).
**Status:** ✓ Locked. See `04-BUILD-LOOP.md`.

### D-06 — Accounts provisioned
Present: Vercel, Neon, Upstash Redis and QStash; FMP Starter, Marketaux, Alpha Vantage keys;
Resend with `accounts.joshuai.nz` verified.
**Absent: LLM access** (neither Vercel AI Gateway nor a direct provider key).
**Consequence:** Wave 3 (F10, F11, F12) is blocked. `DEPLOY.md` MT-06 is the highest-priority
manual task after MT-00.
**Status:** ✓ Recorded.

### D-07 — Quality bar: automated LLM judge
The owner chose an automated LLM judge as the sole quality gate for the comprehension thesis,
over timed user testing, and over self-review.
**Concern raised and accepted:** an LLM judge is systematically forgiving of fluent,
well-cited, subtly wrong prose — the exact failure mode this product must catch
(`00-ADVERSARIAL-REVIEW.md` F-22).
**Implemented as chosen, with two cheap mitigations that keep it falsifiable:** a one-time
20-item human calibration (MT-11, non-blocking), and adversarial validation against the
seeded-error corpus (a judge that passes a known-wrong answer is itself a defect).
**Status:** ✓ Locked with mitigations. Revisit if judge/human Spearman < 0.7.

---

## 1b. Owner decisions (explicit, 2026-09-03) — the re-lock

On 2026-09-03 the owner stated an intent materially different from the one this package was
locked against. Seven of the eight defining dimensions moved. The analysis is in
`SPEC-REVIEW.md`; the decisions are here.

**Read this before §1.** Where D-08 through D-22 conflict with D-01 through D-07, these win.
Where they are silent, §1 stands.

### D-08 — The thesis is decision support with a validated promotion path
**Supersedes D-03.** Not comprehension speed. The product measures cross-platform attention and
narrative, and carries a falsifiable path by which a metric graduates from *described* to
*validated*.

**D-03's honesty discipline is retained in full** — abstention, coverage labels, the ban on
advice, the §6.4 disclosure for anything not yet validated. What changes is that §6.4 is now a
*default state a metric can leave*, rather than a permanent property of the product.

**Rejected:** keeping D-03 (it no longer matches the stated intent); pure signal/alpha (the
corpus to validate it does not exist yet — see D-16).
**Status:** ✓ Locked. Drives `01-PRODUCT-SPEC.md` §2 and §4.

### D-09 — "Validated" means classification accuracy now, return-predictivity by promotion
Two-stage bar:

- **v1 gate:** stance accuracy measured against a hand-labelled set. This extends Tier B and is
  achievable on day one.
- **Promotion:** a metric may use predictive language **only** if a point-in-time-correct
  backtest with a published information coefficient, Newey–West t-statistic and
  momentum-residual IC stands behind it, versioned and linked from the Inspector. Everything
  else carries the §6.4 disclosure and abstains.

PIT hooks are built from the first commit because they cannot be retrofitted.

**Consequence the spec must state plainly:** under D-16 (forward-only) the corpus starts empty,
so the return-predictivity half needs roughly twelve months of accrued dates before it can run
at a meaningful sample size. **That is a 2027 milestone.** Recording it here so "validated" does
not quietly settle into meaning "accuracy only" without anyone having decided that.
**Status:** ✓ Locked. Drives Tier D in `01-PRODUCT-SPEC.md` §4 and F12.

### D-10 — Web surface first; the wave order is preserved
The Next.js application remains the primary surface and `03-ROADMAP.md`'s wave order stands. The
MCP surface is additive, built on a service layer that has already survived a live round trip.

**Rationale, and it is stronger than sequencing convenience:** the web app owns the render
boundary. §6.4's disclosure is emitted by the method, prose failing verification is withheld,
and F19's copy lint governs everything a user sees. **An MCP server owns none of that** — it
returns results to a host it does not control, and that host's model writes the prose
(`SPEC-REVIEW.md` FIND-1). Building the enforcement machinery first, then adding the
surface that cannot enforce, is the defensible order.

**Cost, accepted:** the MCP surface, micro-UI and designed tool surface land last rather than
first.
**Mitigation:** F21 is placed **immediately after F12**, at the Wave 3 exit — the first point at
which the tool surface has something honest to expose *and* the evaluation harness exists to
measure how it is used. Not after Wave 5.
**Rejected:** MCP-first (recommended by the review; owner declined); both in parallel (violates
R-09/F-11 — parallel lanes before contracts survive a live round trip).
**Status:** ✓ Locked.

### D-11 — Single-user hardened
There is one user. Roughly 50–70 hours of this package defends a multi-tenant threat model that
does not exist.

**Cut:** open signup, the `pending` tier, the OTP throttle machinery, per-account budgets, share
grants, the issue queue, and the ~20-surface admin mutation UI.
**Kept, and not negotiable:** OTP authentication (the app sits on a public URL in front of paid
providers), config versioning, universe versioning, audit events carrying actor and
before/after, rollback targets, and the frozen config reference on every run.

**The distinction that matters, because the two look alike in F15:** signup, throttling and
sharing are *multi-tenancy* infrastructure and are cut. Versioning, audit and rollback are
*reproducibility* infrastructure and survive in full — they are what answers "what produced this
number in March," which D-09 requires.

**Closes:** OQ-3 and OQ-4. **Voids:** MT-09, MT-10. **Weakens to non-blocking:** R-02.
**Status:** ✓ Locked.

### D-12 — The source stack is replaced
**In:** Reddit Data API (+ PRAW), Substack RSS (+ feedparser), a governed X watchlist, and a
delayed intraday market-data tier.
**Demoted:** ApeWisdom — retained only as an *independent cross-check* on attention rank, which
is a better use for it than being the single point of failure F-05 identified.
**Dropped:** Linkup.

**This reverses the F-05 ruling.** That ruling accepted an unlicensed, SLA-free dependency on the
grounds that "there is no licensed alternative at this budget." **That is no longer true** — the
Reddit Data API's free non-commercial tier exists and this project qualifies for it under D-11.
R-03 is superseded accordingly.

**Consequence:** F-03's selection-bias problem does not disappear but becomes tractable. Reddit
comment trees are closer to a census of a thread than a relevance-ranked search result set ever
was. The honest labelling discipline still applies, with three different sampling frames — see
R-21.
**Status:** ✓ Locked.

### D-13 — Pinned models in a decoupled scoring service; no silent fallback
**Breaks `02-ARCHITECTURE-CONTRACTS.md` §1's "Forbidden in P0: any Python service, any local
model runtime."** The reason is not cost.

**A hosted LLM classifier cannot back a historical series.** Model IDs retire. When the model
behind the 2026 scores is gone, those scores cannot be reproduced, re-derived under a corrected
method, or compared like-for-like with a successor's — and every `CalculationArtifact` in the
corpus becomes unverifiable at exactly the moment D-09's backtest asks whether the series means
anything. FinBERT and Twitter-RoBERTa pinned to commit SHAs are reproducible indefinitely.

**Architecture:**

```
collector ──→ raw item store ──→ scoring queue ──→ pinned scorer service
                    ▲          (full bodies, D-17)         │
             never blocked by                              ▼
             scorer availability                    scored corpus
```

**Binding rules:**

1. Collection never depends on the scorer. An outage produces an unscored backlog, not lost data
   — recoverable precisely because D-17 retains the bodies.
2. **No silent substitution.** A scorer outage renders §6.3 abstention and F18's degraded mode.
   "No stance — scorer unavailable since {ts}" is more honest than a number from another method.
3. Every score carries `scorer_id` + `scorer_version`. D-09's IC filters to one pinned scorer; a
   methodologically heterogeneous series is never admitted to a validated metric.
4. **Capacity fallback is a hook, not a build.** If the queue backs up in a high-volume event,
   LLM-scoring the backlog and re-scoring later is permitted — writing a **successor artifact**
   per §4.2, never recomputing in place. Provision `scorer_provenance` in Wave 1; build the path
   only if the queue actually backs up.

**Re-scoreability:** Reddit and Substack from full bodies, indefinitely. X from the bounded
snippet — which is why the snippet is X's canonical scoring unit, so the X series stays
self-consistent. Posts deleted upstream and purged are the one unrecoverable case.
**Partially supersedes R-19.**
**Status:** ✓ Locked.

### D-14 — Three platform axes, never one blended number
Reddit, X and Substack are scored and stored on separate axes with separate sampling frames. A
headline composite may be *displayed*; it is never the stored primitive.

**Rationale:** a Substack essay, a WSB comment and a FinTwit cashtag post are different kinds of
evidence. Averaging them produces a number that means nothing. Separating them is free now and a
schema migration later.
**Note:** this is *platform* separation. **Cohort** segmentation within a platform stays deferred
per the owner's "aggregate first."
**Status:** ✓ Locked.

### D-15 — Broad watch, deep on trigger
50–100 tickers watched continuously on the free sources; **X reads spent only when the market
data trigger says a name is moving.**

**Rationale — this falls directly out of the cost structure, not from preference:**

| Source | Cost shape | Strategy |
|---|---|---|
| Reddit Data API | Free, abundant (100 QPM ≈ 144k queries/day) | Poll broadly and continuously |
| Substack RSS | Free, slow (publication cadence) | Poll on a daily-ish schedule |
| Market data | Flat tier, effectively unlimited calls | Poll continuously — **it is the trigger** |
| X API | $0.005/read, scarce | **Sample on trigger only** |

At $0.005/read the budget buys a **spike detector, not a continuous intraday gauge**. Posts
cluster hard around news, so most buckets on most tickers correctly abstain, and `explain_spike`
is the right primary tool. Trigger-driven sampling is a 5–10× efficiency gain on the X line.

**Consequences:** market data moves into Wave 1's adapter set — the walking skeleton cannot
demonstrate the collection strategy without the trigger. The trigger logic is a named Wave 1
deliverable, not part of F16. And the universe sits **at** MT-07's hard cap of 100, not its
default of 30; every quota, storage and cost projection in this package was computed against 30
and must be re-derived.
**Status:** ✓ Locked.

### D-16 — Forward-only. No backfill
Collection starts now and history accrues in wall-clock time.

**§6.1's no-scraping invariant for X and Stocktwits survives intact and unamended.** That was
the cleanest line in the package and it stays unbroken.

**Three consequences, all binding:**

1. **The collector start date is the most time-critical item in the plan.** Every day not
   collecting is corpus that can never be recovered. MT-08 moves to the top of `DEPLOY.md`,
   above MT-00.
2. **D-09's promotion path is pushed out ~12 months** — see D-09.
3. **D-17 becomes the highest-stakes remaining decision.** With backfill available a bad
   retention choice is repairable; forward-only means capture it right on day one or lose it
   permanently.

**I3 is narrowed and the narrowing is stated, not absorbed:** "historical events" means events
after the collector start date. Every historical view carries a coverage floor —
*"coverage begins {collector_start_date}"* — in the same spirit as §6.1's other coverage labels.
**Closes:** OQ-9 (whether scraped archives are acceptable) — they are not needed.
**Status:** ✓ Locked.

### D-17 — Retention is split by source rights, and the corpus is permanent
| Source | Stored | Re-scoreable |
|---|---|---|
| Reddit | **Full bodies**, own-collected via the official API | Indefinitely |
| Substack | **Full bodies** via RSS | Indefinitely |
| X | Post IDs + derived scores + a **bounded snippet**, re-hydrated on demand | From the snippet, which is X's canonical scoring unit |

The X shape is the compliant pattern under X's developer terms, which restrict storing Post
content and require honouring upstream deletions. It also happens to be the cheap one.

**Supersedes `02-ARCHITECTURE-CONTRACTS.md` §5's 90-day normalized retention for social data.**
Under D-16 that policy is self-defeating: deleting normalized social data at 90 days means the
corpus never exceeds 90 days and D-09's promotion path can never run. The rolling delete eats
the asset.

> **The social corpus is not retained data. It is the asset.** Retention applies to raw provider
> payloads (where rights require it) and to superseded calculation artifacts. The normalized
> corpus and its derived scores are **permanent**.

**Status:** ✓ Locked.

### D-18 — Port finsent's evaluation harness; kill the Databricks pipeline
The harness — PIT correctness with `assert_no_lookahead`, cross-sectional IC, Newey–West t,
decay curve, momentum-residualised IC, horizon-normalised P&L — is ported as a **versioned module
with its own tests**, not imported across a boundary D-01 says must not exist. The Databricks
pipeline is not kept alive.

**Also:** run finsent's Challenge 1 (whether sentiment drift is ~collinear with 12-1 price
momentum) early. It is ~2 days against data that already exists and it is the cheapest possible
falsification of this project.
**Status:** ✓ Locked.

**Superseded 2026-09-04 — the port is abandoned, not fulfilled.** The owner reset the
repository's git history and `archive/finsent/` — the source this decision ports from — was
dropped in that reset, confirmed deliberate. There is nothing left to port `{engine,pit}.py` or
its two test files from. **F12's evaluation harness now has to be built from scratch** when F12
is picked up (PIT correctness, cross-sectional IC, Newey–West t, decay curve,
momentum-residualised IC, horizon-normalised P&L — the same capability list, just without a
donor implementation). Challenge 1 (drift vs. 12-1 momentum) is also no longer runnable as "cheap
against data that already exists," since the code that ran it is gone; it would need to be
re-derived independently if still wanted. This decision's *reasoning* stays correct — the
capability list is still right — only its *mechanism* (port, not build) no longer has a source.

### D-19 — F13 valuation and F14 scenario governance defer past v1
30–38 hours locked under D-04 for a different product. Nothing in the 2026-09-03 intent asks for
DCF or peer valuation. **F05's Inspector still serves J5** — "show me exactly how this number was
calculated" — which is the part of F14 that carried the trust story.

**Partially supersedes D-04.** The Inspector (F05) and the Architecture Explorer (F17) survive;
the valuation engine and scenario governance defer.
**Named trigger to reconsider:** a valuation question becomes load-bearing in actual use, or v1
ships with capacity to spare.
**Status:** ✓ Locked. Reversible without penalty at 20 h/week.

### D-20 — Budget ceiling $350/month
**Replaces Tier A criterion A9 (`< $50/month`), which was off by an order of magnitude.**
§6.6's pre-dispatch budget check is retained and matters *more*, not less, because X bills per
read and the database now has a paid tier.

| Item | Allocation |
|---|---:|
| Market data — delayed intraday tier + fundamentals | ~$80 |
| Neon Launch (the corpus is permanent; Free does not survive it) | ~$19 |
| Pinned scorer service | ~$15 |
| Claude — relevance, collision, narration | ~$80 |
| X API — ~30,000 reads/month ≈ 1,430/trading day | ~$150 |
| Reddit · Substack · Vercel Hobby | $0 |
| Reserve | ~$6 |
| **Total** | **~$350** |

**The trade that sets this shape:** real-time SIP tape ($199) versus **3.3× the X sample**. X
reads convert directly into statistical power and are the binding constraint on every sampling
threshold; real-time price does not, for this use case — the trigger asks whether a name is
moving unusually, and social reaction lags price by minutes to hours, so a delayed trigger loses
almost nothing when what it triggers is a sample of what people said *after* the move.

**This trims I5, and the trim is recorded rather than absorbed.** Delivered: intraday-*resolution*
market context on a delay. Not delivered: real-time tape.
**Named upgrade trigger:** any intention to act intraday off this system. ~$120/month, no
rebuild — the adapter interface is unchanged, only the tier.
**Status:** ✓ Locked.

### D-21 — LLM methods in v1: relevance and ticker-collision only
Registered as `MethodRegistry` entries with their own versions, so the Inspector shows which
method produced which field.

**In v1:** relevance filtering (Tier B's B1 ≥ 0.95 precision gate requires it) and
ticker-collision disambiguation (the `AI` / `ON` / `IT` / `ALL` problem in F10 §4.2).
**Deferred with a named trigger:** sarcasm/irony detection, and long-form Substack stance where
text exceeds FinBERT's 512-token window. Trigger: measured error attributable to either.
**Status:** ✓ Locked.

### D-22 — Capacity is 20+ hours/week
Revised effort ~160–210 h ≈ 8–10 weeks. The full five-wave structure survives and
`03-ROADMAP.md` §4's cut line stays a contingency rather than a plan.
**Status:** ✓ Recorded.

### D-23 — The governed X account taxonomy defers
At ~$150/month X yields ~30k reads against Reddit's ~144k free queries per *day*. X is a
**minority channel** and the product's centre of gravity is Reddit + Substack.

Scoring issuer/IR, executives, regulators, credentialed journalists, verifiable analysts and
retail as separate governed categories is real engineering and is over-built for ~5% of the
corpus. **v1 is a flat watchlist plus cashtag queries over the active universe**, labelled
*watched-account sample* per §6.1 — never "X sentiment."
**Named trigger:** X exceeds 15% of scored items, or a cohort question becomes load-bearing.
**Status:** ✓ Locked.

---

## 1c. Owner decision (explicit, 2026-09-03) — the parallel-lane split

### D-24 — Three build lanes, subagent roles, one writer per state file

**Asked:** is the package build-ready, does it have a working loop, and how does the work split
across parallel builders — optimised for cost without sacrificing quality?

**Answered:** spec-ready but not scaffold-ready (`barebones/` held no code); the loop was sound
but written for a single agent, and its selection input had two defects (F16a was unreachable,
the designated branch was stale). Build proceeds in **three named lanes** — SPINE, COLLECT,
SURFACE — driven by a coordinator with **separate build, verify and review subagents**.
Protocol: `06-PARALLEL-LANES.md`. Definitions: `.claude/agents/`.

**The three things this decision actually settles:**

1. **One writer per state file.** `PROGRESS.md` carried every per-merge write, which under any
   parallel topology guaranteed a conflict on the `Last updated` line and the session-log tail —
   both of which every single PR touched. Per-feature state moved to three single-writer lane
   files, the log became one file per session, and the coordinator is the sole writer of all of
   it. `PROGRESS.md` now changes only at a wave boundary.
2. **Review is a different agent than build, and holds no write tools.** §5 named the loop's most
   common failure as *an agent that builds correctly to a spec it misread.* A builder running its
   own checklist re-reads the spec through that same misreading. Separating them is a control,
   not a token optimisation — and the reviewer having no write tools is what stops a finding
   being quietly fixed instead of reported.
3. **Cost is controlled by the brief, not the model.** A subagent starts cold, so what it is
   given dominates what it costs. Lane agents get their feature spec, the contracts §3–§5, the
   build steps and their lane file — roughly 500 lines. They are explicitly forbidden the
   4,486-line source PRD. Model tiering is secondary: Sonnet builds (Opus for F05, F20, F22,
   where an error is unrecoverable), Haiku verifies, Opus reviews.

**What this decision does *not* override.** `03-ROADMAP.md`'s structural rule **F-11** — Wave 1
is a single-agent walking skeleton, parallel lanes start in Wave 2 — stands. Three lanes from
F01 would have contradicted it, and its reasoning is sound: a lane built against a contract that
has not survived a live round trip is work that gets thrown away. The carve-out taken instead is
scoped to F-11's own test: a Wave 1 lane may run early **only if it consumes no domain contract
F03 has not yet proven.** Exactly two things qualify — F20's service half and F04's adapter and
fixture layer. Everything else in Wave 1 stays serial. This is narrower than it first looks, and
deliberately so: the value it buys is an earlier collector, which under D-16 is the one thing in
the plan that cannot be bought back later.

**Rejected alternatives:**

- **A single scribe** — one agent owning `PROGRESS.md` while others report in PR bodies.
  Serialises every lane behind one writer and leaves the state staleest exactly when the other
  lanes need it to select work.
- **A generated aggregate committed inside each PR.** A generated file conflicts precisely as
  badly as a hand-written one; generation does not change that both sides wrote the same lines.
- **Letter-named lanes (A/B/C).** `03-ROADMAP.md` §2 already uses Lane P / Lane A / Lane G for
  dependency lanes. Reusing the letter space for account assignment would have made two
  different axes read as one.
- **One agent per feature doing build, verify and review together.** Cheapest per feature and
  the reason the loop's governing rule exists. Rejected on quality.

**Not settled, and flagged:** `03-ROADMAP.md` §2's per-feature estimates sum to ~272–360 h
against §1.1's revised total of 160–210 h. The gap predates this decision. It is an owner-facing
estimate question, not a documentation defect, and it materially affects the 8–10 week figure
in D-22.

---

## 1d. Owner decision (explicit, 2026-09-03) — the repository flatten

### D-25 — The package owns the root; finsent and the comparison are archived

**Asked:** clean up the repository — archive what is irrelevant, keep only what the barebone
build needs, lift the package out of `barebones/`, and prepare it for the build.

**Decided, on four explicit answers:**

1. **Restructure only.** No F01 scaffolding in the same pass — F01 starts from a clean tree as
   its own PR, which is what `04-BUILD-LOOP.md` expects.
2. **finsent is archived whole and in-repo**, at `archive/finsent/`, structure preserved and
   history intact through `git mv`.
3. **The approach comparison and its published site are archived, and the Pages workflow is
   deleted.** The `joshuai-888.github.io` URL is no longer served.
4. **MT-01 is resolved by this move, not by a separate repository.**

**Why archive rather than delete, and this is the part that matters.** **D-18 ports finsent's
evaluation harness into F12** — `archive/finsent/src/backtest/{engine,pit}.py` with
`tests/test_pit_leakage.py` and `test_parity.py`. Deleting finsent would strand the one artifact
that makes D-09's promotion path measurable, and `05-TEST-STRATEGY.md` §9 rests on evidence that
only exists there: a null scenario that reached raw-IC Newey–West **t = +2.15** and was rejected
only by the momentum-residual control. **Do not delete `archive/` before F12 has taken what it
needs.** `archive/README.md` says so at the point someone would be tempted.

**What the flatten actually fixes.** D-01 called the host repository a mistake and MT-01 proposed
migration. Both were answering one problem: a second project's `CLAUDE.md`, tooling and locked
decisions sitting where an agent would read them as its own. Archiving finsent removes that
problem at the source — there is now one project at the root, one `docs/`, one `README.md`, and
a `CLAUDE.md` describing only this build. A separate repository would add a migration and remove
nothing. **D-01's reasoning holds; its prescribed layout is superseded.**

**Consequences handled in the same commit:** `SPEC-REVIEW.md` moved into `docs/` and every
reference to it re-depthed; the `barebones/` prefix removed from all paths; `02-ARCHITECTURE-
CONTRACTS.md` §9's repository shape re-rooted; MT-01 marked resolved with its one surviving
item (branch protection, which needs F01's check to exist first); `.gitattributes` and the three
agent definitions re-pathed; a root `.gitignore` restored, since the archived one was finsent's
and its removal would have stopped ignoring `.env`.

**Two pre-existing broken references were found and fixed** while re-depthing: `04-BUILD-LOOP.md`
and `05-TEST-STRATEGY.md` both pointed at `../MEMORY.md`, which resolved above the package. A
third, in `PROGRESS.md`, was introduced by the D-24 rewrite in this same session.

**Rejected alternatives:**

- **Delete finsent, recover from git history if F12 needs it.** Puts a Wave 3 dependency behind
  an archaeology task, in a package whose whole thesis is that provenance should not require
  archaeology.
- **Keep the two projects side by side and just tidy.** Leaves exactly the collision D-01 named.
- **Migrate to a fresh repository per MT-01 as written.** Costs a migration to solve a problem
  the archive already solved.

---

## 1e. Owner answers, 2026-09-03 — blockers closed and the remaining decisions taken

Four questions were put to the owner. All four were answered. Two were manual tasks blocking
Wave 1, one was a status check, and one was a judgement an audit had made on the owner's behalf
and flagged for ratification.

### D-26 — The administrator address is `joshuaifang@gmail.com`

**Closes OQ-1 and MT-00.** The **source PRD was right and the correction was wrong**: the `i` is
deliberate, matching the `joshuai.nz` domain handle, not a typo as MT-00 suspected.

`ADMIN_EMAIL_ALLOWLIST="joshuaifang@gmail.com"`. Note the failure mode this closes, because it
was the cheapest catastrophic error available: a single wrong character in one environment
variable produces an application with **no reachable administrator** — no universe activation, no
config, no budgets — recoverable only by redeploying. F02's boot assertion logs the configured
address at startup so a later regression shows up in the first deployment log rather than at the
first admin click.

**F02 is unblocked.**

### D-27 — The initial universe is 100 symbols

**Closes MT-07.** The top of D-15's re-based 50–100 band, not the middle and not the old
30-symbol default.

**This needs no storage re-derivation**, which is worth stating because MT-07 warns that every
pre-2026-09-03 projection was computed at 30 symbols and must be re-derived. The storage
projection in `SPEC-REVIEW.md` §11.4 was **not** one of those: it was computed on 2026-09-03
against "~10 heavy names, ~90 thin" — i.e. already at 100. So **~120–180 MB/month against Neon
Launch stands as written**, and D-27 lands on the number that projection assumed. Any *other*
figure in this package dated before 2026-09-03 is still suspect.

**Why the top of the band is right, and it is not enthusiasm.** Breadth is close to free under
D-15: Reddit, Substack and market data are flat-rate or free per additional symbol, and **X spend
is governed by the trigger thresholds, not by universe size** (MT-12). The binding constraint on
X cost is when a window opens, not how many names are eligible to open one. Going narrow would
save almost nothing and would cost the thing that is genuinely unrecoverable — a name not in the
seed universe has no history from day one, and adding it later starts its series then, recorded
as a permanent coverage change (F22). **Breadth is the one dimension where forward-only
collection punishes caution.**

**F03's seed is unblocked.**

### D-28 — The OTP send cap stands (ratification)

**Ratifies an audit judgement, closing it as an owner decision rather than a reading.**

D-11 cuts "the OTP throttle machinery" without qualification. Read literally that removes the
per-hour and per-day send cap on the allowlisted address too. The audit kept the cap on the
reading that it was never multi-tenancy machinery, and flagged the call in F02 §4.2 as needing
ratification rather than leaving it silent. **The owner ratified: the cap stands.**

The residual risk it closes: the single allowlisted address is public knowledge to anyone who has
seen the app, and Resend's free tier allows 100 sends/day. Without a cap, anyone who knows the
address can exhaust that allowance and lock the owner out of their own system — a denial of
service against a one-user product, requiring no credential and no vulnerability.

**What is still cut, and this is the distinction:** per-email, per-IP and global *throttling*
tables, which existed to police a user population that does not exist. What survives is **one
constant** capping sends to **one** address. The verify-attempt cap (3 attempts, rotate on
resend, single-use) was never throttling and was never in scope for D-11's cut — it is what makes
a six-digit code safe at all.

### MT-13 — confirmed **not filed**. This is now the longest pole in the plan.

Not a decision; a status answer that changes the critical path. The Reddit Data API application
has **not** been submitted.

It costs **$0**, gates **the largest channel in the product**, and its lead time is unknown,
manual, and can end in a silent rejection. Nothing downstream shortens that queue, and no amount
of build progress substitutes for it. Every other blocker closed above was closed by a sentence;
this one cannot be.

**Consequence for sequencing:** Substack RSS is the only channel with zero lead time (free,
officially supported, no approval), so F04 builds against Substack first and Reddit second —
regardless of Reddit being the larger channel. Building Reddit-first would idle against an
approval queue.

**If it is rejected**, the Reddit axis can fall back to scraping reddit.com (§6.1's scraping
prohibition for Reddit has been lifted); D-16's forward-only ruling still rules out historical
archive backfill. That path carries the accepted ToS risk and is an engineering decision, not a
re-scoping conversation.

---

### D-29 — The Substack set is chosen by sector coverage

**Closes the basis half of MT-15 / OQ-8.** One or two publications per sector across the
100-symbol universe, rather than the set the owner already reads.

**Why this basis and not the convenient one.** "Publications I read" was available and would have
started collecting today. It was rejected because the Substack axis is supposed to measure
*expert narrative*, and a set drawn from the owner's own reading measures the owner's existing
information diet instead — the axis would then agree with its reader by construction, which is
worthless for decision support and worse than having no axis at all, because it looks like
corroboration.

**The cost, accepted:** sector coverage needs research the reading-list basis did not, and under
D-16 that research time is corpus. **This is the one place where the plan deliberately trades
days of collection for methodological soundness**, and it is worth recording that the trade was
made knowingly rather than by drift.

**Recorded basis, verbatim, for the Inspector:** *"One to two Substack publications per GICS
sector represented in the seed universe, selected for sector coverage rather than readership,
personal familiarity, or citation frequency."* Refine the wording when the list exists; do not
lose the fact that coverage, not popularity, is the selection rule.

### D-30 — The universe is the 100 most-discussed on Reddit, seeded via ApeWisdom, whose cross-check role is retired

**Completes MT-07.** The 100 names are the most-discussed on Reddit, ranked from **ApeWisdom**,
because the Reddit Data API is unapproved (MT-13) and ApeWisdom is the only keyless source that
can produce the ranking today.

**Two consequences, and both must be carried forward or the metric quietly lies.**

**1. ApeWisdom is no longer an independent cross-check on the attention axis.** D-12 demoted it to
exactly that role. An instrument that *selected* the universe cannot then *validate* attention
rank on it — it would be checking its own work, and the check would pass for that reason rather
than because the axis is right. **D-12's cross-check role is retired**, and the attention axis
either finds a genuinely independent check or carries the gap openly under §6.1. This is not a
small loss: F-05 originally accepted ApeWisdom *because* it was a cross-check, and that
justification is now spent.

**2. The selection is circular with the headline metric, and the disclosure must say so.**
Selecting symbols by social attention and then measuring social attention on them makes the
attention metric partly an artefact of the selection: names are in the universe *because* they
were discussed, so "these names are discussed" is not a finding. The honest framing is that the
attention axis measures **relative movement in discussion among already-discussed names** —
rank change, not level. R-01's `sample_adequacy` discipline covers the sampling; this covers the
selection, and it is a different disclosure.

**Recorded basis, verbatim:** *"The 100 tickers ranked most-discussed by ApeWisdom on the seed
date. The universe is selected by social attention and the attention metric is therefore not
independent of the selection; level is not interpretable, rank change is."*

**Named revisit:** re-derive the ranking from the Reddit Data API once MT-13 is approved. Every
symbol swapped is a `CoverageGap` under F22 — permanent and rendered. **A seed date is a
methodological commitment, not a convenience**, so re-deriving is not free and should be done
once, deliberately.

### D-31 — Market data starts on daily bars; the intraday upgrade has an evidence trigger

**Closes MT-14 / OQ-6 as a Wave 1 blocker.** The D-15 price trigger runs on **FMP Starter's
daily bars**, which the project already pays for. No new vendor, no new spend, and Wave 1 is
unblocked today.

**What this costs, stated rather than absorbed.** D-15 asks whether a name is *moving unusually
right now*. Daily bars answer that at daily resolution: a name that spikes and reverts inside a
session does not trigger. The mitigating fact is the one D-20 already relied on — social reaction
lags price by minutes to hours, so what the trigger samples is what people said *after* the move,
and a delayed trigger loses less than it appears to. **What is genuinely lost is intraday
spike detection**, and that is a real trim of I5, on top of the one D-20 already made.

**Named upgrade trigger:** **when daily bars are shown to miss spikes the corpus should have
sampled.** Concretely — a price move that a 15-minute bar would have caught, that the daily bar
did not, on a name that generated social volume. Until that is observed, the spend is not
justified; once it is, the adapter interface is unchanged and only the tier moves.

**Why an evidence trigger rather than a date.** A calendar trigger fires whether or not anything
justifies it, which is how deferred spend becomes permanent spend. This one cannot fire without a
missed spike to point at.

### D-32 — The X line is not funded until the price trigger is firing

**Completes MT-12.** D-20's thresholds are adopted as written — **$350 hard, $290 warn, $320
reduce-optional** — but the **X read ceilings start at zero** and the run rate starts near **$200
/month**.

**The reasoning is sequencing, not thrift.** X reads are spent *only* on trigger (D-15). Until
the trigger exists and is firing correctly, there is nothing to spend them on, and any X sampling
before then is untriggered — which is precisely the broad continuous sampling FIND-3 proved
unaffordable. Funding the line early would buy 30,000 reads/month distributed across quiet
tickers, which is the worst available use of the single most expensive input in the plan.

**Named switch-on trigger:** the price trigger (D-31, F16a §4.1b) is built, deployed, and
demonstrably firing on real price movement. At that point set the D-20 ceilings —
`X_MONTHLY_READ_CEILING` 30,000, `X_DAILY_READ_CEILING` 1,430, `X_READS_PER_TRIGGER_EVENT` 100 —
and the run rate returns to ~$350.

**Do not let this become a scope cut by neglect.** X deferred is not X dropped; D-23 already
defers the account taxonomy, and this must not quietly become the second half of removing X
altogether. If X is never switched on, that is a scope decision and gets its own entry.

### D-33 — Neon Launch, not Free

**Closes the tier question MT-03 never asked.** ~$19/month, already in D-20's allocation.

Recorded because the failure mode is invisible: Neon Free's 0.5 GB looks healthy through the
whole of Wave 1 and is exhausted in **three to four months** at the projected 120–180 MB/month —
and never recovers, because D-17 makes the corpus permanent by design. The data lost at that
point is forward-only and unrecoverable under D-16. **MT-03 asked only whether a Neon project
exists**, which is a question Free answers correctly, and that is why the gap survived three
review passes.

### D-34 — Vercel AI Gateway, and the verifier is a different vendor from synthesis

**Closes MT-06's transport half.** Vercel AI Gateway is the default transport: one integration,
unified spend visibility across providers, provider fallback, no token markup. The spend
visibility is load-bearing now that D-11 and D-32 leave the **global** ceiling as the only budget
control.

**The verifier runs on a different vendor entirely, not merely a different model.** DEPLOY's rule
was "a different model from synthesis — a model checking itself is not a check." Two models from
one vendor share training lineage and therefore share blind spots, and the specific failure this
verifier exists to catch — F-22's *fluent, well-cited, subtly wrong prose* — is exactly the
failure correlated models miss together. A same-vendor check would pass most of the time for the
wrong reason.

**Model IDs are not recorded here, deliberately.** ADR-017 requires the build agent to fetch
current IDs from the transport at implementation time and bind them through versioned config.
What is fixed is the **shape**: a cheap high-throughput route for relevance and collision, the
strongest available for synthesis, and a **different vendor** for verification and the judge.

### D-35 — The v1 labelled set is LLM-assisted with human audit, and the assist is disclosed

**Closes OQ-7.** The owner labels a subset, an LLM labels the remainder, and the owner audits
every disagreement. Stratified across Reddit, Substack and X, because D-09's Tier D1 bar is
macro-F1 ≥ 0.80 **per axis** and a pooled set can hide one axis failing.

**The circularity is real and is disclosed rather than denied.** Labels produced partly by an LLM
are used to grade a pipeline that contains an LLM. That is the circularity F-22 warned about, one
level up: a forgiving labeller and a forgiving classifier agree, and the agreement reads as
accuracy. Three things keep it honest, and all three are requirements, not suggestions:

1. **The human-labelled subset is drawn first and never shown to the labelling model** — it is the
   only part of the set with an independent ground truth, and per-axis accuracy on that subset is
   reported **separately** from the full-set number.
2. **Every human/LLM disagreement is adjudicated by the human**, and the disagreement rate is
   itself recorded. A suspiciously low rate is evidence of correlation, not of quality.
3. **The Tier D record states that the set is LLM-assisted**, so no future reader mistakes the
   0.80 for a fully human-labelled result.

**If the audited disagreement rate is low and per-axis accuracy on the human-only subset diverges
from the full set, the assist is contaminating the measurement** — fall back to fully human
labelling on a smaller set. A smaller honest number beats a larger one that cannot be trusted.

### D-36 — MT-15 is confirmed: 13 Substack publications, 10 of 11 GICS sectors

**Closes MT-15.** The owner confirmed the candidate list `DEPLOY.md` had drafted 2026-09-03 as
final on 2026-09-04, after a second research pass (2026-09-03) specifically on the one open gap.

**Utilities stays unfilled, by choice, not oversight.** Two search passes (eleven further
candidates on the second) found nothing that is both Utilities/power-sector-specific and posts
weekly or better — the same bar every other sector's pick clears. The closest topical match,
*Explaining the Grid*, was rejected on cadence alone (~monthly). The owner chose to run the axis
at **10 of 11 sectors with the gap disclosed** (§6.1) over forcing a weak or stale pick in. DTE,
ES and SO (all in the seed universe) simply have no Substack coverage on this axis.

**The redirect question is also closed, with no code change.** Doomberg and Net Interest 301-
redirect their `.substack.com/feed` URLs to custom domains; `apps/web/src/adapters/substack.ts`'s
plain `fetch()` call already follows redirects by default (Fetch/undici's `redirect: "follow"`),
so both slugs work as listed.

**What MT-15 closing does and does not unblock.** Collection was blocked on an owner decision;
now it is blocked on wiring the confirmed 13-publication list into F04's Substack collection
config — an engineering task for COLLECT, not a further manual task. See `DEPLOY.md` MT-15 for
the full table.

### D-RNI-01 — RNI is an isolated build lane with scoped precedence

**Owner decision, 2026-09-05.** Retail Narrative Intelligence is added to this repository rather
than replacing the existing product. `features/RNI-00-CONTRACT.md` and `rni/**` take precedence
only for the RNI namespaces they name. Existing features, routes, data and decisions remain
binding elsewhere. DATA, ENGINE and SURFACE may build in parallel only after the RNI contract
freeze; the RNI coordinator alone owns shared wiring, merging and master state.

### D-RNI-02 — Reddit discovery uses OpenAI Web Search and persists bounded evidence first

The RNI Reddit path has no Reddit Data API dependency. It uses OpenAI Web Search to discover the
configured subreddit sample and persists the original/canonical URL, returned post/comment body
or bounded excerpt, capture fidelity and relevant metadata before any interpretation job runs.
Whole webpage HTML, page chrome and unrelated content are prohibited. Search citations become
publishable only after they resolve to persisted evidence.

### D-RNI-03 — X is independent and the surface always exposes three conclusions

X is a complete sentiment datasource, not a fallback for missing Reddit evidence. Reddit and X
acquire, persist, classify, calculate, retry and report independently. User-facing synthesis has
three explicit sections—Reddit sentiment, X sentiment and combined summary—and preserves missing
or divergent platform states instead of filling or smoothing them.

### D-RNI-04 — Multi-security sources create per-security observations

One post can mention or compare multiple securities. It remains one source record but creates a
resolved mention and independent stance observation for every security, plus any comparative
relation. A bullish view of NVDA and bearish view of AMD cannot be stored as one blended label.

### D-RNI-05 — RNI uses OpenAI Direct by default without changing the legacy default

RNI task routes default to OpenAI Direct. An audited Settings choice can route future RNI runs
through Vercel AI Gateway. The selected/resolved provider and model are stored on each run and
model call. This scoped choice does not reverse D-34 for the existing application's global model
transport.

### D-RNI-06 — The RNI universe is the configurable current FMP S&P 500

The initial active RNI watchlist is the current S&P 500 membership obtained from FMP and resolved
against the existing security master. NVDA is the default selected security, not the corpus
limit. Sync is staged, versioned and fails closed on incomplete, ambiguous, duplicate, unresolved
or over-600 membership; `joshuai` approves production activation. The legacy 100-name seed and
historical migrations are not overwritten.

### D-RNI-07 — Scheduling, freshness and release authority are explicit

Manual refresh and scheduled collection call the same idempotent existing job path. The portal
shows attempt time, last successful refresh, data-through time, calculation time and per-source
status. The configured Reddit community list is versioned in Settings, including the combined
`r/Superstonk` + `r/GME` analytical cluster while retaining separate provenance. `joshuai` owns
production approval and human intervention recorded in `rni/DEPLOY.md`.

### D-RNI-08 — Source persistence is a frozen commit-returning cross-lane port

**Accepts CR-DATA-001, 2026-09-05.** DATA implements the additive
`RniSourcePersistencePort.commitSource` boundary; ENGINE depends only on that frozen interface.
The promise resolves after the source, retrieval and content-version transaction commits and
returns the durable source identity plus explicit per-record idempotency outcomes. ENGINE never
enqueues interpretation from a caller-proposed ID. Duplicate delivery returns the existing
committed ID with false insertion flags, preserving source-first ordering without importing a
DATA-private repository or duplicating transaction semantics in ENGINE.

### D-RNI-09 — pgvector remains deferred for the RNI vertical slice

**Resolves CR-DATA-003, 2026-09-05.** The relational claim, citation, theme, narrative and
membership schema is in scope; enabling the `vector` extension and persisting embeddings is not.
This follows the explicit deployment and integration-plan deferral and avoids introducing an
untested Neon prerequisite. A later embedding phase requires a separate migration, capability
gate and decision; migration `0022` must not contain a placeholder vector representation.

### D-RNI-10 — Storage-private semantic write shapes are composed only when consumed

**Defers CR-DATA-002 to I07, 2026-09-05.** DATA may keep its relational claim/theme/narrative
write inputs private while the storage slice is reviewed. The coordinator will freeze only the
smallest port required by an implemented ENGINE consumer during I07, rather than making every
table-shaped input a public cross-lane API in advance. Citation reads are handled separately by
D-RNI-12.

### D-RNI-11 — Universe candidate semantics are enforced by the synchronizer

**Resolves CR-DATA-004, 2026-09-05.** `rniUniverseSnapshotCandidate` remains a structural 1–600
member transport schema. The integration-owned FMP synchronizer is the authoritative fail-closed
boundary for complete-count, duplicate symbol, NVDA, active-security resolution and ambiguity
checks, and it stages only a validated candidate. DATA fixtures exercise those outcomes without
expanding the frozen schema into a repository-specific resolution result.

### D-RNI-12 — Citation IDs resolve through the frozen read service

**Accepts CR-SURFACE-01, 2026-09-05.** `RniReadService` adds the narrow
`getCitation(citationId)` method returning the already-frozen `RniCitation`. A surface resolves a
summary citation to source identity, platform, URL and bounded supporting text, then calls
`getEvidence(sourceItemId)`. It never treats citation and source IDs as interchangeable or joins
DATA-private tables directly.

### D-RNI-13 — Retail Radar reads are cursor-paginated and non-poolable

**Accepts CR-SURFACE-02, 2026-09-05.** `RniReadService.getRadarPage` returns the immutable run
lineage and a cursor page of canonical security identities paired with ticker, company name and
exchange. Every row has fixed `reddit`, `x` and `combined` cells. Reddit and X each carry their
own state, stance, sample count, coverage disclosure, confidence, freshness and citation IDs;
the shape has no shared source-count field. Combined state is explicitly pending, aligned,
divergent, partial or insufficient and cannot claim alignment/divergence while a platform is
non-terminal, missing or insufficient. This additive read model unblocks SURFACE without
exposing DATA repositories, inventing a second security catalogue or permitting one platform
to stand in for the other.

### D-RNI-14 — Security-detail dimensions remain complete, cited and platform-bound

**Accepts CR-SURFACE-03, 2026-09-05.** `RniReadService.getSecurityDetail(runId, securityId)`
returns canonical security identity plus fixed Reddit and X detail records. Each platform owns
exactly one assignment for all four frozen RNI dimensions, its independent status, eligible
source count, coverage, confidence, freshness, summary and citations. A publishable dimension
requires at least one persisted citation ID; an insufficient dimension is unscored. Pending,
running, failed or unavailable platforms may carry only insufficient dimension assignments.
There is no pooled count or unlabeled dimension array. This additive read model lets SURFACE
render the required comparison without joining DATA-private observations or inferring one
platform from the other.

### D-RNI-15 — FMP universe commands claim before dispatch and bootstrap from reviewed identities

**Closes universe review IR-02 and IR-04, 2026-09-05.** An FMP universe synchronization command
durably claims `(environment, idempotency_key)` before any provider request. One claimed key has
one terminal expected outcome; an active concurrent delivery observes the same running command,
and later delivery replays its terminal result without another provider call. The command record
binds provider-call, payload-hash and staged-version lineage. A distinct key may observe the same
provider payload and reuse the immutable staged universe, but receives its own command and
provider-call audit trail.

A clean environment is bootstrapped through a transactional, versioned import of a human-reviewed
FMP profile export into the canonical security master. The exact ordered 501–600-security array is
SHA-256-bound, must include NVDA and unique symbols, and fails closed on identity ambiguity. This
bootstrap does not activate a universe: `joshuai` separately approves and activates the exact
stored staged membership under D-RNI-06.

### D-RNI-16 — Abandoned universe commands fail terminally and staging is atomic

**Closes universe re-review IR-07 and IR-08, 2026-09-05.** A running FMP universe command has a
bounded lease longer than the provider wrapper's complete retry window. A concurrent request does
not poll, block or redispatch; it receives a retryable conflict with the lease expiry. When a
later request observes an expired claim, it atomically records an audited terminal abandonment
and returns that failed command. It never automatically repeats the external request; an operator
must inspect the audit and intentionally choose a new idempotency key.

Each completed provider attempt is persisted and bound to the still-running command in the same
transaction before control returns from the adapter call-log callback. Abandonment preserves that
binding, so a worker lost after dispatch cannot leave its already-recorded FMP attempt detached
from the terminal command.

For a valid candidate, immutable universe staging/reuse and successful command completion share
one database transaction. Failure or process termination between those writes therefore leaves
neither an orphaned staged version nor a falsely successful command. Expected provider and
validation failures remain terminal replayable command results with their available lineage.

### D-RNI-17 — Manual refresh exposes intent, durable identity and resolved scope

**Resolves CR-SURFACE-04, 2026-09-05.** The shared command boundary accepts a required
idempotency key plus either one ticker or `full_universe`; clients do not choose active
configuration, universe, model route or analysis windows. Server composition resolves those
versioned inputs, applies authz/audit, and returns one durable run ID with an `accepted` or
`duplicate` disposition and a scope preview. Ticker previews include canonical security identity,
company, exchange and universe version. Full previews include active universe version and a
positive security count capped at 600.

An exact same-key replay returns the original run and preview without a second execution. Reusing
the key for a different scope fails closed. S07 may implement fixture-backed controls against this
interface; I09 owns its durable job/queue and HTTP composition.

### D-RNI-18 — Universe selection reads active membership and immutable staged impact

**Resolves CR-SURFACE-05, 2026-09-05.** A separate read-only `RniUniverseReadService` exposes
active universe metadata and canonical NVDA default, a case-insensitive ticker/company search
bounded to 50 members of that exact active version, and a requested immutable staged preview.
The active discriminated union preserves the actual 100-member legacy seed with null provider
lineage during first deployment, while FMP active/staged variants require 501–600 members and
complete retrieval/hash lineage. Search never reads the broader security catalogue or calls FMP.
An empty query is only a bounded initial list, not an unbounded export.

The staged response carries distinct active and staged version identities, retrieval times and
payload hashes, requires the staged version to name the displayed active parent, and returns the
complete unique, disjoint canonical additions and removals. Those changes must reconcile exactly
from active to staged member count and cannot remove/add more identities than those populations
contain. I08 additionally verifies set membership against stored versions. The service has no
mutation, approval or activation method; existing D-RNI-06 human-governed activation is unchanged.

### D-RNI-19 — Catalyst publication is claim-bound, point-in-time social corroboration

**Accepts CR-ENGINE-001 and completes D-RNI-10 at I07, 2026-09-05.** The P0 source vocabulary
remains Reddit and X. Separate persisted social evidence may `corroborate` or `challenge` a
catalyst claim; it is not described as independent factual verification. Adding issuer,
regulator, exchange, filing or news evidence is a later source-rights and source-kind decision,
not an inference made by ENGINE.

Before the integration branch merges, coordinator-owned migration `0024` will append the minimum
durable representation for: separate verifier and challenger model invocations; a run/security/
claim/policy/cutoff-bound catalyst assessment; claim-specific source, corroborating and
counterevidence citation roles; exact platform-analytics citation lineage; challenger selection;
and ordered publication statements with sentence-to-citation edges. The I07 composition port
returns trusted persisted claim and invocation snapshots to ENGINE and stores the accepted
assessment/publication trace. Caller-declared text, cutoff, role or model identity is never the
authority.

Point-in-time eligibility requires claim evidence to have been discovered and observed no later
than the assessment cutoff. Corroborating and counterevidence sources additionally require a
verified non-null `published_at` no later than that cutoff. Evidence outside that boundary never
enters the affected model input. Publication revalidates the platform-canonical URL and active
rights-policy version. Absence remains `unverified`, never false, and every non-coverage sentence
retains at least one persisted citation edge.

### D-RNI-20 — AI route settings create future config versions, never rewrite runs

**Accepts CR-SURFACE-06, 2026-09-05.** `RniAiRouteSettingsService` exposes the active RNI config,
selected Direct/Gateway route, server-resolved task-level model identities and the availability of
both choices. It exposes no credential, endpoint token or client-selected model ID. OpenAI Direct
is the default. Gateway model slugs remain configured data and are not hardcoded into the frozen
contract; an unconfigured Gateway remains visible but unavailable.

The update command accepts only an idempotency key, route intent and bounded reason. Auth, audit
actor, route capability/credential checks, cloning the active configuration, resolving models and
activating the successor are integration-owned. Success creates a new immutable config version
used only by runs requested afterward. Exact same-key replay returns the committed result; a key
reused for different intent fails. Historical `rni_run.ai_route`, config version and per-call model
lineage are never updated. I10 composes live Direct/Gateway routing and I08 composes the
authenticated Settings API; SURFACE S09 consumes only this service through a fixture.

### D-RNI-21 — Balanced RNI model routing and initial AI spend limits are owner-approved

**Owner decision, 2026-09-05.** OpenAI Direct remains the default RNI route. Reddit discovery,
security relationship resolution and semantic classification use `gpt-5.6-terra` with low
reasoning effort. Catalyst verification and challenger calls use `gpt-5.6-sol` with low reasoning
effort. Vercel AI Gateway is an explicitly selected parity route to the same OpenAI model family;
it must not silently fall back to another provider or an unevaluated model. I10 must capability-
check configured Gateway model slugs rather than hardcode them into a frozen contract. If either
approved model is unavailable, the affected route is unavailable until a separately evaluated
successor configuration is approved.

The initial RNI AI-spend policy is USD 2 hard maximum per manual ticker run, USD 25 hard maximum
per full-universe run, USD 50 hard maximum in a rolling 24-hour period, a USD 300 calendar-month
warning and a USD 500 calendar-month hard stop. Enforcement includes model-token and OpenAI Web
Search tool charges routed through Direct or Gateway; X and FMP commercial charges remain separate
provider controls. Pre-dispatch checks reserve the worst-case governed call cost, fail closed when
a hard boundary would be exceeded and never rewrite historical usage. The limits are an initial
demo baseline and may change only through a later owner-approved, versioned configuration after a
measured full-universe run.

### D-RNI-22 — Semantic persistence crosses lanes through one atomic E05 result

**Accepts CR-DATA-002 for I07, 2026-09-05.** ENGINE classification remains SQL-free and DATA's
relational row inputs remain private. The integration-owned `RniSemanticPersistencePort` accepts
only a durable run ID, the already-persisted source identity and the complete validated E05
classification result. Its implementation commits observations, claims, claim-source citations,
themes and noise assessments atomically, then returns the durable identities selected by storage.
It never exposes table-shaped write arguments back to ENGINE.

The coordinator wrapper reads committed bounded evidence and completes every independent
per-security classification before it invokes the port once. A failure for any security writes
nothing; an exact redelivery returns `duplicate` with the original durable identities; reusing a
semantic identity for different content fails closed. This port does not decide catalyst evidence
roles, model routes, rights policy or publication. Those remain the separate D-RNI-19
assessment/publication boundary and I10 server-owned routing/configuration work.

Migration `0024` supplies the corresponding additive storage without rewriting historical rows:
claim dimension, immutable run/observation membership and one exact semantic-quality sidecar per
observation. Multi-ticker content therefore has separate run membership and quality lineage for
each source/security observation. The DATA adapter owns the transaction over these additions and
the existing observation/claim/citation/theme tables.

### D-37 — F02 moves from OTP to email+password; the owner-decided cuts around it stay

**Supersedes the "OTP sign-in is kept" clause of D-11/D-28.** The owner asked, directly, to
replace six-digit email codes with email+password. Everything else D-11 decided about this
feature is unaffected and still holds: one account, no open population beyond the allowlisted
address, no per-account budgets, no `pending` tier — only the credential mechanism changed.

**The shape kept from the OTP model, translated rather than dropped:**

- **Allowlist-before-creation, not allowlist-before-authorization-only.** The old model gated
  whether an OTP was ever mailed; the new model gates whether an *account can be created at all*
  (`databaseHooks.user.create.before`, `src/services/auth/instance.ts`) — structurally the same
  guarantee (every entry point is forced through it), applied one step earlier because password
  auth has no equivalent "the code was never sent" checkpoint to hang the gate on.
- **`requireEmailVerification: true` replaces OTP's implicit mailbox-proof.** An OTP could only
  ever reach someone with the real mailbox open; a password can be typed by anyone who *knows*
  the allowlisted address (D-28's own point: it is public knowledge). Requiring the mailed
  verification link before an account can sign in restores the same property — the real owner is
  still the only one who can produce a *usable* account — without which self-service sign-up
  would have been a straightforward account-takeover path.
- **D-28's send cap survives, now covering two mail paths** (verification-on-sign-up,
  forgotten-password) instead of one. The reasoning is identical: a public, single admin
  address is a denial-of-service handle against Resend's daily quota without a cap, cap or no
  cap has nothing to do with the population size that D-11 actually cut.
- **The fixture-mode-bypasses-the-gate property is preserved deliberately**, not an oversight:
  account creation's allowlist gate is `live`-mode only
  (`isAccountCreationAllowed`, `src/services/auth/allowlist.ts`), mirroring `decideAndSend`'s own
  fixture short-circuit under OTP. This is what lets `tests/e2e/auth.spec.ts` build a genuinely
  signed-in, non-allowlisted session to prove `requireAdmin()`'s negative path — a property that
  needs to exist independent of whether an account could ever really be created for that address.

**What changed, cleanly:** the credential is a password (Better Auth's own hashing, not a field
this codebase defines) instead of a hashed 6-digit code; sign-up is self-service rather than
implicit-on-first-code; two new mail paths (verify, reset) replace the one OTP send. `/sign-up`,
`/forgot-password` and `/reset-password` are new routes; `/sign-in` no longer takes a two-step
code flow.

**One real, new failure mode this introduces, and its fix.** Unlike OTP, the password flow mails
*absolute* URLs built from `BETTER_AUTH_URL`/`APP_BASE_URL` that a browser must navigate to
directly, and a session cookie is host-scoped. A wrong or defaulted `BETTER_AUTH_URL` in
production means a real verification/reset link points at the wrong host and its cookie never
reaches the real site — `DEPLOY.md` MT-02 now calls this out explicitly, and
`playwright.config.ts`'s `webServer.env` sets it to match Playwright's own `baseURL` for exactly
this reason (found running the new e2e suite: `page.goto(verifyUrl)` landed a valid session
cookie that a subsequent relative-path `page.goto('/dashboard')` never carried, because the
mailed link's host and Playwright's own host differed even on the same port).

### D-38 — Multi-account is allowlist-driven (already largely built); a seeded `welcome1` credential adds a second onboarding path alongside D-37's self-service one

**"Is it hard to allow multiple accounts?" — no, mostly already done.** `ADMIN_EMAIL_ALLOWLIST`
(`env.ts`'s `emailAllowlist` schema) was always comma-separated and every authorization check
(`isAllowlisted`, `requireAdmin`) already iterates it — adding a teammate has never needed a code
change, only a longer env var. What this decision actually adds is a second way for an
allowlisted address to *get* its first credential, at the owner's request.

**The two onboarding paths, explicitly, since D-37 already built one:**

1. **Self-service** (D-37): visit `/sign-up`, choose a password, verify by clicking a mailed
   link. Requires the real mailbox to be reachable.
2. **Seeded** (D-38, new): sign in at `/sign-in` with the known constant `welcome1`. If the
   address is allowlisted (in `live` mode) and has no account yet, one is created on the spot —
   pre-verified, no mailed link at all — signed in immediately, and flagged so every protected
   route redirects to `/change-password` until a real password is set. Owner-specified exact
   string, not a generated one: the point is a credential that can be told to a teammate directly
   ("your login is X, temporary password is `welcome1`"), not one requiring a side channel.

**Why a known, shared password is an acceptable trade-off here, named rather than hidden.**
Anyone who knows both an allowlisted address and the string `welcome1` can claim that account
before its intended owner does — this is the well-understood cost of every default-password
onboarding scheme (the same one Windows, Jira, and most enterprise software accept), not a new
category of risk this codebase invented. It is mitigated by the same fact D-28 already leans on:
the address itself is assumed public, so the operator's actual secret is telling the *right
person* the credential quickly, same as any temporary password. `changePassword`
(`flow.ts`) revokes every other session on a successful change specifically to close the "someone
else raced me to it" window the moment the real owner sets their own password.

**Structurally, `mustChangePassword` is unreachable by the client that would benefit most from
forging it.** It is declared `input: false` (`instance.ts`) — the public `sign-up`/`update-user`
endpoints refuse to set or clear it from a request body at all (Better Auth throws
`FIELD_NOT_ALLOWED`). The only two writers are `seed-account.ts`'s
`provisionSeedAccountIfEligible` (sets it) and `clearMustChangePassword` (clears it, reached only
after `auth.api.changePassword` has independently verified the caller's current password) — both
go through `auth.$context.internalAdapter` directly, bypassing the route layer `input: false`
restricts, which is exactly why that restriction is safe rather than merely decorative.

**The gate is enforced in `requireUser()` itself, not per-page.** A new `PasswordChangeRequiredError`
(`session.ts`) is thrown there, alongside `UnauthenticatedError`, so every one of F02's existing
call sites — all fifteen pages and eleven API route handlers that already had to catch
`UnauthenticatedError` per §4.4's non-negotiable — catches this the same way, redirecting to
`/change-password` (pages) or answering 401 (API routes). `/change-password` itself calls
`getSession()` directly, never `requireUser()`, since triggering that error is exactly the state
the page exists to resolve.

**Reuses D-37's `isAccountCreationAllowed` fixture-mode bypass, deliberately, for the same
reason.** `provisionSeedAccountIfEligible` calls the same allowlist check `databaseHooks.user.
create.before` does — `live`-mode only — so in fixture/e2e mode any address plus `welcome1`
auto-provisions, matching self-service sign-up's own fixture behavior and needing no separate
test seam.

---

## 2. Rulings made during review

Each closes a finding in `00-ADVERSARIAL-REVIEW.md`. Rationale is there; recorded here so a
successor does not silently reverse one.

| ID | Ruling | Closes | Lands in |
|---|---|---|---|
| R-01 | `confidence` on stance is renamed `sample_adequacy`; the output is "stance of sampled snippets"; selection bias is disclosed in the registry and rendered on the page | F-03 | F06, F09, F10 |
| R-02 | New accounts start `pending` and cannot reach any priced path; per-account budgets exist alongside global; OTP sends are throttled per email, per IP, and globally | F-04 | F02, F18 |
| R-03 | ApeWisdom methodology version is pinned per snapshot; rank change across a version boundary is `not_applicable`; an attention-unavailable degraded mode is a DoD item | F-05 | F04, F06, F08, F18 |
| R-04 | The snapshot collector is a Wave 1 deliverable; the z-score is hidden below 14 comparable snapshots; history depth is tracked in `PROGRESS.md` | F-06 | F08, MT-08 |
| R-05 | An artifact is one **computation invocation**, not one rendered pixel; series carry `points[]`; a chart point is `{calculationId, pointIndex}`; retention 90 days except claimed/shared/issued | F-07 | F05 |
| R-06 | Development and CI default to `PROVIDER_MODE=fixture`; a server-side quota ledger refuses before dispatch; news with n<3 is `insufficient_data` | F-08 | F04, F06 |
| R-07 | Alpha Vantage is demoted to `CONGRESS_TRADES` behind a flag in Wave 4; cross-checking moves to FMP's own DCF/consensus and SEC XBRL | F-09 | F15 |
| R-08 | Eight deterministic verification checks are enumerated and carry the load; the model pass is measured on a seeded-error corpus (B7/B8); a verifier timeout withholds prose | F-10 | F11, F12 |
| R-09 | Wave 1 is a walking skeleton built by one agent; parallel lanes begin in Wave 2 on contracts that survived a live round trip | F-11 | `03-ROADMAP.md` |
| R-10 | Hobby for Waves 1–4, private/invited only; Pro gates any public demo; the 30 s budget is decomposed per stage with a partial-result path | F-12 | F11, MT-09 |
| R-11 | Source §20's DoD becomes the Wave 5 release gate; every feature carries its own DoD | F-13 | all features |
| R-12 | CI is F01's first deliverable and is blocking; a locally-green/CI-red state is a hard stop | F-14 | F01, `04-BUILD-LOOP.md` |
| R-13 | Admin email is verified before F02 merges; a boot assertion logs the configured address | F-15 | F02, MT-00 |
| R-14 | Golden tests run on frozen fixtures; live smoke is separate and never gates a merge | F-16 | `05-TEST-STRATEGY.md` |
| R-15 | Every divergence state carries a fixed no-forecast disclosure emitted by the method; "signal" is banned; a copy lint enforces both | F-17 | F06, F17, F19 |
| R-16 | A user-data lifecycle document is a deliverable of F02; legal copy is a flagged manual task | F-18 | F02, MT-10 |
| R-17 | Evidence carries `availability` and the snippet as retrieved; an unreachable source is labelled, never repaired, never invalidating | F-19 | F09, F10 |
| R-18 | `research_run` gains a `retracted` state with reason and actor, visible everywhere, deleting nothing | F-20 | F11, F19 |
| R-19 | Hugging Face shadow evaluation is cut to a post-PoV spike; the seven `HF_*` variables are removed | F-21 | F01, `PROGRESS.md` deferred |
| R-20 | The judge is calibrated once against human scores and adversarially validated against seeded errors | F-22 | F12, MT-11 |

---

## 2b. Rulings made during the build

Same standing as §2 — recorded so a successor does not silently reverse one. These were decided
while implementing, which is why they are separated: §2's rulings close a review finding, these
close a question the specification did not anticipate. **Newest first.**

### B-30 — Production had never deployed (CVE gate on `main`'s Next.js), and three lane files had drifted five merged PRs behind the tree

**Two independent findings from one deployment-health check, 2026-09-04.**

**1. Every Vercel production deploy since the project's creation had failed.** All of them errored
with `VULNERABLE_NEXTJS_VERSION` — Vercel hard-blocks any build on Next.js 15.0–16.0.6
(CVE-2025-66478), and `apps/web/package.json` had stayed pinned to 15.5.4 through every PR merged
since. A prior session had already root-caused this and verified a fix (bump to 15.5.7) in a
preview deploy; Vercel's own bot had independently opened a second, CI-green fix (PR #11, bump to
15.5.9). Neither had been merged — the fix existed twice over and sat unused. Merging PR #11
produced `investment-sentiment-analysis.vercel.app`'s first-ever successful production alias.
**Lesson:** a green CI check on a PR says nothing about whether that PR is *merged* — an
unmerged, fully-verified fix is still a live outage. Check open PRs, not just CI status, when
diagnosing "why has this never deployed."

**2. `PROGRESS.md`, `progress/surface.md` and `progress/collect.md` had fallen five merged PRs
behind `main`.** F08 (PR #15), F09 (PR #16), F04's X adapter (PR #14), F04's market-data collector
(PR #13) and SPINE's jobs repository (PR #12) were all merged to `main` with green CI, but none of
the three coordinator-owned state files were updated to say so — `surface.md` still read "F08 …
32 rounds … not yet merged" and "F09 … not started" days after both had merged. A separate stray
branch (`claude/repo-build-loop-4ohbrp`) turned out to carry an entire independent, unmerged
rebuild of the whole application from an earlier common ancestor, with its own (also-unmerged)
doc updates narrating a different commit history — not usable as a source of truth for `main`,
even though its prose was superficially the right shape. Corrected 2026-09-04 by reading `main`'s
actual PR/commit history directly, per this file's own rule that the tree wins over the docs.
**Lesson:** the "one writer per state file" discipline prevents *concurrent* corruption; it does
not catch a writer who simply stops updating after a merge. A coordinator picking up an
apparently-idle build should diff the lane files' merged-PR claims against `git log`/the GitHub PR
list before trusting either.

### B-29 — Idempotency-key design is per-table, not one rule; an unbounded-corpus scan window must be sized from measured cost, not a row-count projection (market/evidence/sentiment repositories)

Built alongside `attention_snapshot`'s repository (B-27) as the third and fourth-through-fifth
table families needing the same judgment call: what makes two writes "the same observation, not a
revision" differs by what each table's own schema actually provides, and there is no one rule that
covers `market_snapshot`, `price_return_snapshot`, `evidence_item` and `sentiment_snapshot` alike.

**The pattern, so a fourth or fifth table doesn't re-derive it from scratch:**
- **Raw-hash-based** (`market_snapshot`, `evidence_item`) — when the table carries a `raw_hash`
  column, two writes with an identical hash for the same real-world identity are the same
  observation; a different hash is a genuine revision and gets a successor row.
- **A real `ON CONFLICT DO NOTHING` against the primary key** (`price_return_snapshot`) — when the
  table has no revision column (no `ingested_at`, no `raw_hash`) because its identity columns
  already fully determine the value, the database's own uniqueness is the correct and simplest
  idempotency check.
- **Full-column value-equality** (`sentiment_snapshot`) — when there's no `raw_hash` but the table
  is still bitemporal, the *only* correct equality check compares every real value column, not a
  convenient subset. `sentiment_snapshot`'s first attempt at this (round 2 of PR #10's review)
  compared 5 of 10 real columns and silently dropped a genuine revision that only moved the
  positive/neutral/negative/unclear count breakdown — found because the reviewer read the
  migration's actual column list rather than trusting the code's own claim about what "nothing
  else in this schema" meant.

**The scan-window lesson, found the hard way in the same PR's round 4:** `evidence.ts`'s
`evidenceForSecurity` needs to dedupe a security's evidence items before applying a caller's
`limit`, which means scanning a bounded candidate window rather than the whole (potentially
unbounded, forward-only-under-D-16) table. The first version sized that window
(`CANDIDATE_SCAN_LIMIT`) at `1_000_000`, justified by a row-count projection ("even at 50
items/day, that's ~55 years") that was both the wrong volume assumption (a single heavily-discussed
ticker pools Reddit, X, Substack and news together and can realistically hit ~300/day) and the
wrong kind of argument — it never asked what scanning 1,000,000 rows actually *costs*. Measured:
~4.25s and 268MB of heap at 100,000 rows, extrapolating to ~42s/~2.7GB at the stated design point —
enough to blow F09's own p95<3s DoD budget on this read alone, and an OOM risk in a memory-capped
serverless function. Lowered to `5_000` (measured ~190ms/28MB, and because the query plan uses an
index scan bounded by the limit, cost stays flat even against a 1,000,000-row table underneath).

**Ruling:** a bounded scan window over an unbounded, permanent, forward-only corpus (D-16, D-17)
must be sized from a measured cost against the actual DoD latency/memory budget it feeds, with a
disclosed `truncated`/overflow signal for the case it's exceeded (so a moderate window stays
*honest* rather than silently under-counting) — never from "how long until this number is
theoretically reached," which is the reasoning that produced the wrong constant the first time.

### B-28 — better-auth's `resendStrategy: 'rotate'` has no defined winner on a `createdAt` tie (F02, cross-cutting)

A CI-only integration test failure recurred identically on three unrelated PRs (F02's own merge,
a one-line CI workflow fix, the `attention_snapshot` repository addition) and never reproduced
locally across 38+ attempts, which is why it was first treated as an environment flake (one
re-run spent per this repo's CI-red protocol, a standing-down comment posted). It is not one.

Reading better-auth's installed source (`plugins/email-otp/routes.mjs`,
`db/internal-adapter.mjs`) found the actual mechanism: with `resendStrategy: 'rotate'` (this
codebase's configuration, `services/auth/instance.ts`), a resend does not delete the prior
verification row before creating a new one on the normal path — only inside a `.catch()`
triggered by a storage-layer conflict. It relies entirely on `findVerificationValue`'s
`ORDER BY createdAt DESC LIMIT 1` to prefer the newer row, with **no secondary sort key**. Two
`sendVerificationOTP` calls landing in the same millisecond tie on `createdAt`, and a tie has no
defined winner — a stable sort keeps the *first*-inserted row first, exactly backwards from what
rotation needs. Proved by a scratch reproduction test under a frozen fake clock, which forced the
exact CI failure signature on demand locally; CI runners' coarser timer resolution is why this
was reachable there and essentially never on a fast local machine.

**Ruling:** the test is the only thing this build controls, so the fix is there —
`vi.useFakeTimers()` plus a real clock advance between the two `sendVerificationOTP` calls, so
the two rows are never created in the same tick. This is not upstream's bug to file yet without
more evidence, but **it is a genuine property of the running system, not only a test artifact**:
two fast resends in production could tie the same way and leave which code is "current"
undefined. If this is ever observed live (a user reports a just-requested code being rejected
right after a rapid double-resend), the fix belongs in `services/auth/instance.ts` or upstream —
not in loosening this test again.

### B-27 — `attention_snapshot`'s idempotency semantics and "comparable" definition (cross-lane repository)

Built as a standalone SPINE task (no `F##` names it) once scoping F08 found that F08's collector
and F04's persistence half both need `attention_snapshot` repository functions that neither lane
could write itself (`src/repositories/` is SPINE-owned). Two decisions here are precedent-setting
for the next bitemporal snapshot table, not just implementation detail:

**Idempotency semantics:** a repeated write with an identical `raw_hash` for the same
`(security_id, source, observed_at)` silently no-ops (returns the existing row, `inserted:
false`); a write with a *different* `raw_hash` for the same key is a genuine revision and writes
a successor row — never an UPDATE, matching this codebase's existing bitemporal discipline
(B-08/B-11/B-12). A concurrent double-insert race that ties on the full unique check is caught as
a Postgres `23505` and handled as a no-op read-back rather than left to throw.

**"Comparable" definition:** two snapshots are comparable — the set F06's z-score depth gate and
F08's `HistoryDepth` both count over — when they share both `source` **and**
`provider_methodology_version`. `countComparableAttentionSnapshots` is implemented as a thin
wrapper over `attentionSnapshotHistory` specifically so the two functions cannot independently
drift on this definition; the original draft applied the methodology filter only to the count
function, which a `lane-review` round caught as a boundary-crossing bug (a superseded revision on
the far side of a methodology version change could still inflate the depth count).

**Deferred, named rather than assumed closed:** no unique constraint on
`(security_id, source, observed_at)` alone exists yet (only the 4-column bitemporal primary key,
which includes `ingested_at`) — a genuinely concurrent double-dispatch whose `ingested_at` values
don't collide to the millisecond can still land two rows. In production the dispatcher's Redis
lock already makes a duplicate delivery a no-op before it reaches this function; closing this
fully needs a migration, out of scope for a `repositories/`-only slice. Similarly, no
database-level trigger rejects UPDATE/DELETE on `attention_snapshot` the way it does on
`calculation_snapshot`/`audit_event` — "never overwrite" is an application-layer convention here,
not yet a hard DB guarantee.

### B-26 — Per-axis threshold re-derivation concluded "unchanged, for a stated reason" on two of three thresholds (F06)

`PROGRESS.md` flagged three abstention thresholds — `min_items ≥ 5` for stance, `min_articles ≥
3` for news, `display_floor ≥ 8` — as requiring re-derivation before F06 merges, since all three
were originally calibrated against a 5–12-snippet Linkup sampling regime D-12 replaced. A first
draft of the X and Substack stance registrations lowered `min_items` to `3` by analogy with
news's own floor, reasoning that X's 15-minute-resolution, event-conditional sampling (D-15)
would otherwise abstain on nearly every window.

**Ruling: `min_items` cannot move, on any axis.** `01-PRODUCT-SPEC.md` §6.3 states *"n < 5
relevant items ⇒ no stance score"* as a binding invariant, and Tier B's B5 gate requires **zero**
thin-sample stance scores at n < 5 with no per-axis carve-out — this is exactly `CLAUDE.md`'s "a
lane may not lower a locked invariant to fit a hard case; a needed contract change is reported,
not made." The real problem the first draft was reaching for is real and stays disclosed rather
than solved: X is expected to abstain on most windows under D-15's sampling, and that is a
property of the axis, not a defect in the threshold. `display_floor` was similarly tried at `5`
for X and Substack and reverted to `8` (Reddit's original value) — `5` against a `min_items` of
`5` is a degenerate, empty low-adequacy band, worse than not distinguishing the band at all.
`min_articles` for news was left at `3` because it is not an independently chosen number to begin
with: it is Marketaux's own free-tier per-request article cap, so the abstention floor and the
API ceiling are the same fact, and there is nothing to re-derive without changing provider.

**What "re-derived" means here, since two of three thresholds did not move:** each was
individually reconsidered against the actual (not the assumed) sampling regime per axis, and the
two that stayed the same did so for a reason recorded next to the value — `registry.ts`'s
`officialAssumptions` doc comments on `social.stance_x` and `social.stance_substack` — not by
inertia or an unexamined copy from Reddit. `display_floor` alone (never `min_items`, which B5
locks) carries a named revisit trigger: `DEPLOY.md` MT-08 + the relevant channel's collection
running 14 days, re-derived against the observed per-window item-count distribution once real
data exists to derive it from.

### B-25 — A window-based analytics method requires *exactly* its window, not *at least* it (F06)

`readSeries(ctx, prefix, count)` reads a fixed positional slice, `${prefix}_0..${count-1}` — the
*oldest* `count` of however many `${prefix}_N` inputs are declared, never the most recent. Five
methods (`price.regime`, `price.volatility_20`, `technical.moving_average_{20,50}`,
`technical.recent_{high,low}_20`, `technical.rsi_14`) guarded only `available < WINDOW`, on the
reasonable-looking assumption that a caller handing in *more* history than the window "just works,
the method takes what it needs." It does not: more than `WINDOW` silently computes over a stale
window ending days or weeks in the past, with no error and no warning — a wrong number rendered as
a current one. Round 3 of F06's `lane-review` found this by concretely constructing 25 closes (20
of one value, 5 of another) and showing `technical.moving_average_20` returned the wrong figure
with `eligibility: 'ok'`.

**Ruling:** every one of these methods now abstains (`below_sample_threshold`) on `available !==
WINDOW`, not `available < WINDOW`, and each registry `eligibilityRules` entry states the two-sided
contract explicitly ("exactly N, no more and no fewer") rather than only the lower bound. The
alternative — trimming to the most recent `WINDOW` when handed more — was rejected: it would work
today because every current caller already declares exactly the window, but it would silently
paper over a caller bug in the future (a caller that meant to declare the window and accidentally
declared more), the exact failure mode this ruling exists to catch. Abstaining is more expensive to
a careless caller and strictly safer.

### B-24 — A per-item scoring rejection is charged only when the same response also admitted something else (F20)

F20's scoring queue attempts to lease and score items in batches from a pinned model service. When
a batch is fully rejected — every item comes back `contractRejected` — there is no way to tell
whether the *items* are bad or the *scorer* is down/misbehaving from that response alone. Charging
every rejection toward `maxAttempts` risks permanently burning through a healthy item's attempt
budget during a transient scorer outage; never charging any rejection risks a backlog that never
drains for a genuinely malformed item.

**Ruling:** a rejection counts toward `maxAttempts` only when `result.data.admitted.length > 0` in
the *same* response — proof the scorer is working and this specific item is the exception. A fully
rejected or solo-leased item is never charged. The accepted cost, disclosed in a code comment
rather than left implicit: a single permanently bad item that ends up alone in the queue (every
healthy item already scored and cleared) can sit in the backlog forever, never exhausting into
`unscoreable`. Two earlier attempts at a cleverer rule (each tried during this build) introduced
their own regressions and were reverted; this is the version that survived five rounds of
adversarial review with no counter-example found. If the permanently-stuck-solo-item cost proves
material in production, the fix is a separate, explicit staleness sweep — not a change to the
per-batch charging rule, which would reopen the outage-mislabelling risk this ruling exists to
avoid.

### B-23 — `drainScoringQueue`'s real-outage stop is unconditional and checked before the no-progress stop (F20)

The drain loop needs two different stop conditions that must never be merged into one: a real
scorer outage (`!outcome.scorerAvailable`) must stop the loop **immediately, regardless of what
else happened in that pass**, while a healthy-but-stuck pass (nothing scored, nothing unscoreable,
nothing abandoned) must also stop, so the loop cannot spin forever on residual, un-drainable
backlog. Across several charging-model rewrites this build's outage check drifted into being
combined with the no-progress check, which could either mask a real outage behind a pass that
happened to make partial progress, or fail to stop on a healthy pass that legitimately made no
progress.

**Ruling:** `if (!outcome.scorerAvailable) break;` is checked first, unconditionally, before the
separate `if (outcome.scored === 0 && outcome.unscoreable.length === 0 && outcome.abandoned.length
=== 0) break;`. The two conditions are deliberately not combined into one expression — order and
independence are both load-bearing, and a future edit that folds them together is very likely to
reintroduce this defect.

### B-22 — Reddit's stance series is split in two, post and comment, never blended (F20, F06, F10)

F20's `stanceGate` (`apps/web/src/services/jobs/stance-availability.ts`) flagged, rather than
quietly resolved, a real conflict between two rules that both trace to this spec: F20 §4.1 routes
a Reddit **post** to FinBERT and a Reddit **comment** to Twitter-RoBERTa (`routing.ts`), while F20
§5 / Tier D3 rejects any window whose scores carry more than one `scorer_version`. Taken together,
a Reddit stance window that legitimately contains both forms can never be scored — not a bug, a
structural certainty, and the module's own doc comment named it as a decision for F06/F10, not
F20's to make.

**Ruled, put to the owner 2026-09-03: split Reddit into two independent stance series — Reddit
posts and Reddit comments — each single-scorer by construction, exactly as D-14 already treats
Reddit/X/Substack as three separate axes never blended as the stored primitive.** This is that
same principle applied one level deeper, not a new one: a Reddit post and a Reddit comment are
scored by different pinned models for the same reason X and Reddit are scored differently from
each other — they are structurally different objects — so they are never entitled to share one
number any more than Reddit and X are.

**What this does and does not touch, checked before recording:**

- **F20 needs no code change.** `stanceGate` already operates correctly on whatever window it is
  handed; nothing in that branch currently assembles a combined post+comment window (no caller of
  `stanceGate` exists yet), so there is no live mixing bug to fix, only a future one to prevent.
  The module's "this note is the flag" comment should be updated to point here once F20 next gets
  a review pass.
- **F06 needs no code change either**, on inspection. `social.stance_reddit`
  (`apps/web/src/analytics/registry.ts`) is a pure numeric method over already-shrunk
  `signed`/`relevance`/`confidence`/`age_hours` arrays — it has no concept of `scorer_version` and
  is agnostic to which population (posts, comments, or in principle both) fills those arrays. The
  mixing rule lives entirely in F20's gate, one layer below where F06 ever sees the data.
- **The obligation lands on F10** (not yet started): whatever assembles a Reddit window must call
  `stanceGate` twice per ticker-window — once for posts, once for comments — and must not merge
  the two results into one number even when both are eligible. Whether that means two registry
  entries (`social.stance_reddit_post` / `social.stance_reddit_comment`) or one method invoked
  twice with a `form`-qualified subject is F10's design choice to make against F06's registry
  conventions at build time — recorded here so it is not re-litigated as a surprise, not so it is
  pre-decided.

### B-21 — MT-07's ranking excludes ETFs; two false-ETF signals surfaced while pulling it

**Numbered out of chronological order — see the 2026-09-03 handoff note in §5.** This closed
before B-20 in wall-clock time (it is what unblocked F03's universe seed), but a session-branch
split meant it never reached `main` until now, after B-20 had already taken the next number.

Pulling ApeWisdom's live ranking to close MT-07 surfaced a question D-27/D-30 didn't settle:
ApeWisdom's "all-stocks" filter ranks broad-market and sector ETFs (SPY, VOO, QQQ, TLT, and
twelve others) alongside individual companies, and D-30's basis text — "the 100 tickers ranked
most-discussed" — doesn't say whether that means literally the raw top 100 or the top 100
*companies*. Put to the owner 2026-09-03: **exclude ETFs, backfill with the next-ranked
individual equity.**

**Two things that make this a build-time finding, not a routine fetch:**

1. **Name-based filtering alone under-catches.** ApeWisdom truncates its `name` field at a fixed
   length, which hid the word "ETF" on two entries (`IGV` — iShares Expanded Tech-Software
   Sector ETF; `SOXX` — iShares Semiconductor ETF) that a literal `\bETF\b` regex match would
   otherwise have let through. Both were caught only because the *second*, independent check —
   resolving each symbol's exchange against SEC's `company_tickers_exchange.json` — failed for
   them, since neither is registered there as an operating company. **The two checks are
   independent and neither alone was sufficient**; the second is what caught what the first
   missed.
2. **A name-based filter that is too broad is its own defect.** An earlier pass excluded `HR`
   (Healthcare Realty) on the word "Trust," which is wrong — REITs carry "Trust" in their legal
   name as a tax structure, not as a fund marker, and are ordinary operating companies for this
   product's purposes. The filter was narrowed to the literal substring `ETF` plus a short,
   individually-verified denylist (`GCC`, `TLT`, `USO`, `SCHD`, `DON`, `VT`, `IGV`, `SOXX`) rather
   than a broader keyword match, specifically to avoid this false-positive class recurring on a
   list nobody will re-derive for a year.

**Verified before commit, not assumed:** all 100 resulting symbols parse against the real
`universeSeedFile` zod schema, no duplicates, every exchange resolved (none guessed) against
SEC's own mapping. `apps/web/migrations/seed/universe-v1.json` is committed with `seededAt:
2026-09-03` and the basis text carrying the ETF-exclusion policy verbatim, since it is a
disclosed selection-bias statement under §6.1, not an implementation detail.

**What this does not close.** The file only takes effect once `pnpm seed:universe` runs against
a real `DATABASE_URL` — that still needs `DEPLOY.md` MT-03 (Neon provisioned) and is part of
MT-08. Closing MT-07 removed one blocker on the path to MT-08, not MT-08 itself.

### B-20 — `calc` is a sibling layer to `analytics`, not a submodule of it (F05)

`02-ARCHITECTURE-CONTRACTS.md` §3 named `analytics` as a layer that may import `contracts` and
nothing else, but never named `calc` at all — F05 needed the gap closed before `calc/artifact.ts`
could exist without violating layering by omission. `calc` is not "analytics that also persists":
`analytics/` computes deterministic values from stored data, `calc/` mints the tamper-evident
artifact and hash around a value on its way to display, and a metric like
`attention.rank_change` needs both, in that order, without either importing the other.

**Ruling:** `calc` added to §3 as a sibling of `analytics` — contracts-only, no cross-import
between the two. `calc/artifact.ts` orchestrates by calling into `analytics/` and `repositories/`
(via injected ports, never a direct import, since `calc` cannot depend on `repositories` either)
rather than either layer reaching into the other.

### B-19 — `provider: 'market'` and `provider: 'fmp'` stay separate tags for one vendor (F04)

Building the market-data adapter against D-31's resolution of MT-14 ("no new vendor — FMP
Starter's daily bars") raised the question of whether `historical-price-full` should be tagged
`provider: 'fmp'`, since it is now literally the same vendor as the fundamentals adapter.

**Kept separate**, matching what `rate-limit.ts`'s `BUCKETS` already encodes: `market` is
`{capacity: 60, refillPerSecond: 1}` for continuous polling (it is D-15's trigger input, source
§4.3's "poll continuously" strategy); `fmp` is `{capacity: 30, refillPerSecond: 5}` for scheduled
fundamentals. Collapsing the tag onto one `provider: 'fmp'` bucket would let a fundamentals
burst starve the trigger's poll, or a hot trigger period starve a scheduled fundamentals pull —
the two call patterns need independent quota and breaker state even though one HTTP client could
technically serve both. `contracts/provider.ts`'s `providerId` enum already keeps them as
separate values, so this is confirming an existing decision under a new adapter, not making one.

### B-18 — F04 §6 says "six adapters"; §4.3's table lists nine (F04)

Building the Substack adapter and updating `collect.md`'s deferred-item count surfaced that
F04's Definition of Done (§6) says *"six adapters implemented, each returning `ProviderResult`
and never throwing,"* while §4.3's own table names nine: Reddit, Substack, X, intraday market
data, FMP, ApeWisdom, Marketaux, SEC EDGAR, FRED. `contracts/provider.ts`'s `providerId` enum
agrees with the table (nine, plus `scorer`), so the table and the contract are self-consistent
and the DoD prose is the stale one — plausibly written before D-12 replaced the adapter set and
never updated to match the new count.

**Not resolved here.** `02-ARCHITECTURE-CONTRACTS.md` and the feature specs are SPINE's/the
coordinator's to correct, not something to silently round off mid-adapter-slice. `collect.md`'s
deferred-item table now names the count discrepancy explicitly rather than picking a number.
Whoever next revises F04's DoD should reconcile it against §4.3's table and the `providerId`
enum, not re-derive a third count.

### B-17 — A 403 is blocked from retry at two layers, and neither alone can fail the end-to-end test (F04)

`retry.ts` originally carried a comment calling `NEVER_RETRIED` *"the load-bearing branch —
`entitlement` is in this set, which is why a 403 cannot be retried."* That was wrong, and the
mutation test found it.

Removing `entitlement` from `NEVER_RETRIED` left the wrapper's end-to-end test —
*"makes exactly one attempt on a 403"* — **green**. The reason is that retry eligibility is a
whitelist: an error is transient only if it is a timeout, a rate limit, or an `upstream` with a
status in `TRANSIENT_STATUSES`. `entitlement` is none of those, so the second layer caught what
the first no longer did. Breaking the whitelist instead, and leaving `NEVER_RETRIED` intact,
also left that test green.

**Two independent guards, and a headline test that cannot fail from either breaking alone.** The
defence is genuinely better for the redundancy; the *test signal* was worse than it looked, and
its name — the F04 §6 DoD item, verbatim — claimed a proof it was not delivering.

This is B-04's shape a second time. There, `check:bundle` reported pass on a real leak because
the server-only guard folded to an unconditional throw and the minifier dropped the key names
the scanner searched for: the guard worked and, by working, blinded the check backstopping it.
The recurring lesson is that **a passing test over a redundantly-defended invariant proves less
than its name implies**, and the only way to find out which is to break each layer separately.

Fixed by pinning both layers in one named assertion — `NEVER_RETRIED.has('entitlement')` and
`TRANSIENT_STATUSES.has(403) === false` — which now fails under either mutation. The comment
was corrected to say which layer does what, including that the whitelist is the one that fails
closed: an error kind added later is un-retryable until someone deliberately says otherwise.

### B-16 — §4.1 orders the quota ledger before the cache, so a cached read must return its reservation (F04)

F04 §4.1 numbers the stages: budget (1), **quota ledger (2)**, **cache (3)**. Taken literally, a
cache hit has already consumed a unit of the daily allowance for a call it never makes.

On most providers this is invisible. On **Marketaux — 100 requests/day, and §4.3 says "the ledger
is not optional"** — a well-cached collection cycle would exhaust the day's allowance without a
single outbound request. The failure mode is quiet and reads like the opposite of what it is:
refusals in the log with no matching calls, a provider that was never contacted, and an
allowance that vanished.

The order is not the mistake, and it is kept. Reserving *before* the cache read is what makes
the ledger safe under concurrency — a check-then-decrement across two steps is a race that ends
in the 429 the ledger exists to prevent. So `QuotaLedger` carries a `release`, and every path
that exits without reaching the provider — cache hit, open circuit — hands the reservation back.

Recorded because the reserve/release pair looks like ceremony until you know which provider it
is for, and a later simplification that drops `release` would take four days of Marketaux
collection with it before anyone noticed.

### B-15 — `ProviderMeta.costUsd` is a decimal string, against ARCH §4.1's `number` (F04)

`02-ARCHITECTURE-CONTRACTS.md` §4.1 types `costUsd: number | null`. It is implemented as
`decimalString | null`.

The architecture document predates F03's decimal work. This value's destination is
`cost_event.cost_usd`, a Postgres `numeric`, and `contracts/cost.ts` types that column as
`decimalString` precisely so a float never round-trips through it — the same discipline that
keeps `result_hash` reproducible and ADR-019's replayability claim standing. Typing the provider
boundary as `number` would reintroduce the defect at the one place it is hardest to see: the
conversion would happen implicitly, inside the wrapper, on every priced call.

`null` still means UNPRICED and never becomes `'0'`. A free call and a call whose price we do not
know are different facts, and F18's global ceiling depends on telling them apart.

The deviation is narrow and documented at the type. ARCH §4.1's `number` should be corrected when
that document is next revised; it is listed here rather than edited in place because the
architecture contracts are SPINE's and this was built in COLLECT.

### B-14 — The context check is a state discipline, not a scheduled action (build loop)

**Requested by the owner 2026-09-03:** the build loop should inspect context, and at 250k–300k
compact when safe, then continue. Implemented as `04-BUILD-LOOP.md` §3.1, with one correction
to the mechanism that is the reason this is recorded rather than just done.

**The agent cannot invoke compaction.** `/compact` is typed by the operator, and automatic
compaction fires at the harness's own threshold on its own schedule. So a protocol step reading
"at 250k, compact" would be an instruction the coordinator has no way to execute, and the first
successor to notice that would reasonably conclude the whole section was aspirational.

What the coordinator *does* control is the state the tree is in when the boundary arrives. So
the rule is inverted: **from 250k onward, keep the tree continuously compaction-safe.** The
threshold does not trigger an action, it changes what work may be started — no new feature, no
new migration, no full read of a reference document — until the next safe point. The boundary
then lands on a safe point whether it was requested or automatic. Where an operator is present,
say the band has been reached and that now is safe; that is a report, not a mechanism.

**A safe point is defined by four conditions** (§3.1), and the load-bearing one is the second:
a red gate whose cause is *not yet diagnosed* is the least safe moment in the loop. The
diagnosis lives only in context, is exactly the kind of detail a summary drops, and its loss
costs the whole debugging cycle again. A red gate that has been diagnosed and written down is
safe; the failure is durable on disk.

**Between GATE and RECORD is never safe**, and this is the specific trap: the merge is in git
and permanent, while the reason for it — what was deferred, what was found, what the counters
should read — exists only in context. A compaction there produces a repository whose history
and whose state files disagree, with nothing left to reconcile them from.

**Evidence from this session, which is why the four conditions are stated rather than left to
judgement.** Compaction was requested mid-turn while F22's record was unwritten. Finishing
RECORD, committing and pushing *before* compacting cost a few minutes and meant the successor
read a lane file that matched the tree. The same session also produced the counter-example: the
`.gitignore` defect (B-10) was diagnosable only from a CI run whose failing output was in
context — had that been compacted away undiagnosed, the diagnosis would have restarted from
the symptom.

**Cold start is not optional after a compaction.** §3.1 says the successor's first act is §1,
not a resumption from what the summary appears to say — a summary's omissions are invisible
from inside it, whereas `progress/<lane>.md` and the session log are written precisely so that
they are not.

### B-13 — F22 §4.5 retires F-07's 300 MB ceiling, which resolves F03's deferred DoD item (F22)

**The item deferred one feature ago was already answered one section away**, and it is worth
recording how that happened rather than only that it did.

F03 §4.5 sets a gate: the storage projection must come in under 300 MB. It did not — 485.8 MB —
and B-09 deferred it with F05 as the trigger, on F-07's own instruction to revisit granularity
before Wave 2.

F22 §4.5 then says, in one sentence: the measured MB/month figure *"replaces F-07's fixed
`< 300 MB` ceiling, which is the wrong instrument for a corpus designed to grow forever."*

That is a ruling, not an opinion, and it is the later and better-reasoned of the two. **A ceiling
on a permanent corpus tells you one thing, once: the day you crossed it.** A growth rate tells
you how long you have, every time you measure it. D-17 made the corpus permanent; the ceiling
was written before that.

So:

- `check:storage` still runs and still reports 485.8 MB. **It no longer fails.** The number is
  pinned by a unit test so a change to it shows in a diff — editing the constants until the
  figure looks comfortable is the failure mode either a pass or a fail assertion would invite.
- `pnpm --filter web measure:storage` is the real instrument. It reads
  `pg_total_relation_size`, and **it refuses to report a rate from fewer than two readings a day
  apart**. A first version happily reported −1,760,869 MB/month from readings microseconds
  apart — a confident, enormous, meaningless number, which is worse than none because it looks
  like data.
- B-09's substantive finding stands and is unaffected: the projection's dominant term is an
  *assumed* refresh cadence that no feature spec fixes. Whatever instrument is used, that
  assumption is what the answer turns on.

**What this does not resolve.** The rate cannot be measured until the collector has run for a
day (MT-08). `progress/spine.md` carries that with the trigger named.

### B-12 — Append-only and retention both applied to artifacts, and §7.2 already had the answer (F22)

F03 §4.1 makes `calculation_snapshot` append-only: no UPDATE, no DELETE. F22 §4.3 gives
artifacts a 90-day retention — which means deleting them. **The trigger blocked the retention
job outright**, and the test that found it was the one asserting a permanent artifact survives a
purge.

Source §7.2 resolves it in a clause that is easy to read past: snapshot rows and their inputs and
steps are append-only *"outside a separately audited legal-retention process"*.

The two operations are not the same thing, which is why one exception is safe and a general one
would not be. **Append-only protects against mutation** — an artifact recomputed in place
silently changes a number somebody has already read (§6.2). **Retention removes a whole expired
artifact.** It rewrites nothing.

So migration 0012 gives DELETE a door and gives UPDATE none:

- `UPDATE` raises unconditionally, with "not permitted, ever — there is no retention exception
  for it" in the message, because the request to widen this will come.
- `DELETE` requires `app.retention_process = 'on'`, set with `set local` so it is scoped to the
  transaction and cannot leak to the next statement on a pooled connection.
- The purge writes its `audit_event` in the **same transaction**, so an audited deletion is the
  only kind that commits.
- `retention_class = 'permanent'` is excluded by the query, not filtered afterwards — a post-hoc
  check is one somebody can forget to run.

Four tests hold the exception narrow, including one that runs an UPDATE *inside* the retention
process and asserts it still fails.

### B-11 — The bitemporal primary keys omitted `ingested_at`, making "insert a successor" impossible (F22)

Source §7.2 specifies `PRIMARY KEY(security_id, provider, observed_at)` for `market_snapshot`,
and the same shape for the other snapshot tables. F22 §4.1 says: *"Never overwrite; insert a
successor."*

**Those two cannot both hold.** With `ingested_at` outside the key, a revision of the same
observation — a provider correcting a close, a re-fetch returning a different value — collides
with the row it revises. The only way to store it is an UPDATE, which is what §4.1 forbids and
what destroys the point-in-time property: the earlier value disappears, and an as-of read for a
date before the correction returns the corrected number. A backtest built on that reads a price
nobody could have acted on, and reads it in the direction that flatters the result.

Migration 0011 adds `ingested_at` to the primary keys of `market_snapshot`,
`attention_snapshot`, `sentiment_snapshot` and `security_profile_snapshot`, plus the
`(subject, observed_at, ingested_at)` indexes §8's second risk row calls for.

**Found by a test fixture**, not by reading the schema: the look-ahead test needed two facts
about the same instant with different `ingested_at` values, which is not an exotic case — it is
the ordinary shape of a corrected observation. `tests/unit/bitemporal-coverage.test.ts` now
asserts the key shape against the migrations so it cannot regress.

### B-10 — A .gitignore pattern silently deleted a route from the repository (F01)

**CI caught what every local run missed**, which is the argument F-14 makes for CI existing at
all: *"the loop never grades its own homework on the merge decision."*

`GET /api/admin/data` returned **404 in CI and 200 locally**. The route file existed on disk and
had never been committed: `.gitignore` carried an unanchored `data/`, meant for a data directory
at the repository root. **Git patterns without a leading slash match at any depth**, so it also
matched `apps/web/app/api/admin/data/`.

Every local signal was green — the file was there, `next build` routed it, Playwright hit it.
The only environment that could see the problem was one that checked the tree out fresh.

**Fixed** by anchoring the pattern (`/data/`, `/_cache/`) and committing the route.
**Guarded** by `tests/unit/tracked-sources.test.ts`, which fails on *any* source file git is
ignoring — the class, not the instance. The guard was verified by reintroducing the exact bug and
watching it fail, then restoring the fix.

Worth carrying forward: a file that exists for you and not for anyone else produces a green local
run and a red CI run, and the instinct on a CI-only failure is to suspect the CI environment.
Here the environment was right.

### B-09 — The storage projection is over the gate, and the granularity rule is not the first thing to revisit (F03)

**F03 §4.5's gate is not met. The measured projection is 485.8 MB against a 300 MB ceiling.**

F-07 anticipated exactly this and wrote the response into its ruling: *"F05's DoD includes a
measured storage projection at 100 symbols; if it exceeds 300 MB the granularity rule is
revisited **before Wave 2 starts**, not after the tables fill."* This is that trigger, fired.

Two corrections were made to the projection before reporting it, and both are part of the
finding rather than adjustments to reach a nicer number:

1. **Artifacts are sized by retention, not by history.** F-07 gives artifacts the same 90-day
   retention as normalized data. A first pass sized them across 180 days of *history* and
   reported 1,548 MB — a number that was wrong in the alarming direction.
2. **The permanent corpus is not in this pool.** §6.8 governs the social corpus by a
   **growth-rate budget in MB/month, measured, not by a fixed ceiling**, and D-33 bought Neon
   Launch for it. Counting it against a fixed 300 MB gate compares two things measured on
   different rulers. It is reported separately: **96 MB/month**, inside D-33's 120–180 plan.

**What actually dominates, and why the granularity rule is the wrong first lever.** The largest
line is `sentiment_shrunk` at 140.8 MB — 100 subjects × **4 refreshes/day** × 90 days. That
cadence is *an assumption made in this file*, not something any feature spec fixes: F16's
five-minute cadence is the **dispatcher's**, not each job's. Halving the sentiment and attention
cadences brings the total to roughly 390 MB; halving all of them lands near the gate — without
touching an artifact's shape.

So the sequence is: **fix the cadences in spec first, re-measure, and only then revisit
granularity.** Revisiting granularity on a number driven by an invented cadence would trade away
Inspector fidelity — the product's actual thesis — to fix an input that was never decided.

**Open, and owned by the coordinator.** `progress/spine.md` §Deferred carries it with F05 as the
named trigger.

### B-08 — Cost reconciliation writes a successor, it does not update (F03)

`cost_event` is append-only (§4.1) and `cost_status` moves estimated → actual → reconciled.
Under strict append-only that transition cannot be an UPDATE, so a `supersedes_cost_event_id`
column was added and reconciliation inserts a new row.

This is the same rule §6.2 applies to artifacts and F20 §4.4 applies to re-scoring, and it is
better than an update besides: **what we believed a call cost at the time stays readable**, which
is what makes a systematically wrong price book detectable rather than merely fixable.

The read path drops superseded rows. An early draft filtered on `supersedes_cost_event_id is
null`, which keeps the estimate and discards the reconciled figure — exactly backwards, and it
would have reported the number we no longer believe. Fixed before it shipped; noted because the
inverted form reads perfectly naturally.

### B-07 — Append-only means content, not lifecycle, for the two versioned tables (F03)

§4.1 lists `config_version` and `universe_version` as append-only. §4.3 requires activation to
*"deactivate the current, insert/activate the successor"* — an UPDATE of the current row. **Both
cannot be literally true.**

Resolved by distinguishing content from lifecycle. What a version *configures* — its settings,
creator, reason, checksum — is immutable, because that is what artifacts recorded and must stay
reproducible. Its `status` and activation timestamps are lifecycle and must transition, or §4.3's
transaction cannot exist and the partial unique index has nothing to protect.

The trigger takes its allowed columns per table, because they differ and the difference is not
arbitrary: `universe_version.selected_count` is materialised **at** activation, in the same
transaction that writes membership, so it is an outcome of activating rather than part of what
the version configures.

The other eight tables in §4.1's list are strictly append-only: no UPDATE, no DELETE.

### B-06 — Bitemporality is a column pair, and derived tables name it differently (F03)

§4.1 says *"every snapshot table carries `observed_at` and `ingested_at`"*. Three tables ending
in `_snapshot` do not, and correctly so: `calculation_snapshot`, `price_return_snapshot` and
`valuation_snapshot` are **derived**, and a computed return was never *observed*. Their pair is
`input_cutoff`/`computed_at` and `as_of_date`/`computed_at`.

The DoD's test therefore asserts a **declared valid-time/transaction-time pair per table**, not a
name match. A new `%_snapshot` table with no entry in that map fails the test, which forces the
choice to be made explicitly rather than inherited from a filename.

### B-05 — §7.2 defines 34 tables, not 27, and seven of the extras are load-bearing (F03)

F03 §4.2 says *"all 27 tables in source §7.2"* and lists 27 names. §7.2 has 27 **sections**, six
of which define two or three tables each. The full count is 34.

The seven unnamed companions are not optional extras — three of them are load-bearing for F03's
**own** DoD:

| Table | Why it could not be skipped |
|---|---|
| `universe_member` | "The seed never resurrects an admin-removed symbol" is a statement about this table. Without it a universe version has no membership at all |
| `method_registry` | What `check:copy`'s D-09 Tier D4 clause and `check:calc-coverage` both read |
| `job_run` | F16a's entire idempotency guarantee is its `idempotency_key` unique constraint |
| `app_setting`, `data_agreement`, `unit_price_book`, `budget_policy` | Referenced by ADR-012, the rights document, and D-32's ceilings respectively |

All 34 are built. Recorded because a successor auditing "27 tables" against a schema with 34
should find the reason here rather than assuming scope creep.

### B-04 — `check:bundle` checks module identity, not only payload (F01)

**Found by running the leak, not by reasoning about it.** F01 §5 asks that `check:bundle` fail
on a deliberately-leaked import. It did not. A `'use client'` module importing `env.ts` was
built, and the check reported **pass**.

The reason is worth carrying forward because it generalises. `env.ts` opens with a runtime guard
— `if (typeof window !== 'undefined') throw`. In a client bundle that condition folds to `true`,
so the minifier reduces the entire module to an unconditional `throw` and drops everything after
it as dead code. **The key names the scanner looks for were the dead code.** The guard worked
perfectly and, by working, blinded the check.

That is the worst shape a gate can have: it reports pass precisely when the defence it is
backstopping is the thing doing the work, and it would go on reporting pass right up until
someone deleted that guard as "browser-dead code anyway" — at which point the values ship and
nothing has changed colour in between.

**Ruling.** The guard's message carries a machine-readable token, `[server-only:<module>]`, and
`check:bundle` treats that token as a banned pattern in its own right. The check now asserts the
**import edge**, not just the payload. Any future server-only module adopting the same guard is
covered with no change to the check.

### B-03 — The scorer placeholder is a contract validator, not a stub (F01)

F01 §4.4b requires the scorer CI lane to exist and be green from F01, running "a placeholder
container whose only test asserts the contract in F20 §3". A placeholder that asserts nothing
would satisfy the letter and none of the intent.

`services/scorer/contract.py` is therefore F20 §3's wire contract as an executable validator —
decimal strings rather than JSON numbers, `<repo>@<40-hex-sha>` rather than a tag, ISO-8601 UTC,
truncation recorded as a boolean. **It does not go away when F20 lands**; F20's real `/score`
output is validated against exactly these rules, so the lane's assertion strengthens rather than
being replaced.

`tests/test_gate_can_fail.py` runs a seeded failure in a subprocess and asserts a non-zero exit.
A CI lane nobody has seen fail is a lane nobody has shown to work, and that is the specific claim
§4.4b makes about lanes introduced late.

The placeholder installs **no third-party packages at all**. "Reaches no network at test time"
is a DoD item, and a container with nothing to install cannot acquire the dependency later by
accident.

### B-02 — Requiredness in the env schema is a function of `PROVIDER_MODE` (F01)

`05-TEST-STRATEGY.md` §8 requires CI to run with `PROVIDER_MODE=fixture` and **no provider keys
present** — "a test that needs a key to pass is a test that will pass for the wrong reason". A
flat required set would have forced CI to invent dummy keys, and a dummy key is indistinguishable
from a real one at the point where it matters.

So `src/env.ts` parses everything optionally and enforces the live-mode requirements in a
refinement, which also lets each error state *why* the key is required — including the
conditional cases, where an unconditional "missing key" message would be actively misleading:
the model-transport key is required by whichever transport is selected, not always.

### B-01 — Two source §6.3 keys are omitted, and neither omission is F01's to make silently (F01)

F01 §4.2 says the key set is "source §6.3, minus the seven `HF_*`, plus `PROVIDER_MODE`", and
also flags that §6.3 **predates D-12 and D-13**. Two keys fall in that gap:

| Key | Why it is not implemented |
|---|---|
| `LINKUP_API_KEY` | **D-12 dropped Linkup.** The key would configure a provider that does not exist (ADR-005) |
| `FEATURE_HF_SHADOW` | **R-19 cut Hugging Face shadow evaluation entirely.** A flag governing nothing is a flag someone eventually switches on — and its name would trip the DoD's own `HF_` assertion |

Both are asserted absent by `tests/unit/codebase-invariants.test.ts`, which also makes F01's two
DoD negatives executable rather than verified once by hand. A negative checked once stops being
true on the next PR.


---

## 3. Open questions

**Re-baselined 2026-09-03.** OQ-3 and OQ-4 are closed by D-11 (single user, no public signup, no
open-signup legal exposure). OQ-2 is deferred with F13 under D-19.

| ID | Question | Blocks | Owner | State |
|---|---|---|---|---|
| OQ-1 | Admin email: `joshuaifang@gmail.com` or `joshuafang@gmail.com`? Still live under D-11 — single-user auth still needs one correct allowlist entry, and a wrong value means no reachable account at all | F02 | owner (MT-00) | **closed by D-26 — `joshuaifang@gmail.com`, the PRD spelling. F02 unblocked** |
| OQ-2 | Does FMP Starter entitle statements, metrics, enterprise value, estimates, price target and DCF? | F13 scope | F04 entitlement report | **deferred with D-19** |
| OQ-3 | Is a public demo in scope? | Wave 5 | — | **closed by D-11** — no public surface |
| OQ-4 | Who writes and reviews privacy and terms? | Wave 5 | — | **closed by D-11** — single user, no signup |
| OQ-5 | Reddit Data API non-commercial approval — the queue is slow, opaque, and can reject silently. It gates the largest channel in the product | F04, F10 | owner (MT-13) | **open — longest lead item in the plan** |
| OQ-6 | Which delayed market-data tier, at what price, with what call limits? D-20 assumes ~$80 combined for market data and fundamentals but the tier is not chosen | F04, D-15 trigger | owner (MT-14) | **closed by D-31 — none for now. FMP Starter's daily bars carry the trigger; intraday upgrade has an evidence trigger** |
| OQ-7 | What is the labelled set for D-09's v1 accuracy gate — how many items, labelled by whom, sampled how? Without it "validated" has no measurement | F12 | owner + F12 | **closed by D-35 — LLM-assisted with human audit, stratified per axis, the assist disclosed in the Tier D record** |
| OQ-8 | Substack discovery: which 20–50 publications, selected on what basis? A curated set has a selection bias that must be disclosed under R-21 | F04, F10 | owner (MT-15) | **basis closed by D-29 — sector coverage. The list itself is still to be named** |
| OQ-9 | Are scraped Reddit archives acceptable? | backfill | — | **closed by D-16** — not needed under forward-only collection |

---

## 4. Superseded

### ADR-006 — Alpha Vantage as validator
**Superseded by R-07.** 25 calls/day cannot systematically validate a 30-symbol universe; as
specced it was a decorative dependency costing an adapter, fixtures, tests, a health check
and a runbook. Retained only for `CONGRESS_TRADES` behind `FEATURE_CONGRESS`.

### ADR-011 — Hugging Face shadow evaluation
**Superseded by R-19.** Conditional on slack in a plan with none, gated on a labelled dataset
owned by a different work package, with no promotion date. Deferred to a post-PoV spike whose
entry condition is: the F12 labelled set exists and the LLM classifier's cost is measured.

### Source §2.3 — the eleven PoV success criteria
**Superseded by `01-PRODUCT-SPEC.md` §4.** Retained in full as Tier A; Tiers B and C added,
because the original eleven cannot fail on quality.

### Source §15 — the 48-hour build plan
**Superseded by `03-ROADMAP.md`.** See D-02.

### Source §20 — Definition of Done
**Not superseded — relocated.** It is the Wave 5 release gate, unmodified.

---

*The entries below are supersedures from the 2026-09-03 re-lock (§1b).*

### D-03 — The thesis is comprehension speed
**Superseded by D-08.** The owner stated a materially different intent on 2026-09-03:
institutional-grade, validated sentiment measurement with historical lookback. Comprehension
speed is retained as a *property* of the product — the ≤30 s research answer stays a Tier A
criterion — but it is no longer the thesis under test. **D-03's honesty discipline survives
entirely**; only its status as the thing being proven changes.

### D-04 — All four challenged components stay in scope
**Partially superseded by D-19.** The Calculation Inspector (F05) and the Architecture Explorer
(F17) survive. The DCF/peer valuation engine (F13) and scenario governance (F14) defer past v1 —
30–38 h locked for a product whose thesis has since changed, and nothing in the 2026-09-03 intent
asks for valuation. Reversible without penalty; the trigger is in D-19.

### R-03 — ApeWisdom methodology version pinned per snapshot
**Superseded by D-12.** The ruling was sound for a stack in which ApeWisdom was the *primary*
attention source. It is demoted to an independent cross-check, so the version-boundary
suppression rule now applies only to the cross-check series, not to the product's attention axis.

### F-05's ruling — accept the ApeWisdom dependency for the PoV
**Reversed by D-12.** The ruling rested on "there is no licensed alternative at this budget."
**That premise is now false.** The Reddit Data API's free non-commercial tier exists and this
project qualifies for it under D-11's single-user, non-commercial posture. The finding itself
(one unlicensed SLA-free source under the entire attention product) was correct and is now
resolved by replacing the source rather than by labelling around it.

### R-19 — Hugging Face shadow evaluation cut entirely
**Partially superseded by D-13.** The *shadow-evaluation* framing stays cut — there is no
parallel scoring path being compared against an LLM baseline. But pinned local models are now the
**primary** stance engine, not a deferred alternative, because a hosted LLM classifier cannot back
a historical series (model IDs retire; the corpus becomes unverifiable). The seven `HF_*`
variables stay removed; F20 owns the scorer service with its own configuration.

### `02-ARCHITECTURE-CONTRACTS.md` §1 — "Forbidden in P0: any Python service, any local model runtime"
**Superseded by D-13** for the scorer service specifically. Azure, Databricks, Kafka, Kubernetes
and vector databases remain forbidden. The exception is narrow and named: one small service
running pinned classification models, which exists because reproducibility requires it.

### `02-ARCHITECTURE-CONTRACTS.md` §5 — 90-day normalized retention
**Superseded by D-17** for social data. Under forward-only collection (D-16) a 90-day rolling
delete means the corpus never exceeds 90 days and D-09's promotion path can never run. The
normalized social corpus and its derived scores are **permanent**. Retention still applies to raw
provider payloads and superseded calculation artifacts.

### F-07's `< 300 MB` storage gate
**Superseded by D-17 + D-20.** A fixed ceiling is the wrong instrument for a corpus that is
supposed to grow forever. Replaced by a **growth-rate budget in MB/month** with a measured
projection, and Neon Launch rather than Neon Free — the free tier is exhausted in roughly three
to four months under D-15's universe and never recovers.

### Tier A criterion A9 — expected monthly spend < $50
**Superseded by D-20.** Off by an order of magnitude against the stated budget. Replaced by a
$350/month ceiling. **§6.6's pre-dispatch budget check is retained and is more load-bearing than
before**, because X bills per read and the database now has a paid tier.

### R-02 — `pending` tier, per-account budgets, OTP throttling
**Superseded by D-11.** These closed F-04, whose entire premise was open signup by strangers.
With one account there is no unmetered spend path. OTP authentication is kept; the throttle
machinery, the `pending` tier and per-account budgets are cut. **The global budget check is
kept** — it is now the only budget control and matters more for it.

---

## 5. Handoff notes

Append a note here whenever a session ends with work in flight or a successor needs context
the code does not carry. Newest first.

### 2026-09-03 — Two coordinator sessions ran on this repo unaware of each other; B-20 was assigned twice

**A second instance of the discrepancy the note directly below this one names**, caught from the
other side: the session that opened and merged PR #2 (F05) did all of its coordinator record-
keeping — this file, `DEPLOY.md`, `02-ARCHITECTURE-CONTRACTS.md`, and `apps/web/migrations/seed/
universe-v1.json` (MT-07's seed) — on its own session branch, which was never merged into `main`.
A second session started independently, read `main` (correctly, at the time) as not having that
work, and did its own GATE + RECORD pass for F05 — including assigning `B-20` to the `calc`/
`analytics` layering decision, the same number the first session had already used **on its own
branch** for a different decision (MT-07's ETF exclusion).

**Resolved by a third session, asked by the owner to read the first session's transcript and
continue it, that found both branches and reconciled them:** the ETF-exclusion ruling is
`B-21` (above; kept next-in-sequence rather than renumbering B-20, since B-20 was already live on
`main` and its own downstream references), `02-ARCHITECTURE-CONTRACTS.md`'s §3 diagram now
actually carries the `calc` addition (the session that recorded B-20 in this file never edited
the architecture doc itself — the decision was logged but the source of truth it describes
wasn't updated), and the seed file and `DEPLOY.md` walkthroughs are restored. No application
code was affected — both sessions' actual F05 code was already merged and identical.

**Lesson for the next coordinator, stated plainly because it will recur:** a coordinator branch
that never merges is not a safe place to leave state-file updates, even when the code they
describe (via a separate feature-branch PR) does merge. If your session's designated branch
cannot be merged into `main` directly, either open a doc-only PR against a branch someone will
actually merge, or push directly to `main` for docs-only commits the way F05's own RECORD commit
did (`04-BUILD-LOOP.md` §2.8) — do not let coordinator records accumulate somewhere that will be
silently superseded by the next session's independent read of a stale `main`.

### 2026-09-03 — F05 was already built, reviewed and CI-green when this session started; the lane file said `not started`

**The tree/state-file discrepancy §1 of `04-BUILD-LOOP.md` warns about, for real this time.**
Cold start read `progress/spine.md` as "F05 — not started", but GitHub already held an open PR
(#2) with 17 commits, two completed adversarial `lane-review` passes (12 findings, all closed),
a full local verification table, and green CI on both the `pull_request` and `push` events for
its head SHA. `mergeable_state` was `clean` against `main`. Nothing in the PR body or DoD was
incomplete — it stopped one step short of GATE + RECORD, which is the coordinator-only step a
prior session apparently ran out of context before reaching (§3.2's handoff protocol exists for
exactly this, but no handoff note or session-log entry named it — the PR body itself was the
only record).

**What this session did:** verified CI green + `mergeable_state: clean` + DoD genuinely
satisfied (two items properly deferred with named triggers, matching §2.7's bar), then ran GATE
(squash-merged #2) and RECORD (this note, `progress/spine.md`, `PROGRESS.md`, B-20). No code was
written or re-reviewed — the tree had already done the work; this session's contribution was
closing the loop on it.

**Also discovered:** `main` on GitHub was already at the tip this session's assigned branch
(`claude/build-loop-status-nn97dj`) started from — i.e. prior sessions' RECORD commits went
straight to `main` by direct push, not through this session's branch, and no branch by that name
existed on `origin` yet. This session's RECORD commit follows the same established
convention (direct push to `main`, per `04-BUILD-LOOP.md` §2.8 and this repo's own git history)
rather than opening a doc-only PR against a session branch nothing else will ever merge.

**Lesson for the next coordinator:** check `list_pull_requests(state=open)` on the repo during
cold start, not just the lane files — an open, CI-green, DoD-complete PR is tree state a lane
file can silently miss for an entire session boundary.

### 2026-09-03 — pre-build audit: is the package ready to build?

**Why this note exists.** The question put was whether the repository is ready for the build to
start. It was not, for a reason that rhymes with the completeness audit below: the re-lock's
amendment banners had reached **F01** — the one feature that must go first — without reaching its
body. A builder executing F01's DoD verbatim would have shipped four env keys D-11 cut, four
lint rules where the banner promised five, and a single-lane CI where the Wave 1 exit gate tests
two. All three are now closed.

| Gap | What was wrong | Fix |
|---|---|---|
| **F01 §4.2** | Required `SIGNUP_MODE`, `ACCOUNT_DAILY_RESEARCH_LIMIT`, `ACCOUNT_MONTHLY_COST_LIMIT_USD`, `OTP_DAILY_GLOBAL_LIMIT` — all four cut by D-11. F01's banner cited D-13 and D-09 only; **D-11 never reached this file** | All four marked void with the reason, not deleted — they are F-04's mitigations and a reader arriving from that finding needs to see the ruling expired rather than that the mitigation was forgotten. ADR-016's `pending`-tier amendment corrected too |
| **F01 §4.3 / §4.4** | Banner promised two D-09 lints; the rule table had four rules, the test plan named neither, and the DoD said "all **four**" | They are two different mechanisms, which is why they went missing: the bitemporal read is an **ESLint rule** (now `no-unbounded-pit-read`, five rules), the predictive-vocabulary check is an extension of **`check:copy`**. Both stubbed in F01 and filled by F22 §4.2 / F19 §4.3 |
| **F01 §2 / §4.4b, `05-TEST-STRATEGY.md` §8, `lane-verify`** | The D-13 scorer CI lane appeared in F01's banner and in `PROGRESS.md` and **nowhere else** — not in the workflow, not in F01's scope or DoD, not in the gate `lane-verify` runs. `03-ROADMAP.md`'s Wave 1 exit gate tests it | New §4.4b; `scorer` added as a **separate job** in §8 (a Python failure reported as a Next.js failure costs a cycle every time); `lane-verify` gains the lane and a report row |
| **F20 header** | `Depends on: F01, F03` for the whole feature, contradicting the D-24 carve-out that `06-PARALLEL-LANES.md` §1b and `progress/collect.md` both rest on | Split by half: service half depends on **nothing**, queue half on F01+F03. This was the most expensive of the five — `04-BUILD-LOOP.md` §2.1 SELECT picks on `merged` dependencies, so an agent reading the old line would have **correctly** refused to start the one piece of work that gets scoring built before F03, and under D-16 an earlier collector is the thing that cannot be bought back |
| **F02's wave** | Three positions: `03-ROADMAP.md` §2/§3 Wave 1, §1b's SURFACE column Wave 2, and `PROGRESS.md`'s Wave 1 gate omitting auth entirely | Settled in `03-ROADMAP.md` §3 Wave 1 and referenced from the other two. **F02 is Wave 1, built serially by the skeleton agent, not by SURFACE.** The load-bearing reason is not its dependency graph: Wave 1 puts the collector on a public URL (MT-08), and D-11's stated reason for keeping OTP *is* that public URL |
| **F02's body** | Banner recorded D-11 in full; §2, §4.2, §4.3, §5, §6, §7, §8 built the `pending` tier, the four-row throttle table and the lifecycle document anyway. Same leak in F07 (§4, E2E, review step 4) and F11 (E2E, risk row) | Reconciled. `AccountTier`/`requireTier()` void; the throttle table collapses to **allowlist-before-send**; F07's and F11's tier gates re-based onto the **global** budget check, which with one actor *is* the per-account ledger |

**One judgement made here that the owner should ratify, not inherit.** D-11 cuts "the OTP
throttle machinery" without qualification. Read literally that removes the send cap as well —
and the single allowlisted address is known to anyone who has seen the app, so an attacker could
exhaust Resend's 100/day allowance and lock the owner out of their own system. That is the
failure the old global breaker existed to prevent, and it has nothing to do with multi-tenancy.
**A one-row send cap is kept on that reading** (F02 §4.2). If the owner disagrees, cut the row
and record it — the point is that it should not erode silently.

**The pattern worth carrying forward, and it is a sharper version of the one below.** The
completeness audit found stale bodies under fresh banners and concluded: grep for the
*mechanism*, not the feature ID. This round found the inverse and it is worse — **a banner
promising something the body never gained**. A stale body at least describes a system that once
existed; a banner-only promise describes one that never did, and it reads as *more* current than
the body around it. `PROGRESS.md` had even propagated one of them ("scope grew: a second CI lane")
without anything downstream implementing it. **When a banner adds scope, the check is not whether
the banner is right — it is whether the DoD grew.** Three of the five gaps here were visible by
diffing banner claims against DoD checkboxes, and nothing else would have caught them.

**Still no application code.** F01 is now executable as written.

---

### 2026-09-03 — completeness audit of the re-lock

**Why this note exists.** The re-lock below amended 29 of 34 files in the package. It was asked
whether the package was *completely* reviewed. It was not — a file-by-file audit found six live
contradictions that the amendment banners had covered over rather than fixed. All six are now
closed. Recorded here because the failure mode is the interesting part: **a banner on a document
whose body still says the old thing is worse than no banner**, because it reads as reviewed.

| Gap | What was wrong | Fix |
|---|---|---|
| **F16** | Untouched, and the most serious. Its body specified a **clock-only** dispatcher in **Wave 4 behind F15**, while the re-cut roadmap put a running collector and a price trigger in **Wave 1**. A builder following it would have had no dispatcher on the day the corpus starts | Split: **F16a** (dispatch core + trigger path) → Wave 1; **F16b** (admin plane) → Wave 4. New §0 and §4.1b. Heartbeat promoted optional → required |
| **F05** | Banner claimed "unchanged in substance", but the body twice named the **old** walking skeleton (`ApeWisdom → rank_change`). That slice crosses no process boundary and no PIT read — it would have passed while the two contracts most likely to be wrong went untested | Slice replaced with the D-12/D-13/D-16 path; §1 now explains *why* the old one was structurally unsound, not just that it changed |
| **F10** | Four stale spots **outside** its superseded block: the `Consumes` line, the dedupe example, a contract test, and a risk row — all still naming Linkup | Re-sourced. The dedupe example now carries the frame-collapse warning |
| **F09** | Untouched. Renders the evidence surface, but was still specced for **one** disclosure (D-14 made it three) and had nothing about coverage gaps | Amendment banner + scope: three per-frame disclosures, gaps rendered as holes, scorer abstention |
| **F18** | Degradation catalogue still on the old provider set, with a live Linkup row | Rebuilt on the D-12 stack, **plus a severity column** — the new distinction is latency-cost vs corpus-cost outages |
| **F17**, **F03** | Manifest missing `ScorerIdentity` + MCP catalogue; Neon Free named in a risk row | Both amended |

**The pattern worth carrying forward.** Every one of these sat in a file whose *headline* subject
was untouched by the decisions — a scheduler, a detail page, a risk table. The decisions changed
the **collection model**, and the collection model reaches into files that do not appear to be
about collection. When a future decision changes something this structural, grep the whole
package for the mechanism, not for the feature ID.

---

### 2026-09-03 — re-lock session

**What happened.** The owner stated an intent materially different from the one this package was
locked against on 2026-09-03. A full business-intent and technical-architecture review was run
against the new intent (`SPEC-REVIEW.md`, 672 lines): three findings that reshape the
build, twelve weaknesses, twelve open questions, eight refinements, and a sixteen-decision
register. Sixteen decisions were taken (D-08…D-23) and eleven prior rulings superseded (§4).
**Still no application code.**

**The three findings that reshape the build, in one line each:**

1. **MCP delivery dissolves the enforcement boundary.** The web app owns the render boundary; an
   MCP server does not. This is why D-10 (web first) is defensible, and why F21's MCP Apps
   components are a *compliance* mechanism rather than a presentation choice — a `ui://` resource
   is markup you control, which is the only render boundary available on that surface.
2. **A hosted LLM classifier cannot back a historical series.** Model IDs retire; the corpus
   becomes unverifiable exactly when a backtest needs it. Hence D-13 and the break in §1's
   forbidden list.
3. **The budget buys a spike detector, not an intraday gauge.** At $0.005/X-read, 5-minute
   intraday sentiment is arithmetically unavailable at any universe size clearing the n≥5
   threshold. Hence D-15's trigger-driven sampling and `explain_spike` as the primary tool.

**Traps found in this round, worth knowing:**

1. **The retention policy was quietly eating the product.** §5's 90-day normalized retention plus
   D-16's forward-only collection means the corpus can never exceed 90 days, so D-09's promotion
   path can never run. One line in a table, contradicting nothing visible, foreclosing the
   headline goal. Exactly the failure mode F-01 warned about. Fixed in D-17.
2. **Neon Free does not survive the corpus.** ~120–180 MB/month, permanent, exhausts 0.5 GB in
   three to four months and never recovers. F-07's fixed ceiling was the wrong instrument.
3. **F-05's ruling rested on a premise that is no longer true.** "No licensed alternative at this
   budget" was correct in a commercial posture; under D-11 the Reddit API's free non-commercial
   tier is available. A ruling can expire when its premise does — check premises, not just
   conclusions, when re-reading this file.
4. **Every abstention threshold in the package was calibrated to a 5–12-snippet sampling regime.**
   `n ≥ 5`, `n ≥ 3`, `n_eff ≥ 8`. Against Reddit volume `n ≥ 5` is met trivially and stops
   protecting anything; against X at 15-minute resolution it abstains nearly always. F06 must
   re-derive all three per axis. **A threshold calibrated to one sampling regime is meaningless
   in another.**
5. **The universe sits at MT-07's hard cap of 100, not its default of 30.** Every quota, storage
   and cost projection in this package was computed against 30.

**What the next agent should do.** MT-08 and MT-13 are now the two most urgent items and both are
owner tasks: start the collector (every day not collecting is corpus that cannot be recovered)
and file the Reddit API application (free, slow queue, gates the largest channel). Then F01 —
still unblocked, and its scope grows to cover a second CI lane for the scorer service.

### 2026-09-03 — spec authoring session

**What happened.** Read the source PRD (4,486 lines). Ran an adversarial review producing 22
findings. Put two rounds of questions to the owner and captured D-01 through D-07. Wrote the
complete spec package: `00-ADVERSARIAL-REVIEW.md`, `01-PRODUCT-SPEC.md`,
`02-ARCHITECTURE-CONTRACTS.md`, `03-ROADMAP.md`, `04-BUILD-LOOP.md`, `05-TEST-STRATEGY.md`,
nineteen feature specs, `PROGRESS.md`, this file, and `DEPLOY.md`.

**No application code was written.** Every number in this package is a specification or an
estimate. Nothing has been measured.

**What the next agent should do.** Start F01. It has no blockers. While building it, chase
MT-00 (one question, unblocks F02) and MT-06 (unblocks all of Wave 3).

**Traps found while writing, worth knowing:**

1. The source PRD is internally inconsistent in one place that matters: §15 promises 42–54
   hours while §15.1's "do not cut" list retains essentially the entire scope. If you find
   yourself under time pressure, the list of things that must never be cut is in
   `03-ROADMAP.md` §4 — it is deliberately short and it is the product.
2. ~~The admin email discrepancy (OQ-1)~~ **— closed by D-26 on 2026-09-03: `joshuaifang@gmail.com`.** Retained because the check it prescribes is still worth running. It is in the
   environment variable, in ADR-016, and in the boot assertion. Check all three.
3. Storage is the sleeper risk. The DoD's "every chart point links to an artifact", read
   literally against Neon Free, does not fit. R-05 fixes the granularity, but the projection
   must actually be measured at the end of Wave 1, not assumed.
4. The stance metric will keep trying to become "Reddit sentiment" every time someone writes
   copy for it. R-01 is the ruling; the copy lint is the enforcement; the reason is F-03.
5. `PROGRESS.md`'s history-depth counter exists because a demo before day 14 shows an empty
   leaderboard. Start the collector early even if the UI is not ready.
