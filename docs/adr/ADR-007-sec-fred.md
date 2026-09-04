# ADR-007 — SEC EDGAR and FRED are primary-source enrichments

**Status:** Accepted, unamended.
**Source:** `../reference/SOURCE-PRD-v1.5.md` §1.1.

## Decision

EDGAR submissions and the XBRL APIs require no API key and update quickly. FRED requires a free
key. Call both sparingly, for filings and macro context.

## Notes

- EDGAR requires a descriptive `SEC_USER_AGENT` identifying the caller with a contact address.
  This is a condition of access, not a courtesy; it is a required key in live mode (F01 §4.2).
- F-09 gives SEC XBRL a second role it did not originally have: fundamentals cross-checking,
  reassigned from the demoted Alpha Vantage.

## Consequences

- Both are primary sources, so their content is quotable with attribution and carries no
  redistribution restriction of the kind FMP's licence imposes. See `../provider-rights.md`.
