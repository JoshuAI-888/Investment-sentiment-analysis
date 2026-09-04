/**
 * The dashboard's own small Upstash REST client, plus the keys it stores against.
 *
 * **Why this exists instead of one shared client.** No shared Redis wrapper exists yet in this
 * tree — `services/auth/send-cap.ts` (F02) built its own inline `RedisRestClient` for the same
 * reason: `02-ARCHITECTURE-CONTRACTS.md` §1 names Redis for "cache / locks / rate limits" but no
 * feature before this one needed a general client, so none was factored out. Reusing F02's
 * private client would reach into a merged, reviewed file outside this feature's scope for no
 * reason the diff could justify; this file follows the identical shape instead (`GET`/`SET`/
 * `INCR`/`EXPIRE` over Upstash's REST API, no `ioredis`, `check:bundle` stays green).
 *
 * **What Redis holds here, and why not Postgres.** `market.composite` and each sector tile's
 * metrics are looked up by "the latest one for this method+subject" — a query
 * `src/repositories/calculations.ts` does not expose (it only reads a `calculation_snapshot` by
 * its own id). Adding that read belongs to SPINE's `repositories/`, which this lane does not
 * own (`CLAUDE.md`) — reported under `CONTRACTS`. Until it exists, the pointer from "this
 * dashboard slot" to "its current calculationId" lives in Redis, written by
 * `refresh.ts` right after `persistArtifact` and read by `assemble.ts` via the already-exported
 * `loadArtifact`/`loadInspectorView`. This keeps the read path free of any SQL this lane would
 * have had to write itself (`no-sql-outside-repositories` forbids exactly that) while still
 * reading only from storage — no provider call sits anywhere in `assemble.ts`.
 */
import { env } from '@/env';

export type RedisClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
  del(key: string): Promise<void>;
};

export function upstashRestClient(url: string, token: string, fetchImpl: typeof fetch = fetch): RedisClient {
  async function command(...parts: readonly (string | number)[]): Promise<unknown> {
    const response = await fetchImpl(`${url}/${parts.map((part) => encodeURIComponent(String(part))).join('/')}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`Upstash Redis REST call failed: ${response.status} ${await response.text()}`);
    }
    const body = (await response.json()) as { result: unknown };
    return body.result;
  }

  return {
    get: async (key) => (await command('get', key)) as string | null,
    set: async (key, value) => {
      await command('set', key, value);
    },
    incr: async (key) => Number(await command('incr', key)),
    expire: async (key, seconds) => {
      await command('expire', key, seconds);
    },
    del: async (key) => {
      await command('del', key);
    },
  };
}

/** `undefined` when Redis is not configured — the same shape F02's `defaultRedisClient` uses. */
export function defaultRedisClient(): RedisClient | undefined {
  if (env.UPSTASH_REDIS_REST_URL === undefined || env.UPSTASH_REDIS_REST_TOKEN === undefined) {
    return undefined;
  }
  return upstashRestClient(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN);
}

/**
 * A process-local stand-in for the shape above, for dev and test where `DEPLOY.md`'s Upstash
 * project has not been provisioned. **Not a production substitute** — `02-ARCHITECTURE-
 * CONTRACTS.md` §1 names Redis for exactly this state, and a serverless deployment's
 * invocations do not share a process the way this `Map` assumes. Live mode with no Upstash
 * configured is a deployment misconfiguration to fix (`DEPLOY.md`), not a case this masks.
 */
export function inMemoryRedisClient(): RedisClient {
  const store = new Map<string, { value: string; expiresAt: number | null }>();

  function isLive(entry: { value: string; expiresAt: number | null } | undefined): entry is { value: string; expiresAt: number | null } {
    return entry !== undefined && (entry.expiresAt === null || entry.expiresAt > Date.now());
  }

  return {
    get: async (key) => {
      const entry = store.get(key);
      return isLive(entry) ? entry.value : null;
    },
    set: async (key, value) => {
      store.set(key, { value, expiresAt: null });
    },
    incr: async (key) => {
      const entry = store.get(key);
      const current = isLive(entry) ? Number(entry.value) : 0;
      const next = current + 1;
      store.set(key, { value: String(next), expiresAt: isLive(entry) ? entry.expiresAt : null });
      return next;
    },
    expire: async (key, seconds) => {
      const entry = store.get(key);
      if (entry === undefined) return;
      store.set(key, { ...entry, expiresAt: Date.now() + seconds * 1000 });
    },
    del: async (key) => {
      store.delete(key);
    },
  };
}

let sharedInMemoryClient: RedisClient | undefined;

/** `defaultRedisClient()` when Upstash is configured, a shared in-process fallback otherwise. */
export function resolveRedisClient(): RedisClient {
  const real = defaultRedisClient();
  if (real !== undefined) return real;

  sharedInMemoryClient ??= inMemoryRedisClient();
  return sharedInMemoryClient;
}

// ── Keys ──────────────────────────────────────────────────────────────────────────────────────

export const KEYS = {
  marketComposite: () => 'dashboard:pointer:market.composite',
  marketSectorBreadth: () => 'dashboard:pointer:market.sector_breadth',
  marketProxyMetric: (methodId: string) => `dashboard:pointer:market_proxy:${methodId}`,
  sectorMetric: (sectorKey: string, methodId: string) => `dashboard:pointer:sector:${sectorKey}:${methodId}`,
  computedDepth: () => 'dashboard:computed_depth',
  degradedProviders: () => 'dashboard:degraded_providers',
  lastRefusal: () => 'dashboard:last_refusal',
  refreshLock: () => 'dashboard:refresh:lock',
  refreshCooldown: () => 'dashboard:refresh:cooldown',
  marketauxQuotaDay: (day: string) => `dashboard:quota:marketaux:${day}`,
} as const;
