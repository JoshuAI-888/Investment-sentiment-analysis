# Parallel Lanes — running the build loop with subagents

> **RNI ownership addendum (2026-09-05):** RNI uses temporary DATA, ENGINE and SURFACE lanes with
> the non-overlapping path map in `rni/RNI_BUILD_LOOP.md`. The existing SPINE/COLLECT/SURFACE
> ownership remains unchanged for non-RNI work. The coordinator still alone merges and writes
> master state.

**Status:** Binding. Decision `MEMORY.md` D-24.
**Relationship to `04-BUILD-LOOP.md`:** that file defines the loop. This one defines **who runs
which part of it** when more than one builder is working at once. Where they conflict, the loop
wins on *what* must happen and this file wins on *who* does it.

---

## 1. The shape

```
                        ┌──────────────────────────────┐
                        │        COORDINATOR           │
                        │  (the main session, Opus)    │
                        │                              │
                        │  SELECT · GATE · RECORD      │
                        │  sole writer of all state    │
                        └──┬────────┬────────┬─────────┘
              brief        │        │        │        report
        ┌──────────────────┘        │        └──────────────────┐
        ▼                           ▼                           ▼
  ┌───────────┐              ┌───────────┐              ┌───────────┐
  │  SPINE    │              │  COLLECT  │              │  SURFACE  │
  │ lane-build│              │ lane-build│              │ lane-build│
  │ worktree  │              │ worktree  │              │ worktree  │
  └─────┬─────┘              └─────┬─────┘              └─────┬─────┘
        │  per feature, in the lane's own worktree            │
        ▼                                                     ▼
   lane-verify  (Haiku, no write tools)  ── runs the full gate, returns a verdict
        ▼
   lane-review  (Opus, no write tools)   ── the §5 adversarial checklist, on the diff
        ▼
   back to COORDINATOR → PR → CI → merge → state write
```

**The one rule that makes this safe:** a lane agent produces code and a report. It never
writes `PROGRESS.md`, `progress/*.md` or `MEMORY.md`, never opens a PR, never merges, and
never edits a path another lane owns. Every one of those is the coordinator's.

## 1b. What actually runs in parallel, and when

`03-ROADMAP.md`'s structural rule **F-11** says Wave 1 is a walking skeleton built by a single
agent, and that parallel lanes start in Wave 2 against contracts that have survived a live
round trip. **That rule stands.** Three lanes running from the moment F01 merges would violate
it, and the reason F-11 exists is a real one: a lane built against a contract that has not
survived a round trip is work that gets thrown away.

So the parallelism is phased, and the honest picture is narrower than "three lanes from day
one":

| Phase | SPINE | COLLECT | SURFACE |
|---|---|---|---|
| **F01** | — serial, single agent, no lane — | | |
| **Wave 1** | F03 → F22 → F05, **serial** — this *is* the skeleton | F20 service half; F04 adapter + fixture layer **only** | nothing *as a lane* — **F02 is still built in Wave 1**, serially, by the skeleton agent (`03-ROADMAP.md` §3 Wave 1) |
| **Wave 2 →** | F06 | F04 persistence, F16a | F02, F07 → F09 |
| **Wave 4–5** | — | — | F15, F16b, F17 → F19 |

**The Wave 1 carve-out (D-24) is scoped to exactly F-11's own test: a lane may run early only
if it consumes no domain contract F03 has not yet proven.** Two things pass that test:

- **F20's service half** — its own language, its own deploy target, and an HTTP contract
  defined in `features/F20-scorer-service.md` §3 that depends on nothing in `src/`. Its
  queue-and-persistence half does not qualify and waits for F03.
- **F04's adapter and fixture layer** — it *produces* `ProviderResult` rather than consuming
  domain schemas, and Substack RSS needs no key and has zero lead time. Its persistence wiring
  waits for F03.

Everything else in Wave 1 is serial. **Full three-lane parallelism begins at the Wave 2 gate.**

This matters more than it looks: the carve-out is what lets collection start earlier, and under
D-16 an earlier collector is the one thing in this plan that cannot be bought back later.

## 2. Why the roles are split this way

