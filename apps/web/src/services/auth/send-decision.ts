/**
 * F02 §4.1, §4.2 — the decision `sendResetPassword` and `sendVerificationEmail` (`instance.ts`)
 * both delegate to.
 *
 * Pulled out of the plugin closure and given every dependency as a parameter — including
 * `providerMode`, rather than reading `env.PROVIDER_MODE` itself — specifically so this is
 * testable directly with `providerMode: 'live'` behaviour and no live database, Redis, or Resend
 * key anywhere in the process.
 *
 * **No allowlist check here (D-39).** Before D-39, account creation itself was allowlist-gated
 * (`instance.ts`'s `databaseHooks.user.create.before`), so this module's own allowlist check was
 * defense-in-depth for a population that could only ever be the one admin address. D-39 opened
 * account creation to any address, which makes "is this address allowlisted" the wrong question
 * for a mail send anyway: Better Auth's own `sendResetPassword` route only invokes this for an
 * address with a real, already-existing account (it looks the user up first and no-ops
 * otherwise — verified against the installed `better-auth`'s `dist/api/routes/password.mjs`),
 * and `sendVerificationEmail` only fires for an account `signUpEmail` just created. The **send
 * cap** (`send-cap.ts`, D-28) is what still bounds volume — it is a global window, not
 * per-address, so it protects Resend's free-tier allowance against a burst of real signups or
 * resets exactly the way it protected against a burst of requests for the one admin address
 * before.
 */
import { normalizeEmail } from './allowlist';
import { recordAndCheckSendCap, type RedisRestClient } from './send-cap';
import { sendAuthEmail, type MailerConfig, type MailError, type AuthEmailInput } from './mailer';

/**
 * A **floor**, not a fixed delay: every path waits up to this long past `started`, so none of
 * the four outcomes below can finish faster than this and thereby stand out as the fast one. It
 * cannot bound a path from above — a live Resend round trip commonly takes 250-600ms, well past
 * this floor, so a slow `sent`/`send_failed` call is still distinguishable from a `capped`
 * refusal that never left the process. Closing that residual gap needs the send dispatched out
 * of the request path entirely (respond once dispatched, not once delivered) — real, but out of
 * scope for this fix.
 */
const TIMING_EQUALIZER_MS = 180;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(ms, 0)));
}

export type SendDecisionOutcome =
  | { readonly action: 'fixture' }
  | { readonly action: 'capped'; readonly window: 'hour' | 'day' }
  | { readonly action: 'sent' }
  | { readonly action: 'send_failed'; readonly error: MailError };

export type SendDecisionDeps = {
  readonly providerMode: 'fixture' | 'live';
  readonly redisClient: RedisRestClient | undefined;
  readonly mailerConfig: MailerConfig;
  readonly now?: () => Date;
  readonly rememberFixtureLink: (email: string, url: string) => void;
  readonly wait?: (ms: number) => Promise<void>;
};

/**
 * Always resolves — this function decides what happens, never what the caller is told
 * (`instance.ts`'s hooks await this and return nothing of their own, which is what makes §4.2's
 * generic-response property hold structurally rather than by convention: the `send_failed`
 * outcome below is exactly as invisible to the HTTP response as `sent` is).
 */
export async function decideAndSend(input: AuthEmailInput, deps: SendDecisionDeps): Promise<SendDecisionOutcome> {
  const started = Date.now();
  const doWait = deps.wait ?? wait;
  const normalized = normalizeEmail(input.to);

  if (deps.providerMode !== 'live') {
    deps.rememberFixtureLink(normalized, input.url);
    return { action: 'fixture' };
  }

  if (deps.redisClient !== undefined) {
    const cap = await recordAndCheckSendCap(deps.redisClient, deps.now?.() ?? new Date());
    if (!cap.allowed) {
      await doWait(TIMING_EQUALIZER_MS - (Date.now() - started));
      return { action: 'capped', window: cap.window };
    }
  }

  const result = await sendAuthEmail({ ...input, to: normalized }, deps.mailerConfig);
  await doWait(TIMING_EQUALIZER_MS - (Date.now() - started));
  if (!result.ok) {
    // Structured, so it is findable in a deployment log by more than the Resend SDK's own
    // incidental console output — the send cap was already spent for a link that never went out,
    // and this is the only application-level record of why.
    console.error('[F02] sendAuthEmail failed', { kind: result.error.kind });
    return { action: 'send_failed', error: result.error };
  }
  return { action: 'sent' };
}
