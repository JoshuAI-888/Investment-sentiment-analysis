'use server';

import { redirect } from 'next/navigation';
import { changePassword } from '@/services/auth';

export type ChangePasswordState = { readonly ok: false; readonly message: string } | { readonly ok: true };

export async function changePasswordAction(_prev: unknown, formData: FormData): Promise<ChangePasswordState> {
  const currentPassword = String(formData.get('currentPassword') ?? '');
  const newPassword = String(formData.get('newPassword') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');

  if (newPassword !== confirmPassword) {
    return { ok: false, message: 'Passwords do not match.' };
  }

  const result = await changePassword(currentPassword, newPassword);
  if (!result.ok) {
    const message =
      result.reason === 'wrong_current_password'
        ? 'Current password is incorrect.'
        : result.reason === 'weak_password'
          ? 'New password must be at least 12 characters.'
          : 'Something went wrong. Try again.';
    return { ok: false, message };
  }

  redirect('/dashboard');
}
