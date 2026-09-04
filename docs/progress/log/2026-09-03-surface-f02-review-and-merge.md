# 2026-09-03 — SURFACE — F02, closing out three rounds of adversarial review

**Picked up mid-build.** F02's OTP flow, abuse controls, admin/settings-account route gating, and
account deletion/export were already implemented when this session started; the work here was
running the adversarial `lane-review` loop to a genuine `PASS` and merging.

## The review loop

**Round 1** fixed the route-gating gap this feature exists to close — admin and
`/settings/account` routes needed splitting out of the shared `PAGE_ROUTES` e2e list — and a
mailer-failure result that was being discarded unconditionally: whatever Resend actually did, the
caller was told `sent`, the send cap was already spent, and there was no application-level record
of why. `send-decision.ts` now surfaces a typed `send_failed` outcome instead.

**Round 2** found the fix for round 1's route split had introduced its own bug: the new
admin-positive e2e suite risked being vacuous, since nothing had ever proven `requireAdmin()`
itself does the refusing rather than some other layer. Verified by sabotage — replacing
`requireAdmin()`'s body with an unconditional throw and confirming the positive suite actually
failed. Also found and fixed a concurrent-delete race in account lifecycle (`getSession()`'s
early-return branch made a second *sequential* call idempotent without exercising the deeper
`APIError`-swallow branch at all; a *concurrent* second call could still race past it).

**Round 3** found two tests that didn't bind to the behaviour they claimed to test — not defects
in the fix itself, but in the proof of it. The timing-equalizer enumeration test stubbed the
mailer at 150ms, only 30ms under the 180ms floor — so removing the floor still produced a `<
120ms` timing difference by coincidence, and the test passed on both the fixed and the broken
code. Fixed by dropping the stub to 10ms and adding a direct assertion that the floor was reached
(`sentElapsed >= 170`), verified by mutation. Also found a stale e2e comment claiming
`ADMIN_EMAIL_ALLOWLIST` was unset in fixture mode — true until this same build's round 2 started
setting it for the admin-positive suite — which could have led a future agent to switch the
negative suite's random test email to a fixed one and silently invert what it proves.

## Verification

lint / typecheck clean. 526 unit, 25 contract, 114 integration (real Postgres), 63 e2e
(Playwright/Chromium), build clean. Every round-2/3 fix verified by deliberately breaking the
underlying code, confirming the specific new or updated test fails for the right reason, then
restoring.

## Merged

[PR #3](https://github.com/JoshuAI-888/Investment-sentiment-analysis/pull/3), CI green, no
merge conflict.

## Deferred

`docs/user-data.md`'s six data-class rows outside Better Auth's own tables
(`user_assumption_profile`, `calculation_share`, `calculation_issue`, `audit_event`
anonymisation, `research_run` user-link removal) still need repository functions SPINE has not
built. `deleteMyAccount`/`exportMyData` name exactly which classes they did not reach rather than
silently claiming full coverage.