The package's governing rule is that **the loop never grades its own homework**
(`04-BUILD-LOOP.md`, `00-ADVERSARIAL-REVIEW.md` F-14). A single agent that builds, then runs
its own review checklist, satisfies the letter of that rule and not the substance — it is the
same context, with the same misreading of the spec baked in. §5 names this as the loop's most
common failure mode: *an agent that builds correctly to a spec it misread.*

Separating build from review is therefore not a token optimisation. It is the control. The
reviewer holds **no write tools**, so it structurally cannot quietly fix what it should be
reporting, and it reads the diff cold — which is the only way a misread spec surfaces.

`lane-verify` is split off for a different reason: test output is bulky and mechanical. Running
the gate in a cheap agent that returns a verdict keeps thousands of lines of stack trace out of
both the builder's and the coordinator's context, at no quality cost, because nothing about
running `pnpm test` needs judgement.

## 3. Role assignment

| Role | Definition | Model | Tools | Isolation |
|---|---|---|---|---|
| Coordinator | the main session | Opus | all | — |
| `lane-build` | `.claude/agents/lane-build.md` | **Sonnet** — Opus for F05, F20, F22 | full | **worktree** |
| `lane-verify` | `.claude/agents/lane-verify.md` | **Haiku** | Bash, Read, Grep | — |
| `lane-review` | `.claude/agents/lane-review.md` | **Opus** | Read, Grep, Glob, Bash | — |
| scout | built-in `Explore` | Haiku | read-only | — |

**Where Opus is worth paying for, and why those three:**

- **F05** — the calculation kernel. Every trust invariant in the product runs through the
  artifact, the hashing and the replay. A subtle error here is inherited by every number the
  system will ever display.
- **F22** — `../docs/features/F22-pit-corpus.md` §1: *this is the feature that cannot be
  retrofitted.* Under D-16 there is no backfill. Every other feature can be rebuilt later.
- **F20** — the determinism guarantee (Tier D2) is the thing the whole re-lock rests on, and
  "byte-identical across batch sizes" is exactly the kind of requirement that is easy to
  satisfy approximately.

Everything else runs Sonnet. The feature specs in this package are unusually prescriptive —
files, schemas, formulas, states and routes are named, and §6 is a checkbox list. That is the
condition under which a mid-tier model performs like a top-tier one: the hard thinking is
already in the spec.

## 4. The state-write rule

**The coordinator is the sole writer of `PROGRESS.md`, `progress/*.md` and `MEMORY.md`.**

This is what actually removes the merge conflict. Single-writer-*per-lane-file* (§D-24) makes
concurrent writes safe; single-writer-*full-stop* makes them impossible. The lane files remain
split anyway, because they are the unit of assignment, they keep each lane's brief small, and
the split is what lets this work degrade gracefully into three separate accounts with no
coordinator at all — where per-lane ownership becomes the only defence.

Writes happen at exactly one moment: **RECORD**, after CI is green and the merge has landed.

## 4b. The three files no lane owns

The lane files partition `apps/web/src/` cleanly — SPINE takes `contracts/`, `repositories/`,
`calc/`, `analytics/` and `migrations/`; COLLECT takes `services/scorer/`, `adapters/`,
`services/jobs/` and `fixtures/`; SURFACE takes `app/`, `ui/`, `tests/e2e/` and the three
`check:*` scripts. **Three files fall outside that partition and are written by every lane.**
The partition looks complete without them, which is exactly why they need naming: a rule with an
uncovered case reads as airtight right up to the merge that hits it.

| File | Who writes it | Rule |
|---|---|---|
| `apps/web/src/env.ts` | F04 and F20 (COLLECT), F18 (SURFACE) — F01 §4.2 says so explicitly: it ships the *mechanism*, not the final key set | **Append-only, one block per feature**, each headed with the owning `F##`. Never reorder or regroup another feature's keys. A conflict here is then two adjacent blocks, and the resolution is always *keep both* |
| `apps/web/package.json` | any lane adding a dependency | Add only your own dependency; never bump another's. Alphabetical within its block so two additions rarely collide |
| `apps/web/pnpm-lock.yaml` | consequence of the above | **Never hand-merge a lockfile, and never take one side of it.** On conflict: take `main`'s, re-run `pnpm install`, commit what it generates. `05-TEST-STRATEGY.md` §8 runs `--frozen-lockfile`, so a hand-merged lockfile that resolves cleanly in git still fails CI |

