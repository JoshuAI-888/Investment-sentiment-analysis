import { redirect } from 'next/navigation';
import { env } from '@/env';
import { getSession } from '@/services/auth';
import { ChangePasswordForm } from './ChangePasswordForm';

/**
 * D-37. Reached two ways: redirected here by `requireUser()`'s `PasswordChangeRequiredError`
 * (a "welcome1" seeded account that hasn't set its own password yet), or visited voluntarily by
 * any signed-in user. Deliberately calls `getSession()`, not `requireUser()` — the latter would
 * throw `PasswordChangeRequiredError` for exactly the session this page exists to resolve.
 */
export default async function Page() {
  const session = await getSession();
  if (session === null) redirect('/sign-in');

  return (
    <main data-route="/change-password" data-state={env.PROVIDER_MODE} className="mx-auto max-w-sm p-8">
      <h1 className="text-2xl font-semibold">Set a new password</h1>
      {session.mustChangePassword ? (
        <p className="mt-1 text-sm text-neutral-600">
          You&apos;re signed in with a temporary password. Set your own before continuing.
        </p>
      ) : (
        <p className="mt-1 text-sm text-neutral-600">Change your password.</p>
      )}
      <ChangePasswordForm />
    </main>
  );
}
