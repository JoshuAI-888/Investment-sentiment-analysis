/**
 * QStash signature verification (F16 §4.1 step 1).
 *
 * "Verify the QStash signature. An unsigned or badly-signed request is rejected before any
 * work, any database read, and any cost. This is the only authentication on this route."
 *
 * **Implemented by hand, not via `@upstash/qstash`.** The package is not in this repo's
 * lockfile (checked directly — no `qstash` entry anywhere in `pnpm-lock.yaml`), and the build
 * instructions ask for a hand-rolled verifier against the documented scheme rather than a new
 * dependency, flagging plainly if the package turns out to be needed after all. It is not: the
 * scheme is an ordinary HS256 JWT (`Upstash-Signature` header) with four claims this module
 * checks — `iss` ("Upstash"), `sub` (the exact destination URL), the standard `exp`/`nbf` window,
 * and a `body` claim carrying the base64url SHA-256 hash of the raw request body — verified with
 * `node:crypto`'s `createHmac`/`timingSafeEqual`, no JWT library at all.
 *
 * **Not verified against a live QStash delivery.** This session has no network access to
 * Upstash's docs or a running QStash sandbox to round-trip a real signed request against; the
 * scheme below is reproduced from memory of the documented format and self-tested (this module's
 * own test file signs a token with the same HMAC construction and confirms this verifier accepts
 * it and rejects every tampered variant). `docs/DEPLOY.md` MT-08's step-by-step already asks the
 * operator to watch QStash's own Logs tab for the first successful `200` delivery post-deploy —
 * that is the first live confirmation this scheme is correct, and it should happen before anyone
 * treats this route as trusted in production. Flagged plainly under this feature's `RISKS`.
 *
 * **Key rotation.** F16 asks for both `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY`
 * to be tried, in that order, so a signing-key rotation in Upstash's console never produces a
 * window where every in-flight delivery is rejected.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replaceAll('-', '+').replaceAll('_', '/');
  const paddingNeeded = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + '='.repeat(paddingNeeded), 'base64');
}

function base64UrlEncode(input: Buffer): string {
  return input.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

type QStashJwtPayload = {
  readonly iss?: string;
  readonly sub?: string;
  readonly exp?: number;
  readonly nbf?: number;
  readonly iat?: number;
  readonly jti?: string;
  /** base64url SHA-256 of the raw request body. Absent on a body-less request. */
  readonly body?: string;
};

export type QStashVerifyFailureReason =
  | 'missing_header'
  | 'no_signing_keys_configured'
  | 'malformed_token'
  | 'bad_signature'
  | 'issuer_mismatch'
  | 'url_mismatch'
  | 'expired'
  | 'not_yet_valid'
  | 'body_hash_mismatch';

export type QStashVerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: QStashVerifyFailureReason };

const QSTASH_ISSUER = 'Upstash';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Verifies the HS256 signature against one key and returns the parsed payload if it matches. */
function verifyWithKey(token: string, key: string): QStashJwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  const expectedSignature = createHmac('sha256', key).update(`${headerB64}.${payloadB64}`).digest();
  let providedSignature: Buffer;
  try {
    providedSignature = base64UrlDecode(signatureB64);
  } catch {
    return null;
  }
  if (providedSignature.length !== expectedSignature.length) return null;
  if (!timingSafeEqual(providedSignature, expectedSignature)) return null;

  let payloadJson: unknown;
  try {
    payloadJson = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
  } catch {
    return null;
  }
  if (!isPlainObject(payloadJson)) return null;
  return payloadJson as QStashJwtPayload;
}

export type VerifyQStashSignatureArgs = {
  /** The raw `Upstash-Signature` header value, or `null` when absent. */
  readonly signatureHeader: string | null;
  /** The exact raw request body bytes/text — must not be re-serialized JSON. */
  readonly body: string;
  /** The exact URL QStash was configured to call, matching the JWT's `sub` claim. */
  readonly url: string;
  /** Both configured signing keys, in the order they should be tried. Empty means unconfigured. */
  readonly signingKeys: readonly string[];
  readonly now?: Date;
};

export function verifyQStashSignature(args: VerifyQStashSignatureArgs): QStashVerifyResult {
  if (args.signatureHeader === null || args.signatureHeader.trim() === '') {
    return { ok: false, reason: 'missing_header' };
  }
  if (args.signingKeys.length === 0) {
    return { ok: false, reason: 'no_signing_keys_configured' };
  }

  let payload: QStashJwtPayload | null = null;
  for (const key of args.signingKeys) {
    const attempt = verifyWithKey(args.signatureHeader, key);
    if (attempt !== null) {
      payload = attempt;
      break;
    }
  }
  if (payload === null) {
    // Distinguish "not even shaped like a JWT" from "shaped right, signed wrong" only for the
    // caller's own logging — both are rejected identically, so this reads the token structure
    // one more time purely to pick the more informative of the two reasons.
    const looksLikeJwt = args.signatureHeader.split('.').length === 3;
    return { ok: false, reason: looksLikeJwt ? 'bad_signature' : 'malformed_token' };
  }

  if (payload.iss !== QSTASH_ISSUER) return { ok: false, reason: 'issuer_mismatch' };
  if (payload.sub !== args.url) return { ok: false, reason: 'url_mismatch' };

  const now = args.now ?? new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (typeof payload.exp === 'number' && nowSeconds >= payload.exp) {
    return { ok: false, reason: 'expired' };
  }
  if (typeof payload.nbf === 'number' && nowSeconds < payload.nbf) {
    return { ok: false, reason: 'not_yet_valid' };
  }

  if (typeof payload.body === 'string') {
    const actualHash = base64UrlEncode(createHash('sha256').update(args.body).digest());
    const expected = Buffer.from(actualHash);
    const provided = Buffer.from(payload.body.replace(/=+$/u, ''));
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      return { ok: false, reason: 'body_hash_mismatch' };
    }
  }

  return { ok: true };
}

// ── Test-only signing helper ─────────────────────────────────────────────────────────────────

/**
 * Signs a token the way QStash itself would, for this module's own contract test. Never
 * imported from production code — a verifier that can also sign is a verifier a test can drive
 * end to end without a live QStash delivery, which is exactly the gap this module's own doc
 * names under `RISKS`.
 */
export function signQStashTokenForTesting(args: {
  readonly key: string;
  readonly url: string;
  readonly body: string;
  readonly issuedAt?: Date;
  readonly expiresInSeconds?: number;
  readonly overrides?: Partial<QStashJwtPayload>;
}): string {
  const issuedAt = args.issuedAt ?? new Date();
  const iat = Math.floor(issuedAt.getTime() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload: QStashJwtPayload = {
    iss: QSTASH_ISSUER,
    sub: args.url,
    iat,
    nbf: iat,
    exp: iat + (args.expiresInSeconds ?? 300),
    jti: 'test-jti',
    body: base64UrlEncode(createHash('sha256').update(args.body).digest()),
    ...args.overrides,
  };
  const headerB64 = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  const signature = createHmac('sha256', args.key).update(`${headerB64}.${payloadB64}`).digest();
  return `${headerB64}.${payloadB64}.${base64UrlEncode(signature)}`;
}
