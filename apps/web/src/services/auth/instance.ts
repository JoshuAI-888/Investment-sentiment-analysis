/**
 * F02 §4.1 — the Better Auth server instance.
 *
 * **Storage.** `PROVIDER_MODE=live` points Better Auth at the real Postgres pool; anything else
 * uses Better Auth's own in-process `memoryAdapter`, never `getPool()`
 * (`src/repositories/client.ts`: "in fixture mode the services above [repositories] should not
 * be reaching one at all"). This is also what makes F02 buildable and fully testable **today**:
 * Better Auth's canonical `user` / `session` / `account` / `verification` tables do not yet
 * exist in `apps/web/migrations/` (see this feature's `CONTRACTS` note to SPINE) — fixture mode
 * never needs them. Live mode is wired correctly and will start working the moment that
 * migration lands; nothing here needs to change for it to. The password itself lives in
 * Better Auth's own `account` table (the `credential` provider row), not a column this codebase
 * defines — no migration shape changes as a result of this feature moving from OTP to password.
 *
 * **Anchored on `globalThis`, not a plain module-level `const`.** Next.js's App Router compiles
 * route handlers, server actions and server components into separate server bundles, and a
 * module-scope singleton is *not* guaranteed to be the same object across those bundles even
 * within one `next start` process. `globalThis` is the one object every one of those bundles
 * actually shares. Without this, fixture mode's whole storage strategy would only ever work
 * within a single request.
 *
 * **The auth model: email + password, self-service sign-up, open to any address (D-39).**
 * D-37 moved from OTP to email+password; **D-39 removed the allowlist gate on account
 * creation** — any address can now sign up and reach `requireUser()`-gated ("member+") surfaces
 * such as `/dashboard`. `ADMIN_EMAIL_ALLOWLIST` still names who reaches `requireAdmin()`-gated
 * surfaces (`/admin/*`): `requireAdmin()` (`session.ts`) is unchanged and re-derives admin status
 * from the live allowlist on every call, so the member/admin split now falls entirely out of
 * that one check rather than out of who is allowed to have an account at all. The seeded
 * `welcome1` path (`seed-account.ts`) is **not** part of this opening — it remains
 * allowlist-gated by its own explicit check, independent of this file's (now permissive) account
 * creation — a shared bootstrap password is an operator-onboarding tool, not something a member
 * signup should ever be able to trigger.
 *
 * **`requireEmailVerification: true` matters more now, not less.** With any address able to
 * create an account, the mailed verification link is the only proof a signup's caller controls
 * the mailbox they typed. `emailVerification.sendOnSignUp` fires that mail automatically.
 *
 * **The send cap (D-28) still applies**, to both mail paths — `sendVerificationEmail` (on
 * sign-up) and `sendResetPassword` (forgotten password) — via `decideAndSend`
 * (`send-decision.ts`). It is a **global** window (not per-address, `send-cap.ts`), which is what
 * makes it the right control here: D-28 originally sized it to protect Resend's free-tier
 * allowance against anyone spamming the one admin address; that same global ceiling now bounds
 * total signup/reset volume across an open population instead, which is exactly what an
 * open-signup mail path needs. `decideAndSend` no longer checks the allowlist itself (D-39) —
 * gating who *can have* an account and gating whether a real, already-existing recipient's mail
 * *gets sent* are now two different questions, and only the cap answers the second one. Both
 * hooks always resolve with no return value, which is what makes the generic-response property
 * structural: neither a mail failure nor a cap refusal changes what the HTTP caller sees.
 */
import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { memoryAdapter } from 'better-auth/adapters/memory';
import type { MemoryDB } from 'better-auth/adapters/memory';
import { Pool } from 'pg';
import { env } from '@/env';
import { defaultRedisClient, type RedisRestClient } from './send-cap';
import { rememberFixtureLink } from './fixture-link-store';
import { decideAndSend } from './send-decision';

/**
 * Better Auth's `memoryAdapter` looks up `activeDb[model]` directly and throws "Model X not
 * found" if the key is merely absent — an empty `{}` is not the same as an empty *table*. Every
 * model Better Auth's core touches must be pre-declared, even with no rows, or the very first
 * call fails before any of this feature's own logic runs.
 */
export function createEmptyMemoryDb(): MemoryDB {
  return { user: [], session: [], account: [], verification: [] };
}

