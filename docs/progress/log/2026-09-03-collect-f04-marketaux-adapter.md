# 2026-09-03 — COLLECT — F04 §4.3, the Marketaux adapter

**Continuing where the SEC EDGAR adapter left off.** Marketaux picked next per the previous
session's own note: free/keyless-adjacent, well-documented, no blocker in `collect.md`.

## What was built

`src/adapters/marketaux.ts`: `fetchMarketauxNews(symbols)` calls `/v1/news/all` and returns
`MarketauxArticle[]` — each with per-entity `symbol`, `name`, and a nullable `sentimentScore`.

Nine fixtures under `apps/web/fixtures/marketaux/news_all/`. 9 new unit tests. Gate green:
**312 unit tests** (was 303), plus lint, typecheck, build, `check:bundle`.

## Verification, and where it fell short

Searched for Marketaux's real response shape before writing the schema — same discipline as
SEC EDGAR. Got a real example JSON from a third-party mirror (`meta`/`data` top-level, an
`entities` array per article), but a separate source described the per-entity sentiment field
as `sentiment_score` (filterable via `sentiment_gte`/`sentiment_lte`) while the mirror's own
worked example called it `score`. Two sources, two different names, no way to adjudicate without
a live key.

**Resolved by keeping the field name where two independent descriptions agreed (`sentiment_score`,
corroborated by the filter-parameter naming) and making almost everything else in the article
optional.** A schema this permissive can't validate much, but a schema that asserts a field name
seen once and gets it wrong fails *every* real response, which is worse than validating little.
Documented in the module doc, same as SEC EDGAR's note, pointing at F04 §4.4's entitlement probe
as the actual resolution.

## A naming correction against the nine-case matrix

This schema has no non-nullable number field — `sentiment_score` is nullable by design, since
Marketaux doesn't score every entity. So `null-where-number` doesn't apply as literally named.
Represented instead as a null on a required string (`entity.symbol`), which is the same defect
class the case exists to catch (a required field arriving as `null`), and named as a substitution
in `collect.md` rather than mislabeled as the case it isn't.

## Next

FRED — the last provider in §4.3's table with no named blocker, pending its own schema check.
After that, everything remaining needs an owner action (MT-13, a governed X cohort) or a schema
this lane has twice now declined to guess (FMP fundamentals).
