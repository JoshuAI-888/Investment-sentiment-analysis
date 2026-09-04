# F05 — Calculation Kernel and Inspector v1

> **Amended 2026-09-03 by the re-lock.** Unchanged in substance — this remains the crown jewel of the package. Three amendments: **F-07's `< 300 MB` storage gate is superseded** by a measured **growth-rate budget in MB/month** (a fixed ceiling is the wrong instrument for a corpus that is permanent by design, D-17); **artifacts admitted to a Tier D4 record are retained permanently**, alongside those referenced by a claim or an open issue; and **the walking skeleton it completes is a different slice** (§1) — `03-ROADMAP.md` re-cut Wave 1 to a path that crosses the scoring boundary and the PIT store, which the old ApeWisdom slice never touched.
> See `../MEMORY.md` §1b for the decisions and `../SPEC-REVIEW.md` for the reasoning.

**Wave:** 1 · **Lane:** **SPINE** · **Estimate:** 22–28 h · **Depends on:** F03, F04

## 1. Purpose

The spine of the product's trust story, and the reason the timeline was re-baselined. Every
number the user sees is produced by a registered method, captured as an immutable artifact
with its inputs, ordered steps, exact decimal and hash, and can be replayed against frozen
inputs to prove it. Built **once, as shared infrastructure, in Wave 1** — retrofitting it in
Wave 4 is how it gets silently dropped.

This feature also completes the walking skeleton. **That slice changed under the re-lock**
(D-12, D-13, D-16): it is now

> Reddit collection → PIT store → **pinned scorer** (F20) → `attention.mention_rate` →
> artifact → rendered value → Inspector page → replay.

The old slice was `ApeWisdom → snapshot → rank_change → …`. It was replaced for a structural
reason, not a cosmetic one: it crossed **no** process boundary and **no** point-in-time read, so
it proved the kernel worked in the one configuration the production system never runs in. The
replacement traverses both — a network hop to a service that can be down (F20) and a historical
read that can look ahead (F22). Those are exactly the two places a trust story breaks, and a
skeleton that avoids them is a skeleton that passes while the product is broken.

## 2. Scope

**In:** the decimal artifact builder; canonical hashing; the method registry; assumption
resolution and bounds validation; frozen replay; artifact persistence; the canonical
`/calculations/[calculationId]` page and its intercepted drawer; the `InspectableMetric`
component; **one** registered method (`attention.rank_change`) end to end; the storage
projection re-measured against real artifacts.

**Out:** the rest of the analytics methods (F06); valuation methods (F13); personal
assumption *persistence*, sharing, issue queue (F14 — F05 provides the resolution mechanism
and the official path only); the searchable catalogue at `/architecture/calculations` (F17).

## 3. Contracts

**Produces:** `CalculationArtifact`, `MethodRegistryEntry`, `buildArtifact()`,
`persistArtifact()`, `replay()`, `resolveAssumptions()`, `InspectableMetric`
(`../02-ARCHITECTURE-CONTRACTS.md` §4.2–4.3). Every later feature depends on these.
**Must not redefine:** the calculation tables (F03).

## 4. Build spec

### 4.1 Decimal discipline

All arithmetic through a decimal library (`decimal.js` or equivalent), configured once with
the registry's working precision. **A raw JS `number` in `analytics/` or `calc/` is a lint
failure** (rule from F01). Values cross the boundary as decimal strings, never as floats,
including through JSON.

### 4.2 The artifact builder

```ts
buildArtifact({
  methodId, methodVersion, subject, asOf,
  inputs,            // each with value, unit, source, provenance
  assumptions,       // resolved per the precedence chain
  compute,           // (ctx) => { steps, exact }
  registry,
}): CalculationArtifact
```

The compute function **emits its steps as it computes** — the trace is a byproduct of the
calculation, not a parallel narration written afterwards. This is the only way the number and
its explanation cannot diverge, and it is the invariant this whole feature exists to protect.

Each step: `{ index, label, expression, substituted, exactValue, unit }`.

### 4.3 Canonical hashing

`inputHash` = SHA-256 over a canonical serialization of `{inputs, assumptions, methodId,
methodVersion}`: keys sorted, decimals in a fixed exact form, timestamps in UTC ISO-8601 with
fixed precision, no floats, no locale. `resultHash` = SHA-256 over `result.exact`.

The canonicalization function has its own unit tests, including: key reordering produces an
identical hash; `1.10` and `1.1` produce an identical hash; a differing timezone
representation of the same instant produces an identical hash.

### 4.4 Method registry

`MethodRegistryEntry` per `../02-ARCHITECTURE-CONTRACTS.md` §4.3, stored in code (versioned,
reviewable) and projected into the database for the Inspector and the Explorer to read.

`editableAssumptions` is the **sole runtime description** of what a user may change. The
server validates an override against the registry **and** a second code-level allowlist — a
database value can never make a prohibited parameter editable.

`limitations[]` is where F-03's selection-bias disclosure lives for stance methods. It renders
in the Inspector's assumptions block. It is not optional copy.

### 4.5 Assumption resolution

Exactly the precedence chain in `../02-ARCHITECTURE-CONTRACTS.md` §6. Official scheduled
materialisation ignores personal assumptions entirely. A personal result is computed lazily
from an official snapshot's eligible frozen inputs — **no provider call in the scenario
path**, which is what makes the official/personal comparison apples-to-apples.

### 4.6 Replay

