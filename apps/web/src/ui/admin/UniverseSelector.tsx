'use client';

/**
 * F15 §4.3 — the universe selector. A searchable, filterable, paginated checkbox table over the
 * local security master, with a draft → impact preview → versioned activation flow (§4.1/§4.4).
 *
 * Every fetch here hits `/api/admin/universe` (a GET, server-side paginated) or the mutation
 * routes — never a provider. The initial page render already did one server-side fetch; this
 * component re-fetches only on search/filter/page changes, which is exactly the same "zero
 * provider calls per row" property, just triggered by the operator instead of by page load.
 */
import { useCallback, useEffect, useState } from 'react';

type UniverseRow = {
  readonly securityId: string;
  readonly symbol: string;
  readonly name: string;
  readonly exchange: string;
  readonly sector: string | null;
  readonly marketCap: string | null;
  readonly currentPrice: string | null;
  readonly session: string | null;
  readonly growth7d: string | null;
  readonly growth30d: string | null;
  readonly growth90d: string | null;
  readonly growth180d: string | null;
  readonly trend5Session: string;
  readonly valuationStatus: string;
  readonly dataFreshness: string | null;
  readonly eligibilityState: string | null;
  readonly isMember: boolean;
};

export type UniverseSelectorProps = {
  readonly initialRows: readonly UniverseRow[];
  readonly initialTotalCount: number;
  readonly initialSelected: readonly string[];
  readonly activeVersionId: string | null;
};

type MutationStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'preview'; readonly draftVersionId: string; readonly preview: Record<string, unknown> }
  | { readonly kind: 'activated'; readonly rollbackTarget: string | null }
  | { readonly kind: 'conflict'; readonly message: string; readonly diff: unknown }
  | { readonly kind: 'error'; readonly message: string };

const PAGE_SIZE = 50;

