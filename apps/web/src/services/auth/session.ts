/**
 * F02 §3, §4.4 — `Session`, `requireUser()`, `requireAdmin()`.
 *
 * `AccountTier` and `requireTier()` are **void under D-11** and do not exist anywhere in this
 * tree — there is one account and it is `admin`. `requireAdmin()` below does not read a stored
 * role: it re-normalizes the session's email and re-checks it against the *current*
 * `ADMIN_EMAIL_ALLOWLIST` on every call, so narrowing the allowlist in a redeploy revokes access
 * on the next request without needing to touch any session row.
 *
 * **Non-negotiable (F02 §4.4):** authorization is called **inside** every admin route handler
 * and server action's own body, never only at a layout level. Nothing in this file enforces
 * that by itself — it is enforced by every call site importing `requireAdmin` and calling it,
 * which is why the PR review step is "list every admin route/action and confirm each calls it".
 */
import { headers as nextHeaders } from 'next/headers';
import { env } from '@/env';
import { auth } from './instance';
import { isAllowlisted, normalizeEmail } from './allowlist';

export type Session = {
  readonly userId: string;
  readonly email: string;
  readonly sessionId: string;
  readonly expiresAt: string;
  /** D-38 — true for a "welcome1" seeded account that has not set its own password yet. */
  readonly mustChangePassword: boolean;
};

/** `null` when there is no valid session — never throws for the "not signed in" case. */
export async function getSession(): Promise<Session | null> {
  const result = await auth.api.getSession({ headers: await nextHeaders() });
  if (result === null) return null;

  return {
    userId: result.user.id,
    email: result.user.email,
    sessionId: result.session.id,
    expiresAt: result.session.expiresAt.toISOString(),
    mustChangePassword: result.user.mustChangePassword,
  };
}

export class UnauthenticatedError extends Error {
  constructor() {
    super('No session. Sign in required.');
    this.name = 'UnauthenticatedError';
  }
}

export class UnauthorizedError extends Error {
  constructor() {
    super('Signed in, but this address is not on the admin allowlist.');
    this.name = 'UnauthorizedError';
  }
}

/**
 * D-38 — thrown by `requireUser()` for a signed-in session whose password still needs changing.
 * Deliberately **not** a subtype of `UnauthenticatedError`/`UnauthorizedError`: this is a session
 * in good standing, just mid-onboarding, and every call site distinguishes it with its own
 * `redirect('/change-password')` rather than folding it into "not signed in" or "not admin".
 * `/change-password` itself never reaches this — it calls `getSession()` directly, not
 * `requireUser()`, since triggering this error is exactly the state that page exists to resolve.
 */
export class PasswordChangeRequiredError extends Error {
  constructor() {
    super('Password must be changed before continuing.');
    this.name = 'PasswordChangeRequiredError';
  }
}

/** Throws `UnauthenticatedError` rather than returning `null` — every real caller needs a user. */
export async function requireUser(): Promise<Session> {
  const session = await getSession();
  if (session === null) throw new UnauthenticatedError();
  if (session.mustChangePassword) throw new PasswordChangeRequiredError();
  return session;
}

/**
 * D-11: there is one account and it is admin, so in practice every signed-in session already
 * passes this — but the check is re-derived from the live allowlist on every call rather than
 * assumed, which is what makes it authorization and not decoration (§4.4).
 */
export async function requireAdmin(): Promise<Session> {
  const session = await requireUser();
  if (!isAllowlisted(normalizeEmail(session.email), env.ADMIN_EMAIL_ALLOWLIST)) {
    throw new UnauthorizedError();
  }
  return session;
}