const globalForAuth = globalThis as unknown as { __f02FixtureMemoryDb__?: MemoryDB };

function defaultFixtureMemoryDb(): MemoryDB {
  return (globalForAuth.__f02FixtureMemoryDb__ ??= createEmptyMemoryDb());
}

export type AuthInstanceDeps = {
  readonly redisClient?: RedisRestClient | undefined;
  /**
   * Fixture-mode storage. Omitted, the app uses one `globalThis`-anchored store shared by every
   * `createAuthInstance()` call in the process (`defaultFixtureMemoryDb`) — the property a
   * running app needs. Pass an explicit, freshly-created store (`createEmptyMemoryDb()`) to get
   * an isolated one instead — the property a test needs between cases.
   */
  readonly fixtureDb?: MemoryDB;
};

/**
 * Exported as a factory (rather than only a singleton) so a test can inject a fake Redis client
 * or a fresh in-memory store without touching the module the app actually uses. `auth` below is
 * the one the app uses.
 */
export function createAuthInstance(deps: AuthInstanceDeps = {}) {
  function mailerDeps() {
    return {
      providerMode: env.PROVIDER_MODE,
      redisClient: deps.redisClient ?? defaultRedisClient(),
      mailerConfig: {
        apiKey: env.RESEND_API_KEY ?? '',
        from: env.RESEND_FROM ?? 'welcome@accounts.joshuai.nz',
      },
      rememberFixtureLink,
    };
  }

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL ?? env.APP_BASE_URL,
    secret: env.BETTER_AUTH_SECRET ?? 'fixture-mode-secret-never-used-live',
    database:
      env.PROVIDER_MODE === 'live'
        ? new Pool({ connectionString: env.DATABASE_URL })
        : memoryAdapter(deps.fixtureDb ?? defaultFixtureMemoryDb()),
    session: {
      // F02 §4.5's user-data.md: sessions retained 30 days.
      expiresIn: 60 * 60 * 24 * 30,
    },
    /**
     * Better Auth's own built-in per-IP rate limiter is on by default under `next start`
     * (production `NODE_ENV`) — a sensible default for a real deployment, and a trap for an e2e
     * or CI run: `next start` is also how `PROVIDER_MODE=fixture` e2e serves the app
     * (`playwright.config.ts`). §4.2's own D-28 send cap (Redis-backed, gating whether Resend is
     * actually called) is the mechanism that matters for abuse in `live` mode; this generic layer
     * is orthogonal defense-in-depth and is scoped to `live` accordingly.
     */
    rateLimit: {
      enabled: env.PROVIDER_MODE === 'live',
    },
    user: {
      deleteUser: {
        // No confirmation email round trip: deletion is confirmed in the UI (a typed
        // confirmation, `app/(app)/settings/account`) — the single operator already holds the
        // session that is asking. Deleting immediately on this call is what §4.5's
        // "self-service, confirmed, and idempotent" describes.
        enabled: true,
      },
      /**
       * D-38 — the "welcome1" seeded-account path (`seed-account.ts`). `input: false` means
       * no signed-in user can set or clear this on themselves through the public
       * `sign-up`/`update-user` endpoints' request bodies (Better Auth throws `FIELD_NOT_ALLOWED`
       * if a caller tries) — the only two writers are `seed-account.ts`'s
       * `provisionSeedAccountIfEligible` (sets it, via `internalAdapter.createUser`, bypassing
       * the route layer this restriction lives in) and `clearMustChangePassword` (clears it, same
       * bypass). `input: false` does not hide the field from session/user *output* — Better
       * Auth's output serialization is unconditional on `additionalFields`, only *input* parsing
       * checks this flag — so `getSession()` still sees the real value (`session.ts`).
       */
      additionalFields: {
        mustChangePassword: {
          type: 'boolean',
          defaultValue: false,
          input: false,
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      requireEmailVerification: true,
      async sendResetPassword({ user, url }) {
        await decideAndSend({ to: user.email, url, kind: 'reset-password' }, mailerDeps());
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      async sendVerificationEmail({ user, url }) {
        await decideAndSend({ to: user.email, url, kind: 'verify-email' }, mailerDeps());
      },
    },
    plugins: [
      // Lets a server action call `auth.api.*` directly and have the resulting cookie written
      // through `next/headers` automatically. Better Auth's own requirement: must be last.
      nextCookies(),
    ],
  });
}

export const auth = createAuthInstance();
