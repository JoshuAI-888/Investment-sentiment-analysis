'use client';

import { useRef, useState, type FormEvent } from 'react';
import {
  rniAiRouteSettingUpdateResult,
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

  return (
    <AiRouteSettings
      setting={setting}
      selectedRoute={selectedRoute}
      isSubmitting={isSubmitting}
      result={result}
      error={error}
      onSelectedRouteChange={setSelectedRoute}
      onSubmit={onSubmit}
    />
  );
}
