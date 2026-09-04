# ADR-002 — FMP Starter is the market-data backbone

**Status:** Accepted, **amended by D-31.**
**Source:** `../reference/SOURCE-PRD-v1.5.md` §1.1.

## Decision

FMP Starter (~$22/month, annual billing) for US coverage, historical prices, fundamentals and
financial news. FMP Basic is for endpoint exploration only — 250 calls/day and a plan matrix
that restricts many datasets.

**Display or redistribution requires a separate FMP data-display/licensing agreement.** See
`../provider-rights.md`; this is a rights question, not a quota question, and it does not
resolve itself by staying under the call limit.

## Amendments

**D-31 — the price trigger runs on FMP Starter's daily bars, and no new vendor is added.**
D-15 introduced a market-data-driven trigger for X sampling, which implied an intraday tier.
D-31 declines to buy one: the trigger runs on daily bars, Wave 1 is unblocked at zero
additional spend, and the upgrade has an **evidence trigger** rather than a date — the
intraday tier is bought when the daily-bar trigger is shown to be missing events, not before.

**F-09 reassigns the validator role to FMP.** Cross-checking valuation was ADR-006's job;
Alpha Vantage's 25 calls/day could not do it. It is now done against FMP's own DCF and
analyst-consensus endpoints, which ADR-018 already requires displaying separately.

## Consequences

- Market-data polling is flat-rate and unlimited relative to our usage, which is why F16 §4.1b
  forbids gating it on the budget check: gating it saves nothing and blinds the trigger.
