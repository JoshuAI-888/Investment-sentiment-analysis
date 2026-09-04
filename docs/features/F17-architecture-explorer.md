# F17 — Architecture Explorer

> **Amended 2026-09-03 by the re-lock.** The mechanism is unchanged — the page still reads the
> registries rather than describing them, which is why it survived the re-lock intact. Two
> additions to what those registries now contain: **D-13/F20** puts `ScorerIdentity` (model name
> **and pinned commit SHA**) in the manifest, so the Explorer must show *which* model produced a
> score and be able to show that it changed; and **D-10/F21** adds the MCP surface, whose tool
> catalogue is generated from the same `MethodRegistry` this page reads — if the Explorer and the
> MCP catalogue can disagree, one of them is not reading the registry. **D-09:** the formulas tab
> must render a metric's Tier D4 status, since that is what licenses predictive language.
> See `../MEMORY.md` §1b for the decisions and `../SPEC-REVIEW.md` for the reasoning.

**Wave:** 5 · **Lane:** **SURFACE** · **Estimate:** 12–16 h · **Depends on:** F05, F15

## 1. Purpose

The product explains itself, from the same registries the application actually runs on.
ADR-014: `/architecture` cannot silently diverge from the implementation, because it reads
the implementation rather than describing it.

## 2. Scope

**In:** the public-safe versioned architecture manifest; `/architecture` with How-it-works,
PoV, target, formulas, models, assumptions, opportunities and glossary tabs; the accessible
step-through with play/pause/prev/next/reset and a reduced-motion static alternative;
formula examples executed through the **production** calculation library; the searchable
`/architecture/calculations` catalogue with links to real artifacts; CI manifest
reconciliation.

**Out:** the artifacts themselves (F05); admin operational overlays (F15).

## 3. Contracts

**Consumes:** the method registry (F05); the public-safe config/model/provider projection
(F15); real artifacts (F05).
**Produces:** the architecture manifest schema; the public-safe projection contract.

## 4. Build spec

### 4.1 No hand-copied values (the whole point, per source §18.2)

Topology comes from a **versioned manifest**. Active values come from a **public-safe
projection** of the live configuration, model routes and provider policy. Formula examples
**call the production analytics library** on a real subject and link to the resulting
artifact. A number typed into a JSX file is a review failure — it is exactly the drift this
feature exists to prevent.

### 4.2 Public-safe projection

The projection is an allowlist, not a redaction pass: only fields explicitly marked
public-safe are emitted. Never: secrets, internal hostnames, connection strings, key
prefixes, quota tokens, exploit-relevant detail, or the admin allowlist. Operational
overlays (live health, cost, job state) are admin-only.

CI asserts the projection contains no restricted field, by allowlist comparison rather than
by pattern matching.

### 4.3 Content

| Tab | Content |
|---|---|
| How it works | The user's journey, plainly, for a non-engineer |
| PoV | What is **actually deployed today**, from the manifest |
| Target | What production would require — clearly marked as **not built** |
| Formulas | Every registered method, symbolic form, and a live worked example linking to a real artifact |
| Models | Task routes, active model IDs from config, and what each is used for |
| Assumptions | Official defaults, bounds, and every method's `limitations[]` |
| Opportunities | Known gaps and what would close them |
| Glossary | Terms, including honest definitions of "attention", "sampled stance" and "sample adequacy" |

**F-17 requirement:** the assumptions tab states plainly that **no backtest exists** and that
nothing in the product has been tested against historical returns. The PoV/target distinction
must be unmistakable — a reader must never come away believing a target-state component is
deployed.

### 4.4 Accessibility

Play / pause / previous / next / reset, full keyboard operation, visible focus, and a
**complete static text alternative** that conveys the same information without animation.
Reduced-motion is honoured. The animation is a deferred client island; static content reaches
first meaningful paint < 2 s. Simple accessible edge highlighting is sufficient — bespoke
animation is cut-line item 5.

### 4.5 Calculation catalogue

Searchable across every registered method. Each entry: title, symbolic formula, assumptions,
eligibility rules, limitations, and a link to a **real** artifact for a real subject —
generated through the production path, never a mock.

## 5. Test plan

| Level | Cases |
|---|---|
| Unit | manifest schema; projection allowlist filtering; catalogue search |
| Contract | projection contains no restricted field, by allowlist comparison |
| Integration | formula examples execute the production library and produce a linkable artifact |
| E2E | every tab renders; step-through works by keyboard; reduced-motion shows the static alternative; catalogue search finds every registered method; each example links to a live artifact; axe passes |
| Feature-specific | **CI manifest reconciliation**: every provider, job, model route and method in the manifest exists in the live registries, and vice versa. Fails on drift in either direction. |

## 6. Definition of Done

- [ ] No hand-copied live value exists anywhere in the page; grep-verified.
- [ ] Topology from the manifest; active values from the public-safe projection.
- [ ] Formula examples execute the production library and link to real artifacts.
- [ ] CI reconciliation fails on drift in either direction.
- [ ] The projection contains no restricted field, proven by allowlist comparison.
- [ ] PoV and target state are unmistakably distinguished.
- [ ] The assumptions tab states that no backtest exists.
- [ ] Full keyboard operation, visible focus, reduced-motion honoured, complete static
      alternative present.
- [ ] Static content FMP < 2 s; animation is a deferred island.
- [ ] The catalogue covers every registered method with a real example.

## 7. PR review steps

1. Grep the page source for numerals and model IDs. Every one must come from a registry.
2. Read the projection allowlist; try to add a restricted field and confirm CI fails.
3. Rename a method in the registry; confirm CI reconciliation fails.
4. Navigate the entire page by keyboard with animation disabled.
5. Read the PoV and target tabs as an outsider — could anyone believe the target is built?

## 8. Risks and open questions

| Risk | Mitigation |
|---|---|
| Under time pressure, values get hardcoded "temporarily" | CI reconciliation makes it fail rather than drift; this is the feature's raison d'être |
| The page becomes a marketing surface | Content comes from registries; the opportunities tab is where gaps are stated, not hidden |
| Manifest maintenance burden | Reconciliation runs in CI, so drift surfaces immediately rather than at review time |
