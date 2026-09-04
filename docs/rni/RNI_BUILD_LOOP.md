# RNI Build Loop — Parallel Delivery Orchestration

**Status:** binding for the Retail Narrative Intelligence vertical slice  
**Target repository:** `JoshuAI-888/investment-sentiment-analysis`  
**Delivery owner and production approver:** `joshuai`  
**Companion files:** `PROGRESS.md`, `progress/DATA.md`, `progress/ENGINE.md`, `progress/SURFACE.md`, `progress/INTEGRATION.md`

## 1. Objective and fixed scope

Deliver the approved RNI vertical slice without destabilising the existing application:

- Reddit acquisition through OpenAI Web Search only;
- X as a separate first-class sentiment datasource using the existing adapter;
- Reddit sentiment, X sentiment and combined summary shown separately;
- source URL and bounded relevant content committed before interpretation;
- multi-security, four-dimension observations;
- deterministic platform-specific metrics and explicit cross-source divergence;
- current FMP-derived S&P 500 universe, NVDA selected by default, configurable in Settings;
- citations, raw-data lineage, freshness and manual refresh;
- OpenAI Direct for RNI by default, optional Vercel AI Gateway;
- read-only MCP contract/skeleton only.

Anything outside this list is deferred unless `joshuai` changes scope in writing.

## 2. Roles

| Role | Parallel limit | Responsibility | State file |
|---|---:|---|---|
| Coordinator/integrator | 1 | contracts, shared files, sequencing, reviews, merges, CI, deployment | `PROGRESS.md`, `progress/INTEGRATION.md` |
| DATA builder | 1 | RNI schema, repositories, lineage and database tests | `progress/DATA.md` |
| ENGINE builder | 1 | acquisition, agents, orchestration, analytics, convergence and evals | `progress/ENGINE.md` |
| SURFACE builder | 1 | RNI pages/components and browser tests against frozen mocks | `progress/SURFACE.md` |
| Reviewer | up to 1 per ready branch | read-only adversarial review; no fixes and no progress edits | review report only |

Maximum concurrent builders: **three**—DATA, ENGINE and SURFACE. The coordinator may integrate or review while they work but must not implement inside another active lane.

## 3. Non-negotiable ownership

### 3.1 Coordinator/integration-only paths

Only the coordinator/integrator may change:

```text
.github/workflows/**
apps/web/scripts/check-copy.ts
apps/web/scripts/checks/copy.ts
apps/web/tests/unit/checks/copy.test.ts
apps/web/package.json
pnpm-lock.yaml
pnpm-workspace.yaml
apps/web/src/env.ts
apps/web/src/contracts/config.ts
apps/web/src/repositories/versions.ts
apps/web/src/repositories/universe-seed.ts
apps/web/migrations/seed/universe-v1.json
apps/web/migrations/0024_rni_universe_upgrade.sql
apps/web/src/adapters/fmp-universe.ts
apps/web/src/rni/universe/**
apps/web/app/(admin)/admin/settings/universe/**
apps/web/src/calc/registry.ts
apps/web/src/ui/metric-manifest.ts
apps/web/app/**/layout.tsx
apps/web/app/**/navigation*.ts
apps/web/app/api/cron/**
apps/web/app/api/rni/**
apps/web/src/services/jobs/** shared registration/composition files
docs/PROGRESS.md
docs/MEMORY.md
docs/progress/** existing non-RNI state files
docs/rni/PROGRESS.md
docs/rni/progress/INTEGRATION.md
```

The integration lane also owns the initial frozen contract:

```text
docs/features/RNI-00-CONTRACT.md
apps/web/src/rni/contracts/index.ts
apps/web/src/rni/testing/reference-fixtures.ts
```

After contract freeze, no lane edits these files. A required change is raised as a contract request.

### 3.2 DATA-owned paths

```text
apps/web/migrations/0020_rni_sources.sql
apps/web/migrations/0021_rni_observations.sql
apps/web/migrations/0022_rni_claims_narratives.sql
apps/web/migrations/0023_rni_platform_slices.sql
apps/web/src/rni/repositories/**
apps/web/tests/integration/rni-persistence/**
docs/rni/progress/DATA.md
```

DATA must not edit legacy tables destructively or modify existing repository/config contracts.

### 3.3 ENGINE-owned paths

```text
apps/web/src/rni/discovery/**
apps/web/src/rni/sources/**
apps/web/src/rni/agents/**
apps/web/src/rni/observations/**
apps/web/src/rni/narratives/**
apps/web/src/rni/analytics/**
apps/web/src/rni/convergence/**
apps/web/src/rni/workflow/**
apps/web/tests/unit/rni/**
apps/web/tests/contract/rni/**
apps/web/tests/eval/rni/**
apps/web/prompts/rni/**
docs/rni/progress/ENGINE.md
```

ENGINE uses injected repositories, clock, Web Search, X adapter, model route and job ports. It writes no SQL and no UI.

### 3.4 SURFACE-owned paths

```text
apps/web/app/(rni)/** except shared layout/navigation
apps/web/src/rni/ui/**
apps/web/tests/e2e/rni/**
apps/web/fixtures/rni-ui/**
docs/rni/progress/SURFACE.md
```

