'use client';

/**
 * F16 §4.2/§4.4 (F16b) — the job-editing table. Editable per row: due time (override), cadence
 * (schedule type + expression + timezone, edited together), enabled state, retry policy (max
 * attempts + backoff policy JSON), per-job budget ceiling. Nothing here can edit the QStash
 * schedule, `vercel.json`, or the dispatch secret (ADR-013) — there is no field for any of them.
 *
 * "Preview" (§4.4) computes the would-be next run without saving anything — a pure read against
 * `/api/admin/jobs/[jobId]/preview`. "Save" submits the edit through the uniform mutation
 * pipeline (`/api/admin/jobs/update`) and, on a version conflict (e.g. a dispatcher tick advanced
 * this same row's schedule between load and save), surfaces the conflict rather than overwriting
 * it silently. "Dry run" (§4.4) reports what the job *would* call and cost without calling
 * anything (`/api/admin/jobs/[jobId]/dry-run`).
 */
import { useState } from 'react';

export type JobRow = {
  readonly id: string;
  readonly jobKey: string;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly scheduleType: 'interval' | 'cron';
  readonly scheduleExpression: string;
  readonly displayTimezone: string;
  readonly maxAttempts: number;
  readonly backoffPolicy: unknown;
  readonly maxCostUsdPerRun: string | null;
  readonly nextDueAt: string;
  readonly version: number;
};

type EditState = {
  readonly nextDueAt: string;
  readonly scheduleType: 'interval' | 'cron';
  readonly scheduleExpression: string;
  readonly displayTimezone: string;
  readonly enabled: boolean;
  readonly maxAttempts: string;
  readonly backoffPolicy: string;
  readonly maxCostUsdPerRun: string;
  readonly reason: string;
};

type RowStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'ok' }
  | { readonly kind: 'conflict'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string };

function editStateFor(job: JobRow): EditState {
  return {
    nextDueAt: '',
    scheduleType: job.scheduleType,
    scheduleExpression: job.scheduleExpression,
    displayTimezone: job.displayTimezone,
    enabled: job.enabled,
    maxAttempts: String(job.maxAttempts),
    backoffPolicy: JSON.stringify(job.backoffPolicy ?? {}),
    maxCostUsdPerRun: job.maxCostUsdPerRun ?? '',
    reason: '',
  };
}

