# Roadmap — Five Waves, Twenty-One Active Features

**Re-waved 2026-09-03** against the owner's changed intent (`MEMORY.md` §1b, D-08…D-23).
**Owner decision:** full scope retained; the timeline is re-baselined
(`00-ADVERSARIAL-REVIEW.md` F-01).
**Shape:** thin vertical slices. Every wave ends with something demoable.
**Structural rule (F-11):** Wave 1 is a walking skeleton built by a single agent. Parallel
lanes start only in Wave 2, against contracts that have survived a live round trip.

> **Narrow carve-out, 2026-09-03 (D-24).** F-11 stands, and its reasoning stands: a lane built
> against a contract that has not survived a live round trip is work that gets thrown away.
> The carve-out is therefore scoped to exactly that test — **a Wave 1 lane may run in parallel
> only if it consumes no domain contract F03 has not yet proven.** Two things qualify:
> **F20's service half** (its own language, its own deploy target, and an HTTP contract defined
> in `features/F20-scorer-service.md` §3 that depends on nothing in `src/`), and **F04's adapter
> and fixture layer** (which *produces* `ProviderResult` rather than consuming domain schemas —
> its persistence wiring still waits for F03). Everything else in Wave 1 stays serial.
> Full three-lane parallelism starts at Wave 2, exactly as F-11 says.

---

## 1. Effort re-baseline

| Area | Source PRD implied | Honest estimate |
|---|---|---|
| Foundation, auth, CI, env, user-data lifecycle | 2 h | 16–20 h |
| Schema (27 tables), repositories, seeds | included above | 14–18 h |
| Provider platform (6 adapters, wrapper, fixtures, entitlement probe) | 3 h | 18–24 h |
| Calculation kernel: decimal artifacts, hashing, replay, method registry | not separately costed | 22–28 h |
| Analytics library + golden fixtures | 3 h | 14–18 h |
| Dashboard, leaderboard, ticker page, evidence drawer | 4 h | 20–26 h |
| Evidence + stance pipeline | 4 h | 12–16 h |
| Research agent, streaming, verifier, claim ledger | 4 h | 20–26 h |
| Evaluation harness (corpus, judge, seeded errors) | not costed | 12–16 h |
| Valuation engine (DCF/peer/consensus, eligibility) | included in "analytics" | 16–20 h |
| Scenario governance (assumptions, sharing, issues) | included in "inspector" | 14–18 h |
| Admin control plane (~20 mutation surfaces, versioning, audit, rollback) | 2 h | 26–34 h |
| Dispatcher, jobs, locks, idempotency | included above | 10–14 h |
| Architecture Explorer + manifest reconciliation | 2 h | 12–16 h |
| Cost, budgets, degradation, chaos | 2 h | 10–14 h |
| Release hardening: perf, a11y, copy lint, runbooks | 2 h | 12–16 h |
| **Total** | **~42–54 h** | **~180–240 h** |

Read the gap as a warning about *what gets silently dropped* under the original budget, not
as a reason to argue about hours: the difference is almost entirely the calculation kernel,
the schema, the admin plane and the tests — i.e. the trust invariants.

### 1.1 Re-baseline, 2026-09-03

