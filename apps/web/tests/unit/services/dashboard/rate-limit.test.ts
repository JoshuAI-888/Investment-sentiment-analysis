import { describe, expect, it } from 'vitest';
import { inMemoryRedisClient } from '../../../../src/services/dashboard/redis';
import { acquireRefreshLock, checkRefreshRateLimit } from '../../../../src/services/dashboard/rate-limit';

describe('checkRefreshRateLimit', () => {
  it('allows the first refresh', async () => {
    const redis = inMemoryRedisClient();
    expect((await checkRefreshRateLimit(redis)).allowed).toBe(true);
  });

  it('refuses a second refresh inside the cooldown window', async () => {
    const redis = inMemoryRedisClient();
    await checkRefreshRateLimit(redis);
    const second = await checkRefreshRateLimit(redis);
    expect(second.allowed).toBe(false);
    if (!second.allowed) expect(second.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe('acquireRefreshLock — idempotency', () => {
  it('grants the lock to the first caller', async () => {
    const redis = inMemoryRedisClient();
    const lock = await acquireRefreshLock(redis);
    expect(lock).not.toBeNull();
  });

  it('refuses a second concurrent caller while the first holds the lock', async () => {
    const redis = inMemoryRedisClient();
    const first = await acquireRefreshLock(redis);
    expect(first).not.toBeNull();
    const second = await acquireRefreshLock(redis);
    expect(second).toBeNull();
  });

  it('a released lock can be re-acquired', async () => {
    const redis = inMemoryRedisClient();
    const first = await acquireRefreshLock(redis);
    await first?.release();
    const second = await acquireRefreshLock(redis);
    expect(second).not.toBeNull();
  });
});
