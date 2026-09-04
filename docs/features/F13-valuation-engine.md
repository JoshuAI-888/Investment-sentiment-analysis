# F13 — Valuation Engine

> **Amended 2026-09-03 by the re-lock.** **DEFERRED PAST v1 BY D-19.** 16–20 h locked under D-04 for a product whose thesis has since changed; nothing in the 2026-09-03 intent asks for DCF or peer valuation. **F05's Inspector still serves J5.** Retained in full for when the trigger fires: a valuation question becomes load-bearing in actual use, or v1 ships with capacity to spare. At D-22's 20+ h/week this is affordable — the deferral is a scope judgement, not a capacity one, and it is reversible without penalty.
> See `../MEMORY.md` §1b for the decisions and `../SPEC-REVIEW.md` for the reasoning.

**Wave:** 4 · **Lane:** — (deferred, D-19) *(was `Lane: V` — the dependency lane in `../03-ROADMAP.md` §2, a different axis)* · **Estimate:** 16–20 h · **Depends on:** F05, F06

> **`Lane:` normalised 2026-09-03.** This field previously carried the *dependency*-lane letters from `../03-ROADMAP.md` §2 (P/A/G/V), or was absent. `PROGRESS.md` warns in prose that dependency lanes and **build lanes** are different axes, but the specs still carried the colliding value — so a `lane-build` agent told "you are SURFACE" opened its feature and read a different lane on line one. The field now names the **build lane**, which is the unit of parallel assignment.
**Gated by:** the FMP entitlement report from F04 (**OQ-2**). If a required endpoint came
back `denied`, this feature's scope changes and the human is consulted before it starts.

## 1. Purpose

Job J8. A deterministic, inspectable valuation range for eligible operating companies — and,
just as importantly, an explicit refusal for everything else. ADR-018: "undervalued" is a
model-dependent range, never a fact.

## 2. Scope

**In:** deterministic DCF; peer-multiple valuation; analyst-consensus gap; the eligibility
gate; range, gap and confidence materialisation; the separate display of FMP's own DCF and
consensus as external comparators; price-growth methods (7/30/90/180D adjusted returns).

**Out:** scenario overrides and personal assumptions (F14 — F13 provides the registered
assumption surface, F14 provides persistence and the UI); the universe selector that consumes
these columns (F15); any LLM involvement whatsoever.

## 3. Contracts

**Consumes:** F05 kernel; FMP statements, metrics, enterprise value, estimates, price target,
DCF (F04).
**Produces:** `valuation.dcf`, `valuation.peer_multiple`, `valuation.consensus_gap`,
`valuation.range`, `price.adjusted_return` — each a registered method with goldens.

## 4. Build spec

### 4.1 The prohibition

**No LLM calculates growth, WACC, DCF, peer value, valuation gap, or confidence.** ADR-008
and the F01 lint rule. This is the single most consequential invariant in the feature.

### 4.2 Eligibility gate (evaluated before any calculation)

| Condition | Result |
|---|---|
| ETF or fund | `not_applicable` — reason: "not an operating company" |
| Financial firm under a generic DCF | `not_applicable` — reason: "generic DCF is inappropriate for this business model" |
| Pre-revenue or highly unstable cash flows | `not_applicable` — reason stated |
| Inputs staler than the threshold | `stale` |
| Fewer than the minimum peer set | `insufficient_data` for the peer method |
| Fewer than two methods produced a value | **no "undervalued" label** — show the method-specific range or abstain |

Each condition is a registry `eligibilityRule` with its own golden case. The reason is always
displayed; a blank cell is never an acceptable rendering of ineligibility.

### 4.3 Methods

**DCF.** Registered assumptions with bounds: WACC, terminal growth, forecast horizon, margin
path. Explicit currency and fiscal-period alignment — **never mix fiscal periods or
currencies**, which is a registry rule with a test. Full trace: FCF projection, discounting,
terminal value, enterprise → equity bridge, per-share.

**Peer multiple.** Deterministic peer set from sector/industry/size bands, documented and
reproducible. Median multiple applied to the subject's metric. Peer set membership is an
artifact input, so the Inspector shows exactly who the peers were.

**Consensus gap.** Analyst target versus current price, with the estimate date and the
contributing analyst count. Presented as a *comparator*, never as our own valuation.

**Range.** The two-method minimum, the spread, and a deterministic confidence derived from
method agreement and input freshness — never a model's opinion. `confidence` here is
explicitly documented as "agreement between methods and freshness of inputs", not a
probability.

**Price growth.** 7/30/90/180D adjusted returns, artifact per invocation with a `points[]`
derivation (F-07), consumed by F15's universe selector sorts.

### 4.4 External comparators

FMP's own DCF and analyst consensus are displayed **beside** ours, clearly labelled as the
provider's figure, with the provider named and dated. They are never blended into our range
and never substituted for it when ours abstains.

### 4.5 Language

No "undervalued" without the two-method/range/confidence gate. No price targets. No "fair
value" stated as a fact — always "model-implied range under stated assumptions". Copy lint
covers the vocabulary.

## 5. Test plan

| Level | Cases |
|---|---|
| Unit | goldens for each method: normal, each eligibility rule, negative FCF, zero/negative terminal spread, single-peer set, missing estimate, currency mismatch, fiscal-period mismatch, stale input |
| Contract | FMP statement/estimate/EV fixtures → normalized inputs; a denied endpoint surfaces as a typed entitlement error, not a zero |
| Integration | full valuation over seeded fundamentals; artifacts persisted with the peer set as an input; replay matches |
| E2E | an ETF shows `not_applicable` with its reason; a one-method company shows the method range and **no** "undervalued" label; external comparators render separately and labelled |
| Feature-specific | assert that **no** ETF, one-method, stale, insufficient or unsupported company can receive an "undervalued" label, by exhaustive enumeration over the fixture universe |

## 6. Definition of Done

- [ ] No LLM import anywhere in the valuation path; lint proves it.
- [ ] Every eligibility condition returns a stated reason, never a blank.
- [ ] The two-method/range/confidence gate is enforced; the exhaustive enumeration test passes.
- [ ] Fiscal periods and currencies are never mixed; a test proves the guard.
- [ ] Peer set membership is an artifact input and visible in the Inspector.
- [ ] `confidence` is documented as method agreement + freshness, never as probability.
- [ ] FMP's DCF and consensus render separately, labelled, dated, and never blended.
- [ ] Every valuation value is an `InspectableMetric` with a replayable artifact.
- [ ] Registered assumptions with bounds exist for every user-editable DCF input (consumed by F14).
- [ ] Price-growth methods produce series artifacts per the F-07 granularity rule.

## 7. PR review steps

1. Enumerate the eligibility rules in the registry against §4.2. Any missing rule is a path
   to a wrong "undervalued" label.
2. Try to construct an input set that yields "undervalued" from one method. It must fail.
3. Check currency and fiscal-period handling on a multi-currency fixture.
4. Open the Inspector on a peer-multiple artifact — is the peer set visible and defensible?
5. Read all valuation copy for stated-as-fact language.

## 8. Risks and open questions

| Risk | Mitigation |
|---|---|
| **OQ-2**: FMP Starter may not entitle statements/estimates/EV | F04's entitlement report is read before this feature starts; a denial changes scope and goes to the human |
| A generic DCF is wrong for many companies | The eligibility gate is the feature, not an add-on |
| Users read a range as a prediction | Explicit assumptions, visible bounds, and the F14 scenario comparison that shows how much the range moves |
