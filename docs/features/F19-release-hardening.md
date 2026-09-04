# F19 — Release Hardening

> **Amended 2026-09-03 by the re-lock.** **D-09:** the copy lint is extended — predictive vocabulary on a metric with **no Tier D4 record** is a build failure. The lint reads the method registry, so this is checkable rather than editorial. **D-12:** the chaos suite's provider set changes (Linkup out; Reddit, Substack, X, market data in). **D-13:** add a scorer-outage chaos case. **D-16:** add a collector-gap case — the system must render the hole, never interpolate across it. **The runbook set (§4.4) gains four entries**, of which "collector down" is the highest-severity runbook in the system.
> See `../MEMORY.md` §1b for the decisions and `../SPEC-REVIEW.md` for the reasoning.

**Wave:** 5 · **Lane:** **SURFACE** · **Estimate:** 12–16 h · **Depends on:** all

## 1. Purpose

Close the gap between "the features are built" and "the release gate passes." Performance,
accessibility, copy discipline, runbooks, and the honest record of what is not done.

## 2. Scope

**In:** the performance suite against every Tier-A budget; the full accessibility pass; the
copy lint made real; the runbook set including answer retraction; the release checklist;
the known-limitations record; the final deployment and smoke test.

**Out:** new capability of any kind. If a gap is found here that needs new capability, it is
a new feature with its own spec — not a quiet addition to this one.

## 3. Contracts

**Consumes:** everything.
**Produces:** the release checklist; `docs/known-limitations.md`; the runbook set.

## 4. Build spec

### 4.1 Performance

Assert every Tier-A budget from `../01-PRODUCT-SPEC.md` §4 over ≥ 50 iterations against a
seeded database with fixture providers: dashboard < 2 s p95; ticker < 3 s p95; first research
event < 1 s; provider fan-out < 8 s p95; research < 30 s p95; admin overview < 2 s;
universe search < 1 s over 20,000 rows; architecture static FMP < 2 s; calculation page
< 1.5 s for artifacts up to 100 inputs / 250 steps; scenario recompute < 750 ms.

Also assert the bundle: no provider SDK and no database code in any client chunk.

### 4.2 Accessibility

axe on every route; keyboard traversal on every interactive surface; visible focus; reduced
motion honoured; the Architecture Explorer's static alternative complete; the Inspector
drawer operable and dismissible by keyboard; colour contrast; screen-reader labels on every
chart and every metric link.

### 4.3 Copy lint, made real

`check:copy` graduates from F01's stub to a full scan of user-facing strings:

**Banned:** `signal`, `strong buy`, `risk-on`, `consensus` (as a description of our output),
`Reddit sentiment`, `social sentiment`, `retail sentiment`, `all Reddit`, `Reddit-wide`,
`live X sentiment`, `fear and greed`, `guaranteed`, `will outperform`, `fair value` (stated
as fact), `undervalued` (outside the F13 gate).

**Required:** the §6.4 disclosure line wherever a divergence state renders; "observed Reddit
sample" on every attention surface; "sector proxy" on the sector grid; the selection-bias
note wherever stance renders; the product disclaimer in the footer.

The lint runs on the rendered DOM in E2E as well as on source, because a string assembled at
runtime is still a claim.

### 4.4 Runbooks

Source §19's set, **re-sourced to the D-12 stack** — FMP unavailable, Marketaux quota, ApeWisdom
cross-check unavailable, dispatcher missing/duplicated/overlapping, bad configuration, cost
threshold breached, LLM unavailable, replay mismatch — **plus**:

- **Answer retraction** (F-20 finding): how to identify, retract, notify, and record.
- **Provider contract change**: the parse failure fired; how to re-record fixtures and
  what to check before trusting the new shape.
- **Attention methodology change** (F-05): what to suppress and for how long.

**And the four the re-lock adds. These are the ones that matter now**, because each costs
something the older runbooks never had to protect — permanent corpus:

- **Collector down** (D-16). The **highest-severity runbook in the system**. How to detect
  (F16a's heartbeat, not a user report), how to restart, how to record the `CoverageGap`, and
  the standing instruction that the gap is **never** backfilled or interpolated — the data does
  not exist. Include the escalation clock: every hour of debugging is an hour of corpus.
- **Scorer down** (D-13). Confirm the queue is accumulating rather than dropping; confirm the UI
  is abstaining; confirm **nothing substituted a number**. Recovery is draining the backlog, and
  re-scored items write **successor artifacts** — never in-place updates.
- **X ceiling exhausted** (D-15/D-20). Expected on a volatile month, not an incident. Confirm
  windows are being *refused and recorded*, not truncated. Do not raise the ceiling mid-month to
  chase a story; re-derive it in `../PROGRESS.md` after the month closes.
- **Market data down** (D-15). The trigger is blind, so the X frame goes empty. Confirm no
  substitute feed is wired in as the trigger input — a delayed feed would open windows against
  the wrong moment and label them with the right one, which is worse than sampling nothing.

### 4.5 Known limitations

`docs/known-limitations.md`, written honestly and published in the app:

- coverage limits and what the sample is and is not;
- no backtest; nothing is a forecast;
- provider licensing state and what that forbids;
- the four open questions from `../00-ADVERSARIAL-REVIEW.md`;
- everything deferred in `../PROGRESS.md`, with its trigger;
- the judge's known weakness (F-22).

### 4.6 Release checklist

The source PRD's §20 Definition of Done, in full and unmodified, as a checklist — plus
Tiers A, B and C of `../01-PRODUCT-SPEC.md` §4. Every item is checked with evidence: a test
name, a measurement, or a link. An item checked on assertion alone is not checked.

## 5. Test plan

| Level | Cases |
|---|---|
| Unit | copy-lint rules, positive and negative |
| Contract | — |
| Integration | — |
| E2E | full journey on desktop and mobile; axe on every route; keyboard traversal end to end; rendered-DOM copy assertions |
| Feature-specific | the full perf suite; the full chaos suite; the eval suite; every §20 item verified with evidence |

## 6. Definition of Done

- [ ] Every Tier-A performance budget measured and passing over ≥ 50 iterations.
- [ ] Bundle assertion passes: no provider SDK or database code in a client chunk.
- [ ] axe passes on every route; keyboard traversal works everywhere; reduced motion honoured.
- [ ] Copy lint passes on both source and rendered DOM; every required phrase present, every
      banned phrase absent.
- [ ] Every runbook exists, including retraction, contract change, and methodology change.
- [ ] `known-limitations.md` is written, honest, and published in the app.
- [ ] The §20 checklist is complete with **evidence** against every item.
- [ ] Tiers A, B and C all pass.
- [ ] Production build and smoke test pass with one noncritical provider disabled.
- [ ] `../PROGRESS.md` and `../MEMORY.md` reflect the final state, including every deferral.

## 7. PR review steps

1. Read the §20 checklist and spot-check five items against their claimed evidence.
2. Run the perf suite yourself; do not accept reported numbers.
3. Navigate the whole product by keyboard with a screen reader.
4. Read `known-limitations.md` as a sceptic. Is anything omitted that a user would want?
5. Confirm no new capability was added under the banner of hardening.

## 8. Risks and open questions

| Risk | Mitigation |
|---|---|
| Perf gates fail late, after the architecture is fixed | Budgets are asserted per feature from Wave 2; F19 is confirmation, not discovery |
| "Hardening" becomes a dumping ground for missed scope | Explicit out-of-scope rule above; new gaps become new features |
| The release checklist is checked optimistically | Evidence required per item; the reviewer spot-checks |
