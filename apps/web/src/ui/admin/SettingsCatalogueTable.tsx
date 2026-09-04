'use client';

/** F15 §4.2 — the typed settings catalogue, edited one key at a time through the uniform pipeline. */
import { useState } from 'react';

type CatalogueRow = {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly valueType: string;
  readonly governanceClass: string;
  readonly value: unknown;
  readonly isDefault: boolean;
};

export type SettingsCatalogueTableProps = {
  readonly initialCatalogue: readonly CatalogueRow[];
  readonly activeConfigVersion: string | null;
};

type RowStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'ok' }
  | { readonly kind: 'conflict'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string };

export function SettingsCatalogueTable({ initialCatalogue, activeConfigVersion }: SettingsCatalogueTableProps) {
  const [catalogue, setCatalogue] = useState(initialCatalogue);
  const [drafts, setDrafts] = useState<Record<string, string>>(
    Object.fromEntries(initialCatalogue.map((entry) => [entry.key, String(entry.value)])),
  );
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [statuses, setStatuses] = useState<Record<string, RowStatus>>({});

  async function onSave(key: string, valueType: string) {
    setStatuses((prev) => ({ ...prev, [key]: { kind: 'pending' } }));
    const raw = drafts[key] ?? '';
    const value = valueType === 'integer' ? Number(raw) : raw;
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reason: reasons[key] ?? '',
          expectedVersion: activeConfigVersion,
          key,
          value,
        }),
      });
      const body = (await response.json()) as
        | { status: 'ok' }
        | { status: 'conflict'; message: string }
        | { status: 'invalid'; issues: unknown };

      if (body.status === 'ok') {
        setStatuses((prev) => ({ ...prev, [key]: { kind: 'ok' } }));
        setCatalogue((prev) => prev.map((entry) => (entry.key === key ? { ...entry, value, isDefault: false } : entry)));
      } else if (body.status === 'conflict') {
        setStatuses((prev) => ({ ...prev, [key]: { kind: 'conflict', message: body.message } }));
      } else {
        setStatuses((prev) => ({ ...prev, [key]: { kind: 'error', message: JSON.stringify(body.issues) } }));
      }
    } catch {
      setStatuses((prev) => ({ ...prev, [key]: { kind: 'error', message: 'Request failed.' } }));
    }
  }

  return (
    <div className="space-y-4" data-settings-catalogue="">
      {catalogue.map((entry) => {
        const status = statuses[entry.key] ?? { kind: 'idle' };
        return (
          <div key={entry.key} className="rounded border border-neutral-300 p-4" data-setting-row={entry.key}>
            <div className="flex items-baseline justify-between">
              <h3 className="font-medium">{entry.label}</h3>
              <span className="text-xs uppercase text-neutral-500">{entry.governanceClass}</span>
            </div>
            <p className="mt-1 text-xs text-neutral-600">{entry.description}</p>
            <p className="mt-1 text-xs text-neutral-500">
              Current: <span className="font-mono">{String(entry.value)}</span>
              {entry.isDefault ? ' (catalogue default — never activated)' : ''}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={drafts[entry.key] ?? ''}
                onChange={(event) => setDrafts((prev) => ({ ...prev, [entry.key]: event.target.value }))}
                data-setting-value-input={entry.key}
                className="rounded border border-neutral-300 px-2 py-1 text-sm"
              />
              <input
                type="text"
                placeholder="Change reason"
                value={reasons[entry.key] ?? ''}
                onChange={(event) => setReasons((prev) => ({ ...prev, [entry.key]: event.target.value }))}
                data-setting-reason-input={entry.key}
                className="rounded border border-neutral-300 px-2 py-1 text-sm"
              />
              <button
                type="button"
                onClick={() => onSave(entry.key, entry.valueType)}
                disabled={(reasons[entry.key] ?? '').trim().length < 3 || status.kind === 'pending'}
                data-setting-save={entry.key}
                className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save (versions & activates)
              </button>
            </div>
            {status.kind === 'ok' ? <p className="mt-1 text-xs text-green-700">Activated as a new config version.</p> : null}
            {status.kind === 'conflict' ? (
              <p className="mt-1 text-xs text-red-700" data-setting-conflict={entry.key}>
                Conflict: {status.message}
              </p>
            ) : null}
            {status.kind === 'error' ? <p className="mt-1 text-xs text-red-700">{status.message}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
