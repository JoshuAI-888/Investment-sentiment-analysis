# RNI DATA Workstream Progress

**Writer:** DATA builder only  
**Branch:** `feat/rni-data-source-first`  
**Depends on:** merged RNI contract-freeze SHA  
**Status:** `IN_PROGRESS`

## Owned paths

See `../RNI_BUILD_LOOP.md` §3.2. Any path outside that list requires a contract request.

## Tasks

| ID | Task | Status | Acceptance evidence |
|---|---|---|---|
| D01 | Canonical `rni_source_item` and retrieval/content tables | `READY_FOR_REVIEW` | Migration `0020`; 7 PostgreSQL repository/constraint tests pass |
| D02 | Source-security links and four-dimension observations | `READY_FOR_REVIEW` | Migration `0021`; multi-ticker and four-dimension tests pass |
| D03 | Claims, citations, themes, narratives and relationships | `BLOCKED` | Relational lineage 4/4 pass; pgvector and frozen ports await CR-DATA-002/003 |
| D04 | Independent Reddit/X `run_source_slice` persistence | `READY_FOR_REVIEW` | Migration `0023`; exactly-two platform isolation 4/4 pass |
| D05 | Cross-source summary persistence without component mutation | `READY_FOR_REVIEW` | Divergence/partial repository tests 4/4 pass |
| D06 | Idempotent/concurrent inserts and transactional outbox | `READY_FOR_REVIEW` | 8-way concurrent upsert and outbox rollback 3/3 pass |
| D07 | Bounded-content, tombstone and rejected-discovery states | `READY_FOR_REVIEW` | Tombstone/rejected-page tests 3/3 pass |
| D08 | FMP >500-member fixture support for integration migration   | `NOT_STARTED` | Valid/invalid atomic activation fixtures |
| D09 | Full DATA lane verification and handoff | `NOT_STARTED` | Report contract completed |

## Task evidence

### D01 — Canonical source, retrieval and content versions

- **Status:** `READY_FOR_REVIEW`
- **Files:** `apps/web/migrations/0020_rni_sources.sql`,
  `apps/web/src/rni/repositories/source-items.ts`,
  `apps/web/tests/integration/rni-persistence/source-items.test.ts`, and this progress file.
- **Tests:** `tsc --noEmit -p apps/web/tsconfig.json`; targeted ESLint; Vitest against a
  disposable PostgreSQL database (`7/7` passed); `git diff --check`.
- **Result:** canonical source identity is unique by platform/external ID and platform/URL;
  original URLs are retained; retrievals and changed bounded content are append-only; invalid
  platform provenance and whole-page HTML fail at database boundaries.
- **Risk:** CR-DATA-001 is additive but required before ENGINE can bind to the concrete adapter
  through a frozen port. D06 still owns the concurrent-upsert/outbox proof.
- **Handoff:** coordinator may review migration/repository semantics independently; no external
  service or credential is required.

### D02 — Source-security links and observations

- **Status:** `READY_FOR_REVIEW`
- **Files:** `apps/web/migrations/0021_rni_observations.sql`,
  `apps/web/src/rni/repositories/observations.ts`,
  `apps/web/tests/integration/rni-persistence/observations.test.ts`, and this progress file.
- **Tests:** TypeScript; targeted ESLint; D02 PostgreSQL integration (`5/5`); combined D01-D02
  PostgreSQL regression (`12/12`); `git diff --check`.
- **Result:** one source persists independent NVDA/AMD links and opposing observations; all four
  frozen dimension keys round-trip; observation writes require a source-security link; natural
  identities prevent duplicate mentions and observations.
- **Risk:** classifier/model run IDs remain opaque UUID provenance because the frozen contract
  defines no model-run repository port; no shared contract was changed.
- **Handoff:** ENGINE may rely on the frozen mention/observation shapes; coordinator should review
  CR-DATA-001 before binding the persistence boundary.

### D03 — Claims, citations, themes, narratives and relationships

- **Status:** `BLOCKED` (relational slice complete; pgvector-dependent completion blocked).
- **Files:** `apps/web/migrations/0022_rni_claims_narratives.sql`,
  `apps/web/src/rni/repositories/claims-narratives.ts`,
  `apps/web/tests/integration/rni-persistence/claims-narratives.test.ts`, and this progress file.
