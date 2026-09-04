# F15 — Governed Admin Control Plane

> **Amended 2026-09-03 by the re-lock.** **D-11:** heavily cut. The ~20-surface mutation UI, share grants and the issue queue are *multi-tenancy* infrastructure and are cut. Config/universe versioning, audit with actor and before/after, and rollback targets are *reproducibility* infrastructure and survive in full — they answer "what produced this number in March," which D-09 requires. **D-15:** the price-trigger thresholds are operator-editable, versioned and audited, because they govern X spend.
> See `../MEMORY.md` §1b for the decisions and `../SPEC-REVIEW.md` for the reasoning.

**Wave:** 4 · **Lane:** **SURFACE** *(was `Lane: G` — the dependency lane in `../03-ROADMAP.md` §2, a different axis)* · **Estimate:** 26–34 h · **Depends on:** F03, F04

> **`Lane:` normalised 2026-09-03.** This field previously carried the *dependency*-lane letters from `../03-ROADMAP.md` §2 (P/A/G/V), or was absent. `PROGRESS.md` warns in prose that dependency lanes and **build lanes** are different axes, but the specs still carried the colliding value — so a `lane-build` agent told "you are SURFACE" opened its feature and read a different lane on line one. The field now names the **build lane**, which is the unit of parallel assignment.
**Largest single feature in the package.** May start early — it depends only on Wave 1.

## 1. Purpose

The operator surface. Change what the system watches, how it behaves, and what it may spend —
safely, reversibly, and with a record of who did what and why. ADR-012: a governed control
plane, **not** an environment-variable editor.

## 2. Scope

**In:** the secured `/admin` shell with tabs for status, data sources, jobs, models, data
explorer, costs, settings/universe, audit, calculation coverage, user assumptions and
calculation issues; the local universe selector; versioned typed configuration with staged
activation and rollback; model-route management; provider policy and agreements; sanitized
payload inspection; the cost ledger view; account-tier promotion (from F02); the audit trail.

**Out:** the dispatcher itself (F16); budget *enforcement* mechanics (F18 — F15 sets the
policy values); the Architecture Explorer (F17).

## 3. Contracts

**Consumes:** repositories and versioned tables (F03); provider health (F04); `requireAdmin`
(F02).
**Produces:** the admin mutation contract (every mutation, uniformly); `ConfigVersion`,
`UniverseVersion`, `ModelRoute` activation semantics.

## 4. Build spec

### 4.1 The uniform mutation contract

**Every** admin mutation — there are roughly twenty — goes through one shape:

```
authorize (in the handler) → validate (zod) → optimistic-concurrency check (expected version)
→ dry-run impact preview → capture reason → write new version → activate in a transaction
→ audit_event → invalidate cache → return the rollback target
```

No mutation may skip a step. This uniformity is what makes twenty surfaces reviewable; a
bespoke mutation is a review failure even if it works.

### 4.2 What is editable and what is not (ADR-012)

| Editable from `/admin` | Never editable from the browser |
|---|---|
| Typed runtime settings from an allowlisted key catalogue | Secrets and API keys |
| Job definitions: due times, cadence, enabled, policy | Infrastructure bindings, QStash schedules, `vercel.json` |
| Model task routes, from an allowlist | Schema migrations |
| Universe membership | Legal and compliance invariants |
| Budgets and thresholds | Anything not in the typed key catalogue |
| Provider policy and agreement metadata | Source data |
| Account tier promotion | |

Deployment settings are **displayed with status, masked**, and are read-only. A key's value
is never echoed, not even partially, beyond a fixed-length mask.

### 4.3 Universe selector (ADR-015)

A searchable, filterable, paginated **checkbox table over the local security master**. Columns:
symbol, company, exchange, sector, industry, market cap, current price, session, 7/30/90/180D
adjusted growth (F13), deterministic 5-session trend, model-implied valuation range/gap/
confidence or explicit ineligibility, data freshness, eligibility.

Hard rules:
- **Never calls a provider per rendered row.** All columns come from the local catalogue and
  cached snapshots. p95 < 1 s over 20,000 rows (source §14.6).
- Draft state → impact and cost preview → versioned activation. The preview states how many
  symbols are added or removed and what that does to daily provider calls and cost.
