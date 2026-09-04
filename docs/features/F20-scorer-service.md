# F20 — Pinned Scorer Service and Scoring Queue

**Wave:** 1 · **Lane:** COLLECT · **Estimate:** 14–18 h ·
**Depends on:** **service half — nothing.** Queue-and-persistence half — F01, F03
**Status:** see `../PROGRESS.md` (this file never records status)

> **Corrected 2026-09-03 by the pre-build audit.** This line read `Depends on: F01, F03` for
> the whole feature, which contradicted the D-24 carve-out that `../06-PARALLEL-LANES.md` §1b
> and `../progress/collect.md` both rest on. It matters more than a stale field: `04-BUILD-LOOP.md`
> §2.1 SELECT picks features whose dependencies are `merged`, so an agent reading the old line
> would have correctly refused to start F20 until F03 merged — and the carve-out exists
> precisely to get scoring built *before* then, because under D-16 an earlier collector is the
> one thing in this plan that cannot be bought back later. The split below is the test F-11
> actually sets: does this half consume a domain contract F03 has not yet proven?

| Half | Depends on | Why |
|---|---|---|
| **Service** — container, pinned models, HTTP contract (§3), determinism test, its own CI lane | **nothing** | Its own language and deploy target. The §3 contract depends on nothing in `src/`. Start it the day the build starts |
| **Queue and persistence** — worker, `scorer_id`/`scorer_version`/`scorer_provenance` columns, re-score path, outage→abstention wiring | F01, F03 | Consumes raw item rows and writes domain tables 
**Decision:** `../MEMORY.md` D-13. **Breaks** `../02-ARCHITECTURE-CONTRACTS.md` §1's former
"Forbidden in P0: any Python service, any local model runtime" — a named, narrow exception.

## 1. Purpose

Every stance score in the corpus is produced by a model **pinned to a commit SHA**, is
reproducible indefinitely, and carries the identity of the scorer that produced it. Collection
never waits on scoring, and a scorer outage never substitutes a different method's number for a
missing one — it abstains.

**Why this exists, and it is not cost.** A hosted LLM classifier cannot back a historical series:
model IDs retire, and when the model behind the 2026 scores is gone those scores cannot be
reproduced, re-derived under a corrected method, or compared like-for-like with a successor's.
Every `CalculationArtifact` over that series becomes unverifiable at exactly the moment a Tier D4
backtest asks whether the series means anything.

## 2. Scope

**In:** the scorer service (FinBERT for long-form prose, Twitter-RoBERTa for short social text,
both pinned); its HTTP contract; the scoring queue and worker; `scorer_id` / `scorer_version` /
`scorer_provenance` persistence; the re-score path writing successor artifacts; the outage →
abstention behaviour; the service's own CI lane and fixture set; a deterministic-output test.

**Out:** the LLM relevance and ticker-collision methods (F10 owns them, D-21); aggregation
arithmetic (F06); what a score *means* on each axis (F10, R-21); the capacity fallback **path**
— only its `scorer_provenance` column is provisioned here.

## 3. Contracts

**Consumes:** `ProviderResult<T>` shape for the service call (F04's wrapper is reused — the
scorer is treated as a provider); raw item rows (F03).
**Produces:** `ScoreResult`, `ScorerIdentity`, the queue interface, the re-score job contract.
**Must not redefine:** `CalculationArtifact` (F05), domain schemas (F03).

```ts
type ScorerIdentity = {
  scorerId: string          // 'finbert' | 'tweet-roberta'
  scorerVersion: string     // '<hf-repo>@<commit-sha>' — never a tag, never 'latest'
  runtimeVersion: string    // service image digest
}

type ScoreResult = {
  itemId: string
  label: 'bullish' | 'bearish' | 'neutral'
  scores: { bullish: DecimalString; bearish: DecimalString; neutral: DecimalString }
  scorer: ScorerIdentity
  scoredAt: string          // ISO-8601 UTC
  inputHash: string         // hash of the exact text scored, after truncation
  truncated: boolean        // true if input exceeded the model's window
}
```

`scores` are decimal strings, never JS numbers — `../02-ARCHITECTURE-CONTRACTS.md` §4.2.

## 4. Build spec

### 4.1 The service

One small container (Fly / Railway / Modal). Python. It lives at **`services/scorer/`** — a
sibling of `apps/web/`, not a subdirectory of it.

**The path is part of the contract, not a preference.** F01 §4.4b's CI job is *keyed on this
path*. If the service is built somewhere else, that job's path filter never matches, the lane
goes green by never running, and the one guarantee this feature exists to provide — determinism,
Tier D2 — is gated by nothing. This is the specific failure mode of building the service and its
CI lane in two places at once, so the path is fixed here rather than chosen at build time.

Two models, both loaded at boot from the Hugging Face hub **by commit SHA**, never by tag:

| Model | Used for | Window |
|---|---|---|
| `ProsusAI/finbert@<sha>` | Substack prose, long Reddit posts | 512 tokens |
| `cardiffnlp/twitter-roberta-base-sentiment-latest@<sha>` | X snippets, short Reddit comments | 512 tokens |

**A boot assertion fails the service if either revision is a tag, a branch, or absent.** An
unpinned model silently breaks the one property this feature exists to provide.

`POST /score` takes a batch of `{itemId, text, kind}` and returns `ScoreResult[]`. Stateless. No
database access. Deterministic: fixed seed, eval mode, no sampling, batch size does not change
outputs (this is tested — see 5).

