# F02 — Authentication, Authorization, and User-Data Lifecycle

> **Amended 2026-09-03 by the re-lock.** **D-11: heavily cut.** There is one operator. OTP sign-in is kept — the app sits on a public URL in front of paid providers. **Cut:** open signup, the `pending` tier, the OTP throttle machinery, per-account budgets, share grants, the issue queue. **MT-10's legal read and the user-data lifecycle spec are void** (OQ-4 closed) — there are no third-party data subjects. ~~**MT-00 still blocks this feature**~~ — **MT-00 closed 2026-09-03 (D-26): `joshuaifang@gmail.com`**, the source PRD's spelling. This feature is unblocked. The boot assertion still ships: it is what makes a later regression visible in the deployment log. **The send cap is ratified by D-28** (§4.2).
> See `../MEMORY.md` §1b for the decisions and `../SPEC-REVIEW.md` for the reasoning.

> **Amended by D-37 — OTP replaced with email+password.** The owner asked directly to drop
> six-digit codes for email+password, self-service sign-up, allowlist-gated. **Everything else
> D-11/D-28 decided is unchanged** — one account, no open population, the send cap on the one
> mail path — only the credential mechanism moved. §4.1, §4.2, §4.5, §5, §6, §7, §8 below are
> rewritten for this; §2–§4.4 carry small wording updates only. See `../MEMORY.md` D-37 for the
> full reasoning, including why self-service sign-up needed `requireEmailVerification` to stay
> safe and a real deployment pitfall (`BETTER_AUTH_URL`) the old OTP flow never had.

> **Amended by D-38 — multi-account (already mostly built via the allowlist) plus a second,
> seeded onboarding path.** `ADMIN_EMAIL_ALLOWLIST` was already multi-address; this decision adds
> the ability to sign in with a known constant, `welcome1`, which silently provisions a
> pre-verified account (for any allowlisted address with none yet) flagged to force a real
> password before anything else is reachable. New route: `/change-password`. New error class:
> `PasswordChangeRequiredError`, thrown by `requireUser()` and handled at every existing call
> site the same way `UnauthenticatedError` already is. §4.1, §4.6 (new), §5, §6 below are
> updated. Full reasoning, including why the shared-password window is an accepted trade-off and
> how `mustChangePassword` is kept unreachable by any client that would benefit from forging it,
> is in `../MEMORY.md` D-38.

> **Amended by D-39 — self-service sign-up opened to any address; a real member tier.** The
> owner asked directly to let anyone sign up, not only `ADMIN_EMAIL_ALLOWLIST` addresses. **This
> reopens D-11's population question deliberately** — there is no longer "one account" — but
> reuses structure that already existed rather than building a new tier concept:
> `requireUser()`-gated ("member+") surfaces (`/dashboard`, ticker/social pages, `/api/dashboard`,
> `/api/search`) were already distinct from `requireAdmin()`-gated `/admin/*` routes (F07 §2/§4.6
> called this split out explicitly before D-39 existed). Removing `databaseHooks.user.create.
> before`'s allowlist check (`instance.ts`) is the only change that matters structurally: anyone
> can now become a `requireUser()`-level member, and `requireAdmin()`'s live-allowlist check
> (unchanged) is what still keeps `/admin/*` to the addresses in `ADMIN_EMAIL_ALLOWLIST`.
> **Not reopened:** the `welcome1` seeded path (`seed-account.ts`) — it keeps its own,
> independent allowlist check and stays operator-onboarding-only, since a shared bootstrap
> password must never be something an open member signup can trigger. `decideAndSend`
> (`send-decision.ts`) also drops its allowlist check — the send cap (D-28, a **global** window,
> not per-address) is what now bounds mail volume across an open population, matching what it
> already bounded before. §4.1, §4.2, §5, §6 below need re-reading with this in mind (their text
> is not yet rewritten for D-39 the way D-37/D-38 rewrote it for their own changes) —
> in particular §4.2's "allowlist before account creation" row and §6's DoD item "a
> non-allowlisted address cannot become a user in `live` mode" are **superseded, not satisfied**.
> **Also reopened, not addressed by this decision alone:** `../DEPLOY.md` MT-10 (the privacy/
> legal read) — its own text already said the obligation "would return the moment anyone else
> gets an account," and that moment is now. This still needs a `../MEMORY.md` entry recording
> D-39 formally; write access to that file is reserved to whoever plays coordinator for this
> repo, so it is flagged here rather than added by the change that made it necessary.

