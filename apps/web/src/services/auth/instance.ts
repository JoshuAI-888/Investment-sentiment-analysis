/**
 * F02 §4.1 — the Better Auth server instance.
 *
 * **Storage.** `PROVIDER_MODE=live` points Better Auth at the real Postgres pool; anything
 * else uses Better Auth's own in-process `memoryAdapter`, never `getPool()`
 * (`src/repositories/client.ts`: "in fixture mode the services above [repositories] should not
 * be reaching one at all"). This is also what makes F02 buildable and fully testable **today**:
 * Better Auth's canonical `user` / `session` / `account` / `verification` tables do not yet
 * exist in `apps/web/migrations/` (see this feature's `CONTRACTS` note to SPINE) — fixture mode
 * never needs them, and every unit, contract, integration and e2e test in this feature's test
 * plan runs in fixture mode. Live mode is wired correctly and will start working the moment
 * that migration lands; nothing here needs to change for it to.
 *
 * **Stated precisely, because "wired correctly" undersells the gap until that migration lands:**
 * with `PROVIDER_MODE=live` and no `user`/`session`/`account`/`verification` tables, the process
 * boots cleanly — `boot.ts`'s allowlist log prints normally — and the *first* sign-in attempt
 * throws out of `requestSignInCode` uncaught, surfacing as a 500 error boundary rather than the
 * generic `{ok:true}` §4.2 requires for every other failure mode. This branch does not silently
 * degrade in live mode without that migration; it is not deployable to live mode without it
 * either. No code change closes this — the migration is SPINE's to write, not this lane's — so
 * it is recorded here rather than left implicit in "wired correctly." Found by lane-review.
 *
 * **The OTP flow.** `emailOTP` from `better-auth/plugins`, configured to F02 §4.1's non-
 * negotiables: `otpLength: 6`, `expiresIn: 300` (5 minutes), `allowedAttempts: 3`,
 * `storeOTP: 'hashed'` (Better Auth's own default is `'plain'` — this line is the whole reason
 * §6's "hashed at rest" box gets checked), `resendStrategy: 'rotate'`.
 *
 * **Allowlist-before-send (§4.2) is decided by `decideAndSend`** (`send-decision.ts`), not
 * inline here — pulled out specifically so it is unit- and integration-testable with
 * `providerMode: 'live'` and no live database, Redis, or Resend key. Better Auth always creates
 * the verification record and always returns `{ success: true }` from
 * `/email-otp/send-verification-otp` regardless of what `decideAndSend` decides, which is what
 * makes the generic-response property (§4.2) structural rather than conventional.
 * `disableSignUp` is left `false` deliberately: the allowlist check is the *only* gate, so the
 * one account D-11 describes comes into existence at the first successful sign-in from the
 * allowlisted address, with no separate seed step required.
 */
import { betterAuth } from 'better-auth';
import { emailOTP } from 'better-auth/plugins';
import { nextCookies } from 'better-auth/next-js';
import { memoryAdapter } from 'better-auth/adapters/memory';
import type { MemoryDB } from 'better-auth/adapters/memory';
import { Pool } from 'pg';
import { env } from '@/env';
import { defaultRedisClient, type RedisRestClient } from './send-cap';
import { rememberFixtureOtp } from './fixture-otp-store';
import { decideAndSend } from './send-decision';

/**
 * Better Auth's `memoryAdapter` looks up `activeDb[model]` directly and throws "Model X not
 * found" if the key is merely absent — an empty `{}` is not the same as an empty *table*. Every
 * model Better Auth's core and the `email-otp` plugin touch must be pre-declared, even with no
 * rows, or the very first call fails before any of this feature's own logic runs.
 */
export function createEmptyMemoryDb(): MemoryDB {
  return { user: [], session: [], account: [], verification: [] };
}

/**
 * **Anchored on `globalThis`, not a plain module-level `const`.** Next.js's App Router compiles
 * route handlers, server actions and server components into separate server bundles, and a
 * module-scope singleton is *not* guaranteed to be the same object across those bundles even
 * within one `next start` process — this was found the hard way (F02's own e2e suite: a session
 * created by the `/sign-in` server action was invisible to `/settings/account`'s server
 * component, and to `/api/auth/get-session`). `globalThis` is the one object every one of those
 * bundles actually shares. Without this, fixture mode's whole storage strategy — the reason
 * this feature is buildable and testable before SPINE's `user`/`session`/`verification`/
 * `account` migration exists — would only ever work within a single request.
 */
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
 * Exported as a factory (rather than only a singleton) so a test can inject a fake Redis
 * client or a fresh in-memory store without touching the module the app actually uses. `auth`
 * below is the one the app uses.
 */
export function createAuthInstance(deps: AuthInstanceDeps = {}) {
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
     * (production `NODE_ENV`) — a sensible default for a real deployment, and a trap for an
     * e2e or CI run: `next start` is also how `PROVIDER_MODE=fixture` e2e serves the app
     * (`playwright.config.ts`), so a suite that legitimately requests many codes from one IP in
     * quick succession would get silently rate-limited and every later assertion would fail
     * against a code that was never issued. §4.2's own D-28 send cap (Redis-backed, gating
     * whether Resend is actually called) is the mechanism that matters for abuse in `live` mode;
     * this generic layer is orthogonal defense-in-depth and is scoped to `live` accordingly.
     */
    rateLimit: {
      enabled: env.PROVIDER_MODE === 'live',
    },
    user: {
      deleteUser: {
        // No `sendDeleteAccountVerification`: deletion is confirmed in the UI (a typed
        // confirmation, `app/(app)/settings/account`), not by a second email round trip — the
        // single operator already holds the session that is asking. Deleting immediately on
        // this call is what §4.5's "self-service, confirmed, and idempotent" describes.
        enabled: true,
      },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 3,
        storeOTP: 'hashed',
        resendStrategy: 'rotate',
        disableSignUp: false,
        async sendVerificationOTP({ email, otp, type }) {
          await decideAndSend(
            { to: email, otp, type },
            {
              providerMode: env.PROVIDER_MODE,
              allowlist: env.ADMIN_EMAIL_ALLOWLIST,
              redisClient: deps.redisClient ?? defaultRedisClient(),
              mailerConfig: {
                apiKey: env.RESEND_API_KEY ?? '',
                from: env.RESEND_FROM ?? 'welcome@accounts.joshuai.nz',
              },
              rememberFixtureOtp,
            },
          );
        },
      }),
      // Must be last (better-auth's own requirement): lets a server action call `auth.api.*`
      // directly and have the resulting cookie written through `next/headers` automatically,
      // instead of every call site having to thread a raw `Response` through itself.
      nextCookies(),
    ],
  });
}

export const auth = createAuthInstance();
