# F04 — Provider Platform

> **RNI scope:** Reddit acquisition is OpenAI Web Search with no Reddit API dependency; X is an
> independent datasource using authorised access, never a fallback. See `RNI-00-CONTRACT.md`.

> **Amended 2026-09-05 (D-39).** The Reddit Data API adapter named in §2's `In` list is
> **discarded, not deferred.** The owner ruled out Reddit-Data-API sourcing for the legacy
> product entirely; RNI's OpenAI Web Search path is the only Reddit acquisition this repository
> builds, for either surface. Every `Reddit Data API` row below (§2, §4.3's provider table,
> §4.4's continuous-poll list) is struck from this lane's scope. See `../MEMORY.md` D-39 and
> `../progress/collect.md`.

**Wave:** 1 · **Lane:** **COLLECT** · **Estimate:** 18–24 h · **Depends on:** F01, F03

## 1. Purpose

One typed, instrumented, quota-aware way to talk to every external data source — and the
**written entitlement report** that tells us which of the later features are actually
buildable (`../00-ADVERSARIAL-REVIEW.md` F-11, OQ-2). This feature is where the plan meets
reality.

## 2. Scope

> **Amended 2026-09-03 (D-12, D-15, D-17).** The adapter set is replaced, market data moves
> into Wave 1 because it is the price trigger, and the collector's retention behaviour is now
> binding. See `../MEMORY.md` §1b.

**In:** the shared adapter wrapper (timeout, retry, circuit breaker, cache, rate limit,
quota ledger, call logging, cost recording); adapters for **Reddit Data API**, **Substack RSS**,
**X**, **intraday market data**, **FMP**, **Marketaux**, **ApeWisdom** (cross-check only),
**SEC EDGAR**, **FRED**; **the collector and the price trigger**; the fixture recording harness;
contract tests; `/api/health/providers`; the entitlement probe and its report; the
security-master bootstrap call used by F03's loader.

**Out:** Alpha Vantage (F-09 — Wave 4, `FEATURE_CONGRESS` only); **Linkup (dropped by D-12)**;
scoring (**F20** owns the scorer and the queue); PIT storage and coverage-gap recording (**F22**);
analytics over the data (F06); budget *policy* (F18 owns policy; F04 owns the mechanism and the
pre-dispatch hook).

## 3. Contracts

**Produces:** `ProviderResult<T>`, `ProviderMeta`, `ProviderError`
(`../02-ARCHITECTURE-CONTRACTS.md` §4.1); per-provider response schemas; the fixture format;
the quota-ledger interface.
**Must not redefine:** domain schemas (F03).

## 4. Build spec

### 4.1 The wrapper

Every adapter call passes through one function. In order:

1. **Budget pre-check** (F-04, F18) — global and per-account. Denied ⇒
   `{kind:'budget_denied'}`. This happens **before** the request, never after.
2. **Quota ledger check** (F-08) — a server-side counter per provider per UTC day. Refuse
   before dispatch rather than discovering a 429. Counter is Redis with a Postgres mirror.
3. **Cache** — Redis, key per source §9.3, stale-while-revalidate. A stale serve is marked
   `cache:'stale'` and surfaces as a stale label in the UI, never silently.
4. **Rate limit** — token bucket per provider.
5. **Request** — hard timeout; `AbortController`; no unbounded retry.
6. **Retry** — per source §9.4. **Never retry a 403/entitlement**; retry 429 only after
   `Retry-After`; exponential backoff with jitter on 5xx and timeout, capped.
7. **Circuit breaker** — open after N consecutive failures, half-open probe, per provider.
8. **Validate** — zod against the recorded contract. A parse failure is
   `{kind:'contract', issues}` and is **logged loudly**: it means the provider changed.
9. **Record** — `provider_call_log` row and a `cost_event` with `costUsd` or `null`.

### 4.2 `PROVIDER_MODE`

`fixture` (default) reads from `fixtures/<provider>/<endpoint>/<case>.json` and exercises the
entire wrapper except the network. `live` hits the provider and counts against the ledger.
CI is always `fixture` with no keys present (`../05-TEST-STRATEGY.md` §8).

### 4.3 Adapters

**Replaced 2026-09-03 by D-12.** Three cost shapes, three collection strategies (D-15) — this
table is ordered by that, not alphabetically, because the strategy is the point.

| Provider | Cost shape | Strategy | Endpoints for Wave 1–2 |
|---|---|---|---|
| **Reddit Data API** | Free, abundant (100 QPM ≈ 144k queries/day) | **Poll broadly and continuously** | subreddit listings, submission + comment trees. **Full bodies retained** (D-17) |
| **Substack RSS** | Free, slow (publication cadence) | **Poll daily-ish** | `https://<publication>.substack.com/feed` per MT-15's set. **Full bodies retained** |
| **Intraday market data** | Flat tier, effectively unlimited calls | **Poll continuously — it is the trigger** | intraday bars, volume, quote. Tier is MT-14 |
| **X API** | **$0.005/Post read**, scarce | **Sample on trigger only** — never blind polling | recent search over the watchlist + cashtags. Stores **ID + scores + bounded snippet**, re-hydrated on demand (D-17) |
| FMP | Flat subscription | Scheduled | symbol list, profile, adjusted daily history, company news, insider |
| ApeWisdom | Free, keyless | Scheduled, **cross-check only** | ranked mentions. Still capture the methodology version/date per snapshot (R-03), but it no longer carries the attention axis |
| Marketaux | Free, 100 req/day | Scheduled, ledgered | entity news + sentiment. 3 articles/req; the ledger is not optional |
| SEC EDGAR | Free | On demand | submissions, XBRL company facts. Real `SEC_USER_AGENT`; server-side only |
| FRED | Free key | Scheduled | series observations; attribution required |

### 4.3.1 The price trigger (D-15) — a Wave 1 deliverable

X reads are the only per-unit-priced input and the binding constraint on every sampling
threshold in the product. They are therefore **never spent on blind polling.**

1. Market data is polled continuously (flat-rate, so free at the margin).
2. A move exceeding the operator-configured threshold — versioned and audited under F15 —
   fires a trigger event for that symbol.
3. The trigger spends up to `X_READS_PER_TRIGGER_EVENT` reads on that symbol, subject to the
   daily and monthly ceilings in MT-12, checked **before dispatch** per §6.6.
4. Reddit and Substack are unaffected: they poll continuously regardless, because they cost
   nothing.

**Consequence that must be visible downstream:** X coverage is **event-conditional, not
continuous**. Its series is a record of what was said around triggered moves, not of what was
said. F22 renders this; F06 must not average across it as though it were continuous.

Later waves add: FMP statements, metrics, enterprise value, estimates, price target, DCF
(**deferred with F13 under D-19**); Alpha Vantage `CONGRESS_TRADES` (F15, flagged).

### 4.4 Entitlement probe and report (the deliverable that de-risks Wave 4)

A script that calls **every endpoint any feature will ever need**, records the status, and
writes `docs/provider-entitlements.md`:

| Endpoint | Status | Sample fields present | Verdict | Feature affected |
|---|---|---|---|---|

Verdicts: `entitled` / `denied` / `partial` / `rate-limited`. A `denied` on any endpoint F13
needs is escalated to the human immediately (`../04-BUILD-LOOP.md` §4) — it changes what
Wave 4 can promise, and finding that out in Wave 1 is the entire point.

### 4.5 Health endpoint

`GET /api/health/providers` returns, per provider: circuit state, last success, quota
remaining, cache hit rate, breaker trips today. **Status only** — it makes no provider call
and is safe for an unauthenticated liveness probe (`../02-ARCHITECTURE-CONTRACTS.md` §8).

## 5. Test plan

| Level | Cases |
|---|---|
| Unit | retry policy per error class (403 never retried; 429 honours `Retry-After`; 5xx backs off); breaker open/half-open/closed; cache key construction; quota decrement and refusal at zero |
| Contract | every adapter against every fixture case in `../05-TEST-STRATEGY.md` §2: success, empty, malformed-200, 401/403, 429 ±`Retry-After`, 5xx, timeout, unexpected field, null-where-number |
| Integration | wrapper end-to-end against a local mock server: budget denial short-circuits before the request; ledger persists across process restart; stale-while-revalidate serves stale and marks it |
| E2E | health endpoint renders provider state; a forced breaker-open shows a degraded provider |
| Feature-specific | entitlement probe runs against live FMP and produces the report; live smoke (`smoke:live`) asserts shape only and is excluded from CI |

## 6. Definition of Done

- [ ] Six adapters implemented, each returning `ProviderResult` and **never throwing** for an
      expected condition.
- [ ] The full nine-case fixture matrix exists and passes for every adapter.
- [ ] A 403 is never retried; a test proves it.
- [ ] Quota ledger refuses **before** dispatch and survives a restart.
- [ ] Budget pre-check hook is called before every priced request.
- [ ] `costUsd` is `null` for unpriced calls and never `0`.
- [ ] `PROVIDER_MODE=fixture` is the default and CI passes with **no provider keys set**.
- [ ] ApeWisdom methodology version is captured and persisted on every snapshot.
- [ ] `docs/provider-entitlements.md` exists, covers every endpoint any feature needs, and
      names the affected feature for each `denied` or `partial`.
- [ ] `/api/health/providers` makes no outbound call.
- [ ] A contract-validation failure is logged at error level with the offending payload
      reference.

## 7. PR review steps

1. Read the retry logic against the error taxonomy. Any path that retries a 403 is a blocker.
2. Confirm the budget check precedes the fetch in code order, not just in intent.
3. Exhaust the Marketaux ledger in integration; confirm the refusal is typed and the UI path
      shows a degraded state rather than an error.
4. Read `provider-entitlements.md`. Is any verdict inferred rather than observed?
5. Confirm CI passes with the keys removed from the environment.
6. Check that no adapter leaks a raw provider payload into a domain object.

## 8. Risks and open questions

| Risk | Mitigation |
|---|---|
| **OQ-2**: FMP Starter may not entitle the valuation endpoints | The probe is a Wave-1 deliverable precisely so this surfaces before F13 is planned |
| Live probing burns quota | Probe is a one-shot script, run deliberately, results committed |
| ApeWisdom changes shape without notice | Contract test + the loud parse failure + the methodology version pin |
| Fixture drift makes tests pass against a provider that has changed | Daily non-blocking `smoke:live`; a shape failure triggers a re-record PR |