**Wave:** 1 · **Lane:** **SURFACE** — but built serially in Wave 1 by the skeleton agent (`../03-ROADMAP.md` §3) · **Estimate:** 14–18 h · **Depends on:** F01
**Blocking manual task:** `../DEPLOY.md` **MT-00** (admin email verification) — this feature
must not merge until MT-00 is answered.

## 1. Purpose

A person can sign in with an email and password; exactly one identity can reach the admin
plane; and the system's spend cannot be driven by a stranger with an email address
(`../00-ADVERSARIAL-REVIEW.md` F-04). Also establishes what user data we hold and what
deletion means (F-18).

## 2. Scope

> **Body reconciled to the D-11 banner 2026-09-03 by the pre-build audit.** The banner above
> recorded the cut on the re-lock pass; §2, §4.2, §4.3, §5, §6 and §7 below still specified the
> `pending` tier, the throttle table and the lifecycle document in full. They are corrected here.

**In:** Better Auth email+password with Resend-delivered verification and password-reset
links; session management; the admin allowlist and server-side authorization helper; the
allowlist-before-account-creation rule (§4.2); account deletion and export.

**Out:** the **`pending` tier**, open signup with no allowlist gate, the OTP throttle
machinery, per-account budgets, share grants, the issue queue — **all cut by D-11**; the
**user-data lifecycle document** (void with MT-10 — there are no third-party data subjects);
per-account *spend* budgets (the global ceiling is the only budget control, F18); admin UI
(F15); social login, SSO, org tenancy — all permanently out.

## 3. Contracts

**Produces:** `Session`, `requireUser()`, `requireAdmin()`.
**Void under D-11:** `AccountTier` and `requireTier()`. There is one account and it is `admin`;
a tier enum with one member is machinery pretending to be a policy.
**Must not redefine:** anything in `../02-ARCHITECTURE-CONTRACTS.md` §4.

## 4. Build spec

### 4.1 Email + password flow (D-37)

Better Auth's core `emailAndPassword` + `emailVerification` config; Resend transport; sender
`welcome@accounts.joshuai.nz`.

- **Password**, hashed by Better Auth's own credential provider — never a field this codebase
  defines, never logged. Minimum 12 characters.
- **Self-service sign-up, allowlist-gated.** `/sign-up` accepts any address, but
  `databaseHooks.user.create.before` refuses to create a user for any address other than
  `ADMIN_EMAIL_ALLOWLIST` (in `live` mode — see below). This runs inside Better Auth's own
  user-creation path regardless of entry point, the same structural placement the old
  `emailOTP` plugin's send hook gave the allowlist check.
- **`requireEmailVerification: true` is load-bearing, not a nicety.** The allowlist only checks
  the *address*, not who is typing it — anyone can submit the real admin's known-public address
  at `/sign-up` with a password of their own choosing. Requiring the mailed verification link
  before the account can sign in means an attacker who does not control the real mailbox can
  create an unverified row and nothing else; the real owner still owns the only path to a
  *usable* account.
- **The allowlist gate is `live`-mode only, deliberately** (`isAccountCreationAllowed`,
  `src/services/auth/allowlist.ts`) — mirrors `decideAndSend`'s own fixture short-circuit under
  the old OTP flow. Fixture mode has no live mailbox and nothing real to protect; what it does
  need is the ability to create a genuinely non-allowlisted, signed-in session so
  `tests/e2e/auth.spec.ts` can prove `requireAdmin()`'s negative path independent of whether such
  an account could ever exist for real.
- Sessions: httpOnly, secure, sameSite=lax, rotate on sign-in, server-side revocable.
- Forgotten-password: a mailed, single-use, expiring link (`requestPasswordReset` /
  `resetPassword`), gated by the same allowlist-and-send-cap discipline as verification mail.

