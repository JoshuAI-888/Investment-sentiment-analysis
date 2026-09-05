/**
 * F02 §4.1, §4.2 — the calls a sign-in/sign-up/reset-password page makes. Thin wrappers around
 * `auth.api.*` that turn Better Auth's `APIError` throw into a typed result.
 *
 * **`requestPasswordReset` is generic by construction** (§4.2, the same enumeration discipline
 * OTP's request-code call used to carry): it always resolves `{ ok: true }` regardless of what
 * `auth.api.forgetPassword` actually did underneath — allowlisted or not, capped, a Resend
 * outage. That decision is made inside `sendResetPassword` (`instance.ts`) and never surfaces
 * here.
 *
 * **`signUpWithPassword` (D-39): sign-up is now open to any address**, so `not_allowed` is no
 * longer a reachable outcome of this call — `databaseHooks.user.create.before` (`instance.ts`)
 * that used to produce it is gone. `already_exists`/`weak_password` remain genuine, actionable
 * outcomes worth naming to the caller rather than hiding behind a generic response: unlike a
 * broadcast, enumeration-sensitive endpoint (password-reset's request call, still generic below),
 * sign-up telling someone "an account already exists for this address" leaks nothing a stranger
 * couldn't already learn by trying to sign in with a guessed password.
 *
 * **D-38: `signInWithPassword` also carries the "welcome1" seeded-account fallback.** A normal
 * sign-in is always tried first; only on failure, with the submitted password exactly equal to
 * `WELCOME_PASSWORD`, does it attempt `provisionSeedAccountIfEligible` and retry once. This is
 * safe to attempt unconditionally on any failed attempt with that password — an address that
 * already has a *different* real password is untouched (`provisionSeedAccountIfEligible` no-ops
 * once a user exists), and an address that was never eligible (not allowlisted, in `live` mode)
 * gets refused the same way self-service sign-up already is.
 */
import { headers as nextHeaders } from 'next/headers';
import { APIError } from 'better-auth';
import { auth } from './instance';
import { clearMustChangePassword, provisionSeedAccountIfEligible, WELCOME_PASSWORD } from './seed-account';

function errorCode(error: unknown): string {
  return error instanceof APIError ? String(error.body?.['code'] ?? '') : '';
}

export type SignUpResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'already_exists' | 'weak_password' | 'unknown' };

/** Creates the account and triggers the verification email; the account cannot sign in yet. */
export async function signUpWithPassword(email: string, password: string): Promise<SignUpResult> {
  try {
    await auth.api.signUpEmail({ body: { email, password, name: email } });
    return { ok: true };
  } catch (error) {
    const code = errorCode(error);
    if (code === 'USER_ALREADY_EXISTS') return { ok: false, reason: 'already_exists' };
    if (code.includes('PASSWORD')) return { ok: false, reason: 'weak_password' };
    return { ok: false, reason: 'unknown' };
  }
}

export type SignInResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'invalid_credentials' | 'email_not_verified' | 'unknown' };

async function trySignIn(email: string, password: string): Promise<SignInResult> {
  try {
    await auth.api.signInEmail({ body: { email, password } });
    return { ok: true };
  } catch (error) {
    const code = errorCode(error);
    if (code === 'EMAIL_NOT_VERIFIED') return { ok: false, reason: 'email_not_verified' };
    if (error instanceof APIError) return { ok: false, reason: 'invalid_credentials' };
    return { ok: false, reason: 'unknown' };
  }
}

export async function signInWithPassword(email: string, password: string): Promise<SignInResult> {
  const attempt = await trySignIn(email, password);
  if (attempt.ok) return attempt;

  // D-38: see this module's doc comment. Only reached on an already-failed attempt.
  if (password === WELCOME_PASSWORD) {
    const provisioned = await provisionSeedAccountIfEligible(email);
    if (provisioned) {
      const retry = await trySignIn(email, password);
      if (retry.ok) return retry;
    }
  }

  return attempt;
}

export type RequestResetResult = { readonly ok: true };

export async function requestPasswordReset(email: string): Promise<RequestResetResult> {
  try {
    await auth.api.requestPasswordReset({ body: { email, redirectTo: '/reset-password' } });
  } catch {
    // Never surfaced — see this module's doc comment. Whatever happened is `sendResetPassword`'s
    // business, not this caller's.
  }
  return { ok: true };
}

export type ResetPasswordResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'invalid_or_expired' | 'weak_password' | 'unknown' };

export async function resetPassword(token: string, newPassword: string): Promise<ResetPasswordResult> {
  try {
    await auth.api.resetPassword({ body: { token, newPassword } });
    return { ok: true };
  } catch (error) {
    const code = errorCode(error);
    if (code.includes('PASSWORD')) return { ok: false, reason: 'weak_password' };
    if (error instanceof APIError) return { ok: false, reason: 'invalid_or_expired' };
    return { ok: false, reason: 'unknown' };
  }
}

export type ChangePasswordResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'wrong_current_password' | 'weak_password' | 'unknown' };

/**
 * D-38 — reachable by any signed-in session, not only a `mustChangePassword` one: this is both
 * the forced-reset flow and ordinary voluntary password change, since the two need identical
 * logic (verify the current password, set the new one) and only differ in why the caller got
 * here. `revokeOtherSessions: true` unconditionally — deliberate, not just for the forced-reset
 * case: this call is exactly the moment a caller has proven they hold the current password, which
 * is the right moment to kick out any other session, including one that raced them to the shared
 * `WELCOME_PASSWORD` before they got here (`../../DEPLOY.md` names this exact risk). Clears
 * `mustChangePassword` unconditionally too — a no-op update when it was already `false`.
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<ChangePasswordResult> {
  const headers = await nextHeaders();
  let userId: string;
  try {
    const result = await auth.api.changePassword({
      body: { currentPassword, newPassword, revokeOtherSessions: true },
      headers,
    });
    userId = result.user.id;
  } catch (error) {
    const code = errorCode(error);
    if (code === 'INVALID_PASSWORD') return { ok: false, reason: 'wrong_current_password' };
    if (code === 'PASSWORD_TOO_SHORT' || code === 'PASSWORD_TOO_LONG') return { ok: false, reason: 'weak_password' };
    return { ok: false, reason: 'unknown' };
  }

  await clearMustChangePassword(userId);
  return { ok: true };
}

/** Server-side revocation of the current session (§4.1: "server-side revocable"). */
export async function signOutCurrentSession(): Promise<void> {
  await auth.api.signOut({ headers: await nextHeaders() });
}
