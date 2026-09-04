/** F02 — the auth service's public surface. Everything under `app/` reaches this feature only through here. */
export { auth } from './instance';
export {
  getSession,
  requireUser,
  requireAdmin,
  UnauthenticatedError,
  UnauthorizedError,
  PasswordChangeRequiredError,
  type Session,
} from './session';
export {
  signUpWithPassword,
  signInWithPassword,
  requestPasswordReset,
  resetPassword,
  changePassword,
  signOutCurrentSession,
  type SignUpResult,
  type SignInResult,
  type RequestResetResult,
  type ResetPasswordResult,
  type ChangePasswordResult,
} from './flow';
export { deleteMyAccount, exportMyData, UNIMPLEMENTED_DATA_CLASSES, type DeletionResult, type ExportResult } from './lifecycle';
export { normalizeEmail, isAllowlisted, isAccountCreationAllowed } from './allowlist';
export { logAdminAllowlistOnBoot } from './boot';
export { readFixtureLink } from './fixture-link-store';
export { WELCOME_PASSWORD } from './seed-account';
