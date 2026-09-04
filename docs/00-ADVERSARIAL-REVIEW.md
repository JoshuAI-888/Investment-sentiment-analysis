# Adversarial Review — Source PRD v1.5

> **RNI note (2026-09-05):** this remains the historical review of the legacy product. The
> isolated Retail Narrative Intelligence lane has its own adversarial review and conflict
> closure matrix in `rni/ARCHITECTURAL_REVIEW.md` and `rni/INTEGRATION_PLAN.md`.

**Subject:** `reference/SOURCE-PRD-v1.5.md` (4,486 lines, dated 2026-09-03)
**Reviewer posture:** hostile. The goal is to find the places where the document would
have produced a build that fails, misleads, or cannot be finished — not to praise it.
**Review date:** 2026-09-03
**Outcome:** 22 findings. 4 resolved by owner decision, 14 resolved by ruling in this
package, 4 remain open and are tracked in `MEMORY.md`.

> **Read as of 2026-09-03.** This document is a historical record and is not edited. The
> **2026-09-03 re-lock** (`MEMORY.md` §1b) superseded or reversed several of its rulings — most
> consequentially **F-05** (the ApeWisdom dependency was accepted on the premise that "there is
> no licensed alternative at this budget"; that premise is now false and D-12 replaces the
> source) and **F-07** (its `< 300 MB` storage ceiling is the wrong instrument for a corpus that
> is permanent by design). `MEMORY.md` §4 records every supersedure with its reason.
>
> The findings themselves stand. It is the *rulings* that expired, and they expired because their
> premises did — which is worth noticing when re-reading any of them.

---

## What the PRD gets right

Stated up front so the criticism below is read in proportion. This is an unusually
disciplined requirements document. Specifically:

- **ADR-008 (LLMs do not calculate)** is the single most important decision in the document
  and it is correct. Most products in this category get this wrong.
- **The refusal to scrape** X/Stocktwits, and the mandated `observed sample` /
  `coverage-limited` labelling, is honest engineering under a real legal constraint.
- **ADR-019 (immutable, replayable calculation artifacts)** is a genuinely strong idea,
  rarely specced this early, and it is what makes the trust story credible.
- **§18.2** already contains a self-run adversarial review of thirteen architectural
  temptations. Those thirteen rulings survive this review unchanged and are not re-litigated
  here.
- The provider selection in §4 is sourced, costed, and honest about entitlement risk.

The findings below are about the gap between that document and an executable build.

---

## Severity key

| | Meaning |
|---|---|
| **S1** | Would cause the build to fail, mislead users, or produce a legally/financially unsafe output. |
| **S2** | Would cause significant rework, quota exhaustion, or an unfalsifiable claim of success. |
| **S3** | Gap or inconsistency that should be closed before the relevant feature starts. |

---

## Findings

### F-01 — S1 — The 48-hour window is off by roughly a factor of four

**The claim.** §15: "approximately 42–54 focused engineering hours," fitting "one to two
calendar days" via four parallel agent worktrees.

**Why it fails.** The same document enumerates, as non-cuttable P0: 27 database tables
(§7.2); an arbitrary-precision calculation artifact engine with canonical hashing, frozen
replay and a method registry (§8.8); twelve functional areas F01–F12; roughly twenty
audited admin mutation surfaces (F09); a scenario system with bounded overrides, sharing
and an issue queue (F12); an architecture explorer that must reconcile against a live
manifest in CI (F10); seven provider adapters; and a research agent with a verifier and a
claim ledger. §15.1's "do not cut" list retains essentially all of it. Two of the six
headline deliverables (Calculation Inspector, agentic research) are each multi-day features
on their own.

An honest bottom-up estimate is **180–240 engineering hours**. The 42–54 figure appears to
count UI assembly and to omit the calculation kernel, the schema, the admin plane and the
test suites the same document mandates.

