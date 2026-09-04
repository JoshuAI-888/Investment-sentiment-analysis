'use client';

import { useState } from 'react';
import { createFixtureRniCommandService } from '../../../fixtures/rni-ui/read-service';
import type { RniManualRefreshResult } from '@/rni/contracts';

export function ManualRefreshControls() {
  const [service] = useState(createFixtureRniCommandService);
  const [pending, setPending] = useState<string | null>(null);
  const [result, setResult] = useState<RniManualRefreshResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit(kind: 'ticker' | 'full_universe') {
    const key = kind === 'ticker' ? 'fixture-refresh-nvda' : 'fixture-refresh-full';
    setPending(kind);
    setResult(null);
    setError(null);
    void service
      .requestManualRefresh({
        idempotencyKey: key,
        scope: kind === 'ticker' ? { kind, ticker: 'NVDA' } : { kind },
      })
      .then(setResult)
      .catch(() => setError('The refresh request could not be submitted.'))
      .finally(() => setPending(null));
  }
  return (
    <main data-rni-refresh-controls className="mx-auto max-w-3xl space-y-4 p-4 sm:p-8">
      <h1 className="text-3xl font-semibold">Manual refresh</h1>
      <p>
        NVDA — NVIDIA Corporation · NASDAQ. Refreshes use one idempotency key per requested scope.
      </p>
      <button type="button" disabled={pending !== null} onClick={() => submit('ticker')}>
        Refresh NVDA
      </button>
      <button type="button" disabled={pending !== null} onClick={() => submit('full_universe')}>
        Refresh full universe
      </button>
      {pending ? (
        <p role="status">Submitting {pending === 'ticker' ? 'NVDA' : 'full universe'} refresh…</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {result ? (
        <>
          <p role="status">
            {result.disposition === 'accepted' ? 'Accepted' : 'Duplicate'} refresh · {result.runId}
          </p>
          <p data-rni-refresh-scope-preview>
            Scope preview:{' '}
            {result.scopePreview.kind === 'ticker'
              ? `${result.scopePreview.ticker} — ${result.scopePreview.companyName} · ${result.scopePreview.exchange} · ${result.scopePreview.universeVersion}`
              : `${result.scopePreview.securityCount} active securities · ${result.scopePreview.universeVersion}`}
          </p>
        </>
      ) : null}
    </main>
  );
}
