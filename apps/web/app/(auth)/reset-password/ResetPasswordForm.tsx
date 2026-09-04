'use client';

import { useActionState } from 'react';
import { resetPasswordAction } from './actions';

export function ResetPasswordForm({ token }: { readonly token: string }) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, { ok: true });

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <input type="hidden" name="token" value={token} />
      <div>
        <label className="block text-sm font-medium text-neutral-700" htmlFor="password">
          New password
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
          Confirm new password
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
        {pending ? 'Saving…' : 'Set password'}
      </button>
      {!state.ok ? <p className="text-sm text-red-700">{state.message}</p> : null}
    </form>
  );
}
