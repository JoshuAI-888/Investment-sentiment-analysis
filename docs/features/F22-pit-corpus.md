# F22 — Point-in-Time Corpus and Coverage Integrity

**Wave:** 1 · **Lane:** **SPINE** · **Estimate:** 12–16 h · **Depends on:** F03
**Status:** see `../PROGRESS.md` (this file never records status)
**Decisions:** `../MEMORY.md` D-16 (forward-only), D-17 (permanent corpus, split retention),
D-09 (the promotion path this exists to make possible).

## 1. Purpose

The corpus is stored so that a question can be asked **as of a past date without look-ahead**,
so that every gap in coverage is visible rather than interpolated across, and so that nothing
ever deletes the material a Tier D4 backtest will need.

**This is the feature that cannot be retrofitted.** Under D-16 there is no backfill: point-in-time
discipline, full-body retention and gap recording either exist from the first collected item or
the corpus is permanently unable to support the promotion path. Every other feature in this
package can be rebuilt later. This one cannot.

## 2. Scope

**In:** bitemporal storage for social and market facts; the look-ahead guard and the test proving
it fires; the permanent-retention policy and its enforcement; coverage-gap detection and
recording; the coverage floor and its rendering contract; storage growth measurement; the
as-of query interface every historical read goes through.

**Out:** the analytics that consume it (F06); the backtest that validates against it (F12);
collection itself (F04); scoring (F20).

## 3. Contracts

**Consumes:** domain schemas (F03).
**Produces:** `AsOfQuery`, `CoverageWindow`, `CoverageGap`, the retention policy enforcement,
the look-ahead guard.
**Must not redefine:** `CalculationArtifact` (F05), provider contracts (F04).

```ts
type CoverageWindow = {
  axis: 'reddit' | 'x' | 'substack' | 'market'
  startedAt: string              // the coverage floor for this axis
  gaps: CoverageGap[]
  lastObservedAt: string
}

type CoverageGap = {
  from: string; to: string
  reason: 'collector_down' | 'provider_outage' | 'quota_exhausted' | 'budget_denied' | 'unknown'
  permanent: true                // D-16: there is no backfill. Every gap is permanent
}
```

`permanent: true` is a literal, not a flag. Under forward-only collection there is no other kind.

## 4. Build spec

### 4.1 Bitemporality

Every social and market fact carries `observed_at` (when it was true) and `ingested_at` (when we
learned it). Never overwrite; insert a successor
(`../02-ARCHITECTURE-CONTRACTS.md` §5).

**This is not a convention here. It is the mechanism that makes Tier D4 possible.** A backtest
that reads a fact by `observed_at` without bounding `ingested_at` sees information that did not
exist at the time, and its IC is meaningless.

### 4.2 The look-ahead guard

Every historical read goes through one function:

```ts
asOf<T>(query: AsOfQuery<T>, asOfInstant: string): Promise<T>
```

It bounds **both** `observed_at <= asOfInstant` and `ingested_at <= asOfInstant`. A repository
method that reads a bitemporal table outside `asOf` is a **lint failure**, not a review
suggestion — the same enforcement class as "no LLM import in an analytics module" (F01).

**A test must prove the guard fires**, in the pattern finsent established: construct a fact whose
`ingested_at` is after the as-of instant, assert it is excluded, and assert the test fails if the
guard is removed. A guard with no test proving it fires is decoration.

### 4.3 Retention (D-17)

| Class | Policy |
|---|---|
| Normalized social corpus + derived scores | **Permanent** |
| Reddit, Substack item bodies | **Full bodies, permanent** |
| X items | Post ID + derived scores + **bounded snippet** (the canonical scoring unit); re-hydrated on demand; upstream deletions honoured |
| Raw sanitized provider payloads | 7 days (0 where rights forbid) |
| Calculation artifacts | 90 days, except those referenced by a claim, an open issue, **or a Tier D4 record** — those are permanent |
| Market and price series | Permanent (backtest inputs) |

**A retention job that would delete a normalized social row fails closed and alerts.** Under D-16
that deletion is unrecoverable, and the rolling 90-day delete this supersedes would have
destroyed the corpus one day at a time while every test stayed green.

### 4.4 Coverage gaps

The collector heartbeats. A gap between heartbeats beyond a threshold writes a `CoverageGap`.

