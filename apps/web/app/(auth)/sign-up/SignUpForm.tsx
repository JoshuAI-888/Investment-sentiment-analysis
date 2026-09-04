'use client';

import { useActionState } from 'react';
import { signUpAction } from './actions';

export function SignUpForm() {
  const [state, formAction, pending] = useActionState(signUpAction, { ok: true, message: '' });

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <div>
        <label className="block text-sm font-medium text-neutral-700" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-neutral-700" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-neutral-700" htmlFor="confirmPassword">
          Confirm password
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {pending ? 'Creating…' : 'Create account'}
      </button>
      {state.message !== '' ? (
        <p className={`text-sm ${state.ok ? 'text-green-700' : 'text-red-700'}`}>{state.message}</p>
      ) : null}
    </form>
  );
}