**Truncation is recorded, not hidden.** Text exceeding the window is truncated to the window and
`truncated: true` is set. `inputHash` hashes the **truncated** text, so a re-score of the same
stored body reproduces the same hash.

### 4.2 The queue

Redis list, Postgres mirror for durability. Producer is the collector (F04); consumer is a worker
in the web app's runtime.

**Binding rules, from D-13:**

1. **The collector never blocks on the scorer.** It writes the raw item and enqueues. A scorer
   outage grows the backlog; it does not stop collection or lose data.
2. **No silent substitution.** When the queue is not draining, dependent metrics render §6.3
   abstention and F18's degraded mode — *"no stance — scorer unavailable since {ts}"*. A number
   from another method is never written in place of a missing one.
3. Backlog depth and oldest-unscored age are operator-visible counters (F15, F18).
4. Re-scoring writes a **successor artifact**, per §4.2. Nothing is recomputed in place.

### 4.3 Persistence

Every score row carries `scorer_id`, `scorer_version`, `runtime_version`, `input_hash`,
`truncated`, and `scorer_provenance`.

`scorer_provenance` ∈ `'pinned' | 'capacity_fallback'`. **v1 only ever writes `'pinned'.'** The
column exists so that if D-13's capacity fallback is ever built, the rows it produces are
distinguishable from the first day rather than retrofitted — and so Tier D3's "no series mixes
scorers" check has something to read.

### 4.4 Re-score

A job that re-scores a bounded set of items under a new pinned revision, writing successors and
leaving predecessors intact.

**Re-scoreability by source (D-17):**

| Source | Re-scoreable from | Note |
|---|---|---|
| Reddit | Full body | Indefinitely |
| Substack | Full body | Indefinitely |
| X | **Bounded snippet** | The snippet is X's canonical scoring unit, so the X series stays self-consistent. Posts deleted upstream and purged are the one unrecoverable case |

## 5. Test plan

| Level | Cases |
|---|---|
| Unit | Decimal parsing of model outputs; truncation boundary at exactly the window; `inputHash` stability across whitespace-identical inputs |
| Contract | `ScoreResult` zod schema; boot assertion rejects a tag, a branch, an empty revision; service rejects a batch item missing `kind` |
| Integration | Queue drains; a killed service grows the backlog and loses nothing; restart resumes; re-score writes a successor and leaves the predecessor intact |
| E2E | Collector → queue → scorer → scored row → analytics → `CalculationArtifact` → Inspector → replay reproduces the hash |
| Feature-specific | **Determinism:** the same 200 fixture items scored twice, and scored again at a different batch size, produce byte-identical `scores`. **Outage:** service down ⇒ dependent metric renders abstention, never a substituted number. **Provenance:** a series containing two `scorer_version` values is rejected by the Tier D3 check |

## 6. Definition of Done

- [ ] Both models load by commit SHA; a boot assertion fails on a tag, branch or absent revision, and is tested.
- [ ] Identical stored inputs reproduce byte-identical scores across runs **and across batch sizes** (Tier D2).
- [ ] Every score row carries `scorer_id`, `scorer_version`, `runtime_version`, `input_hash`, `truncated`, `scorer_provenance` (Tier D3).
- [ ] Collection continues and loses nothing while the scorer is down; the backlog drains on recovery.
- [ ] A scorer outage renders §6.3 abstention on dependent metrics — verified by taking the service down in an integration test, not by inspection.
- [ ] Re-score writes a successor artifact; the predecessor remains readable and hash-verifiable.
- [ ] The service has its own CI lane, its own fixtures, and runs in CI with no network access to Hugging Face (models are cached in the image).
- [ ] `scorer_provenance` is provisioned and only ever `'pinned'` in v1.
- [ ] The pinned SHAs are recorded in versioned config and in `../PROGRESS.md`.

## 7. PR review steps

1. **Are both revisions commit SHAs?** Not tags. Not `main`. This is the whole feature.
2. Does the boot assertion actually fail, with a test proving it?
3. Run the determinism test twice at two batch sizes. Byte-identical, or the feature is not done.
4. Kill the service mid-integration-run. Confirm: no data loss, backlog grows, dependent metric abstains, **no substituted number anywhere**.
5. Confirm no raw JS `number` touches a score anywhere in the path.
6. Confirm the scorer is never called on a user request path — it is queue-driven only.
7. Confirm re-score writes a successor and does not mutate.

## 8. Risks and open questions

| Risk | Mitigation / owner |
|---|---|
| GPU/CPU nondeterminism across hosts changes scores after a redeploy | Pin the runtime image digest as well as the model SHA; CPU inference; the determinism test runs in CI on the same image. `runtime_version` is recorded so a change is visible rather than silent |
| The service becomes a second deploy target nobody maintains | It is in CI from F01. A red scorer lane blocks merges exactly like the web lane |
| Queue backlog during a high-volume event delays every dependent metric | Abstention is correct behaviour, not a failure. The capacity fallback hook exists (`scorer_provenance`) but is deliberately not built in v1 |
| Truncation quietly degrades long Substack essays | `truncated` is recorded and surfaced in the Inspector. D-21 defers the long-form method with a named trigger: measured error attributable to truncation |
| Model files bloat the image | Cache in the image deliberately — CI must not depend on Hugging Face availability, and a fetch at boot reintroduces the unpinned-drift risk this feature exists to remove |
