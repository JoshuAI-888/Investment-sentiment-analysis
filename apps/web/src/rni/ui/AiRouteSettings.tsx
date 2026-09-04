'use client';

import type { FormEvent } from 'react';
import type {
  RniAiRoute,
  RniAiRouteSetting,
  RniAiRouteSettingUpdateResult,
} from '@/rni/contracts';

function routeLabel(aiRoute: RniAiRoute): string {
  return aiRoute === 'openai_direct' ? 'OpenAI Direct' : 'Vercel AI Gateway';
}

export function AiRouteSettings({
  setting,
  selectedRoute,
  isSubmitting,
  result,
  error,
  onSelectedRouteChange,
  onSubmit,
}: {
  setting: RniAiRouteSetting;
  selectedRoute: RniAiRoute;
  isSubmitting: boolean;
  result: RniAiRouteSettingUpdateResult | null;
  error: string | null;
  onSelectedRouteChange: (aiRoute: RniAiRoute) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">AI route settings</h1>
        <p>
          Current future-run configuration: <strong>{setting.configVersion}</strong>, effective at{' '}
          {setting.effectiveAt}.
        </p>
        <p>
          Changes create a new configuration for runs requested afterward. Existing runs and their
          recorded model lineage do not change.
        </p>
      </header>

      <section aria-labelledby="rni-ai-route-current-heading" className="space-y-2">
        <h2 id="rni-ai-route-current-heading" className="text-xl font-semibold">
          Current route
        </h2>
        <p>
          <strong>{routeLabel(setting.aiRoute)}</strong> is selected for future RNI runs.
        </p>
      </section>

      <section aria-labelledby="rni-ai-route-models-heading" className="space-y-2">
        <h2 id="rni-ai-route-models-heading" className="text-xl font-semibold">
          Resolved task models
        </h2>
        <ul className="space-y-2">
          {setting.resolvedModels.map((model) => (
            <li key={model.task} className="rounded border border-slate-300 p-3">
              <strong>{model.task}</strong>
              <dl className="mt-1 grid gap-1 sm:grid-cols-2">
                <div>
                  <dt className="inline font-semibold">Provider:</dt>{' '}
                  <dd className="inline">{model.provider}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Model:</dt>{' '}
                  <dd className="inline">{model.modelId}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Revision:</dt>{' '}
                  <dd className="inline">{model.modelRevision}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Prompt:</dt>{' '}
                  <dd className="inline">{model.promptVersion}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </section>

      <form className="space-y-4" onSubmit={onSubmit}>
        <fieldset disabled={isSubmitting}>
          <legend className="text-xl font-semibold">Route for future runs</legend>
          <div className="mt-2 space-y-3">
            {setting.options.map((option) => {
              const descriptionId = `rni-ai-route-${option.aiRoute}-description`;
              return (
                <div key={option.aiRoute} className="rounded border border-slate-300 p-3">
                  <label className="flex items-start gap-2" htmlFor={`rni-ai-route-${option.aiRoute}`}>
                    <input
                      aria-describedby={descriptionId}
                      checked={selectedRoute === option.aiRoute}
                      disabled={!option.available}
                      id={`rni-ai-route-${option.aiRoute}`}
                      name="ai-route"
                      onChange={() => onSelectedRouteChange(option.aiRoute)}
                      type="radio"
                      value={option.aiRoute}
                    />
                    <span>
                      <strong>{routeLabel(option.aiRoute)}</strong>
                      {option.aiRoute === setting.aiRoute ? ' (current)' : ''}
                    </span>
                  </label>
                  <p id={descriptionId} className="mt-1">
                    {option.available
                      ? 'Available for a future configuration.'
                      : `Unavailable: ${option.unavailableReason}`}
                  </p>
                </div>
              );
            })}
          </div>
        </fieldset>

        <label className="flex flex-col gap-1" htmlFor="rni-ai-route-reason">
          Change reason
          <textarea
            id="rni-ai-route-reason"
            maxLength={500}
            name="reason"
            required
            rows={3}
          />
        </label>
        <button
          className="rounded border border-slate-700 px-3 py-2 disabled:cursor-not-allowed"
          disabled={isSubmitting || selectedRoute === setting.aiRoute}
          type="submit"
        >
          Use {routeLabel(selectedRoute)} for future runs
        </button>
      </form>

      {isSubmitting ? <p role="status">Saving future-run route setting…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {result ? (
        <section aria-labelledby="rni-ai-route-result-heading">
          <h2 id="rni-ai-route-result-heading" className="text-xl font-semibold">
            Future-run setting saved
          </h2>
          <p role="status" aria-live="polite">
            {result.disposition === 'accepted' ? 'Accepted' : 'Duplicate'} route setting: {' '}
            {routeLabel(result.setting.aiRoute)} now applies from configuration{' '}
            {result.setting.configVersion}.
          </p>
          <p>Previous configuration: {result.previousConfigVersion}.</p>
        </section>
      ) : null}
    </main>
  );
}
