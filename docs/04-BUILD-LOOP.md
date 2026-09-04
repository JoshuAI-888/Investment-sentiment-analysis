# The Agentic Build Loop

> **Amended 2026-09-03 by the re-lock.** Three changes to the loop protocol:
> **(1)** CI spans **two deploy targets** now — the web app and F20's scorer service. A green web
> lane with a red scorer lane is the same hard stop R-12 already defines.
> **(2)** Before selecting work, check that **MT-08's collector is running.** Under D-16 there is
> no backfill, so a stopped collector is permanent data loss and outranks every feature on the
> board. If it is stopped, restart it and record a `CoverageGap` before doing anything else.
> **(3)** The self-review checklist in §5 gains the D-13 question: *did anything substitute a
> score when the scorer was unavailable?* The answer must be no — abstention is the only correct
> behaviour.
> See `MEMORY.md` §1b and `SPEC-REVIEW.md`.

> **Amended 2026-09-03 by the parallel-lane split (D-24).** The loop below is unchanged in
> substance. What changed is **who runs which part of it** when more than one builder works at
> once: build, verify and review are separate agents, and the coordinator alone selects work,
> opens PRs, merges and writes state. **`06-PARALLEL-LANES.md` is binding on role assignment**;
> this file remains binding on what each step must do. The §5 checklist is now executed by a
> reviewer with no write tools — see `06-PARALLEL-LANES.md` §2 for why that is a control and
> not an optimisation.

**Protocol:** one PR per feature, self-review gate (owner-selected).
**Governing rule:** the loop never grades its own homework on the merge decision. CI runs
independently; a locally-green / CI-red state is a hard stop
(`00-ADVERSARIAL-REVIEW.md` F-14).

---

## 1. Cold start

An agent beginning a session — first ever, or after a context reset — does exactly this:

```text
1. Read docs/MEMORY.md            (decisions, open questions, handoff brief)
2. Read docs/PROGRESS.md          (phase, wave gates, global counters, lane index)
3. Read docs/progress/<lane>.md   (your lane: features, blockers, counters)
4. Read docs/04-BUILD-LOOP.md     (this file)
5. Read docs/06-PARALLEL-LANES.md (who runs which step; skip if building solo)
6. Read docs/DEPLOY.md            (are the manual prerequisites met?)
7. git status && git log --oneline -10      (does the tree match the state files?)
```

If the tree and the state files disagree, **the tree wins**. Correct the lane file first,
record the discrepancy in `MEMORY.md` under Handoff notes, and only then pick work. A lane
agent does not correct state itself — it reports the discrepancy to the coordinator
(`06-PARALLEL-LANES.md` §4).

## 2. The loop

```
        ┌──────────────────────────────────────────────────────────┐
        │  SELECT   next unblocked feature from the lane file       │
        │  PLAN     restate the feature's DoD as a task list        │
        │  BUILD    implement to the feature spec, tests first      │
        │  VERIFY   run the feature's full test plan locally        │
        │  REVIEW   run the adversarial self-review checklist (§5)  │
        │  PR       open with the required body (§6); wait for CI   │
        │  GATE     CI green + DoD fully checked → merge            │
        │  RECORD   update the lane file and MEMORY.md; commit      │
        └──────────────────────────┬───────────────────────────────┘
                                   └──► next feature
```

At every boundary between those steps the coordinator runs the **context check**
(§3.1). It is a boundary condition, not a ninth step: no step is interrupted for it,
and no new step is entered while over the band.

### 2.1 SELECT

Pick the lowest-numbered feature **within the lane** whose dependencies are `merged` and whose
blocking `DEPLOY.md` tasks are resolved. Never start two features in the same lane at once, and
never more than three lanes at once (`06-PARALLEL-LANES.md` §6).

If the next feature is blocked, **skip to the next unblocked one** and write a line in the
lane file's §Blocked saying which feature, which blocker, and what would unblock it. Do
not idle, and do not work around a blocking manual task by faking the dependency — a stubbed
provider key is a lie the tests will later believe.

### 2.2 PLAN

Copy the feature's Definition of Done into the working task list verbatim, one task per
checkbox. The DoD *is* the plan. Add implementation subtasks under it, never instead of it.

### 2.3 BUILD

- Write the contract (zod schema / type) first, then the test, then the implementation.
- Fixtures before live calls: record a real payload once, commit it, develop against it
  (`PROVIDER_MODE=fixture`). Live calls burn quota shared with production (F-08).
- Touch only files this feature owns. Changing a shared contract mid-feature requires a
  `MEMORY.md` entry and an explicit note in the PR body.
- Commit in small, working increments. A commit that does not build is not a commit.

### 2.4 VERIFY

Run the feature's test plan in full — not the subset that changed:

```bash
pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:contract \
  && pnpm test:integration && pnpm test:e2e && pnpm build
```

Plus any feature-specific suite named in its spec (`test:eval`, `test:perf`, `test:chaos`).

**Never** make a test pass by weakening its assertion, skipping it, or widening a tolerance.
If an assertion is genuinely wrong, fix it in a separate commit whose message explains why
the original was wrong, and say so in the PR body.

