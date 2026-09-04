/** F02 — the auth service's public surface. Everything under `app/` reaches this feature only through here. */
export { auth } from './instance';
export { getSession, requireUser, requireAdmin, UnauthenticatedError, UnauthorizedError, type Session } from './session';
export {
  signUpWithPassword,
  signInWithPassword,
  requestPasswordReset,
  resetPassword,
  signOutCurrentSession,
  type SignUpResult,
  type SignInResult,
  type RequestResetResult,
  type ResetPasswordResult,
} from './flow';
export { deleteMyAccount, exportMyData, UNIMPLEMENTED_DATA_CLASSES, type DeletionResult, type ExportResult } from './lifecycle';
export { normalizeEmail, isAllowlisted } from './allowlist';
export { logAdminAllowlistOnBoot } from './boot';
export { readFixtureLink } from './fixture-link-store';
