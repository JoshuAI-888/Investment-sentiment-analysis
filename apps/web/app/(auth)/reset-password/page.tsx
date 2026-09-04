import { env } from '@/env';
import { ResetPasswordForm } from './ResetPasswordForm';

/** `token` arrives as a query param on the link `sendResetPassword` mails (`instance.ts`). */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ readonly token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <main data-route="/reset-password" data-state={env.PROVIDER_MODE} className="mx-auto max-w-sm p-8">
      <h1 className="text-2xl font-semibold">Set a new password</h1>
      {token === undefined ? (
        <p className="mt-1 text-sm text-red-700">This link is missing its token.</p>
      ) : (
        <ResetPasswordForm token={token} />
      )}
    </main>
  );
}
