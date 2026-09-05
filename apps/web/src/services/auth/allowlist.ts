/**
 * F02 §4.4 — email normalization and allowlist matching.
 *
 * Pure functions, deliberately. `requireAdmin()` re-derives the answer from the *current*
 * `ADMIN_EMAIL_ALLOWLIST` on every call rather than trusting a flag stored on the session, so
 * narrowing the allowlist in a redeploy revokes access on the next request without having to
 * invalidate any session (F02 §4.4).
 */

/**
 * Lowercase, trim, and — for Gmail and Googlemail addresses only — strip dots from the local
 * part and drop everything from a `+` on. `joshua.fang+otp@gmail.com`,
 * `JoshuaFang@gmail.com` and `joshuafang@googlemail.com` all normalize to the same string.
 *
 * Non-Gmail domains are lowercased and trimmed only: dot and plus addressing are Gmail-specific
 * routing conventions, not a general email property, and folding them for every domain would
 * treat `a.b@example.com` and `ab@example.com` as one mailbox when they may not be.
 */
export function normalizeEmail(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at === -1) return trimmed;

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const isGmail = domain === 'gmail.com' || domain === 'googlemail.com';
  if (!isGmail) return `${local}@${domain}`;

  const withoutPlusTag = local.split('+')[0] ?? local;
  const withoutDots = withoutPlusTag.replaceAll('.', '');
  return `${withoutDots}@gmail.com`;
}

/**
 * Both sides are normalized before comparison, so an allowlist entry written with dots or
 * mixed case still matches the way the operator actually types their address.
 */
export function isAllowlisted(email: string, allowlist: readonly string[]): boolean {
  const normalized = normalizeEmail(email);
  return allowlist.some((entry) => normalizeEmail(entry) === normalized);
}

/**
 * **D-39: no longer the general account-creation gate.** Before D-39, this gated every
 * self-service sign-up via `databaseHooks.user.create.before` (`instance.ts`). D-39 opened
 * self-service sign-up to any address — the member/admin split now lives entirely in
 * `requireAdmin()`'s own live-allowlist check (`session.ts`), not in who can have an account at
 * all. This function's only remaining caller is `seed-account.ts`'s
 * `provisionSeedAccountIfEligible` — the `welcome1` bootstrap path stays allowlist-gated on
 * purpose, since a shared operator password is not something an open member signup should ever
 * be able to trigger.
 *
 * **`fixture` mode always allows creation, regardless of the allowlist.** This mirrors the old
 * OTP flow's own fixture short-circuit and exists for the same reason: fixture mode has no live
 * mailbox and nothing real to protect, and `tests/e2e/auth.spec.ts` needs to create a genuinely
 * non-allowlisted, signed-in session to prove `requireAdmin()` actually refuses one.
 */
export function isAccountCreationAllowed(
  providerMode: 'fixture' | 'live',
  email: string,
  allowlist: readonly string[],
): boolean {
  return providerMode !== 'live' || isAllowlisted(email, allowlist);
}
