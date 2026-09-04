'use client';

import { useActionState, useState } from 'react';
import { requestCodeAction, verifyCodeAction } from './actions';

/**
 * Two steps, one form component: request a code, then enter it. Both steps post to a server
 * action (`actions.ts`) — the email address and the code never leave the request/response
 * cycle through anything this component holds onto beyond form state.
 */
export function SignInForm() {
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'request' | 'verify'>('request');

  const [, requestFormAction, requestPending] = useActionState(async (prev: unknown, formData: FormData) => {
    const result = await requestCodeAction(prev, formData);
    setStep('verify');
    return result;
  }, { ok: true });

  const [verifyState, verifyFormAction, verifyPending] = useActionState(verifyCodeAction, { ok: true });

  if (step === 'request') {
    return (
      <form action={requestFormAction} className="mt-6 space-y-4">
        <label className="block text-sm font-medium text-neutral-700" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={requestPending}
          className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {requestPending ? 'Sending…' : 'Send code'}
        </button>
        <p className="text-xs text-neutral-500">
          If this address has an account, a six-digit code is on its way. This page looks the
          same either way.
        </p>
      </form>
    );
  }

  return (
    <form action={verifyFormAction} className="mt-6 space-y-4">
      <input type="hidden" name="email" value={email} />
      <label className="block text-sm font-medium text-neutral-700" htmlFor="otp">
        Enter the six-digit code
      </label>
      <input
        id="otp"
        name="otp"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        required
        className="w-full rounded border border-neutral-300 px-3 py-2 text-sm tracking-widest"
      />
      <button
        type="submit"
        disabled={verifyPending}
        className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {verifyPending ? 'Checking…' : 'Verify'}
      </button>
      {!verifyState.ok ? <p className="text-sm text-red-700">{verifyState.message}</p> : null}
      <p className="text-xs text-neutral-500">The code expires five minutes after it was sent.</p>
    </form>
  );
}
