# F18 — Cost, Budgets, and Degradation

> **Amended 2026-09-03 by the re-lock.** **D-20:** the budget is $350/month, not $50, and per-account budgets are void under D-11 — the global check is now the only budget control, which makes it more load-bearing. The **X read ceilings** (monthly, daily, per-trigger-event) are the ones that matter: X is the only per-unit-priced source. **D-13:** a scorer outage is a named degraded mode producing abstention, never a substituted number. **D-16:** collector downtime is *permanent data loss* and is the highest-severity alert in the system. Linkup's degradation row is void (D-12).
> See `../MEMORY.md` §1b for the decisions and `../SPEC-REVIEW.md` for the reasoning.

**Wave:** 5 · **Lane:** **SURFACE** · **Estimate:** 10–14 h · **Depends on:** F04, F15

## 1. Purpose

The system cannot be made to spend money it does not have, and it stays useful when a
provider fails. This is where `../00-ADVERSARIAL-REVIEW.md` F-04 (unmetered cost liability)
and F-05 (single-source fragility) are actually closed.

## 2. Scope

**In:** the event-derived cost ledger; **per-account** budgets alongside global; threshold
behaviour at $80/$90/$100; pre-dispatch budget enforcement; circuit breakers;
stale-while-revalidate; the degraded-state catalogue; feature flags for X, Stocktwits and
Congress; the chaos suite; provider runbooks.

**Out:** the ledger *view* (F15); the wrapper mechanics (F04 — F18 supplies the policy F04's
hook calls).

## 3. Contracts

**Consumes:** `cost_event` (F03), the F04 pre-dispatch hook, admin policy values (F15).
**Produces:** `BudgetPolicy`, `BudgetDecision`, the degraded-state catalogue.

## 4. Build spec

### 4.1 Budget enforcement (F-04, the core of this feature)

Checked **before** dispatch, never after. Two scopes, both enforced:

| Scope | Limits |
|---|---|
| **Per account** | daily research runs; daily and monthly priced-call spend; per-run cost ceiling |
| **Global** | monthly hard budget $100; warn $80; reduce optional work $90; block noncritical paid work $100 |

Per-account is the one that matters for the open-signup risk: a global hard stop is a damage
report, not a defence. A denied call returns `{kind:'budget_denied', scope}` and the UI
explains which limit was reached and when it resets — it never fails silently and never
looks like an error.

Threshold behaviour:
- **$80 warn** — admin alert; no behaviour change.
- **$90 reduce** — optional work stops: shadow work, non-essential refreshes, background
  enrichment. Core paths continue.
- **$100 block** — all noncritical paid work refused. Cached reads, the dashboard, stored
  artifacts and the admin plane all keep working. **The product degrades; it does not die.**

### 4.2 The ledger

Derived from `cost_event`, not from a separate counter that can drift. Priced, actual and
**unpriced** usage are distinct. `costUsd: null` means unpriced and renders as "unpriced" —
it never becomes `$0.00`, because a zero is a claim and a null is the truth.

Reconciliation against provider invoices is cut-line item 6; the ledger itself is not cuttable.

### 4.3 Degraded-state catalogue

For **every** provider, a defined behaviour, a user-visible state, and a runbook entry:

