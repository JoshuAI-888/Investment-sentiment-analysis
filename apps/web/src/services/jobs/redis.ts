/**
 * Re-exports the shared Upstash REST client for this feature's own lock and heartbeat keys —
 * the same choice `services/attention/redis.ts` already made and documented: `RedisClient`,
 * `resolveRedisClient` and `inMemoryRedisClient` carry nothing feature-specific, and
 * `services/dashboard/redis.ts` is already this codebase's one reviewed Upstash REST client.
 * Duplicating the REST plumbing a third time would be the opportunistic-refactor direction, not
 * the conservative one this build's own instructions ask for.
 */
export { resolveRedisClient, inMemoryRedisClient, type RedisClient } from '@/services/dashboard/redis';
