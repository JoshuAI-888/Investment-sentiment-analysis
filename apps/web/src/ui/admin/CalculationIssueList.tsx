'use client';

/** F15 §4.6 — resolution never mutates the original calculation; it names a successor. */
import { useState } from 'react';

type Issue = {
  readonly id: string;
  readonly calculationId: string;
  readonly issueType: string;
  readonly description: string;
  readonly status: string;
  readonly updatedAt: string;
};

export function CalculationIssueList({ initialIssues }: { readonly initialIssues: readonly Issue[] }) {
  const [issues, setIssues] = useState(initialIssues);
  const [forms, setForms] = useState<Record<string, { reason: string; resolutionSummary: string; resolutionCalculationId: string; status: 'resolved' | 'rejected' }>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});

  function formFor(id: string) {
    return forms[id] ?? { reason: '', resolutionSummary: '', resolutionCalculationId: '', status: 'resolved' as const };
  }

  async function onResolve(issue: Issue) {
    const form = formFor(issue.id);
    try {
      const response = await fetch('/api/admin/calculation-issues/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reason: form.reason,
          expectedVersion: issue.updatedAt,
          issueId: issue.id,
          status: form.status,
          resolutionSummary: form.resolutionSummary,
          resolutionCalculationId: form.status === 'resolved' ? form.resolutionCalculationId || null : null,
        }),
      });
      const body = (await response.json()) as
        | { status: 'ok' }
        | { status: 'conflict'; message: string }
        | { status: 'invalid'; issues: unknown };

      if (body.status === 'ok') {
        setIssues((prev) => prev.filter((i) => i.id !== issue.id));
        setMessages((prev) => ({ ...prev, [issue.id]: 'Resolved.' }));
      } else if (body.status === 'conflict') {
        setMessages((prev) => ({ ...prev, [issue.id]: `Conflict: ${body.message}` }));
      } else {
        setMessages((prev) => ({ ...prev, [issue.id]: `Rejected: ${JSON.stringify(body.issues)}` }));
      }
    } catch {
      setMessages((prev) => ({ ...prev, [issue.id]: 'Request failed.' }));
    }
  }

  if (issues.length === 0) {
    return (
      <p className="text-sm text-neutral-600" data-issues-empty="">
        No open calculation issues.
      </p>
    );
  }

  return (
    <div className="space-y-4" data-calculation-issue-list="">
      {issues.map((issue) => {
        const form = formFor(issue.id);
        return (
          <div key={issue.id} className="rounded border border-neutral-300 p-4" data-issue-row={issue.id}>
            <p className="text-sm font-medium">{issue.issueType}</p>
            <p className="text-sm text-neutral-700">{issue.description}</p>
            <p className="mt-1 text-xs text-neutral-500">Calculation: {issue.calculationId}</p>

            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <select
                value={form.status}
                onChange={(event) =>
                  setForms((prev) => ({ ...prev, [issue.id]: { ...form, status: event.target.value as 'resolved' | 'rejected' } }))
                }
                data-issue-status={issue.id}
                className="rounded border border-neutral-300 px-2 py-1 text-sm"
              >
                <option value="resolved">Resolved</option>
                <option value="rejected">Rejected</option>
              </select>
              <input
                type="text"
                placeholder="Change reason"
                value={form.reason}
                onChange={(event) => setForms((prev) => ({ ...prev, [issue.id]: { ...form, reason: event.target.value } }))}
                data-issue-reason={issue.id}
                className="rounded border border-neutral-300 px-2 py-1 text-sm"
              />
              <input
                type="text"
                placeholder="Resolution summary"
                value={form.resolutionSummary}
                onChange={(event) =>
                  setForms((prev) => ({ ...prev, [issue.id]: { ...form, resolutionSummary: event.target.value } }))
                }
                data-issue-summary={issue.id}
                className="rounded border border-neutral-300 px-2 py-1 text-sm"
              />
              {form.status === 'resolved' ? (
                <input
                  type="text"
                  placeholder="Resolution calculation id (a different, already-computed calculation)"
                  value={form.resolutionCalculationId}
                  onChange={(event) =>
                    setForms((prev) => ({ ...prev, [issue.id]: { ...form, resolutionCalculationId: event.target.value } }))
                  }
                  data-issue-resolution-calc={issue.id}
                  className="rounded border border-neutral-300 px-2 py-1 text-sm"
                />
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => onResolve(issue)}
              disabled={form.reason.trim().length < 3 || form.resolutionSummary.trim().length < 3}
              data-issue-resolve-button={issue.id}
              className="mt-2 rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              Submit
            </button>
            {messages[issue.id] !== undefined ? <p className="mt-1 text-xs">{messages[issue.id]}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
