import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MailResult } from '@/services/auth/mailer';

const sendAuthEmailMock = vi.fn<() => Promise<MailResult>>(async () => ({ ok: true }));
vi.mock('@/services/auth/mailer', () => ({ sendAuthEmail: sendAuthEmailMock }));

const { decideAndSend } = await import('@/services/auth/send-decision');
import type { RedisRestClient } from '@/services/auth/send-cap';

const MAILER_CONFIG = { apiKey: 'test-key', from: 'welcome@accounts.joshuai.nz' };
const URL = 'https://example.com/api/auth/reset-password/abc123';

function allowingRedis(): RedisRestClient {
  return { incr: async () => 1, expire: async () => {} };
}

function cappingRedis(): RedisRestClient {
  return { incr: async () => 999, expire: async () => {} };
}

describe('decideAndSend', () => {
  beforeEach(() => {
    sendAuthEmailMock.mockClear();
  });

  it('fixture mode: remembers the link and never touches the mailer', async () => {
    const remember = vi.fn();
    const outcome = await decideAndSend(
      { to: 'anyone@example.com', url: URL, kind: 'reset-password' },
      {
        providerMode: 'fixture',
        redisClient: allowingRedis(),
        mailerConfig: MAILER_CONFIG,
        rememberFixtureLink: remember,
      },
    );

    expect(outcome).toEqual({ action: 'fixture' });
    expect(remember).toHaveBeenCalledWith('anyone@example.com', URL);
    expect(sendAuthEmailMock).not.toHaveBeenCalled();
  });

  it('D-39: any address in live mode, under the cap, reaches the mailer with the normalized address', async () => {
    const outcome = await decideAndSend(
      { to: 'Any.Address+tag@GMAIL.com', url: URL, kind: 'verify-email' },
      {
        providerMode: 'live',
        redisClient: allowingRedis(),
        mailerConfig: MAILER_CONFIG,
        rememberFixtureLink: vi.fn(),
      },
    );

    expect(outcome).toEqual({ action: 'sent' });
    expect(sendAuthEmailMock).toHaveBeenCalledWith(
      { to: 'anyaddress@gmail.com', url: URL, kind: 'verify-email' },
      MAILER_CONFIG,
    );
  });

  it('D-28: once the global send cap is hit, no further address reaches the mailer', async () => {
    const outcome = await decideAndSend(
      { to: 'someone@example.com', url: URL, kind: 'reset-password' },
      {
        providerMode: 'live',
        redisClient: cappingRedis(),
        mailerConfig: MAILER_CONFIG,
        rememberFixtureLink: vi.fn(),
        wait: async () => {},
      },
    );

    expect(outcome).toEqual({ action: 'capped', window: 'hour' });
    expect(sendAuthEmailMock).not.toHaveBeenCalled();
  });

  it('reports a real mailer failure instead of claiming sent', async () => {
    sendAuthEmailMock.mockResolvedValueOnce({
      ok: false,
      error: { kind: 'rate_limit', retryAfterMs: 60_000 },
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const outcome = await decideAndSend(
      { to: 'someone@example.com', url: URL, kind: 'reset-password' },
      {
        providerMode: 'live',
        redisClient: allowingRedis(),
        mailerConfig: MAILER_CONFIG,
        rememberFixtureLink: vi.fn(),
      },
    );

    expect(outcome).toEqual({
      action: 'send_failed',
      error: { kind: 'rate_limit', retryAfterMs: 60_000 },
    });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('with no Redis configured, an address still reaches the mailer (cap is best-effort, not a hard dependency)', async () => {
    const outcome = await decideAndSend(
      { to: 'someone@example.com', url: URL, kind: 'reset-password' },
      {
        providerMode: 'live',
        redisClient: undefined,
        mailerConfig: MAILER_CONFIG,
        rememberFixtureLink: vi.fn(),
      },
    );

    expect(outcome).toEqual({ action: 'sent' });
  });

  it('timing: the capped path and the sent path take comparable wall-clock time', async () => {
    const fastMailer = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

    sendAuthEmailMock.mockImplementationOnce(async () => {
      await fastMailer();
      return { ok: true as const };
    });

    const startSent = Date.now();
    await decideAndSend(
      { to: 'someone@example.com', url: URL, kind: 'reset-password' },
      {
        providerMode: 'live',
        redisClient: allowingRedis(),
        mailerConfig: MAILER_CONFIG,
        rememberFixtureLink: vi.fn(),
      },
    );
    const sentElapsed = Date.now() - startSent;

    const startCapped = Date.now();
    await decideAndSend(
      { to: 'someone-else@example.com', url: URL, kind: 'reset-password' },
      {
        providerMode: 'live',
        redisClient: cappingRedis(),
        mailerConfig: MAILER_CONFIG,
        rememberFixtureLink: vi.fn(),
      },
    );
    const cappedElapsed = Date.now() - startCapped;

    expect(sentElapsed).toBeGreaterThanOrEqual(170);
    expect(Math.abs(sentElapsed - cappedElapsed)).toBeLessThan(120);
  });

  it('a slow, realistic mailer call remains distinguishable from a capped refusal — a disclosed limit, not a silent one', async () => {
    sendAuthEmailMock.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 400));
      return { ok: true as const };
    });

    const startSent = Date.now();
    await decideAndSend(
      { to: 'someone@example.com', url: URL, kind: 'reset-password' },
      {
        providerMode: 'live',
        redisClient: allowingRedis(),
        mailerConfig: MAILER_CONFIG,
        rememberFixtureLink: vi.fn(),
      },
    );
    const sentElapsed = Date.now() - startSent;

    const startCapped = Date.now();
    await decideAndSend(
      { to: 'someone-else@example.com', url: URL, kind: 'reset-password' },
      {
        providerMode: 'live',
        redisClient: cappingRedis(),
        mailerConfig: MAILER_CONFIG,
        rememberFixtureLink: vi.fn(),
      },
    );
    const cappedElapsed = Date.now() - startCapped;

    expect(sentElapsed - cappedElapsed).toBeGreaterThan(150);
  });
});
