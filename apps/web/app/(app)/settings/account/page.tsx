import { redirect } from 'next/navigation';
import { env } from '@/env';
import { requireUser, UnauthenticatedError } from '@/services/auth';
import { AccountPanel } from './AccountPanel';

/** F02 §4.4. `requireUser()` is called in this page's own body — see F02 §4.4's non-negotiable. */
export default async function Page() {
  let session;
  try {
    session = await requireUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect('/sign-in');
    throw error;
  }

  return (
    <main data-route="/settings/account" data-state={env.PROVIDER_MODE} className="mx-auto max-w-lg p-8">
      <h1 className="text-2xl font-semibold">Account</h1>
      <AccountPanel email={session.email} />
    </main>
  );
}
