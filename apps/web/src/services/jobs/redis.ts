/**
 * F16a's own Redis namespace, over the same small REST client F07 built
 * (`services/dashboard/redis.ts`) — `resolveRedisClient`/`RedisClient` re-exported rather than
 * duplicated, the identical move `services/attention/redis.ts` already made for the identical
 * reason (that file's own doc comment). A third hand-rolled Upstash REST wrapper would be the
 * opportunistic-refactor direction this codebase's own build discipline forbids.
 */
export { resolveRedisClient, inMemoryRedisClient, type RedisClient } from '@/services/dashboard/redis';

export const KEYS = {
  /**
   * F16 §4.1 step 2: "Acquire a Redis lock with a TTL exceeding the maximum run time. A second
   * concurrent delivery is a no-op, not a queued duplicate." One key for the whole dispatch tick
   * — not per-job — because QStash's five-minute schedule delivers one request that may claim
   * several due jobs in one pass (`dueJobDefinitions`' own page), and two overlapping *ticks*
   * (a slow tick still running when the next one fires) are the collision this lock exists to
   * prevent, not two different jobs running concurrently within one tick.
   */
  dispatchTickLock: () => 'jobs:dispatch:tick:lock',
} as const;
