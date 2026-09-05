import type { JobDefinition } from '@/contracts/operations';
import { RniOrchestrationError } from './budget';

function cronField(expression: string, min: number, max: number): Set<number> {
  const result = new Set<number>();
  for (const part of expression.split(',')) {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/u.exec(part);
    if (!match) throw new RniOrchestrationError('INVALID_PLAN');
    const step = Number(match[2] ?? 1);
    const range = match[1] === '*' ? [min, max] : match[1]!.split('-').map(Number);
    const start = range[0]!;
    const end = range[1] ?? (match[2] ? max : start);
    if (step < 1 || step > max - min + 1 || start < min || end > max || start > end) {
      throw new RniOrchestrationError('INVALID_PLAN');
    }
    for (let value = start; value <= end; value += step) result.add(value);
  }
  return result;
}

/** UTC instants are the identity: the repeated DST hour produces two different fires. */
export function previewRniSchedule(
  job: Pick<JobDefinition, 'scheduleType' | 'scheduleExpression' | 'displayTimezone'>,
  after: Date,
  count = 5,
): { dueAt: string; localTime: string; timezone: string }[] {
  if (!Number.isFinite(after.getTime()) || !Number.isInteger(count) || count < 1 || count > 5) {
    throw new RniOrchestrationError('INVALID_PLAN');
  }
  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone: job.displayTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const result: { dueAt: string; localTime: string; timezone: string }[] = [];
  const append = (date: Date) =>
    result.push({
      dueAt: date.toISOString(),
      localTime: format.format(date),
      timezone: job.displayTimezone,
    });
  if (job.scheduleType === 'interval') {
    // The existing job contract stores text; I09's interval expression is integer seconds.
    if (!/^[1-9]\d*$/u.test(job.scheduleExpression))
      throw new RniOrchestrationError('INVALID_PLAN');
    const seconds = Number(job.scheduleExpression);
    if (!Number.isSafeInteger(seconds) || seconds > 31_536_000)
      throw new RniOrchestrationError('INVALID_PLAN');
    for (let index = 1; index <= count; index++)
      append(new Date(after.getTime() + index * seconds * 1000));
    return result;
  }
  const fields = job.scheduleExpression.trim().split(/\s+/u);
  if (fields.length !== 5) throw new RniOrchestrationError('INVALID_PLAN');
  const [minute, hour, day, month, weekday] = fields as [string, string, string, string, string];
  const minutes = cronField(minute, 0, 59),
    hours = cronField(hour, 0, 23);
  const days = cronField(day, 1, 31),
    months = cronField(month, 1, 12);
  const weekdays = cronField(weekday, 0, 7);
  if (weekdays.has(7)) weekdays.add(0);
  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const begin = Math.floor(after.getTime() / 60_000) * 60_000 + 60_000;
  // Bounded preview: an impossible date or a sparse schedule fails rather than looping forever.
  for (let index = 0; index < 527_040 && result.length < count; index++) {
    const date = new Date(begin + index * 60_000);
    const parts = Object.fromEntries(
      format.formatToParts(date).map((part) => [part.type, part.value]),
    );
    if (
      !minutes.has(Number(parts.minute)) ||
      !hours.has(Number(parts.hour)) ||
      !months.has(Number(parts.month))
    )
      continue;
    const matchesDay = days.has(Number(parts.day));
    const matchesWeekday = weekdays.has(weekdayNames.indexOf(parts.weekday!));
    const dayMatches =
      day === '*' ? matchesWeekday : weekday === '*' ? matchesDay : matchesDay || matchesWeekday;
    if (dayMatches) append(date);
  }
  if (result.length !== count) throw new RniOrchestrationError('INVALID_PLAN');
  return result;
}
