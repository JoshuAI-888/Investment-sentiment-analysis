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
 * **`signUpWithPassword` is not generic in the same way, deliberately.** Unlike a sign-in
 * request-code call — which fires for *any* address and must not let a stranger learn which ones
 * are admin — sign-up only ever succeeds for the one allowlisted address, and that address is
 * already public knowledge to anyone who has seen the app (D-28's own reasoning). Telling a
 * caller "that address isn't authorized" or "an account already exists" leaks nothing not already
 * known, and a clear message is better UX for the one legitimate user than a fake generic success
 * that never explains why sign-up appears to do nothing.
 */
import { headers as nextHeaders } from 'next/headers';
import { APIError } from 'better-auth';
import { auth } from './instance';

function errorCode(error: unknown): string {
  return error instanceof APIError ? String(error.body?.['code'] ?? '') : '';
}

export type SignUpResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'not_allowed' | 'already_exists' | 'weak_password' | 'unknown' };

/** Creates the account and triggers the verification email; the account cannot sign in yet. */
export async function signUpWithPassword(email: string, password: string): Promise<SignUpResult> {
  try {
    await auth.api.signUpEmail({ body: { email, password, name: email } });
    return { ok: true };
  } catch (error) {
    const code = errorCode(error);
    if (code === 'FORBIDDEN') return { ok: false, reason: 'not_allowed' };
    if (code === 'USER_ALREADY_EXISTS') return { ok: false, reason: 'already_exists' };
    if (code.includes('PASSWORD')) return { ok: false, reason: 'weak_password' };
    return { ok: false, reason: 'unknown' };
  }
}

export type SignInResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'invalid_credentials' | 'email_not_verified' | 'unknown' };

export async function signInWithPassword(email: string, password: string): Promise<SignInResult> {
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

/** Server-side revocation of the current session (§4.1: "server-side revocable"). */
export async function signOutCurrentSession(): Promise<void> {
  await auth.api.signOut({ headers: await nextHeaders() });
}
