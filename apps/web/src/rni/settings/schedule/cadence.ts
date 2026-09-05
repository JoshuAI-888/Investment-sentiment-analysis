import { previewRniSchedule } from '@/rni/orchestration/schedules';
import { RniScheduleSettingsError } from './errors';
import { scheduleCadence, type ScheduleCadence } from './schemas';

/** Uses the execution path's timezone/DST rules, never a separate UI cron interpretation. */
export function validateScheduleCadence(raw: ScheduleCadence, after: Date) {
  try {
    const cadence = scheduleCadence.parse(raw);
    // Modern Intl also accepts numeric UTC offsets, which are not IANA timezone identities.
    if (/^[+-]/u.test(cadence.displayTimezone)) throw new Error('timezone');
    if (cadence.scheduleType === 'interval') {
      if (!/^[1-9]\d*$/u.test(cadence.scheduleExpression)) throw new Error('interval');
      const seconds = Number(cadence.scheduleExpression);
      if (!Number.isSafeInteger(seconds) || seconds < 300 || seconds > 31_536_000)
        throw new Error('interval');
    }
    // Intl rejects unknown IANA zones; preview also validates the bounded five-field cron.
    const next = previewRniSchedule(cadence, after, 5);
    if (
      next.some(
        (fire, i) => i > 0 && Date.parse(fire.dueAt) - Date.parse(next[i - 1]!.dueAt) < 300_000,
      )
    )
      throw new Error('cadence');
    return next;
  } catch {
    throw new RniScheduleSettingsError('invalid');
  }
}
