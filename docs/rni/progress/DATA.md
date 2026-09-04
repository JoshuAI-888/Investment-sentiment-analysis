# RNI DATA Workstream Progress

**Writer:** DATA builder only  
**Branch:** `feat/rni-data-source-first`  
**Depends on:** merged RNI contract-freeze SHA  
**Status:** `READY_FOR_REVIEW`

## Owned paths

See `../RNI_BUILD_LOOP.md` §3.2. Any path outside that list requires a contract request.

## Tasks

| ID  | Task                                                        | Status             | Acceptance evidence                                                          |
| --- | ----------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------- |
| D01 | Canonical `rni_source_item` and retrieval/content tables    | `READY_FOR_REVIEW` | Frozen port implemented; crossed natural-key conflict fails closed; 9/9 pass |
| D02 | Source-security links and four-dimension observations       | `READY_FOR_REVIEW` | Migration `0021`; multi-ticker and four-dimension tests pass                 |
| D03 | Claims, citations, themes, narratives and relationships     | `READY_FOR_REVIEW` | Null-safe claim/narrative security identity enforced; 6/6 pass               |
| D04 | Independent Reddit/X `run_source_slice` persistence         | `READY_FOR_REVIEW` | Runs foreign-key immutable config/universe version IDs; 5/5 pass             |
| D05 | Cross-source summary persistence without component mutation | `READY_FOR_REVIEW` | Divergence/partial repository tests 4/4 pass                                 |
| D06 | Idempotent/concurrent inserts and transactional outbox      | `READY_FOR_REVIEW` | 8-way concurrent upsert and outbox rollback 3/3 pass                         |
| D07 | Bounded-content, tombstone and rejected-discovery states    | `READY_FOR_REVIEW` | Terminal status, timestamp, and reason are immutable; 3/3 pass               |
| D08 | FMP >500-member fixture support for integration migration   | `READY_FOR_REVIEW` | 501-member and six invalid activation fixtures 4/4 pass                      |
| D09 | Full DATA lane verification and handoff                     | `READY_FOR_REVIEW` | Rebased RNI 41/41; lint/type/contract 101/101 green                          |

## Task evidence

### D01 — Canonical source, retrieval and content versions

- **Status:** `READY_FOR_REVIEW`
- **Files:** `apps/web/migrations/0020_rni_sources.sql`,
  `apps/web/src/rni/repositories/source-items.ts`,
  `apps/web/tests/integration/rni-persistence/source-items.test.ts`, and this progress file.
- **Tests:** TypeScript; targeted ESLint; PostgreSQL D01 (`9/9`); full DATA (`41/41`);
  `git diff --check`.
- **Result:** canonical source identity is unique by platform/external ID and platform/URL;
  original URLs are retained; retrievals and changed bounded content are append-only; invalid
  platform provenance and whole-page HTML fail at database boundaries. Crossed external-ID/URL
  identities fail closed without attaching retrieval/content to either row.
- **Handoff:** `PostgresRniSourcePersistence` implements the accepted
  `RniSourcePersistencePort`; duplicate delivery returns the same committed ID and false flags.

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
- **Handoff:** ENGINE may rely on the frozen mention/observation shapes and accepted source port.

### D03 — Claims, citations, themes, narratives and relationships

- **Status:** `READY_FOR_REVIEW` (pgvector explicitly deferred by coordinator decision).
- **Files:** `apps/web/migrations/0022_rni_claims_narratives.sql`,
  `apps/web/src/rni/repositories/claims-narratives.ts`,
  `apps/web/tests/integration/rni-persistence/claims-narratives.test.ts`, and this progress file.
- **Tests:** TypeScript; targeted ESLint; D03 PostgreSQL integration (`6/6`); full DATA (`41/41`);
  `git diff --check`.
- **Result:** claims, citations, themes, narrative memberships, and comparative relationships are
  append-only and foreign-keyed to persisted source/observation lineage; dangling and mismatched
  citations/claims fail closed, including a claim for source A cited through persisted source B.
  Membership security is null-safe: a security-specific narrative accepts only claims for that
  security, while a global narrative accepts only global (`security_id is null`) claims.
- **Decision:** CR-DATA-002 is deferred to I07 composition until ENGINE E05 has a concrete
  consumer. CR-DATA-003 is resolved: no vector extension or placeholder column is required.

