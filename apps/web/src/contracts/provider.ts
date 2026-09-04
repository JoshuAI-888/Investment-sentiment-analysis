/**
 * The provider boundary. Every external data source in the stack is reached through this
 * vocabulary — `docs/02-ARCHITECTURE-CONTRACTS.md` §4.1, produced by F04 §3.
 *
 * **No adapter throws for an expected condition.** A 403, an exhausted quota, a timeout and a
 * changed response shape are all *results*, because the collector must keep running through
 * every one of them. Under D-16 there is no backfill, so an unhandled throw in one adapter that
 * stops the loop is not an error that gets retried later — it is a permanent hole in the corpus.
 */
import { z } from 'zod';
import { decimalString } from './primitives';

/**
 * The D-12 provider set, plus the scorer.
 *
 * The scorer is here because F20 §3 reuses this wrapper — *"the scorer is treated as a
 * provider"* — and it genuinely is one: it is out-of-process, it times out, it returns
 * malformed payloads, and its outage must become an abstention rather than an exception.
 * Naming it here means F20 does not have to edit a SPINE-owned contract to say so.
 */
export const providerId = z.enum([
  'reddit',
  'substack',
  'x',
  'market',
  'fmp',
  'apewisdom',
  'marketaux',
  'sec_edgar',
  'fred',
  'scorer',
]);
export type ProviderId = z.infer<typeof providerId>;

export const cacheStatus = z.enum(['hit', 'miss', 'stale']);
export type CacheStatus = z.infer<typeof cacheStatus>;

/**
 * `costUsd` is a **decimal string**, not the `number` in ARCH §4.1.
 *
 * The architecture document predates F03's decimal work. This value's destination is
 * `cost_event.cost_usd`, a Postgres `numeric`, and `contracts/cost.ts` types that column as
 * `decimalString` precisely so a float never round-trips through it. Typing the provider meta
 * as `number` would reintroduce at the boundary the exact defect the column type prevents, and
 * the conversion would happen in the one place nobody looks. Recorded as MEMORY.md B-15.
 *
 * `null` means UNPRICED. It never becomes `'0'` — a free call and a call whose price we do not
 * know are different facts, and F18's ceiling depends on being able to tell them apart.
 */
export const providerMeta = z.object({
  provider: providerId,
  endpoint: z.string().min(1),
  requestedAt: z.string().datetime({ offset: true }),
  latencyMs: z.number().int().nonnegative(),
  cache: cacheStatus,
  quotaRemaining: z.number().int().nonnegative().nullable(),
  costUsd: decimalString.nullable(),
  payloadRef: z.string().nullable(),
});
export type ProviderMeta = z.infer<typeof providerMeta>;

/**
 * The error taxonomy. Every branch here is a condition the collector is expected to meet in
 * normal operation, which is why none of them is an exception.
 *
 * `entitlement` is the one that must never be retried (F04 §6, §7 step 1). A 403 is a statement
 * about the account, not about the moment, so a retry cannot change it — it can only burn quota
 * and slow the loop while the answer stays the same.
 */
export const providerError = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('entitlement'), endpoint: z.string().min(1), status: z.number().int() }),
  z.object({ kind: z.literal('quota'), resetAt: z.string().datetime({ offset: true }).nullable() }),
  z.object({ kind: z.literal('rate_limit'), retryAfterMs: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('timeout') }),
  z.object({ kind: z.literal('upstream'), status: z.number().int() }),
  z.object({ kind: z.literal('contract'), issues: z.array(z.string()) }),
  z.object({ kind: z.literal('budget_denied'), scope: z.enum(['account', 'global']) }),
  /**
   * Not in ARCH §4.1's list. The breaker is §4.1 stage 7 of the wrapper, and when it is open
   * the call never leaves the process — so there is no status, no latency and no upstream to
   * attribute. Collapsing it into `upstream` would report a failure the provider never saw,
   * and `/api/health/providers` could not then distinguish "the provider is down" from "we
   * stopped asking", which is the distinction the endpoint exists to draw.
   */
  z.object({ kind: z.literal('circuit_open'), openedAt: z.string().datetime({ offset: true }) }),
]);
export type ProviderError = z.infer<typeof providerError>;

export type ProviderResult<T> =
  | { ok: true; data: T; meta: ProviderMeta }
  | { ok: false; error: ProviderError; meta: ProviderMeta };

/** Runtime schema for `ProviderResult<T>`, given the schema for `T`. */
export function providerResult<T extends z.ZodTypeAny>(data: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), data, meta: providerMeta }),
    z.object({ ok: z.literal(false), error: providerError, meta: providerMeta }),
  ]);
}

/** Errors that must never be retried, whatever the attempt count (source §9.4). */
export const NEVER_RETRIED: ReadonlySet<ProviderError['kind']> = new Set([
  'entitlement',
  'contract',
  'budget_denied',
  'quota',
  'circuit_open',
]);
