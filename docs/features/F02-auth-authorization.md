# F02 — Authentication, Authorization, and User-Data Lifecycle

> **Amended 2026-09-03 by the re-lock.** **D-11: heavily cut.** There is one operator. OTP sign-in is kept — the app sits on a public URL in front of paid providers. **Cut:** open signup, the `pending` tier, the OTP throttle machinery, per-account budgets, share grants, the issue queue. **MT-10's legal read and the user-data lifecycle spec are void** (OQ-4 closed) — there are no third-party data subjects. ~~**MT-00 still blocks this feature**~~ — **MT-00 closed 2026-09-03 (D-26): `joshuaifang@gmail.com`**, the source PRD's spelling. This feature is unblocked. The boot assertion still ships: it is what makes a later regression visible in the deployment log. **The send cap is ratified by D-28** (§4.2).
> See `../MEMORY.md` §1b for the decisions and `../SPEC-REVIEW.md` for the reasoning.

**Wave:** 1 · **Lane:** **SURFACE** — but built serially in Wave 1 by the skeleton agent (`../03-ROADMAP.md` §3) · **Estimate:** 14–18 h · **Depends on:** F01
**Blocking manual task:** `../DEPLOY.md` **MT-00** (admin email verification) — this feature
must not merge until MT-00 is answered.

## 1. Purpose

A person can sign in with a six-digit code sent to their email; exactly one identity can
reach the admin plane; and the system's spend cannot be driven by a stranger with an email
address (`../00-ADVERSARIAL-REVIEW.md` F-04). Also establishes what user data we hold and
what deletion means (F-18).

## 2. Scope

> **Body reconciled to the D-11 banner 2026-09-03 by the pre-build audit.** The banner above
> recorded the cut on the re-lock pass; §2, §4.2, §4.3, §5, §6 and §7 below still specified the
> `pending` tier, the throttle table and the lifecycle document in full. They are corrected here.

**In:** Better Auth email-OTP with Resend delivery; session management; the admin allowlist
and server-side authorization helper; the allowlist-before-send rule (§4.2); account deletion
and export.

**Out:** the **`pending` tier**, open signup, the OTP throttle machinery, per-account budgets,
share grants, the issue queue — **all cut by D-11**; the **user-data lifecycle document**
(void with MT-10 — there are no third-party data subjects); per-account *spend* budgets (the
global ceiling is the only budget control, F18); admin UI (F15); social login, passwords, SSO,
org tenancy — all permanently out.

## 3. Contracts

**Produces:** `Session`, `requireUser()`, `requireAdmin()`.
**Void under D-11:** `AccountTier` and `requireTier()`. There is one account and it is `admin`;
a tier enum with one member is machinery pretending to be a policy.
**Must not redefine:** anything in `../02-ARCHITECTURE-CONTRACTS.md` §4.

## 4. Build spec

### 4.1 OTP flow

Better Auth email-OTP plugin; Resend transport; sender `welcome@accounts.joshuai.nz`.

- Six digits, **hashed at rest** (never stored or logged in plaintext), 5-minute expiry,
  3 attempts, rotate on resend, single-use.
- **Generic responses**: request-code and verify return the same shape and timing whether or
  not the address exists. No account enumeration.
- Sessions: httpOnly, secure, sameSite=lax, rotate on sign-in, server-side revocable.

### 4.2 Abuse controls (F-04, mandatory)

**Cut by D-11, and here is what replaces it.** The four-row table this section used to carry
(per-email, per-IP, and global send limits, Redis-backed) defended an open-signup threat model
that no longer exists. With no signup, **one rule does the work of all three**:

| Rule | Behaviour |
|---|---|
| **Allowlist before send** | An address not on `ADMIN_EMAIL_ALLOWLIST` never reaches Resend. The refusal is generic and indistinguishable from the allowlisted path, so it leaks nothing |
| Sends to the allowlisted address | Capped per hour and per day, below the Resend free-tier allowance | 
| Verify attempts per code | 3, then the code is invalidated |

The verify-attempt cap is **not** throttling and is not cut — it is what makes a six-digit code
resistant to guessing, and the banner keeps OTP sign-in in full.

