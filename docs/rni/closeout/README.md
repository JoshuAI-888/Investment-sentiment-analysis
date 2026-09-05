# RNI 1.0 closeout — multi-session launch guide

**Status:** execution plan only; this document is not owner approval and does not close G6, G7,
or G8.

This directory turns the remaining RNI 1.0 blockers into gated work waves. Each wave file contains
complete, paste-ready prompts for isolated Codex code sessions. Do not start a downstream wave
until the coordinator has integrated, verified, committed, and pushed the prior wave's checkpoint.

## Wave order

| Wave | Outcome | May run in parallel |
|---|---|---|
| [Wave 0](WAVE-0-DECISION-FREEZE.md) | Owner-approved semantics and frozen acceptance fixtures | No |
| [Wave 1](WAVE-1-IDENTITY-AND-RELEASE.md) | D-RNI-34, multi-security completion, and D-RNI-33 | DATA + ENGINE only after the coordinator foundation |
| [Wave 2](WAVE-2-ACQUISITION-AND-READINESS.md) | Manifest-bound acquisition and durable readiness receipts | DATA + ENGINE after contract freeze |
| [Wave 3](WAVE-3-CONFIDENCE-AND-PUBLICATION.md) | Approved confidence method and post-E08 publication gate | DATA + ENGINE + SURFACE after contract freeze |
| [Wave 4](WAVE-4-PRODUCTION-COMPOSITION.md) | Non-fixture executor, authority-input inventory, and offline G6 evidence | Composition and read-only reviews; no overlapping writers |
| [Wave 5](WAVE-5-LIVE-AND-CLOSEOUT.md) | Bounded G7 evidence and explicit G8 production approval | Independent source checks only when the coordinator permits |

The current Wave 0 proposal is
[`WAVE-0-OWNER-DECISIONS.md`](WAVE-0-OWNER-DECISIONS.md). It has no implementation authority until
`joshuai` approves its exact text or supplies explicit replacements.

## How to create every code session

1. In Codex, create a **new task** for the saved investment-sentiment-analysis project.
2. Choose a **worktree**, not the saved checkout. Set the starting branch to
   `feat/rni-integration-demo` or to the later coordinator checkpoint named in the wave file.
3. Use the session title shown in the relevant wave file.
4. Select the recommended model and reasoning level. If that exact model is unavailable, use the
   next more capable model; do not substitute a weaker model for migration design, policy
   decisions, or adversarial review.
5. Paste the wave's launch prompt verbatim as the first message. Replace only values inside
   `<angle brackets>`.
6. Let the session stop at its defined handoff. Do not ask it to merge, deploy, activate a
   configuration, use paid providers, or edit another session's paths.
7. Give the returned commit SHA and handoff report to the coordinator session. The coordinator
   reviews and integrates one commit at a time, reruns the required gates, updates coordinator-owned
   progress, and pushes the next checkpoint.

## Base-checkpoint rule

Every writing session must begin from the exact pushed coordinator checkpoint for its subwave.
If the expected commit is not an ancestor of `HEAD`, the session must stop without editing. Never
start several sessions from a dirty shared checkout and never copy uncommitted changes between
worktrees.

The two provisional files below are deliberately outside the accepted production path and must not
be added, wired, deleted, or committed by any session:

```text
apps/web/src/rni/repositories/rni-workflow-source.ts
apps/web/tests/integration/rni/rni-workflow-source.test.ts
```

## Concurrency and ownership

- Maximum concurrent builders: one DATA, one ENGINE, and one SURFACE session.
- The coordinator is the only writer of Migration `0024`, shared contracts, composition roots,
  `docs/rni/PROGRESS.md`, and `docs/rni/progress/INTEGRATION.md`.
- Only the DATA session edits `docs/rni/progress/DATA.md`; only ENGINE edits
  `docs/rni/progress/ENGINE.md`; only SURFACE edits `docs/rni/progress/SURFACE.md`.
- A reviewer is read-only and never shares a writing worktree with a builder.
- Provider I/O stays outside database transactions. Reddit and X never share fallback, coverage,
  counts, or publication authority.

## Model allocation

| Work | Recommended model | Reasoning |
|---|---|---|
| Owner decision synthesis, shared contract, migration, final review | `gpt-6-astra` | high or xhigh |
| Bounded DATA/ENGINE implementation | `gpt-5.6-sol` | high |
| Mechanical composition, UI fixtures, routine regression | `gpt-5.6-terra` | medium |
| Mechanical test inventory, hash inventory, evidence-index formatting | `gpt-5.3-codex-spark` | high |

Spark is useful only after semantics are frozen, for deterministic and easily checked work. Do not
use it to choose financial methodology, design migrations, adjudicate source rights, interpret
ambiguous failures, review security boundaries, or authorize live/production actions.

## Standard builder handoff

Every writing session must finish with:

```text
RNI SESSION   <session id and lane>
BASE SHA      <sha>
STATUS        READY_FOR_REVIEW | BLOCKED | PARTIAL
SCOPE         <completed deliverable; incomplete items only>
TESTS         <exact command/suite and pass/fail/not-run>
DECISIONS     <decision IDs consumed; no new assumptions>
RISKS         <open risks or none>
FILES         <all touched paths>
COMMIT        <single commit sha, or none if blocked>
```

## Coordinator integration prompt

Use this after each builder returns a commit:

```text
You are the RNI integration coordinator. Work from the latest pushed
feat/rni-integration-demo checkpoint in an isolated worktree. Read AGENTS.md, CLAUDE.md,
docs/features/RNI-00-CONTRACT.md, docs/rni/AGENTS.md, docs/rni/RNI_BUILD_LOOP.md,
docs/rni/PROGRESS.md, docs/rni/progress/INTEGRATION.md, and the current wave file in full.

Review builder commit <BUILDER_SHA> against session <SESSION_ID>'s exact scope and the approved
decision IDs. Confirm its base is the expected coordinator checkpoint and inventory every changed
file before integrating. Reject ownership crossings, invented policy, weakened tests, secret
access, provider calls, or changes to the two excluded provisional files. Integrate one builder
commit at a time, resolve findings in coordinator-owned paths only, run the wave's narrow and
integrated gates serially where PostgreSQL state can collide, and request an independent read-only
review. Update only coordinator-owned progress after acceptance. Commit and push the accepted
checkpoint, then report its SHA and which next sessions are unblocked. Do not merge the PR,
activate configuration, run paid/live providers, or claim G6/G7/G8 without their explicit gates.
```
