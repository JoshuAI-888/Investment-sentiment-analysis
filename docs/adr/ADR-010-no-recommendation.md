# ADR-010 — No trading recommendation

**Status:** Accepted, **amended by D-08/D-09.**
**Source:** `../reference/SOURCE-PRD-v1.5.md` §1.1.

## Decision

Output may describe setup, catalysts, risks, disagreement and what to monitor. It may **not**
issue personalized buy/sell instructions, target prices, or claims of predictive certainty.

## Amendment (D-08, D-09)

The prohibition on advice is **unchanged and unconditional**. What changed is the disclosure
attached to metrics.

The original treated "not a forecast" as a permanent property of the product. D-09 makes it a
**default state a metric can leave by passing Tier D4**:

- **Every metric that has not passed Tier D4** — today, every metric — carries verbatim:
  *"This is a description of what is currently observable. It has not been tested against
  historical returns and is not a forecast."*
- **A metric that has passed Tier D4** may state its tested relationship, and must render its
  IC, its Newey–West t-statistic, its sample period, and a link to the versioned backtest
  record. **A claim without that record is a build failure, not a copy choice.**
- Passing D4 **never** licenses advice. Buy/sell, price targets, "strong buy" and "risk-on"
  stay banned regardless.

## How it is enforced

`check:copy` (F01 §4.4, filled out by F19 §4.3) fails the build on the banned vocabulary, and
additionally on **predictive vocabulary attached to a metric with no D4 record**. It reads the
method registry rather than judging prose, which is what makes it a check rather than an
editorial opinion.
