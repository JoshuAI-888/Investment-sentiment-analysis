/**
 * F02 §6: "every admin server action calls `requireAdmin()` in its own body; a negative-
 * authorization E2E covers each." `refreshDataSources` (`app/(admin)/admin/actions.ts`) is
 * called from nowhere in the app yet — there is no UI path an e2e could drive — so it had zero
 * test coverage at any level: deleting its `await requireAdmin()` line left the whole gate
 * green. Found by lane-review.
 *
 * Exercises the real singleton `auth` instance (`@/services/auth/instance`) and the real
 * `requireAdmin()` (`@/services/auth/session`), the same pieces the e2e suite drives through a
 * browser — `next/headers` is mocked only because there is no real Next.js request here to carry
 * the session cookie, not because any auth logic itself is faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auth } from '@/services/auth/instance';
import { readFixtureOtp, clearFixtureOtpStore } from '@/services/auth/fixture-otp-store';
import { env } from '@/env';

let currentCookie = '';

vi.mock('next/headers', () => ({
  headers: async () => new Headers(currentCookie === '' ? {} : { cookie: currentCookie }),
}));

const { refreshDataSources } = await import('../../../../app/(admin)/admin/actions');

async function signIn(email: string): Promise<void> {
  await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } });
  const otp = readFixtureOtp(email);
  if (otp === null) throw new Error('test setup: no fixture OTP was recorded');
  const response = await auth.api.signInEmailOTP({ body: { email, otp }, asResponse: true });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie === null) throw new Error('test setup: sign-in did not set a session cookie');
  currentCookie = setCookie.split(';')[0] ?? '';
}

describe('refreshDataSources — requireAdmin() is genuinely called, not decoration', () => {
  const originalAllowlist = env.ADMIN_EMAIL_ALLOWLIST;

  beforeEach(() => {
    clearFixtureOtpStore();
    currentCookie = '';
  });

  afterEach(() => {
    env.ADMIN_EMAIL_ALLOWLIST = originalAllowlist;
  });

  it('throws UnauthenticatedError with no session at all', async () => {
    await expect(refreshDataSources()).rejects.toThrow('No session. Sign in required.');
  });

  it('throws UnauthorizedError for a signed-in session that is not on the allowlist', async () => {
    env.ADMIN_EMAIL_ALLOWLIST = ['someone-else@example.com'];
    await signIn('not-admin@example.com');

    await expect(refreshDataSources()).rejects.toThrow('not on the admin allowlist');
  });

  it('succeeds for a signed-in, allowlisted session', async () => {
    env.ADMIN_EMAIL_ALLOWLIST = ['admin-action-test@example.com'];
    await signIn('admin-action-test@example.com');

    // THE REGRESSION this test closes: before it existed, deleting `await requireAdmin();`
    // from `refreshDataSources`'s body left every test in this repository green.
    await expect(refreshDataSources()).resolves.toEqual({ ok: true, state: 'fixture' });
  });
});
