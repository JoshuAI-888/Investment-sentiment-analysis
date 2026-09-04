# Repository guide

This repository is the **Barebone Social Sentiment** build: a spec-driven agentic engineering
package for a social sentiment dashboard, plus the application code it produces.

Everything in `archive/` is retired. Nothing outside it should reference it, with one named
exception recorded below.

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

## `archive/` — retired, with one live dependency

| Path | What it is | Status |
|---|---|---|
| `archive/finsent/` | A PIT-correct financial sentiment-drift pipeline for Databricks. Broker notes and news; no social sources. 103 tests passing on synthetic data; never run against real data. | Retired by D-18. **Do not delete** — see below |
| `archive/approach-comparison/` | The ranked comparison and SWOT of four approaches, plus the source of the retired GitHub Pages site. §11 records what was decided. | Historical. Site retired by D-25 |
| `archive/README-two-project-index.md` | The old root README, from when this repository held two projects. | Historical |

**The one live dependency:** **D-18 ports finsent's evaluation harness into F12** —
`archive/finsent/src/backtest/{engine,pit}.py` with `archive/finsent/tests/test_pit_leakage.py`
and `test_parity.py`. It is ported as a **versioned module with its own tests**, never imported
across the boundary. D-18 also asks that finsent's Challenge 1 — whether sentiment drift is
roughly collinear with 12-1 price momentum — be run early, as the cheapest available
falsification of this project.

finsent's own `docs/{spec,memory,progress}.md` are archived with it. **Their locked decisions do
not apply to this build**, and this build's decisions do not apply to them.

## Git

Development branch: `main`. Feature branches `feat/F##-<slug>`, rebased on `main` before the PR.
Each parallel lane builds in its own git worktree so lanes never share a checkout.
