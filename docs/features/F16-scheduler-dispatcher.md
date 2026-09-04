# F16 — Scheduler and Dispatcher

> **RNI scope:** scheduled and manual requests enter one idempotent job path. Reddit and X have
> independent checkpoints and converge only after both platform slices become terminal.

> **Amended 2026-09-03 by the re-lock.** This feature was **not** unchanged, and the original
> text contradicted the re-cut roadmap in two ways. **D-15:** the clock is no longer the only
> thing that starts work — a market-data spike opens an X sampling window, so there are now two
> dispatch paths, and the trigger path is Wave 1. **D-16:** the collector must be running from
> Wave 1, which means the *dispatch core* cannot wait for the Wave 4 admin plane. The feature is
> therefore **split across two waves** (§0). Cadence and cost figures in §4.3 are re-derived.
> See `../MEMORY.md` §1b for the decisions and `../SPEC-REVIEW.md` for the reasoning.

**Wave:** 1 (dispatch core) + 4 (admin control plane) · **Lane:** **F16a → COLLECT · F16b → SURFACE** (§0)
**Estimate:** 6–8 h (Wave 1) + 8–10 h (Wave 4) · **Depends on:** F03, F04 (Wave 1); F15 (Wave 4)
**Blocking manual task:** `../DEPLOY.md` **MT-04** (QStash schedule creation) — now needed for
**Wave 1**, not Wave 4, because **MT-08** cannot start without it.

> **`Lane:` normalised 2026-09-03.** This field previously carried the *dependency*-lane letters from `../03-ROADMAP.md` §2 (P/A/G/V), or was absent. `PROGRESS.md` warns in prose that dependency lanes and **build lanes** are different axes, but the specs still carried the colliding value — so a `lane-build` agent told "you are SURFACE" opened its feature and read a different lane on line one. The field now names the **build lane**, which is the unit of parallel assignment. Here it was `Lane: G`, and it hid the split: **the two halves belong to different build lanes**.

## 0. The split, and why it exists

The original spec placed this entire feature in Wave 4 behind F15. That was coherent when
collection was a Wave 2 concern and every job was clock-driven. Under D-15 and D-16 it is not:

| Part | Wave | Why |
|---|---|---|
| Signature verification, Redis lock, idempotency, `JobService`, the trigger path | **1** | The collector runs from Wave 1 (D-16). Every hour it is not running is data that does not exist and cannot be recovered. It needs a dispatcher on day one |
| Admin-editable job rows, cadence editing, next-run preview, dry-run UI | **4** | Convenience over a working collector. Deferring it costs nothing permanent |

**The Wave 1 half ships without any UI.** Job definitions are seeded rows; changing one is a
migration. That is the correct trade when the alternative is delaying the corpus.

## 1. Purpose

One fixed external schedule driving all recurring work, with locking and idempotency so a
duplicate delivery costs nothing. ADR-013: the admin edits database job rows, never the
external scheduler.

## 2. Scope

**In (Wave 1):** the QStash-signed `/api/cron/dispatch` route; due-job claiming; Redis locks;
idempotency keys; retry and backoff; the internal job service shared by scheduled, triggered and
manual paths; **the trigger-dispatch path (§4.1b)**; the daily Vercel Cron heartbeat as a
stale-dispatch alert — **promoted from optional to required** under D-16.

**In (Wave 4):** admin-editable job rows; the dry-run path; next-run preview.

**Out:** the job definitions' business logic (owned by the features that need them — F08's
collector, F07's refresh, F22's window bookkeeping); budget policy (F18); **spike detection
itself**, which is F06's registered method — this feature dispatches on the verdict, it does not
compute it.

## 3. Contracts

