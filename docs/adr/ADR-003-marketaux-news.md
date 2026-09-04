# ADR-003 — Marketaux is the primary low-cost news-sentiment source

**Status:** Accepted **with the F-08 mitigation.**
**Source:** `../reference/SOURCE-PRD-v1.5.md` §1.1.

## Decision

Marketaux Free: 100 requests/day, three articles per news request, entity-level sentiment per
article. Aggressive caching and on-demand sector refreshes. Upgrade to Basic only if the
three-article cap harms the product.

## Amendments

**F-08 — the free tier has no headroom, and development shares the quota.** 100 requests/day
across 100 symbols (D-27), 11 sector ETFs and the market composite is not a budget, it is a
rounding error, and every development run spends production's allowance.

The mitigation is the `PROVIDER_MODE=fixture` default in F01 §4.2: a real payload is recorded
once, committed, and developed against. Live calls are opt-in per environment. This is why
`../05-TEST-STRATEGY.md` §8 runs CI with no provider keys present at all — a test that needs a
key to pass is a test that will pass for the wrong reason, and it also spends the quota.

## Consequences

- Sector tiles render `insufficient_data` rather than a zero when the quota is exhausted
  (F07 §4.3). A zero and "we could not ask" look identical to a reader and only one is true.