### 4.2 Abuse controls (F-04, mandatory)

**Cut by D-11, and here is what replaces it.** The four-row table this section used to carry
(per-email, per-IP, and global send limits, Redis-backed) defended an open-signup threat model
that no longer exists. With no signup population beyond one allowlisted address, **two rules do
the work**:

| Rule | Behaviour |
|---|---|
| **Allowlist before account creation** | An address not on `ADMIN_EMAIL_ALLOWLIST` never becomes a user, in `live` mode. The check lives in `databaseHooks.user.create.before`, not a wrapper a caller could bypass |
| Verification/reset mail to the allowlisted address | Capped per hour and per day, below the Resend free-tier allowance |

Sign-up itself is **not** required to be enumeration-resistant the way OTP's request-code call
was: unlike a broadcast endpoint that fires for any input, sign-up only ever succeeds for the one
address, and that address is already public knowledge to anyone who has seen the app (D-28's own
point). A clear "not authorized" / "account already exists" message leaks nothing new and is
better UX than a fake generic success. The password-reset **request**, however, keeps the
old generic-response discipline in full — it is a broadcast endpoint the same way OTP's
request-code was.

> **✅ RATIFIED BY THE OWNER, 2026-09-03 (D-28). The send cap stands.** It is no longer an audit
> reading — it is a decision, and reversing it needs a `MEMORY.md` entry like any other.
>
> The reasoning, for whoever reads this next. D-11 cuts "the OTP throttle machinery" without
> qualification, and read literally that removes the send cap too. But the single allowlisted
> address is public knowledge to anyone who has seen the app, and Resend's free tier allows
> 100 sends/day — so without a cap, **anyone who knows the address can lock the owner out of
> their own system**, with no credential and no vulnerability. That is a denial of service
> against a one-user product, and it is the exact failure the old global breaker prevented.
> It survives D-11 because it was never about multi-tenancy, and it survives D-37's move to
> passwords for the same reason: the mail path — now verification and reset links rather than
> codes — is exactly as public-address-exploitable as before.
>
> **The distinction D-28 draws:** what D-11 cut was the per-email, per-IP and global *throttling
> tables*, which policed a user population that does not exist. What survives is **one constant**
> capping sends to **one** address. Do not "simplify" it away on the grounds that single-user
> systems do not need rate limits — single-user is precisely why this one matters.

### 4.3 Accounts — void (D-11)

There is one account, seeded from `ADMIN_EMAIL_ALLOWLIST`, and it is `admin`. The
`pending`/`member`/`admin` enum, the promotion flow and the tier gate on priced paths are cut
with open signup: with one account there is no one to promote and nothing to gate against.

**What replaces the tier gate on spending:** the **global** budget ceiling (D-20, `../DEPLOY.md`
MT-12), enforced by F18 before dispatch. `00-ADVERSARIAL-REVIEW.md` F-04 called a global stop
"a damage report, not a defence" — true against many accounts, not against one. With a single
actor the global ledger *is* the per-account ledger.

### 4.4 Authorization

`requireAdmin()` compares the **normalized** email (lowercase, trimmed, gmail dot/plus
normalization documented explicitly) against `ADMIN_EMAIL_ALLOWLIST`.

Non-negotiable: authorization is called **inside every admin route handler and server
action**. A layout-level check is presentation, not authorization, and a PR relying on one
is rejected.

**Boot assertion (F-15):** at startup, assert the allowlist is non-empty and every entry is
a syntactically valid address; log the configured admin address (not a secret) at info level
so a typo is visible in the first deployment log rather than at the first admin click.

### 4.5 User-data lifecycle (F-18)

`docs/user-data.md`, a deliverable of this feature:

| Data | Store | Retention | On account deletion |
|---|---|---|---|
| Email, account, tier | `user` | life of account | deleted |
| Sessions | `session` | 30 days | deleted |
| Password hash, verification/reset tokens | `account` / `verification` | life of account / until used or expired | deleted |
| Assumption profiles | `user_assumption_profile` | life of account | deleted |
| Share grants | `calculation_share` | until revoked | **revoked**, then deleted |
| Issue reports | `calculation_issue` | permanent | **anonymised, not deleted** — audit trail |
| Audit entries naming the user | `audit_event` | permanent | **anonymised** |
| Research runs | `research_run` | 90 days | user link removed; run retained |

