/**
 * F02 §5's unit/integration row for password auth: password hashing; sign-up creates an
 * unverified user; sign-in is refused until verified; a correct verification link signs in;
 * wrong password is refused; forgot-password → reset → sign in with the new password. Run
 * against the real `emailAndPassword`/`emailVerification` config and Better Auth's in-memory
 * adapter — no live Postgres needed, because F02's storage swaps to the memory adapter outside
 * `PROVIDER_MODE=live` (`src/services/auth/instance.ts`), which is also why these run here
 * rather than only in `tests/unit/`: they exercise the real config, not a reimplementation of
 * its rules.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { MemoryDB } from 'better-auth/adapters/memory';
import { createAuthInstance, createEmptyMemoryDb } from '@/services/auth/instance';
import { clearFixtureLinkStore, readFixtureLink } from '@/services/auth/fixture-link-store';

const PASSWORD = 'correct horse battery staple';

function freshAuth() {
  const fixtureDb: MemoryDB = createEmptyMemoryDb();
  return { auth: createAuthInstance({ fixtureDb }), fixtureDb };
}

function accountRows(fixtureDb: MemoryDB): Array<Record<string, unknown>> {
  return (fixtureDb['account'] ?? []) as Array<Record<string, unknown>>;
}

describe('password mechanics (real emailAndPassword config, in-memory storage)', () => {
  beforeEach(() => {
    clearFixtureLinkStore();
  });

  it('is hashed at rest — never stored as the plaintext value', async () => {
    const { auth, fixtureDb } = freshAuth();
    const email = 'hash-test@example.com';

    await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: email } });

    const rows = accountRows(fixtureDb);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const stored = row['password'];
      if (stored === undefined || stored === null) continue;
      expect(String(stored)).not.toBe(PASSWORD);
      expect(String(stored)).not.toContain(PASSWORD);
    }
  });

  it('sign-up sends a verification link and the account cannot sign in until it is used', async () => {
    const { auth } = freshAuth();
    const email = 'unverified@example.com';

    await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: email } });
    expect(readFixtureLink(email)).not.toBeNull();

    await expect(auth.api.signInEmail({ body: { email, password: PASSWORD } })).rejects.toThrow();
  });

  it('a correct password signs in once the account is verified', async () => {
    const { auth } = freshAuth();
    const email = 'happy-path@example.com';

    await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: email } });
    const verifyUrl = readFixtureLink(email) as string;
    const token = new URL(verifyUrl).searchParams.get('token') as string;
    await auth.api.verifyEmail({ query: { token } });

    const result = await auth.api.signInEmail({ body: { email, password: PASSWORD } });
    expect(result.user.email).toBe(email);
    expect(result.token).toBeTruthy();
  });

  it('a wrong password is refused, even after verification', async () => {
    const { auth } = freshAuth();
    const email = 'wrong-password@example.com';

    await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: email } });
    const verifyUrl = readFixtureLink(email) as string;
    const token = new URL(verifyUrl).searchParams.get('token') as string;
    await auth.api.verifyEmail({ query: { token } });

    await expect(
      auth.api.signInEmail({ body: { email, password: 'entirely-the-wrong-password' } }),
    ).rejects.toThrow();
  });

  it('forgot password → reset → sign in with the new password; the old one no longer works', async () => {
    const { auth } = freshAuth();
    const email = 'reset-me@example.com';

    await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: email } });
    const verifyUrl = readFixtureLink(email) as string;
    await auth.api.verifyEmail({ query: { token: new URL(verifyUrl).searchParams.get('token') as string } });

    clearFixtureLinkStore();
    await auth.api.requestPasswordReset({ body: { email, redirectTo: '/reset-password' } });
    const resetUrl = readFixtureLink(email) as string;
    // Unlike the verification link, the mailed reset URL carries the token as a **path segment**
    // (`${baseURL}/reset-password/${token}?callbackURL=...`) — Better Auth's own GET callback
    // redirects that to `${callbackURL}?token=...` for a real browser to land on. A real browser
    // follows that redirect automatically (`tests/e2e/auth.spec.ts`'s `page.goto(resetUrl)`
    // does too); this direct `auth.api` call has no browser to follow it, so the token is read
    // off the path instead of re-deriving the redirect by hand.
    const resetToken = new URL(resetUrl).pathname.split('/').pop() as string;

    const newPassword = 'a completely different passphrase';
    await auth.api.resetPassword({ body: { token: resetToken, newPassword } });

    await expect(auth.api.signInEmail({ body: { email, password: PASSWORD } })).rejects.toThrow();
    const result = await auth.api.signInEmail({ body: { email, password: newPassword } });
    expect(result.user.email).toBe(email);
  });
});
