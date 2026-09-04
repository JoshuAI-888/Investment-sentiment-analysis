import Link from 'next/link';
import { env } from '@/env';
import { SignUpForm } from './SignUpForm';

/**
 * F02 §4.1. Self-service, but **allowlist-gated** — `databaseHooks.user.create.before`
 * (`src/services/auth/instance.ts`) refuses to create a user for any address other than the one
 * on `ADMIN_EMAIL_ALLOWLIST`, and `requireEmailVerification` means even that address cannot sign
 * in until the mailed link is clicked.
 */
export default function Page() {
  return (
    <main data-route="/sign-up" data-state={env.PROVIDER_MODE} className="mx-auto max-w-sm p-8">
      <h1 className="text-2xl font-semibold">Sign up</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Only the configured admin address can create an account.
      </p>
      <SignUpForm />
      <p className="mt-4 text-sm text-neutral-600">
        Already have an account?{' '}
        <Link href="/sign-in" className="underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