export function UniverseSelector({ initialRows, initialTotalCount, initialSelected, activeVersionId }: UniverseSelectorProps) {
  const [rows, setRows] = useState(initialRows);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected));
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState<MutationStatus>({ kind: 'idle' });

  const refetch = useCallback(async (query: string, pageNumber: number) => {
    const params = new URLSearchParams({ page: String(pageNumber), pageSize: String(PAGE_SIZE) });
    if (query.trim() !== '') params.set('q', query.trim());
    const response = await fetch(`/api/admin/universe?${params.toString()}`);
    const body = (await response.json()) as { rows: UniverseRow[]; totalCount: number };
    setRows(body.rows);
    setTotalCount(body.totalCount);
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      void refetch(q, page);
    }, 250);
    return () => clearTimeout(timeout);
  }, [q, page]);

  function toggle(securityId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(securityId)) next.delete(securityId);
      else next.add(securityId);
      return next;
    });
  }

  async function onDraftAndPreview() {
    setStatus({ kind: 'pending' });
    try {
      const response = await fetch('/api/admin/universe/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reason,
          expectedVersion: activeVersionId,
          targetSecurityIds: Array.from(selected),
          selectionSource: 'checkbox',
        }),
      });
      const body = (await response.json()) as
        | { status: 'ok'; objectId: string; impactPreview: Record<string, unknown> }
        | { status: 'conflict'; message: string; diff: unknown }
        | { status: 'invalid'; issues: unknown };

      if (body.status === 'ok') {
        setStatus({ kind: 'preview', draftVersionId: body.objectId, preview: body.impactPreview });
      } else if (body.status === 'conflict') {
        setStatus({ kind: 'conflict', message: body.message, diff: body.diff });
      } else {
        setStatus({ kind: 'error', message: 'Draft rejected: ' + JSON.stringify(body.issues) });
      }
    } catch {
      setStatus({ kind: 'error', message: 'The draft request failed.' });
    }
  }

  async function onActivate() {
    if (status.kind !== 'preview') return;
    const draftVersionId = status.draftVersionId;
    setStatus({ kind: 'pending' });
    try {
      const response = await fetch('/api/admin/universe/activate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reason,
          expectedVersion: activeVersionId,
          targetSecurityIds: Array.from(selected),
          selectionSource: 'checkbox',
          draftVersionId,
        }),
      });
      const body = (await response.json()) as
        | { status: 'ok'; rollbackTarget: string | null }
        | { status: 'conflict'; message: string; diff: unknown }
        | { status: 'invalid'; issues: unknown };

      if (body.status === 'ok') {
        setStatus({ kind: 'activated', rollbackTarget: body.rollbackTarget });
      } else if (body.status === 'conflict') {
        setStatus({ kind: 'conflict', message: body.message, diff: body.diff });
      } else {
        setStatus({ kind: 'error', message: 'Activation rejected: ' + JSON.stringify(body.issues) });
      }
    } catch {
      setStatus({ kind: 'error', message: 'The activation request failed.' });
    }
  }

  const totalPages = Math.max(Math.ceil(totalCount / PAGE_SIZE), 1);

  return (
    <div data-universe-selector="" className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Search symbol or company"
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setPage(1);
          }}
          data-universe-search=""
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
        />
        <span className="text-xs text-neutral-500" data-universe-selected-count="">
          {selected.size} selected · {totalCount} total (cap 100)
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm" data-universe-table="">
          <thead>
            <tr className="border-b border-neutral-300 text-xs uppercase text-neutral-500">
              <th className="p-2"> </th>
              <th className="p-2">Symbol</th>
              <th className="p-2">Company</th>
              <th className="p-2">Exchange</th>
              <th className="p-2">Sector</th>
              <th className="p-2">Mkt cap</th>
              <th className="p-2">Price</th>
              <th className="p-2">Session</th>
              <th className="p-2">7D</th>
              <th className="p-2">30D</th>
              <th className="p-2">90D</th>
              <th className="p-2">180D</th>
              <th className="p-2">5-session trend</th>
              <th className="p-2">Valuation</th>
              <th className="p-2">Freshness</th>
              <th className="p-2">Eligibility</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.securityId} className="border-b border-neutral-100" data-universe-row={row.symbol}>
                <td className="p-2">
                  <input
                    type="checkbox"
                    checked={selected.has(row.securityId)}
                    onChange={() => toggle(row.securityId)}
                    disabled={!selected.has(row.securityId) && selected.size >= 100}
                    data-universe-checkbox={row.symbol}
                  />
                </td>
                <td className="p-2 font-mono">{row.symbol}</td>
                <td className="p-2">{row.name}</td>
                <td className="p-2">{row.exchange}</td>
                <td className="p-2">{row.sector ?? '—'}</td>
                <td className="p-2">{row.marketCap ?? '—'}</td>
                <td className="p-2">{row.currentPrice ?? '—'}</td>
                <td className="p-2">{row.session ?? '—'}</td>
                <td className="p-2">{row.growth7d ?? '—'}</td>
                <td className="p-2">{row.growth30d ?? '—'}</td>
                <td className="p-2">{row.growth90d ?? '—'}</td>
                <td className="p-2">{row.growth180d ?? '—'}</td>
                <td className="p-2">{row.trend5Session}</td>
                <td className="p-2 text-neutral-500" title="F13 deferred (D-19)">
                  not applicable
                </td>
                <td className="p-2 text-xs text-neutral-500">{row.dataFreshness ?? 'never observed'}</td>
                <td className="p-2">{row.eligibilityState ?? 'unknown'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <button
          type="button"
          onClick={() => setPage((p) => Math.max(p - 1, 1))}
          disabled={page <= 1}
          className="rounded border border-neutral-300 px-2 py-1 disabled:opacity-50"
        >
          Prev
        </button>
        <span data-universe-page="">
          Page {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
          disabled={page >= totalPages}
          className="rounded border border-neutral-300 px-2 py-1 disabled:opacity-50"
        >
          Next
        </button>
      </div>

      <div className="space-y-2 rounded border border-neutral-300 p-4">
        <label className="block text-sm">
          Change reason (required)
          <input
            type="text"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            data-universe-reason=""
            className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 text-sm"
          />
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onDraftAndPreview}
            disabled={reason.trim().length < 3 || status.kind === 'pending' || selected.size === 0}
            data-universe-draft-button=""
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            Preview
          </button>
          {status.kind === 'preview' ? (
            <button
              type="button"
              onClick={onActivate}
              data-universe-activate-button=""
              className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white"
            >
              Activate
            </button>
          ) : null}
        </div>

        {status.kind === 'preview' ? (
          <pre data-universe-impact-preview="" className="mt-2 rounded bg-neutral-50 p-2 text-xs">
            {JSON.stringify(status.preview, null, 2)}
          </pre>
        ) : null}
        {status.kind === 'conflict' ? (
          <p className="text-sm text-red-700" data-universe-conflict="">
            Conflict: {status.message}
          </p>
        ) : null}
        {status.kind === 'error' ? (
          <p className="text-sm text-red-700" data-universe-error="">
            {status.message}
          </p>
        ) : null}
        {status.kind === 'activated' ? (
          <p className="text-sm text-green-700" data-universe-activated="">
            Activated. Rollback target: {status.rollbackTarget ?? 'none (first version)'}.
          </p>
        ) : null}
      </div>
    </div>
  );
}
