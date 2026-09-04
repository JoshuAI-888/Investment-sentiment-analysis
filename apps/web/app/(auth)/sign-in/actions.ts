'use server';

import { redirect } from 'next/navigation';
import { signInWithPassword } from '@/services/auth';

export type SignInState = { readonly ok: false; readonly message: string } | { readonly ok: true };

export async function signInAction(_prev: unknown, formData: FormData): Promise<SignInState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  const result = await signInWithPassword(email, password);
  if (!result.ok) {
    const message =
      result.reason === 'email_not_verified'
        ? 'Check your email and click the verification link before signing in.'
        : 'That email or password is wrong.';
    return { ok: false, message };
  }

  redirect('/dashboard');
}
