import { env } from '@/env';
import { ForgotPasswordForm } from './ForgotPasswordForm';

export default function Page() {
  return (
    <main data-route="/forgot-password" data-state={env.PROVIDER_MODE} className="mx-auto max-w-sm p-8">
      <h1 className="text-2xl font-semibold">Reset your password</h1>
      <p className="mt-1 text-sm text-neutral-600">Enter your email and we&apos;ll send a reset link.</p>
      <ForgotPasswordForm />
    </main>
  );
}
