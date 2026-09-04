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

/** Throws `UnauthenticatedError` rather than returning `null` — every real caller needs a user. */
export async function requireUser(): Promise<Session> {
  const session = await getSession();
  if (session === null) throw new UnauthenticatedError();
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
