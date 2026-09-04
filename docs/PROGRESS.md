# Progress — index

> **Separate RNI state:** RNI progress is intentionally isolated in `rni/PROGRESS.md` and
> `rni/progress/*.md`. Those files do not change the legacy wave counters in this document.

> **Amended 2026-09-03 by the parallel-lane split (D-24).** This file used to carry every
> per-merge status write, which made it the single hottest file in the package and guaranteed
> a merge conflict on every concurrent PR. Per-feature state now lives in three single-writer
> lane files; the session log is one file per session. **This file holds only what changes at
> a wave boundary.** See `06-PARALLEL-LANES.md`.

**Rule:** if this package and the git tree disagree, **the tree wins** — correct the state
files first, note the discrepancy in `MEMORY.md`, then pick work.

**Who writes what.** The coordinator is the sole writer of `PROGRESS.md`, `progress/*.md` and
`MEMORY.md`. A lane agent reports; it never edits state. Under the three-account topology
instead, each lane file has exactly one writing account. Either way the invariant is the same:
**one writer per file, always.**

---

## Phase

**Building. Wave 1's serial skeleton (F01, F03, F22, F05) merged 2026-09-03. F02, F06 and F20's
queue-and-persistence half all merged 2026-09-03**, each after a multi-round adversarial
`lane-review` (three rounds for F02, five for F06, five for F20's queue half — see the session
logs dated 2026-09-03 and `MEMORY.md` **B-23** through **B-26**). **F07 merged 2026-09-03** (two
review rounds; `progress/surface.md`).

