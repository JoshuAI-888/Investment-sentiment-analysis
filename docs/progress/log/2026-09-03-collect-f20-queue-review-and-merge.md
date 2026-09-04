# 2026-09-03 — COLLECT — F20's queue-and-persistence half, five rounds of adversarial review

**Picked up mid-build.** The lease/drain/attempt-budget machinery, re-score, and
stance-availability's outage-abstention path were already implemented against the service half's
HTTP contract when this session started. The work here was closing five rounds of `lane-review`
to a genuine `PASS`.

## The review loop

Rounds 1–4 converged on the queue's charging/attribution model — recorded in full in `MEMORY.md`
**B-24**. In short: a per-item rejection counts toward `maxAttempts` only when the same scorer
response also admitted at least one other item, since that is the only evidence available that
the scorer itself is healthy and this specific item is at fault. A fully-rejected or solo-leased
item is never charged. Two earlier, cleverer attempts at this rule (tried and reverted during
these rounds) each introduced their own regression before this version survived four consecutive
review passes with no counter-example.

**Round 5** found a real bug in `drainScoringQueue`'s stop condition, which had drifted across
the charging-model rewrites: the real-outage check (`!outcome.scorerAvailable`) had been folded
together with the no-progress check in a way that could either mask a genuine outage behind a
pass that happened to make partial progress, or fail to stop a healthy-but-stuck pass. Fixed by
making the outage check unconditional and checked first, as its own `break`, deliberately kept
separate from the no-progress condition — recorded in `MEMORY.md` **B-23**.

**Round 6 (verification only)** confirmed the round-5 fix by mutation: commenting out the outage
check alone made the specific regression test fail ("does not keep hammering a dead scorer"), and
restoring it returned the suite to green. Also confirmed the disclosure comment describing the
charging trade-off matches today's actual code on every checkable claim, and flagged (not a
finding — informational) that the pre-existing test-database helper does not reliably recover
from a half-migrated `app_test`, which cost real time diagnosing spurious failures unrelated to
this diff.

## Verification

lint / typecheck clean. 590 unit, 39 contract, 114 integration (real Postgres, including a
simulated mid-drain scorer outage), all green. No e2e surface in this half.

## Merged

[PR #4](https://github.com/JoshuAI-888/Investment-sentiment-analysis/pull/4), CI green, no
merge conflict.

## Deferred

The real-model determinism suite (Tier D2 — byte-identical scores across batch sizes against the
actual pinned weights) remains the service half's open item; every test in this half runs
against a fake `ScoreBackend`/port and was never intended to exercise real model weights.
