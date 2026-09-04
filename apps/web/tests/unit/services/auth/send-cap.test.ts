import { describe, expect, it, vi } from 'vitest';
import {
  OTP_SEND_CAP_DAILY,
  OTP_SEND_CAP_HOURLY,
  recordAndCheckSendCap,
  upstashRestClient,
  type RedisRestClient,
} from '@/services/auth/send-cap';

/** An in-memory stand-in for Upstash's REST surface, exercised through the real `incr`/`expire` shape. */
function fakeRedisClient(): RedisRestClient {
  const store = new Map<string, number>();
  return {
    incr: async (key) => {
      const next = (store.get(key) ?? 0) + 1;
      store.set(key, next);
      return next;
    },
    expire: async () => {},
  };
}

describe('recordAndCheckSendCap', () => {
  it('allows sends under both the hourly and daily caps', async () => {
    const client = fakeRedisClient();
    const result = await recordAndCheckSendCap(client, new Date('2026-08-30T12:00:00Z'));
    expect(result).toEqual({ allowed: true });
  });

  it('D-28: refuses the send once the hourly cap is exceeded, within the same hour', async () => {
    const client = fakeRedisClient();
    const now = new Date('2026-08-30T12:00:00Z');

    for (let i = 0; i < OTP_SEND_CAP_HOURLY; i += 1) {
      const result = await recordAndCheckSendCap(client, now);
      expect(result.allowed).toBe(true);
    }

    const overCap = await recordAndCheckSendCap(client, now);
    expect(overCap).toEqual({ allowed: false, window: 'hour', limit: OTP_SEND_CAP_HOURLY });
  });

  it('resets the hourly cap in the next hour but still tracks the daily cap', async () => {
    const client = fakeRedisClient();

    // Exhaust the daily cap across many distinct hours (each under the hourly cap).
    let count = 0;
    for (let hour = 0; hour < 24 && count < OTP_SEND_CAP_DAILY; hour += 1) {
      const now = new Date(Date.UTC(2026, 7, 30, hour, 0, 0));
      for (let i = 0; i < OTP_SEND_CAP_HOURLY && count < OTP_SEND_CAP_DAILY; i += 1) {
        const result = await recordAndCheckSendCap(client, now);
        expect(result.allowed).toBe(true);
        count += 1;
      }
    }

    const overDailyCap = await recordAndCheckSendCap(client, new Date(Date.UTC(2026, 7, 30, 23, 30, 0)));
    expect(overDailyCap).toEqual({ allowed: false, window: 'day', limit: OTP_SEND_CAP_DAILY });
  });

  it('the hourly cap sits comfortably under the Resend daily allowance (DEPLOY.md MT-02)', () => {
    expect(OTP_SEND_CAP_DAILY).toBeLessThan(100);
  });
});

describe('upstashRestClient', () => {
  it('issues INCR as a REST call with a bearer token and parses `result`', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: 4 }), { status: 200 }));
    const client = upstashRestClient('https://redis.example.com', 'a-token', fetchMock as unknown as typeof fetch);

    const value = await client.incr('otp-send-cap:hour:2026-08-30T12');

    expect(value).toBe(4);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('incr');
    expect(url).toContain('otp-send-cap');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer a-token');
  });

  it('throws on a non-OK response rather than silently treating it as zero', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 500 }));
    const client = upstashRestClient('https://redis.example.com', 'a-token', fetchMock as unknown as typeof fetch);

    await expect(client.incr('k')).rejects.toThrow();
  });
});