### D04 — Independent Reddit/X platform slices

- **Status:** `READY_FOR_REVIEW`
- **Files:** `apps/web/migrations/0023_rni_platform_slices.sql`,
  `apps/web/src/rni/repositories/runs.ts`,
  `apps/web/tests/integration/rni-persistence/platform-slices.test.ts`, the D03 narrative FK
  regression, and this progress file.
- **Tests:** TypeScript; targeted ESLint; D04 PostgreSQL integration (`5/5`); full DATA (`41/41`);
  `git diff --check`.
- **Result:** run creation is idempotent and atomic with exactly one Reddit plus one X slice;
  independent success/unavailable states round-trip unchanged; missing, duplicate, or cross-run
  slice sets fail before commit. Run lineage uses bigint IDs parsed as strings in TypeScript and
  foreign-keys both immutable `config_version` and `universe_version` records.
- **Handoff:** INTEGRATION can compose `getRniRunById`/`getRniPlatformSlices` behind the frozen
  `RniReadService`; nonexistent version IDs fail at the database boundary.

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
  D03 relational claim citations are separately foreign-keyed and its broader port is deferred.
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
- **Handoff:** the persisted-source event is `rni.source_persisted.v1`; the accepted source port
  returns the committed identity and idempotency flags without exposing relay state.

### D07 — Tombstones and rejected discoveries

- **Status:** `READY_FOR_REVIEW`
- **Files:** lifecycle/rejection extension in `apps/web/migrations/0020_rni_sources.sql`,
  `apps/web/src/rni/repositories/source-states.ts`,
  `apps/web/tests/integration/rni-persistence/source-states.test.ts`, and this progress file.
- **Tests:** TypeScript; targeted ESLint; D07 PostgreSQL integration (`3/3`); cumulative DATA
  persistence PostgreSQL regression (`30/30`); `git diff --check`.
- **Result:** source tombstones are terminal while original URL/evidence stays immutable; rejected
  discoveries retain URL/query/request provenance and reason without any page-content column;
  whole-page HTML is rejected in both adapter and database paths. Direct SQL cannot rewrite a
  terminal status, tombstone timestamp, or reason after the first active-to-terminal transition.
- **Risk:** physical content erasure for a legal takedown is intentionally not invented because
  the frozen `RniSourceItem` requires bounded content; a retention-policy change needs coordinator
  contract review.
- **Handoff:** SURFACE/INTEGRATION should use the terminal state for display restrictions while
  retaining the source identity and audit lineage.

### D08 — FMP universe fixtures

- **Status:** `READY_FOR_REVIEW`
- **Files:** `apps/web/tests/integration/rni-persistence/fmp-universe-fixtures.ts`, its test, and
  this progress file; migration `0024` and shared universe code were not touched.
- **Tests:** TypeScript; targeted ESLint; D08 fixture suite (`4/4`); cumulative DATA suite
  (`34/34`); `git diff --check`.
- **Result:** the integration coordinator receives a unique 501-member NVDA-containing candidate
  plus empty, duplicate, missing-NVDA, >600, ambiguous, and unresolved fixtures with explicit
  expected outcomes.
- **Decision:** CR-DATA-004 is resolved in I06/e535624; duplicate, complete-count, NVDA,
  ambiguous, and unresolved checks are integration synchronizer semantics.
- **Handoff:** use all seven fixtures against migration `0024` and the FMP synchronizer; invalid
  cases must leave the prior active universe unchanged.

### D09 — Full verification and handoff

- **Status:** `READY_FOR_REVIEW`
- **Files:** `apps/web/tests/integration/rni-persistence/migration-apply.test.ts` and this progress
  file.
- **Tests:** post-rebase clean and forward migrations `0020-0023` (`2/2`); full ESLint and
  TypeScript pass; contract with PostgreSQL `101/101`; DATA lane `41/41`. The prior corrective
  full gate also had unit `1171/1171`.
- **Repository gate:** full integration `396/397`. The only failure is the known non-RNI
  `attention-pipeline.test.ts:675` clock race: expected computed `0`, received `1`.
  `market.test.ts` passed (`18/18`) in this full run; every RNI integration test passed.
- **Handoff:** no DATA blocker remains. The legacy clock race is reported for base-gate
  adjudication and no non-RNI source/test was edited.

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

