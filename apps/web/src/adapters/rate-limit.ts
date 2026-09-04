/**
 * A token bucket per provider (F04 §4.1 stage 4).
 *
 * The bucket is not the quota ledger. The ledger is a *daily allowance* and refusing is the
 * correct outcome; the bucket is an *instantaneous rate* and waiting is. Reddit's 100 QPM is a
 * rate — a burst that exceeds it should slow down, not drop items on the floor, because under
 * D-16 a dropped item is not collected later.
 */
import type { ProviderId } from '@/contracts/provider';
import type { Clock, RateLimiterState, RateLimiterStore } from './ports';

export type BucketConfig = {
  /** Maximum burst. */
  capacity: number;
  /** Sustained rate. Reddit's 100 QPM is `capacity: 100, refillPerSecond: 100/60`. */
  refillPerSecond: number;
};

export type Acquisition = { acquired: true } | { acquired: false; waitMs: number };

export function refill(state: RateLimiterState, config: BucketConfig, nowMs: number): RateLimiterState {
  const elapsedSeconds = Math.max(0, (nowMs - state.lastRefillMs) / 1000);
  const tokens = Math.min(config.capacity, state.tokens + elapsedSeconds * config.refillPerSecond);
  return { tokens, lastRefillMs: nowMs };
}

/**
 * Takes one token, or reports how long until one exists. The caller decides whether to wait —
 * the bucket does not sleep on its own, because a bucket that blocks is invisible in a stack
 * trace and turns a rate limit into a hang.
 */
export async function acquire(input: {
  provider: ProviderId;
  config: BucketConfig;
  store: RateLimiterStore;
  clock: Clock;
}): Promise<Acquisition> {
  const { provider, config, store, clock } = input;
  const nowMs = clock.now().getTime();

  const stored = (await store.read(provider)) ?? { tokens: config.capacity, lastRefillMs: nowMs };
  const state = refill(stored, config, nowMs);

  if (state.tokens >= 1) {
    await store.write(provider, { tokens: state.tokens - 1, lastRefillMs: state.lastRefillMs });
    return { acquired: true };
  }

  await store.write(provider, state);
  const deficit = 1 - state.tokens;
  return { acquired: false, waitMs: Math.ceil((deficit / config.refillPerSecond) * 1000) };
}

/**
 * Per-provider rates. Conservative where the published limit is unverified — MT-13 has not
 * been filed, so Reddit's 100 QPM is what the documentation says rather than what an approved
 * client has been observed to get. `provider-rights.md` records the same distinction.
 */
export const BUCKETS: Readonly<Record<ProviderId, BucketConfig>> = {
  reddit: { capacity: 100, refillPerSecond: 100 / 60 },
  substack: { capacity: 10, refillPerSecond: 1 },
  x: { capacity: 5, refillPerSecond: 1 / 12 },
  market: { capacity: 60, refillPerSecond: 1 },
  fmp: { capacity: 30, refillPerSecond: 5 },
  apewisdom: { capacity: 5, refillPerSecond: 1 },
  marketaux: { capacity: 5, refillPerSecond: 100 / 86_400 },
  sec_edgar: { capacity: 10, refillPerSecond: 10 },
  fred: { capacity: 20, refillPerSecond: 2 },
  scorer: { capacity: 32, refillPerSecond: 16 },
} as const;
