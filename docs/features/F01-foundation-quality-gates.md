# F01 — Foundation and Quality Gates

> **Amended 2026-09-03 by the re-lock.** **D-13:** CI now spans **two deploy targets** — the Next.js app and F20's pinned scorer service. A red scorer lane blocks merges exactly like the web lane, and the scorer's models are cached in its image so CI never depends on Hugging Face availability. **D-09:** two new lints join the F01 set — a bitemporal read outside `asOf` fails the build (F22), and predictive vocabulary on a metric with no Tier D4 record fails the build (F19). Both read structure rather than prose, so both are checkable.
> **D-11:** the env schema is cut with the rest of the multi-tenant machinery — `SIGNUP_MODE`, `ACCOUNT_DAILY_RESEARCH_LIMIT`, `ACCOUNT_MONTHLY_COST_LIMIT_USD` and `OTP_DAILY_GLOBAL_LIMIT` are void. **Added 2026-09-03 by the pre-build audit** — D-11 never reached this file on the re-lock pass, so §4.2 still required all four.
> See `../MEMORY.md` §1b for the decisions and `../SPEC-REVIEW.md` for the reasoning.

**Wave:** 1 · **Lane:** — (serial prerequisite; no lane exists until it merges) · **Estimate:** 12–16 h · **Depends on:** —

## 1. Purpose

Create the repository, the toolchain, and — critically — the **independent CI that every
later feature's merge gate depends on**. Without this, "tests pass" is an assertion by the
party being graded (`../00-ADVERSARIAL-REVIEW.md` F-14). Nothing else may merge first.

## 2. Scope

**In:** Next.js App Router + TypeScript project under `apps/web/`; Tailwind and component
primitives; pnpm workspace; strict tsconfig; ESLint with the custom architectural rules;
Prettier; Vitest; Playwright; environment schema with fail-fast validation; the CI workflow
**across both deploy targets** (D-13); the three custom CI checks (`calc-coverage`, `bundle`,
`copy`); ADR files; `provider-rights.md`; route shells with fixtures for every page in
source §6.2.

**Out:** any real provider call (F04); any real table (F03); auth (F02); actual page content
(Wave 2); **the scorer service itself** — F01 ships the lane that runs it, F20 ships the
service (§4.4b).

## 3. Contracts

**Produces:** the environment schema; the lint rule set; the CI contract every feature's DoD
references; the `PROVIDER_MODE` switch consumed by F04.
**Must not redefine:** nothing exists yet — but do not invent domain contracts here. F03 owns
them.

## 4. Build spec

### 4.1 Project

```
apps/web/          Next.js 15+ App Router, TypeScript strict, React Server Components
  src/{contracts,adapters,analytics,calc,repositories,services,agent,ui}/
  tests/{unit,contract,integration,e2e,eval}/
  fixtures/
  migrations/
```

