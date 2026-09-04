# F03 — Persistence and Domain Contracts

> **RNI scope:** `RNI-00-CONTRACT.md` adds forward migrations `0020–0024`, bounded source-first
> evidence and per-security observations. Do not edit F03's historical migrations or seed.

> **Amended 2026-09-03 by the re-lock.** **D-12:** the ingest half is redesigned for three social axes plus intraday market data. The *conventions* — surrogate keys, bitemporal `observed_at`/`ingested_at`, decimal as `numeric`, append-only — are unchanged and correct. **D-17: the 90-day normalized retention is superseded for social data.** Under forward-only collection a rolling delete means the corpus never exceeds 90 days and D-09's promotion path can never run. **The normalized social corpus and its derived scores are permanent.** **F22 owns** the PIT guard, the coverage-gap model and retention enforcement; this feature owns the tables they act on. Neon **Launch**, not Free.
> See `../MEMORY.md` §1b for the decisions and `../SPEC-REVIEW.md` for the reasoning.

**Wave:** 1 · **Lane:** **SPINE** · **Estimate:** 14–18 h · **Depends on:** F01

## 1. Purpose

The 27 tables, the zod contracts that describe them, and the repositories that are the only
place SQL lives. Everything downstream depends on getting the keys, the temporality and the
append-only guarantees right, because these are the decisions that are expensive to change
after Wave 2.

## 2. Scope

**In:** migrations for all 27 tables in source §7.2; zod domain contracts; repositories with
append-only enforcement; the security-master bootstrap; the idempotent 30-symbol seed; the
single-active-version constraint; the storage projection measurement (F-07).

**Out:** provider-specific response schemas (F04 owns those, in `adapters/`); the artifact
*builder* (F05 owns it — F03 owns only its tables); admin UI (F15).

## 3. Contracts

**Produces:** every domain zod schema; every repository interface; the migration baseline.
**Consumes:** `../02-ARCHITECTURE-CONTRACTS.md` §4 shapes.
**Must not redefine:** `ProviderResult` (F04) or `CalculationArtifact` semantics (F05) — F03
persists them, it does not decide them.

## 4. Build spec

### 4.1 Conventions (binding, from `../02-ARCHITECTURE-CONTRACTS.md` §5)

- **Surrogate keys only.** `security.id uuid` is the key. Symbol is an attribute with
  validity dates. **Ticker text is never a primary or foreign key anywhere** — a symbol is
  reassignable, and a reassignment must not silently rewrite history.
- **Bitemporal:** every snapshot table carries `observed_at` (when the fact was true) and
  `ingested_at` (when we learned it), both `timestamptz`, both UTC.
- **`numeric`, never float**, for anything a user sees.
- **Append-only** enforced at the database level (revoke UPDATE/DELETE, or a trigger) on:
  `calculation_snapshot`, `calculation_input`, `calculation_step`,
  `calculation_validation_run`, `claim_ledger`, `audit_event`, `cost_event`,
  `research_event`, `config_version`, `universe_version`.
- Every table has `created_at`; nothing has a bare `updated_at` on an append-only table.

### 4.2 Tables

All 27 from source §7.2, unchanged in name and purpose:

`security`, `security_profile_snapshot`, `market_snapshot`, `price_return_snapshot`,
`valuation_snapshot`, `attention_snapshot`, `evidence_item`, `sentiment_snapshot`,
`calculation_snapshot`, `calculation_input`, `calculation_step`, `user_assumption_profile`,
`calculation_share`, `calculation_issue`, `calculation_validation_run`, `research_run`,
`research_event`, `claim_ledger`, `provider_call_log`, `config_version`, `universe_version`,
`model_route`, `provider_policy`, `job_definition`, `raw_provider_payload`, `cost_event`,
`audit_event`.

Amendments from the review:

- `attention_snapshot` gains `provider_methodology_version text not null` (F-05). Rank-change
  across a methodology-version boundary is suppressed, not computed.
