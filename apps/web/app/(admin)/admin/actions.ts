'use server';

/**
 * Admin server actions (F15). Fixture state until the control plane lands.
 *
 * ADR-013 is the binding constraint on everything that will live here: the admin edits
 * database job rows, never the external scheduler. No action in this file may ever write a
 * QStash schedule, `vercel.json`, or the dispatch secret (F16 §4.2).
 */
import { requireAdmin } from '@/services/auth';

export type AdminActionResult = { readonly ok: boolean; readonly state: 'fixture' };

/** F02 §4.4: `requireAdmin()` called in this server action's own body. */
export async function refreshDataSources(): Promise<AdminActionResult> {
  await requireAdmin();
  return { ok: true, state: 'fixture' };
}
