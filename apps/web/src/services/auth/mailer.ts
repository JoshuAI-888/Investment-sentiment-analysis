/**
 * F02 §4.1 — the Resend transport. Called only for an address that has already cleared the
 * allowlist and the send cap (§4.2); this module has no allowlist knowledge of its own.
 *
 * Sends a **link**, not a code: `emailAndPassword`/`emailVerification` hand this module a
 * one-time URL (Better Auth's own `sendResetPassword` / `sendVerificationEmail` hooks), not an
 * OTP. A typed result, not a throw — F02 §5's contract test requires "a Resend 429 surfaces as a
 * typed error, never a stack trace to the user", the same discipline `ProviderResult` applies to
 * every domain provider (`02-ARCHITECTURE-CONTRACTS.md` §4.1). This module does not import
 * `ProviderResult` itself: `providerId` is a SPINE-owned enum (`src/contracts/provider.ts`) that
 * does not name a mail transport, and Resend is not a domain data provider — adding an entry
 * there for a one-purpose mailer would widen a contract for a shape that does not fit it.
 */
import { Resend } from 'resend';

export type MailError =
  | { readonly kind: 'rate_limit'; readonly retryAfterMs: number }
  | { readonly kind: 'upstream'; readonly status: number }
  | { readonly kind: 'network' };

export type MailResult = { readonly ok: true } | { readonly ok: false; readonly error: MailError };

export type AuthEmailKind = 'verify-email' | 'reset-password';

export type AuthEmailInput = {
  readonly to: string;
  readonly url: string;
  readonly kind: AuthEmailKind;
};

/** `welcome@accounts.joshuai.nz` — F02 §4.1. Passed in rather than hardcoded (F01 §4.2). */
export type MailerConfig = { readonly apiKey: string; readonly from: string };

function subjectFor(kind: AuthEmailKind): string {
  switch (kind) {
    case 'verify-email':
      return 'Verify your email';
    case 'reset-password':
      return 'Reset your password';
  }
}

function bodyFor(kind: AuthEmailKind, url: string): string {
  switch (kind) {
    case 'verify-email':
      return `Confirm this address to finish creating your account: ${url}\n\nThis link expires shortly and can be used once. If you did not request this, ignore this email.`;
    case 'reset-password':
      return `Reset your password: ${url}\n\nThis link expires shortly and can be used once. If you did not request this, ignore this email — your password has not changed.`;
  }
}

/**
 * Sends the link. **Never logs it** — the only place it is ever written down is the outgoing
 * email body itself, which Resend transmits and this process does not retain.
 */
export async function sendAuthEmail(input: AuthEmailInput, config: MailerConfig): Promise<MailResult> {
  const client = new Resend(config.apiKey);

  const result = await client.emails.send({
    from: config.from,
    to: input.to,
    subject: subjectFor(input.kind),
    text: bodyFor(input.kind, input.url),
  });

  if (result.error === null) return { ok: true };

  if (result.error.name === 'rate_limit_exceeded') {
    return { ok: false, error: { kind: 'rate_limit', retryAfterMs: 60_000 } };
  }
  if (result.error.statusCode !== null) {
    return { ok: false, error: { kind: 'upstream', status: result.error.statusCode } };
  }
  return { ok: false, error: { kind: 'network' } };
}