- `evidence_item` gains `last_checked_at timestamptz`, `availability` enum (F-19).
- `research_run.state` includes `degraded`, `verification_failed`, `retracted`, and
  `retracted_reason` / `retracted_by` / `retracted_at` (F-10, F-20).
- `calculation_snapshot` gains `points jsonb` for series artifacts and
  `retention_class` enum (`standard` | `permanent`) (F-07).
- `cost_event.cost_usd` is **nullable**, and `null` means unpriced. There is no zero default.

### 4.3 Active-version constraint

At most one active `config_version` and one active `universe_version` per environment,
enforced by a partial unique index — not by application logic. Activation is a transaction:
deactivate the current, insert/activate the successor, write the `audit_event`. A failed
activation leaves the previous version active.

### 4.4 Security master and seed

- `security` is bootstrapped from FMP's symbol list (F04 provides the adapter; F03 provides
  the loader and the table). US equities and ETFs, with eligibility flags.
- The 30-symbol seed (source §14.3) is an **idempotent database seed script**, not an
  environment variable, and it runs **only when no `universe_version` exists**. A
  redeployment must never reinsert a symbol an admin removed — asserted by a test.

### 4.5 Storage projection (F-07, gate)

A script that, given the artifact granularity rule, projects total storage at 100 active
symbols with 180 days of history across all planned method types, and prints the breakdown.
Wave 1's exit gate requires the result under 300 MB. If it exceeds that, the granularity
rule is revisited **before Wave 2 starts**, not after the tables fill.

## 5. Test plan

| Level | Cases |
|---|---|
| Unit | every zod schema round-trips its table row; rejects a malformed value per field |
| Contract | serialization parity: DB row → domain object → DB row is byte-identical for decimals and timestamps |
| Integration | append-only tables reject UPDATE and DELETE; partial unique index rejects a second active version; activation transaction rolls back cleanly on failure; seed is idempotent across three runs; seed does **not** reinsert a removed symbol; bitemporal insert never overwrites |
| E2E | — |
| Feature-specific | storage projection script runs and reports; a symbol reassignment (same ticker, new `security.id`) leaves prior snapshots correctly attributed |

## 6. Definition of Done

- [ ] All 27 tables migrated, with the review amendments applied.
- [ ] Ticker text appears as no table's primary or foreign key — verified by a schema query
      in a test, not by inspection.
- [ ] Every snapshot table is bitemporal and every user-visible number is `numeric`.
- [ ] Append-only enforcement is at the database level and proven by a failing write test.
- [ ] Exactly one active config version and one active universe version can exist.
- [ ] Seed is idempotent and never resurrects an admin-removed symbol.
- [ ] `cost_event.cost_usd` is nullable with no zero default.
- [ ] Storage projection runs and reports **< 300 MB** at 100 symbols; the number is recorded
      in `../PROGRESS.md`.
- [ ] Repositories are the only modules containing SQL — enforced by lint.

## 7. PR review steps

1. Read every migration for a ticker-as-key, a float column, or a missing `observed_at`.
2. Attempt an UPDATE against each append-only table in a psql session.
3. Run the seed three times against a populated database; diff the row counts.
4. Delete a seed symbol, re-run the seed, confirm it stays deleted.
5. Read the storage projection output; sanity-check the arithmetic yourself.
6. Grep for SQL outside `repositories/`.

## 8. Risks and open questions

| Risk | Mitigation |
|---|---|
| 27 tables in one PR is a large diff | Split into three PRs by concern (core/calc/control-plane) if it exceeds reviewable size; dependency order is core → calc → control-plane |
| Neon connection limits under Vercel functions | Pooled connection string; connection reuse asserted in an integration test |
| Storage growth is permanent under D-17, not a rolling window | **Neon Launch, not Free** (D-17) — the free 0.5 GB is exhausted in roughly three to four months at the projected 120–180 MB/month. The instrument is a growth-rate budget in MB/month recorded in `../PROGRESS.md`, not a fixed ceiling |
| Append-only via revoked grants complicates local dev | Use a trigger-based guard so it behaves identically locally and in CI |