**Binding rendering rules:**

- Every historical view carries its **coverage floor**: *"coverage begins {startedAt}"*.
- Where axes have different floors — X in particular, since it is trigger-sampled and may start
  later — the view shows **per-axis floors**. A cross-platform historical comparison that hides a
  coverage asymmetry is dishonest, and this is the mechanism that prevents it.
- **A series is never interpolated across a gap.** It renders discontinuous, with the gap
  labelled and its reason shown.
- A metric whose window overlaps a gap declares `eligibility: 'insufficient_data'` rather than
  computing over the hole.

### 4.5 Growth measurement

A measured MB/month figure per class, reported to `../PROGRESS.md` and re-measured quarterly.
Projection at the D-15 universe is ~120–180 MB/month. This **replaces** F-07's fixed
`< 300 MB` ceiling, which is the wrong instrument for a corpus designed to grow forever.

## 5. Test plan

| Level | Cases |
|---|---|
| Unit | `asOf` bounds both columns; gap detection at threshold boundaries; coverage-floor computation with divergent per-axis starts |
| Contract | `CoverageWindow` / `CoverageGap` schemas; every bitemporal table has both columns and both are non-null |
| Integration | A fact ingested late is invisible to an earlier as-of read; the retention job refuses to delete a normalized social row; a heartbeat gap produces a `CoverageGap` |
| E2E | A historical view renders per-axis coverage floors and a labelled discontinuity across a seeded gap |
| Feature-specific | **Look-ahead test:** the guard excludes late-ingested facts, **and the test fails if the guard is removed**. **Retention test:** the delete path fails closed on the social corpus. **Lint test:** a repository method reading a bitemporal table outside `asOf` fails the build |

## 6. Definition of Done

- [ ] Every social and market fact carries non-null `observed_at` and `ingested_at`.
- [ ] All historical reads go through `asOf`; a bitemporal read outside it is a lint failure with a test proving the lint fires.
- [ ] The look-ahead guard has a test proving it fires, and that test fails when the guard is removed.
- [ ] The retention job fails closed on the normalized social corpus and alerts.
- [ ] Full bodies are retained for Reddit and Substack; X stores ID + scores + bounded snippet, with the snippet as the canonical scoring unit.
- [ ] Coverage gaps are detected, recorded with a reason, and `permanent: true`.
- [ ] Historical views render per-axis coverage floors; a series is never interpolated across a gap.
- [ ] A metric whose window overlaps a gap returns `insufficient_data`, not a value.
- [ ] Storage growth is measured in MB/month per class and recorded in `../PROGRESS.md`.
- [ ] The collector start date is recorded once, immutably, and is what the coverage floor reads.

## 7. PR review steps

1. **Delete the look-ahead guard and run the test suite.** If it stays green, the guard is decoration and the PR does not merge.
2. Try to read a bitemporal table without `asOf`. The lint must stop you.
3. Attempt to delete a normalized social row through the retention path. It must fail closed.
4. Seed a coverage gap and confirm the historical view renders it discontinuously with its reason.
5. Set two axes to different start dates; confirm both floors render, not just the earliest.
6. Confirm `permanent: true` is a literal in the type, not a computed flag.
7. Check the measured growth figure is real, not projected, and is in `PROGRESS.md`.

## 8. Risks and open questions

| Risk | Mitigation / owner |
|---|---|
| **A collector outage is permanent data loss** | Heartbeat + alert (F18); Tier A criterion A10 sets ≥ 99% weekly uptime; the gap is recorded and rendered rather than hidden. This risk cannot be eliminated under D-16, only made visible |
| Bitemporal queries are slow as the corpus grows | Index on `(subject, observed_at, ingested_at)`; the growth measurement is the early warning; partition by month if the projection demands it |
| Someone "cleans up" the corpus to save space | The retention job fails closed and this DoD is explicit. `MEMORY.md` D-17 records why, in the words a future reader needs: **the corpus is the asset, not retained data** |
| X's deletion obligations conflict with permanence | Only the bounded snippet is retained for X, and upstream deletions are honoured. Those rows become unre-scoreable and are marked so, rather than silently dropped from a series |
| The coverage floor is set from a mutable config value | The collector start date is written once, immutably, on first collection, and read from there — never from config |
