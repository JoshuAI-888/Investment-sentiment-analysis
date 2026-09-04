/**
 * F02 §5's unit/integration row: "code hashing; expiry; attempt counting; rotation on resend;
 * ... single-use." Run against the real `emailOTP` plugin and Better Auth's in-memory adapter
 * — no live Postgres needed, because F02's storage swaps to the memory adapter outside
 * `PROVIDER_MODE=live` (`src/services/auth/instance.ts`), which is also why these run here
 * rather than only in `tests/unit/`: they exercise the real plugin, not a reimplementation of
 * its rules.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryDB } from 'better-auth/adapters/memory';
import { createAuthInstance, createEmptyMemoryDb } from '@/services/auth/instance';
import { clearFixtureOtpStore, readFixtureOtp } from '@/services/auth/fixture-otp-store';

function freshAuth() {
  const fixtureDb: MemoryDB = createEmptyMemoryDb();
  return { auth: createAuthInstance({ fixtureDb }), fixtureDb };
}

function verificationRows(fixtureDb: MemoryDB): Array<Record<string, unknown>> {
  return (fixtureDb['verification'] ?? []) as Array<Record<string, unknown>>;
}

describe('OTP mechanics (real emailOTP plugin, in-memory storage)', () => {
  beforeEach(() => {
    clearFixtureOtpStore();
  });

  it('is a 6-digit code, hashed at rest — never stored as the plaintext value', async () => {
    const { auth, fixtureDb } = freshAuth();
    const email = 'hash-test@example.com';

    await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } });

    const raw = readFixtureOtp(email);
    expect(raw).not.toBeNull();
    expect(raw).toMatch(/^\d{6}$/);

    const rows = verificationRows(fixtureDb);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // `identifier` may legitimately embed the email; `value` never embeds the plaintext code.
      expect(String(row['value'])).not.toContain(raw as string);
      expect(String(row['value'])).not.toBe(raw);
    }
  });

  it('a correct code signs in', async () => {
    const { auth } = freshAuth();
    const email = 'happy-path@example.com';

    await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } });
    const otp = readFixtureOtp(email);
    expect(otp).not.toBeNull();

    const result = await auth.api.signInEmailOTP({ body: { email, otp: otp as string } });
    expect(result.user.email).toBe(email);
    expect(result.token).toBeTruthy();
  });

  it('is single-use: the same code cannot be verified twice', async () => {
    const { auth } = freshAuth();
    const email = 'single-use@example.com';

    await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } });
    const otp = readFixtureOtp(email) as string;

    await auth.api.signInEmailOTP({ body: { email, otp } });
    await expect(auth.api.signInEmailOTP({ body: { email, otp } })).rejects.toThrow();
  });

  it('3 wrong attempts invalidate the code (allowedAttempts: 3)', async () => {
    const { auth } = freshAuth();
    const email = 'three-strikes@example.com';

    await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } });
    const otp = readFixtureOtp(email) as string;
    const wrong = otp === '000000' ? '111111' : '000000';

    await expect(auth.api.signInEmailOTP({ body: { email, otp: wrong } })).rejects.toThrow();
    await expect(auth.api.signInEmailOTP({ body: { email, otp: wrong } })).rejects.toThrow();
    await expect(auth.api.signInEmailOTP({ body: { email, otp: wrong } })).rejects.toThrow();

    // The 4th attempt uses the *correct* code, and it must still fail — the cap invalidated it.
    await expect(auth.api.signInEmailOTP({ body: { email, otp } })).rejects.toThrow();
  });

  it('an expired code is refused', async () => {
    vi.useFakeTimers();
    try {
      const { auth } = freshAuth();
      const email = 'expiry-test@example.com';

      await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } });
      const otp = readFixtureOtp(email) as string;

      // §4.1: 5-minute expiry. 5 minutes and 1 second later, the same code must be refused.
      vi.advanceTimersByTime(5 * 60 * 1000 + 1000);

      await expect(auth.api.signInEmailOTP({ body: { email, otp } })).rejects.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rotates on resend: requesting a second code invalidates the first', async () => {
    // `vi.useFakeTimers()` + a real time advance between the two sends, not a coincidence of
    // wall-clock luck: `resendStrategy: 'rotate'` does not delete the first verification row
    // before creating the second (better-auth's `resolveOTP`, `plugins/email-otp/routes.mjs`)
    // — it relies on `findVerificationValue`'s `ORDER BY createdAt DESC LIMIT 1` to prefer the
    // newer row. Two `sendVerificationOTP` calls fast enough to land in the same millisecond
    // tie on `createdAt`, and a tie has no defined winner (a stable sort over an in-memory
    // adapter's row array keeps the *first*-inserted row first for equal keys, which is exactly
    // backwards from "rotate" here) — under a CI runner's coarser timer resolution this is far
    // more reachable than on a fast local machine, and was intermittently failing in CI for
    // exactly this reason before this fix (found while investigating a failure on an unrelated
    // PR). Advancing the clock a full second between the two sends removes the tie deterministically
    // rather than hoping two real async round trips never land in the same tick.
    vi.useFakeTimers();
    try {
      const { auth } = freshAuth();
      const email = 'rotate-test@example.com';

      await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } });
      const first = readFixtureOtp(email) as string;

      vi.advanceTimersByTime(1000);

      await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } });
      const second = readFixtureOtp(email) as string;

      expect(second).not.toBe(first);
      await expect(auth.api.signInEmailOTP({ body: { email, otp: first } })).rejects.toThrow();

      const result = await auth.api.signInEmailOTP({ body: { email, otp: second } });
      expect(result.user.email).toBe(email);
    } finally {
      vi.useRealTimers();
    }
  });
});
