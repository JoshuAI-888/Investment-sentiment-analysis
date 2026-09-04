/**
 * D-38 — the "welcome1" seeded-account onboarding path, alongside self-service sign-up (D-37).
 *
 * **Why this bypasses `auth.api.signUpEmail` entirely, via `auth.$context`.** The public sign-up
 * route hardcodes `emailVerified: false` at creation and unconditionally fires a verification
 * email whenever `emailVerification.sendOnSignUp` is set — neither is overridable through the
 * route's own body, by design (this codebase confirmed both by reading Better Auth's shipped
 * route source, not by guessing). A seeded account has no self-service verification step to
 * skip *to* — knowing the shared temporary password already **is** the out-of-band proof the
 * self-service path gets from a mailed link — so this writes the user and its credential account
 * directly through `context.internalAdapter`, the same primitive `signUpEmail`'s own route uses
 * internally. This still runs through `databaseHooks.user.create.before` (`instance.ts`)
 * exactly like every other path, since `internalAdapter.createUser` calls `createWithHooks`
 * regardless of caller — so a non-allowlisted address is refused here the same way it would be
 * anywhere else.
 *
 * `createLocalAccountIssuer` is `better-auth/db`'s own exported helper for the credential
 * account's `issuer` field, used so the linked account matches exactly what `signUpEmail` itself
 * would have produced — not a value this module invents.
 */
import { createLocalAccountIssuer } from 'better-auth/db';
import { env } from '@/env';
import { auth } from './instance';
import { isAccountCreationAllowed, normalizeEmail } from './allowlist';

/** D-38: the owner's specified initial credential. Never hashed-and-compared against anything else. */
export const WELCOME_PASSWORD = 'welcome1';

/**
 * Creates an allowlisted-but-nonexistent address's account with `WELCOME_PASSWORD`, pre-verified
 * and flagged `mustChangePassword`. Returns `false` (does nothing) when the address is not
 * eligible — not allowlisted (in `live` mode; see `isAccountCreationAllowed`'s own doc for why
 * this check is `live`-mode only), or already has an account. Never throws: an ineligible or
 * racing caller just gets `false` and falls through to whatever error the caller's own sign-in
 * attempt already produced.
 */
export async function provisionSeedAccountIfEligible(email: string): Promise<boolean> {
  const normalized = normalizeEmail(email);
  const providerMode = env.PROVIDER_MODE === 'live' ? 'live' : 'fixture';
  if (!isAccountCreationAllowed(providerMode, normalized, env.ADMIN_EMAIL_ALLOWLIST)) return false;

  const context = await auth.$context;
  const existing = await context.internalAdapter.findUserByEmail(normalized);
  if (existing !== null) return false;

  const passwordHash = await context.password.hash(WELCOME_PASSWORD);
  const user = await context.internalAdapter.createUser(
    {
      email: normalized,
      name: normalized,
      emailVerified: true,
      mustChangePassword: true,
    },
    { method: 'email-password' },
  );
  if (!user) return false;

  await context.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    issuer: createLocalAccountIssuer('credential'),
    accountId: user.id,
    password: passwordHash,
  });
  return true;
}

/**
 * Clears the flag once the real password is set (`flow.ts`'s `changePassword`). A direct
 * `internalAdapter.updateUser` call, not the public `updateUser` endpoint: `mustChangePassword`
 * is declared with `input: false` (`instance.ts`) specifically so no signed-in user can clear it
 * on themselves through that endpoint's request body — this is the one legitimate write path,
 * reached only after `auth.api.changePassword` has already verified the caller's current
 * password.
 */
export async function clearMustChangePassword(userId: string): Promise<void> {
  const context = await auth.$context;
  await context.internalAdapter.updateUser(userId, { mustChangePassword: false });
}
