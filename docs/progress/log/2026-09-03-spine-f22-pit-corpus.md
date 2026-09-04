# 2026-09-03 — F22, point-in-time corpus and coverage integrity

**Lane:** SPINE · **Branch:** `main` · **Outcome:** merged, gate green, **two DoD items deferred**

The feature that cannot be retrofitted. Under D-16 there is no backfill, so PIT discipline,
permanent retention and gap recording either exist from the first collected item or the corpus
is permanently unable to support D-09's promotion path.

## What was built

| Piece | Where |
|---|---|
| `collector_start`, `coverage_gap`, `collector_heartbeat`, `storage_measurement` | `migrations/0010_` |
| `ingested_at` added to the bitemporal primary keys | `migrations/0011_` |
| The audited retention exception | `migrations/0012_` |
| The `asOf` guard | `src/repositories/as-of.ts` |
| Coverage arithmetic, pure | `src/calc/coverage.ts` |
| Retention policy, fails closed | `src/repositories/retention.ts` |
| Gap detection from heartbeats | `src/repositories/coverage.ts` |
| Measured storage per class | `src/repositories/storage.ts` |

**Counts:** 202 unit · 10 contract · 68 integration · 44 e2e · 16 scorer.

## Three findings, all surfaced by tests rather than by reading

**B-11 — the bitemporal primary keys omitted `ingested_at`.** Source §7.2 keys
`market_snapshot` on `(security_id, provider, observed_at)`; F22 §4.1 says *"never overwrite,
insert a successor"*. Those cannot both hold: a revision of the same observation collides with
the row it revises, and the only way to store it is the UPDATE §4.1 forbids — which deletes the
value that was knowable at the time. Found by a fixture needing two facts about one instant with
different `ingested_at`, which is not exotic; it is the ordinary shape of a corrected close.

**B-12 — append-only blocked retention.** F03 §4.1 forbids DELETE on `calculation_snapshot`;
F22 §4.3 gives artifacts 90 days. Source §7.2 already had the answer — append-only *"outside a
separately audited legal-retention process"*. DELETE now needs a transaction-scoped flag and
writes its audit event in the same transaction; **UPDATE has no exception and never will**,
because retention removes whole expired artifacts and does not rewrite numbers.

**B-13 — the 300 MB gate was retired by a section one feature away.** F22 §4.5: the measured
MB/month figure *"replaces F-07's fixed `< 300 MB` ceiling, which is the wrong instrument for a
corpus designed to grow forever."* That resolves the item B-09 deferred yesterday. A ceiling on a
permanent corpus tells you one thing once — the day you crossed it.

## Two DoD items deferred, with triggers

- **Measured MB/month per class** — the mechanism exists and **refuses to report a rate from
  fewer than two readings a day apart**. Trigger: **MT-08 + 24 h**.
- **Historical views rendering per-axis floors and labelled discontinuities** — the computation
  is done and tested; there is no historical view until Wave 2. Trigger: **F09**.

## What the next session should know

- **`no-unbounded-pit-read` is armed.** It fired on real code the moment it was — on an
  `INSERT ... RETURNING`, which names a table but is not a read. Now restricted to `from`/`join`
  positions. Same cry-wolf lesson as `check:copy` and the SQL rule, third time.
- **The first growth figure was −1,760,869 MB/month.** Every row took its own `now()`, so each
  table was its own "reading" microseconds apart and the rate was a division by nearly zero.
  Fixed with one timestamp per batch and a minimum span. A confident enormous number is worse
  than no number, because it looks like data.
- **`.at(-1)` rather than `[length - 1]` in `calc/`.** `no-float-in-analytics` forbids
  arithmetic on a numeric literal there, and the index-math exception is exactly the kind that
  widens until the rule means nothing.
- **Gap detection reads heartbeats, not data.** `items_seen = 0` with a heartbeat present means
  the collector ran and the window was quiet. Conflating that with a gap manufactures one every
  quiet weekend and buries the real ones.

## Next

F05 — the calculation kernel and Inspector. It is the last point at which artifact granularity
changes cheaply, and it inherits the armed PIT lint and the audited retention path.
