import { describe, expect, it } from 'vitest';
import { inMemoryRedisClient } from '../../../../src/services/jobs/redis';
import { acquireDispatchLock } from '../../../../src/services/jobs/lock';

/**
 * F16 §4.1 step 2 / step 7, and §6 DoD: "Redis lock prevents overlap; a duplicate delivery is a
 * no-op; an expired lock recovers." / "Locks are released on every exit path, including panics."
 */
describe('acquireDispatchLock', () => {
  it('grants the lock to the first caller and refuses a concurrent second one', async () => {
    const redis = inMemoryRedisClient();

    const first = await acquireDispatchLock(redis, 60);
    expect(first).not.toBeNull();

    const second = await acquireDispatchLock(redis, 60);
    expect(second).toBeNull();
  });

  it('releases the lock, after which a new caller can acquire it', async () => {
    const redis = inMemoryRedisClient();

    const first = await acquireDispatchLock(redis, 60);
    expect(first).not.toBeNull();
    await first?.release();

    const second = await acquireDispatchLock(redis, 60);
    expect(second).not.toBeNull();
  });

  it('release is idempotent — releasing twice does not throw', async () => {
    const redis = inMemoryRedisClient();
    const lock = await acquireDispatchLock(redis, 60);
    await lock?.release();
    await expect(lock?.release()).resolves.toBeUndefined();
  });

  it('an expired lock recovers without an explicit release', async () => {
    const redis = inMemoryRedisClient();

    // A 0-second TTL expires immediately under `inMemoryRedisClient`'s own `Date.now()`-based
    // expiry check (`expiresAt > Date.now()`), simulating a stuck dispatcher whose lock outlived
    // its own process without ever calling `release`.
    const stuck = await acquireDispatchLock(redis, 0);
    expect(stuck).not.toBeNull();

    const recovered = await acquireDispatchLock(redis, 60);
    expect(recovered).not.toBeNull();
  });

  it('a failure after acquiring still allows release from a finally block', async () => {
    const redis = inMemoryRedisClient();
    const lock = await acquireDispatchLock(redis, 60);
    expect(lock).not.toBeNull();

    async function work(): Promise<void> {
      try {
        throw new Error('simulated dispatch failure mid-tick');
      } finally {
        await lock?.release();
      }
    }

    await expect(work()).rejects.toThrow('simulated dispatch failure mid-tick');

    const afterFailure = await acquireDispatchLock(redis, 60);
    expect(afterFailure).not.toBeNull();
  });
});
