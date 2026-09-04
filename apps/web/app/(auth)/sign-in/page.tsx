import Link from 'next/link';
import { env } from '@/env';
import { SignInForm } from './SignInForm';

/**
 * F02 §4.1. `data-state={env.PROVIDER_MODE}` follows the same convention as the Inspector page
 * (`(app)/calculations/[calculationId]/InspectorPage.tsx`): it names the mode this page is
 * actually running under rather than claiming a fixed "fixture" label, so the string is true in
 * every environment, including this one under e2e (`PROVIDER_MODE=fixture`, no live Resend call,
 * no live database — F02's storage swaps to an in-memory adapter in that mode).
 */
export default function Page() {
  return (
    <main data-route="/sign-in" data-state={env.PROVIDER_MODE} className="mx-auto max-w-sm p-8">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-neutral-600">One account, one email and password.</p>
      <SignInForm />
      <p className="mt-4 text-sm text-neutral-600">
        <Link href="/forgot-password" className="underline">
          Forgot your password?
        </Link>
      </p>
      <p className="mt-1 text-sm text-neutral-600">
        No account yet?{' '}
        <Link href="/sign-up" className="underline">
          Sign up
        </Link>
      </p>
    </main>
  );
}
