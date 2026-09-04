import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inMemoryRedisClient, KEYS } from '../../../../src/services/dashboard/redis';
import { recordRefusal, REFUSAL_TTL_SECONDS } from '../../../../src/services/dashboard/refusal';

/**
 * F07 review finding 1: a transient refusal must not permanently disable the refresh control.
 * `assembleDashboard` treats a non-null `dashboard:last_refusal` as "still refused" and
 * `RefreshControl` initializes disabled from it, so the marker this file writes has to expire on
 * its own — the only other writer that clears it is a *successful* refresh, which a disabled
 * button can never trigger. This test reproduces exactly that: refuse once, then confirm the
 * marker (and so the button) becomes available again once its TTL has elapsed. Before the fix
 * (`redis.set` with no `redis.expire` follow-up), this fails — the key never disappears.
 */
describe('recordRefusal — the refusal marker must expire, not persist forever', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a rate_limited refusal clears itself once its own cooldown window has elapsed', async () => {
    const redis = inMemoryRedisClient();
    await recordRefusal(redis, 'rate_limited', 'A refresh already ran in the last 60 seconds.');

    expect(await redis.get(KEYS.lastRefusal())).not.toBeNull();

    // Just under the TTL: still refused.
    vi.advanceTimersByTime(REFUSAL_TTL_SECONDS.rate_limited * 1000 - 1000);
    expect(await redis.get(KEYS.lastRefusal())).not.toBeNull();

    // Past the TTL: the marker — and so the button's disabled state — has a path back.
    vi.advanceTimersByTime(2000);
    expect(await redis.get(KEYS.lastRefusal())).toBeNull();
  });

  it('an in_progress refusal expires with the refresh lock TTL, not forever', async () => {
    const redis = inMemoryRedisClient();
    await recordRefusal(redis, 'in_progress', 'A refresh is already running.');

    vi.advanceTimersByTime(REFUSAL_TTL_SECONDS.in_progress * 1000 + 1000);
    expect(await redis.get(KEYS.lastRefusal())).toBeNull();
  });

  it('a budget refusal expires on its own, bounded window', async () => {
    const redis = inMemoryRedisClient();
    await recordRefusal(redis, 'budget', 'This month\'s recorded spend has reached the global ceiling.');

    vi.advanceTimersByTime(REFUSAL_TTL_SECONDS.budget * 1000 + 1000);
    expect(await redis.get(KEYS.lastRefusal())).toBeNull();
  });

  it('every refusal reason has a finite, positive TTL — none of them is "forever"', () => {
    for (const seconds of Object.values(REFUSAL_TTL_SECONDS)) {
      expect(Number.isFinite(seconds)).toBe(true);
      expect(seconds).toBeGreaterThan(0);
    }
  });
});
