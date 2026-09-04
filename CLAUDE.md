# Repository guide

This repository is the **Barebone Social Sentiment** build: a spec-driven agentic engineering
package for a social sentiment dashboard, plus the application code it produces.

`archive/` was removed from the repository in a deliberate history reset (2026-09-04). Nothing
in the current tree should reference it — see the note below for what that changes.

## Cold start

```text
1. docs/MEMORY.md            decisions — read §1b before §1, then §1c — and open questions
2. docs/PROGRESS.md          phase, wave gates, global counters, lane index
3. docs/progress/<lane>.md   your lane: features, blockers, counters
4. docs/04-BUILD-LOOP.md     the loop protocol
5. docs/06-PARALLEL-LANES.md who runs which step (skip if building solo)
6. docs/DEPLOY.md            are the manual prerequisites met?
```

**Do not read `docs/reference/SOURCE-PRD-v1.5.md` in full** — 4,486 lines. The feature specs
cite the sections that matter.

For RNI work, use the separate cold start in `AGENTS.md` and `docs/rni/AGENTS.md`. The binding
contract is `docs/features/RNI-00-CONTRACT.md`; it overrides legacy requirements only inside
the RNI paths it names. Do not infer that an RNI exception changes the existing product.

## Build lanes

| Lane | Owns | Features |
|---|---|---|
| SPINE | migrations, contracts, repositories, calc, analytics | F03, F22, F05, F06 |
| COLLECT | scorer service, adapters, job services, fixtures | F20, F04, F16a |
| SURFACE | app routes, ui, e2e, the three `check:*` scripts | F02, F07–F09, F15, F16b, F17–F19 |

Subagents are defined in `.claude/agents/`: `lane-build` (Sonnet, worktree), `lane-verify`
(Haiku, no write tools), `lane-review` (Opus, no write tools). Protocol:
`docs/06-PARALLEL-LANES.md`.

## Non-negotiable, whatever the task

- The coordinator is the **sole writer** of `docs/PROGRESS.md`, `docs/progress/*.md` and
  `docs/MEMORY.md`. A lane agent reports; it never edits state, opens a PR, or merges.
- Never edit a path another lane owns. `src/contracts/` belongs to SPINE — a needed contract
  change is reported, not made.
- Never weaken, skip or widen a test to get green. Never merge with CI red.
- Never scrape X or Stocktwits.
- Under D-16 collection is forward-only with **no backfill**. A stopped collector is permanent
  data loss and outranks every feature on the board.
- Analytics modules import nothing with I/O and use decimals, never floats. A raw JS `number`
  in an analytics module is a review failure.

## `archive/` — removed 2026-09-04

The repository's git history was reset by the owner on 2026-09-04, and `archive/` (`finsent/`,
`approach-comparison/`, and `README-two-project-index.md`) was dropped in that reset — a
deliberate choice, not an accident, confirmed by the owner. Nothing under `archive/` exists in
the tree any more.

**D-18's port is abandoned, not fulfilled.** D-18 (`docs/MEMORY.md`) called for porting finsent's
evaluation harness — `archive/finsent/src/backtest/{engine,pit}.py` plus its `test_pit_leakage.py`
and `test_parity.py` — into F12 as a versioned module with its own tests. That source no longer
exists to port. **F12's evaluation harness (PIT correctness, cross-sectional IC, Newey–West t,
decay curve, momentum-residualised IC, horizon-normalised P&L) must be built from scratch when
F12 is picked up**, not assumed available from an archive that is gone. See `MEMORY.md` D-18 for
the full superseding note.

## Git

Development branch: `main`. Feature branches `feat/F##-<slug>`, rebased on `main` before the PR.
Each parallel lane builds in its own git worktree so lanes never share a checkout.