> **✅ RATIFIED BY THE OWNER, 2026-09-03 (D-28). The send cap stands.** It is no longer an audit
> reading — it is a decision, and reversing it needs a `MEMORY.md` entry like any other.
>
> The reasoning, for whoever reads this next. D-11 cuts "the OTP throttle machinery" without
> qualification, and read literally that removes the send cap too. But the single allowlisted
> address is public knowledge to anyone who has seen the app, and Resend's free tier allows
> 100 sends/day — so without a cap, **anyone who knows the address can lock the owner out of
> their own system**, with no credential and no vulnerability. That is a denial of service
> against a one-user product, and it is the exact failure the old global breaker prevented.
> It survives D-11 because it was never about multi-tenancy.
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
| OTP records | `verification` | 5 min + 24 h audit | deleted |
| Assumption profiles | `user_assumption_profile` | life of account | deleted |
| Share grants | `calculation_share` | until revoked | **revoked**, then deleted |
| Issue reports | `calculation_issue` | permanent | **anonymised, not deleted** — audit trail |
| Audit entries naming the user | `audit_event` | permanent | **anonymised** |
| Research runs | `research_run` | 90 days | user link removed; run retained |

Deletion is self-service, confirmed, and idempotent. Export returns the user's own rows as
JSON. Both are tested.

## 5. Test plan

| Level | Cases |
|---|---|
| Unit | code hashing; expiry; attempt counting; rotation on resend; email normalization incl. the gmail dot/plus cases; allowlist matching positive and negative |
| Contract | Resend send payload matches the fixture; a Resend 429 surfaces as a typed error, never a stack trace to the user |
| Integration | the send cap against a real Redis; a non-allowlisted address never reaches Resend; deletion cascades exactly per the migrations |
| E2E | full sign-in; wrong code ×3 invalidates; expired code refused; **a non-allowlisted address is refused every operator route** (the Wave 1 exit gate, `../03-ROADMAP.md` §3); deletion then sign-in creates a fresh account |
| Feature-specific | account-enumeration probe: existing vs non-existing address produce identical response bodies and comparable timings |

## 6. Definition of Done

- [ ] MT-00 answered and the configured admin address verified against a real sign-in.
- [ ] OTP codes are hashed at rest and appear in no log, error, or response.
- [ ] Expiry, attempt cap, rotation, and single-use are each proven by a test.
- [ ] Responses do not reveal whether an address has an account.
- [ ] An address not on the allowlist never reaches Resend, and its refusal is
      indistinguishable from the allowlisted path.
- [ ] The send cap and the verify-attempt cap are each enforced and tested.
- [ ] No `AccountTier`, `requireTier()`, `pending` tier or `SIGNUP_MODE` exists anywhere in
      the codebase (D-11).
- [ ] Every admin route **and** every admin server action calls `requireAdmin()` in its own
      body; a negative-authorization E2E covers each.
- [ ] Boot assertion on the allowlist exists and fails loudly on an empty or malformed value.
- [ ] Account deletion and export work, are idempotent, and are tested.
- [ ] No credential, session secret, or OTP reaches a client bundle.

## 7. PR review steps

1. Grep the whole diff for plaintext OTP handling — logs, errors, test output, Resend body.
2. List every admin route and action; confirm each calls `requireAdmin()` in its own body.
   A single missed handler is a merge blocker.
3. Attempt the E2E negative-auth path manually against a preview deployment.
4. Read the deletion path against the migrations. Does deletion actually do what it claims?
5. Request a code for an address that is **not** on the allowlist; confirm Resend was never
   called and the response is indistinguishable from the allowlisted path.
6. Grep the diff for `pending`, `AccountTier`, `requireTier`, `SIGNUP_MODE`. Any hit is a
   merge blocker (D-11).

## 8. Risks and open questions

| Risk | Mitigation |
|---|---|
| **OQ-1**: admin email may be misspelled in the PRD | MT-00 blocks the merge; boot assertion catches a late regression |
| Resend domain not fully verified ⇒ codes land in spam | MT-02; test with a non-Gmail address too |
| Timing side-channel reveals account existence | Constant-ish response path; asserted in the enumeration test |
| The send cap is read as the throttle machinery D-11 cut, and removed | §4.2 records why it survives and that it wants owner ratification. It is one row, not machinery |
