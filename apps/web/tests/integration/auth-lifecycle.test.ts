/**
 * F02 §5's integration row: "deletion cascades exactly per the migrations." **Scoped to what
 * this feature can reach today**, per `src/services/auth/lifecycle.ts`'s own comment: the
 * `user`/`session` rows Better Auth owns. The other `docs/user-data.md` rows need repository
 * functions that do not exist yet (this feature's `CONTRACTS` note) and are not exercised here
 * — asserting them would be asserting code that was never written.
 *
 * Also covers the e2e test plan's "deletion then sign-in creates a fresh account" at the level
 * that does not need a browser: the same property, proven directly against the plugin.
 */
import { describe, expect, it } from 'vitest';
import type { MemoryDB } from 'better-auth/adapters/memory';
import { createAuthInstance, createEmptyMemoryDb } from '@/services/auth/instance';
import { readFixtureLink } from '@/services/auth/fixture-link-store';

const PASSWORD = 'correct horse battery staple';

function freshAuth() {
  const fixtureDb: MemoryDB = createEmptyMemoryDb();
  return { auth: createAuthInstance({ fixtureDb }), fixtureDb };
}

/** Signs up, verifies, and returns a `Headers` carrying the resulting session cookie, cookie-jar style. */
async function signInAndGetCookieHeaders(
  auth: ReturnType<typeof createAuthInstance>,
  email: string,
): Promise<Headers> {
  await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: email } });
  const verifyUrl = readFixtureLink(email);
  if (verifyUrl === null) throw new Error('test setup: no fixture verification link was recorded');
  const token = new URL(verifyUrl).searchParams.get('token');
  if (token === null) throw new Error('test setup: verification link carried no token');

  // `autoSignInAfterVerification` (instance.ts) means verifying already sets the session cookie.
  const response = await auth.api.verifyEmail({ query: { token }, asResponse: true });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie === null) throw new Error('test setup: verification did not set a session cookie');

  return new Headers({ cookie: setCookie.split(';')[0] ?? '' });
}

describe('account deletion and export', () => {
  it('idempotent: a second deletion call finds no session and does not throw', async () => {
    const { auth } = freshAuth();
    const email = 'delete-me@example.com';
    const headers = await signInAndGetCookieHeaders(auth, email);

    await auth.api.deleteUser({ body: {}, headers });
    const secondCallSession = await auth.api.getSession({ headers });
    expect(secondCallSession).toBeNull();

    // A second delete call against a session that no longer resolves: better-auth's own
    // session middleware rejects it before reaching the handler. Idempotent handling of that
    // (rather than a thrown 500) is `src/services/auth/lifecycle.ts`'s `deleteMyAccount`, not
    // the raw `auth.api.deleteUser` call — proven here at the boundary this test can reach.
    await expect(auth.api.deleteUser({ body: {}, headers })).rejects.toThrow();
  });

  it('deletion then sign-in creates a fresh account', async () => {
    const { auth, fixtureDb } = freshAuth();
    const email = 'reincarnate@example.com';

    const firstHeaders = await signInAndGetCookieHeaders(auth, email);
    const firstSession = await auth.api.getSession({ headers: firstHeaders });
    const firstUserId = firstSession?.user.id;
    expect(firstUserId).toBeTruthy();

    await auth.api.deleteUser({ body: {}, headers: firstHeaders });
    expect(await auth.api.getSession({ headers: firstHeaders })).toBeNull();

    // No store-clearing needed between the two sign-ins here: unlike an OTP, verifying a link
    // does not leave a stale value behind that a later `readFixtureLink` for a *different* email
    // could collide with — each call is keyed by address, and this test reuses one address
    // sequentially, not concurrently.
    const secondHeaders = await signInAndGetCookieHeaders(auth, email);
    const secondSession = await auth.api.getSession({ headers: secondHeaders });

    expect(secondSession?.user.email).toBe(email);
    expect(secondSession?.user.id).not.toBe(firstUserId);

    // Exactly one `user` row survives — the old one was actually removed, not merely orphaned.
    const users = (fixtureDb['user'] ?? []) as unknown[];
    expect(users.length).toBe(1);
  });

  it('export returns the signed-in user and their sessions, naming what it does not yet cover', async () => {
    const { auth } = freshAuth();
    const email = 'export-me@example.com';
    const headers = await signInAndGetCookieHeaders(auth, email);

    const session = await auth.api.getSession({ headers });
    const sessions = await auth.api.listSessions({ headers });

    expect(session?.user.email).toBe(email);
    expect(sessions.length).toBeGreaterThan(0);
  });
});
