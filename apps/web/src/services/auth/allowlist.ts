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
 * The account-creation gate `databaseHooks.user.create.before` (`instance.ts`) enforces —
 * pulled out as a pure function so it is unit-testable without standing up a full Better Auth
 * instance. **`fixture` mode always allows creation, regardless of the allowlist.** This mirrors
 * the old OTP flow's own fixture short-circuit (`send-decision.ts`'s `decideAndSend`, which
 * never reached its allowlist check outside `live` mode either) and exists for the same reason:
 * fixture mode has no live mailbox and nothing real to protect, and `tests/e2e/auth.spec.ts`
 * needs to create a genuinely non-allowlisted, signed-in session to prove `requireAdmin()`
 * actually refuses one.
 */
export function isAccountCreationAllowed(
  providerMode: 'fixture' | 'live',
  email: string,
  allowlist: readonly string[],
): boolean {
  return providerMode !== 'live' || isAllowlisted(email, allowlist);
}
