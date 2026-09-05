'use server';

import { redirect } from 'next/navigation';
import { rniModelTask, type RniTaskEnvelope } from '@/rni/contracts';
import { createRniTaskEnvelopeSettingsService } from '@/services/jobs';
import { requireAdmin } from '@/services/auth';

const requiredText = (form: FormData, key: string): string => {
  const value = form.get(key);
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${key} is required`);
  return value.trim();
};

const requiredInteger = (form: FormData, key: string): number => {
  const value = Number(requiredText(form, key));
  if (!Number.isSafeInteger(value)) throw new Error(`${key} must be an integer`);
  return value;
};

export async function stageRniTaskEnvelopesAction(form: FormData): Promise<void> {
  const session = await requireAdmin();
  const idempotencyKey = requiredText(form, 'idempotencyKey');
  const reason = requiredText(form, 'reason');
  const envelopes: RniTaskEnvelope[] = rniModelTask.options.map((task) => ({
    task,
    maxInputBytes: requiredInteger(form, `${task}.maxInputBytes`),
    maxInputTokensReserved: requiredInteger(form, `${task}.maxInputBytes`),
    maxOutputTokens: requiredInteger(form, `${task}.maxOutputTokens`),
    maxToolCalls: requiredInteger(form, `${task}.maxToolCalls`),
    timeoutMs: requiredInteger(form, `${task}.timeoutMs`),
    maxCostUsd: requiredText(form, `${task}.maxCostUsd`),
  }));
  const environment = process.env['VERCEL_ENV'] ?? 'development';
  const result = await createRniTaskEnvelopeSettingsService({
    environment,
    actorId: session.userId,
  }).stageFutureTaskEnvelopes({ idempotencyKey, reason, envelopes });
  redirect(`/admin/settings/rni-ai?staged=${encodeURIComponent(result.setting.configVersion)}`);
}
