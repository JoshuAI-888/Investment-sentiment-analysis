# 2026-09-04 — coordinator — attention_snapshot repository, and the OTP rotation flake

Two independent threads, closed in the same sitting: a cross-lane repository gap-fill (PR #8)
that had cleared three rounds of adversarial review, and a CI-only test failure (root-caused and
fixed as PR #9) that had been blocking both PR #8 and the earlier CI workflow fix (PR #6).

## The `attention_snapshot` repository (PR #8)

Scoping F08 (attention leaderboard) surfaced a structural gap: F08's spec requires persisting an
`attention_snapshot` per active symbol per run, idempotent per `(security_id, observed_at)` — and
F04's persistence half needs the same table. The migration and zod contract already existed
(`0002`/`0011`, `contracts/security.ts`); no repository function did. `src/repositories/` is
SPINE-owned, so neither F04 (COLLECT) nor F08 (SURFACE) could build this themselves. Dispatched a
narrowly-scoped SPINE task rather than letting either feature's build hit the wall separately.

`src/repositories/attention.ts`: `insertAttentionSnapshot` (idempotent — an exact repeat no-ops,
a genuine revision writes a successor row, never an UPDATE), `attentionSnapshotHistory` /
`latestAttentionSnapshot` (as-of-correct reads, optional `provider_methodology_version` filter),
and `countComparableAttentionSnapshots` (F06's z-score depth gate and F08's `HistoryDepth`, built
as a thin wrapper over the same history function so the two cannot drift on what "comparable"
means).

**Three rounds of adversarial `lane-review`.** Round 1 found two genuine bugs that would have let
a number cross a methodology boundary — `attentionSnapshotHistory`'s own docstring claimed to
serve F06's comparable-history use case while its query didn't filter by methodology at all, and
`countComparableAttentionSnapshots` applied that filter to raw, un-collapsed rows rather than the
as-of-collapsed winner per `observed_at`. Also found an idempotent-retry path that threw instead
of no-op'd on a reachable input (bound at the caller's own `ingestedAt` instead of the real
current instant), and an unhandled Postgres unique-violation on a genuine concurrent race. Round 2
found that two of round 1's own regression tests were still vacuous — a source-exclusion test
excluded by the as-of bound regardless of source, then (after that fix) still excluded by
`DISTINCT ON (observed_at)` collapsing it against a same-day row regardless of source. Round 3
confirmed all fixes hold under mutation and swept for further instances of the recurring "test
reads at a hardcoded `asOfInstant` while its insert defaults `ingestedAt` to the real wall clock"
defect — none remained.

Recorded to `MEMORY.md` **B-27**: the idempotency semantics and the "comparable" definition, both
precedent-setting for the next bitemporal snapshot table.

## The OTP rotation CI flake (PR #9)

`tests/integration/auth-otp-mechanics.test.ts`'s "rotates on resend" test had failed identically
on three unrelated PRs (F02's own merge, PR #6's one-line CI fix, PR #8 above), never reproduced
locally, and had been treated as an unrelated environment flake per the CI-red protocol (one
re-run spent, a standing-down comment posted on PR #6). After the third occurrence, read
better-auth's actual installed source (`plugins/email-otp/routes.mjs`,
`db/internal-adapter.mjs`) rather than continuing to dismiss it.

**Root cause:** with `resendStrategy: 'rotate'`, `resolveOTP` does not delete the prior
verification row before creating a new one on the normal path — only inside a `.catch()`
triggered by a storage conflict. It relies entirely on `findVerificationValue`'s
`ORDER BY createdAt DESC LIMIT 1` to prefer the newer row, with no secondary sort key. Two
`sendVerificationOTP` calls landing in the same millisecond tie on `createdAt`, and a tie has no
defined winner — a stable sort keeps the *first*-inserted row first, exactly backwards from what
rotation needs. CI runners' coarser timer resolution makes this far more reachable there than on
a fast local machine, which is why it never reproduced locally across 38+ attempts.

Proved the mechanism with a scratch reproduction test under a frozen fake clock (no time advance
between the two sends), which reproduced the exact CI failure signature locally and on demand.
Fix: wrap the real test in `vi.useFakeTimers()` and advance the clock 1000ms between the two
`sendVerificationOTP` calls — matching the fake-timer pattern already used elsewhere in the same
file for the "expired code" test. Scratch test deleted before committing.

This is a genuine finding about the auth system's behavior, not only a test artifact: two fast
resends in production could in principle tie the same way. Recorded to `MEMORY.md` **B-28**.

## Sequencing and merge

PR #9 merged first (`091f90e`). PR #6 and PR #8 were then each updated with a merge of `main` to
inherit the fix, re-verified green, and merged in turn (`b112ee6`, `315f6fb`). All three CI runs
green end to end; no test weakened or skipped to get there.

## Verification

PR #9: lint/typecheck clean, 819 unit, 129 integration (real Postgres). PR #8 (after inheriting
PR #9's fix): lint/typecheck clean, 819 unit, 53 contract, 147 integration (18 new/updated in
`attention.test.ts`), build clean. PR #6: CI-only change, verified by the same full gate now
running the e2e "End-to-end tests" step against a real `DATABASE_URL` instead of silently
skipping.

## Merged

- PR #9 → `main` at `091f90e` (squash).
- PR #6 → `main` at `b112ee6` (squash, after inheriting PR #9).
- PR #8 → `main` at `315f6fb` (squash, after inheriting PR #9).