- **Tests:** TypeScript; targeted ESLint; D03 PostgreSQL integration (`4/4`); combined D01-D03
  PostgreSQL regression (`16/16`); `git diff --check`.
- **Result:** claims, citations, themes, narrative memberships, and comparative relationships are
  append-only and foreign-keyed to persisted source/observation lineage; dangling and mismatched
  citations/claims fail closed.
- **Blocker:** first observed 2026-09-05; CR-DATA-002 (missing frozen persistence types/port) and
  CR-DATA-003 (direct pgvector requirement conflicts with deployment/integration deferral).
- **Owner / attempted mitigation / next check:** coordinator; completed and tested the unaffected
  relational schema and concrete adapter without editing frozen contracts; resolve before adding
  embedding storage or exposing the adapter to ENGINE.

### D04 — Independent Reddit/X platform slices

- **Status:** `READY_FOR_REVIEW`
- **Files:** `apps/web/migrations/0023_rni_platform_slices.sql`,
  `apps/web/src/rni/repositories/runs.ts`,
  `apps/web/tests/integration/rni-persistence/platform-slices.test.ts`, the D03 narrative FK
  regression, and this progress file.
- **Tests:** TypeScript; targeted ESLint; D04 PostgreSQL integration (`4/4`); cumulative DATA
  persistence PostgreSQL regression (`20/20`); `git diff --check`.
- **Result:** run creation is idempotent and atomic with exactly one Reddit plus one X slice;
  independent success/unavailable states round-trip unchanged; missing, duplicate, or cross-run
  slice sets fail before commit.
- **Risk:** the frozen contract does not expose the bundle-write port; covered by CR-DATA-001.
- **Handoff:** INTEGRATION can compose `getRniRunById`/`getRniPlatformSlices` behind the frozen
  `RniReadService` after accepting the write-port request.

### D05 — Cross-source summary persistence

- **Status:** `READY_FOR_REVIEW`
- **Files:** combined-summary extension in `apps/web/migrations/0023_rni_platform_slices.sql`,
  `apps/web/src/rni/repositories/summaries.ts`,
  `apps/web/tests/integration/rni-persistence/summaries.test.ts`, and this progress file.
- **Tests:** TypeScript; targeted ESLint; D05 PostgreSQL integration (`4/4`); cumulative DATA
  persistence PostgreSQL regression (`24/24`); `git diff --check`.
- **Result:** immutable combined rows reference the run's typed Reddit/X slice IDs; divergence
  and one-source-unavailable summaries preserve both component rows byte-for-byte; duplicate
  writes return the original summary.
- **Risk:** citation IDs inside the frozen section JSON remain publication-layer references;
  D03 relational claim citations are separately foreign-keyed and D03's shared port is pending.
- **Handoff:** INTEGRATION can bind `getRniCombinedSummary` to the frozen read service without
  inventing combined numeric metrics.

### D06 — Concurrent idempotency and transactional outbox

- **Status:** `READY_FOR_REVIEW`
- **Files:** outbox extension in `apps/web/migrations/0020_rni_sources.sql`, outbox integration in
  `apps/web/src/rni/repositories/source-items.ts`,
  `apps/web/tests/integration/rni-persistence/outbox-idempotency.test.ts`, and this progress file.
- **Tests:** TypeScript; targeted ESLint; D06 PostgreSQL integration (`3/3`); cumulative DATA
  persistence PostgreSQL regression (`27/27`); `git diff --check`.
- **Result:** eight concurrent duplicate deliveries converge on one source/retrieval/content/event;
  the event payload contains IDs only; a forced outbox failure rolls the entire source transaction
  back, so downstream work cannot observe uncommitted evidence.
- **Risk:** relay/queue publication is ENGINE/INTEGRATION orchestration scope; DATA exposes only
  committed pending events and immutable payload identity.
- **Handoff:** the persisted-source event is `rni.source_persisted.v1`; coordinator should include
  its return shape when resolving CR-DATA-001.

### D07 — Tombstones and rejected discoveries

- **Status:** `READY_FOR_REVIEW`
- **Files:** lifecycle/rejection extension in `apps/web/migrations/0020_rni_sources.sql`,
  `apps/web/src/rni/repositories/source-states.ts`,
  `apps/web/tests/integration/rni-persistence/source-states.test.ts`, and this progress file.
