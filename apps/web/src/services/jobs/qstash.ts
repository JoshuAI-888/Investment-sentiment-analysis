/**
 * QStash signature verification (F16 §4.1 step 1 / §6's first DoD item — "an unsigned or
 * badly-signed request is rejected before any work, any database read, and any cost. This is the
 * only authentication on this route.").
 *
 * Wraps `@upstash/qstash`'s own `Receiver` — Upstash's signing scheme is a JWS over the current
 * and next signing keys (for key-rotation continuity), and re-implementing that verification by
 * hand is exactly the kind of security-critical parsing this codebase does not hand-roll
 * elsewhere (`better-auth` for sessions, `resend` for mail — the pattern here is the same: use
 * the vendor's own verifier for the vendor's own signing scheme).
 *
 * **This module does no I/O of its own and reads no request.** It is a pure function over
 * `{signature, body, url}` plus the two signing keys, which is what makes the contract test
 * possible: the route handler can prove rejection happens *before* this module (or anything
 * downstream of it) ever touches a database or Redis connection, by counting calls into a spy
 * that stands in for those — see `tests/contract/qstash-signature.test.ts`.
 */
import { Receiver } from '@upstash/qstash';

/**
 * `not_configured` is distinguished from every other rejection so the route can tell "this
 * deployment has never been given QStash credentials at all" (F01 §4.6's fixture-mode default —
 * `docs/DEPLOY.md` MT-04 has not run yet) from "a real signing key exists and this specific
 * request failed against it" (a genuine rejection). Mirrors the same distinction
 * `InspectorPage` already draws for `data-state="fixture"` vs `data-state="error"` — "no database
 * configured at all" renders differently from "a real, configured database faulted."
 */
export type QStashVerifyFailureCode = 'not_configured' | 'missing_signature' | 'invalid_signature';

export type QStashVerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: QStashVerifyFailureCode; readonly reason: string };

export type QStashSigningKeys = {
  readonly currentSigningKey: string | undefined;
  readonly nextSigningKey: string | undefined;
};

export type VerifyQStashRequestArgs = {
  readonly signature: string | null;
  readonly body: string;
  readonly url: string;
};

export async function verifyQStashRequest(
  args: VerifyQStashRequestArgs,
  keys: QStashSigningKeys,
): Promise<QStashVerifyResult> {
  if (keys.currentSigningKey === undefined) {
    return {
      ok: false,
      code: 'not_configured',
      reason: 'QSTASH_CURRENT_SIGNING_KEY is not configured',
    };
  }
  if (args.signature === null || args.signature.trim() === '') {
    return { ok: false, code: 'missing_signature', reason: 'missing upstash-signature header' };
  }

  const receiver = new Receiver({
    currentSigningKey: keys.currentSigningKey,
    ...(keys.nextSigningKey === undefined ? {} : { nextSigningKey: keys.nextSigningKey }),
  });

  try {
    const valid = await receiver.verify({ signature: args.signature, body: args.body, url: args.url });
    return valid
      ? { ok: true }
      : { ok: false, code: 'invalid_signature', reason: 'signature did not verify against either signing key' };
  } catch (error) {
    return {
      ok: false,
      code: 'invalid_signature',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
