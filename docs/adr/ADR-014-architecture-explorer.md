# ADR-014 — The application includes a source-backed Architecture Explorer

**Status:** Accepted, **amended** — the manifest gained `ScorerIdentity` and the MCP catalogue.
**Source:** `../reference/SOURCE-PRD-v1.5.md` §1.1.

## Decision

`/architecture` presents PoV and target-state diagrams, an accessible step-through animation,
formulas, model routes, assumptions, constraints and opportunities.

**It reads the same active configuration and method registry the application reads**, so the
page cannot silently diverge from the implementation. This is the whole decision: an
architecture page maintained by hand is a page that is wrong within a month and is then trusted
anyway.

## Amendment

The manifest was specified before D-13 and F21 and was missing two things it must now carry:

- **`ScorerIdentity`** — `scorerId`, `scorerVersion` (`<repo>@<sha>`) and `runtimeVersion`.
  Without it the page describes a stance engine without saying which one, which is exactly the
  claim product invariant §6.7 exists to make checkable.
- **The MCP tool catalogue** (F21), so the surface the product exposes to external agents is
  documented in the same place as the surface it exposes to people.

## Consequences

- F17's DoD includes that a change to the method registry is visible on `/architecture` without
  a code change to the page.
