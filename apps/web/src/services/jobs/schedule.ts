/**
 * Computing a `job_definition`'s next `next_due_at` (F16 §4.1 step 6). Pure — no I/O, no
 * decimals (this is wall-clock arithmetic over instants and integers, not analytics), so
 * `calc/`'s decimal discipline does not apply here and a plain `Date`/`number` is correct.
 *
 * Two `schedule_type`s (migration `0007`'s check constraint):
 * - `'interval'`: `schedule_expression` is a plain integer count of seconds. `next = from + n`.
 * - `'cron'`: `schedule_expression` is a five/six-field cron string, evaluated against
 *   `display_timezone` via `cron-parser`'s `CronExpressionParser`, which is IANA-timezone-aware —
 *   the property the DST test case in F16 §5's test plan needs ("due-time selection across DST
 *   boundaries (schedules are UTC)"). `next()` returns the first occurrence strictly *after*
 *   `currentDate`, which is exactly "the next due instant after this one fired."
 */
import { CronExpressionParser } from 'cron-parser';
import type { JobDefinition } from '@/contracts/operations';

export class InvalidScheduleError extends Error {
  constructor(
    readonly job: Pick<JobDefinition, 'jobKey' | 'scheduleType' | 'scheduleExpression'>,
    message: string,
  ) {
    super(`job '${job.jobKey}' (${job.scheduleType} '${job.scheduleExpression}'): ${message}`);
    this.name = 'InvalidScheduleError';
  }
}

/** The next due instant strictly after `from` — never `from` itself, even for an interval of 0. */
export function computeNextDueAt(job: JobDefinition, from: Date): Date {
  if (job.scheduleType === 'interval') {
    const seconds = Number.parseInt(job.scheduleExpression, 10);
    if (!Number.isFinite(seconds) || seconds <= 0 || String(seconds) !== job.scheduleExpression.trim()) {
      throw new InvalidScheduleError(
        job,
        `'${job.scheduleExpression}' is not a positive integer count of seconds`,
      );
    }
    return new Date(from.getTime() + seconds * 1000);
  }

  try {
    const parsed = CronExpressionParser.parse(job.scheduleExpression, {
      tz: job.displayTimezone,
      currentDate: from,
    });
    return parsed.next().toDate();
  } catch (error) {
    throw new InvalidScheduleError(
      job,
      `cron expression could not be evaluated for tz '${job.displayTimezone}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
