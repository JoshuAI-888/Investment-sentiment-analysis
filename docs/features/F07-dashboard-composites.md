# F07 — Dashboard, Market and Sector Composites

> **Amended 2026-09-03 by the re-lock.** **Moved up the cut line** to item 6 in `../03-ROADMAP.md` §4 — the leaderboard and ticker page carry the product without composites, and under D-10's web-first ordering the scarce resource is time, not surface area. **D-14:** composites display three axes with their components beside them; a blended cross-axis number is never the stored primitive. **D-16:** every historical view carries its per-axis coverage floor and renders discontinuities rather than interpolating across them (F22).
> See `../MEMORY.md` §1b for the decisions and `../SPEC-REVIEW.md` for the reasoning.

**Wave:** 2 · **Lane:** **SURFACE** *(was `Lane: P` — the dependency lane in `../03-ROADMAP.md` §2, a different axis)* · **Estimate:** 12–16 h · **Depends on:** F06

> **`Lane:` normalised 2026-09-03.** This field previously carried the *dependency*-lane letters from `../03-ROADMAP.md` §2 (P/A/G/V), or was absent. `PROGRESS.md` warns in prose that dependency lanes and **build lanes** are different axes, but the specs still carried the colliding value — so a `lane-build` agent told "you are SURFACE" opened its feature and read a different lane on line one. The field now names the **build lane**, which is the unit of parallel assignment.

## 1. Purpose

The landing surface. A first-time user opens it and understands the market picture and the
top attention changes without instructions — with every number inspectable and every
aggregate labelled with its coverage.

## 2. Scope

**In:** `/dashboard`; market composite card with component breakdown; the 11-sector-ETF proxy
grid; freshness and coverage labelling; the degraded, stale, empty and insufficient states;
`GET /api/dashboard`; `POST /api/dashboard/refresh` (member+ only); responsive layout;
accessibility basics.

**Out:** the leaderboard itself (F08 — the dashboard embeds its component); the ticker page
(F09); scheduled refresh (F16 — F07 uses manual refresh and whatever the Wave-1 collector has
produced).

## 3. Contracts

**Consumes:** F06 methods, `InspectableMetric` (F05), `requireTier` (F02).
**Produces:** the dashboard response contract; the shared `CoverageLabel`, `FreshnessBadge`
and `DegradedPanel` components that F08 and F09 reuse.

## 4. Build spec

### 4.1 Layout

Per source §12.1–§12.2. Top to bottom: market composite; sector proxy grid; attention
leaderboard (F08's component); notable rank changes (F08's component).

### 4.2 Market composite card

Shows the composite label and value, and — always, not behind a disclosure — the component
breakdown: which of the four participated, each one's value, and the renormalized weights.
A composite computed from two of four components must **look** different from one computed
from four. Every value is an `InspectableMetric`.

### 4.3 Sector grid

11 US sector ETF proxies with cached Marketaux sentiment and return. Titled **"sector proxy"**
with a tooltip stating that an ETF is a proxy for its sector, not a population of its
constituents. A sector with no news data renders `insufficient_data`, not a zero tile.

### 4.4 Labelling (product invariant §6.1)

Every aggregate on this page renders: source name, `n`, observation window, and
`observed_at` freshness. This is not decoration — it is the difference between an honest
product and a misleading one, and it is a DoD item.

### 4.5 States

| State | Rendering |
|---|---|
| Fresh | normal, with `observed_at` |
| Stale | value plus an explicit "as of {time}, refresh failed" marker |
| Degraded | the panel names the unavailable provider and what is missing |
| Insufficient | a stated reason, never a zero or a dash |
| Empty (cold start) | explains that history is accruing and names the depth so far (F-06) |

### 4.6 Refresh

`POST /api/dashboard/refresh` is **authenticated** (there is one account, D-11), rate-limited,
idempotent, budget-checked against the **global** ceiling, and runs through the **same internal
job service** the dispatcher uses (F16 formalises the service; F07 calls it). When the global
budget check refuses, the cached page renders with the refresh control disabled and an
explanation — the state survives D-11, its trigger is the budget, not a tier.

## 5. Test plan

| Level | Cases |
|---|---|
| Unit | label formatting; freshness thresholds; component-breakdown rendering with 4, 3 and 2 participating components |
| Contract | dashboard response schema |
| Integration | response assembles entirely from stored data with no provider call in the read path |
| E2E | dashboard renders from seeded data; every number opens an Inspector; stale, degraded, insufficient and cold-start states each render from a seeded condition; **a refresh refused by the global budget check** renders its explanation; axe passes; mobile viewport has no horizontal scroll |
| Feature-specific | a composite with omitted components visibly differs from a full one |

## 6. Definition of Done

- [ ] Dashboard renders live normalized data from storage with **no provider call in the read
      path**.
- [ ] Market composite always shows its component breakdown and renormalized weights.
- [ ] Every aggregate shows source, `n`, window and freshness.
- [ ] Sector tiles are labelled "sector proxy" with the constituent caveat.
- [ ] All five states render, each from a test-seeded condition.
- [ ] Every displayed number is an `InspectableMetric`; `check:calc-coverage` passes.
- [ ] Refresh is member+, rate-limited, idempotent and budget-checked.
- [ ] Cached dashboard p95 < 2 s (Tier A2).
- [ ] axe passes; keyboard traversal works; mobile has no horizontal scroll.

## 7. PR review steps

1. Disable each provider in turn; confirm the page degrades rather than erroring or lying.
2. Confirm no adapter import reaches the dashboard read path.
3. Read every label against product invariant §6.1 — is any aggregate unlabelled?
4. Drive the global budget check to refusal; confirm the refresh control's disabled state is
   explained, not just greyed.
5. Check the cold-start state — does a brand-new deployment look intentional or broken?

## 8. Risks and open questions

| Risk | Mitigation |
|---|---|
| Cold start looks empty at exactly the moment someone is shown the product (F-06) | The explicit cold-start state, plus the Wave-1 warm-up (MT-08) |
| Labels crowd the layout | Design decision: labels are non-negotiable, layout adapts |