SURFACE builds against the frozen `RniReadService` and fixture service. It does not import repositories or provider adapters.

### 3.5 Progress-file rule

- Each builder is the only writer of its workstream progress file.
- The coordinator is the only writer of master `PROGRESS.md` and `INTEGRATION.md`.
- Reviewers never edit progress.
- A lane updates its progress file in the same commit as the code state it describes.
- The coordinator copies only high-level status into master progress after merge; it never rewrites lane history.
- No two branches edit the same progress file.

## 4. Branches and worktrees

| Lane | Branch | Suggested worktree |
|---|---|---|
| Contract freeze | `feat/rni-00-contract-freeze` | `../wt-rni-contract` |
| DATA | `feat/rni-data-source-first` | `../wt-rni-data` |
| ENGINE | `feat/rni-engine-live-slice` | `../wt-rni-engine` |
| SURFACE | `feat/rni-surface-demo` | `../wt-rni-surface` |
| Integration | `feat/rni-integration-demo` | `../wt-rni-integration` |

Every lane starts from the merged contract-freeze SHA. Never branch one builder lane from another builder lane.

The coordinator must confirm `fix/require-ai-model-routes-live-mode` is merged, then create and merge the contract-freeze branch. Record both SHAs in `PROGRESS.md`.

## 5. Phase gates

```text
G0 repo preflight
  -> G1 route branch merged
  -> G2 RNI contract frozen and merged
  -> parallel DATA / ENGINE / SURFACE
  -> G3 DATA accepted and merged
  -> G4 ENGINE accepted and merged
  -> G5 SURFACE accepted and merged
  -> G6 integration green in preview
  -> G7 live-source and FMP gates
  -> G8 production approval by joshuai
```

### G0 — repository preflight

- Remote `main` CI green.
- Clean checkout installs with Corepack and pinned pnpm 10.33.0.
- `esbuild` and `sharp` build-script policy verified.
- No unrelated dirty changes will be overwritten.
- Vercel, Neon, QStash, OpenAI, X and FMP deployment variables are identified; never print values.

### G1 — pending model-route branch

- Review and merge `fix/require-ai-model-routes-live-mode`.
- Confirm legacy global model transport remains unchanged.
- Record merge SHA.

### G2 — contract freeze

Freeze and test:

- `RniPlatform`, coverage modes and platform slice states;
- source candidate and persisted-source schemas;
- four observation dimensions and five stance values;
- citation and bounded-content rules;
- `RniReadService` and command interfaces;
- Reddit/X/combined response shape;
- cross-source statuses;
- exact metric names, units and insufficient-data behaviour;
- S&P 500 universe/FMP synchronization contract;
- fixed comparative, divergence, one-source-failure and FMP fixtures;
- stable error envelope;
- migration allocations and route names;
- CI path filters for RNI prompts/agents/evals.

No parallel builder starts before G2 merges.

### G3–G5 — lane acceptance

A lane is mergeable only when:

1. its progress file has no undocumented blocked or partial task;
2. all task acceptance checks are checked;
3. narrow and required repository suites pass;
4. touched files stay inside owned paths;
5. a separate reviewer returns `PASS` or all findings are resolved;
6. branch is rebased on current integration base;
7. CI is green.

### G6 — integrated preview

- Integration branch composes live repositories/adapters without changing frozen semantics.
- Existing application regression suite remains green.
- Reddit, X and combined UI sections work against fixtures.
- Manual refresh is idempotent.
- Source → observation → metric → publication → citation lineage is navigable.
- Authenticated preview smoke passes.

### G7 — live gates

- OpenAI Web Search persistence spike passes on at least five live Reddit sources.
- Existing X adapter live smoke passes independently.
- FMP `/stable/sp500-constituent` capability probe passes and stages a complete valid version.
- Any active S&P 500 security can start an on-demand run; NVDA is the default selection.
- Provider failures show independent partial/degraded states.
- No uncited sentence publishes.

### G8 — production

- `joshuai` reviews migrations, FMP universe impact, disclosure copy and preview evidence.
- `joshuai` activates the universe version and approves production promotion.
- Production login, health, manual run, citations, raw explorer and freshness smoke pass.

## 6. Workstream build loops

Each lane repeats:

```text
SELECT one ready task
  -> mark IN_PROGRESS in lane progress
  -> add/fix the smallest failing test
  -> implement only owned paths
  -> run narrow verification
  -> run required lane gate
  -> update evidence/risks in lane progress
  -> commit code + progress together
  -> request independent review
  -> resolve findings
  -> mark READY_FOR_MERGE
  -> stop; coordinator owns merge
```

Builders never open/merge PRs unless the coordinator explicitly delegates that administrative action. Builders do not modify master progress or repository memory.

## 7. Contract-change protocol

When a lane needs a frozen contract change:

1. Stop dependent implementation.
2. Add a request to the lane progress file under `Contract requests` containing:
   - current contract;
   - requested change;
   - why an adapter/private implementation cannot solve it;
   - affected lanes and fixtures;
   - backward-compatibility impact.
