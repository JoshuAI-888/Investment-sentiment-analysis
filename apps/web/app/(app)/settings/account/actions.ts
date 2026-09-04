'use server';

import { redirect } from 'next/navigation';
import { deleteMyAccount, exportMyData, signOutCurrentSession } from '@/services/auth';

export async function signOutAction(): Promise<void> {
  await signOutCurrentSession();
  redirect('/sign-in');
}

/** §4.5: "self-service, confirmed, and idempotent." The UI confirms; this call is idempotent. */
export async function deleteAccountAction(): Promise<void> {
  await deleteMyAccount();
  redirect('/sign-in');
}

export type ExportState = { readonly json: string } | { readonly error: string };

export async function exportAccountAction(): Promise<ExportState> {
  const data = await exportMyData();
  if (data === null) return { error: 'not_signed_in' };
  return { json: JSON.stringify(data, null, 2) };
}
