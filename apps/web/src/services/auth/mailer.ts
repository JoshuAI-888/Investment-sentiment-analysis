/**
 * F02 §4.1 — the Resend transport. Called only for an address that has already cleared the
 * allowlist and the send cap (§4.2); this module has no allowlist knowledge of its own.
 *
 * A typed result, not a throw — F02 §5's contract test requires "a Resend 429 surfaces as a
 * typed error, never a stack trace to the user", the same discipline `ProviderResult` applies
 * to every domain provider (`02-ARCHITECTURE-CONTRACTS.md` §4.1). This module does not import
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

export type OtpEmailInput = {
  readonly to: string;
  readonly otp: string;
  readonly type: 'sign-in' | 'email-verification' | 'forget-password' | 'change-email';
};

/** `welcome@accounts.joshuai.nz` — F02 §4.1. Passed in rather than hardcoded (F01 §4.2). */
export type MailerConfig = { readonly apiKey: string; readonly from: string };

function subjectFor(type: OtpEmailInput['type']): string {
  switch (type) {
    case 'sign-in':
      return 'Your sign-in code';
    case 'email-verification':
      return 'Verify your email';
    case 'forget-password':
      return 'Your password reset code';
    case 'change-email':
      return 'Confirm your new email';
  }
}

/**
 * Sends the OTP. **Never logs it** — the only place the code is ever written down is the
 * outgoing email body itself, which Resend transmits and this process does not retain.
 */
export async function sendOtpEmail(input: OtpEmailInput, config: MailerConfig): Promise<MailResult> {
  const client = new Resend(config.apiKey);

  const result = await client.emails.send({
    from: config.from,
    to: input.to,
    subject: subjectFor(input.type),
    text: `Your code is ${input.otp}. It expires in 5 minutes and can be used once.`,
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
