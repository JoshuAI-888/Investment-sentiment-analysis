# User data — what is held, for how long, and what deletion does

**A deliverable of F02** (`docs/features/F02-auth-authorization.md` §4.5). MT-10 is void under
D-11 — there is one account, held by the owner, with no signup path and no third-party data
subjects — but this document still exists: it is what makes a later regression to open signup
answerable without re-deriving the question from scratch, and it is the input the retired MT-10
task would have used if it were ever reopened.

## What is held

| Data | Store | Retention | On account deletion |
|---|---|---|---|
| Email, account | `user` | life of account | deleted |
| Sessions | `session` | 30 days | deleted |
| OTP records | `verification` | 5 min + Better Auth's own housekeeping | deleted |
| Assumption profiles | `user_assumption_profile` | life of account | deleted — **not yet wired, see below** |
| Share grants | `calculation_share` | until revoked | revoked, then deleted — **not yet wired, see below** |
| Issue reports | `calculation_issue` | permanent | anonymised, not deleted — audit trail — **not yet wired, see below** |
| Audit entries naming the user | `audit_event` | permanent | anonymised — **not yet wired, see below** |
| Research runs | `research_run` | 90 days | user link removed; run retained — **not yet wired, see below** |

This table is the spec's §4.5 table, unchanged. The right column is stated exactly, including
where it is not yet true, because the alternative — silently narrowing the promise to match
the code — is the one thing this document exists to prevent.

## What F02 actually built, and what it did not

`src/services/auth/lifecycle.ts` implements deletion and export for exactly the first three
rows above: `user`, `session`, and `verification` (the last is Better Auth's own housekeeping,
cleared as part of deleting the user). Both are:

- **self-service** — reachable from `/settings/account`, no admin action needed;
- **confirmed** — the UI requires an explicit second click (`AccountPanel.tsx`'s "Confirm
  delete") before the delete action runs;
- **idempotent** — a second deletion call finds no session (the account is already gone) and
  returns success rather than an error, whether the two calls are sequential or racing each
  other (`tests/unit/services/auth/lifecycle.test.ts`, exercising `deleteMyAccount`/
  `exportMyData` themselves — `tests/integration/auth-lifecycle.test.ts` proves the underlying
  Better Auth mechanics generically, one layer below either function);
- **tested** — including the property this document exists to name: signing in again after
  deletion creates a genuinely fresh account, not a resurrection of the old one.

The remaining five rows — `user_assumption_profile`, `calculation_share`,
`calculation_issue`, `audit_event`, `research_run` — are **not reachable from this feature**.
They need repository functions (`src/repositories/`) that do not exist yet: nothing in
`apps/web/src/repositories/` today reads, deletes or anonymises any of those tables scoped to a
user. That absence is reported under this feature's `CONTRACTS` note to SPINE, not silently
worked around. `deleteMyAccount()` and `exportMyData()` both return an explicit
`unimplementedDataClasses` list naming exactly these five, so a caller — human or code — can
never mistake "the auth rows are gone" for "the account is fully deleted".

## Why this scope, and not a workaround

Two paths were available once the gap was found: build a version of deletion that silently
skips the rows it cannot reach, or build the two rows it *can* reach honestly and name the rest.
The first would have let this DoD box be checked while `docs/user-data.md`'s own table quietly
stopped being true — exactly what `04-BUILD-LOOP.md` §8 forbids ("report a feature as done when
a DoD item was silently skipped"). The second is what is here: `deleteMyAccount` does less, but
everything it claims to do, it does, and everything it does not do is named in its own return
value as well as in this document.

## Upgrade trigger

The five unimplemented rows become buildable the moment SPINE adds repository functions scoped
by user for: `user_assumption_profile` (delete), `calculation_share` (revoke then delete),
`calculation_issue` (anonymise), `audit_event` (anonymise), `research_run` (remove the user
link, retain the run). At that point `deleteMyAccount()` / `exportMyData()` are the two call
sites that need to grow, and `UNIMPLEMENTED_DATA_CLASSES` in `lifecycle.ts` is what should
shrink to `[]` — a non-empty list there is a standing reminder, not a permanent scope decision.
