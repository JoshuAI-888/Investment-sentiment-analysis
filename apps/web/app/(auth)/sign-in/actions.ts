'use server';

import { redirect } from 'next/navigation';
import { requestSignInCode, verifySignInCode } from '@/services/auth';

export type RequestCodeState = { readonly ok: true };

/**
 * Always `{ ok: true }` — §4.2's generic-response rule. Whether the address is allowlisted,
 * capped, or entirely unknown is decided server-side and never distinguished here.
 */
export async function requestCodeAction(_prev: unknown, formData: FormData): Promise<RequestCodeState> {
  const email = String(formData.get('email') ?? '');
  await requestSignInCode(email);
  return { ok: true };
}

export type VerifyCodeState =
  | { readonly ok: false; readonly message: string }
  | { readonly ok: true };

export async function verifyCodeAction(_prev: unknown, formData: FormData): Promise<VerifyCodeState> {
  const email = String(formData.get('email') ?? '');
  const otp = String(formData.get('otp') ?? '');

  const result = await verifySignInCode(email, otp);
  if (!result.ok) {
    const message =
      result.reason === 'too_many_attempts'
        ? 'Too many wrong codes. Request a new one.'
        : 'That code is wrong or has expired.';
    return { ok: false, message };
  }

  redirect('/dashboard');
}
