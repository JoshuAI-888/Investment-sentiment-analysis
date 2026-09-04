# ADR-012 — The admin console is a governed control plane, not an environment-variable editor

**Status:** Accepted, **heavily cut by D-11.**
**Source:** `../reference/SOURCE-PRD-v1.5.md` §1.1.

## Decision

Runtime-safe settings, provider schedules, model routes, feature flags, quotas and budgets live
in **versioned database configuration** and can be written back after validation. Secrets,
infrastructure bindings, schema migrations and legal invariants remain **deployment-controlled**.

Every mutation records actor, reason, before/after value, environment, config version, and
rollback target.

## Amendment (D-11)

D-11 cut the multi-tenant machinery, and with it most of the console's *surface*. What was cut
and what was kept were chosen on a single criterion — whether the thing is reproducibility
infrastructure or convenience:

| Kept | Cut |
|---|---|
| Versioning, audit, rollback | The ~20-surface mutation UI |
| The `config_version` on every artifact | Per-account quotas and budgets (there is one account) |

The kept half is not administrative convenience: without a `config_version` recorded against a
calculation, an artifact cannot be replayed, and ADR-019's replayability claim is unbacked.

## The boundary that does not move

**No UI may ever edit the QStash schedule, `vercel.json`, or the dispatch secret** (ADR-013,
F16 §4.2). This is a review item on every PR that touches the admin plane, and F16 §7 step 5
is "search for any code path that could write a QStash schedule".
