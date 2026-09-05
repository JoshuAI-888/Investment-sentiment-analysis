'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  scheduleSetting,
  scheduleUpdateBody,
  scheduleUpdateResult,
  type ScheduleSetting,
} from '@/rni/settings/schedule/schemas';

export function ScheduleSettingsLiveHarness({
  initialSetting,
}: {
  initialSetting: ScheduleSetting;
}) {
  const [setting, setSetting] = useState(initialSetting);
  const [enabled, setEnabled] = useState(initialSetting.enabled);
  const [kind, setKind] = useState(initialSetting.scheduleType);
  const [expression, setExpression] = useState(initialSetting.scheduleExpression);
  const [timezone, setTimezone] = useState(initialSetting.displayTimezone);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [userTimezone, setUserTimezone] = useState<string | null>(null);
  const inFlight = useRef(false);
  const attempt = useRef<{ intent: string; key: string } | null>(null);
  useEffect(() => {
    setUserTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  function applySetting(next: ScheduleSetting) {
    setSetting(next);
    setEnabled(next.enabled);
    setKind(next.scheduleType);
    setExpression(next.scheduleExpression);
    setTimezone(next.displayTimezone);
  }

  async function reload() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/rni/schedules', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('unavailable');
      const payload: unknown = await response.json();
      const next = scheduleSetting.parse((payload as { data?: unknown }).data);
      if (next.jobId !== setting.jobId) throw new Error('crossed schedule');
      applySetting(next);
      setConflict(false);
      attempt.current = null;
      setMessage('Latest schedule loaded. Review your change before saving.');
    } catch {
      setError('The latest schedule could not be loaded. Try again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || conflict) return;
    const parsed = scheduleUpdateBody.safeParse({
      expectedVersion: setting.version,
      enabled,
      scheduleType: kind,
      scheduleExpression: expression,
      displayTimezone: timezone,
      reason,
    });
    if (!parsed.success) {
      setError('Provide a cadence, timezone and change reason.');
      return;
    }
    const intent = JSON.stringify(parsed.data);
    if (attempt.current?.intent !== intent) attempt.current = { intent, key: crypto.randomUUID() };
    const key = attempt.current.key;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/rni/schedules', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: intent,
      });
      if (response.status === 409) {
        setConflict(true);
        setError(
          'The schedule changed or this key belongs to another change. Reload the latest schedule before editing.',
        );
        return;
      }
      if (!response.ok) {
        setError(
          response.status === 400
            ? 'Use an interval from 300 to 31536000 seconds, or a valid five-field cron with preview runs at least five minutes apart, and a valid timezone.'
            : 'The schedule could not be saved. Retry the same change safely.',
        );
        return;
      }
      const payload: unknown = await response.json();
      const saved = scheduleUpdateResult.parse((payload as { data?: unknown }).data);
      if (
        saved.idempotencyKey !== key ||
        saved.setting.jobId !== setting.jobId ||
        saved.setting.version !== parsed.data.expectedVersion + 1 ||
        saved.setting.enabled !== parsed.data.enabled ||
        saved.setting.scheduleType !== parsed.data.scheduleType ||
        saved.setting.scheduleExpression !== parsed.data.scheduleExpression ||
        saved.setting.displayTimezone !== parsed.data.displayTimezone
      )
        throw new Error('crossed response');
      applySetting(saved.setting);
      attempt.current = null;
      setReason('');
      setMessage(
        saved.disposition === 'duplicate'
          ? 'This change was already saved. Reload to see any later schedule updates.'
          : 'Schedule saved. Existing runs are unchanged.',
      );
    } catch {
      setError('The schedule could not be saved. Retry the same change safely.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8" data-state="ready">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Refresh schedule</h1>
        <p>
          One bounded full-universe refresh, with independent Reddit and X processing. Changes
          affect future schedule fires only.
        </p>
        <p>
          Version {setting.version} · {setting.enabled ? 'Active' : 'Paused'} · Updated by{' '}
          {setting.updatedBy}
        </p>
      </header>
      <form onSubmit={submit} className="space-y-4">
        <fieldset disabled={busy || conflict} className="space-y-4">
          <legend className="font-semibold">Cadence and timezone</legend>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Enable scheduled refreshes
          </label>
          <label className="block">
            Cadence type
            <select
              className="mt-1 block w-full rounded border p-2"
              value={kind}
              onChange={(e) => setKind(e.target.value as 'interval' | 'cron')}
            >
              <option value="interval">Interval (elapsed seconds)</option>
              <option value="cron">Five-field cron (local clock)</option>
            </select>
          </label>
          <label className="block">
            {kind === 'interval' ? 'Interval seconds' : 'Cron expression'}
            <input
              className="mt-1 block w-full rounded border p-2"
              required
              maxLength={200}
              value={expression}
              onChange={(e) => setExpression(e.target.value)}
              aria-describedby="cadence-help"
            />
          </label>
          <p id="cadence-help">
            Intervals: 300–31536000 seconds. Cron previews must be at least five minutes apart. Cron
            uses the selected timezone; intervals use elapsed time.
          </p>
          <label className="block">
            IANA timezone
            <input
              className="mt-1 block w-full rounded border p-2"
              required
              maxLength={100}
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="Pacific/Auckland"
            />
          </label>
          <label className="block">
            Change reason
            <textarea
              className="mt-1 block w-full rounded border p-2"
              required
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button
            className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
            type="submit"
          >
            {busy ? 'Saving…' : 'Save schedule'}
          </button>
        </fieldset>
      </form>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <button
        type="button"
        disabled={busy}
        className="rounded border px-4 py-2"
        onClick={() => void reload()}
      >
        Reload latest schedule
      </button>
      <section className="space-y-2" aria-labelledby="schedule-preview">
        <h2 id="schedule-preview" className="text-xl font-semibold">
          Saved schedule: next five times
        </h2>
        {!setting.enabled && (
          <p>Paused. These are projections only; no scheduled work will start.</p>
        )}
        {setting.enabled && Date.parse(setting.nextDueAt) <= Date.parse(setting.observedAt) && (
          <p>
            The next fire is overdue. A heartbeat performs at most one bounded fire and advances
            forward; missed periods are not backfilled.
          </p>
        )}
        <p>
          Saving or resuming recalculates the next fire forward from the save time. A busy job is
          skipped and advanced atomically. Actual execution also depends on the heartbeat and budget
          availability.
        </p>
        <ol className="space-y-3">
          {setting.nextRuns.map((run) => (
            <li key={run.dueAt} className="rounded border p-3 break-words">
              <p>
                {run.localTime} ({run.timezone})
              </p>
              <p>
                <time dateTime={run.dueAt}>{run.dueAt}</time> UTC
              </p>
              {userTimezone && (
                <p>
                  Your timezone:{' '}
                  {new Intl.DateTimeFormat('en-GB', {
                    timeZone: userTimezone,
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(run.dueAt))}{' '}
                  ({userTimezone})
                </p>
              )}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
