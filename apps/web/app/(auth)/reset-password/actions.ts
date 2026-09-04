'use server';

import { redirect } from 'next/navigation';
import { resetPassword } from '@/services/auth';

export type ResetPasswordState = { readonly ok: false; readonly message: string } | { readonly ok: true };

export async function resetPasswordAction(_prev: unknown, formData: FormData): Promise<ResetPasswordState> {
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');

  if (password !== confirmPassword) {
    return { ok: false, message: 'Passwords do not match.' };
  }

  const result = await resetPassword(token, password);
  if (!result.ok) {
    const message =
      result.reason === 'weak_password'
        ? 'Password must be at least 12 characters.'
        : 'That link is invalid or has expired. Request a new one.';
    return { ok: false, message };
  }

  redirect('/sign-in');
}
