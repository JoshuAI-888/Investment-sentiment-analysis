# ADR-015 — The monitored ticker universe is a governed selection

**Status:** Accepted, **amended by D-27 and D-30.**
**Source:** `../reference/SOURCE-PRD-v1.5.md` §1.1.

## Decision

`/admin/settings/universe` provides a searchable, filterable table sourced from the canonical
security master, showing symbol, company, exchange, sector, industry, market capitalization,
price, session, short trend, data freshness and eligibility.

**Selection changes are versioned, cost-previewed, bounded by plan limits, and applied to
future refresh jobs. Historical results are never rewritten.**

## Amendments

**D-27 — the universe is 100 symbols**, not the 30 the source assumed. The seed list lives in
an idempotent database seed script and runs only when no universe version exists.

**D-30 — the selection basis is "the 100 most-discussed on Reddit, ranked via ApeWisdom."**
Two consequences are carried openly rather than resolved (see ADR-004):

1. ApeWisdom's independent cross-check role is **retired** — it cannot validate a universe it
   selected.
2. The attention metric is **not independent of the selection**. Selecting by social attention
   and then measuring social attention means **level is not interpretable; rank change is**.
   The disclosure must say so, and F08 renders it.

## The clause that matters most

"Historical results are never rewritten" is what makes a universe change survivable. When the
membership changes, a new **version** is created; prior artifacts keep pointing at the version
they were computed under. Without this, every universe edit silently rewrites history and the
Tier D4 backtest measures something that never happened.
