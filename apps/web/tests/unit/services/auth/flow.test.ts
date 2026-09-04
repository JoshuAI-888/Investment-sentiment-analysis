/**
 * D-38. `signInWithPassword`'s welcome1 fallback and `changePassword`, against the real
 * singleton `auth` — same reasoning as `lifecycle.test.ts` and `seed-account.test.ts`: these are
 * thin wrappers, testing them against the real instance proves the actual integration.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  signInWithPassword,
  signUpWithPassword,
  changePassword,
  requireUser,
  PasswordChangeRequiredError,
  WELCOME_PASSWORD,
} from '@/services/auth';
import { readFixtureLink } from '@/services/auth/fixture-link-store';
import { auth } from '@/services/auth/instance';

let currentCookie = '';

vi.mock('next/headers', () => ({
  headers: async () => new Headers(currentCookie === '' ? {} : { cookie: currentCookie }),
}));

describe('signInWithPassword — the welcome1 fallback', () => {
  beforeEach(() => {
    currentCookie = '';
  });

  it('a nonexistent, allowlisted-in-fixture address signs in on the first attempt with WELCOME_PASSWORD', async () => {
    const email = `flow-seed-${Date.now()}@example.com`;

    const result = await signInWithPassword(email, WELCOME_PASSWORD);
    expect(result.ok).toBe(true);
  });

  it('the seeded session is flagged mustChangePassword — requireUser() refuses it', async () => {
    const email = `flow-seed-must-change-${Date.now()}@example.com`;

    const result = await signInWithPassword(email, WELCOME_PASSWORD);
    expect(result.ok).toBe(true);

    const response = await auth.api.signInEmail({ body: { email, password: WELCOME_PASSWORD }, asResponse: true });
    const setCookie = response.headers.get('set-cookie');
    currentCookie = setCookie?.split(';')[0] ?? '';

    await expect(requireUser()).rejects.toBeInstanceOf(PasswordChangeRequiredError);
  });

  it('a wrong, non-WELCOME_PASSWORD attempt against a nonexistent address is just refused, no account created', async () => {
    const email = `flow-no-seed-${Date.now()}@example.com`;

    const result = await signInWithPassword(email, 'not-the-welcome-password');
    expect(result.ok).toBe(false);

    // Confirms no account was silently created for an arbitrary guess.
    const second = await signInWithPassword(email, WELCOME_PASSWORD);
    expect(second.ok).toBe(true);
  });

  it('an existing self-service account with a real password is untouched by a stray WELCOME_PASSWORD guess', async () => {
    const email = `flow-real-account-${Date.now()}@example.com`;
    await signUpWithPassword(email, 'a real chosen passphrase');
    const verifyUrl = readFixtureLink(email) as string;
    const token = new URL(verifyUrl).searchParams.get('token') as string;
    await auth.api.verifyEmail({ query: { token } });

    const guess = await signInWithPassword(email, WELCOME_PASSWORD);
    expect(guess.ok).toBe(false);

    const real = await signInWithPassword(email, 'a real chosen passphrase');
    expect(real.ok).toBe(true);
  });
});

describe('changePassword', () => {
  beforeEach(() => {
    currentCookie = '';
  });

  async function signInAndGetCookie(email: string, password: string): Promise<void> {
    const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
    const setCookie = response.headers.get('set-cookie');
    currentCookie = setCookie?.split(';')[0] ?? '';
  }

  it('clears mustChangePassword and the new password works; the old one no longer does', async () => {
    const email = `flow-change-${Date.now()}@example.com`;
    await signInWithPassword(email, WELCOME_PASSWORD); // provisions + signs in
    await signInAndGetCookie(email, WELCOME_PASSWORD);

    const result = await changePassword(WELCOME_PASSWORD, 'a brand new real password');
    expect(result.ok).toBe(true);

    // requireUser() no longer refuses this account for mustChangePassword.
    const stillWelcome = await signInWithPassword(email, WELCOME_PASSWORD);
    expect(stillWelcome.ok).toBe(false);
    const withNewPassword = await signInWithPassword(email, 'a brand new real password');
    expect(withNewPassword.ok).toBe(true);
  });

  it('the wrong current password is refused and nothing changes', async () => {
    const email = `flow-change-wrong-${Date.now()}@example.com`;
    await signInWithPassword(email, WELCOME_PASSWORD);
    await signInAndGetCookie(email, WELCOME_PASSWORD);

    const result = await changePassword('not-the-real-current-password', 'a brand new real password');
    expect(result).toEqual({ ok: false, reason: 'wrong_current_password' });

    const stillWelcome = await signInWithPassword(email, WELCOME_PASSWORD);
    expect(stillWelcome.ok).toBe(true);
  });

  it('a too-short new password is refused', async () => {
    const email = `flow-change-weak-${Date.now()}@example.com`;
    await signInWithPassword(email, WELCOME_PASSWORD);
    await signInAndGetCookie(email, WELCOME_PASSWORD);

    const result = await changePassword(WELCOME_PASSWORD, 'short');
    expect(result).toEqual({ ok: false, reason: 'weak_password' });
  });
});