**Second-order damage.** A build loop given a false budget does not deliver in the budget —
it silently drops the expensive invariants, which here are exactly the trust invariants
(traces, provenance, abstention). The PRD anticipates this ("silently dropping
trace/provenance coverage would violate the owner's explicit requirement") but does not
remove the cause.

**Ruling — owner decision.** Scope is kept; the timeline is re-baselined. Five waves, each
ending in something demoable. See `03-ROADMAP.md`.

---

### F-02 — S1 — None of the eleven success criteria can fail on quality

**The claim.** §2.3 lists eleven PoV success criteria.

**Why it fails.** Every one is mechanical: latency percentiles, "every claim has a visible
source link," "re-running produces the same metrics," "the app abstains when evidence is
insufficient," "spend below $50." A system that produces confidently wrong narratives,
cites sources that do not support them, and mislabels a rising ticker as falling passes all
eleven. The PRD's own stated outcome — "move from *what is retail attention doing?* to a
source-backed, numerically grounded explanation in under 30 seconds" — contains the word
*explanation*, and nothing in §2.3 tests whether the explanation is any good.

§14.4 does define real quality thresholds (stance macro-F1 ≥ 0.80, relevance precision
≥ 0.95, 100% of material claims referenced). Those are release gates for the LLM work
package, not success criteria for the product, and the two lists never meet.

**Ruling.** §14.4's thresholds are promoted into the product success criteria, and a
comprehension-quality gate is added on top of them. See `01-PRODUCT-SPEC.md` §4. The
mechanical criteria are retained as necessary-but-insufficient.

---

### F-03 — S1 — The stance score applies population statistics to a non-random sample

**The claim.** §8.2 computes `raw_social`, then `shrunk_social` with effective sample size
`n_eff`, then a `confidence` from coverage and agreement, and displays a score once
`n_eff >= 8`.

**Why it fails.** The inputs are 5–12 snippets returned by a **Linkup web search restricted
to `reddit.com`** (ADR-005, §3). That is a relevance-ranked search result set, not a sample
from a population. Shrinkage, effective sample size and a two-term confidence formula are
machinery for random samples; applied to a search ranking they manufacture precision that
does not exist. A `confidence: 0.78` next to a stance of `+0.41` reads to a user as a
measurement with a known error bar. It is not one.

The PRD elsewhere shows it understands this exact failure mode — §3 refuses engagement-
weighted sentiment because "a weighted sentiment would create false precision." The same
objection applies with more force here, because search-rank bias is stronger and less
characterisable than engagement bias.

**Ruling.** Keep the arithmetic (it is a reasonable smoother and it is deterministic and
inspectable). Change what it is called and how it is shown:

- The displayed number is labelled **"stance of sampled snippets"**, never "Reddit
  sentiment", "social sentiment" or "retail stance".
- `confidence` is renamed **`sample_adequacy`** and is described in the UI and the
  Calculation Inspector as *"how much material we had to look at, not how likely this is to
  be right."*
- Every stance display carries `n`, the retrieval query, the date window, and the sentence
  "selected by relevance search, not a representative sample."
- The Calculation Inspector page for a stance metric must state the selection-bias
  limitation in its assumptions block. This is a DoD item in F10, not a copy suggestion.

---

### F-04 — S1 — Open signup plus paid per-request providers is an unmetered cost liability

**The claim.** ADR-016 / §1.2: "Open account creation is allowed for any successfully
verified email." Budget: $100/month hard, warn at $80. Research runs consume Linkup
($0.005/call) and LLM tokens.

**Why it fails.** Anyone on the public internet with a working email address can create an
account and then trigger research runs that spend the owner's money. The PRD mentions
"rate limits, abuse monitoring and account deletion" as a guardrail sentence, and a global
budget with a hard stop at $100 — but a global hard stop is not a defence, it is the damage
report. One motivated user, or one script, exhausts the month's budget and the hard stop
then denies service to everyone including the owner during a demo.

There is a second vector: the OTP endpoint itself. Better Auth + Resend with open signup
means an unauthenticated attacker can drive email sends against arbitrary addresses. Resend
free tier is 100 emails/day; the sending domain is `accounts.joshuai.nz`, a real domain
whose reputation is at stake.

**Ruling.** Three changes, all P0:

1. Signup remains open but **new accounts start in a `pending` tier** with research runs
   disabled and read-only access to cached dashboard state. The admin promotes to `member`.
   This preserves "open signup" as owner-decided while removing the spend path.
2. **Per-account budget**, not just global: daily and monthly caps on research runs and on
   priced provider calls, enforced server-side before the call, recorded in `cost_event`.
3. **OTP send throttle**: per-email, per-IP, and a global daily ceiling below the Resend
   free allowance, with a circuit breaker that disables signup (not sign-in) when tripped.

Tracked in F02 and F18.

---

### F-05 — S1 — The whole attention product rests on one unlicensed, SLA-free source

**The claim.** ADR-004: ApeWisdom is the attention index. §3 concedes it has "no published
commercial data license or SLA."

**Why it fails.** Two of the six headline deliverables (the leaderboard; the "explain why
this ticker moved up the ranking" job) and one of four market-composite components have
exactly one source. If ApeWisdom changes its response shape, rate-limits, or goes away, the
product has no attention data at all and the dashboard's primary axis is blank. §19's
runbook for this says "serve last snapshot with stale label" — which is correct and also
means the product's core value proposition degrades to a frozen list.

The deeper problem is definitional, not availability: ApeWisdom scans *its own selected
subreddit list* twice hourly, and that list is not contractually stable. The metric we
present as "attention" is "whatever ApeWisdom counted today," and its methodology can change
without notice or version.

**Ruling.**
- Accept the dependency for the PoV — there is no licensed alternative at this budget, and
  the PRD's labelling discipline is the right mitigation.
- **Add**: pin and record the ApeWisdom methodology version/date with every snapshot, and
  surface it in the Inspector. If the observable subreddit list or field set changes,
  snapshots before and after are not comparable and rank-change must be suppressed across
  the boundary. This is a DoD item in F08.
- **Add**: a documented degraded mode where attention is unavailable but the ticker page,
  news sentiment, price regime and research flow still function. F18.
- Production replacement is already correctly scoped as a procurement workstream.

---

### F-06 — S1 — Day-1 rank-change is mostly unmeasurable, and the demo depends on it

**The claim.** §8.1 computes `rank_change = rank_prior - rank_current`; §8.1 also requires
"at least 14 comparable snapshots" before showing the robust z-score. §2.3 requires a
first-time user to "understand the top three observed attention changes."

**Why it fails.** On a freshly deployed system, local snapshot history is empty. The only
prior rank available is ApeWisdom's own `prior_rank` over *its* window, which the PRD itself
flags must be "labeled as provider-defined" if the windows differ. The anomaly z-score
requires 14 snapshots — at the planned cadence that is days of runtime. So at the moment of
the demo, the product's headline feature shows provider-defined deltas and a great many
`NEW` / `THIN_SAMPLE` states, which is precisely the "blank page" experience §2.3 forbids.

**Ruling.** A **warm-up job is a first-class deliverable, not an operational afterthought**:
the snapshot collector must be deployed and running against the seed universe **at least
14 days before any evaluated demo**, and `PROGRESS.md` carries a "history depth" counter.
Until depth ≥ 14, the UI shows provider-defined deltas with an explicit label and hides the
z-score. Warm-up start is a blocking manual task (`DEPLOY.md` MT-08) and is scheduled in
Wave 1, before the features that consume it.

---

### F-07 — S2 — "An artifact for every chart point" does not fit the chosen infrastructure

**The claim.** §20 DoD: "every rendered deterministic metric **and historical chart point**
links to an immutable calculation snapshot" with inputs, ordered steps and hashes. Storage:
Neon Free, 0.5 GB.

**Why it fails.** Arithmetic. 100 active symbols × 180 sessions of adjusted-return history
= 18,000 artifacts for **one** series. Each artifact implies one `calculation_snapshot` row
plus N `calculation_input` rows plus M `calculation_step` rows. At a conservative 4 inputs
and 6 steps per point and ~150 bytes/row, that is ~30 MB for one series before indexes —
and the PRD wants this for price returns, attention metrics, sentiment aggregates,
composites, technicals, valuation and, per §18.1, even "cost/freshness outputs." Ten such
series and the free tier is gone, with a 90-day normalized retention policy (§1.2) that does
not cover artifacts at all.

Write volume is the worse half: materialising per-point artifacts on every refresh is a
sustained insert load on a scale-to-zero database, and the PRD's own performance gate allows
"up to 100 inputs / 250 trace steps" per artifact.

**Ruling — artifact granularity is defined here and is binding on F05:**

- The unit of an artifact is a **computation invocation**, not a rendered pixel. A 180-point
  return series is **one** artifact whose inputs are the price series reference and whose
  steps describe the vectorised transform, with a per-point derivation table.
- A chart point links to `{calculation_id, point_index}`; the Inspector resolves the point
  from the artifact. This satisfies "every chart point is inspectable" without an artifact
  per point.
- Artifacts carry the same 90-day retention as normalized data, plus permanent retention for
  any artifact referenced by a claim ledger entry, a share grant, or an open issue.
- F05's DoD includes a measured storage projection at 100 symbols; if it exceeds 300 MB the
  granularity rule is revisited before Wave 2 starts.

---

### F-08 — S2 — Marketaux free tier has no headroom, and development shares the quota

**The claim.** ADR-003: Marketaux Free, 100 requests/day, 3 articles/request, as the
*primary* news-sentiment source for 30 tickers, 11 sector ETFs and the market composite.

**Why it fails.** Steady state at one refresh per ticker per day is 30 + 11 + 1 = 42
requests, leaving 58/day. That sounds fine until you add: on-demand ticker research (the
product's main interaction), retries, the second daily refresh implied by an intraday
dispatcher, and — critically — **every developer and CI run consumes the same 100**. A
single afternoon of integration work against live Marketaux exhausts the day's quota and
the dashboard degrades for the rest of it. The 3-article cap also means news sentiment for
a given ticker is computed from at most three articles, which interacts badly with F-03: a
shrunk mean over n=3 is close to noise.

**Ruling.**
- **Separate keys or hard separation of environments.** CI and local development run against
  recorded fixtures by default (`PROVIDER_MODE=fixture`); live calls require an explicit flag
  and are counted. Enforced in F04.
- A **server-side daily quota ledger per provider** that refuses the call before it is made,
  rather than discovering exhaustion from a 429. F04 + F18.
- News sentiment computed from n < 3 entity-tagged articles is shown as
  `insufficient_data`, not as a number. F06.
- `DEPLOY.md` MT-05 flags the Basic-tier upgrade decision with the trigger condition.

---

### F-09 — S2 — Alpha Vantage at 25 calls/day cannot function as a validator

**The claim.** ADR-006: Alpha Vantage is "a validator and specialty fallback," used to
"cross-check selected outputs."

**Why it fails.** 25 calls/day across a 30-symbol universe validates roughly nothing on any
schedule, and cross-checking is only meaningful if it is systematic. As specified it is a
decorative dependency that still costs an adapter, a fixture set, contract tests, a health
check and a runbook entry.

**Ruling.** Demote. Alpha Vantage is **not** built in Wave 1–3. It appears in Wave 4 solely
behind the `FEATURE_CONGRESS` flag for `CONGRESS_TRADES`, which is the one dataset the other
providers do not have. The "validator" role is reassigned: cross-checking is done against
**FMP's own DCF and analyst-consensus endpoints** (which the PRD already requires displaying
separately, ADR-018) and against SEC XBRL for fundamentals. Recorded as a supersedure in
`MEMORY.md`.

---

### F-10 — S2 — The verifier is an unmeasured LLM checking an LLM

**The claim.** §10.6 and ADR-defended §18.2: every answer gets deterministic verification
plus "one bounded model verification pass." The verifier is P0 and must not be dropped.

**Why it fails.** The decision to keep it is right; the specification of it is incomplete in
the one way that matters. Nowhere does the PRD state **how good the verifier is**. There is
no seeded-error set, no measured catch rate, no false-positive rate on correct answers. A
verifier with an unmeasured catch rate is a compliance artifact, not a control — and it is
being relied on as the last line of defence before financial prose reaches a user.

There is also a silent-failure path: if the verifier itself errors or times out, the PRD
does not say whether the answer publishes. Given §18.2 ("do not publish unverified prose"),
it must not — but that needs to be a tested behaviour, not an inference.

**Ruling.**
- The **deterministic** checks carry the real load and are enumerated exhaustively in F11:
  every numeric in the prose must string-match a stored metric value at its display
  rounding; every citation marker must resolve to an `evidence_item` row; no
  recommendation-class verbs; date claims must be consistent with evidence timestamps.
  These are code, testable, and cannot hallucinate.
- The **model** pass is measured against a **seeded-error corpus**: ≥ 40 answers with
  injected faults (wrong number, swapped ticker, unsupported causal claim, stale date,
  buy recommendation, citation pointing at an unrelated source). Release gate: catch rate
  ≥ 0.90 on injected faults, false-positive rate ≤ 0.10 on known-good answers. F12.
- Verifier error or timeout ⇒ the run completes in `verification_failed` state, deterministic
  metrics are shown, prose is withheld. Tested in F11.

---

### F-11 — S2 — Contracts are frozen in hours 0–2, before the adapters are probed

**The claim.** §15: contracts committed in Hours 0–2, then four parallel lanes build against
them. §15's own Hours 2–5 block says: "Probe and fixture FMP … endpoints … **record
entitlement failures**."

**Why it fails.** The document schedules the discovery of what the providers actually
return *after* it schedules the freezing of the types that describe them. FMP plan
entitlements are explicitly uncertain in ADR-002 ("Personal plan and endpoint entitlements
must be tested"). Every entitlement failure found in Hours 2–5 invalidates a contract three
lanes are already building on. Parallelism amplifies this: four agents rebasing on a
changing contract is worse than one agent discovering it serially.

**Ruling.** This is the structural reason the roadmap opens with a **walking skeleton**
(Wave 1) rather than a contract-freeze-then-fan-out. Wave 1 drives one metric end to end —
provider call → normalized row → deterministic calculation → persisted artifact → rendered
value → Inspector page → replay — against **live FMP and ApeWisdom**. Contracts harden by
surviving a real round trip. Parallel lanes begin in Wave 2, on contracts that have been
executed rather than imagined. F04's DoD includes a written entitlement report per endpoint.

---

### F-12 — S2 — Vercel Hobby, a 30-second p95, and public signup do not coexist

**The claim.** ADR-001 fixes Vercel Hobby. §2.3 requires completed research at ≤ 30 s p95
with a first event under 1 s. ADR-016 opens signup to the public. §4.1 notes in passing:
"use Pro for a business/public PoV; Hobby is best treated as personal/testing."

**Why it fails.** Three ways.
1. **Headroom.** A research run fans out to Linkup + FMP + Marketaux, classifies snippets,
   synthesises, then verifies — two to three sequential model calls. A 30 s p95 target under
   a hard function ceiling means the p99 is a timeout, and the streaming response holds the
   connection open for the duration.
2. **Terms.** Hobby is a personal, non-commercial plan. A publicly-signed-up user base on a
   custom domain is the fact pattern Vercel's own guidance points away from, and the PRD
   knows this and fixes Hobby anyway in the very next breath.
3. **Cost model.** §16's "near-free" column assumes Hobby; moving to Pro is $20/month
   against a $100 budget that also carries FMP at $22.

**Ruling.**
- Keep Hobby for Waves 1–4 (development and private demos, owner and invited accounts only).
- **Signup stays closed to the public while on Hobby** — which the `pending`-tier ruling in
  F-04 already implements.
- Moving to Pro is a **gate on the public demo**, not a nice-to-have: `DEPLOY.md` MT-09.
- The latency budget is decomposed per stage in F11 with a hard total wall-clock cap and a
  partial-result path: deterministic metrics stream first and remain if prose times out.
  A timed-out prose stage is a `degraded` result, not an error page.

---

### F-13 — S2 — The Definition of Done is a production release checklist

**The claim.** §20 lists ~35 conditions under which "the 48-hour PoV is done."

**Why it fails.** It includes commercial rights documentation, retention enforcement,
audited admin impersonation, share revocation, budget hard-stop behaviour, CI manifest
reconciliation and full a11y. Each is defensible; collectively they define a product ready
to take money, and they are all gated on a single monolithic pass/fail at the end of the
build. A build loop cannot use this — there is no point before the last hour at which
anything is "done," so there is nothing to merge against.

**Ruling.** The DoD is decomposed. Every feature F01–F19 carries its own DoD, and each wave
carries an exit gate. §20's list is retained intact as the **Wave 5 release gate** in
`03-ROADMAP.md`, where it belongs.

---

### F-14 — S2 — No CI exists, and every exit gate is "tests pass"

**The claim.** W00 delivers "lint, typecheck, unit, integration, and E2E commands" and a
"CI pipeline." Every subsequent work package exits on tests passing.

**Why it fails.** In an agentic loop the agent both writes the tests and reports that they
pass. Without CI running independently on the pushed branch, "tests pass" is an assertion by
the party being graded. The host repository for this package currently has **no test
workflow at all** — its own `docs/progress.md` names that as its single cheapest missing
improvement, which is a live demonstration of how this gap persists.

**Ruling.** CI is the **first** deliverable of F01 and is blocking: no feature PR may merge
without a green independent run. The loop protocol in `04-BUILD-LOOP.md` requires the PR
body to link the CI run, and treats a locally-green/CI-red state as a hard stop.

---

### F-15 — S3 — The admin allowlist email may lock the owner out

**The claim.** ADR-016 and §6.3: `ADMIN_EMAIL_ALLOWLIST="joshuaifang@gmail.com"`.

**Why it fails.** The account driving this project is `joshuafang@gmail.com` — no `i`. The
PRD's spelling matches the `joshuai.nz` domain handle, so it is plausibly deliberate, but if
it is a typo then the deployed application has **no reachable administrator** and the admin
plane (universe activation, config, budgets) is unusable, recoverable only by redeploying
with a corrected environment variable.

**Ruling.** Blocking verification before F02 ships: `DEPLOY.md` MT-00. Additionally, F02's
DoD requires a **startup assertion** that the allowlist is non-empty and syntactically
valid, and a boot-time log line naming the configured admin address, so a mismatch is
visible in the first deploy rather than at first admin click.

---

### F-16 — S3 — Golden tests against live providers are not golden

**The claim.** §14.3 defines a 30-symbol golden set including specific edge cases
("recent high-attention name: RDDT", "thin sample", "new entrant with no prior rank").

**Why it fails.** Those conditions are properties of the market on a given day, not of a
symbol. RDDT is only a high-attention name while it is one; a "new entrant with no prior
rank" is whatever ApeWisdom returned that morning. A test suite whose expectations depend on
live market state fails for reasons unrelated to the code, and an agentic loop responds to
flaky red by weakening the assertion.

**Ruling.** Split the concept in two, and never conflate them:
- **Golden fixtures** — frozen recorded provider payloads, committed, deterministic,
  covering every edge case by construction. All numeric and state-machine assertions run
  here. This is what CI runs.
- **Live smoke** — a separate, non-blocking suite asserting only shape and reachability
  against real providers, run on demand and on a schedule, never in the merge gate.
Specified in `05-TEST-STRATEGY.md` and enforced in F04's DoD.

---

### F-17 — S3 — Divergence states and "what would falsify this" imply predictive value the product disclaims

**The claim.** ADR-010 forbids recommendations. §8.6 produces states like "Bullish
discussion / weak tape" with the caveat "causality is unproven." §2.2 includes "Tell me what
would confirm or falsify the current thesis."

**Why it fails.** The disclaimers are about *recommendation*, and the risk here is about
*implied prediction*. A UI that names a divergence state, then offers "what to monitor next"
and a falsification test, is presenting a hypothesis with an implied edge. §2.4 lists
"historical backtesting of social signals" as a non-goal — so the product asserts these
states matter while explicitly declining to check whether they do. That is a defensible PoV
boundary and an indefensible silent one.

**Ruling.** Keep the feature; make the boundary explicit and visible.
- Every divergence state carries a fixed, non-LLM-authored line: *"This is a description of
  what is currently observable. It has not been tested against historical returns and is not
  a forecast."*
- The Architecture Explorer's assumptions tab states that no backtest exists. F17 DoD.
- The word "signal" is banned from user-facing copy; "state" or "pattern" is used.
  Enforced by a copy lint in F19.

---

### F-18 — S3 — Open signup with no privacy, terms, or deletion specification

**The claim.** §6.2 has route stubs at `(legal)/privacy` and `(legal)/terms`. §20 requires
"deletion/revocation" as an auth test. §1.2 sets retention at 7 days raw / 90 days
normalized.

**Why it fails.** That is the entirety of it. A publicly-signable-up product that stores
account email, session data, per-user assumption profiles, share grants and issue reports
has data-subject obligations, and a `page.tsx` stub is not a specification. Retention is
specified for provider data and not for user data. There is no account-deletion flow beyond
a test name, and no statement of what deletion does to a share grant someone else holds.

**Ruling.** F02 owns a **user-data lifecycle spec** as a deliverable: what is stored, where,
for how long, what account deletion removes versus anonymises (share grants are revoked;
issue reports are anonymised, not deleted, because they are an audit trail), and an export.
Privacy/terms copy is a manual owner task, `DEPLOY.md` MT-10, flagged as **not legal advice
and requiring review by a person qualified to give it** given the financial-content and
cross-jurisdiction (NZ sender domain, US equities, unrestricted signup) posture.

---

### F-19 — S3 — Evidence URLs rot, and the claim ledger assumes they do not

**The claim.** Evidence is stored as URLs plus short snippets (ADR-005). The claim ledger
resolves material claims to evidence IDs. Calculation artifacts are immutable and replayable.

**Why it fails.** A Reddit post cited in a stored research answer can be deleted by its
author the next hour. The user then opens the evidence drawer on a saved run and gets a 404
behind a claim the verifier passed. The PRD's own §13.2 raises deletion handling — but as a
*production* concern under licensing, not as a PoV behaviour. Immutability of the artifact
does not extend to the internet.

**Ruling.** F09/F10:
- `evidence_item` stores retrieval timestamp, the snippet as retrieved, and a
  `last_checked_at` / `availability` pair.
- The drawer renders the stored snippet with the source link, and labels a link that failed
  its last check as *"source no longer reachable — snippet as retrieved on {date}."*
- Availability is never repaired in place and never invalidates a completed run; it is
  displayed state.
- No archival copies are stored beyond the snippet already permitted, which keeps the
  deletion-compliance posture the PRD chose.

---

### F-20 — S3 — There is no rollback for a bad answer already shown to a user

**The claim.** §19 has runbooks for provider outages, quota, dispatcher faults, config
errors and replay mismatches.

**Why it fails.** The highest-consequence failure in a financial-explanation product is a
plausible, verified, wrong answer that a user acted on — and that is the one failure with no
runbook. There is no way to mark a `research_run` as retracted, no user-visible notice, no
path from the calculation-issue queue to "this specific answer was wrong."

**Ruling.** F11 adds a `retracted` state on `research_run` with a reason and an actor,
surfaced wherever the run is rendered (including shared scenario snapshots), and a runbook
entry. Retraction never deletes: the run, its claims and its artifacts remain for audit.

---

### F-21 — S3 — Hugging Face shadow evaluation is specced but has no owner, budget, or exit

**The claim.** ADR-011 and §4.5 evaluate candidate models; §15 Hours 12–16 adds an optional
disabled-by-default HF adapter "if time remains"; §4.5.7 gates promotion on a labelled-set
report.

**Why it fails.** It is conditional on slack in a plan that has none (F-01), gated on a
labelled dataset that §14.4 assigns to a different work package, and has no promotion
decision date. It will be built as a stub and never evaluated, while contributing seven
environment variables and a model-routing branch.

**Ruling.** Cut from Waves 1–5 entirely. The LLM classifier is the sole stance engine for
the PoV. The HF work becomes a **post-PoV research spike** with its own entry condition:
the F12 labelled set must exist and the LLM classifier's cost must be measured first, so
there is a baseline to beat. Recorded in `MEMORY.md` as deferred with rationale; the
`HF_*` environment variables are removed from F01's schema.

---

### F-22 — S3 — Owner-selected quality gate is an unvalidated judge

**The claim (this package's own, not the PRD's).** The owner selected an automated LLM judge
as the sole quality bar for the comprehension thesis.

**Why it is a risk.** An LLM judge grading LLM output correlates with human judgement only
loosely, and it is systematically forgiving of fluent, well-cited, subtly wrong prose —
which is exactly the failure mode this product must catch. Adopted without qualification, it
would recreate F-02: a gate that cannot fail.

**Ruling — implement as chosen, with the cheapest possible validation.** The judge is built
(F12) and is the CI gate. In addition, and non-blocking to the loop:
- The judge is **calibrated once** against a 20-item set that the owner scores by hand
  (~30 minutes of work, `DEPLOY.md` MT-11). If judge/human agreement is below 0.7 Spearman,
  the judge's thresholds are raised rather than trusted.
- The judge is **adversarially validated** against the F-10 seeded-error corpus, which it
  must catch. A judge that scores a known-wrong answer ≥ 4/5 is itself a defect.
This keeps the loop fully automated while making the judge falsifiable.

---

## Findings that remain open

Carried into `MEMORY.md` as open questions; none blocks Wave 1.

| ID | Question | Needed by |
|---|---|---|
| OQ-1 | Is `joshuaifang@gmail.com` correct, or is it `joshuafang@gmail.com`? (F-15) | F02 |
| OQ-2 | Does the FMP Starter plan actually entitle every endpoint the valuation engine needs? Unknown until probed. (F-11) | F13 |
| OQ-3 | Public demo requires Vercel Pro and an FMP display agreement. Is a public demo in scope at all, or is this always private? (F-12) | Wave 5 |
| OQ-4 | Who writes and reviews privacy/terms for a financial-content product with open signup? (F-18) | Wave 5 |

---

## Rulings summary

| Finding | Ruling | Lands in |
|---|---|---|
| F-01 timeline | Scope kept, 5 waves, re-baselined to 180–240 h | `03-ROADMAP.md` |
| F-02 unfalsifiable success | Quality gates promoted into success criteria | `01-PRODUCT-SPEC.md` |
| F-03 false precision | Relabel; `sample_adequacy`; bias disclosure in Inspector | F10 |
| F-04 cost liability | `pending` tier, per-account budgets, OTP throttle | F02, F18 |
| F-05 single attention source | Version-pin methodology; degraded mode | F08, F18 |
| F-06 cold history | Warm-up is a Wave 1 deliverable; 14-day depth gate | F08, DEPLOY MT-08 |
| F-07 artifact volume | Artifact = invocation, not pixel; retention; storage projection | F05 |
| F-08 Marketaux quota | Fixture-default dev, quota ledger, n<3 ⇒ insufficient | F04, F06 |
| F-09 Alpha Vantage | Demoted to Wave 4 flag-only | `MEMORY.md` supersedure |
| F-10 unmeasured verifier | Deterministic checks enumerated; seeded-error gate | F11, F12 |
| F-11 premature contracts | Walking skeleton before parallelism | `03-ROADMAP.md` |
| F-12 Hobby/latency/public | Private until Pro; staged latency budget; partial results | F11, DEPLOY MT-09 |
| F-13 monolithic DoD | Per-feature DoD; §20 becomes the Wave 5 gate | all features |
| F-14 no CI | CI first and blocking | F01, `04-BUILD-LOOP.md` |
| F-15 admin email | Blocking verification + boot assertion | F02, DEPLOY MT-00 |
| F-16 live goldens | Frozen fixtures gate; live smoke non-blocking | `05-TEST-STRATEGY.md` |
| F-17 implied prediction | Fixed disclosure line; "signal" banned; copy lint | F17, F19 |
| F-18 user data | Lifecycle spec as a deliverable; legal review flagged | F02, DEPLOY MT-10 |
| F-19 link rot | Availability state; snippet-as-retrieved | F09, F10 |
| F-20 no retraction | `retracted` run state + runbook | F11 |
| F-21 HF shadow | Cut to a post-PoV spike | `MEMORY.md` |
| F-22 judge validity | Build as chosen + one-time human calibration + adversarial validation | F12, DEPLOY MT-11 |
