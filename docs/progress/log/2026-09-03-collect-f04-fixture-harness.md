# 2026-09-03 — COLLECT — F04 §4.2, the fixture harness

**Continuing where §4.1 left off.** The wrapper merged with its adapters still blocked on
MT-13/MT-14/MT-15. §4.2 is the next slice on that same critical path that depends on none of
them: `PROVIDER_MODE=fixture` reads, generic across every future adapter.

## What was built

One new module, `src/adapters/fixtures.ts`:

| Export | What it does |
|---|---|
| `readFixture(provider, endpoint, case, root?)` | Loads and validates a frozen `{status, headers, body}` file from `fixtures/<provider>/<endpoint>/<case>.json` |
| `createFixtureFetcher({provider, endpoint, root?})` | A `Fetcher` (the wrapper's port) backed entirely by `readFixture` |
| `createLiveFetcher()` | A real `fetch`-backed `Fetcher`, stripping the fixture-case header first |
| `createFetcher(providerMode, {...})` | The one place `PROVIDER_MODE` picks fixture vs. live |

10 new unit tests, against a `mkdtemp` scratch tree rather than the committed `fixtures/`
namespace — the harness's own tests need no real fixture files to exist. Gate green: **264
unit** (was 254), plus lint, typecheck, build, `check:bundle`.

## The decision that shaped it

A fixture has no URL to route case selection on — the wrapper's `Fetcher` type carries a real
request because that's what a live call needs, but two adapters can share an endpoint name
(`quote`, `feed`) against entirely different hosts, and a contract test wants *this exact case*
for *this exact call*, not whatever a URL pattern happens to match.

So the case name travels on `x-fixture-case`, a header the caller sets and `createLiveFetcher`
strips before a live request is ever built. That strip is the thing that makes it safe: a case
name is a test artifact, and the one place it could leak onto a real HTTP request now can't.

## What it deliberately does not do

No fixture files exist under `apps/web/fixtures/` yet, and none should — there is no adapter to
record real payloads for. `05-TEST-STRATEGY.md` §2 is explicit that recording is "a deliberate,
logged act, never a test side effect," so this slice ships the mechanism and leaves the
recording to whoever builds the first adapter. The full nine-case fixture matrix (F04's DoD)
stays deferred to that slice, now genuinely unblocked rather than waiting on this one.

## Next

The Substack adapter — the only one with no blocker and no key, and now able to record real
fixtures against this harness — then the persistence wiring (`provider_call_log`, `cost_event`,
the ledger's Postgres mirror) in `services/`, which needs a migration SPINE has not written yet.