export function JobsTable({ initialJobs }: { readonly initialJobs: readonly JobRow[] }) {
  const [jobs, setJobs] = useState(initialJobs);
  const [edits, setEdits] = useState<Record<string, EditState>>(
    Object.fromEntries(initialJobs.map((job) => [job.id, editStateFor(job)])),
  );
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [statuses, setStatuses] = useState<Record<string, RowStatus>>({});
  const [dryRunResults, setDryRunResults] = useState<Record<string, string>>({});

  function edit(jobId: string): EditState {
    const job = jobs.find((j) => j.id === jobId);
    return edits[jobId] ?? (job === undefined ? editStateFor(jobs[0] as JobRow) : editStateFor(job));
  }
  function setEdit(jobId: string, patch: Partial<EditState>) {
    setEdits((prev) => ({ ...prev, [jobId]: { ...edit(jobId), ...patch } }));
  }

  async function onPreview(job: JobRow) {
    const e = edit(job.id);
    const body: Record<string, string> = {};
    if (e.nextDueAt.trim().length > 0) body['nextDueAt'] = new Date(e.nextDueAt).toISOString();
    if (e.scheduleType !== job.scheduleType || e.scheduleExpression !== job.scheduleExpression) {
      body['scheduleType'] = e.scheduleType;
      body['scheduleExpression'] = e.scheduleExpression;
    }
    if (e.displayTimezone !== job.displayTimezone) body['displayTimezone'] = e.displayTimezone;

    try {
      const response = await fetch(`/api/admin/jobs/${job.id}/preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as
        | { status: 'ok'; nextDueAt: string }
        | { status: 'invalid'; issues: unknown }
        | { status: 'not_found' };
      if (result.status === 'ok') {
        setPreviews((prev) => ({ ...prev, [job.id]: result.nextDueAt }));
      } else {
        setPreviews((prev) => ({ ...prev, [job.id]: `error: ${JSON.stringify(result)}` }));
      }
    } catch {
      setPreviews((prev) => ({ ...prev, [job.id]: 'Preview request failed.' }));
    }
  }

  async function onSave(job: JobRow) {
    const e = edit(job.id);
    setStatuses((prev) => ({ ...prev, [job.id]: { kind: 'pending' } }));

    const body: Record<string, unknown> = {
      reason: e.reason,
      expectedVersion: String(job.version),
      jobId: job.id,
    };
    if (e.nextDueAt.trim().length > 0) body['nextDueAt'] = new Date(e.nextDueAt).toISOString();
    if (e.scheduleType !== job.scheduleType || e.scheduleExpression !== job.scheduleExpression) {
      body['scheduleType'] = e.scheduleType;
      body['scheduleExpression'] = e.scheduleExpression;
    }
    if (e.displayTimezone !== job.displayTimezone) body['displayTimezone'] = e.displayTimezone;
    if (e.enabled !== job.enabled) body['enabled'] = e.enabled;
    if (e.maxAttempts !== String(job.maxAttempts)) body['maxAttempts'] = Number(e.maxAttempts);
    if (e.maxCostUsdPerRun !== (job.maxCostUsdPerRun ?? '')) {
      body['maxCostUsdPerRun'] = e.maxCostUsdPerRun.trim().length > 0 ? e.maxCostUsdPerRun.trim() : null;
    }
    const currentBackoff = JSON.stringify(job.backoffPolicy ?? {});
    if (e.backoffPolicy !== currentBackoff) {
      try {
        body['backoffPolicy'] = JSON.parse(e.backoffPolicy);
      } catch {
        setStatuses((prev) => ({ ...prev, [job.id]: { kind: 'error', message: 'backoffPolicy must be valid JSON' } }));
        return;
      }
    }

    try {
      const response = await fetch('/api/admin/jobs/update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as
        | { status: 'ok'; objectId: string }
        | { status: 'conflict'; message: string }
        | { status: 'invalid'; issues: unknown };

      if (result.status === 'ok') {
        setStatuses((prev) => ({ ...prev, [job.id]: { kind: 'ok' } }));
        // Re-fetch the row list rather than reconstruct it client-side — `version` and
        // `next_due_at` both moved server-side and the mutation response doesn't echo the full
        // row shape this table needs.
        const refreshed = await fetch('/api/admin/jobs');
        const refreshedBody = (await refreshed.json()) as { jobs?: unknown };
        if (Array.isArray(refreshedBody.jobs)) {
          const nextJobs = refreshedBody.jobs as JobRow[];
          setJobs(nextJobs);
          const updated = nextJobs.find((j) => j.id === job.id);
          if (updated !== undefined) setEdits((prev) => ({ ...prev, [job.id]: editStateFor(updated) }));
        }
      } else if (result.status === 'conflict') {
        setStatuses((prev) => ({ ...prev, [job.id]: { kind: 'conflict', message: result.message } }));
      } else {
        setStatuses((prev) => ({ ...prev, [job.id]: { kind: 'error', message: JSON.stringify(result.issues) } }));
      }
    } catch {
      setStatuses((prev) => ({ ...prev, [job.id]: { kind: 'error', message: 'Request failed.' } }));
    }
  }

  async function onDryRun(job: JobRow) {
    const e = edit(job.id);
    try {
      const response = await fetch(`/api/admin/jobs/${job.id}/dry-run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: e.reason.trim().length > 0 ? e.reason : 'admin dry run' }),
      });
      const result = (await response.json()) as
        | { status: 'ok'; run: { status: string; providerCalls: number; estimatedCostUsd: string } }
        | { status: 'not_found' | 'invalid' };
      if (result.status === 'ok') {
        setDryRunResults((prev) => ({
          ...prev,
          [job.id]:
            `status=${result.run.status} providerCalls=${result.run.providerCalls} ` +
            `estimatedCostUsd=${result.run.estimatedCostUsd} (zero external calls made)`,
        }));
      } else {
        setDryRunResults((prev) => ({ ...prev, [job.id]: `error: ${result.status}` }));
      }
    } catch {
      setDryRunResults((prev) => ({ ...prev, [job.id]: 'Dry run request failed.' }));
    }
  }

  if (jobs.length === 0) {
    return (
      <p className="text-sm text-neutral-600" data-jobs-empty="">
        No job rows exist yet (no `config_version` has ever been activated to seed them — see
        the F16a dispatch-core report).
      </p>
    );
  }

  return (
    <div className="space-y-4" data-jobs-table="">
      {jobs.map((job) => {
        const e = edit(job.id);
        const status = statuses[job.id] ?? { kind: 'idle' };
        return (
          <div key={job.id} className="rounded border border-neutral-300 p-4" data-job-row={job.id}>
            <div className="flex items-baseline justify-between">
              <h3 className="font-medium">{job.displayName}</h3>
              <span className="font-mono text-xs text-neutral-500">{job.jobKey}</span>
            </div>
            <p className="mt-1 text-xs text-neutral-600" data-job-current-next-due={job.id}>
              Next run: {job.nextDueAt} (version {job.version})
            </p>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="text-xs text-neutral-600">
                Due time override
                <input
                  type="datetime-local"
                  value={e.nextDueAt}
                  onChange={(event) => setEdit(job.id, { nextDueAt: event.target.value })}
                  data-job-next-due-input={job.id}
                  className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="text-xs text-neutral-600">
                Schedule type
                <select
                  value={e.scheduleType}
                  onChange={(event) => setEdit(job.id, { scheduleType: event.target.value as 'interval' | 'cron' })}
                  data-job-schedule-type={job.id}
                  className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                >
                  <option value="interval">interval (seconds)</option>
                  <option value="cron">cron</option>
                </select>
              </label>
              <label className="text-xs text-neutral-600">
                Schedule expression
                <input
                  type="text"
                  value={e.scheduleExpression}
                  onChange={(event) => setEdit(job.id, { scheduleExpression: event.target.value })}
                  data-job-schedule-expression={job.id}
                  className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="text-xs text-neutral-600">
                Timezone
                <input
                  type="text"
                  value={e.displayTimezone}
                  onChange={(event) => setEdit(job.id, { displayTimezone: event.target.value })}
                  data-job-timezone={job.id}
                  className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-neutral-600">
                <input
                  type="checkbox"
                  checked={e.enabled}
                  onChange={(event) => setEdit(job.id, { enabled: event.target.checked })}
                  data-job-enabled={job.id}
                />
                Enabled
              </label>
              <label className="text-xs text-neutral-600">
                Max attempts
                <input
                  type="number"
                  min={1}
                  value={e.maxAttempts}
                  onChange={(event) => setEdit(job.id, { maxAttempts: event.target.value })}
                  data-job-max-attempts={job.id}
                  className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="text-xs text-neutral-600">
                Budget ceiling (USD/run, blank = none)
                <input
                  type="text"
                  value={e.maxCostUsdPerRun}
                  onChange={(event) => setEdit(job.id, { maxCostUsdPerRun: event.target.value })}
                  data-job-budget={job.id}
                  className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="text-xs text-neutral-600 sm:col-span-2">
                Backoff policy (JSON)
                <input
                  type="text"
                  value={e.backoffPolicy}
                  onChange={(event) => setEdit(job.id, { backoffPolicy: event.target.value })}
                  data-job-backoff-policy={job.id}
                  className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 text-sm font-mono"
                />
              </label>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder="Change reason"
                value={e.reason}
                onChange={(event) => setEdit(job.id, { reason: event.target.value })}
                data-job-reason={job.id}
                className="rounded border border-neutral-300 px-2 py-1 text-sm"
              />
              <button
                type="button"
                onClick={() => onPreview(job)}
                data-job-preview-button={job.id}
                className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium"
              >
                Preview next run
              </button>
              <button
                type="button"
                onClick={() => onSave(job)}
                disabled={e.reason.trim().length < 3 || status.kind === 'pending'}
                data-job-save={job.id}
                className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => onDryRun(job)}
                data-job-dry-run={job.id}
                className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium"
              >
                Dry run
              </button>
            </div>

            {previews[job.id] !== undefined ? (
              <p className="mt-1 text-xs text-neutral-700" data-job-preview-value={job.id}>
                Preview: {previews[job.id]}
              </p>
            ) : null}
            {status.kind === 'ok' ? <p className="mt-1 text-xs text-green-700">Saved.</p> : null}
            {status.kind === 'conflict' ? (
              <p className="mt-1 text-xs text-red-700" data-job-conflict={job.id}>
                Conflict: {status.message}
              </p>
            ) : null}
            {status.kind === 'error' ? <p className="mt-1 text-xs text-red-700">{status.message}</p> : null}
            {dryRunResults[job.id] !== undefined ? (
              <p className="mt-1 text-xs text-neutral-700" data-job-dry-run-result={job.id}>
                {dryRunResults[job.id]}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
