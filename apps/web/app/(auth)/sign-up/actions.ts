'use server';

import { signUpWithPassword } from '@/services/auth';

export type SignUpState =
  | { readonly ok: false; readonly message: string }
  | { readonly ok: true; readonly message: string };

export async function signUpAction(_prev: unknown, formData: FormData): Promise<SignUpState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');

  if (password !== confirmPassword) {
    return { ok: false, message: 'Passwords do not match.' };
  }

  const result = await signUpWithPassword(email, password);
  if (result.ok) {
    return { ok: true, message: 'Check your email for a verification link before signing in.' };
  }

  const message = {
    not_allowed: 'This address is not authorized to create an account.',
    already_exists: 'An account already exists for this address — sign in instead.',
    weak_password: 'Password must be at least 12 characters.',
    unknown: 'Something went wrong. Try again.',
  }[result.reason];

  return { ok: false, message };
}
