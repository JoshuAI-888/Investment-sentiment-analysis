'use client';

import { useRef, useState, type FormEvent } from 'react';
import {
  rniAiRouteSettingUpdateResult,
  rniAiBudgetSettingUpdateRequest,
  rniAiBudgetSettingUpdateResult,
  type RniAiBudgetSettingUpdateResult,
  type RniAiRoute,
  type RniAiRouteSetting,
  type RniAiRouteSettingUpdateResult,
} from '@/rni/contracts';
import { AiRouteSettings } from './AiRouteSettings';

/** The server supplies a serializable authenticated initial read; mutations use only intent. */
export function AiRouteSettingsLiveHarness({
  initialSetting,
}: {
  initialSetting: RniAiRouteSetting;
}) {
  const [setting, setSetting] = useState(initialSetting);
  const [selectedRoute, setSelectedRoute] = useState<RniAiRoute>(initialSetting.aiRoute);
  const [isSubmitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<RniAiRouteSettingUpdateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const attempt = useRef<{ intent: string; key: string } | null>(null);
  const budgetAttempt = useRef<{ intent: string; key: string } | null>(null);
  const [budgetResult, setBudgetResult] = useState<RniAiBudgetSettingUpdateResult | null>(null);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [budgetInvalid, setBudgetInvalid] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const value = new FormData(event.currentTarget).get('reason');
    if (typeof value !== 'string' || !value.trim()) {
      setError('Provide a reason before changing the future-run route.');
      return;
    }
    const body = { aiRoute: selectedRoute, reason: value.trim() };
    const intent = JSON.stringify(body);
    if (attempt.current?.intent !== intent) attempt.current = { intent, key: crypto.randomUUID() };
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    setResult(null);
    setBudgetResult(null);
    try {
      const response = await fetch('/api/rni/settings', {
        method: 'PATCH',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.current.key },
        body: intent,
      });
      if (!response.ok) throw new Error('settings unavailable');
      const payload: unknown = await response.json();
      const saved = rniAiRouteSettingUpdateResult.parse((payload as { data?: unknown }).data);
      if (saved.idempotencyKey !== attempt.current.key || saved.setting.aiRoute !== body.aiRoute)
        throw new Error('settings response does not match the submitted intent');
      setSetting(saved.setting);
      setSelectedRoute(saved.setting.aiRoute);
      setResult(saved);
      attempt.current = null;
    } catch {
      setError('The future-run route setting could not be saved. Retry the same change safely.');
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  async function onBudgetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const form = new FormData(event.currentTarget);
    const parsed = rniAiBudgetSettingUpdateRequest.omit({ idempotencyKey: true }).safeParse({
      reason: form.get('reason'),
      budgets: {
        manualRunHardUsd: form.get('manualRunHardUsd'),
        fullUniverseHardUsd: form.get('fullUniverseHardUsd'),
        rolling24hHardUsd: form.get('rolling24hHardUsd'),
        monthlyWarningUsd: form.get('monthlyWarningUsd'),
        monthlyHardUsd: form.get('monthlyHardUsd'),
        currency: 'USD',
      },
    });
    if (!parsed.success) {
      setBudgetInvalid(true);
      setBudgetResult(null);
      setBudgetError(
        'Provide a reason (1–500 characters) and positive USD amounts with at most two decimal places, within each maximum. Keep limits ordered: manual ticker ≤ full universe ≤ rolling 24 hours ≤ monthly warning < monthly hard stop.',
      );
      return;
    }
    const body = parsed.data;
    const intent = JSON.stringify(body);
    if (budgetAttempt.current?.intent !== intent)
      budgetAttempt.current = { intent, key: crypto.randomUUID() };
    const key = budgetAttempt.current.key;
    inFlight.current = true;
    setSubmitting(true);
    setBudgetError(null);
    setBudgetInvalid(false);
    setBudgetResult(null);
    setResult(null);
    try {
      const response = await fetch('/api/rni/settings/budgets', {
        method: 'PATCH',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: intent,
      });
      if (!response.ok) throw new Error('budget settings unavailable');
      const payload: unknown = await response.json();
      const saved = rniAiBudgetSettingUpdateResult.parse((payload as { data?: unknown }).data);
      if (
        saved.idempotencyKey !== key ||
        Object.entries(body.budgets).some(([field, value]) =>
          field === 'currency'
            ? saved.setting.budgets.currency !== value
            : Number(
                saved.setting.budgets[field as Exclude<keyof typeof body.budgets, 'currency'>],
              ) !== Number(value),
        )
      )
        throw new Error('budget response does not match the submitted intent');
      setSetting(saved.setting);
      setSelectedRoute(saved.setting.aiRoute);
      setBudgetResult(saved);
      budgetAttempt.current = null;
    } catch {
      setBudgetError(
        'The future-run budget settings could not be saved. Retry the same change safely.',
      );
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <AiRouteSettings
      setting={setting}
      selectedRoute={selectedRoute}
      isSubmitting={isSubmitting}
      result={result}
      error={error}
      onSelectedRouteChange={setSelectedRoute}
      onSubmit={onSubmit}
      budgetControls={{
        onSubmit: onBudgetSubmit,
        error: budgetError,
        result: budgetResult,
        invalid: budgetInvalid,
      }}
    />
  );
}
