# 2026-09-03 — COLLECT — F04 §4.3, the market-data adapter

**Continuing where the Substack adapter left off.** Persistence wiring (`provider_call_log`,
`cost_event`) needs a migration SPINE hasn't written, so it's not COLLECT's to build yet. The
market-data adapter is next in `collect.md`'s ordering — D-31 (MT-14) already unblocked it at
zero additional spend.

## What was built

`src/adapters/market.ts`: `fetchDailyBars(symbol)` calls FMP's `historical-price-full` endpoint
under `provider: 'market'`. Returns `DailyBar[]` (`date`, `open`, `high`, `low`, `close`,
`volume`) — D-15's price-trigger input, at daily rather than intraday resolution.

Nine real fixtures under `apps/web/fixtures/market/historical_price_full/` — the **first
adapter with the full nine-case matrix closed**: `success`, `empty`, `malformed` (FMP's actual
`{"Error Message": "..."}` 200-response quirk, not a synthetic one), `unexpected_field`,
`null_where_number`, `entitlement_403`, `rate_limited` (with/without `Retry-After`),
`server_error`.

9 new unit tests. Gate green: **284 unit tests** (was 275), plus lint, typecheck, build,
`check:bundle`.

## The decision that shaped it

**`provider: 'market'` stays separate from `provider: 'fmp'`, even though D-31 means both now
call the same vendor.** `rate-limit.ts` already gives them independent buckets — `market` at
60/60s for continuous polling (it's the trigger's input), `fmp` at 30/6s for scheduled
fundamentals — and one shared tag would let either call pattern starve the other's quota under
load. `contracts/provider.ts`'s enum already kept them apart; this confirms that decision under
a real adapter rather than changing it. Recorded as `MEMORY.md` B-19.

## What §4.3's spec table got out from under it

The table calls this "intraday market data" and lists MT-14 as an open tier choice. D-31 closed
MT-14 with **daily bars, no new vendor** — a real reduction in what the trigger can catch (a
spike that reverts intraday won't fire it), already named in `DEPLOY.md`'s MT-14 resolution as a
further trim of D-20's I5. Nothing new here; the adapter is built against the answer that
actually shipped, not the table's original assumption.

## What it deliberately does not do

`fetchDailyBars` takes `apiKey` as a parameter rather than reading `FMP_API_KEY` from `env.ts`
itself — consistent with the wrapper's whole ports design, where nothing under `adapters/`
reaches outside `contracts/` for anything. In `live` mode with no key it throws immediately
rather than sending an unauthenticated request; that's a deployment misconfiguration, not a
provider condition the taxonomy models.

## Next

Persistence wiring, if SPINE has reached the migration by then. If not, FMP's fundamentals
endpoints (`provider: 'fmp'`) have no named blocker in `collect.md` and are the next standalone
adapter slice.
