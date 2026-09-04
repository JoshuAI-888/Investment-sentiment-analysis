# ADR-006 — Alpha Vantage is a validator and specialty fallback

**Status:** **Demoted by F-09.** Not built in Waves 1–3.
**Source:** `../reference/SOURCE-PRD-v1.5.md` §1.1.

## Original decision

Alpha Vantage free tier (25 calls/day) for `NEWS_SENTIMENT`, `CONGRESS_TRADES` and occasional
quote/fundamental requests, to cross-check selected outputs.

## Demotion (F-09)

**25 calls/day validates roughly nothing on any schedule, and cross-checking is only meaningful
if it is systematic.** As specified it was a decorative dependency that still cost an adapter, a
fixture set, contract tests, a health check and a runbook entry — the full carrying cost of a
provider, for a role it could not perform.

**Ruling:**

- Alpha Vantage appears in **Wave 4 only**, behind `FEATURE_CONGRESS`, for `CONGRESS_TRADES` —
  the one dataset the other providers do not have.
- The **validator role is reassigned**: valuation cross-checks run against FMP's own DCF and
  analyst-consensus endpoints (ADR-018 already requires displaying those separately), and
  fundamentals against SEC XBRL.

## Consequences

- `ALPHA_VANTAGE_API_KEY` stays in the environment schema — the key exists (D-06) and Wave 4
  needs it — but no Wave 1–3 adapter may call it.
- A "validator" that cannot validate is worse than none: it produces an agreement statistic
  computed from almost no observations, which reads as corroboration.
