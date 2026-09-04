# 2026-09-03 — COLLECT — F04 §4.3, the ApeWisdom adapter

**Continuing where the market-data adapter left off.** Persistence wiring still waits on a
SPINE migration that has not landed. Chose ApeWisdom over FMP's fundamentals endpoints for a
reason beyond "no blocker": D-30 makes it **the actual mechanism that closes MT-07** — the
universe's 100 symbols are still unnamed (`DEPLOY.md`), and their basis is "the tickers ranked
most-discussed by ApeWisdom on the seed date." An adapter that can pull that ranking is a
critical-path item disguised as an ordinary unblocked slice.

## What was built

`src/adapters/apewisdom.ts`: `fetchApeWisdomRanking(filter, page)` calls
`apewisdom.io/api/v1.0/filter/<filter>/page/<page>` and returns `ApeWisdomEntry[]` — `rank`,
`ticker`, `name`, and four numeric-string fields kept as strings rather than coerced.

Nine real fixtures under `apps/web/fixtures/apewisdom/filter/` — the full matrix, third adapter
to close it. 9 new unit tests. Gate green: **293 unit tests** (was 284), plus lint, typecheck,
build, `check:bundle`.

## The decision that shaped it

**`mentions`, `upvotes`, `rank_24h_ago` and `mentions_24h_ago` stay strings.** The real API
returns them as numeric strings (verified against ApeWisdom's own documentation, not assumed),
and coercing to `number` at the adapter boundary would hide the one failure mode worth catching:
a provider that later starts sending genuine numbers would coerce to the same value either way,
so the shape change would be invisible exactly where §4.1 stage 8 exists to catch it loudly.
Keeping the schema literal — `z.string()` on fields that are strings today — means a shape
change shows up as a contract violation, not a quietly-accepted `NaN` three layers downstream.

## What it deliberately does not do

**Does not populate `migrations/seed/universe-v1.json`.** `repositories/universe-seed.ts`'s
`SeedListMissing` guard exists precisely so nobody invents that list — D-27 calls the seed date
"a methodological commitment, not a convenience," meaning pulling the ranking and writing the
file is a deliberate, logged act for whoever runs it, not something this adapter should do as a
side effect of existing. This slice is the plumbing; closing MT-07 is still a separate, named
step.

**Retires ApeWisdom's cross-check role explicitly in the code comment.** D-30 supersedes D-12/
R-03 here: an instrument that selects the universe cannot also validate attention rank on it. A
future reader of this file who only knows D-12's "cross-check" framing would misuse the adapter,
so the module doc says which decision is current.

## Next

Persistence wiring, if SPINE has reached the migration. If not, FMP's fundamentals endpoints
(`provider: 'fmp'`) are the next standalone slice with no named blocker in `collect.md`.
