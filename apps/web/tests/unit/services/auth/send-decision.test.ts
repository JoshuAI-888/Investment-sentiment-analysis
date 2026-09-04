import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MailResult } from '@/services/auth/mailer';

const sendOtpEmailMock = vi.fn<() => Promise<MailResult>>(async () => ({ ok: true }));
vi.mock('@/services/auth/mailer', () => ({ sendOtpEmail: sendOtpEmailMock }));

const { decideAndSend } = await import('@/services/auth/send-decision');
import type { RedisRestClient } from '@/services/auth/send-cap';

const MAILER_CONFIG = { apiKey: 'test-key', from: 'welcome@accounts.joshuai.nz' };
const ALLOWLIST = ['joshuaifang@gmail.com'];

function allowingRedis(): RedisRestClient {
  return { incr: async () => 1, expire: async () => {} };
}

function cappingRedis(): RedisRestClient {
  return { incr: async () => 999, expire: async () => {} };
}

describe('decideAndSend', () => {
  beforeEach(() => {
    sendOtpEmailMock.mockClear();
  });

  it('fixture mode: remembers the code and never touches the mailer, allowlisted or not', async () => {
    const remember = vi.fn();
    const outcome = await decideAndSend(
      { to: 'anyone@example.com', otp: '123456', type: 'sign-in' },
      {
        providerMode: 'fixture',
        allowlist: ALLOWLIST,
        redisClient: allowingRedis(),
        mailerConfig: MAILER_CONFIG,
        rememberFixtureOtp: remember,
      },
    );

    expect(outcome).toEqual({ action: 'fixture' });
    expect(remember).toHaveBeenCalledWith('anyone@example.com', '123456');
    expect(sendOtpEmailMock).not.toHaveBeenCalled();
  });

  it('§4.2: a non-allowlisted address in live mode never reaches the mailer', async () => {
    const outcome = await decideAndSend(
      { to: 'attacker@example.com', otp: '123456', type: 'sign-in' },
      {
        providerMode: 'live',
        allowlist: ALLOWLIST,
        redisClient: allowingRedis(),
        mailerConfig: MAILER_CONFIG,
        rememberFixtureOtp: vi.fn(),
        wait: async () => {},
      },
    );

    expect(outcome).toEqual({ action: 'not_allowlisted' });
    expect(sendOtpEmailMock).not.toHaveBeenCalled();
  });

  it('an allowlisted address in live mode, under the cap, reaches the mailer with the normalized address', async () => {
    const outcome = await decideAndSend(
      { to: 'Joshua.iFang@GMAIL.com', otp: '123456', type: 'sign-in' },
      {
        providerMode: 'live',
        allowlist: ALLOWLIST,
        redisClient: allowingRedis(),
        mailerConfig: MAILER_CONFIG,
        rememberFixtureOtp: vi.fn(),
      },
    );

    expect(outcome).toEqual({ action: 'sent' });
    expect(sendOtpEmailMock).toHaveBeenCalledWith(
      { to: 'joshuaifang@gmail.com', otp: '123456', type: 'sign-in' },
      MAILER_CONFIG,
    );
  });

  it('D-28: an allowlisted address over the send cap never reaches the mailer', async () => {
    const outcome = await decideAndSend(
      { to: 'joshuaifang@gmail.com', otp: '123456', type: 'sign-in' },
      {
        providerMode: 'live',
        allowlist: ALLOWLIST,
        redisClient: cappingRedis(),
        mailerConfig: MAILER_CONFIG,
        rememberFixtureOtp: vi.fn(),
        wait: async () => {},
      },
    );

    expect(outcome).toEqual({ action: 'capped', window: 'hour' });
    expect(sendOtpEmailMock).not.toHaveBeenCalled();
  });

  it('reports a real mailer failure instead of claiming sent (lane-review)', async () => {
    // THE REGRESSION. `MailResult` used to be discarded unconditionally: whatever Resend
    // actually did, the caller was told `sent`, the send cap had already been spent, and there
    // was no application-level record of why. Replace `sendOtpEmail` with a call that always
    // fails and this assertion catches it — nothing would have failed before this fix.
    sendOtpEmailMock.mockResolvedValueOnce({
      ok: false,
      error: { kind: 'rate_limit', retryAfterMs: 60_000 },
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const outcome = await decideAndSend(
      { to: 'joshuaifang@gmail.com', otp: '123456', type: 'sign-in' },
      {
        providerMode: 'live',
        allowlist: ALLOWLIST,
        redisClient: allowingRedis(),
        mailerConfig: MAILER_CONFIG,
        rememberFixtureOtp: vi.fn(),
      },
    );

    expect(outcome).toEqual({
      action: 'send_failed',
      error: { kind: 'rate_limit', retryAfterMs: 60_000 },
    });
    // Findable in a deployment log by more than the Resend SDK's own incidental output.
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('with no Redis configured, an allowlisted address still reaches the mailer (cap is best-effort, not a hard dependency)', async () => {
    const outcome = await decideAndSend(
      { to: 'joshuaifang@gmail.com', otp: '123456', type: 'sign-in' },
      {
        providerMode: 'live',
        allowlist: ALLOWLIST,
        redisClient: undefined,
        mailerConfig: MAILER_CONFIG,
        rememberFixtureOtp: vi.fn(),
      },
    );

    expect(outcome).toEqual({ action: 'sent' });
  });

  it('enumeration: the not-allowlisted path and the sent path take comparable wall-clock time', async () => {
    // The stub must resolve well under `TIMING_EQUALIZER_MS` (180ms) for this test to bind. A
    // second lane-review pass found the original 150ms stub did not: unfixed, a fast mailer call
    // (150ms) plus the refused path's near-instant synthetic wait (~0ms) already differ by only
    // ~150ms, under this test's own 120ms tolerance — so the test passed on the *old*, discarding
    // code too, and proved nothing. A 10ms stub makes the two behave very differently depending
    // on whether the fix is present: unfixed, `sent` finishes in ~10ms while `not_allowlisted`
    // waits out the full 180ms floor, a ~170ms gap; with the fix, the floor pulls both paths up
    // to ~180ms regardless of how fast the mailer answered.
    const fastMailer = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

    sendOtpEmailMock.mockImplementationOnce(async () => {
      await fastMailer();
      return { ok: true as const };
    });

    const startSent = Date.now();
    await decideAndSend(
      { to: 'joshuaifang@gmail.com', otp: '111111', type: 'sign-in' },
      {
        providerMode: 'live',
        allowlist: ALLOWLIST,
        redisClient: allowingRedis(),
        mailerConfig: MAILER_CONFIG,
        rememberFixtureOtp: vi.fn(),
      },
    );
    const sentElapsed = Date.now() - startSent;

    const startRefused = Date.now();
    await decideAndSend(
      { to: 'attacker@example.com', otp: '222222', type: 'sign-in' },
      {
        providerMode: 'live',
        allowlist: ALLOWLIST,
        redisClient: allowingRedis(),
        mailerConfig: MAILER_CONFIG,
        rememberFixtureOtp: vi.fn(),
      },
    );
    const refusedElapsed = Date.now() - startRefused;

    // The fast `sent` path was actually brought up to the floor, not just coincidentally close
    // to the refused path's timing — this is what the test above missed.
    expect(sentElapsed).toBeGreaterThanOrEqual(170);
    // Not exact — real network jitter is not something a unit test should assert on — but the
    // synthetic wait in the refused path should keep the two within the same rough band rather
    // than one being near-instant and the other network-latency-sized. This only holds because
    // the equalizer wait now runs on the `sent` path too (lane-review).
    expect(Math.abs(sentElapsed - refusedElapsed)).toBeLessThan(120);
  });

  it('a slow, realistic mailer call remains distinguishable — a disclosed limit, not a silent one', async () => {
    // §4.2's timing defense is a floor, not a ceiling (see `TIMING_EQUALIZER_MS`'s doc comment):
    // it stops a *fast* Resend response from standing out, but a live round trip commonly runs
    // 250-600ms, well past the 180ms floor, and nothing in this module brings a slow `sent` path
    // back down to match a `not_allowlisted` refusal's near-instant, synthetic-wait-only timing.
    // Closing that gap needs the send dispatched outside the request/response path entirely.
    // This test exists so that gap stays a documented property of the design, not a claim the
    // suite silently stops backing the moment someone tries a slower fixture.
    sendOtpEmailMock.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 400));
      return { ok: true as const };
    });

    const startSent = Date.now();
    await decideAndSend(
      { to: 'joshuaifang@gmail.com', otp: '333333', type: 'sign-in' },
      {
        providerMode: 'live',
        allowlist: ALLOWLIST,
        redisClient: allowingRedis(),
        mailerConfig: MAILER_CONFIG,
        rememberFixtureOtp: vi.fn(),
      },
    );
    const sentElapsed = Date.now() - startSent;

    const startRefused = Date.now();
    await decideAndSend(
      { to: 'attacker@example.com', otp: '444444', type: 'sign-in' },
      {
        providerMode: 'live',
        allowlist: ALLOWLIST,
        redisClient: allowingRedis(),
        mailerConfig: MAILER_CONFIG,
        rememberFixtureOtp: vi.fn(),
      },
    );
    const refusedElapsed = Date.now() - startRefused;

    expect(sentElapsed - refusedElapsed).toBeGreaterThan(150);
  });
});
