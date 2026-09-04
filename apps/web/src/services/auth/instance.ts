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
 * **The auth model: email + password, self-service sign-up, allowlist-gated.** D-37 supersedes
 * D-11/D-28's "OTP sign-in is kept" clause: this app is single-operator and OTP's structural
 * cost (no client can be built or tested without a mailbox in the loop) was judged not worth it
 * against the simpler, more familiar email+password model. What D-11/D-28 got right — one
 * account, no open population, a send cap on the one mail path that exists — is preserved
 * exactly; only the credential mechanism changed.
 *
 * **`databaseHooks.user.create.before` is the allowlist gate**, not an application-layer check
 * in `flow.ts`. This runs inside Better Auth's own user-creation path regardless of entry point
 * — `auth.api.signUpEmail` and the raw `POST /api/auth/sign-up/email` endpoint both go through
 * it — so there is no route that can create a user Better Auth itself did not refuse first. This
 * is the same structural guarantee the old `emailOTP` plugin's `sendVerificationOTP` closure gave
 * the OTP flow: the gate lives where every caller is forced through it, not in a wrapper a caller
 * could bypass by hitting the HTTP endpoint directly.
 *
 * **The gate itself is `live`-mode only**, mirroring `decideAndSend`'s own fixture short-circuit
 * exactly. This is deliberate, not an oversight: the old OTP flow let *any* address sign in
 * under `PROVIDER_MODE=fixture` (`decideAndSend` never reached its allowlist check there
 * either), which is what let `tests/e2e/auth.spec.ts` build a genuinely signed-in,
 * non-allowlisted session to prove `requireAdmin()` actually refuses one — the property
 * `requireAdmin()`'s own doc calls out as needing proof beyond "there is one account in
 * practice". Gating account creation unconditionally would close off that test seam entirely:
 * fixture mode has no live mailbox and no real security boundary to defend in the first place,
 * so the only thing worth protecting there is the ability to test `requireAdmin()`'s two
 * outcomes independently of whether an account could ever exist for real.
 *
 * **`requireEmailVerification: true` is why self-service sign-up is safe.** Anyone can *submit*
 * the allowlisted address at `/sign-up` with a password of their choosing — the allowlist only
 * checks the address, not who is typing it — but the account cannot sign in until the link
 * mailed to that address is clicked. An attacker who does not control the real mailbox can create
 * an unverified row and nothing else; the real owner still owns the only path to a usable
 * account. `emailVerification.sendOnSignUp` fires that mail automatically.
 *
 * **The send cap (D-28) still applies**, now to two mail paths instead of one:
 * `sendVerificationEmail` (on sign-up) and `sendResetPassword` (forgotten password). Both are
 * routed through `decideAndSend` (`send-decision.ts`), exactly like the old OTP send was — pulled
 * out of the config closures specifically so each is unit- and integration-testable with
 * `providerMode: 'live'` and no live database, Redis, or Resend key anywhere in the process.
 * Both hooks always resolve with no return value, which is what makes the generic-response
 * property structural: neither a mail failure nor a cap refusal changes what the HTTP caller
 * sees.
 */
import { betterAuth, APIError } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { memoryAdapter } from 'better-auth/adapters/memory';
import type { MemoryDB } from 'better-auth/adapters/memory';
import { Pool } from 'pg';
import { env } from '@/env';
import { defaultRedisClient, type RedisRestClient } from './send-cap';
import { rememberFixtureLink } from './fixture-link-store';
import { decideAndSend } from './send-decision';
import { isAccountCreationAllowed, normalizeEmail } from './allowlist';

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
      allowlist: env.ADMIN_EMAIL_ALLOWLIST,
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
    /**
     * The allowlist gate for account creation — see this file's own doc comment above for why
     * this is the structurally correct place for it, rather than a check in `flow.ts`.
     */
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const allowed = isAccountCreationAllowed(
              env.PROVIDER_MODE === 'live' ? 'live' : 'fixture',
              normalizeEmail(user.email),
              env.ADMIN_EMAIL_ALLOWLIST,
            );
            if (!allowed) {
              throw new APIError('FORBIDDEN', {
                message: 'This address is not authorized to create an account.',
              });
            }
            return { data: user };
          },
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