- Hard cap of 100 active symbols, enforced server-side.
- Ambiguous or ineligible symbols are rejected with a stated reason.
- Historical results are **never** rewritten by a membership change.
- Import is permitted but must resolve into the same review table — no free-text apply.

### 4.4 Versioning, conflict and rollback

Optimistic concurrency on every versioned entity: the client sends the version it read; a
mismatch returns a conflict with a diff, never a silent overwrite. Rollback activates a prior
version as a **new** version — history is never rewound.

### 4.5 Data explorer

Sanitized payload inspection for admins, subject to provider rights, retention and size
limits, and **audited on every access**. Rights-restricted payloads are not shown at all,
with the restriction named. This is the broad counterpart to F14's narrow user-facing
fragment.

### 4.6 Governance queues

Calculation coverage and replay status; per-user assumption profiles (adjustable only under
F14's reason/audit/notice rules); the calculation-issue queue with resolution that produces a
successor artifact and never mutates the original.

### 4.7 Cost ledger view

Priced, actual and **unpriced** usage shown distinctly. Unpriced never renders as `$0.00`.
Budget thresholds ($80 warn / $90 reduce / $100 block) are configured here; F18 enforces them.

### 4.8 Information architecture

One tabbed `/admin` shell is acceptable and is cut-line item 7. Slow panels stream
independently; cached admin overview p95 < 2 s.

## 5. Test plan

| Level | Cases |
|---|---|
| Unit | each mutation validator; concurrency comparison; impact-preview arithmetic; universe cap enforcement; key-catalogue allowlist |
| Contract | admin read and mutation schemas |
| Integration | activation transaction rolls back cleanly on failure; a conflicting concurrent write is refused with a diff; rollback creates a new version; audit written for every mutation; data-explorer access is audited and rights-checked |
| E2E | **negative authorization on every admin route and every admin action**; universe search/filter/paginate with no provider call; draft → preview → activate → rollback; model-route validation rejects a non-allowlisted model; settings write invalidates cache; issue resolution leaves the original artifact unchanged |
| Feature-specific | enumerate every mutation and assert each performs all eight steps of §4.1 |

## 6. Definition of Done

- [ ] Every admin route and action calls `requireAdmin()` in its own body; negative-auth E2E
      covers each one individually.
- [ ] Every mutation performs all eight steps of the uniform contract; enumerated and tested.
- [ ] No secret is editable, readable, or echoed beyond a fixed-length mask.
- [ ] Universe selector renders every specified column from local data with **zero** provider
      calls per row, p95 < 1 s over 20,000 rows.
- [ ] Impact and cost preview precedes activation; the 100-symbol cap is server-enforced.
- [ ] A membership change never rewrites historical results.
- [ ] Optimistic concurrency refuses a conflicting write with a diff.
- [ ] Rollback creates a new version rather than rewinding history.
- [ ] Data explorer is rights-checked, size-limited, retention-aware and audited per access.
- [ ] Cost ledger distinguishes priced, actual and unpriced; unpriced is never `$0.00`.
- [ ] Coverage/replay, user-assumption and issue queues all function per F05/F14 rules.
- [ ] Cached admin overview p95 < 2 s with independent panel streaming.

## 7. PR review steps

1. Enumerate every mutation in the diff. For each, confirm all eight steps. This is the review.
2. Attempt every admin route unauthenticated and as a non-admin member.
3. Search the universe table with the network tab open — any per-row provider call is a blocker.
4. Force a concurrent edit; confirm the conflict diff rather than a last-write-wins.
5. Activate, then roll back; confirm a new version exists and history is intact.
6. Grep the admin surface for any path that could echo a secret.

## 8. Risks and open questions

| Risk | Mitigation |
|---|---|
| Largest feature; likely to overrun | Cut-line items 6–8 apply here; the uniform mutation contract is what must not be cut |
| Twenty bespoke mutations become twenty bespoke bugs | The uniform contract, enumerated and tested as a set |
| Universe table performance at 20,000 rows | Server-side pagination and indexed sorts; asserted in the perf suite |
| Admin plane becomes a secret editor under pressure | ADR-012 is an invariant; the review step above is explicit |