Deletion is self-service, confirmed, and idempotent. Export returns the user's own rows as
JSON. Both are tested.

### 4.6 The seeded `welcome1` path (D-38)

A second way an allowlisted address gets its first credential, alongside self-service sign-up:

- `signInWithPassword` (`flow.ts`) always tries a normal sign-in first. Only on failure, and
  only when the submitted password is exactly `WELCOME_PASSWORD` (`'welcome1'`,
  `seed-account.ts`), does it call `provisionSeedAccountIfEligible` and retry once.
- Provisioning writes the user and its credential account **directly through
  `auth.$context.internalAdapter`**, bypassing `signUpEmail`'s route — the account is created
  **pre-verified** (`emailVerified: true`) and flagged `mustChangePassword: true`, since knowing
  the shared temporary password is itself the out-of-band proof self-service sign-up otherwise
  needs a mailed link for. Still runs through `databaseHooks.user.create.before`, so the same
  `live`-mode-only allowlist gate (§4.2) applies.
- `mustChangePassword` is declared `input: false` — no client can set or clear it via any public
  request body. The only writers are `provisionSeedAccountIfEligible` (sets it) and
  `clearMustChangePassword` (clears it, reached only after `auth.api.changePassword` verifies the
  caller's current password), both via `$context.internalAdapter` directly.
- `requireUser()` throws a new `PasswordChangeRequiredError` for a session with the flag still
  set. Every existing call site that already catches `UnauthenticatedError` (§4.4's
  non-negotiable — every admin route/action, plus the two `requireUser()`-gated surfaces) catches
  this too, redirecting to `/change-password` (pages) or answering 401 (API routes) — not a new
  discipline, the same one applied to a second error class.
- `/change-password` (new route) calls `getSession()` directly, never `requireUser()`, and is
  reachable by **any** signed-in session, not only a flagged one — voluntary password changes and
  the forced reset share one implementation. `changePassword` sets `revokeOtherSessions: true`
  unconditionally: the moment a caller proves they hold the current password is also the right
  moment to end any other session that raced them to a shared `welcome1`.

## 5. Test plan

| Level | Cases |
|---|---|
| Unit | password hashing (via Better Auth, asserted never plaintext); email normalization incl. the gmail dot/plus cases; allowlist matching positive and negative; `isAccountCreationAllowed` per provider mode; `provisionSeedAccountIfEligible`/`clearMustChangePassword` against the real singleton; `signInWithPassword`'s welcome1 fallback, including that a stray guess never touches an existing real-password account; `changePassword`'s three outcomes |
| Contract | Resend send payload (a verification/reset link, not a code) matches the fixture; a Resend 429 surfaces as a typed error, never a stack trace to the user |
| Integration | sign-up creates an unverified user; sign-in is refused until verified; a correct verification link signs in; a wrong password is refused; forgot-password → reset → sign in with the new password, old one no longer works; deletion cascades exactly per the migrations |
| E2E | sign-up, verify, sign in with a password all reach the dashboard; a wrong password is refused, the correct one still works afterwards; an unverified account cannot sign in; forgot password → reset link → sign in with the new password; **a non-allowlisted address is refused every operator route** (the Wave 1 exit gate, `../03-ROADMAP.md` §3); deletion then sign-up creates a fresh account; a nonexistent address signs in with `welcome1` and is redirected to `/change-password` from every protected route, not just one; a wrong non-`welcome1` guess creates nothing; a real account is unaffected by a stray `welcome1` guess; a signed-in user can voluntarily visit `/change-password` |
| Feature-specific | password-reset-request enumeration probe: an allowlisted-looking and an arbitrary address get identical response bodies |

## 6. Definition of Done

- [ ] MT-00 answered and the configured admin address verified against a real sign-in.
- [ ] Passwords are hashed at rest (Better Auth's own mechanism) and appear in no log, error,
      or response.
- [ ] An account cannot sign in until its verification link has been used; proven by a test.
- [ ] A non-allowlisted address cannot become a user in `live` mode; proven by a test.
- [ ] The verification/reset send cap is enforced and tested.
- [ ] The password-reset request is generic: an allowlisted-looking and an arbitrary address
      get the same response.
- [ ] No `AccountTier`, `requireTier()`, `pending` tier or `SIGNUP_MODE` exists anywhere in
      the codebase (D-11).
- [ ] Every admin route **and** every admin server action calls `requireAdmin()` in its own
      body; a negative-authorization E2E covers each.
- [ ] Boot assertion on the allowlist exists and fails loudly on an empty or malformed value.
- [ ] Account deletion and export work, are idempotent, and are tested.
- [ ] No credential, session secret, password, or token reaches a client bundle.
- [ ] `mustChangePassword` is `input: false`; a test proves the public `sign-up`/`update-user`
      endpoints refuse to set or clear it from a request body.
- [ ] A session with `mustChangePassword` set is refused by every protected page/route it was
      previously let through — not asserted on one page and assumed for the rest.
- [ ] `changePassword` clears the flag and revokes other sessions; proven by a test that the old
      credential (`welcome1` or otherwise) stops working afterwards.

## 7. PR review steps

1. Grep the whole diff for plaintext password/token handling — logs, errors, test output,
   Resend body.
2. List every admin route and action; confirm each calls `requireAdmin()` in its own body.
   A single missed handler is a merge blocker.
3. Attempt the E2E negative-auth path manually against a preview deployment.
4. Read the deletion path against the migrations. Does deletion actually do what it claims?
5. Confirm `databaseHooks.user.create.before` is `live`-mode only, on purpose, and that the
   e2e non-admin suite depends on that being true — a reviewer who "fixes" it to run
   unconditionally silently deletes that suite's ability to build its own test fixture.
6. Request a password reset for an address that is **not** on the allowlist; confirm the
   response is indistinguishable from the allowlisted path.
7. Grep the diff for `pending`, `AccountTier`, `requireTier`, `SIGNUP_MODE`. Any hit is a
   merge blocker (D-11).
8. Grep the diff for `mustChangePassword` used anywhere in a client-reachable request body path
   (any route or action that echoes a body field of that name into `auth.api.updateUser`/
   `signUpEmail` un-filtered). It must be written only via `seed-account.ts`'s two functions.
9. Confirm every one of the 21 call sites that already handled `UnauthenticatedError` also
   handles `PasswordChangeRequiredError` (page: `redirect('/change-password')`; API route: same
   401 branch as unauthenticated). A new protected page/route added later that forgets this is
   the same class of gap §4.4's non-negotiable already exists to prevent for admin authorization.

## 8. Risks and open questions

| Risk | Mitigation |
|---|---|
| **OQ-1**: admin email may be misspelled in the PRD | MT-00 blocks the merge; boot assertion catches a late regression |
| Resend domain not fully verified ⇒ links land in spam | MT-02; test with a non-Gmail address too |
| A stranger submits the known admin address at `/sign-up` | `requireEmailVerification` means the resulting account cannot sign in without the real mailbox; harmless noise, not a takeover |
| `BETTER_AUTH_URL` unset or wrong in production | Mailed links are absolute and host-scoped; `../DEPLOY.md` MT-02 calls this out explicitly, and `../MEMORY.md` D-37 records how this was found |
| The send cap is read as the throttle machinery D-11 cut, and removed | §4.2 records why it survives and that it wants owner ratification. It is one row, not machinery |
| **D-38**: someone else claims an allowlisted address's account with `welcome1` before its real owner does | Accepted, named trade-off of any shared-default-password scheme (`../MEMORY.md` D-38) — mitigated by telling the real owner promptly, and by `changePassword`'s unconditional `revokeOtherSessions: true` closing the window the moment they set a real password |
| A future call site adds a protected page/route and forgets the `PasswordChangeRequiredError` catch | §7 review step 9; the same class of omission §4.4 already guards against for `requireAdmin()` |