| ID          | Status     | Request                                                                                                | Impact                                                                                     |
| ----------- | ---------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| CR-DATA-001 | `ACCEPTED` | Source-persistence port frozen by coordinator commit `6b67657`, now present in the rebased base.       | Concrete PostgreSQL adapter implements the accepted committed-ID/duplicate-flags boundary. |
| CR-DATA-002 | `DEFERRED` | Keep claim/theme/narrative write shapes DATA-private until ENGINE E05 gives I07 a concrete consumer.   | Relational storage is reviewable; no premature broad frozen port.                          |
| CR-DATA-003 | `RESOLVED` | Pgvector remains explicitly deferred for this vertical slice.                                          | Migration `0022` requires neither the vector extension nor a placeholder column.           |
| CR-DATA-004 | `RESOLVED` | I06/e535624 owns duplicate/count/NVDA/ambiguous/unresolved validation in the integration synchronizer. | No frozen universe candidate-schema change is required.                                    |

### CR-DATA-001 — Source-persistence repository port

- **Resolution (2026-09-05):** accepted as D-RNI-08 in coordinator commit `6b67657`. The
  equivalent DATA cherry-pick was skipped during rebase because the coordinator patch is now in
  the integration base. The concrete DATA adapter implements it.

- **Original behaviour:** `apps/web/src/rni/contracts/index.ts` froze `RniSourceItem` and
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

- **Resolution (2026-09-05):** deferred to I07 composition. DATA-private storage types remain
  private until ENGINE E05 supplies a concrete consumer.

- **Original behaviour:** the frozen contract defined `RniComparativeRelation` and a citation read
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

- **Resolution (2026-09-05):** pgvector is explicitly deferred by `DEPLOY.md` and
  `INTEGRATION_PLAN.md`; no extension or placeholder column is required for this slice.

- **Original behaviour:** this DATA assignment included pgvector-backed narrative data, while
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

### CR-DATA-004 — Universe validation semantics

- **Resolution (2026-09-05):** resolved by I06/e535624. The integration synchronizer owns all
  duplicate, complete-count, NVDA, ambiguous, and unresolved activation checks.

- **Original behaviour:** `rniUniverseSnapshotCandidate` enforced 1-600 members and NVDA presence,
  but accepts duplicate ticker/FMP-symbol members and has no resolved/ambiguous/unresolved member
  result shape.
- **Requested change:** add duplicate-member refinement and a frozen staged-resolution result (or
  explicitly assign those checks to the integration synchronizer contract).
- **Justification:** D08 must prove duplicate, ambiguous, and unresolved inputs cannot activate;
  fixture-only conventions are not an enforceable cross-lane API.
- **Affected lanes:** DATA fixtures and INTEGRATION migration `0024`/FMP synchronizer.
- **Compatibility impact:** duplicate payloads that currently parse would fail; valid unique
  snapshots remain compatible.
- **Recommended acceptance test:** the DATA `duplicate`, `ambiguous`, and `unresolved` fixtures
  all leave the prior active universe unchanged, while the 501-member valid fixture activates
  atomically and retains NVDA.

## Test evidence

| Suite                    | Status             | Command/run link                  | Notes                                                                                          |
| ------------------------ | ------------------ | --------------------------------- | ---------------------------------------------------------------------------------------------- |
| migration clean apply    | `READY_FOR_REVIEW` | D09 migration Vitest              | Clean apply through `0023`; pass                                                               |
| migration forward apply  | `READY_FOR_REVIEW` | D09 migration Vitest              | Populated legacy schema preserved; pass                                                        |
| repository unit          | `READY_FOR_REVIEW` | full ESLint + TypeScript + unit   | No errors; 1171/1171                                                                           |
| database integration     | `READY_FOR_REVIEW` | DATA persistence + fixture Vitest | Post-rebase 41/41 D01-D09 tests pass                                                           |
| concurrency/idempotency  | `READY_FOR_REVIEW` | D06 PostgreSQL Vitest             | 8 concurrent deliveries + forced rollback; 3/3 pass                                            |
| repository required gate | `READY_FOR_REVIEW` | full unit/contract/integration    | Post-rebase lint/type and contract 101/101 pass; prior full gate 396/397 with known clock race |

## Review findings