3. Notify the coordinator.
4. Coordinator accepts, rejects or narrows it in `INTEGRATION.md`.
5. Only the coordinator changes the contract and reference fixtures in a small PR.
6. Every affected lane rebases and records the new contract SHA.

No lane locally forks a shared type to bypass this process.

## 8. Lane report contract

Every lane handoff uses this exact compact form:

```text
RNI LANE     DATA | ENGINE | SURFACE
BRANCH       <branch>
BASE SHA     <contract-freeze sha>
STATUS       READY_FOR_REVIEW | BLOCKED | PARTIAL
TASKS        <completed>/<total>; list incomplete only
TESTS        <suite: pass/fail/not-run>
CONTRACT     none | CR-###
RISKS        <open risks or none>
FILES        <all touched paths>
COMMITS      <sha list>
DEMO PROOF   <fixture/live scenario and result>
```

The coordinator rejects a handoff that lacks file inventory or test evidence.

## 9. Review checklist

The reviewer reads the diff cold and checks:

- source commit occurs before any interpretation call;
- canonical URL and bounded content are mandatory for publishable evidence;
- no whole-page HTML or unrelated comments are retained;
- one source can create several security observations without duplication;
- Reddit and X identities, runs, metrics, freshness and citations never cross;
- combined summary preserves disagreement and missing-source states;
- no raw-count pooling across platforms;
- deterministic metrics reproduce from stored inputs/config;
- z-score abstains without a valid baseline;
- confidence is not presented as price probability;
- X is never invoked as Reddit fallback;
- Reddit has no API dependency;
- S&P 500 sync never partially activates and reuses the security master;
- all user-facing explanation clauses have valid citation IDs;
- source text cannot influence system/tool instructions;
- no lane-owned boundary was crossed;
- existing product behaviour is not silently changed.

Findings use `P0` blocking, `P1` required before merge, `P2` scheduled follow-up, or `P3` optional.

## 10. Test ownership

| Test | Owner | Required before |
|---|---|---|
| Migration, uniqueness, FK, concurrent upsert | DATA | DATA merge |
| Persist-before-interpret crash/retry | DATA + ENGINE contract fixture | ENGINE merge |
| FMP universe schema/atomic activation | DATA fixture; integration wiring | Integration merge |
| Multi-security and four-dimension semantics | ENGINE | ENGINE merge |
| Reddit/X isolation and divergence | ENGINE | ENGINE merge |
| Prompt injection and strict output | ENGINE | ENGINE merge |
| Calculation golden/replay | ENGINE | ENGINE merge |
| Radar/detail/data explorer | SURFACE | SURFACE merge |
| Freshness and manual double-click | SURFACE fixture; integration live composition | Integration merge |
| Accessibility/responsive/keyboard | SURFACE | SURFACE merge |
| CI path-filter assertion | Integration | Contract freeze merge |
| Existing dashboard/ticker regression | Integration | Preview/production |
| Live Reddit/X/FMP smoke | Integration + joshuai | Production approval |

## 11. Merge and rebase policy

Preferred merge order:

1. `fix/require-ai-model-routes-live-mode`;
2. `feat/rni-00-contract-freeze`;
3. DATA;
4. ENGINE;
5. SURFACE;
6. integration/deployment changes.

Rules:

- Coordinator merges one branch at a time after green CI.
- Next branch rebases on the new integration base and reruns its gate.
- Never hand-merge the lockfile. Take current base, run pinned `pnpm install`, commit generated output.
- Migration files are append-only after merge.
- Never force-push another lane's branch.
- Never resolve a semantic conflict by taking “ours” or “theirs” without contract review.

## 12. Failure and scope-cut policy

When the deadline is threatened, cut in this order:

1. rich MCP resources beyond the read-only skeleton;
2. dynamic theme editing/backfill;
3. scheduled UI editing beyond one safe default;
4. historical charts requiring unavailable baselines;
5. nonessential animations/export polish.

Never cut:

- source-first persistence;
- canonical citations;
- independent Reddit/X results;
- combined disagreement/partial-state honesty;
- multi-security observations;
- deterministic metrics and missing-data guards;
- FMP universe validation/versioning;
- authentication and authorization;
- idempotency;
- disclosure of sampled coverage.

A blocked live provider uses a labelled fixture for UI demonstration, but the feature remains incomplete and production promotion is blocked where the provider is part of the acceptance gate.

## 13. Progress status vocabulary

Use only:

- `NOT_STARTED`
- `READY`
- `IN_PROGRESS`
- `BLOCKED`
- `READY_FOR_REVIEW`
- `CHANGES_REQUESTED`
- `READY_FOR_MERGE`
- `MERGED`
- `DEFERRED`

Every `BLOCKED` item requires blocker, owner, first observed time, attempted mitigations and next check. Every `DEFERRED` item requires owner approval and destination backlog item.

## 14. Completion rule

RNI is complete only when `PROGRESS.md` shows G0–G8 passed, every mandatory lane task is `MERGED`, every Critical/High risk has its closure evidence linked, and `joshuai` records production approval. Branch completion, fixture-only success or fluent output is not product completion.
