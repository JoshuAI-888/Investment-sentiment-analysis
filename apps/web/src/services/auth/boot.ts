/**
 * F02 §4.4 — the boot assertion (F-15).
 *
 * `env.ts`'s own `superRefine` already refuses to parse a `live`-mode environment with an
 * empty `ADMIN_EMAIL_ALLOWLIST` (F01 §4.2), and `emailAllowlist`'s `.email()` refinement already
 * rejects a syntactically malformed entry at the same point — so a malformed or empty allowlist
 * already fails the process before this module runs. What this module adds is the other half of
 * F-15's requirement: **logging** the configured address, not a secret, at info level, so a
 * typo that *is* syntactically valid (an allowlist of one wrong-but-well-formed address) is
 * visible in the first deployment log rather than at the first admin sign-in attempt
 * (`DEPLOY.md` MT-00's `OQ-1`).
 */
import { env } from '@/env';

export function logAdminAllowlistOnBoot(log: (message: string) => void = console.info): void {
  if (env.ADMIN_EMAIL_ALLOWLIST.length === 0) {
    // Reachable only in fixture mode — live mode already failed to parse `env` above this.
    log('[F02 boot] ADMIN_EMAIL_ALLOWLIST is empty. No admin can sign in until it is set.');
    return;
  }
  log(`[F02 boot] admin allowlist: ${env.ADMIN_EMAIL_ALLOWLIST.join(', ')}`);
}
