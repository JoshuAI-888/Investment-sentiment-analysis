import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { RniOrchestrationError } from './budget';

const claims = z
  .object({
    iss: z.literal('Upstash'),
    sub: z.string().url(),
    exp: z.number().int().nonnegative(),
    nbf: z.number().int().nonnegative(),
    iat: z.number().int().nonnegative(),
    jti: z.string().min(1).max(500),
    body: z.string().regex(/^[A-Za-z0-9_-]{43}=?$/u),
  })
  .strict();
const header = z.object({ alg: z.literal('HS256'), typ: z.literal('JWT').optional() }).strict();

function decode(segment: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/u.test(segment)) throw new Error('encoding');
  const bytes = Buffer.from(segment, 'base64url');
  if (bytes.toString('base64url') !== segment) throw new Error('encoding');
  return bytes;
}

/** https://upstash.com/docs/qstash/howto/signature — authenticate exact raw bytes first. */
export function verifyRniQstashRequest(input: {
  signature: string | null;
  rawBody: string;
  /** Deployment-configured destination, not Host/X-Forwarded-* or an untrusted request URL. */
  expectedUrl: string;
  currentSigningKey: string;
  nextSigningKey: string;
  now: Date;
}): { tokenId: string } {
  try {
    if (
      !input.currentSigningKey ||
      !input.nextSigningKey ||
      !input.signature ||
      input.signature.length > 8192 ||
      Buffer.byteLength(input.rawBody) > 32_768 ||
      !Number.isFinite(input.now.getTime())
    )
      throw new Error('invalid');
    const parts = input.signature.split('.');
    if (parts.length !== 3) throw new Error('invalid');
    const [encodedHeader, encodedClaims, encodedSignature] = parts as [string, string, string];
    header.parse(JSON.parse(decode(encodedHeader).toString('utf8')));
    const actual = decode(encodedSignature);
    const signed = `${encodedHeader}.${encodedClaims}`;
    const current = createHmac('sha256', input.currentSigningKey).update(signed).digest();
    const next = createHmac('sha256', input.nextSigningKey).update(signed).digest();
    if (actual.length !== current.length) throw new Error('invalid');
    // Evaluate both comparisons so key rotation does not change the verification path.
    const matchesCurrent = timingSafeEqual(actual, current);
    const matchesNext = timingSafeEqual(actual, next);
    if (!matchesCurrent && !matchesNext) throw new Error('invalid');
    const payload = claims.parse(JSON.parse(decode(encodedClaims).toString('utf8')));
    const now = input.now.getTime() / 1000;
    const bodyHash = createHash('sha256').update(input.rawBody, 'utf8').digest('base64url');
    if (
      payload.sub !== input.expectedUrl ||
      payload.exp <= now ||
      payload.nbf > now ||
      payload.iat > now ||
      payload.nbf > payload.exp ||
      payload.iat > payload.exp ||
      payload.body.replace(/=$/u, '') !== bodyHash
    )
      throw new Error('invalid');
    return { tokenId: payload.jti };
  } catch {
    // No key, signature, JWT payload or provider-controlled text enters an error/log.
    throw new RniOrchestrationError('INVALID_SIGNATURE');
  }
}

/** The callback cannot read storage or dispatch work until signature AND payload validate. */
export async function consumeRniQstash<T, R>(
  input: Parameters<typeof verifyRniQstashRequest>[0],
  schema: z.ZodType<T>,
  consume: (payload: T) => Promise<R>,
): Promise<R> {
  verifyRniQstashRequest(input);
  const payload = schema.parse(JSON.parse(input.rawBody));
  return consume(payload);
}