`replay(calculationId)` re-runs the method against the artifact's **frozen** inputs and
assumptions and compares hashes. Outcomes:

| Outcome | Meaning | Behaviour |
|---|---|---|
| `match` | code and data agree | recorded in `calculation_validation_run` |
| `result_mismatch` | same inputs, different result ⇒ **the code changed without a version bump** | recorded, surfaced in the Inspector and to the admin, **history never repaired in place** |
| `method_missing` | the method version no longer exists | recorded; the artifact remains readable |

Replay is an explicit validation action, never something that happens when a page opens
(source §18.2's ruling, which this feature implements).

### 4.7 Artifact granularity (F-07, binding)

One artifact per **computation invocation**. A 180-point series is one artifact with a
`points[]` derivation table; a chart point is addressed `{calculationId, pointIndex}` and the
Inspector resolves it. Retention: 90 days, except artifacts referenced by a claim, share
grant or open issue, which are `retention_class = 'permanent'`.

### 4.8 The Inspector

`/calculations/[calculationId]` — a Server Component, plus the intercepted drawer route and
the parallel-slot default from source §6.2. Sections, all generic across every method:

1. **Summary** — subject, method, version, as-of, eligibility, exact value, display value.
2. **Formula** — symbolic from the registry, then substituted with this artifact's values.
3. **Inputs and provenance** — normalized value, provider field, source, `observed_at`,
   staleness, and (for entitled users, F14) a link to the rights-sanitized fragment.
4. **Trace** — ordered steps with expression, substitution and exact value.
5. **Precision** — exact decimal alongside the display value and the named rounding rule.
6. **Assumptions** — official values, bounds, and the registry's `limitations[]`.
7. **Validation** — last replay outcome, with a button to run one.

`InspectableMetric` is the single component every displayed deterministic value uses. It
renders the value, the display rounding, and the link. **A number rendered without it fails
`check:calc-coverage`.**

## 5. Test plan

| Level | Cases |
|---|---|
| Unit | decimal arithmetic exactness; canonicalization invariance (key order, decimal form, timezone); hash stability across process restarts; bounds validation rejects out-of-range, non-registered, and registry-permitted-but-code-forbidden keys; precedence chain resolves in the documented order |
| Contract | artifact ↔ database round-trip preserves exact decimals byte-for-byte; `points[]` survives serialization |
| Integration | full slice: Reddit fixture → PIT store → pinned scorer (F20) → `attention.mention_rate` → artifact persisted → replay returns `match`; a deliberate code change without a version bump produces `result_mismatch` and does **not** rewrite the stored artifact; **the scorer identity is inside the hashed inputs**, so swapping the pinned revision alone produces `result_mismatch` |
| E2E | a rendered metric links to its Inspector; the drawer intercepts and the canonical page works on direct navigation and on reload; every Inspector section renders for the `rank_change` artifact; a `not_applicable` artifact renders its reason rather than a blank |
| Feature-specific | storage projection re-measured against **real** artifacts at 100 symbols × 180 days; recorded in `../PROGRESS.md` |

## 6. Definition of Done

- [ ] No JS `number` is used for arithmetic in `calc/` or `analytics/`; the lint rule proves it.
- [ ] Steps are emitted by the computation, not narrated after it — verified by reading the
      builder, and by a test that a step list cannot be produced without the value.
- [ ] Canonical hashing is invariant to key order, decimal representation and timezone form.
- [ ] The method registry is the sole source of editable assumptions, backed by a second
      code-level allowlist; a database-only "editable" flag is rejected by a test.
- [ ] `replay()` returns `match` for a clean artifact and `result_mismatch` for a changed
      method, and **never** mutates the stored artifact.
- [ ] Artifact granularity follows F-07: one artifact per invocation, `points[]` for series.
- [ ] Retention classes are set, and a claim/share/issue reference promotes an artifact to
      `permanent`.
- [ ] The Inspector renders all seven sections generically for `attention.rank_change`.
- [ ] `InspectableMetric` exists and is the only path by which a deterministic value renders.
- [ ] `check:calc-coverage` is no longer a stub: it fails on a metric rendered without a
      registered method.
- [ ] Storage projection at 100 symbols measured against real artifacts and **< 300 MB**.
- [ ] The Wave 1 walking slice works against **live** ApeWisdom, and its replay verifies.

## 7. PR review steps

1. Read `buildArtifact` first. Can a step list be constructed that does not correspond to the
   computed value? If yes, the feature has failed at its one job.
2. Grep `calc/` and `analytics/` for `Number(`, `parseFloat`, `+`/`*` on non-decimals.
3. Try to make a non-registered assumption editable via a database row; confirm rejection.
4. Change a method's arithmetic without bumping its version; confirm `result_mismatch` and
   that the stored artifact is untouched.
5. Open the Inspector on a `not_applicable` artifact — is the reason legible to a non-engineer?
6. Read the storage projection arithmetic independently.

## 8. Risks and open questions

| Risk | Mitigation |
|---|---|
| Trace-emitting compute functions are awkward to write | The pattern is established once here for every later method; the awkwardness is the point — it prevents divergence |
| Artifact volume still too large after F-07 | The measured gate at the end of Wave 1; revisit granularity before Wave 2 rather than after the tables fill |
| The Inspector becomes method-specific under pressure | Reviewer check: every section reads the registry and the artifact; zero method names appear in the Inspector's code |
| Hash instability across Node versions | Canonicalization tests run in CI on the pinned runtime; hash inputs contain no engine-dependent formatting |
