'use server';

import { requestPasswordReset } from '@/services/auth';

export type RequestResetState = { readonly ok: true };

/** Always `{ ok: true }` — §4.2's generic-response rule; see `requestPasswordReset`'s own doc. */
export async function requestResetAction(_prev: unknown, formData: FormData): Promise<RequestResetState> {
  const email = String(formData.get('email') ?? '');
  await requestPasswordReset(email);
  return { ok: true };
}
