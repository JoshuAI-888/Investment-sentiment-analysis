'use client';

/**
 * F15 §4.5 — the data explorer. Filters trigger a fresh `GET /api/admin/data`, which is audited
 * server-side on every call (including a zero-row result) — this component never audits
 * client-side, since a client-side audit call could be skipped by a client that simply never
 * makes it.
 */
import { useState } from 'react';

type PayloadRow = {
  readonly id: string;
  readonly provider: string;
  readonly operation: string;
  readonly contentClass: string;
  readonly redactionStatus: string;
  readonly rightsStatus: string;
  readonly ingestedAt: string;
  readonly retentionUntil: string;
  readonly sanitizedPayload: unknown;
};

export function DataExplorer() {
  const [provider, setProvider] = useState('');
  const [securityId, setSecurityId] = useState('');
  const [rows, setRows] = useState<readonly PayloadRow[]>([]);
  const [restricted, setRestricted] = useState<{ rightsBlocked: number; retentionExpired: number } | null>(null);
  const [status, setStatus] = useState<'idle' | 'pending' | 'error'>('idle');

  async function onSearch() {
    setStatus('pending');
    try {
      const params = new URLSearchParams();
      if (provider.trim() !== '') params.set('provider', provider.trim());
      if (securityId.trim() !== '') params.set('securityId', securityId.trim());
      const response = await fetch(`/api/admin/data?${params.toString()}`);
      const body = (await response.json()) as { rows: PayloadRow[]; restricted: { rightsBlocked: number; retentionExpired: number } };
      setRows(body.rows);
      setRestricted(body.restricted);
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div data-data-explorer="" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Provider (e.g. reddit)"
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
          data-data-explorer-provider=""
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
        />
        <input
          type="text"
          placeholder="Security id"
          value={securityId}
          onChange={(event) => setSecurityId(event.target.value)}
          data-data-explorer-security=""
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={onSearch}
          disabled={status === 'pending'}
          data-data-explorer-search=""
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium"
        >
          Search (audited)
        </button>
      </div>

      {restricted !== null && (restricted.rightsBlocked > 0 || restricted.retentionExpired > 0) ? (
        <p className="text-xs text-amber-700" data-data-explorer-restricted="">
          Withheld: {restricted.rightsBlocked} rights-restricted, {restricted.retentionExpired} retention-expired.
        </p>
      ) : null}

      {status === 'error' ? <p className="text-sm text-red-700">The search request failed.</p> : null}

      {rows.length === 0 ? (
        <p className="text-sm text-neutral-600" data-data-explorer-empty="">
          No payloads match this query, or search has not run yet.
        </p>
      ) : (
        <table className="w-full text-left text-sm" data-data-explorer-table="">
          <thead>
            <tr className="border-b border-neutral-300 text-xs uppercase text-neutral-500">
              <th className="p-2">Provider</th>
              <th className="p-2">Operation</th>
              <th className="p-2">Content class</th>
              <th className="p-2">Redaction</th>
              <th className="p-2">Ingested</th>
              <th className="p-2">Retention until</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-neutral-100" data-data-explorer-row={row.id}>
                <td className="p-2">{row.provider}</td>
                <td className="p-2">{row.operation}</td>
                <td className="p-2">{row.contentClass}</td>
                <td className="p-2">{row.redactionStatus}</td>
                <td className="p-2 font-mono text-xs">{row.ingestedAt}</td>
                <td className="p-2 font-mono text-xs">{row.retentionUntil}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
