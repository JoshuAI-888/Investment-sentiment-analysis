/**
 * F02 — the fixture/e2e escape hatch for reading a just-issued verification or password-reset
 * link.
 *
 * In `PROVIDER_MODE=fixture` (dev, CI, e2e) no email is ever mailed, so an automated sign-up or
 * reset-password test needs some way to learn the link without a mailbox. This module is that
 * "some way": a process-local, in-memory map that `sendVerificationEmail`/`sendResetPassword`
 * write to instead of calling Resend.
 *
 * **Anchored on `globalThis`, not a plain module-scope variable.** Next.js's App Router compiles
 * route handlers, server actions and server components into separate server bundles; a
 * `const store = new Map()` at module scope is *not* guaranteed to be the same object across
 * those bundles even within one `next start` process — each can get its own copy of the module,
 * and hence its own empty `Map`. `globalThis` is the one object every one of those bundles
 * actually shares, which is the standard escape hatch for exactly this class of bug (the same
 * pattern Next.js's own docs recommend for a Prisma client singleton).
 *
 * **This must never run in `live` mode.** The one route that reads it
 * (`app/api/auth/fixture-link/route.ts`) refuses every request unless `PROVIDER_MODE ===
 * 'fixture'`, which the F02 boot assertion and `env.ts`'s `superRefine` both make impossible to
 * set in a real deployment. Nothing here is exported to a client component.
 */
type FixtureLinkStore = Map<string, { readonly url: string; readonly issuedAt: number }>;

const globalForFixtureLink = globalThis as unknown as { __f02FixtureLinkStore__?: FixtureLinkStore };

function store(): FixtureLinkStore {
  return (globalForFixtureLink.__f02FixtureLinkStore__ ??= new Map());
}

export function rememberFixtureLink(email: string, url: string): void {
  store().set(email, { url, issuedAt: Date.now() });
}

export function readFixtureLink(email: string): string | null {
  return store().get(email)?.url ?? null;
}

/** Test-only: lets a unit test reset state between cases without restarting the process. */
export function clearFixtureLinkStore(): void {
  store().clear();
}
