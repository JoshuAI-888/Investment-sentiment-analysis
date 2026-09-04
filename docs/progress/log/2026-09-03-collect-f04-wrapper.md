# 2026-09-03 — COLLECT — F04 §4.1, the provider wrapper

**Slice, not a feature.** F04 is 18–24 h and its adapters are blocked on MT-13, MT-14 and MT-15.
§4.1's wrapper is the part that depends on none of them, sits on F04's critical path, and reaches
a green gate on its own. It was chosen for exactly that: work that keeps regardless of how
Reddit's approval queue resolves.

## What was built

`src/contracts/provider.ts` and eight modules under `src/adapters/`:

| Module | What it holds |
|---|---|
| `ports.ts` | Every side effect as an injected interface |
| `errors.ts` | The taxonomy — what kind of failure this is, decided once |
| `retry.ts` | Source §9.4's policy, as a pure function |
| `breaker.ts` | Five consecutive transient failures, 60 s, one half-open probe |
| `rate-limit.ts` | Token bucket per provider |
| `cache-key.ts` | Source §9.3's key shapes, plus the call-log fingerprint |
| `wrapper.ts` | The nine stages, in §4.1's order |

52 new tests. Gate green: **254 unit, 10 contract, 68 integration, 44 e2e, 16 scorer.**

## The decision that shaped it

`02-ARCHITECTURE-CONTRACTS.md` §3 lets `adapters` import `contracts` and nothing else, and
`layer-direction` fails the build on the edge. The wrapper needs a database (call log, cost
events), Redis (quota, cache, buckets) and a budget gate F18 has not built — none of which it may
import.

So every side effect is a **port**: an interface here, an implementation in `services/`, where
repositories and adapters may both be imported. This was forced by the lint rule and turned out
to be the reason the slice was completable at all — the whole pipeline is driven by fakes with no
database, no Redis and no network.

It also made the DoD provable. Three of F04's items are statements about *order*, and an
implementation that checked the budget last would return byte-identical values to one that
checked it first. Only the port call sequence separates them, so the fakes record a trace and the
tests assert on that. F04 §7 step 2 asks a reviewer to confirm the budget check precedes the
fetch "in code order, not just in intent" — the trace is that review, executable.

## Three findings

**The headline test could not fail.** `wrapper.test.ts` asserts that a 403 makes exactly one
attempt — the DoD item verbatim. Removing `entitlement` from `NEVER_RETRIED` left it green,
because retry eligibility is a whitelist and `entitlement` is not on it. Breaking the whitelist
instead, leaving `NEVER_RETRIED` intact, also left it green. Two independent guards, and the test
named after the invariant could not fail from either breaking alone.

The defence is better for the redundancy. The signal was worse than it looked. This is B-04's
shape a second time — there, `check:bundle` passed on a real leak because the guard it backstops
folded to an unconditional throw and the minifier dropped the strings the scanner searched for.
**A passing test over a redundantly-defended invariant proves less than its name implies**, and
only breaking each layer separately finds out which. Both layers are now pinned in one named
assertion that fails under either mutation. Recorded as B-17.

**A cache hit was spending quota.** §4.1 orders the ledger (2) before the cache (3), so a cached
read consumed a unit of the day's allowance for a call it never made. Invisible on most
providers; on Marketaux's 100 requests/day a well-cached cycle would exhaust the allowance with
no outbound request at all — refusals in the log, a provider never contacted, and nothing to
point at. The order is right and is kept: reserving before the cache read is what makes the
ledger safe under concurrency. Every path that exits without reaching the provider now returns
its reservation. B-16.

**`costUsd` is a decimal string, not ARCH §4.1's `number`.** Its destination is
`cost_event.cost_usd`, a `numeric` that `contracts/cost.ts` types as `decimalString` so a float
never round-trips through it. A `number` at the provider boundary would put the conversion inside
the wrapper, on every priced call, where nobody looks. B-15. ARCH §4.1 should be corrected when
that document is next revised — it is SPINE's, so this is reported rather than edited.

## One deliberate deviation from the stage order

The breaker is §4.1's stage 7, which is where it *reacts*. It is **read** before dispatch and
written after: a breaker consulted only after the request has gone has never prevented a call.
`circuit_open` was added to the error union for the same reason — collapsing it into `upstream`
would report a status the provider never returned, and `/api/health/providers` could not then
distinguish "the provider is down" from "we stopped asking", which is the distinction that
endpoint exists to draw.

## What is not done

Seven of F04's eleven DoD items remain, listed with triggers in `../collect.md`. The load-bearing
one is **"the quota ledger survives a restart"** — the port is defined and the wrapper reserves
and releases against it, but survival is a property of the implementation, and no ledger table
exists yet. That is a migration, which is SPINE's to write.

Next: §4.2's fixture harness, then the Substack adapter — the only one with no blocker and no key.
