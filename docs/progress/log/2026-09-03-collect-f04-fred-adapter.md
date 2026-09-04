# 2026-09-03 — COLLECT — F04 §4.3, the FRED adapter

**Continuing where the Marketaux adapter left off.** FRED is the last provider in §4.3's table
with no named blocker, so it's next in the same "verify before building" order this session has
followed since SEC EDGAR.

## What was built

`src/adapters/fred.ts`: `fetchFredSeriesObservations(seriesId)` calls
`api.stlouisfed.org/fred/series/observations` and returns `FredObservation[]` — `date` and a
`value` kept as a decimal string (never coerced to `number`, same reasoning as `costUsd`
elsewhere in this build).

Nine fixtures under `apps/web/fixtures/fred/series_observations/`. 9 new unit tests. Gate green:
**321 unit tests** (was 312), plus lint, typecheck, build, `check:bundle`.

## Verification — the best result of this session's four attempts

A direct `WebFetch` against `fred.stlouisfed.org`'s docs page was blocked (403), same pattern as
every other official docs site this session tried. But a `WebSearch` surfaced a verbatim quote
of FRED's own worked example from that same documentation page — `realtime_start`, `observations`,
`date`, `value`, exactly matching what this adapter's schema now asserts. This is the
highest-confidence schema of the four adapters built this session; SEC EDGAR and Marketaux both
carry standing "not fully verified" notes, FRED does not need one.

**The one real edge case, not a hypothetical one:** FRED represents a missing observation with
`"value": "."` — present in the array, not absent from it. A schema or downstream calculation
that didn't know this would either fail to parse (if `value` were typed numeric) or silently
compute over `parseFloat('.')` → `NaN`. `fetchFredSeriesObservations` maps the sentinel to
`null` explicitly, at the one place a future caller can't miss it.

## The arc, ending here for this session

Four adapters built in a row after establishing the "verify the schema before writing it"
discipline at SEC EDGAR: SEC EDGAR, Marketaux, and now FRED, plus the earlier Substack, market
data and ApeWisdom — six total, which happens to satisfy F04's DoD's literal "six adapters"
even though three of §4.3's nine listed providers (Reddit, X, FMP) remain unwritten. Recorded
in `collect.md` as a distinction worth keeping visible, not as the DoD item being closed.

## Next

Nothing left in F04's adapter roster has both zero blocker and a schema this lane can currently
verify. Reddit needs MT-13; X needs a deferred governed cohort; FMP needs either a live key
this session doesn't have, or someone willing to accept the risk this session declined three
times. The next COLLECT work is either the persistence wiring (crossing into `repositories/`,
which needs explicit coordinator authorization to do solo) or a different feature entirely —
F20's service half or F16a, if their own blockers have moved.
