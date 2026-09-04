/**
 * F02 §4.2 — the send cap. **Ratified by the owner, D-28: this is not the throttle machinery
 * D-11 cut.** D-11 removed the per-email, per-IP and global throttling *tables* that policed a
 * user population that no longer exists. What survives is one constant capping sends to the
 * one allowlisted address — because that address is public knowledge to anyone who has seen
 * the app, and without a cap, anyone who knows it can lock the owner out of their own system
 * by exhausting Resend's free-tier allowance. Do not fold this back into "throttle machinery"
 * and remove it; D-28 is explicit that single-user is exactly why it matters.
 *
 * Backed by Upstash Redis (REST), per `02-ARCHITECTURE-CONTRACTS.md` §1 — "Cache / locks /
 * rate limits". A plain `INCR` + conditional `EXPIRE` on an hour-bucketed and a day-bucketed
 * key, both well under Resend's free-tier 100/day (`DEPLOY.md` MT-02).
 */
import { env } from '@/env';

/** Comfortably below Resend's 100/day free-tier allowance (`DEPLOY.md` MT-02). */
export const OTP_SEND_CAP_HOURLY = 10;
export const OTP_SEND_CAP_DAILY = 50;

export type SendCapResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly window: 'hour' | 'day'; readonly limit: number };

export type RedisRestClient = {
  /** `INCR key`, returning the post-increment value. */
  incr: (key: string) => Promise<number>;
  /** `EXPIRE key seconds`, fire-and-forget — only called right after a key is created at 1. */
  expire: (key: string, seconds: number) => Promise<void>;
};

/**
 * The real client: Upstash's REST API over `fetch`, so no Redis TCP client (and no `ioredis`
 * import — `check:bundle` bans it) needs to exist anywhere in this tree.
 */
export function upstashRestClient(
  url: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): RedisRestClient {
  async function command(...parts: readonly (string | number)[]): Promise<unknown> {
    const response = await fetchImpl(`${url}/${parts.map((p) => encodeURIComponent(String(p))).join('/')}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`Upstash Redis REST call failed: ${response.status} ${await response.text()}`);
    }
    const body = (await response.json()) as { result: unknown };
    return body.result;
  }

  return {
    incr: async (key) => Number(await command('incr', key)),
    expire: async (key, seconds) => {
      await command('expire', key, seconds);
    },
  };
}

function hourKey(now: Date): string {
  return `otp-send-cap:hour:${now.toISOString().slice(0, 13)}`; // YYYY-MM-DDTHH
}

function dayKey(now: Date): string {
  return `otp-send-cap:day:${now.toISOString().slice(0, 10)}`; // YYYY-MM-DD
}

/**
 * Increments both windows and reports whether *this* send is still under both caps. Called
 * once per OTP actually destined for the allowlisted address — never for a refused,
 * non-allowlisted request, which never reaches this function at all (§4.2's allowlist-before-
 * send ordering).
 */
export async function recordAndCheckSendCap(
  client: RedisRestClient,
  now: Date = new Date(),
): Promise<SendCapResult> {
  const hKey = hourKey(now);
  const dKey = dayKey(now);

  const hourCount = await client.incr(hKey);
  if (hourCount === 1) await client.expire(hKey, 3600);
  if (hourCount > OTP_SEND_CAP_HOURLY) {
    return { allowed: false, window: 'hour', limit: OTP_SEND_CAP_HOURLY };
  }

  const dayCount = await client.incr(dKey);
  if (dayCount === 1) await client.expire(dKey, 86_400);
  if (dayCount > OTP_SEND_CAP_DAILY) {
    return { allowed: false, window: 'day', limit: OTP_SEND_CAP_DAILY };
  }

  return { allowed: true };
}

/**
 * The client this process actually uses. `undefined` when Redis is not configured (fixture
 * mode never reaches it — `PROVIDER_MODE !== 'live'` short-circuits before this is called).
 */
export function defaultRedisClient(): RedisRestClient | undefined {
  if (env.UPSTASH_REDIS_REST_URL === undefined || env.UPSTASH_REDIS_REST_TOKEN === undefined) {
    return undefined;
  }
  return upstashRestClient(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN);
}
