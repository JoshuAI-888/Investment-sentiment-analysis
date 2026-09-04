# 2026-09-03 — COLLECT — F04 §4.3, the SEC EDGAR adapter

**Continuing where the ApeWisdom adapter left off.** Went looking for a real FMP company-profile
schema first, to build the fundamentals adapter next in `collect.md`'s stated order. Both
verification attempts (FMP's own how-to page, a live unauthenticated call) came back blocked —
403 on the docs page, 401 with no key. Rather than guess a schema for a keyed, paid vendor,
switched to SEC EDGAR: free, no key, and its `submissions` shape has been stable public
documentation for years even though this session's own attempt to confirm it live was also
blocked (SEC's anti-scraping policy, which is the exact reason this adapter needs a real
`SEC_USER_AGENT` in the first place).

## What was built

`src/adapters/sec-edgar.ts`: `fetchCompanySubmissions(cik)` calls
`data.sec.gov/submissions/CIK##########.json` and returns entity info plus `recentFilings[]`,
zipped from EDGAR's column-of-arrays shape (`accessionNumber[]`, `filingDate[]`, `form[]`, ...
all indexed in parallel) into one object per filing.

Eight fixtures under `apps/web/fixtures/sec_edgar/submissions/` — the ninth case
(`null-where-number`) doesn't apply, since this schema has no required numeric field to null
out, and the deferred table says so rather than faking one. 10 new unit tests. Gate green:
**303 unit tests** (was 293), plus lint, typecheck, build, `check:bundle`.

## The decision that shaped it — schema confidence, stated rather than hidden

This is the first adapter in this build where the schema is not backed by a live-verified
payload. `WebFetch` against `data.sec.gov` directly returned SEC's real "Your Request
Originates from an Undeclared Automated Tool" rejection — which is now, deliberately, the exact
text in the `malformed` fixture, since it's a real failure mode this adapter will actually see
from misconfigured deployments. The module doc says explicitly that F04 §4.4's entitlement
probe — built for exactly this — is what confirms the shape before anything depends on it. This
felt like the right thing to write down rather than silently ship a schema with unstated
confidence, given how much of this package's design (D-16, D-17, the fixture-freshness policy)
is about not letting an assumption pass as a verified fact.

## A correction to `collect.md`'s own prior record

Checking whether the persistence-wiring slice had opened up (it hadn't been reached yet)
surfaced that the lane file's own claim — "no ledger table exists yet, needs a migration" — was
stale. `provider_call_log`, `cost_event` and `raw_provider_payload` all exist already, in
migrations 0007–0008 from SPINE's F03/F22 work. The actual reason this lane hasn't wired the
wrapper's sinks to real persistence is `repositories/`'s SQL-only rule combined with lane
ownership (`CLAUDE.md`): this lane can call a repository function, not write one. Only the
quota-ledger's restart-survival table is genuinely unbuilt. Corrected in `collect.md` rather
than left for a future session to re-discover.

## Next

A standalone adapter with no named blocker and a verifiable schema — Marketaux or FRED next,
in that order or whichever verifies more easily. FMP's fundamentals endpoints are deferred
until a real schema can be confirmed, not built next as `collect.md` previously implied.
