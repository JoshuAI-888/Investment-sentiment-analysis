# 2026-09-03 — COLLECT — F04 §4.3, the Substack RSS adapter

**Continuing where §4.2 left off.** The fixture harness had nothing to record fixtures against;
Substack is the first adapter, chosen for the reason `MEMORY.md` D-15 gives — zero lead time, no
key, no approval — so it is the one channel not waiting on MT-13, MT-14 or MT-15's owner clock.

## What was built

`src/adapters/substack.ts`: `fetchSubstackFeed(publicationSlug)` runs
`https://<publication>.substack.com/feed` through §4.1's wrapper and `parseSubstackFeed` turns
the result into `SubstackEntry[]` (`guid`, `title`, `link`, `publishedAt`, `contentHtml`).

Six real fixtures under `apps/web/fixtures/substack/feed/`: `success`, `empty`, `malformed`,
`entitlement_403`, `rate_limited_with_retry_after`, `rate_limited_without_retry_after`,
`server_error`. Timeout has no fixture file — it isn't representable as recorded content, and
the wrapper's own tests already cover it generically.

Added `fast-xml-parser` (no runtime dependencies) — the first dependency any adapter has needed.

14 new unit tests. Gate green: **275 unit tests** (was 264), plus lint, typecheck, build,
`check:bundle`.

## The decision that shaped it

RSS has no zod-checkable shape at the wrapper's validation stage (§4.1 stage 8) the way a JSON
response does — the wrapper's `schema` here is just `z.string().min(1)`, proving "this is text,"
nothing more. So a second validation layer sits above the wrapper: `parseSubstackFeed` throws on
a document with no `<rss><channel>` root, and `fetchSubstackFeed` catches that and reports it
through the same `{kind:'contract'}` taxonomy a malformed JSON payload would use, calling
`onContractViolation` itself rather than relying on the wrapper to have caught it. A publication
that starts returning an HTML error page instead of its feed is exactly the "provider changed
shape" condition §4.1 stage 8 exists to catch loudly, even though it happens one layer up here.

**A single bad `<item>` does not fail the batch.** An unparseable `pubDate` or a missing `title`
drops that one entry rather than raising — one publication's malformed post should not blind the
collector to every other item in the same poll, and under D-16's no-backfill rule a dropped poll
is a permanent hole while a dropped item is not.

## What it deliberately does not do

Dedup and entry-shift/republish handling across polls (`05-TEST-STRATEGY.md` §2.1's two-snapshot
fixture pair) needs to know which `guid`s were already seen, which is state the collector holds,
not the adapter. That is F16a's job and stays deferred to it.

## One finding, not fixed here

**F04's DoD (§6) says "six adapters"; §4.3's own table names nine.** `contracts/provider.ts`'s
`providerId` enum agrees with the table, so the DoD prose looks like the stale one — plausibly
predating D-12's adapter-set replacement. Recorded as `MEMORY.md` B-18 rather than silently
picked a number; `collect.md`'s deferred table now names the discrepancy instead of asserting a
count. This is SPINE's/the coordinator's document to correct, not a build-time fix.

## Next

Persistence wiring in `services/` (`provider_call_log`, `cost_event`, the ledger's Postgres
mirror) needs a migration SPINE has not written yet. If that is still blocked when this is
picked up, the market-data adapter is next — D-31 already unblocked it (FMP Starter's daily
bars, no new vendor), and it is the price trigger's input.