| ID      | Priority | Status  | Finding                                                      | Resolution                                                                       |
| ------- | -------- | ------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| DATA-R1 | P1       | `FIXED` | Crossed source natural keys selected the external-ID row     | Query both identities and reject two distinct rows; PostgreSQL regression passes |
| DATA-R2 | P1       | `FIXED` | Claim citations could reference a different persisted source | Composite `(claim_id, source_item_id)` FK rejects the mismatch                   |
| DATA-R3 | P1       | `FIXED` | Runs accepted nonexistent text version labels                | Bigint FKs pin existing immutable config/universe versions; negative tests pass  |
| DATA-R4 | P2       | `FIXED` | Same-status SQL could rewrite tombstone metadata             | Terminal status, timestamp, and reason are immutable after transition            |
| DATA-R5 | P1       | `FIXED` | Opposing-security claim could join a security narrative      | Null-safe DB trigger requires identical claim/narrative security identity        |

## Open risks/blockers

| Since      | Status     | Blocker                                                               | Owner                       | Attempted mitigation                                                           | Next check             |
| ---------- | ---------- | --------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------ | ---------------------- |
| 2026-09-05 | `DEFERRED` | CR-DATA-002 broad write port awaits a concrete ENGINE E05 consumer    | I07 coordinator             | DATA-private relational storage and lineage are fully tested                   | At I07 composition     |
| 2026-09-05 | `KNOWN`    | Legacy attention clock-race integration test fails outside DATA paths | coordinator / non-RNI owner | Full run: 396/397, expected computed 0 and received 1; no cross-lane edit made | Base-gate adjudication |

## Commits

| SHA         | Summary                                               | Tests                                                             |
| ----------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| 608a669     | D01 canonical source-first schema and repository      | Typecheck, targeted lint, PostgreSQL 7/7                          |
| 9369b40     | D02 multi-security links and observations             | Typecheck, targeted lint, PostgreSQL 12/12                        |
| 298dfae     | D03 relational claim/citation/narrative slice         | Typecheck, targeted lint, PostgreSQL 16/16                        |
| 359c318     | D04 independent run/platform slices                   | Typecheck, targeted lint, PostgreSQL 20/20                        |
| 7ce7dca     | D05 immutable cross-source summaries                  | Typecheck, targeted lint, PostgreSQL 24/24                        |
| 6d00a5d     | D06 concurrent source upsert and transactional outbox | Typecheck, targeted lint, PostgreSQL 27/27                        |
| 8e109da     | D07 source tombstones and rejected discoveries        | Typecheck, targeted lint, PostgreSQL 30/30                        |
| 8bb6d02     | D08 >500-member FMP universe fixture support          | Typecheck, targeted lint, DATA 34/34                              |
| 531f9e3     | D09 migration rehearsal and initial handoff           | Lint/type/unit/contract/DATA pass; legacy integration race        |
| 208ce81     | First coordinator review fixes and renewed handoff    | DATA 40/40; unit 1171/1171; contract 100/100; integration 396/397 |
| 766b23e     | Null-safe narrative membership integrity correction   | D03 PostgreSQL 6/6; TypeScript pass                               |
| this commit | Post-rebase migration rehearsal compatibility         | DATA 41/41; lint/type; contract 101/101                           |

## Handoff

```text
RNI LANE     DATA
BRANCH       feat/rni-data-source-first
BASE SHA     c570e8913dfe638aa03e5443cbd86896bce3d78e (current integration base)
STATUS       READY_FOR_REVIEW
TASKS        9/9 ready for coordinator re-review
TESTS        post-rebase lint/type pass; contract 101/101; DATA 41/41; prior full integration 396/397 (known non-RNI clock race only)
CONTRACT     CR-DATA-001 accepted; CR-DATA-002 deferred to I07; CR-DATA-003 and 004 resolved
RISKS        broader D03 write port deferred; one known non-RNI integration clock race
FILES        migrations 0020-0023; DATA repositories; RNI persistence tests/fixtures; accepted source-port contract files; DATA.md
COMMITS      608a669 (D01); 9369b40 (D02); 298dfae (D03); 359c318 (D04); 7ce7dca (D05); 6d00a5d (D06); 8e109da (D07); 8bb6d02 (D08); 531f9e3 (D09); 208ce81 (first review fixes); 766b23e (membership fix); this commit (rebase rehearsal)
DEMO PROOF   one comparative source persists distinct bullish NVDA and bearish AMD observations
```
