/**
 * F02 — the fixture/e2e escape hatch for reading a just-issued OTP.
 *
 * In `PROVIDER_MODE=fixture` (dev, CI, e2e) no OTP is ever mailed, so an automated sign-in
 * test needs some way to learn the code without a mailbox. This module is that "some way": a
 * process-local, in-memory map that the `sendVerificationOTP` hook writes to instead of
 * calling Resend.
 *
 * **Anchored on `globalThis`, not a plain module-scope variable.** Next.js's App Router
 * compiles route handlers, server actions and server components into separate server bundles;
 * a `const store = new Map()` at module scope is *not* guaranteed to be the same object across
 * those bundles even within one `next start` process — each can get its own copy of the module,
 * and hence its own empty `Map`. This was found the hard way (F02's own e2e suite: an OTP
 * written by the `/sign-in` server action was invisible to the `/api/auth/fixture-otp` route
 * handler). `globalThis` is the one object every one of those bundles actually shares, which is
 * the standard escape hatch for exactly this class of bug (the same pattern Next.js's own docs
 * recommend for a Prisma client singleton).
 *
 * **This must never run in `live` mode.** The one route that reads it
 * (`app/api/auth/fixture-otp/route.ts`) refuses every request unless `PROVIDER_MODE ===
 * 'fixture'`, which the F02 boot assertion and `env.ts`'s `superRefine` both make impossible to
 * set in a real deployment. Nothing here is exported to a client component, and it holds no
 * value that a normal OTP flow does not already generate — it only makes one already-generated
 * value legible to a test harness that has no mailbox.
 */
type FixtureOtpStore = Map<string, { readonly otp: string; readonly issuedAt: number }>;

const globalForFixtureOtp = globalThis as unknown as { __f02FixtureOtpStore__?: FixtureOtpStore };

function store(): FixtureOtpStore {
  return (globalForFixtureOtp.__f02FixtureOtpStore__ ??= new Map());
}

export function rememberFixtureOtp(email: string, otp: string): void {
  store().set(email, { otp, issuedAt: Date.now() });
}

export function readFixtureOtp(email: string): string | null {
  return store().get(email)?.otp ?? null;
}

/** Test-only: lets a unit test reset state between cases without restarting the process. */
export function clearFixtureOtpStore(): void {
  store().clear();
}