**Consumes:** `job_definition` rows (F03); the spike verdict from F06's registered method
(F04's market-data adapter supplies its input); admin mutations (F15, Wave 4).
**Produces:** `JobService.execute(jobId, idempotencyKey)` — the **single** execution path for
every refresh in the system, whether a clock, a trigger, or a human started it.

## 4. Build spec

### 4.1 The dispatcher

QStash calls `POST /api/cron/dispatch` every five minutes. In order:

1. **Verify the QStash signature.** An unsigned or badly-signed request is rejected before
   any work, any database read, and any cost. This is the only authentication on this route.
2. Acquire a Redis lock with a TTL exceeding the maximum run time. A second concurrent
   delivery is a **no-op**, not a queued duplicate.
3. Select due `job_definition` rows.
4. Claim each with an idempotency key derived from `(job_id, due_at)`. A re-delivery of the
   same due instant is a no-op.
5. Execute through `JobService` — the identical path manual admin refresh uses. Two code
   paths for the same job is how they diverge.
6. Record outcome, duration, cost, and the next run.
7. Release the lock, including on failure. An expired lock must not strand a job forever.

### 4.1b The trigger path (D-15)

X is the only per-unit-priced source in the stack, and D-20's budget buys a **spike detector,
not a continuous gauge** (`../SPEC-REVIEW.md` FIND-3). So X reads are not scheduled. They are
opened by a market-data event, and market data is flat-rate and unlimited — the cheap source
decides when to spend the expensive one.

1. The **market-data poll is an ordinary clock job** on the Wave 1 cadence. It is the only part
   of this loop that runs unconditionally, and it is free.
2. It writes its observations and calls F06's registered spike method. **The verdict is a
   `CalculationArtifact` like any other** — a trigger that fired is inspectable and replayable
   after the fact, and a trigger that did *not* fire is equally a recorded computation. Without
   this, the sampling frame is unauditable and F10 §4.5's disclosure cannot be substantiated.
3. A positive verdict enqueues a **sampling window** — a bounded job with an explicit read
   budget, not an open-ended subscription.
4. Before dispatch, the window is checked against F18's X read ceilings (monthly, daily, and
   per-event). **A window that would breach a ceiling is not truncated — it is refused, and the
   refusal is recorded as a coverage gap** (F22's `CoverageGap`). A silently shortened window
   would produce a sample whose frame nobody can state.
5. The window executes through the same `JobService`.

**Binding rules.**

- **The trigger may never bypass the lock or the idempotency key.** A spike detected twice in
  one interval is one window. Two windows for one spike is money spent twice for a sample that
  double-counts.
- **The trigger may never dispatch a job that was not registered as trigger-eligible.** The
  eligible set is a seeded column, not a runtime decision.
- **A trigger firing is never retried on budget refusal.** The spike has passed; a late window
  samples a different moment and would be labelled with the wrong one.
- **Market-data polling is never gated by the budget check.** It is flat-rate, and it is the
  only thing that can detect the next spike. Gating it saves nothing and blinds the system.

### 4.2 What the admin can and cannot do

Editable: due times, cadence, enabled state, retry policy, per-job budget ceiling.
**Not editable from any UI:** the QStash schedule itself, `vercel.json`, or the dispatch
secret. This boundary is the ADR-013 ruling and a review item.

### 4.3 Capacity and cost

Five-minute cadence = 288 messages/day, 8,640/month, within the QStash free allowance —
recorded here so a cadence change is a deliberate cost decision. The dispatcher itself does
minimal work when nothing is due, so most invocations are near-free.

**Trigger windows are additive and are not free.** Each fired window spends real X reads against
F18's ceilings. The dispatch messages themselves are negligible; the reads are not. Record both
separately in `../PROGRESS.md` — a month where QStash is comfortable and the X ceiling is
exhausted on day nine is the failure mode this line exists to make visible.

### 4.4 Dry run and preview

Every job supports a dry run that reports what it *would* do, what it would call, and what it
would cost — without calling anything. Next-run preview is shown per job in the admin UI.

### 4.5 Heartbeat — required, not optional (D-16)

One deployment-managed daily Vercel Cron that checks the last successful dispatch and alerts if
it is stale. It is a failsafe alert only, never the primary scheduler, and it must not be able to
run jobs.

**Why this stopped being optional.** Under forward-only collection a stalled dispatcher is not
degraded service that recovers when someone notices — it is **permanently missing corpus**. There
is no backfill (D-16). A dispatcher that dies quietly on a Friday costs three days of history
that can never be reconstructed, and the gap will still be there in the Tier D4 backtest a year
later. This is the highest-severity alert in the system (F18), and the heartbeat is the only
thing that catches the failure mode where the dispatcher is *up* but dispatching nothing.

## 5. Test plan

| Level | Cases |
|---|---|
| Unit | due-time selection across DST boundaries (schedules are UTC); idempotency key construction; retry/backoff |
| Contract | QStash signature verification, positive and negative |
| Integration | duplicate delivery is a no-op; a held lock prevents overlap; an expired lock allows recovery; failure releases the lock; manual and scheduled paths execute identical code; dry run makes zero external calls |
| E2E | admin edits a job's cadence and the next-run preview updates; a manual refresh produces the same result as a scheduled one; heartbeat alerts on a stalled dispatcher |
| Feature-specific | replay the same QStash delivery three times; assert exactly one execution and one cost event |
| Trigger (D-15) | a crossing fixture fires exactly one window; a non-crossing fixture fires none and still writes a verdict artifact; the same spike detected twice in one interval yields one window; a window that would breach an X ceiling is refused and writes a `CoverageGap`, never a shortened window; a trigger-ineligible job cannot be dispatched by the trigger path; market-data polling still runs with the budget exhausted |

## 6. Definition of Done

- [ ] An unsigned or badly-signed request is rejected before any work or cost.
- [ ] Redis lock prevents overlap; a duplicate delivery is a no-op; an expired lock recovers.
- [ ] Idempotency is keyed on `(job_id, due_at)` and proven by the triple-replay test.
- [ ] Manual and scheduled refresh execute **the same** `JobService` code path.
- [ ] Every job supports a dry run that makes zero external calls.
- [ ] Next-run preview is correct across a DST boundary.
- [ ] The admin can never rewrite the QStash schedule or `vercel.json`.
- [ ] Locks are released on every exit path, including panics.
- [ ] Cadence cost (288/day) is documented and within the free allowance; **X reads are recorded separately** from dispatch messages.
- [ ] Heartbeat alerts on staleness and cannot execute jobs, and is **deployed in Wave 1**.
- [ ] Every spike evaluation writes a `CalculationArtifact` — including the ones that do **not** fire.
- [ ] A trigger cannot bypass the lock or the idempotency key; one spike is one window.
- [ ] A window that would breach an X ceiling is **refused and recorded as a coverage gap**, never silently truncated.
- [ ] The trigger-eligible job set is a seeded column; the trigger cannot dispatch anything outside it.
- [ ] Market-data polling is **not** gated by the budget check.
- [ ] A dispatcher that is up but dispatching nothing raises the collector-gap alert.

## 7. PR review steps

1. Remove the signature header; confirm rejection precedes any database or provider access.
2. Fire the same delivery three times concurrently; count executions and cost events.
3. Kill a job mid-run; confirm the lock expires and the next dispatch recovers.
4. Diff the manual-refresh and scheduled code paths — they must be the same function.
5. Search for any code path that could write a QStash schedule.
6. **Feed the spike method a fixture that does not cross the threshold.** A verdict artifact must
   still be written. If nothing is recorded when the trigger does not fire, the sampling frame is
   unauditable and F10 §4.5's disclosure has nothing behind it.
7. **Exhaust the X ceiling, then fire a spike.** Confirm a refusal and a `CoverageGap` row — not a
   smaller window. A truncated window is a sample nobody can describe.
8. **Exhaust the budget, then confirm market data still polls.** If it stops, the system cannot
   see the next spike, and the saving is zero because market data is flat-rate.

## 8. Risks and open questions

| Risk | Mitigation |
|---|---|
| A stuck lock stalls all jobs | TTL exceeds max run time; heartbeat alerts; recovery tested |
| Serverless cold start makes the 5-minute cadence lumpy | Jobs are idempotent and due-time based, not interval based |
| QStash free-tier limits change | Cadence is a config value; cost documented so a change is deliberate |
| A quiet market produces few triggers and a thin X sample | Correct behaviour, not a fault: the sample is thin because the phenomenon was absent. `n`-thresholds abstain, and F22 records the window. Do **not** add clock-driven X reads to "top up" — that spends the ceiling on the days least likely to matter |
| A volatile week exhausts the monthly X ceiling early | The per-event and daily ceilings exist for this; the refusal is a recorded gap. Re-derive the ceilings in `../PROGRESS.md` after the first volatile month rather than guessing them now |
| Wave 1 ships no admin UI, so a bad cadence needs a migration | Accepted. A migration is cheaper than a delayed corpus, and cadence changes are rare once the collector is stable |
