# 2026-09-03 — F03, persistence and domain contracts

**Lane:** SPINE · **Branch:** `main` · **Outcome:** merged, gate green, **one DoD item deferred**

## What was built

| Piece | Where | Note |
|---|---|---|
| 34 tables, 10 migrations | `apps/web/migrations/` | Not 27 — see B-05 |
| Append-only triggers | `0009_append_only.sql` | Ten tables; two of them lifecycle-only |
| Domain contracts | `apps/web/src/contracts/` | Decimals as strings end to end |
| Repositories | `apps/web/src/repositories/` | The only modules containing SQL, now lint-enforced |
| Activation transaction | `repositories/versions.ts` | Advisory lock + partial unique index |
| Idempotent seed | `repositories/universe-seed.ts` | Refuses to invent a list (MT-07) |
| Storage projection | `scripts/checks/storage-projection.ts` | **Reports 485.8 MB against a 300 MB gate** |
| `no-sql-outside-repositories` | `eslint-rules/` | The sixth architectural rule |

**Counts:** 172 unit · 10 contract · 35 integration · 44 e2e · 16 scorer.

## The finding that matters

**The storage projection does not meet its gate: 485.8 MB against 300 MB.**

This is not a surprise the build produced — it is the case F-07 wrote a response for: *"if it
exceeds 300 MB the granularity rule is revisited before Wave 2 starts, not after the tables
fill."* The projection exists to fire that trigger, and it fired.

Two corrections were made before reporting, and both belong to the finding:

1. A first pass sized artifacts across **180 days of history** and reported 1,548 MB. Artifacts
   carry **90-day retention** (F-07's own clause). Sizing by history rather than retention
   doubled the answer, in the alarming direction.
2. The permanent corpus was inside the total. §6.8 governs it by a **growth rate in MB/month,
   measured, not by a fixed ceiling**, and D-33 bought Neon Launch for exactly that. It is
   reported separately: **96 MB/month**, inside the 120–180 planned.

**The lever is not the one the gate points at.** The dominant line is `sentiment_shrunk` at
140.8 MB — 100 subjects × **4 refreshes/day** × 90 days. *That cadence is an assumption made in
the projection file.* No feature spec fixes per-job cadences; F16's five minutes is the
**dispatcher's**. Halving sentiment and attention lands near 390 MB; halving all of them lands
near the gate, without touching an artifact's shape.

So: fix the cadences in spec, re-measure, and only then consider granularity. Revisiting
granularity on a number driven by an invented cadence would trade away Inspector fidelity — the
product's actual thesis — to fix an input nobody ever decided.

Deferred in `spine.md` with **F05 as the named trigger**, because F05 owns the artifact builder
and is the last point at which granularity changes cheaply.

## Four other rulings (`../../MEMORY.md` §2b)

- **B-05** — §7.2 defines **34** tables, not 27. Six sections define two or three each, and
  three of the unnamed ones are load-bearing for F03's own DoD: `universe_member` (the seed
  rule is a statement about it), `method_registry` (what `check:copy` reads), `job_run` (F16a's
  whole idempotency guarantee).
- **B-06** — bitemporality is a *pair*, and derived tables name it differently. A computed
  return was never observed. The test asserts a declared pair per table, so a new snapshot table
  must choose explicitly rather than inherit from a filename.
- **B-07** — §4.1 (append-only) and §4.3 (activation deactivates the current row) cannot both be
  literally true. Content is immutable; `status` and activation timestamps are lifecycle. The
  allowed set is per table, because `universe_version.selected_count` is materialised *at*
  activation.
- **B-08** — cost reconciliation writes a successor. An early read path filtered on
  `supersedes_cost_event_id is null`, which keeps the estimate and drops the reconciled figure —
  backwards, and it reads perfectly naturally.

## Two defects caught by running things, not by reading them

- **`no-sql-outside-repositories` reported `'Select a ticker from the list'` as a query.** The
  same cry-wolf failure `check:copy` was designed around, arriving in a rule written the same
  day. Fixed by anchoring at statement start and excluding English determiners after `from`.
- **A projection assertion asserted `>50×` where the arithmetic gives `41×`.** The expectation
  was a guess at the multiple rather than a derivation of it. Corrected with the arithmetic
  written down, and the measured value pinned.

## What the next session should know

- **Integration tests run `--no-file-parallelism`.** They share one database, and two files
  running `drop schema public cascade` against each other fails as a schema error — a harness
  race reported as a data problem, which is the most misleading kind of red.
- **`check:storage` is not a CI gate.** It runs in CI as report-only (`|| true`). It is a Wave 1
  *exit* gate that is currently unmet and recorded as such; making it blocking would turn every
  unrelated merge red for a known, tracked item.
- **`node-postgres` parses `numeric` as a float by default.** Overridden in
  `repositories/client.ts`. The contract suite has `0.30000000000000004` as a case precisely
  because that is the value where the default breaks and `100.00` does not.
- **The seed cannot run yet.** `migrations/seed/universe-v1.json` is MT-07 and is owner-provided.
  The script exits 2 with a message naming it rather than inventing a universe.

## Next

F22 — the PIT corpus and coverage integrity. It supplies `no-unbounded-pit-read` with its
`bitemporalTables` set and the test proving it fires; until then that rule passes on empty and
gates nothing.
