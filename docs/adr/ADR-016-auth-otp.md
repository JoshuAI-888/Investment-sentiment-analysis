# ADR-016 — Authentication is email OTP delivered by Resend

**Status:** **Cut to single-account OTP by D-11.** Addressed by D-26, ratified by D-28.
**Source:** `../reference/SOURCE-PRD-v1.5.md` §1.1.

## What was cut, explicitly

The original allowed **open account creation for any successfully verified email**, with
"every verified user" reaching application and public-safe architecture routes and one address
holding `admin`.

**D-11 cut all of it.** There is **one account**, seeded from `ADMIN_EMAIL_ALLOWLIST`. Open
signup is void, and so is the `pending` tier that `../00-ADVERSARIAL-REVIEW.md` F-04 asked for
as a mitigation. F-04's mitigation is recorded as **expired, not forgotten** — a reader
arriving from that finding must be able to see which of the two happened.

Four environment keys go with it, and F01's DoD asserts that none appears anywhere in the
codebase: `SIGNUP_MODE`, `ACCOUNT_DAILY_RESEARCH_LIMIT`, `ACCOUNT_MONTHLY_COST_LIMIT_USD`,
`OTP_DAILY_GLOBAL_LIMIT`.

## What is kept, in full

**OTP authentication itself.** D-11 cut the *throttling* machinery, not the auth: it was the
throttle that had no threat model left once there was one account.

- Six-digit codes from `welcome@accounts.joshuai.nz`, expiring after five minutes, three
  attempts, rotating on resend, **stored hashed**.
- Authorization is checked **server-side on every admin read and mutation** — not in a layout,
  not in middleware alone.
- **D-26:** the administrator address is `joshuaifang@gmail.com`.
- **D-28:** the OTP **send cap stands**. It is ratified rather than inherited, and it is not to
  be simplified away on the grounds that there is only one account — the cap bounds what an
  attacker can spend of our Resend allowance, which is unrelated to how many accounts exist.

## Consequences

- Per-account budget controls are gone, which makes D-20's **global** ceiling the only budget
  control — more load-bearing than it was, not less (`../DEPLOY.md` MT-12).