- **Tests:** TypeScript; targeted ESLint; D07 PostgreSQL integration (`3/3`); cumulative DATA
  persistence PostgreSQL regression (`30/30`); `git diff --check`.
- **Result:** source tombstones are terminal while original URL/evidence stays immutable; rejected
  discoveries retain URL/query/request provenance and reason without any page-content column;
  whole-page HTML is rejected in both adapter and database paths.
- **Risk:** physical content erasure for a legal takedown is intentionally not invented because
  the frozen `RniSourceItem` requires bounded content; a retention-policy change needs coordinator
  contract review.
- **Handoff:** SURFACE/INTEGRATION should use the terminal state for display restrictions while
  retaining the source identity and audit lineage.

## Required invariants

- One external source row, many security links and observations.
- Canonical URL is required for publishable Reddit/X evidence.
- Source transaction commits before downstream event is visible.
- Unique keys prevent duplicate sources, platform slices and observations.
- Reddit and X have different platform/source-slice identities.
- Combined rows reference but never overwrite component facts.
- No whole-page HTML or unrelated content is stored.
- No destructive rewrite of legacy `evidence_item`.

## Contract requests

| ID | Status | Request | Impact |
|---|---|---|---|
| CR-DATA-001 | `READY` | Freeze a source-persistence repository port that accepts `RniSourceItem` and returns the committed source identity plus idempotency outcome. | ENGINE persist-first workflow cannot bind to DATA without importing a DATA-private concrete adapter. |
| CR-DATA-002 | `READY` | Freeze claim, citation, theme, and narrative persistence schemas/ports. | D03 relational schema can proceed, but ENGINE integration cannot depend on DATA-private shapes. |
| CR-DATA-003 | `READY` | Reconcile the assignment's pgvector requirement with `DEPLOY.md`/`INTEGRATION_PLAN.md`, which defer pgvector for this slice. | Determines whether migration `0022` may require `vector` in preview/production. |

### CR-DATA-001 — Source-persistence repository port

- **Current behaviour:** `apps/web/src/rni/contracts/index.ts` freezes `RniSourceItem` and
  `RniReadService.getEvidence`, but exposes no write/persistence interface for the ENGINE lane's
  injected source-first workflow.
- **Requested change:** add a frozen repository port accepting a validated `RniSourceItem` and
  returning the committed source ID plus whether the source, retrieval, and content version were
  newly inserted. The concrete DATA repository will remain in `apps/web/src/rni/repositories/**`.
- **Justification:** a DATA-private interface would become an undeclared cross-lane API, while
  duplicating the interface in ENGINE would violate the ownership boundary and could drift from
  the transaction/idempotency semantics.
- **Affected lanes:** DATA, ENGINE, and INTEGRATION composition; the comparative and duplicate-
  delivery fixtures.
- **Compatibility impact:** additive only; no existing frozen schema or read-service method needs
  to change.
- **Recommended acceptance test:** a fake implementing the frozen port and the concrete DATA
  adapter both accept the same `RniSourceItem`; duplicate delivery returns the original committed
  source ID, and semantic work receives no ID until the transaction commits.

### CR-DATA-002 — Claim and narrative persistence contracts

- **Current behaviour:** the frozen contract defines `RniComparativeRelation` and a citation read
  shape, but no claim, claim-citation, theme, narrative, membership, embedding, or write-port
  schemas.
- **Requested change:** add additive frozen persistence types and one repository port for the D03
  objects required by ENGINE.
- **Justification:** DATA can enforce relational lineage privately, but ENGINE otherwise must
  import DATA-private types or duplicate them, creating an undeclared cross-lane API.
- **Affected lanes:** DATA, ENGINE, SURFACE read models, and INTEGRATION composition.
- **Compatibility impact:** additive; existing frozen source/observation/summary types remain
  unchanged.
- **Recommended acceptance test:** one claim and citation round-trip through a fake and concrete
  port; deleting or mismatching the source/claim edge fails; an opposing claim cannot join the
  same narrative membership by identity accident.

### CR-DATA-003 — pgvector deployment scope

- **Current behaviour:** this DATA assignment includes pgvector-backed narrative data, while
  `docs/rni/DEPLOY.md` §1/§4 and `docs/rni/INTEGRATION_PLAN.md` C11 explicitly defer pgvector for
  the overnight slice.
