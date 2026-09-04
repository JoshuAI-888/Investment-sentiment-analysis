/**
 * D-38. Exercises `provisionSeedAccountIfEligible`/`clearMustChangePassword` against the real
 * singleton `auth` (`@/services/auth/instance`) — same reasoning as
 * `tests/unit/services/auth/lifecycle.test.ts`: these are thin wrappers around the real
 * `auth.$context`, so testing them against a real instance proves the actual integration, not a
 * reimplementation of it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { auth } from '@/services/auth/instance';
import { provisionSeedAccountIfEligible, clearMustChangePassword, WELCOME_PASSWORD } from '@/services/auth/seed-account';
import { env } from '@/env';

describe('provisionSeedAccountIfEligible', () => {
  const originalAllowlist = env.ADMIN_EMAIL_ALLOWLIST;
  const originalProviderMode = env.PROVIDER_MODE;

  afterEach(() => {
    env.ADMIN_EMAIL_ALLOWLIST = originalAllowlist;
    env.PROVIDER_MODE = originalProviderMode;
  });

  it('creates an account pre-verified, mustChangePassword true, with WELCOME_PASSWORD set', async () => {
    const email = `seed-happy-${Date.now()}@example.com`;

    const created = await provisionSeedAccountIfEligible(email);
    expect(created).toBe(true);

    const context = await auth.$context;
    const user = await context.internalAdapter.findUserByEmail(email);
    expect(user?.user.emailVerified).toBe(true);
    expect((user?.user as unknown as { mustChangePassword: boolean }).mustChangePassword).toBe(true);

    // The account signs in with WELCOME_PASSWORD, no verification step needed.
    const result = await auth.api.signInEmail({ body: { email, password: WELCOME_PASSWORD } });
    expect(result.user.email).toBe(email);
  });

  it('does nothing for an address that already has an account', async () => {
    const email = `seed-existing-${Date.now()}@example.com`;
    const first = await provisionSeedAccountIfEligible(email);
    expect(first).toBe(true);

    const second = await provisionSeedAccountIfEligible(email);
    expect(second).toBe(false);
  });

  it('live mode: refuses a non-allowlisted address', async () => {
    env.PROVIDER_MODE = 'live';
    env.ADMIN_EMAIL_ALLOWLIST = ['someone-else@example.com'];
    const email = `seed-not-allowed-${Date.now()}@example.com`;

    const created = await provisionSeedAccountIfEligible(email);
    expect(created).toBe(false);

    env.PROVIDER_MODE = 'fixture';
    await expect(auth.api.signInEmail({ body: { email, password: WELCOME_PASSWORD } })).rejects.toThrow();
  });

  it('live mode: allows an allowlisted address', async () => {
    const email = `seed-allowed-${Date.now()}@example.com`;
    env.PROVIDER_MODE = 'live';
    env.ADMIN_EMAIL_ALLOWLIST = [email];

    const created = await provisionSeedAccountIfEligible(email);
    expect(created).toBe(true);
  });
});

describe('clearMustChangePassword', () => {
  it('flips the flag to false and the user row reflects it', async () => {
    const email = `seed-clear-${Date.now()}@example.com`;
    await provisionSeedAccountIfEligible(email);

    const context = await auth.$context;
    const before = await context.internalAdapter.findUserByEmail(email);
    expect((before?.user as unknown as { mustChangePassword: boolean }).mustChangePassword).toBe(true);

    await clearMustChangePassword(before!.user.id);

    const after = await context.internalAdapter.findUserByEmail(email);
    expect((after?.user as unknown as { mustChangePassword: boolean }).mustChangePassword).toBe(false);
  });
});
