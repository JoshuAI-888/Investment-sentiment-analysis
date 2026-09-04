/**
 * F16 §4.4 — "Next-run preview is shown per job in the admin UI." This module decides *what
 * instant to preview from*, given a candidate edit; the actual cron/interval arithmetic — DST
 * included — stays exactly where F16a built it (`services/jobs/schedule.ts#computeNextDueAt`),
 * imported and reused here rather than reimplemented. Read-only import: nothing in
 * `services/jobs/` is edited by this feature (F16b's brief — Wave 1's dispatch-core internals are
 * F16a's).
 */
import { computeNextDueAt } from '@/services/jobs/schedule';
import type { JobDefinition } from '@/contracts/operations';

export type ScheduleEditCandidate = {
  readonly nextDueAt?: Date | undefined;
  readonly scheduleType?: JobDefinition['scheduleType'] | undefined;
  readonly scheduleExpression?: string | undefined;
  readonly displayTimezone?: string | undefined;
};

/**
 * `current` is the job's row as it exists today; `edit` is what the admin is proposing (any
 * subset of the three schedule-shaping fields, or none at all — a preview of an edit that only
 * touches, say, `enabled` or the budget ceiling correctly reports the schedule as unchanged).
 *
 * Three cases, in priority order:
 *  1. An explicit `nextDueAt` override **is** the preview — the admin is directly stating when
 *     this job next runs, not asking what a cadence would produce.
 *  2. A cadence edit (any of `scheduleType`/`scheduleExpression`/`displayTimezone` present) is
 *     previewed **from `now`, not from the job's stale `next_due_at`** — a cadence swap
 *     invalidates the old due instant's meaning (it was computed under the *previous* cadence);
 *     "when would this next run, starting now" is the honest question to answer.
 *  3. No schedule-shaping field touched — the preview is simply the job's current `next_due_at`,
 *     unchanged.
 */
export function previewNextDueAt(current: JobDefinition, edit: ScheduleEditCandidate, now: Date): Date {
  if (edit.nextDueAt !== undefined) return edit.nextDueAt;

  const cadenceChanged =
    edit.scheduleType !== undefined || edit.scheduleExpression !== undefined || edit.displayTimezone !== undefined;
  if (!cadenceChanged) return current.nextDueAt;

  const candidate: JobDefinition = {
    ...current,
    scheduleType: edit.scheduleType ?? current.scheduleType,
    scheduleExpression: edit.scheduleExpression ?? current.scheduleExpression,
    displayTimezone: edit.displayTimezone ?? current.displayTimezone,
  };
  return computeNextDueAt(candidate, now);
}

/** `true` when `edit` touches any of the three schedule-shaping fields (used by the mutation's own `write` to decide whether to move `next_due_at` at all — an edit that only changes `enabled` or the budget ceiling must not silently nudge the schedule). */
export function cadenceOrDueTimeChanged(edit: ScheduleEditCandidate): boolean {
  return (
    edit.nextDueAt !== undefined ||
    edit.scheduleType !== undefined ||
    edit.scheduleExpression !== undefined ||
    edit.displayTimezone !== undefined
  );
}
