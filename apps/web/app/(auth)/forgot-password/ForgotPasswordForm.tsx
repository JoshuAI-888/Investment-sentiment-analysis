'use client';

import { useActionState, useState } from 'react';
import { requestResetAction } from './actions';

export function ForgotPasswordForm() {
  const [submitted, setSubmitted] = useState(false);
  const [, formAction, pending] = useActionState(async (prev: unknown, formData: FormData) => {
    const result = await requestResetAction(prev, formData);
    setSubmitted(true);
    return result;
  }, { ok: true });

  if (submitted) {
    return (
      <p className="mt-6 text-sm text-neutral-600">
        If this address has an account, a reset link is on its way.
      </p>
    );
  }

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
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {pending ? 'Sending…' : 'Send reset link'}
      </button>
    </form>
  );
}