- **Requested change:** confirm that migration `0022` may enable `vector` and persist typed claim
  embeddings, or narrow the assignment to a non-vector placeholder for this release.
- **Justification:** enabling a database extension is a durable deployment prerequisite and
  cross-lane assumption; silently selecting either side would violate the build loop.
- **Affected lanes:** DATA migration/tests, ENGINE clustering, INTEGRATION Neon preview and
  deployment verification.
- **Compatibility impact:** requiring `vector` makes migration `0022` fail closed on databases
  where the extension is unavailable; deferral requires the embedding repository to abstain.
- **Recommended acceptance test:** clean migration on an ephemeral Neon branch with `vector`
  available, exact cosine query over fixed embeddings, and explicit migration failure when the
  extension prerequisite is missing.

## Test evidence

| Suite | Status | Command/run link | Notes |
|---|---|---|---|
| migration clean apply | `READY_FOR_REVIEW` | targeted D01 Vitest | Fresh schema applied through `0020`; 7/7 pass |
| migration forward apply | `NOT_STARTED` | — | D09 lane gate |
| repository unit | `READY_FOR_REVIEW` | typecheck + targeted ESLint | No errors |
| database integration | `READY_FOR_REVIEW` | DATA persistence Vitest | 30/30 D01-D07 tests pass against PostgreSQL |
| concurrency/idempotency | `READY_FOR_REVIEW` | D06 PostgreSQL Vitest | 8 concurrent deliveries + forced rollback; 3/3 pass |
| repository required gate | `NOT_STARTED` | — | D09 lane gate |

## Review findings

| ID | Priority | Status | Finding | Resolution |
|---|---|---|---|---|
| — | — | — | — | — |

## Open risks/blockers

| Since | Status | Blocker | Owner | Attempted mitigation | Next check |
|---|---|---|---|---|---|
| 2026-09-05 | `READY` | CR-DATA-001: no frozen persistence repository port | coordinator | Concrete DATA adapter uses only frozen `RniSourceItem`; no contract edit made | Before ENGINE persistence binding |
| 2026-09-05 | `BLOCKED` | CR-DATA-002/003: D03 types/port and pgvector deployment scope unresolved | coordinator | Completed relational lineage and tests without changing contracts or enabling vector | Before D03 embedding storage / ENGINE binding |

## Commits

| SHA | Summary | Tests |
|---|---|---|
| 3c0cc56 | D01 canonical source-first schema and repository | Typecheck, targeted lint, PostgreSQL 7/7 |
| bae4e9f | D02 multi-security links and observations | Typecheck, targeted lint, PostgreSQL 12/12 |
| 2757f5c | D03 relational claim/citation/narrative slice | Typecheck, targeted lint, PostgreSQL 16/16; vector blocked |
| adb91a4 | D04 independent run/platform slices | Typecheck, targeted lint, PostgreSQL 20/20 |
| ca9ca72 | D05 immutable cross-source summaries | Typecheck, targeted lint, PostgreSQL 24/24 |
| 2cc02d7 | D06 concurrent source upsert and transactional outbox | Typecheck, targeted lint, PostgreSQL 27/27 |
| this commit | D07 source tombstones and rejected discoveries | Typecheck, targeted lint, PostgreSQL 30/30 |

## Handoff

```text
RNI LANE     DATA
BRANCH       feat/rni-data-source-first
BASE SHA     86ec5b4757f45cbe96c651f413e8ff1109fef279
STATUS       PARTIAL
TASKS        6/9; D03 blocked, D08-D09 incomplete
TESTS        D01-D07 PostgreSQL integration 30/30; typecheck/lint pass
CONTRACT     CR-DATA-001, CR-DATA-002, CR-DATA-003
RISKS        D03 pgvector/ports blocked; outbox relay remains integration scope
FILES        migrations 0020-0022; source/observation/claim repositories; D01-D03 tests; DATA.md
COMMITS      3c0cc56 (D01); bae4e9f (D02); 2757f5c (D03 relational); adb91a4 (D04); ca9ca72 (D05); 2cc02d7 (D06); this commit (D07)
DEMO PROOF   one comparative source persists distinct bullish NVDA and bearish AMD observations
```
