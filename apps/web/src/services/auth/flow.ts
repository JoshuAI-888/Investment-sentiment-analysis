/**
 * F02 §4.1, §4.2 — the two calls a sign-in page makes. Thin wrappers around `auth.api.*` that
 * turn Better Auth's `APIError` throw into a typed result, and — critically — collapse every
 * *request-code* failure into the same generic success shape (§4.2, §5's enumeration test).
 *
 * **Verify is intentionally not generic in the same way.** §4.2's enumeration requirement is
 * about *request-code*: whether an address exists must not be learnable from that call. Verify
 * already cannot leak that distinction under `disableSignUp: false` — a non-allowlisted address
 * never received a code, so any code entered against it fails exactly like a wrong code entered
 * against a real address (`INVALID_OTP`), and Better Auth's own attempt-cap and expiry handling
 * cover the rest of §4's non-negotiables without help from this module.
 */
import { headers as nextHeaders } from 'next/headers';
import { APIError } from 'better-auth';
import { auth } from './instance';

export type RequestCodeResult = { readonly ok: true };

/**
 * Always resolves `{ ok: true }`. Whatever happened underneath — allowlisted, not allowlisted,
 * capped, a Resend outage — is decided inside `sendVerificationOTP` (`instance.ts`) and is
 * never surfaced here, which is the mechanism behind "request-code... return[s] the same shape
 * and timing whether or not the address exists" (§4.1).
 */
export async function requestSignInCode(email: string): Promise<RequestCodeResult> {
  await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } });
  return { ok: true };
}

export type VerifyCodeResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'invalid_or_expired' | 'too_many_attempts' | 'unknown' };

export async function verifySignInCode(email: string, otp: string): Promise<VerifyCodeResult> {
  try {
    await auth.api.signInEmailOTP({ body: { email, otp } });
    return { ok: true };
  } catch (error) {
    if (error instanceof APIError) {
      const code = String(error.body?.['code'] ?? '');
      if (code === 'TOO_MANY_ATTEMPTS') return { ok: false, reason: 'too_many_attempts' };
      // OTP_EXPIRED and INVALID_OTP both read as "that code doesn't work" to the caller — §4.1
      // requires them indistinguishable so an attacker cannot use the distinction to learn
      // whether their guess merely arrived late.
      return { ok: false, reason: 'invalid_or_expired' };
    }
    return { ok: false, reason: 'unknown' };
  }
}

/** Server-side revocation of the current session (§4.1: "server-side revocable"). */
export async function signOutCurrentSession(): Promise<void> {
  await auth.api.signOut({ headers: await nextHeaders() });
}
