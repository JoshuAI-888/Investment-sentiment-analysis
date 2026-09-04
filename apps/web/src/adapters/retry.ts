/**
 * The retry policy, source §9.4:
 *
 *   400/401/403/404 caused by input or entitlement: no retry.
 *   408/429/500/502/503/504: exponential backoff with jitter, max two retries.
 *   Respect `Retry-After`.
 *
 * **A path that retries a 403 is a blocker** (F04 §7 step 1), so the decision is a pure
 * function over the classified error and is proven by test rather than read for. Nothing here
 * looks at a status code directly: `errors.ts` decided what the failure *is*, and this file
 * decides only whether that kind of failure is worth asking again.
 */
import { NEVER_RETRIED, type ProviderError } from '@/contracts/provider';
import { TRANSIENT_STATUSES } from './errors';

/** Source §9.4 says "max two retries" — three attempts in total. */
export const MAX_RETRIES = 2;

export type BackoffPolicy = {
  baseMs: number;
  factor: number;
  capMs: number;
  /** Injected so a test asserts on a range and a seeded value rather than on chance. */
  random: () => number;
};

export const defaultBackoff: BackoffPolicy = {
  baseMs: 500,
  factor: 2,
  capMs: 8_000,
  random: Math.random,
};

export type RetryDecision =
  | { retry: false; reason: 'never_retried' | 'not_transient' | 'attempts_exhausted' }
  | { retry: true; delayMs: number; reason: 'retry_after' | 'backoff' };

/**
 * Full jitter — the delay is uniform in `[0, exponential]` rather than `exponential ± noise`.
 * With several symbols failing on one provider outage, fixed backoff synchronises their
 * retries into a thundering herd that arrives exactly when the provider is least able to
 * serve it, and each round re-synchronises rather than spreading out.
 */
export function backoffDelayMs(attempt: number, policy: BackoffPolicy = defaultBackoff): number {
  const exponential = Math.min(policy.capMs, policy.baseMs * policy.factor ** attempt);
  return Math.floor(policy.random() * exponential);
}

export function retryDecision(input: {
  error: ProviderError;
  attempt: number;
  policy?: BackoffPolicy;
}): RetryDecision {
  const { error, attempt } = input;
  const policy = input.policy ?? defaultBackoff;

  // Layer one of two. `entitlement` is in this set — but it is NOT the only thing stopping a
  // 403 retry, and claiming otherwise was wrong: the `transient` whitelist below independently
  // excludes it. Both were broken separately and the end-to-end 403 test stayed green through
  // each, which is what proved the redundancy. See MEMORY.md B-17.
  if (NEVER_RETRIED.has(error.kind)) return { retry: false, reason: 'never_retried' };

  // Layer two, and the one that fails closed: retry is a whitelist, so an error kind added
  // later is un-retryable until someone deliberately says otherwise. A blacklist would make
  // the safe default "retry it", and the first new error kind would inherit that silently.
  const transient =
    error.kind === 'timeout' ||
    error.kind === 'rate_limit' ||
    (error.kind === 'upstream' && TRANSIENT_STATUSES.has(error.status));

  if (!transient) return { retry: false, reason: 'not_transient' };
  if (attempt >= MAX_RETRIES) return { retry: false, reason: 'attempts_exhausted' };

  // `Retry-After` is the provider telling us when it will answer. Backing off less than it
  // asked wastes the attempt; backing off more than it asked wastes the window.
  if (error.kind === 'rate_limit' && error.retryAfterMs > 0) {
    return { retry: true, delayMs: Math.min(error.retryAfterMs, policy.capMs), reason: 'retry_after' };
  }

  return { retry: true, delayMs: backoffDelayMs(attempt, policy), reason: 'backoff' };
}
