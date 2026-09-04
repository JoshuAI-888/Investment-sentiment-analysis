/**
 * F02 §4.1, §4.2 — the decision `sendVerificationOTP` (`instance.ts`) delegates to.
 *
 * Pulled out of the plugin closure and given every dependency as a parameter — including
 * `providerMode`, rather than reading `env.PROVIDER_MODE` itself — specifically so this is
 * testable directly: F02 §5's "a non-allowlisted address never reaches Resend" and the
 * enumeration test both need to exercise `providerMode: 'live'` behaviour without a live
 * database, a live Redis, or a live Resend key anywhere in the process.
 */
import { isAllowlisted, normalizeEmail } from './allowlist';
import { recordAndCheckSendCap, type RedisRestClient } from './send-cap';
import { sendOtpEmail, type MailerConfig, type MailError, type OtpEmailInput } from './mailer';

/**
 * A **floor**, not a fixed delay: every path waits up to this long past `started`, so none of
 * the four outcomes below can finish faster than this and thereby stand out as the fast one.
 * It cannot bound a path from above — a live Resend round trip commonly takes 250-600ms, well
 * past this floor, so a slow `sent`/`send_failed` call is still distinguishable from a
 * `not_allowlisted`/`capped` refusal that never left the process. Closing that residual gap
 * needs the send dispatched out of the request path entirely (respond once dispatched, not once
 * delivered) — real, but out of scope for this fix. What this floor does close, found by
 * lane-review: before it also applied to `sent`/`send_failed`, ANY Resend call faster than
 * 180ms (a healthy low-latency path, not even a slow one) was the *fast* outcome, exactly
 * backwards from a refusal, and the enumeration probe below could not detect it because
 * `PROVIDER_MODE=fixture` short-circuits before either code path this timing distinguishes.
 */
const TIMING_EQUALIZER_MS = 180;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(ms, 0)));
}

export type SendDecisionOutcome =
  | { readonly action: 'fixture' }
  | { readonly action: 'not_allowlisted' }
  | { readonly action: 'capped'; readonly window: 'hour' | 'day' }
  | { readonly action: 'sent' }
  | { readonly action: 'send_failed'; readonly error: MailError };

export type SendDecisionDeps = {
  readonly providerMode: 'fixture' | 'live';
  readonly allowlist: readonly string[];
  readonly redisClient: RedisRestClient | undefined;
  readonly mailerConfig: MailerConfig;
  readonly now?: () => Date;
  readonly rememberFixtureOtp: (email: string, otp: string) => void;
  readonly wait?: (ms: number) => Promise<void>;
};

/**
 * Always resolves — this function decides what happens, never what the caller is told
 * (`instance.ts`'s `sendVerificationOTP` awaits this and returns nothing of its own, which is
 * what makes §4.2's generic-response property hold structurally rather than by convention: the
 * `send_failed` outcome below is exactly as invisible to the HTTP response as `sent` is).
 *
 * That structural discipline is also what makes it safe to report a real mail failure here
 * instead of masking it as `sent`: nothing downstream of this function can leak the difference
 * into a response an enumeration probe could read, so there is no honesty/security trade-off in
 * telling the truth to whoever *does* read this return value — logs, and tests. Found by
 * lane-review: the previous version discarded `sendOtpEmail`'s result unconditionally, so a live
 * Resend rate-limit or outage consumed the send-cap counter for a code that never left the
 * process, reported `sent` regardless, and left no record beyond the Resend SDK's own incidental
 * `console.error` of why the operator was locked out.
 */
export async function decideAndSend(input: OtpEmailInput, deps: SendDecisionDeps): Promise<SendDecisionOutcome> {
  const started = Date.now();
  const doWait = deps.wait ?? wait;
  const normalized = normalizeEmail(input.to);

  if (deps.providerMode !== 'live') {
    deps.rememberFixtureOtp(normalized, input.otp);
    return { action: 'fixture' };
  }

  if (!isAllowlisted(normalized, deps.allowlist)) {
    await doWait(TIMING_EQUALIZER_MS - (Date.now() - started));
    return { action: 'not_allowlisted' };
  }

  if (deps.redisClient !== undefined) {
    const cap = await recordAndCheckSendCap(deps.redisClient, deps.now?.() ?? new Date());
    if (!cap.allowed) {
      await doWait(TIMING_EQUALIZER_MS - (Date.now() - started));
      return { action: 'capped', window: cap.window };
    }
  }

  const result = await sendOtpEmail({ ...input, to: normalized }, deps.mailerConfig);
  await doWait(TIMING_EQUALIZER_MS - (Date.now() - started));
  if (!result.ok) {
    // Structured, so it is findable in a deployment log by more than the Resend SDK's own
    // incidental console output — the send cap was already spent for a code that never went
    // out, and this is the only application-level record of why.
    console.error('[F02] sendOtpEmail failed', { kind: result.error.kind });
    return { action: 'send_failed', error: result.error };
  }
  return { action: 'sent' };
}
