'use client';

import { useState } from 'react';
import {
  rniManualRefreshResult,
  type RniCommandService,
  type RniManualRefreshRequest,
  type RniManualRefreshResult,
} from '@/rni/contracts';

type RefreshScopeContext = Readonly<{
  universeVersion: string;
  securityCount: number;
  defaultSecurity: Readonly<{
    ticker: string;
    companyName: string;
    exchange: string;
  }>;
}>;

class HttpRniCommandService implements RniCommandService {
  async requestManualRefresh(request: RniManualRefreshRequest) {
    const response = await fetch('/api/rni/runs', {
      body: JSON.stringify({ scope: request.scope }),
      headers: {
        'content-type': 'application/json',
        'idempotency-key': request.idempotencyKey,
      },
      method: 'POST',
    });
    if (!response.ok) throw new Error('RNI refresh request failed');
    const payload: unknown = await response.json();
    return rniManualRefreshResult.parse(
      typeof payload === 'object' && payload !== null && 'data' in payload
        ? (payload as { data: unknown }).data
        : payload,
    );
  }
}

export function ManualRefreshControls({
  service: injectedService,
  scopeContext,
}: {
  service?: RniCommandService;
  scopeContext: RefreshScopeContext;
}) {
  const [httpService] = useState(() => new HttpRniCommandService());
  const service = injectedService ?? httpService;
  const [pending, setPending] = useState<string | null>(null);
  const [result, setResult] = useState<RniManualRefreshResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit(kind: 'ticker' | 'full_universe') {
    const key = crypto.randomUUID();
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
        {scopeContext.defaultSecurity.ticker} — {scopeContext.defaultSecurity.companyName} ·{' '}
        {scopeContext.defaultSecurity.exchange}. Refreshes use one idempotency key per requested
        scope.
      </p>
      <section aria-labelledby="rni-nvda-refresh">
        <h2 id="rni-nvda-refresh">NVDA refresh</h2>
        <p id="rni-nvda-scope-preview">
          Scope preview: {scopeContext.defaultSecurity.ticker} —{' '}
          {scopeContext.defaultSecurity.companyName} · {scopeContext.defaultSecurity.exchange} ·{' '}
          {scopeContext.universeVersion}
        </p>
        <button
          type="button"
          disabled={pending !== null}
          aria-describedby="rni-nvda-scope-preview"
          onClick={() => submit('ticker')}
        >
          Refresh NVDA
        </button>
      </section>
      <section aria-labelledby="rni-full-universe-refresh">
        <h2 id="rni-full-universe-refresh">Full-universe refresh</h2>
        <p id="rni-full-universe-scope-preview">
          Scope preview: {scopeContext.securityCount} active securities ·{' '}
          {scopeContext.universeVersion}
        </p>
        <button
          type="button"
          disabled={pending !== null}
          aria-describedby="rni-full-universe-scope-preview"
          onClick={() => submit('full_universe')}
        >
          Refresh full universe
        </button>
      </section>
      {pending ? (
        <p role="status">Submitting {pending === 'ticker' ? 'NVDA' : 'full universe'} refresh…</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {result ? (
        <>
          <p role="status">
            {result.disposition === 'accepted' ? 'Accepted' : 'Duplicate'} refresh · {result.runId}
          </p>
          <p data-rni-refresh-result-scope>
            Submitted scope:{' '}
            {result.scopePreview.kind === 'ticker'
              ? `${result.scopePreview.ticker} — ${result.scopePreview.companyName} · ${result.scopePreview.exchange} · ${result.scopePreview.universeVersion}`
              : `${result.scopePreview.securityCount} active securities · ${result.scopePreview.universeVersion}`}
          </p>
        </>
      ) : null}
    </main>
  );
}