> **Corrected 2026-09-04.** This section previously read "F08 is in progress, not yet merged...
> F09 opens once F08 merges" — stale against the git tree by five merged PRs, found and fixed by
> a coordinator session that came in to check deployment health and noticed `PROGRESS.md`,
> `progress/surface.md` and `progress/collect.md` all disagreed with `main`. Per this file's own
> rule ("if this package and the git tree disagree, the tree wins"), the real state: **F08
> merged** after 55 total adversarial `lane-review` rounds (PR #15, resumed from a round-43
> pause), **F09 merged** after 4 rounds (PR #16, PR #15's prerequisite), **F04's X adapter**
> merged after 5 rounds (PR #14), **F04's market-data collector** merged after 5 rounds (PR #13),
> and **SPINE's jobs repository** merged after 4 rounds (PR #12). All five are on `main`, CI green
> on the current HEAD. See `progress/surface.md` and `progress/collect.md` for the corrected
> per-feature detail, and `MEMORY.md` **B-30** for the discrepancy itself.

> **Changed 2026-09-03.** This line read "no application code written" from the package's
> creation until F01 merged. `apps/web/` and `services/scorer/` now exist and the gate runs on
> both. See §Verified by execution — that section is no longer empty either, which is the more
> meaningful of the two changes.

Locked 2026-09-03 against a comprehension-speed thesis and **re-locked 2026-09-03** against a
materially changed owner intent — sixteen new decisions (D-08…D-23), eleven prior rulings
superseded, three new features. See `MEMORY.md` §1b and `SPEC-REVIEW.md`.

**Pre-build audit, 2026-09-03:** six gaps closed across F01, F20, F02, F07, F11,
`05-TEST-STRATEGY.md` §8 and `lane-verify` — chiefly amendment banners that added scope no DoD
ever gained. **F01 is executable as written; it was not before.** `MEMORY.md` §5 has the detail.

**Owner answers, 2026-09-03 (`MEMORY.md` §1e):** ten decisions, D-26 through D-35. Six manual
tasks closed (MT-00, MT-07's count, MT-12, MT-14, MT-03's tier, MT-06's transport), three open
questions closed (OQ-1, OQ-6, OQ-7) and one basis settled (OQ-8). **F02 is unblocked.** Highlights
that change the shape of the build:

- **D-30** — the universe is the 100 most-discussed on Reddit, ranked via ApeWisdom. Two costs
  carried forward: **ApeWisdom's independent cross-check role is retired** (it cannot validate a
  universe it selected), and the attention metric is **not independent of the selection**, so
  level is not interpretable and rank change is.
- **D-31** — no new market-data vendor. The price trigger runs on FMP Starter's **daily bars**,
  with an evidence-based upgrade trigger. Wave 1 unblocked at zero spend.
- **D-32** — D-20's budget adopted, but **X ceilings start at zero** until the trigger fires.
  Starting run rate ~$200/month, not $350.
- **D-29** — the Substack set is chosen by **sector coverage**, not by what the owner reads. This
  knowingly trades collection days for a defensible axis.
- **MT-13 confirmed unfiled** — the longest pole, and the only clock the owner does not control.

**Seven documentation defects closed in the same pass** (`MEMORY.md` §1e): MT-06's route table
still assigned `AI_MODEL_FAST` to stance classification that D-13 moved to the scorer service;
MT-12 asked for per-account limits D-11 voided; plus MT-01's stale row, `collect.md`'s Substack
contradiction, a dead `.gitattributes` pattern, `lane-build`'s wrong subagent tool name, and the
`Lane:` field collision across all 21 feature specs.

**2026-09-04 — production deployed for the first time; MT-15 confirmed.** A deployment-health
check found that **every Vercel production deploy since the project was created had failed** with
`VULNERABLE_NEXTJS_VERSION` — Vercel hard-blocks builds on Next.js 15.0–16.0.6 (CVE-2025-66478),
and `main` was pinned to 15.5.4. A prior session had already root-caused this and verified a fix
in a preview build, and Vercel's own bot had independently opened a CI-green PR bumping to
15.5.9; neither had been merged. Merging it (PR #11) put `investment-sentiment-analysis.vercel.app`
on a live, healthy production deployment for the first time — verified serving fixture-mode pages
correctly. **`ADMIN_EMAIL_ALLOWLIST` is confirmed empty in Vercel** (from the build log's own boot
assertion), so no admin can sign in against production yet — MT-03's Vercel step is not actually
done. Separately, **MT-15 is now fully confirmed by the owner**: 13 Substack publications across
10 of 11 GICS sectors (Utilities a disclosed gap after two research passes found nothing that
clears the weekly-cadence bar). See `DEPLOY.md` MT-15 and `MEMORY.md` **B-30**/**D-36**.

**2026-09-04 — MT-06 resolved (D-39).** LLM access is provisioned in Vercel: `AI_GATEWAY_API_KEY`,
`MODEL_TRANSPORT_DEFAULT=vercel_gateway` and the three D-34 task routes are set, owner-confirmed.
Not independently verified by this session — Vercel's API doesn't expose secret values, only that
the project deploys cleanly with no runtime errors in the last 7 days. **F10, F11 and F12 are now
unblocked** and await lane allocation at the Wave 2 gate; a live-mode misconfiguration will still
surface via F01 §4.2's existing boot assertion. See `MEMORY.md` D-39.

**Next work, in order:**

1. **`DEPLOY.md` MT-13** — file the Reddit application. **Confirmed unfiled on 2026-09-03.** Free,
   and now unambiguously the longest lead in the plan: it is the only remaining blocker whose
   clock someone else controls.
2. ~~**`DEPLOY.md` MT-15**~~ — **confirmed 2026-09-04.** 13 Substack publications, 10/11 GICS
   sectors. **This is still the only channel that can collect today** — no key, no approval — but
   collection now waits on wiring the confirmed list into F04's Substack config (COLLECT), an
   engineering task rather than an owner decision.
3. ~~**F01**~~ — **merged 2026-09-03.** The repository now has a toolchain, a gate and a
   shape to be parallel in.
4. ~~**F03 → F22 → F05**~~ — **all merged 2026-09-03.** The Wave 1 skeleton SPINE owed is
   built: persistence, PIT integrity, the calculation kernel and Inspector. F05's PR (#2) went
   through two adversarial `lane-review` passes (12 findings total, all closed) and merged
   with CI green on both deploy targets.
5. ~~**F06, F20's queue-and-persistence half, F02**~~ — **all merged 2026-09-03.** F06:
   thresholds re-derived per axis (`MEMORY.md` **B-26**), a serious off-by-N window bug found
   and fixed (**B-25**), five `lane-review` rounds. F20's queue half: the charging/attribution
   model settled (**B-24**), a real drain-loop bug found and fixed (**B-23**), five rounds. F02:
   OTP/abuse-controls/admin-gating/account-lifecycle, three rounds. Session logs dated
   2026-09-03 have the detail per feature. F04's remaining adapters and F16a stay blocked on
   MT-13 and MT-04 respectively.
6. **Next SELECTs**: **SURFACE → F07–F09** (dashboard, leaderboard, ticker detail — all three
   open now that F06 has merged, per `06-PARALLEL-LANES.md` §1b). **F07 merged 2026-09-04** (PR
   #7) — dashboard, market and sector composites, two review rounds. **F08's own repository
   blocker is now closed too**: the `attention_snapshot` repository it and F04's persistence half
   both need merged 2026-09-04 as a standalone SPINE gap-fill (`progress/spine.md`, `MEMORY.md`
   B-27), so F08 was genuinely buildable next, not just nominally open. **F08 merged 2026-09-03/04**
   after 55 total adversarial `lane-review` rounds (PR #15, resumed from a round-43 pause). **F09
   merged 2026-09-04** after 4 rounds (PR #16). **F04's X adapter (PR #14) and market-data
   collector (PR #13) both merged**, five review rounds each, as did **SPINE's jobs repository
   (PR #12)**, four rounds — all corrected into `progress/surface.md` and `progress/collect.md`
   on 2026-09-04 after those files were found stale against the tree (`MEMORY.md` **B-30**). F16a
   remains blocked on MT-04 (QStash schedule) — now genuinely just that one blocker, since
   SPINE's jobs repository is merged and the app has a stable production URL.

> **Housekeeping, 2026-09-04.** A CI-only integration test (`auth-otp-mechanics.test.ts`'s
> "rotates on resend") had been intermittently failing across three unrelated PRs and was
> root-caused, not merely re-run past — better-auth's `resendStrategy: 'rotate'` has no defined
> tiebreak on a `createdAt` collision (`MEMORY.md` **B-28**). Fixed in the test with a fake-clock
> advance; PR #9 merged first, then PR #6 (the e2e `DATABASE_URL` CI fix) and PR #8 (the
> `attention_snapshot` repository) each inherited the fix via a merge from `main` and merged
> clean. No feature status changes as a result — this closes out the last commits from Wave 2's
> in-flight work rather than starting anything new.

`PROGRESS.md`'s previous instruction — that the first task is to confirm MT-08 has started —
is not executable as written: MT-08 needs F04's collector and F16a's dispatcher, which need
F01, MT-04 and MT-13. MT-08 stays the most time-critical item in the plan under D-16, and the
way to serve it is the minimal-collector path in its own entry, not a check an agent cannot
perform.

## Serial prerequisite

| ID | Feature | Wave | Status | PR | Notes |
|---|---|---|---|---|---|
| F01 | Foundation and quality gates | 1 | **`merged`** 2026-09-03 | — (built on `main`) | **Done.** All eleven DoD items met. Both deploy targets green; five lint rules and three `check:*` scripts each proven by a failing-case test; every route in source §6.2 renders a fixture state, the `@calculationDrawer` slot and the `(.)calculations` interception included. **The lanes are open** |

**Unblocked 2026-09-03:** **F02** (D-26 closed MT-00); **F03's seed** (D-27/D-30 — 100 names,
most-discussed via ApeWisdom, ETFs excluded; ranking pulled and committed as
`apps/web/migrations/seed/universe-v1.json`, `MEMORY.md` **B-21** — only a live `DATABASE_URL`
stands between this and actually running `pnpm seed:universe`); and **F04's market-data half**
(D-31 — daily bars, no new vendor).

## Lanes

The letters in `03-ROADMAP.md` §2 (Lane P, Lane A, Lane G) label *dependency* lanes in the
graph. These are a different axis: **build lanes**, the unit of parallel assignment, named
rather than lettered so the two never read as the same thing.

| Lane | State | Owns | Features | Registry est. |
|---|---|---|---|---|
| **SPINE** | [`progress/spine.md`](progress/spine.md) | migrations, contracts, repositories, calc, analytics | F03, F22, F05, F06 | 62–80 h |
| **COLLECT** | [`progress/collect.md`](progress/collect.md) | scorer service, adapters, job services, fixtures | F20, F04, F16a | 38–50 h |
| **SURFACE** | [`progress/surface.md`](progress/surface.md) | app routes, ui, e2e, the three `check:*` scripts | F02, F07–F09, F15, F16b, F17–F19 | 48–64 h (W1–2) + 52–70 h (W4–5) |

> The registry rows in `03-ROADMAP.md` §2 sum to roughly **272–360 h**, against §1.1's revised
> total of **160–210 h**. The gap predates the lane split and is unresolved — treat the lane
> figures above as the registry's own numbers, not as a schedule.

## Not yet allocated to a lane

Wave 3 is allocated at the Wave 2 gate, when it is known which lane has capacity and whether
F10's corpora arrived.

| ID | Feature | Wave | Status | Blocker |
|---|---|---|---|---|
| F10 | Evidence and stance pipeline | 3 | `not started` | **MT-06 resolved 2026-09-04 (D-39).** Reworked: real corpora, three sampling frames. Awaiting lane allocation at the Wave 2 gate |
| F11 | Research agent and verifier | 3 | `not started` | **MT-06 resolved 2026-09-04 (D-39).** Now also the **measurement path** for F21. Awaiting lane allocation |
| F12 | Evaluation harness and judge | 3 | `not started` | **MT-06 resolved 2026-09-04 (D-39); OQ-7 closed by D-35.** No named blocker left. Extended with Tier D; evaluation harness built from scratch, not ported (D-18 superseded) |
| F21 | MCP server and MCP Apps surface | 3 | `not started` | — **New (D-10).** Placed at the Wave 3 exit, not after Wave 5 |

Status values: `not started` · `in progress` · `in review` · `merged` · `blocked` · `deferred`

## Wave gates

> **The 300 MB storage gate is retired, not waived (2026-09-03).** F03's projection reports
> **485.8 MB against F-07's 300 MB ceiling**, and F22 §4.5 then replaces that ceiling outright:
> the measured MB/month figure *"replaces F-07's fixed `< 300 MB` ceiling, which is the wrong
> instrument for a corpus designed to grow forever."* D-17 made the corpus permanent; the
> ceiling predates that. `MEMORY.md` **B-13** carries the reasoning.
>
> **What remains open is the measurement.** A rate needs two readings a day apart, and the
> collector has not run — `progress/spine.md` §Deferred names **MT-08 + 24 h** as the trigger.
> And B-09's finding is untouched: the projection's dominant term is an **assumed refresh
> cadence** no feature spec fixes, which is what any storage answer turns on.

| Wave | Gate | State |
|---|---|---|
| 1 | Walking skeleton **through the scoring boundary and the PIT store**: Reddit → raw store → queue → pinned scorer → analytics → artifact → Inspector → replay. CI green on both deploy targets. Scorer determinism and outage-abstention proven. Look-ahead guard fires. Collector live. Growth measured in MB/month. **OTP sign-in works and a non-allowlisted address is refused every operator route** (F02 — added 2026-09-03; this row omitted it while `03-ROADMAP.md`'s Wave 1 exit gate required it) | not reached |
| 2 | Dashboard, leaderboard and ticker page on live data; every number inspectable; **per-axis thresholds re-derived**; A2–A6 pass | not reached |
| 3 | Research streams, verifies, abstains; Tier B passes; Tier C judge gate passes; **Tier D1–D3 pass**; A1 passes; **F21 exposes the tool surface with no corpus leak** | not reached |
| 4 | Operator negative-auth and dispatcher idempotency pass; config/universe changes versioned with working rollback; trigger thresholds operator-editable and audited | not reached |
| 5 | Source §20 DoD (less the multi-tenant items D-11 voids) + Tiers A, B, C, D1–D3 | not reached |
| **—** | **Tier D4 promotion** — not part of "done". Runnable ~12 months after the collector starts | **~2027** |

## Global counters

Owner-written, or belonging to a feature no lane holds yet. **Lane-owned counters live in the
lane files** — see the three links above.

| Counter | Value | Needed | Owner |
|---|---|---|---|
| **Collector start date** | **NOT STARTED** | **Today. MT-08** | MT-08 |
| **Days of corpus accrued** | *derived: today − start date* | ≥ 14 for rank-change · ~365 for Tier D4 | — |
| Reddit API approval | **not applied** | Approved. **MT-13 — longest lead in the plan** | MT-13 |
| Judge/human Spearman (calibration) | not measured | ≥ 0.7 | MT-11 |
| Per-axis stance macro-F1 (Reddit / X / Substack) | not measured | ≥ 0.80 **per axis** (Tier D1) | F12 — lane TBA |
| Verifier catch rate (B7) | not measured | ≥ 0.90 | F12 — lane TBA |
| Verifier false-positive rate (B8) | not measured | ≤ 0.10 | F12 — lane TBA |
| Judge mean score (Tier C) | not measured | ≥ 4.0, no C2 < 3 | F12 — lane TBA |

Days accrued is **derived, not stored** — a stored counter would need a write every day and
would be wrong between writes. Record the start date once; compute the rest.

## Thresholds re-derived at F06's merge (2026-09-03)

Owned by SPINE. Every abstention threshold in this package was calibrated against a
5–12-snippet sampling regime that D-12 replaced. **A threshold calibrated to one sampling
regime is meaningless in another.** Re-derivation happened during F06's build (`MEMORY.md`
**B-26**) — each threshold was reconsidered per axis, and two of the three concluded
"unchanged, for a stated reason" rather than moving. Unchanged is not the same as unexamined.

| Threshold | Was | Re-derived to |
|---|---|---|
| `n ≥ 5` ⇒ stance score | Against 5–12 Linkup snippets | **Unchanged, locked.** `01-PRODUCT-SPEC.md` §6.3 / Tier B's B5 fix this at exactly 5 with no per-axis exception — a lane cannot lower a locked invariant to fit a hard case (a first draft tried '3' for X by analogy with news; reverted). X is expected to abstain on most 15-minute windows under D-15's event-conditional sampling — disclosed as a property of that axis, not treated as a threshold gap |
| `n ≥ 3` ⇒ news sentiment | Against Marketaux's 3-article cap | **Unchanged.** The 3-article cap is Marketaux's own free-tier request limit — the abstention floor and the API ceiling are the same number, not independently derived, so there is nothing to re-derive without a different provider |
| `n_eff ≥ 8` ⇒ display | Against a relevance-ranked result set | **Unchanged at 8, per axis, with a named trigger.** Held at Reddit's original 8 for X and Substack too (a first draft tried 5 for X, which is degenerate against a `min_items` of 5 — an empty low-adequacy band). Revisit **`display_floor` only** (never `min_items`) once `DEPLOY.md` MT-08 + the relevant channel's collection have both run 14 days, against the observed per-window item-count distribution |

## Deferred

| Item | From | Reason | Trigger to revisit |
|---|---|---|---|
| **F13 valuation engine** | D-04 | D-19: 30–38 h locked for a product whose thesis changed | A valuation question becomes load-bearing in use, or v1 ships with capacity to spare |
| **F14 scenario governance** | D-04 | D-19: F05's Inspector serves J5 without it | With F13 |
| **Governed X account taxonomy** | source PRD | D-23: X is ~5% of the corpus at D-20's budget | X exceeds 15% of scored items, or a cohort question becomes load-bearing |
| **Sarcasm detection; long-form Substack stance** | D-21 | Not needed for v1's accuracy gate | Measured error attributable to either |
| **Cohort segmentation within a platform** | owner | "Aggregate first." Platform separation (D-14) is mandatory; cohort separation is not | A cohort question becomes load-bearing |
| **Real-time market data** | D-20 | Traded for 3.3× the X sample | Any intention to act intraday off this system (~$120/mo, no rebuild) |
| **Capacity fallback (LLM-scoring a backlog)** | D-13 | Hook provisioned, path not built | The scoring queue actually backs up |
| Hugging Face shadow evaluation | source ADR-011 | F-21 | **Partly superseded by D-13** — pinned models are now primary, not shadow |
| Alpha Vantage as a systematic validator | source ADR-006 | F-09 | Never as specced; `CONGRESS_TRADES` only |
| Public signup | source ADR-016 | **Out of scope under D-11**, not deferred | — |

## Verified by execution

**Every number in this package is still a specification or an estimate** — including the storage
projections, the X sampling arithmetic and the effort re-baseline. What has now been executed is
the *gate*, not any product claim:

| Verified | How | Date |
|---|---|---|
| The full gate runs green with `PROVIDER_MODE=fixture` and **no provider keys present** | `lint`, `typecheck`, `test:unit`, `test:contract`, `test:integration`, `build`, `test:e2e`, and all three `check:*` | 2026-09-03 |
| All five architectural lint rules fire on a crafted violation and pass on the legal form | 54 rule-tester cases | 2026-09-03 |
| Each of the three custom checks can fail | 32 cases over crafted inputs, plus one end-to-end leak built and scanned for real | 2026-09-03 |
| Every route in source §6.2 returns 200 and renders a fixture state, with no console errors | 44 Playwright cases, including the parallel slot and the intercepted route | 2026-09-03 |
| The scorer lane runs and **a seeded failure in it exits non-zero** | 16 cases in `services/scorer/` | 2026-09-03 |
| No `HF_*`, no `FEATURE_HF_SHADOW`, no `LINKUP_API_KEY` and none of the four D-11 keys appear in application code | `tests/unit/codebase-invariants.test.ts` | 2026-09-03 |
| Ticker text is the primary or foreign key of no table, and a reassignment leaves prior snapshots attributed to the original company | schema query + a reassignment test, not inspection | 2026-09-03 |
| Append-only is enforced by the database: UPDATE and DELETE are rejected on all ten tables §4.1 names | trigger tests, including the error text | 2026-09-03 |
| A decimal survives DB → domain → DB **byte-identically**, `0.30000000000000004` included | 10 serialization-parity cases against a real Postgres | 2026-09-03 |
| At most one active config version and one active universe version, under a concurrent activation | partial unique index + activation transaction tests | 2026-09-03 |
| The universe seed is idempotent across three runs and never resurrects an admin-removed symbol | 8 seed tests | 2026-09-03 |
| **Storage at 100 symbols: 485.8 MB — over the 300 MB gate** | `pnpm --filter web check:storage` | 2026-09-03 |
| Every source file on disk is tracked by git | `tests/unit/tracked-sources.test.ts`, after a `.gitignore` pattern silently excluded a route (`MEMORY.md` B-10) | 2026-09-03 |
| **The look-ahead guard fires, and its test fails if the guard is removed** | The guarded query is paired with the same query minus the `ingested_at` bound; the unguarded arm returns the late-ingested fact the guarded arm excludes (F22 §7 step 1) | 2026-09-03 |
| A read of a bitemporal table outside `asOf` fails the build | `no-unbounded-pit-read` armed with the real table set; a failing case per table, and the list checked against the migrations | 2026-09-03 |
| The retention path refuses to delete normalized social rows, and refuses even when they look expired | `RetentionRefused` on all five permanent-corpus tables | 2026-09-03 |
| An artifact DELETE is possible only inside the audited retention process, and UPDATE not even there | 4 tests, including an UPDATE attempted *inside* the process (`MEMORY.md` B-12) | 2026-09-03 |
| The coverage floor is written once per axis and cannot be moved | Database trigger; a collector restart is a no-op, not an update | 2026-09-03 |
| A quiet collection window does not manufacture a coverage gap | Gap detection reads heartbeats, not data — `items_seen = 0` with a heartbeat is not a gap | 2026-09-03 |
| A window crossing a gap abstains rather than computing over the hole | 17 pure cases over `evaluateWindow` / `segmentAcrossGaps` | 2026-09-03 |

**Not yet verified by execution:** the Docker image build. There is no Docker daemon in the
session that authored F01, so `services/scorer/Dockerfile` is exercised for the first time by
CI's `scorer` job. It is a `COPY` and a `CMD` with no install step, but it has not been built.

## Session log

One file per session in [`progress/log/`](progress/log/), named
`YYYY-MM-DD-<lane>-<slug>.md`. A new file per session cannot conflict with another session's;
a shared table appended at the tail conflicts every time. `.gitattributes` sets `merge=union`
on that directory as a second line of defence.