### 2.5 REVIEW

Run §5 below. It is not optional and it is not a formality — the single most common failure
mode of this loop is an agent that builds correctly to a spec it misread.

**Under the parallel topology §5 is run by a different agent than the one that built the code,
holding no write tools** (`.claude/agents/lane-review.md`). A builder running its own checklist
re-reads the spec through the same misreading that produced the code, which is precisely the
failure the checklist exists to catch. The reviewer reads the spec before the diff, and reports
findings it cannot itself fix.

### 2.6 PR

Open against the designated branch with the body template in §6. Wait for CI. **CI red means
stop and fix** — never merge, never re-run hoping for green, never disable the failing job.

### 2.7 GATE

Merge when, and only when: CI is green on the pushed head; every DoD checkbox is genuinely
checked; the self-review checklist is complete; no product invariant
(`01-PRODUCT-SPEC.md` §6) is broken.

If a DoD item cannot be met, **do not silently drop it**. Move it to the lane file's
§Deferred with a reason and a named trigger, and say so in the PR body. A deferred DoD item
on a trust invariant blocks the merge outright.

### 2.8 RECORD

**The coordinator is the sole writer of state.** A lane agent reports; it never edits
`PROGRESS.md`, `progress/*.md` or `MEMORY.md`. One writer per file is what makes concurrent
lanes safe (`06-PARALLEL-LANES.md` §4).

`git pull --rebase origin main` first. Then every merge updates, in the same commit:

- `progress/<lane>.md`: feature → `merged`, date, PR link, test counts, anything deferred.
- `PROGRESS.md`: **only** if a wave gate moved, a global counter changed, or a feature was
  allocated to a lane. It is not touched on an ordinary merge — that is what makes it a stable
  file rather than the hottest one in the package.
- `MEMORY.md`: any decision made during the build, with rationale and rejected alternatives.
  A decision you had to think about for more than a minute belongs here.
- `progress/log/YYYY-MM-DD-<lane>-<slug>.md`: one new file per session. Never a row appended to
  a shared table — that conflicts on every concurrent write.

## 3. Context protocol

Context is a consumable like any other, and it is the only one whose exhaustion destroys
reasoning that was never written down. §3.1 is the routine check that keeps that from
happening; §3.2 is what to do when it happens anyway.

### 3.1 The context check — the coordinator's, at every step boundary

**The coordinator owns this check.** It runs at the boundaries between §2's steps — never
mid-step, and not on a timer. A lane agent holds its own context and does not compact the
coordinator's; a lane agent running low reports and hands back under §3.2.

| Context in use | What the coordinator does |
|---|---|
| **under 250k** | Nothing. Continue. |
| **250k – 300k** | **The band.** Finish to the next safe point, then compact there. Start no new feature, no new migration, and no full read of a large reference document. |
| **over 300k** | Start nothing. Drive to the nearest safe point by the shortest route and compact. If that is more than one step away, take §3.2 instead — a handoff beats a boundary you did not choose. |

Where the session exposes a token figure, read it. Where it does not, three proxies are
reliable enough to act on: two features merged in one session, any full read of a document in
`reference/`, or a transcript that has already survived one compaction.

**A safe point — all four true:**

1. The working tree is clean. Everything committed **and pushed**.
2. The gate is green, **or** its failure is diagnosed and the diagnosis is written down. A red
   gate whose cause is unknown is the least safe moment in the entire loop: the diagnosis
   exists only in context, and it is exactly what a summary drops.
3. RECORD (§2.8) is complete for anything merged — lane file, `MEMORY.md` if a decision was
   made, session log.
4. No half-applied migration, and no half-written module that another file already imports.

**Between GATE and RECORD is never safe.** The merge is durable in git; the reason for it is
in context and nowhere else.

**What the coordinator controls, and what it does not.** Compaction is invoked by the operator
(`/compact`) or fires automatically at the harness's own threshold. **The agent cannot schedule
it.** So this check is not "compact on reaching 250k" — it cannot be. It is: *from 250k onward,
keep the tree continuously compaction-safe*, so that whenever the boundary arrives — requested
or automatic — it lands on a safe point. Where an operator is present, say that the band has
been reached and that now is safe. Choosing the state, not the moment, is the whole of the
agent's control here.

**After compaction, the successor's first act is §1's cold start** — not a resumption from what
the summary appears to say. A summary is lossy by construction and its omissions are invisible
from inside it. The lane file and the session log are not lossy, which is the entire reason
§2.8 writes them.

### 3.2 When compaction is not enough

When the session is ending rather than compacting — do this **before** you are forced to, at
the first sign, not at the last:

1. Stop starting new work.
2. Bring your lane file — `progress/<lane>.md` — to the exact current truth, including work in
   flight and files half-written. A lane agent reports this state to the coordinator instead.
3. Write a **Handoff note**: a new file in `progress/log/`, plus a `MEMORY.md` §5 entry if a
   decision was involved. What you were doing, why, what you had just learned, what you were
   about to do next, and any trap you found.
