# ADR-013 — User-editable schedules use a fixed QStash-driven dispatcher

**Status:** Accepted, **amended by D-15 and D-16.**
**Source:** `../reference/SOURCE-PRD-v1.5.md` §1.1.

## Decision

Vercel Hobby Cron cannot provide the required intraday precision. One Upstash QStash schedule
calls a protected dispatcher route every five minutes; the dispatcher reads due jobs from
Postgres, takes a Redis lock, and runs idempotent work.

**The admin console edits database job definitions, never QStash schedules.**

## Amendment 1 — the heartbeat is required, not optional (D-16)

The original kept "one deployment-managed daily Vercel Cron heartbeat **only as an optional**
stale-dispatch alert/failsafe".

Under D-16's forward-only collection there is **no backfill**, which changes what a stalled
dispatcher costs. It is not degraded service that recovers when someone notices — it is
**permanently missing corpus**. A dispatcher that dies quietly on a Friday costs three days of
history that can never be reconstructed, and the gap is still there in the Tier D4 backtest a
year later.

The heartbeat is therefore **required and deployed in Wave 1**. It remains a failsafe alert
only: it must not be able to run jobs. It is the only thing that catches the failure mode where
the dispatcher is *up* but dispatching nothing.

## Amendment 2 — there are now two dispatch paths (D-15)

The clock is no longer the only thing that starts work. X is the only per-unit-priced source,
and D-20's budget buys a **spike detector, not a continuous gauge**. So X reads are not
scheduled — they are opened by a market-data event, and market data is flat-rate: the cheap
source decides when to spend the expensive one.

Binding rules, all of which are DoD items in F16:

- A trigger **may never bypass the lock or the idempotency key**. One spike is one window.
- A trigger **may never dispatch a job not registered as trigger-eligible** — a seeded column,
  not a runtime decision.
- A window that would breach an X ceiling is **refused and recorded as a coverage gap**, never
  silently truncated. A shortened window is a sample nobody can describe.
- **Market-data polling is never gated by the budget check.** It is flat-rate, and it is the
  only thing that can see the next spike. Gating it saves nothing and blinds the system.
- Every spike evaluation writes a `CalculationArtifact` — **including the ones that do not
  fire**. A trigger that did not fire is equally a recorded computation; without it the
  sampling frame is unauditable.
