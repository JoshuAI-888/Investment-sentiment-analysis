# 2026-09-03 — F01, foundation and quality gates

**Lane:** — (serial prerequisite; no lane existed until it merged)
**Branch:** `main` · **Outcome:** merged, full gate green on both deploy targets

## What was built

The first application code in the repository. Eleven DoD items, all met.

| Piece | Where |
|---|---|
| pnpm workspace, Next.js 15 App Router, TypeScript strict | `apps/web/` |
| Env schema, zod, fail-fast at module load | `apps/web/src/env.ts` |
| Five architectural lint rules | `apps/web/eslint-rules/` |
| Three custom CI checks | `apps/web/scripts/` |
| Every route in source §6.2 as a fixture shell | `apps/web/app/` |
| The scorer CI lane and its placeholder | `services/scorer/` |
| CI across both deploy targets | `.github/workflows/ci.yml` |
| ADR-001..019 with review amendments applied | `docs/adr/` |
| Provider rights | `docs/provider-rights.md` |

**Counts:** 120 unit tests · 44 e2e cases · 16 scorer cases.

## Four rulings, recorded in `../../MEMORY.md` §2b

**B-01** — two source §6.3 keys are not implemented: `LINKUP_API_KEY` (D-12 dropped Linkup) and
`FEATURE_HF_SHADOW` (R-19 cut shadow evaluation, and the name trips the DoD's own `HF_`
assertion). F01 §4.2 already flags §6.3 as predating D-12/D-13; recording the omissions rather
than making them silently.

**B-02** — requiredness in the env schema is a function of `PROVIDER_MODE`. A flat required set
would force CI to invent dummy keys, and a dummy key is indistinguishable from a real one at the
point where it matters.

**B-03** — the scorer placeholder validates F20 §3's contract rather than stubbing it, and does
not go away when F20 lands.

**B-04** — `check:bundle` now checks module identity, not only payload. See below.

## The one real defect found, and it was found by running the thing

F01 §5 asks that `check:bundle` fail on a deliberately-leaked import. So the leak was built: a
`'use client'` component importing `env.ts`, the lint rule suppressed, the app rebuilt.

**`check:bundle` reported pass.**

`env.ts` opens with `if (typeof window !== 'undefined') throw`. In a client bundle that folds to
`true`, the minifier reduces the module to an unconditional `throw`, and everything after it —
including every key name the scanner looks for — is dropped as dead code. The guard worked, and
by working it blinded the check.

That is the worst shape a gate can have. It reports pass exactly when the defence it backstops
is doing the work, and it would keep reporting pass right up until someone deleted that guard as
"browser-dead code anyway", at which point the values ship and nothing changed colour in between.

Fixed by giving the guard a machine-readable token — `[server-only:env.ts]` — and making
`check:bundle` treat it as a banned pattern in its own right. The check now asserts the **import
edge**, not just the payload, and any future server-only module adopting the same guard is
covered for free. Re-run against the same leak: fails. Regression test added.

**The lesson, which is the same one the pre-build audit recorded in a different costume.** Both
findings came from checking the *mechanism* against the *claim* rather than reading the claim
twice. There: a banner that added scope no DoD ever gained. Here: a check whose passing was
evidence of nothing.

## What the next session should know

- **The Dockerfile has never been built.** No Docker daemon in this session. CI's `scorer` job is
  its first execution — watch that job on the first run.
- **The `--passWithNoTests` flag** is on `test:contract`, `test:integration` and `test:eval`.
  Those suites are legitimately empty in Wave 1 (F03 owns the tables, F12 the eval corpus). The
  alternative was a fake placeholder test, which is worse — it makes an empty suite look
  populated. Remove the flag from each suite as it gains its first real case.
- **CI's integration job already has ephemeral Postgres.** F03 lands into a working lane rather
  than having to build one underneath itself.
- `next-env.d.ts` is **committed deliberately**: CI typechecks before it builds, and Next only
  regenerates that file during dev/build.

## Next

Wave 1's walking skeleton: SPINE runs F03 → F22 → F05 serially. COLLECT's two D-24 carve-outs
(F20's service half, F04's adapter and fixture layer) are now both startable in parallel.
