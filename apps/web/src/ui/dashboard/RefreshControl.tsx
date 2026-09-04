'use client';

/**
 * `RefreshControl` — F07 §4.6. *"When the global budget check refuses, the cached page renders
 * with the refresh control disabled and an explanation — the state survives D-11, its trigger
 * is the budget, not a tier."*
 *
 * `initialRefusal` is the last-known refusal read from storage (`assembleDashboard`), so a
 * fresh page load already shows the disabled state and its explanation without requiring a
 * client round trip first. A new POST can still refuse again (budget, cooldown, or a refresh
 * already in flight) and updates the same explanation in place.
 */
import { useState } from 'react';
import type { RefreshRefusalView } from './types';

export type RefreshControlProps = {
  readonly initialRefusal: RefreshRefusalView;
};

type Status = { readonly kind: 'idle' } | { readonly kind: 'pending' } | { readonly kind: 'refused'; readonly message: string } | { readonly kind: 'ok' };

export function RefreshControl({ initialRefusal }: RefreshControlProps) {
  const [status, setStatus] = useState<Status>(
    initialRefusal === null ? { kind: 'idle' } : { kind: 'refused', message: initialRefusal.message },
  );

  async function onRefresh() {
    setStatus({ kind: 'pending' });
    try {
      const response = await fetch('/api/dashboard/refresh', { method: 'POST' });
      const body = (await response.json()) as
        | { status: 'ok'; computedAt: string }
        | { status: 'refused'; reason: string; message: string }
        | { status: 'error'; message: string };

      if (body.status === 'refused' || body.status === 'error') {
        setStatus({ kind: 'refused', message: body.message });
        return;
      }
      setStatus({ kind: 'ok' });
      window.location.reload();
    } catch {
      setStatus({ kind: 'refused', message: 'The refresh request failed. Try again shortly.' });
    }
  }

  const disabled = status.kind === 'refused' || status.kind === 'pending';

  return (
    <div data-refresh-control="">
      <button
        type="button"
        onClick={onRefresh}
        disabled={disabled}
        data-refresh-button=""
        className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status.kind === 'pending' ? 'Refreshing…' : 'Refresh'}
      </button>
      {status.kind === 'refused' ? (
        <p className="mt-1 text-xs text-amber-700" data-refresh-refused-explanation="">
          {status.message}
        </p>
      ) : null}
    </div>
  );
}
