/**
 * F02 §4.5 — account deletion and export.
 *
 * **Scope, stated precisely rather than silently narrowed.** `docs/user-data.md`'s table names
 * eight rows. This module implements the two that live entirely in Better Auth's own tables
 * (`user`, `session`) — the ones this feature can reach without a repository function that does
 * not exist yet. The other six rows (`user_assumption_profile`, `calculation_share`,
 * `calculation_issue`, `audit_event`, `research_run`, and the `verification` row, which Better
 * Auth clears itself on delete) need repository functions SPINE has not built — see this
 * feature's `CONTRACTS` note. `deleteMyAccount` returns `unimplementedDataClasses` naming
 * exactly what it did not touch, so a caller can never mistake "the auth rows are gone" for
 * "the account is fully deleted" (§6: "Report a DoD item as done when it was skipped" applies
 * to code as much as to a report).
 */
import { headers as nextHeaders } from 'next/headers';
import { APIError } from 'better-auth';
import { auth } from './instance';
import { getSession } from './session';

async function getFullSession() {
  return auth.api.getSession({ headers: await nextHeaders() });
}

/**
 * The `user_data.md` rows this module does not yet reach, because the repository functions
 * they need do not exist (`CONTRACTS`). Named as a constant so the deletion result and
 * `docs/user-data.md` cannot silently drift apart.
 */
export const UNIMPLEMENTED_DATA_CLASSES = [
  'user_assumption_profile',
  'calculation_share',
  'calculation_issue',
  'audit_event (anonymisation)',
  'research_run (user link removal)',
] as const;

export type DeletionResult = {
  readonly ok: true;
  /** `true` when this call found no session — i.e. the account was already gone. Idempotent. */
  readonly alreadyDeleted: boolean;
  readonly unimplementedDataClasses: readonly string[];
};

/**
 * Idempotent: a second call after the first finds no session (the user row, and with it every
 * session, is already gone) and returns `alreadyDeleted: true` rather than throwing.
 */
export async function deleteMyAccount(): Promise<DeletionResult> {
  const session = await getSession();
  if (session === null) {
    return { ok: true, alreadyDeleted: true, unimplementedDataClasses: [...UNIMPLEMENTED_DATA_CLASSES] };
  }

  try {
    await auth.api.deleteUser({ body: {}, headers: await nextHeaders() });
  } catch (error) {
    // A second, near-simultaneous call racing the first can find the user already gone by the
    // time it runs; better-auth surfaces that as an APIError rather than a silent no-op.
    // Idempotency means treating it the same as "already deleted", not surfacing it as a failure.
    if (!(error instanceof APIError)) throw error;
  }

  return { ok: true, alreadyDeleted: false, unimplementedDataClasses: [...UNIMPLEMENTED_DATA_CLASSES] };
}

export type ExportResult = {
  readonly user: { readonly id: string; readonly email: string; readonly createdAt: string };
  readonly sessions: readonly { readonly id: string; readonly createdAt: string; readonly expiresAt: string }[];
  readonly unimplementedDataClasses: readonly string[];
};

/** The user's own rows, as JSON. Same scope note as `deleteMyAccount` above. */
export async function exportMyData(): Promise<ExportResult | null> {
  const full = await getFullSession();
  if (full === null) return null;

  const list = await auth.api.listSessions({ headers: await nextHeaders() });

  return {
    user: {
      id: full.user.id,
      email: full.user.email,
      createdAt: full.user.createdAt.toISOString(),
    },
    sessions: list.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    })),
    unimplementedDataClasses: [...UNIMPLEMENTED_DATA_CLASSES],
  };
}
