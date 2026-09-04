# Lane SPINE — data spine

**Written by:** the coordinator only (`../06-PARALLEL-LANES.md` §4). A lane agent reports;
it never edits this file.
**Owns these source paths:** `apps/web/migrations/`, `apps/web/src/contracts/`,
`apps/web/src/repositories/`, `apps/web/src/calc/`, `apps/web/src/analytics/`
**Never touches:** any path owned by COLLECT or SURFACE (`./collect.md`, `./surface.md`).

**This lane produces the contracts the other two consume.** A contract change wanted by
another lane arrives as a request to the coordinator and is built here — never edited in
place by the lane that wants it (`../02-ARCHITECTURE-CONTRACTS.md` §4, and the
`MEMORY.md`-entry requirement that governs contract changes).

## Features

| ID | Feature | Wave | Status | PR | Notes |
|---|---|---|---|---|---|
| F03 | Persistence and domain contracts | 1 | **`merged`** 2026-09-03 | — (built on `main`) | **Done, with one DoD item deferred** — see §Deferred. 34 tables (not 27 — `../MEMORY.md` B-05), append-only enforced by trigger, one-active-version by partial unique index, seed idempotent. 172 unit + 10 contract + 35 integration tests |
| F22 | PIT corpus and coverage integrity | 1 | **`merged`** 2026-09-03 | — (built on `main`) | **Done, with two DoD items deferred** — see §Deferred. The `asOf` guard bounds both temporal columns and has the test that fails if it is removed; `no-unbounded-pit-read` is **armed** with the real table set; retention fails closed on the corpus; gaps are detected, permanent and append-only |
| F05 | Calculation kernel and Inspector | 1 | **`merged`** 2026-09-03 | [#2](https://github.com/JoshuAI-888/Investment-sentiment-analysis/pull/2) | **Done, with two DoD items deferred** — see §Deferred. Artifact builder, decimal/canonicalization layer, method registry, replay and the Inspector UI for `attention.rank_change`. Two adversarial `lane-review` passes (8 findings, then 4 more on the fixes), all closed. `calc` added to `02-ARCHITECTURE-CONTRACTS.md` §3 as a sibling layer to `analytics` (B-20). 491 unit + 22 contract + 105 integration + 44 e2e tests, all against a real Postgres 16 |
| F06 | Deterministic analytics library | 2 | **`merged`** 2026-09-03 | [#5](https://github.com/JoshuAI-888/Investment-sentiment-analysis/pull/5) | **Done.** Every method in source §8.1–§8.7 registered, artifact-producing and golden-tested. Per-axis threshold re-derivation closed (`../MEMORY.md` **B-26**) — `min_items` stays locked at 5 everywhere (§6.3/B5), `display_floor` stays at 8 with a named revisit trigger. Five rounds of adversarial `lane-review`; round 3 found a serious off-by-N bug (five window-based methods silently computed over a stale window if handed more history than their fixed window — `../MEMORY.md` **B-25**). 627 unit + 22 contract + 105 integration, all green |

Registry estimate for this lane: **62–80 h** (`../03-ROADMAP.md` §2).

## Wave 1 sequencing

**This lane *is* the Wave 1 walking skeleton.** Under F-11 it runs single-agent and serial:
F03 → F22 → F05. **All three merged 2026-09-03 — the serial skeleton is complete.** F06 merged
2026-09-03, opening Wave 2 for SPINE. Nothing is currently assigned to this lane.

**What F22 hands F05.** `no-unbounded-pit-read` is **armed** — a repository method reading one of
the five bitemporal tables outside `asOf` now fails the build, where until today it passed on
empty. `contracts/bitemporal.ts` is the single list the guard and the lint rule both read, and a
test checks it against the migrations, so a new bitemporal table cannot be added unguarded.
F05's artifacts are subject to the audited retention path in `repositories/retention.ts`:
`retention_class = 'permanent'` is what exempts an artifact a claim or a Tier D4 record
references, and it is excluded by the query rather than filtered afterwards.

**What F03 hands F22.** The tables the PIT guard acts on exist, and so does the rule mechanism:
`no-unbounded-pit-read` ships **passing on empty**, and F22 §4.2 supplies its `bitemporalTables`
option and the test proving it fires. That is F22's DoD item, not a follow-up — until it is done,
the rule gates nothing. `evidence_item.available_at` is the column an as-of read bounds on. The other two lanes are constrained against it (`../06-PARALLEL-LANES.md`
§1b) until F06's contracts have survived a live round trip.

## Blocked

Nothing, and **F01 merged on 2026-09-03**, so the last structural precondition is gone. No
manual task in `../DEPLOY.md` gates any feature in this lane. It is the critical path.

**What F01 handed this lane.** `apps/web/src/contracts/`, `repositories/`, `calc/`, `analytics/`
and `migrations/` exist and are empty — F01 was explicitly forbidden from inventing a domain
contract in them (F01 §3). What it did leave behind is the enforcement:

- `layer-direction` already encodes `../02-ARCHITECTURE-CONTRACTS.md` §3, so a repository
  importing a service fails the build rather than a review.
- `no-float-in-analytics` fires on a numeric literal in arithmetic and on `Number()`/`parseFloat`
  in `analytics/` and `calc/`. Bring decimal helpers before writing the first calculation, not
  after the first lint failure.
- `no-unbounded-pit-read` is present and **passes on empty**. F22 §4.2 supplies its
  `bitemporalTables` option and the test proving it fires — that is the moment it starts
  gating, and it is F22's DoD, not a follow-up.
- `check:calc-coverage` loads `src/analytics/registry.ts` if it exists and passes on empty.
  F05 creates that file and the check begins biting with **no wiring change**.

## Deferred from a DoD

| Item | Why | Named trigger |
|---|---|---|
| ~~**F03 §4.5 — storage projection under 300 MB**~~ | ✅ **Resolved by F22 §4.5, which retires the instrument** — the measured MB/month figure *"replaces F-07's fixed `< 300 MB` ceiling, which is the wrong instrument for a corpus designed to grow forever."* `check:storage` still reports **485.8 MB** and the figure is pinned by a test, but it no longer gates. See `../MEMORY.md` **B-13** | — |
| **F22 §4.5 — measured MB/month per class** | The mechanism exists (`pnpm --filter web measure:storage`, reading `pg_total_relation_size`) and **refuses to report a rate from fewer than two readings a day apart**. A rate cannot be measured before there is a day of collection | **`DEPLOY.md` MT-08 + 24 h.** Take a reading when the collector starts and another the next day |
| **F22 DoD — historical views render per-axis floors and a labelled discontinuity** | The *computation* is done and tested (`src/calc/coverage.ts`: per-axis floors, `floorsDiverge`, `segmentAcrossGaps`, `evaluateWindow`). **There is no historical view to render it in** — the first is Wave 2 | **F09.** It owns the ticker detail surface that renders gaps as holes, and F22's §5 E2E case is executable the moment it exists |

**B-09's substantive finding stands and is unaffected by B-13.** Whatever instrument is used,
the projection's dominant term is an **assumed refresh cadence** — 4/day for sentiment — that no
feature spec fixes. F16's five minutes is the *dispatcher's* cadence, not each job's. That
assumption is what any storage answer turns on, and it is still nobody's decision.

## Counters owned by this lane

| Counter | Value | Needed | Feature |
|---|---|---|---|
| Coverage gaps recorded | 0 | Each one permanent and rendered | F22 |
| Storage growth rate (MB/month, measured) | **96 (projected, not measured)** | Projected 120–180; Neon Launch, not Free | F05, F22 |
| Storage at 100 symbols / 90 d artifact retention | **673.0 MB (projected, re-measured against F05's real artifacts)** | No longer a gate — F22 §4.5 retired the ceiling (`../MEMORY.md` B-13). Pinned by a test so a change is visible. Supersedes F03's 485.8 MB figure, which pre-dated `calculation_step`/`series_point` rows | F03, F05 |
| Measured storage, by class | permanent_corpus 0.12 MB · artifacts 0.02 MB · operational 0.67 MB (empty schema) | A **rate**, once two readings exist a day apart | F22 |

## In flight

Nothing — F06 merged 2026-09-03. This lane has no feature currently assigned.

**`attention_snapshot` repository — merged 2026-09-04 as a standalone cross-lane gap-fill (no
`F##` names it directly).** Surfaced while scoping F08 (attention leaderboard): the table and its
zod contract already existed (migration `0002`/`0011`, `contracts/security.ts`), but no
repository write or read function did, and both F04's persistence half and F08's collector needed
one — built once here rather than twice inconsistently. `insertAttentionSnapshot` (idempotent —
an exact repeat no-ops, a genuine revision writes a successor row, never an UPDATE),
`attentionSnapshotHistory` / `latestAttentionSnapshot` (as-of-correct reads, optional
`provider_methodology_version` filter), `countComparableAttentionSnapshots` (F06's z-score depth
gate and F08's `HistoryDepth`, built as a thin wrapper over the history function so the two
cannot drift on what "comparable" means). Three rounds of adversarial `lane-review` — round 1
found two genuine methodology-boundary bugs plus an idempotent-retry defect and an unhandled
concurrent-race error; round 2 found two of round 1's own regression tests still vacuous; round 3
confirmed all fixes hold under mutation. 18 new/updated integration tests. Idempotency semantics
and the "comparable" definition recorded in `../MEMORY.md` **B-27**. **F08's build and F04's
persistence-half repository dependency are both unblocked.** Session log:
`log/2026-09-04-coordinator-attention-repo-and-otp-flake.md`.

**Market, evidence and sentiment repositories, plus local security search — merged 2026-09-04**
(PR [#10](https://github.com/JoshuAI-888/Investment-sentiment-analysis/pull/10)), the same
pattern as `attention_snapshot` above, this time for three more tables at once. Surfaced while
scoping F09 (ticker detail page): F09's own DoD requires "no provider call in the read path" —
unlike F07's dashboard, which calls adapters live — so it needs to assemble entirely from stored
data, and no repository functions existed yet over `market_snapshot`, `price_return_snapshot`
(migration `0002`), `evidence_item` or `sentiment_snapshot` (migration `0003`).
`market.ts`/`evidence.ts`/`sentiment.ts` (all new) plus `searchSecurities` added to `security.ts`.
Idempotency keyed differently per table depending on what its own schema provides — raw-hash-based
where present, a real `ON CONFLICT` against the primary key where there's no revision column,
full-column value-equality where there's no raw hash at all — recorded as a reusable pattern in
`../MEMORY.md` **B-29**, since this is now the third table family (after `attention_snapshot`) to
need this exact judgment call. **Five rounds of adversarial `lane-review`, twelve findings, all
closed** — the most review-intensive slice this package has produced so far. Two findings
recurred: the wall-clock-vs-hardcoded-`asOf` test defect (now seen at least 5 times across this
codebase's history — B-08/B-11 pattern), and an idempotency/dedup correctness gap that took three
passes to close properly (`evidence.ts`'s per-security scoping, then its dedupe-before-limit
ordering, then its null-`security_id` semantics). The closing round found and fixed a real
production-scale defect a narrower review would have missed entirely: the scan window that made
dedup *correct* (`CANDIDATE_SCAN_LIMIT`) was sized by row-count projection alone
(1,000,000 — "~55 years at a heavy 50 items/day") rather than measured cost, and actually cost
~4.25s/268MB at 100k rows — enough to blow F09's own p95<3s budget and risk an OOM in a
memory-capped function. Lowered to 5,000 (measured ~190ms/28MB, and because the DB-side plan uses
an index scan under the limit, cost stays flat even against a 1,000,000-row table) — recorded as
its own lesson in **B-29**. **F09's repository dependency is now fully unblocked** except for two
named contract gaps (5d/20d return horizons vs. the schema's locked 7/30/90/180 set; no
`dedupeKey` schema column, derived at read time instead per `02-ARCHITECTURE-CONTRACTS.md` §4.4)
that F09's own build will need to work within, not around.

## Deferred from a DoD (F05)

| Item | Why | Named trigger |
|---|---|---|
| Storage projection at 100 symbols measured against real artifacts and < 300 MB | Measured (673.0 MB); the < 300 MB ceiling itself is retired (B-13), not something this feature can or should satisfy | — (instrument retired) |
| The Wave 1 walking slice runs against live ApeWisdom and its replay verifies | Runs against the committed fixture through the real adapter code path today | F04's persistence half (Wave 2) |

## Resolved defects (F05, both from adversarial `lane-review`)

| Defect | Recorded |
|---|---|
| A step list could be produced without the value it claims to trace — including after the value was legitimately minted and then mutated via direct assignment or `Object.defineProperty` | B-20 area; closed by freezing minted values before WeakSet registration |
| `insertReplayAuditEvent` was a second statement after `insertValidationRun`, not in the same transaction — a crash between them could leave a retention-protecting validation run with no audit trail | Closed via `withTransaction` in `runReplay` |
