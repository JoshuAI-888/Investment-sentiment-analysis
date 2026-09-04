/**
 * `docs/user-data.md` cites `tests/integration/auth-lifecycle.test.ts` as proof that deletion
 * and export are "tested" — but that file drives `auth.api.deleteUser`/`getSession`/
 * `listSessions` directly and re-derives the properties by hand; it never calls
 * `deleteMyAccount`/`exportMyData` themselves (`src/services/auth/lifecycle.ts`). Its own
 * comment concedes idempotent handling of a raced second delete "is `lifecycle.ts`'s
 * `deleteMyAccount`, not the raw `auth.api.deleteUser` call" and then asserts the *raw* call
 * rejects — the opposite property. So the `if (!(error instanceof APIError)) throw error`
 * swallow in `deleteMyAccount`, and every line of `exportMyData`, had zero coverage. Found by
 * lane-review.
 *
 * Exercises the real singleton `auth` instance the app actually uses, mocking `next/headers`
 * only because there is no real Next.js request here to carry the session cookie.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auth } from '@/services/auth/instance';
import { clearFixtureOtpStore, readFixtureOtp } from '@/services/auth/fixture-otp-store';
import {
  deleteMyAccount,
  exportMyData,
  UNIMPLEMENTED_DATA_CLASSES,
} from '@/services/auth/lifecycle';

let currentCookie = '';

vi.mock('next/headers', () => ({
  headers: async () => new Headers(currentCookie === '' ? {} : { cookie: currentCookie }),
}));

async function signIn(email: string): Promise<void> {
  await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } });
  const otp = readFixtureOtp(email);
  if (otp === null) throw new Error('test setup: no fixture OTP was recorded');
  const response = await auth.api.signInEmailOTP({ body: { email, otp }, asResponse: true });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie === null) throw new Error('test setup: sign-in did not set a session cookie');
  currentCookie = setCookie.split(';')[0] ?? '';
}

describe('deleteMyAccount', () => {
  beforeEach(() => {
    clearFixtureOtpStore();
    currentCookie = '';
  });

  afterEach(() => {
    currentCookie = '';
  });

  it('with no session at all, reports already-deleted rather than throwing', async () => {
    // No `signIn()` call — `currentCookie` stays empty, so `getSession()` resolves `null`.
    const result = await deleteMyAccount();
    expect(result).toEqual({
      ok: true,
      alreadyDeleted: true,
      unimplementedDataClasses: [...UNIMPLEMENTED_DATA_CLASSES],
    });
  });

  it('deletes a real session and reports alreadyDeleted: false the first time', async () => {
    await signIn('lifecycle-delete@example.com');

    const result = await deleteMyAccount();

    expect(result.ok).toBe(true);
    expect(result.alreadyDeleted).toBe(false);
    expect(result.unimplementedDataClasses).toEqual([...UNIMPLEMENTED_DATA_CLASSES]);
    // The session this call just deleted no longer resolves.
    const afterwards = await auth.api.getSession({ headers: new Headers({ cookie: currentCookie }) });
    expect(afterwards).toBeNull();
  });

  it('a second, sequential call against the same (now-stale) session is idempotent', async () => {
    // By the second call, this session's own `getSession()` check already returns null — the
    // first delete removed the session row itself, not just the user — so this exercises the
    // early `session === null` idempotency path, not the deeper `APIError` swallow (see the
    // next test for that one). Both existed with zero coverage before this file: nothing
    // previously called `deleteMyAccount` more than once.
    await signIn('lifecycle-double-delete@example.com');
    await deleteMyAccount();

    const second = await deleteMyAccount();
    expect(second).toEqual({
      ok: true,
      alreadyDeleted: true,
      unimplementedDataClasses: [...UNIMPLEMENTED_DATA_CLASSES],
    });
  });

  it('two concurrent calls on the same live session: the loser is idempotent, not a thrown 500', async () => {
    // THE REGRESSION this test closes. Two near-simultaneous calls (two open tabs, both
    // pressing "Delete my account") can both pass their own `getSession()` check against the
    // still-live session before either reaches `auth.api.deleteUser` — the loser's `deleteUser`
    // call then throws an `APIError` against a user the winner already removed. Without the
    // `if (!(error instanceof APIError)) throw error` swallow in `deleteMyAccount`, that surfaces
    // as an unhandled 500 instead of the same `alreadyDeleted`-shaped outcome a fresh check
    // would find. `auth-lifecycle.test.ts` proves the raw `auth.api.deleteUser` call throws in
    // this situation; nothing previously proved `deleteMyAccount` itself absorbs it.
    await signIn('lifecycle-concurrent-delete@example.com');

    const [first, second] = await Promise.all([deleteMyAccount(), deleteMyAccount()]);

    // Whichever process order actually happened, both calls resolve — neither throws — and
    // both report the shape a caller can act on safely.
    for (const result of [first, second]) {
      expect(result.ok).toBe(true);
      expect(result.unimplementedDataClasses).toEqual([...UNIMPLEMENTED_DATA_CLASSES]);
    }
    const afterwards = await auth.api.getSession({ headers: new Headers({ cookie: currentCookie }) });
    expect(afterwards).toBeNull();
  });
});

describe('exportMyData', () => {
  beforeEach(() => {
    clearFixtureOtpStore();
    currentCookie = '';
  });

  it('returns null with no session at all', async () => {
    // THE REGRESSION this test closes: the `null`-session branch (`getFullSession()` returning
    // null) had zero coverage before this file existed.
    await expect(exportMyData()).resolves.toBeNull();
  });

  it('returns the signed-in user and their sessions, naming what it does not yet cover', async () => {
    const email = 'lifecycle-export@example.com';
    await signIn(email);

    const result = await exportMyData();

    expect(result).not.toBeNull();
    expect(result?.user.email).toBe(email);
    expect(result?.sessions.length).toBeGreaterThan(0);
    expect(result?.unimplementedDataClasses).toEqual([...UNIMPLEMENTED_DATA_CLASSES]);
  });
});