| | Hours |
|---|---:|
| Baseline above | 180–240 |
| − D-11 single-user: F02 partial, F15 heavy cut | −36 to −52 |
| − D-19: F13 and F14 deferred past v1 (F14's sharing/issue-queue portion was already cut by D-11; counted once, here) | −30 to −38 |
| + D-12: new adapters (Reddit, Substack, X, market data; ApeWisdom demoted, Linkup dropped) | +10 to +16 |
| + **F20** pinned scorer service and queue (D-13) | +14 to +18 |
| + **F21** MCP server and MCP Apps components (D-10) | +16 to +22 |
| + **F22** PIT corpus, permanent retention, coverage-floor rendering (D-16, D-17) | +12 to +16 |
| + D-15: trigger logic promoted into Wave 1 (this **is** F16a; F16's own estimate rises 10–14 → 14–18 h, and the split is booked here, not twice) | +6 to +10 |
| **Revised total** | **~160–210 h** |

**At D-22's 20+ h/week that is 8–10 weeks.** This is not a smaller build — it is a differently
shaped one. The cuts approximately pay for the additions, which is exactly why re-specifying now
was cheaper than discovering it in Wave 3.

## 2. Feature registry

| ID | Feature | Wave | Depends on | Est. |
|---|---|---|---|---|
| F01 | Foundation and quality gates | 1 | — | 12–16 h |
| F02 | Authentication, authorization, user-data lifecycle | 1 | F01 | 14–18 h |
| F03 | Persistence and domain contracts | 1 | F01 | 14–18 h |
| F04 | Provider platform | 1 | F01, F03 | 18–24 h |
| F05 | Calculation kernel and Inspector v1 | 1 | F03, F04 | 22–28 h |
| F06 | Deterministic analytics library | 2 | F05 | 14–18 h |
| F07 | Dashboard, market and sector composites | 2 | F06 | 12–16 h |
| F08 | Attention leaderboard and notable rank change | 2 | F06 | 10–14 h |
| F09 | Ticker detail page and evidence drawer | 2 | F06, F07 | 12–16 h |
| F10 | Evidence pipeline and stance classification | 3 | F04, F06 | 12–16 h |
| F11 | Research agent, verifier, claim ledger | 3 | F10 | 20–26 h |
| F12 | Evaluation harness and LLM judge | 3 | F11 | 12–16 h |
| F13 | Valuation engine | — | — | **deferred (D-19)** |
| F14 | Scenario governance | — | — | **deferred (D-19)** |
| F15 | Operator control plane | 4 | F03, F04 | **10–14 h** (was 26–34; D-11) |
| F16a | Dispatch core + **trigger path** | **1** | F03, F04 | **6–8 h** |
| F16b | Scheduler admin plane | 4 | F15, F16a | 8–10 h |
| F17 | Architecture Explorer | 5 | F05, F15 | 12–16 h |
| F18 | Cost, budgets, degradation | 5 | F04, F15 | 10–14 h |
| F19 | Release hardening | 5 | all | 12–16 h |
| **F20** | **Pinned scorer service and queue** | **1** | **service half —**; queue half F01, F03 | **14–18 h** |
| **F21** | **MCP server and MCP Apps surface** | **3** | F12, F20 | **16–22 h** |
| **F22** | **PIT corpus and coverage integrity** | **1** | F03 | **12–16 h** |

**Changed by the 2026-09-03 re-lock:**

| ID | Change | Decision |
|---|---|---|
| F02 | Heavy cut — OTP auth kept; open signup, `pending` tier, throttle machinery, per-account budgets cut | D-11 |
| F04 | Adapter set replaced: +Reddit, +Substack, +X, +market data; ApeWisdom → cross-check; Linkup dropped. **Market data is Wave 1** because it is the trigger | D-12, D-15 |
| F08 | Re-sourced to the Reddit Data API; ApeWisdom becomes an independent cross-check on rank | D-12 |
| F10 | Reworked — real corpora not search snippets; pinned scorer; three sampling frames; **all abstention thresholds re-derived per axis** | D-12, D-13, D-14 |
| F11 | Reframed — retained as the **measurement path** that proves the tool surface can be used honestly, alongside its role as the web research flow | D-10 |
| F12 | Extended — **Tier D** added; finsent's evaluation harness ported as a versioned module | D-09, D-18 |
| F15 | Heavy cut — config/universe versioning, audit and rollback kept as *reproducibility* infrastructure; the ~20-surface mutation UI cut as *multi-tenancy* infrastructure | D-11 |
| F18 | Promoted in importance — X bills per read and the database now has a paid tier | D-20 |
| F19 | Copy lint extended: predictive vocabulary on a metric with no Tier D4 record is a build failure | D-09 |
| **F16** | **Split across waves.** The dispatch core and the trigger path move to **Wave 1** — the collector must run from day one (D-16) and the price trigger is Wave 1 (D-15), so scheduling cannot sit behind F15 in Wave 4. The admin plane stays in Wave 4. The heartbeat is promoted from optional to required | D-15, D-16 |
| F09 | Renders **three** sampling-frame disclosures instead of one, plus coverage gaps as holes in the attention chart | D-14, D-16 |
| F17 | The manifest now carries `ScorerIdentity` (with pinned SHA) and the MCP tool catalogue | D-13, D-10 |
| F18 | Degradation catalogue re-sourced and given a **severity** column: latency-cost outages and corpus-cost outages are different incidents | D-12, D-16 |

### Dependency graph

```
F01 ─┬─ F02 ──────────────────────────────────────────────────────┐
     ├─ F03 ─┬─ F22 ─┬─ F04 ─┬─ F05 ─┬─ F06 ─┬─ F07 ─┬─ F09 ──┐    │
     │       │       │       │       ├─ F08 ─┘              │    │
     │       ├─ F20 ─┘       ├─ F16a (dispatch + trigger)   │    │
     │       │               └───────┴─ F10 ─ F11 ─ F12 ─ F21 ──┐│
     │       └─ F15 ─ F16b ───────────────────────────────────┐ ││
     └────────────────────────────────────────────────────────┴─┴┴─ F17, F18 ─ F19
```

**Wave-2 parallel lanes** (after F06 merges):
- Lane P: F07 → F09 (product surfaces)
- Lane A: F08 (attention) — independent of F07
- Lane G: F15 may start early, since it depends only on F03/F04

**Wave-3 lane:** F21 follows F12 directly — the MCP surface is placed at the Wave 3 exit, not
after Wave 5 (D-10). It is the first point at which the tool surface has something honest to
expose *and* the evaluation harness exists to measure how it is used.

**Wave-4:** Lane V (F13 → F14) is deferred under D-19; only Lane G (F15 → F16b) remains.

**Note on F16a.** It sits in Wave 1 on the F04 branch, not the F15 branch, because it needs the
market-data adapter (the trigger's input) and nothing from the admin plane. Wave 1 ships it with
**no UI at all** — job definitions are seeded rows and changing one is a migration. That is the
right trade when the alternative is a later start date for a corpus that cannot be backfilled.

## 3. Waves

### Wave 1 — Walking skeleton
**Goal:** one metric, alive, end to end, on real data, with its Inspector artifact and a
successful frozen replay. Contracts harden by surviving reality.
**Features:** F01, F02, F03, **F20**, **F22**, F04, **F16a**, F05.

**Where F02 is built, settled here 2026-09-03 by the pre-build audit.** Three documents
disagreed: this registry put F02 in Wave 1, `06-PARALLEL-LANES.md` §1b put it in SURFACE's
Wave 2 column, and `PROGRESS.md`'s Wave 1 gate row omitted auth altogether. **F02 is a Wave 1
feature, built serially by the walking-skeleton agent — not by the SURFACE lane.** Two reasons,
and the second is the load-bearing one:

1. It depends on F01 alone, so nothing sequences it later.
2. **Wave 1 deploys the collector to a public URL** (MT-08), and D-11's whole reason for keeping
   OTP is that the app sits on a public URL in front of paid providers. Auth shipping in Wave 2
   would mean an unauthenticated Wave 1 deployment spending real provider budget.

§1b's "SURFACE: nothing" row is about **parallelism**, not about who builds: SURFACE-as-a-lane
starts at the Wave 2 gate, and F02 is built before it does. F02 remains listed in
`progress/surface.md` because that lane owns the routes afterwards.
**Chosen slice:** `attention.mention_rate` for one seed symbol —
Reddit Data API call → `ProviderResult` → raw item store (full body, D-17) → scoring queue →
**pinned scorer** → scored row with `scorer_id`/`scorer_version` → pure analytics function →
`CalculationArtifact` → persisted → rendered on a page → Inspector page → replay verifies the
hash.

**Why the slice changed:** it now traverses the scoring boundary (§2.1) and the PIT store, which
are the two contracts most likely to be wrong and most expensive to fix late. A slice that avoids
them is not a walking skeleton of *this* product.

**Also in Wave 1:**
- **The collector is deployed and running against the seed universe.** Under D-16 this is the
  single most time-critical item in the plan — every day not collecting is corpus that can never
  be recovered. `DEPLOY.md` MT-08.
- **The price trigger** (D-15). Market data is a Wave 1 adapter because the collection strategy
  cannot be demonstrated without it.
- **F16a — the dispatch core.** Signature verification, the Redis lock, idempotency, `JobService`
  and the trigger path. There is no admin UI in Wave 1; that is F16b in Wave 4. The **heartbeat
  ships here too**, because the failure mode it catches — a dispatcher that is up but dispatching
  nothing — costs permanent corpus under D-16.

**Exit gate:**
- CI green and independently run on the branch, **across both deploy targets** (web app and
  scorer service).
- Sign-in with OTP works; a non-allowlisted address is refused every operator route.
- The slice above works against the live Reddit API and market-data tier, and its replay
  reproduces the hash.
- **The pinned scorer reproduces identical scores on identical stored inputs** (Tier D2), and
  every score row carries `scorer_id` + `scorer_version` (Tier D3).
- **A scorer outage produces an unscored backlog and a §6.3 abstention — not a substituted
  number.** Tested by taking the service down (D-13).
- **PIT guard fires:** a test proves that reading a fact by `observed_at` without bounding
  `ingested_at` is rejected (F22).
- Written entitlement report exists for every provider endpoint the later waves need.
- **Storage growth rate at the D-15 universe is measured in MB/month** and projected against Neon
  Launch — not tested against the superseded 300 MB ceiling.
- Collector is live; `PROGRESS.md` shows history depth **and the collector start date**.
- **A spike evaluation that does not fire still writes a `CalculationArtifact`**, and a window
  that would breach an X ceiling is refused with a recorded `CoverageGap` rather than truncated
  (F16a). The sampling frame has to be reconstructable after the fact or F10 §4.5's disclosure is
  unsupported.
- **The heartbeat alerts on a stalled dispatcher** and cannot itself execute jobs.

---

### Wave 2 — Product surfaces
**Goal:** J1, J4 served on live data. A person can open the app and understand today's
attention picture without instructions.
**Features:** F06, F07, F08, F09.

**Exit gate:**
- Dashboard, leaderboard and ticker page render live normalized data with source, coverage
  and freshness labels on every aggregate.
- Every displayed number and every chart point opens an Inspector artifact.
- Minimum-base rules, `NEW`, `THIN_SAMPLE`, stale and insufficient states all render.
- Golden-fixture analytics suite passes exactly within documented tolerance.
- Tier A criteria A2–A6 pass.

---

### Wave 3 — Agentic research, measurement, and the MCP surface
**Goal:** the thesis. J2, J3, J6, J7 served, measured, **and exposed as tools**.
**Features:** F10, F11, F12, **F21**.

**Exit gate:**
- A research run streams, persists, survives reload, and abstains when evidence is thin.
- Deterministic verification enumerated in F11 passes on every run; prose that fails is
  withheld and the run lands in `verification_failed`.
- Tier B (B1–B8) passes on the frozen corpus.
- Tier C judge is built, calibrated, and its gate passes (mean ≥ 4.0, no C2 below 3).
- **Tier D1–D3 pass** — per-axis stance accuracy against the labelled set, scorer reproducibility,
  and scorer-provenance completeness (D-09).
- Tier A criterion A1 (30 s p95) passes with the staged latency budget.
- **F21: the MCP server exposes the tool surface, and no tool returns raw corpora** — every
  numeric comes back with a `calculationId` (§2.2 rule 1).
- **Every MCP tool result renders through a `ui://` component carrying `n`, window, coverage
  floor, sampling-frame disclosure and the §6.4 line** (§2.2 rule 2).
- The `MethodRegistry` generates the tool catalogue, including `whenToUse` selection semantics —
  the model learns tool choice from the same registry that defines the metric.

---

### Wave 4 — Operator control and scheduling
**Goal:** J5 and the operator. **F13 and F14 are deferred under D-19.**
**Features:** F15, **F16b** (the admin plane only — the dispatch core shipped in Wave 1).

**Exit gate:**
- Operator negative-authorization, universe conflict/activation, duplicate-dispatch,
  restricted-payload, model-validation and budget-hard-stop E2E tests pass.
- The dispatcher verifies signatures, locks, is idempotent, and manual refresh runs through
  the identical job service.
- **Every config, universe and budget change is versioned, records actor and before/after, and
  has a working rollback target.** This is reproducibility infrastructure and survives D-11's cut
  in full — it is what answers "what produced this number in March."
- **The price trigger's thresholds are operator-editable, versioned and audited**, because they
  govern X spend (D-15, D-20).

---

### Wave 5 — Transparency and release
**Goal:** the system explains itself, degrades honestly, and passes the full gate.
**Features:** F17, F18, F19.

**Exit gate — the source PRD's §20 Definition of Done, in full, unmodified**, plus:
- Tiers A, B and C of `01-PRODUCT-SPEC.md` §4 all pass.
- Chaos suite: the app remains useful with any one noncritical provider disabled.
- Copy lint passes: no banned vocabulary, disclosure line present on every divergence state.
- Runbooks exist for every provider failure **and** for answer retraction (F-20).
- Known limitations and open questions are recorded in the release notes.

## 4. Cut line

If a wave overruns, cut in this order — this replaces source §15.1 and is ordered by damage:

**Re-ordered 2026-09-03** against the changed thesis. Cut in this order, by damage:

1. Congress view (flag-only anyway)
2. SEC/FRED enrichment
3. Insider card
4. Technical support/resistance zones
5. Architecture node side-panel polish; keep the accessible step-through and the formulas
6. **F07 dashboard composites** — the leaderboard and ticker page carry the product without them
7. Model test playground and invoice reconciliation; keep route selection and the cost ledger
8. Separate operator subroutes; keep one tabbed `/admin`
9. Comprehensive catalogue breadth; keep active US equities/ETFs
10. **ApeWisdom cross-check** — a nice independent check on the Reddit attention axis, not load-bearing since D-12
11. **The X axis entirely.** It is ~5% of the corpus at D-20's budget (D-23). Reddit + Substack
    is a coherent product; the reverse is not

**Never cut** — cutting any of these means the product no longer demonstrates its thesis:
evidence links; coverage labels **and the coverage floor**; sample thresholds; **the three-axis
separation**; deterministic metrics; the Inspector artifact and frozen replay for every
deterministic value; the verifier; provider timeouts and caching; error, stale and degraded
states; operator authorization and audit; versioned config/universe writes with rollback; the
locked idempotent dispatcher; the global budget check; the abstention behaviour; the §6.4
disclosure line.

**Added to *never cut* by the re-lock, and these are the load-bearing ones:**

- **The collector, running.** Under D-16 an outage is permanent data loss. It outranks every
  feature on this list.
- **Pinned scorers with recorded `scorer_id`/`scorer_version`.** Without them the corpus cannot
  back a Tier D4 backtest and D-09 becomes unreachable — the whole point of the re-lock.
- **Permanent retention of the normalized corpus.** A rolling delete destroys the asset (D-17).
- **PIT discipline and the look-ahead guard.** Cannot be retrofitted onto a corpus collected
  without it.
- **Full-body retention for Reddit and Substack.** It is what makes re-scoring possible, and
  under forward-only there is no second chance to capture it.