4. Commit and push everything, including incomplete work, on a clearly named branch.
5. State plainly in the reply what is finished and what is not.

The successor's first act is §1. The handoff note is the only thing that makes that work.

## 4. Escalate to the human when

Stop and ask, rather than deciding, when:

- A **product invariant** (`01-PRODUCT-SPEC.md` §6) would have to bend to ship.
- A **provider entitlement failure** removes a capability a feature depends on (OQ-2).
- The **cost of a change** exceeds the budget, or a paid tier upgrade becomes necessary.
- Two feature specs **contradict** each other and both readings are defensible.
- Anything touching **legal, licensing, or user data** beyond what is already specified.
- A test failure implies the **spec itself is wrong**, not the code.

Everything else — naming, file layout, library choice within the stack, test structure,
copy that respects the invariants — decide it and record it in `MEMORY.md`.

## 5. Adversarial self-review checklist

Run before every PR. Answer each question with evidence, not intent.

### Correctness
- [ ] Does every DoD checkbox have a test that would **fail** if the behaviour regressed?
- [ ] Did I weaken, skip, or widen any existing assertion? (If yes: justified in the PR body?)
- [ ] What is the ugliest input this code can receive — empty set, single element, all-zero
      weights, a null price, a symbol that changed meaning, a 200-response with a null body?
      Is each one tested?
- [ ] Are there floats anywhere in an analytics path? (Must be decimal.)
- [ ] Divide-by-zero, clamping, and missing-input behaviour: specified in the registry *and*
      implemented the same way?

### Invariants
- [ ] Any LLM import in an analytics module? (Lint should catch it; check anyway.)
- [ ] Does any displayed number lack a `calculation_id`?
- [ ] Does any aggregate render without `n`, window, and source?
- [ ] Any banned vocabulary — "signal", "strong buy", "risk-on", "consensus", "Reddit
      sentiment" — in copy, test data, or fixture names?
- [ ] Could a provider key, DB URL, or admin flag reach a client bundle?
- [ ] Is every new mutation authorized **in the handler**, validated, versioned, and audited?
- [ ] Is every new priced call budget-checked **before** dispatch?

### Honesty
- [ ] Does anything I built imply coverage, precision, or prediction it does not have?
- [ ] Does the failure path show a real degraded state, or a plausible-looking empty one?
- [ ] If a provider returns garbage that parses, what does the user see?

### Fit
- [ ] Does this feature stay inside its lane, or did it redefine a shared contract?
- [ ] Is the diff minimal for what the spec asked, with no opportunistic refactoring?
- [ ] Would the next agent, reading only the spec and this diff, understand why?

## 6. PR body template

```markdown
## Feature
F## — <name>. Spec: `docs/features/F##-<slug>.md`

## What changed
<2–5 sentences. What a reviewer needs to know before reading the diff.>

## Definition of Done
<the feature's DoD, copied, with each box genuinely checked or explicitly deferred>

## Verification
| Suite | Result |
|---|---|
| lint / typecheck | |
| unit | |
| contract | |
| integration | |
| e2e | |
| feature-specific | |

CI run: <link>

## Self-review
<the §5 checklist, with the answer to anything that was not a trivial "no">

## Invariants
Confirmed intact: <list any of `01-PRODUCT-SPEC.md` §6 this feature could have broken>

## Deferred
<DoD items moved to the lane file, with reason and trigger — or "none">

## Decisions recorded
<MEMORY.md entries added — or "none">

## Risks
<what a reviewer should look hardest at>
```

## 7. Merge order and branch discipline

- All work lands on the designated branch **`main`**. (The former designated branch
  `claude/spec-driven-agentic-plan-tm44an` was merged on 2026-09-03 and no longer exists as a
  target.)
- Feature branches: `feat/F##-<slug>`, rebased on `main` before the PR. Under the parallel
  topology each lane builds in **its own git worktree**, so three lanes never share a checkout.
- Merge order follows the dependency graph in `03-ROADMAP.md` §2. An out-of-order merge that
  compiles is still a defect — it means a dependency was stubbed.
- Migrations are owned by whichever feature introduces the table, and are never edited after
  merge. A change to a merged migration is a new migration.

## 8. What the loop must never do

- Merge with CI red, or disable a failing check to get green.
- Weaken a test, tolerance, or threshold to pass.
- Drop a trust invariant to hit a wave boundary.
- Scrape X or Stocktwits under any circumstance.
- Hardcode a model ID, a secret, or a live provider value into application logic.
- Fabricate a provider response outside a clearly-named fixture.
- Report a feature as done when a DoD item was silently skipped.
- Cross a context boundary mid-step, or between GATE and RECORD (§3.1). The merge
  survives; the reason for it does not.

Under the parallel topology, additionally (`06-PARALLEL-LANES.md` §8):

- A lane agent writing state, opening a PR, or merging.
- A lane agent editing a path another lane owns — `src/contracts/` belongs to SPINE. A needed
  contract change is reported, never made in place.
- The coordinator reviewing its own build.
- More than three builders at once.
- Spawning a fresh agent to act on review findings instead of messaging the one that holds the
  context.
