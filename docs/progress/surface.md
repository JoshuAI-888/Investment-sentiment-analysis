# Lane SURFACE — product surfaces and quality gates

**Written by:** the coordinator only (`../06-PARALLEL-LANES.md` §4). A lane agent reports;
it never edits this file.
**Owns these source paths:** `apps/web/app/`, `apps/web/src/ui/`, `apps/web/tests/e2e/`,
and the three custom CI checks (`check:calc-coverage`, `check:bundle`, `check:copy`)
**Never touches:** any path owned by SPINE or COLLECT (`./spine.md`, `./collect.md`).

**This lane consumes contracts and produces none.** It is the lane most able to run ahead
against fixtures, and the one whose work is cheapest to redo if a contract moves.

## Features

| ID | Feature | Wave | Status | PR | Notes |
|---|---|---|---|---|---|
| F02 | Auth and authorization | 1 | `merged 2026-09-03` | [#3](https://github.com/JoshuAI-888/Investment-sentiment-analysis/pull/3) | Admin address `joshuaifang@gmail.com` (D-26). Heavily cut by D-11 — OTP auth only at merge. Send cap ratified (D-28). Three rounds of adversarial `lane-review` closed a discarded-mailer-failure bug, a vacuous admin-positive e2e gap, a timing-equalizer test that didn't bind to its claimed behaviour, and a stale comment that risked weakening the Wave 1 exit gate. 526 unit / 25 contract / 114 integration / 63 e2e, all green. Deferred: six `docs/user-data.md` rows outside Better Auth's own tables await SPINE repository functions; `deleteMyAccount`/`exportMyData` name them explicitly rather than silently omitting them. **Owner-requested follow-up, 2026-09-04 (D-37):** OTP replaced with email+password, self-service sign-up allowlist-gated via `databaseHooks.user.create.before`, `requireEmailVerification` closing the takeover gap that gate alone would leave. New: `/sign-up`, `/forgot-password`, `/reset-password`. See `../MEMORY.md` D-37 and `../features/F02-auth-authorization.md`'s D-37 amendment for the full reasoning, including the `BETTER_AUTH_URL` host-scoping pitfall this move introduced and closed, and the F08/F09 protected routes (`/social/reddit`, `/ticker/[symbol]/social`, their API routes) this follow-up had to extend the same `requireUser()`/`requireAdmin()` gate to. **Second owner-requested follow-up, same day (D-38):** confirmed multi-account was already allowlist-driven (`ADMIN_EMAIL_ALLOWLIST` was always multi-address), and added a seeded `welcome1` onboarding path alongside self-service sign-up — pre-verified on creation, `mustChangePassword` forces a real password before any protected route is reachable. New: `/change-password`; new error class `PasswordChangeRequiredError`, propagated to every `requireUser()`/`requireAdmin()` call site, F08/F09's included. `mustChangePassword` is `input: false` and written only through `auth.$context.internalAdapter` (`seed-account.ts`), never a public request body. Full gate green: 836 unit / 53 contract / 207 integration / 80 e2e, build, lint, `check:bundle`, `check:copy`. See `../MEMORY.md` D-38 and the spec's own D-38 amendment for the shared-password trade-off this accepts and how it's bounded |
| F07 | Dashboard and composites | 2 | `merged 2026-09-03` | [#7](https://github.com/JoshuAI-888/Investment-sentiment-analysis/pull/7) | Market and sector composite cards, `sectorBreadthInputs`. Two rounds of adversarial `lane-review`: round 1 (8 fixes) added TTL'd refusal markers (`refusal.ts` — 60s rate-limited, 120s in-progress, 15min budget) and `renormalizedComponentWeight`, and fixed a `Number()`-vs-decimal comparison in `sectorBreadthInputs` that could flip a threshold at exactly the float/decimal disagreement point; round 2 (3 fixes) found `MarketCompositeCard`'s omitted/applied branch split used `component.metric === null` where it needed `!component.participated \|\| component.metric === null` (an abstained artifact still carries a non-null metric), verified by mutation. Also found and fixed a non-discriminating regression test (`'0.35' >= '0.35'` compares a value to itself) by using `'0.34999999999999999'`, a value where `Number()` and `Dec` disagree |
| F08 | Attention leaderboard | 2 | `merged 2026-09-03/04` | [#15](https://github.com/JoshuAI-888/Investment-sentiment-analysis/pull/15) | Re-sourced to the Reddit API; ApeWisdom demoted to cross-check. **Merged after 55 total adversarial `lane-review` rounds** — resumed from a round-43 pause (see `progress/log/2026-09-03-surface-f08-round33-43-pause.md`) and continued to a clean round. Recurring theme across rounds 24–28: the "degraded state over zero rows" read path (`leaderboard.ts`/`pipeline.ts`/`AttentionUnavailable.tsx`) took five rounds to become honest about every `degradedReason`/`unavailableReason` combination. Full gate green on the merge commit |
| F09 | Ticker detail and evidence drawer | 2 | `merged 2026-09-04` | [#16](https://github.com/JoshuAI-888/Investment-sentiment-analysis/pull/16) | Renders **three** sampling-frame disclosures, plus coverage gaps as holes in the chart. Converged after 4 adversarial `lane-review` rounds (fabricated-input, mislabeled-coverage and missing-scope findings — see the round commits). Merged `main` in cleanly, resolving an additive conflict with F08 in `metric-manifest.ts`/`routes.ts` (both features append to shared list files — see `MEMORY.md` for the pattern) |
| F15 | Operator control plane | 4 | `merged 2026-09-05 (partial)` | — | Heavily cut by D-11 — versioning/audit/rollback kept as reproducibility infrastructure, the ~20-surface mutation UI cut. **Eight of twelve `/admin` sub-surfaces built**: status/overview, universe selector (draft→preview→activate→rollback, 100-cap, zero provider calls/row), settings (typed catalogue + D-15 thresholds, versioned), audit trail, cost ledger view, data explorer (rights/retention-filtered, audited every access), calculation issues. Models is read-only (mutation deferred). **Not built this pass:** data sources, jobs (F16b-owned — untouched, deliberately), user assumptions, coverage/replay. The uniform 8-step mutation contract (`services/admin/mutation.ts`) is real and enumerated-tested, not per-mutation copy-paste. Coordinator-verified independently: lint/typecheck clean, unit 1325/1325 on the full merged tree, contract 109/109, integration 364/364, build clean. A real cross-transaction bug was found and fixed during the build (settings activation couldn't see its own just-drafted, uncommitted config_version — fixed by committing the draft in its own transaction first). Known tradeoff: settings budget defaults seeded to D-32's $290/$320/$350, not §4.7's stale pre-D-20 $80/$90/$100. Deferred (trigger: a future pass): 20k-row perf benchmark (no seeded dataset), models mutation, user-assumptions/coverage-replay queues. See `progress/log/2026-09-05-f15-admin-control-plane.md` |
| F16b | Scheduler admin plane | 4 | `not started` | — | **Wave 4 half of F16**: admin-editable job rows, cadence editing, next-run preview, dry-run UI. Depends on F15 (this lane, merged) **and F16a (COLLECT, merged 2026-09-05)** — both prerequisites now satisfied |
| F17 | Architecture Explorer | 5 | `not started` | — | Manifest now carries `ScorerIdentity` and the MCP tool catalogue |
| F18 | Cost, budgets, degradation | 5 | `not started` | — | **Promoted.** X bills per read; the DB now has a paid tier. **D-32: X ceilings start at 0** and the global ceiling is the only budget control — enforce it before dispatch |
| F19 | Release hardening | 5 | `not started` | — | Copy lint extended: predictive vocabulary without a Tier D4 record fails the build |

Registry estimate: **48–64 h** for the Wave 1–2 block (F02, F07–F09), **52–70 h** for the
Wave 4–5 block (F15, F16b, F17–F19). See `../03-ROADMAP.md` §2.

## Wave 1 sequencing

**Nothing in this lane runs parallel in Wave 1** — which is not the same as nothing of this
lane's being *built* in Wave 1. **F02 is a Wave 1 feature and is built serially by the
walking-skeleton agent**, because Wave 1 puts the collector on a public URL and D-11 keeps OTP
for exactly that reason (`../03-ROADMAP.md` §3 Wave 1 settles this). It is listed here because
this lane owns its routes from Wave 2 onward. F01 builds the route shells; **F02 is unblocked as
of 2026-09-03 (D-26) and is this lane's first real feature**; F07–F09 are Wave 2 and open only once F06 merges — which is exactly
where F-11 puts them. This lane starts at the Wave 2 gate
(`../06-PARALLEL-LANES.md` §1b).

## What F01 left this lane

F01 built the shells this lane owns from Wave 2 onward — **all 23 pages and all 17 route
handlers of source §6.2**, each rendering a fixture state, plus the two pieces §4.6 exists for:
the `@calculationDrawer` parallel slot (with the `default.tsx` whose absence 404s the route) and
the `(.)calculations/[calculationId]` interception. `tests/e2e/routes.ts` is the executable list;
**a route added to the app and not to that list is a route the gate never opens.**

The three `check:*` scripts this lane owns are written, running and each proven by a
failing-case test. Two notes that matter when filling them out:

- `check:copy` extracts **quoted literals and JSX text**, not raw source — otherwise
  `AbortSignal` reports as the banned word "signal" on the first PR and the check gets switched
  off on the second. F19 §4.3 extends it; keep that property.
- `check:copy`'s D-09 clause and `check:calc-coverage` both read F05's method registry and both
  **pass on empty** today. Neither needs wiring when the registry lands.

## Blocked

| Feature | Blocker | What unblocks it |
|---|---|---|
| ~~F02~~ | ~~**MT-00** — admin email unconfirmed~~ | ✅ **Closed 2026-09-03 (D-26).** F02 is unblocked and is now this lane's Wave 1 work |

## Counters owned by this lane

| Counter | Value | Needed | Feature |
|---|---|---|---|
| Attention history depth (comparable snapshots) | 0 | ≥ 14 before the z-score renders | F08 |
| Projected monthly spend | $0 | < $350 (D-20) | F18 |
| X reads consumed this month | 0 | ≤ 30,000 (D-20) | F18 |

## In flight

**Updated 2026-09-05.** F15 merged (partial — see the Features table). F16b is now genuinely
unblocked (F15 and F16a, COLLECT, both merged) and is this lane's next pickup, followed by F17,
F18, F19 in wave order.

<details><summary>Prior state, retained for the record</summary>

**Updated 2026-09-04.** This section previously read "F08 not yet merged, no PR opened" — stale
against the git tree, which had F08 merged (PR #15, 55 rounds) and F09 merged (PR #16, 4 rounds)
by 2026-09-04 with no corresponding update here. Nothing is in flight in this lane right now;
F15–F19 (Waves 4–5) are `not started` and wait on their own prerequisites. See the Features table
above for both merges' round-by-round summary.

</details>

## Deferred from a DoD

| Item | Why | Named trigger |
|---|---|---|
| F07: honest provenance on synthesized `relevance_*`/`age_hours_*` inputs | `sectorBreadthInputs` synthesizes these rather than reading them from a real provider yet; tagged `provider: 'internal'` so a future reader cannot mistake them for provider-sourced data | The relevance/age pipeline these inputs actually describe (F10/F11, Wave 3) |

## Resolved defects

| Defect | Feature | Recorded |
|---|---|---|
| A CI-only OTP-rotation test flake, found while investigating F07's own CI run, was root-caused three PRs later to a genuine better-auth timing race, not an unrelated environment issue | F02 (found via F07) | `../MEMORY.md` **B-28** |
