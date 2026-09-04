# F14 — Scenario Governance

> **Amended 2026-09-03 by the re-lock.** **DEFERRED PAST v1 BY D-19**, and separately reduced by **D-11**: the sharing and issue-queue halves are multi-tenancy infrastructure and are cut outright, not deferred. What would return with F13 is the official-vs-personal assumption comparison. **F05's Inspector serves J5 without this feature.**
> See `../MEMORY.md` §1b for the decisions and `../SPEC-REVIEW.md` for the reasoning.

**Wave:** 4 · **Lane:** — (deferred, D-19) *(was `Lane: V` — the dependency lane in `../03-ROADMAP.md` §2, a different axis)* · **Estimate:** 14–18 h · **Depends on:** F05, F13

> **`Lane:` normalised 2026-09-03.** This field previously carried the *dependency*-lane letters from `../03-ROADMAP.md` §2 (P/A/G/V), or was absent. `PROGRESS.md` warns in prose that dependency lanes and **build lanes** are different axes, but the specs still carried the colliding value — so a `lane-build` agent told "you are SURFACE" opened its feature and read a different lane on line one. The field now names the **build lane**, which is the unit of parallel assignment.

## 1. Purpose

Job J5's second half: a user changes a bounded assumption, sees their result beside the
official one, and can always get back. Source data stays immutable from every path — which is
the property that keeps the Inspector's provenance meaningful.

## 2. Scope

**In:** personal assumption preview / save / reset with account and ticker scope; the
official-versus-personal comparison; strict bounds and allowlist enforcement; opt-in
identity-free share snapshots with revocation; the calculation-issue reporting flow;
rights-sanitized provider-fragment access for entitled users; audited admin adjustment of a
user's profile with a user-visible notice.

**Out:** the admin queues that consume issues (F15); the searchable catalogue (F17).

## 3. Contracts

**Consumes:** `resolveAssumptions`, `MethodRegistryEntry`, artifact persistence (F05);
valuation methods (F13).
**Produces:** `UserAssumptionProfile`, `CalculationShare`, `CalculationIssue`, the sanitized
fragment route.

## 4. Build spec

### 4.1 What a user may change

**Only** parameters in the method registry's `editableAssumptions`, within their bounds,
validated server-side against the registry **and** a second code-level allowlist. A database
value can never make a prohibited parameter editable — asserted by a test that tries.

Source facts — statement values, prices, mention counts, provider fields — are editable from
**no** path, by **no** role. A suspected source error goes to the issue queue (§4.5), which
produces a governed correction and a *successor* calculation, never an in-place edit.

### 4.2 Scenario computation

Lazy, from an official snapshot's eligible **frozen** inputs. **No provider call in the
scenario path** — this is what makes the comparison apples-to-apples and what keeps a
scenario from costing money. Refresh and scenario-recompute are distinct user actions and are
never combined.

The result is a new artifact with `scenario: {kind:'personal', userId, profileId}`. Official
scheduled materialisation ignores personal assumptions entirely.

Budget: p95 < 750 ms (source §14.6), since there is no network in the path.

### 4.3 Scope and isolation

Account-wide defaults and per-subject overrides, with the precedence chain from
`../02-ARCHITECTURE-CONTRACTS.md` §6. A user's scenario is invisible to every other user and
can never influence an official value, a ranking, a composite, or another user's page.
Reset restores official defaults at either scope.

### 4.4 Sharing

Opt-in, explicit, per-snapshot. A share is **identity-free** (no email, no display name),
immutable, authenticated to view, and revocable. Revocation is immediate. Nothing is shared
by default, and a share never exposes anything beyond the frozen snapshot it names.

Interaction with F02's deletion policy: account deletion revokes every share the user created.

### 4.5 Issue reporting

A user reports a data, formula, assumption or staleness issue against a specific
`calculation_id`. The report enters the admin queue (F15) and **never mutates the original
calculation**. Resolution produces a successor artifact and a user-visible note; the original
stays for audit.

### 4.6 Sanitized provider fragments

An authenticated user may fetch **only** the rights-permitted fragment tied to a calculation
input they are already authorized to see — not arbitrary provider data. The response carries
a redaction manifest naming what was withheld and why, plus a primary-source link where one
exists. Broader sanitized exploration remains admin-only and audited (F15).

### 4.7 Admin adjustment

An admin may adjust a user's assumption profile only with a recorded reason, an audit entry,
and a **notice visible to the affected user**, who can always reset. There is no silent
impersonation path.

## 5. Test plan

| Level | Cases |
|---|---|
| Unit | bounds validation; allowlist enforcement incl. the database-says-editable attack; precedence resolution at both scopes; reset |
| Contract | profile, share and issue schemas; the sanitized fragment's redaction manifest |
| Integration | scenario recompute makes **zero** provider calls; personal artifacts never enter official aggregates; revocation is immediate; deletion revokes shares |
| E2E | save an assumption, sign out, sign in, it persists; official comparison renders side by side; reset restores; a second user cannot see or reach the first's scenario; share link works then 404s after revocation; issue report reaches the queue and the original is unchanged; admin adjustment shows the user a notice |
| Feature-specific | attempt to edit a source input through every UI path and every API route — all must fail |

## 6. Definition of Done

- [ ] Only registered, bounded assumptions are editable; the registry-plus-code double gate
      is proven by a test that tries to bypass it.
- [ ] No path — user, admin, API — can edit a source input. Exhaustively tested.
- [ ] Scenario recompute makes zero provider calls and completes p95 < 750 ms.
- [ ] Personal results never influence official values, rankings, or another user's view.
- [ ] Assumptions persist across sign-out and reset to official at both scopes.
- [ ] The official comparison is always shown beside a personal result.
- [ ] Shares are opt-in, identity-free, immutable, authenticated and revocable; revocation is
      immediate; account deletion revokes them.
- [ ] Issue reports reach the queue and never mutate the original calculation.
- [ ] Sanitized fragments are calculation-linked only and carry a redaction manifest.
- [ ] Admin adjustment requires a reason, writes an audit entry, and notifies the user.

## 7. PR review steps

1. Attempt to edit a source input through every route and action you can find. Any success is
   a merge blocker.
2. Set an `editableAssumptions` flag directly in the database for a prohibited parameter;
   confirm the server still refuses.
3. Confirm zero provider calls in the scenario path by instrumenting the adapter layer.
4. Create a share, revoke it, and attempt access with a cached link.
5. Confirm cross-account isolation with two seeded users.
6. Confirm the admin adjustment notice is visible to the user, not only in the audit log.

## 8. Risks and open questions

| Risk | Mitigation |
|---|---|
| Personal artifacts inflate storage (F-07) | Personal artifacts share the standard retention class; only shared/claimed ones become permanent |
| Users treat a scenario as the official number | The comparison is always rendered; personal artifacts are visually and structurally distinct |
| Sharing leaks identity via content | Identity-free by construction; the snapshot is frozen and contains no user fields |