| Provider down | Behaviour | Severity |
|---|---|---|
| **Reddit Data API** | **Permanent data loss** — the attention axis has no backfill (D-16). Alert immediately, record a `CoverageGap`, render the hole. The page must say the collector was down, not show a dip | 🔴 **highest in the system** |
| **Market data** | The **trigger** is blind, so no X windows open and that frame goes empty for the outage. Record the gap. Never substitute a delayed feed and label it as the trigger input | 🔴 |
| **F20 scorer** | Stance **abstains** with a reason (D-13). Items queue for scoring and are scored on recovery — collection and scoring are decoupled precisely so an outage costs latency, not corpus. **Never** substitute a hosted LLM's number into the series | 🔴 |
| **X** | The triggered frame is empty for the window; the disclosure says so. Reddit and Substack frames are unaffected — they are separate frames and do not renormalize to cover it | 🟠 |
| **Substack** | The curated-set frame is stale with an explicit age; the other two frames are unaffected | 🟢 |
| FMP | last good quote/history with a stale timestamp; fundamentals panels omitted with a reason; a 403 is never retried | 🟠 |
| Marketaux | news sentiment `insufficient_data`; composite renormalizes without it | 🟢 |
| ApeWisdom | the **cross-check** is unavailable and is labelled as such (D-12). It no longer carries the attention axis, so this is no longer a user-facing outage | 🟢 |
| LLM | the registered *complementary* methods abstain; research is disabled with a stated reason. **No deterministic metric is affected** — this is the point of D-13's separation | 🟢 |
| SEC / FRED | enrichment omitted silently — it is enrichment, and its absence changes no number | 🟢 |

**The rule the severity column encodes:** an outage that costs **latency** is recoverable and
low-severity; an outage that costs **corpus** is permanent and is the most serious event this
system can experience. Under forward-only collection those are not the same kind of incident, and
a runbook that treats them alike will let the expensive one pass unnoticed.

The rule across all of them: **an explicit degraded state, never invented content and never a
blank page** (Tier A7).

### 4.4 Feature flags

X, Stocktwits and Congress are disabled by default and **hidden**, not greyed out — a greyed
control implies a capability we do not have. Enabling X or Stocktwits requires an explicit
coverage definition and a costed sampling design first; the flag alone is not permission.

### 4.5 Chaos suite

`pnpm test:chaos` disables each noncritical provider in turn and asserts: the page renders,
the degraded state is explicit and named, no invented content appears, no unhandled error
reaches the user. It also injects a duplicate QStash delivery, an expired lock, and a
budget-exceeded condition.

## 5. Test plan

| Level | Cases |
|---|---|
| Unit | budget arithmetic at each threshold; per-account limits; reset boundaries; unpriced handling |
| Contract | `BudgetDecision` schema |
| Integration | a denied call never reaches the network; the ledger derives from events and matches a hand-computed total; $90 stops optional work while core paths continue; $100 leaves cached reads and admin working |
| E2E | a user at their daily limit sees an explanation with a reset time; a provider outage shows the catalogued degraded state |
| Feature-specific | the full chaos suite |

## 6. Definition of Done

- [ ] Per-account **and** global budgets are enforced before dispatch, never after.
- [ ] A denied call is explained to the user with the limit and its reset time.
- [ ] $80/$90/$100 behaviours implemented and tested; at $100 the product still reads.
- [ ] The ledger derives from `cost_event` and matches a hand-computed total.
- [ ] Unpriced usage renders as "unpriced" and never as `$0.00`.
- [ ] Every provider has a catalogued degraded state, a user-visible rendering, and a runbook.
- [ ] X, Stocktwits and Congress are hidden by default, not greyed.
- [ ] The chaos suite passes for every noncritical provider.
- [ ] No degraded path invents content or shows a blank page.

## 7. PR review steps

1. Confirm the budget check precedes the network call in code order for every priced path.
2. Set a per-account limit to zero and attempt a research run; read the message as a user.
3. Drive the ledger to $100 in integration; confirm the dashboard, artifacts and admin work.
4. Kill each provider in turn and look at the resulting page. Is it honest, or just empty?
5. Confirm no `$0.00` appears where the cost is actually unknown.

## 8. Risks and open questions

| Risk | Mitigation |
|---|---|
| Budget checks add latency to every call | Redis counters; the check is a single round trip inside an existing path |
| Ledger drifts from provider invoices | Event-derived by construction; reconciliation is a later, cut-line item |
| Degraded states are built but never seen | The chaos suite runs them on every nightly |