`docs/progress/log/` is the fourth shared path and is already handled — one file per session, plus
`merge=union` in `.gitattributes` as a second line of defence.

**Why this is not just tidiness.** These three conflict on *every* concurrent PR that adds a
dependency or a key, regardless of how well the lanes respect their owned paths. They are the
reason "three lanes never clash" is true of source files and false of the repository.

## 5. The report contract

A lane agent's final message to the coordinator is this and nothing else. Fixed shape, because
the coordinator pays for every report and needs to compare them.

```
LANE      <spine|collect|surface>
FEATURE   F## — <name>
BRANCH    feat/F##-<slug>
STATUS    complete | blocked | partial
DoD       <n>/<m> checked — list only the unchecked, each with a reason
SUITES    lint · typecheck · unit · contract · integration · e2e · build   (pass/fail each)
CONTRACTS none | <what I need changed in src/contracts/, and why>
DECISIONS <MEMORY.md candidates, one line each, or "none">
DEFERRED  <DoD items to move to the lane file, reason + trigger, or "none">
RISKS     <what review should look hardest at>
FILES     <paths touched — the coordinator checks these against the lane's owned paths>
```

`FILES` is not decoration. It is how the coordinator catches a lane that reached outside its
paths, which is the failure that corrupts a parallel build.

## 6. The parallel loop

**Before anything:** F01 merges. There is no repository to be parallel in until it does, and
F01 builds the CI that every later gate depends on. One agent, no lane.

Then, per feature:

1. **SELECT** — coordinator reads `PROGRESS.md` and the three lane files, picks the next
   unblocked feature *per lane*, and checks its `DEPLOY.md` blockers. At most **three**
   `lane-build` agents in flight; beyond that the coordinator's own context fills with reports
   and it stops being able to gate anything properly.
2. **BRIEF** — coordinator spawns `lane-build` with a worktree and a *small* brief (§7).
3. **BUILD** — the agent works the feature to its spec, tests first, committing in its worktree.
4. **VERIFY** — the builder calls `lane-verify` on its own worktree and iterates until green.
   A red gate never leaves the lane.
5. **REPORT** — the builder returns §5's block and stops. It does not open a PR.
6. **REVIEW** — coordinator spawns `lane-review` against the branch diff. Its verdict is
   `PASS`, or a numbered list of findings. Findings go back to the same `lane-build` agent
   via `SendMessage`, which keeps its context — a fresh agent would re-derive everything.
7. **PR + CI** — coordinator opens the PR with `04-BUILD-LOOP.md` §6's body, and waits.
   **CI red is a hard stop**, exactly as before. Independent CI is the entire point of F01.
8. **GATE + RECORD** — coordinator merges, then writes the lane file, `PROGRESS.md` if a wave
   gate moved, `MEMORY.md` for decisions, and one file in `progress/log/`.

## 7. Keeping the brief small

Each subagent starts cold, so **the brief is the dominant cost, not the model.** A build agent
needs, and should be given, only:

- its feature spec — `docs/features/F##-*.md`, 110–200 lines;
- `02-ARCHITECTURE-CONTRACTS.md` §3–§5 — layering, shared contracts, data model;
- `04-BUILD-LOOP.md` §2.3–§2.5 — build, verify, and the never-do list;
- its own lane file — owned paths, blockers;
- the §5 report contract.

That is roughly 500 lines. **Do not hand a lane agent `reference/SOURCE-PRD-v1.5.md`** — it is
4,486 lines, the feature specs already cite the sections that matter, and loading it wholesale
in three lanes at once is the single most expensive mistake available here. If an agent needs
one PRD section, name the section.

## 8. What the parallel loop must never do

Everything in `04-BUILD-LOOP.md` §8 still holds, plus:

- A lane agent must never write state, open a PR, or merge.
- A lane agent must never edit a path another lane owns — including `src/contracts/`, which
  belongs to SPINE. A needed contract change is reported, not made.
- The coordinator must never review its own build. If the coordinator writes code, it spawns
  `lane-review` for that code like any other.
- Never run more than three builders concurrently.
- Never spawn a fresh agent to act on review findings. `SendMessage` the one that has the
  context; a cold agent re-derives, and re-deriving is where misreadings enter.