`tsconfig`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noImplicitOverride`. Path aliases per directory above.

### 4.2 Environment schema

`src/env.ts` — zod, validated at module load, fails the process with a readable list of the
missing/invalid keys. Server-only keys must be unreachable from client code (no `NEXT_PUBLIC_`
prefix on anything secret; a lint rule forbids importing `env.ts` from a `'use client'` file).

Keys: source §6.3, **minus** all seven `HF_*` variables (F-21 cut), **plus**:

```
PROVIDER_MODE=fixture|live          # default fixture
```

**Void under D-11 — do not implement these:**

| Key | Why it is gone |
|---|---|
| `SIGNUP_MODE` | Open signup and the `pending` tier are cut. There is one account, seeded from `ADMIN_EMAIL_ALLOWLIST` |
| `ACCOUNT_DAILY_RESEARCH_LIMIT` | Per-account budgets are cut. The **global** ceiling is the only budget control, and D-20 makes it more load-bearing, not less (`../DEPLOY.md` MT-12) |
| `ACCOUNT_MONTHLY_COST_LIMIT_USD` | As above |
| `OTP_DAILY_GLOBAL_LIMIT` | The OTP throttle machinery is cut. OTP **authentication** is kept in full (F02) — it is the throttling that had no threat model left |

They are listed rather than deleted because all four appear in `../00-ADVERSARIAL-REVIEW.md`
F-04's mitigations, and a reader arriving from that finding needs to see that the ruling
expired rather than that the mitigation was forgotten.

**Known gap, not F01's to close:** source §6.3 predates D-12 and D-13, so it names no Reddit,
Substack, X, market-data or scorer keys, and no budget keys for D-20's global ceiling. Those
are owned by F04, F20 and F18 respectively and are added to this schema as each lands. F01
ships the schema *mechanism* — zod, fail-fast, server-only enforcement — not the final key
set.

### 4.3 Architectural lint rules

Custom ESLint rules — these encode product invariants, so they are code, not convention:

| Rule | Forbids |
|---|---|
| `no-llm-in-analytics` | any import from `agent/` or a model SDK inside `analytics/` or `calc/` |
| `no-float-in-analytics` | numeric literals used in arithmetic, and `Number()`/`parseFloat` in `analytics/` |
| `no-server-import-in-client` | `env.ts`, `repositories/`, `adapters/` imported from a `'use client'` module |
| `layer-direction` | the dependency direction in `../02-ARCHITECTURE-CONTRACTS.md` §3 |
| `no-unbounded-pit-read` | a repository method reading a bitemporal table outside `asOf` (D-09, F22 §4.2) |

`no-unbounded-pit-read` ships here as a **stub that passes on empty** — there are no
bitemporal tables until F22 — for the same reason as the three custom checks below: a rule
added after the code it governs is a rule that never fires. F22 §4.2 gives it its table set
and the test that proves it fires.

### 4.4 CI checks

Workflow per `../05-TEST-STRATEGY.md` §8. Three custom scripts, stubbed here and filled by
the features that give them meaning — but **present and passing from F01**, so they cannot
be "added later":

- `check:calc-coverage` — walks the method registry and the rendered-metric manifest; fails
  on a metric with no registered method or a method with no goldens. Stub: passes on empty.
- `check:bundle` — builds and asserts no provider SDK, database client, or secret-bearing
  module appears in a client chunk.
- `check:copy` — scans user-facing strings for banned vocabulary
  (`signal`, `strong buy`, `risk-on`, `consensus`, `Reddit sentiment`, `all Reddit`,
  `live X sentiment`, `guaranteed`, `will outperform`) and for the required disclosure line.
  **D-09 extension:** predictive vocabulary attached to a metric carrying no Tier D4 record
  fails the build. The check reads the method registry rather than judging prose, so it is
  structural. Stub here — the registry is F05's — and filled by F19 §4.3.

### 4.4b The second CI lane (D-13)

CI spans **two deploy targets**, and a red scorer lane blocks a merge exactly as the web lane
does. F01 ships the lane; F20 ships the service it runs.

- A separate workflow job for the scorer service, keyed on its own path — `services/scorer/`,
  fixed in `F20-scorer-service.md` §4.1 so the two halves cannot be built apart — running its own
  language toolchain. It is **not** a step inside the web job — a Python failure must not be
  reported as a Next.js failure.
- The job builds the scorer image and runs its suite against **models baked into that image**.
  CI never reaches Hugging Face at run time: an upstream outage would otherwise turn every
  merge red for a reason unrelated to the diff.
- Until F20 lands, the job runs against a placeholder container whose only test asserts the
  contract in `F20-scorer-service.md` §3. It must be **present and green from F01** — a lane
  added at F20 is a lane that has never gated anything.

### 4.5 ADRs and rights

`docs/adr/ADR-001..019.md` — one file each, transcribed from source §1.1, **with the
amendments from `../00-ADVERSARIAL-REVIEW.md` applied and the finding cited**. Notably:
ADR-004 gains the methodology-version pin; ADR-006 is demoted (F-09); ADR-011 is superseded
(F-21); **ADR-016 is cut to single-account OTP** (D-11 — the `pending` tier F-04 asked for is
void, and the ADR must say so rather than silently dropping it); ADR-019 gains the
artifact-granularity rule (F-07).

`docs/provider-rights.md` — per provider: plan, allowance, commercial-display position,
retention permitted, attribution required, and what we may **not** do. This is the document
a reviewer checks before any redistribution question.

### 4.6 Route shells

Every route in source §6.2 exists and renders a fixture state. This exposes the routing and
layout problems (parallel routes, the intercepted calculation drawer) in hour one rather
than in Wave 4.

## 5. Test plan

| Level | Cases |
|---|---|
| Unit | env schema accepts a valid set; rejects each missing required key with a named error; rejects a malformed `ADMIN_EMAIL_ALLOWLIST` |
| Contract | — |
| Integration | — |
| E2E | every route in §6.2 returns 200 and renders its fixture; no console errors |
| Feature-specific | each custom lint rule fires on a crafted violation and passes on the legal form, `no-unbounded-pit-read` included; `check:bundle` fails on a deliberately-leaked import; `check:copy` fails on a seeded banned word **and on predictive vocabulary with no Tier D4 record**; the scorer lane runs, and a seeded failure in it turns the overall gate red |

## 6. Definition of Done

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass locally and in CI.
- [ ] CI runs on push and pull request, independently of the developing agent, and its run
      is linkable from a PR body.
- [ ] CI runs with `PROVIDER_MODE=fixture` and **no provider keys present**.
- [ ] All **five** architectural lint rules exist and are proven by a failing-case test.
- [ ] `check:calc-coverage`, `check:bundle`, `check:copy` exist, run in CI, and each has a
      test proving it can fail — `check:copy` including D-09's Tier D4 clause.
- [ ] **CI runs both deploy targets** (web app, scorer service) as separate jobs, and a red
      scorer lane blocks the merge. The scorer job reaches no network at run time.
- [ ] No `SIGNUP_MODE`, `ACCOUNT_DAILY_RESEARCH_LIMIT`, `ACCOUNT_MONTHLY_COST_LIMIT_USD` or
      `OTP_DAILY_GLOBAL_LIMIT` appears anywhere in the codebase (D-11).
- [ ] Environment validation fails the process at startup with a readable message.
- [ ] Every route in source §6.2 renders a fixture state.
- [ ] ADR-001..019 exist with review amendments applied and findings cited.
- [ ] `provider-rights.md` covers every provider in the stack.
- [ ] No `HF_*` variable appears anywhere in the codebase.

## 7. PR review steps

1. Clone fresh, `pnpm install`, run the full gate. It must pass with no `.env` file present
   beyond the fixture defaults.
2. Deliberately break each lint rule and each custom check; confirm each fails.
3. Grep the client bundle output for `FMP`, `DATABASE_URL`, `RESEND`, `pg`, `postgres`.
4. Read `provider-rights.md` against source §4 — does any entry overstate our rights?
5. Confirm the ADRs carry the review amendments, not the original text verbatim.

## 8. Risks and open questions

| Risk | Mitigation |
|---|---|
| Custom lint rules are slow to write and get skipped "for now" | They are DoD items; they encode invariants the loop will otherwise erode |
| Route shells for parallel/intercepted routes are fiddly in App Router | Exactly why they are in F01 — discover it now, not in Wave 4 |
| CI minutes on a Hobby-adjacent setup | Fixture-only CI is fast; the eval suite is conditional |
