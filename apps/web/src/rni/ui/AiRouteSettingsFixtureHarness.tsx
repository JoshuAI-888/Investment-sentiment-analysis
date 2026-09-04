'use client';

import { useState, type FormEvent } from 'react';
import {
  FixtureRniAiRouteSettingsService,
  type FixtureRniAiRouteSettingsServiceOptions,
} from '../../../fixtures/rni-ui/read-service';
import type { RniAiRoute, RniAiRouteSetting, RniAiRouteSettingUpdateResult } from '@/rni/contracts';
import { AiRouteSettings } from './AiRouteSettings';

/** Fixture composition keeps the client limited to the frozen intent-only settings service. */
export function AiRouteSettingsFixtureHarness({
  initialSetting,
  gatewayAvailable = true,
}: {
  initialSetting: RniAiRouteSetting;
  gatewayAvailable?: FixtureRniAiRouteSettingsServiceOptions['gatewayAvailable'];
}) {
  const [service] = useState(
    () => new FixtureRniAiRouteSettingsService({ gatewayAvailable }),
  );
  const [setting, setSetting] = useState(initialSetting);
  const [selectedRoute, setSelectedRoute] = useState<RniAiRoute>(initialSetting.aiRoute);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<RniAiRouteSettingUpdateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const reason = form.get('reason');
    if (typeof reason !== 'string' || reason.trim().length === 0) {
      setError('Provide a reason before changing the future-run route.');
      return;
    }

    setIsSubmitting(true);
    setResult(null);
    setError(null);
    void service
      .updateFutureAiRoute({
        idempotencyKey: crypto.randomUUID(),
        aiRoute: selectedRoute,
        reason,
      })
      .then((nextResult) => {
        setSetting(nextResult.setting);
        setSelectedRoute(nextResult.setting.aiRoute);
        setResult(nextResult);
      })
      .catch(() => setError('The future-run route setting could not be saved.'))
      .finally(() => setIsSubmitting(false));
  }

  return (
    <AiRouteSettings
      error={error}
      isSubmitting={isSubmitting}
      onSelectedRouteChange={setSelectedRoute}
      onSubmit={onSubmit}
      result={result}
      selectedRoute={selectedRoute}
      setting={setting}
    />
  );
}
