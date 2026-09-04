'use client';

import { useState, useTransition } from 'react';
import { deleteAccountAction, exportAccountAction, signOutAction } from './actions';

export function AccountPanel({ email }: { readonly email: string }) {
  const [confirming, setConfirming] = useState(false);
  const [exportJson, setExportJson] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="mt-6 space-y-6">
      <p className="text-sm text-neutral-700">
        Signed in as <span className="font-mono">{email}</span>.
      </p>

      <div className="space-x-3">
        <button
          type="button"
          onClick={() => startTransition(() => void signOutAction())}
          className="rounded border border-neutral-300 px-3 py-2 text-sm"
        >
          Sign out
        </button>
        <button
          type="button"
          onClick={() =>
            startTransition(async () => {
              const result = await exportAccountAction();
              setExportJson('json' in result ? result.json : `error: ${result.error}`);
            })
          }
          className="rounded border border-neutral-300 px-3 py-2 text-sm"
        >
          Export my data
        </button>
      </div>

      {exportJson === null ? null : (
        <pre className="max-h-64 overflow-auto rounded border border-neutral-200 bg-neutral-50 p-3 text-xs">
          {exportJson}
        </pre>
      )}

      <div className="border-t border-neutral-200 pt-6">
        <h2 className="text-sm font-semibold text-red-700">Delete account</h2>
        <p className="mt-1 text-xs text-neutral-600">
          This removes your account and every session. It cannot be undone from this page.
        </p>
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="mt-3 rounded border border-red-300 px-3 py-2 text-sm text-red-700"
          >
            Delete my account
          </button>
        ) : (
          <div className="mt-3 space-x-3">
            <button
              type="button"
              disabled={pending}
              onClick={() => startTransition(() => void deleteAccountAction())}
              className="rounded bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              Confirm delete
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded border border-neutral-300 px-3 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
