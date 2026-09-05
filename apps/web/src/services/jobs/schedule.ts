/**
 * Due-time computation (F16 §4.1 step 6, §5 "due-time selection across DST boundaries").
 *
 * `repositories/jobs.ts#advanceJobDefinitionSchedule` "only writes the value it is given" — its
 * own doc names computing the next due instant from `schedule_type`/`schedule_expression` as
 * dispatch logic belonging here, in `JobService` (F16a). This module is that computation, kept
 * pure and independently unit-testable (no `Queryable`, no clock but the one passed in).
 *
 * **`schedule_type: 'interval'`.** `schedule_expression` is a plain non-negative integer string
 * of seconds (`"300"` for the five-minute dispatcher cadence). Pure epoch arithmetic — a DST
 * transition changes the *local clock time* an instant reads as, never the instant itself, so an
 * interval schedule cannot drift at a DST boundary by construction. Anchored to the job's own
 * previous `next_due_at` rather than to `from`, so a dispatcher that runs late (a cold start, a
 * slow tick) catches up to the *next* due instant on the original cadence rather than resetting
 * the clock to "five minutes from whenever we happened to notice."
 *
 * **`schedule_type: 'cron'`.** `schedule_expression` is a standard 5-field cron string (`minute
 * hour day-of-month month day-of-week`), evaluated in `display_timezone` (an IANA zone name) —
 * this is where DST actually bites: "09:30 America/New_York" is 13:30 UTC in winter (EST,
 * UTC-5) and 13:30 UTC... no — 14:30 UTC in winter and 13:30 UTC in summer (EDT, UTC-4), and a
 * schedule that only ever did epoch-plus-N arithmetic would silently keep firing at the pre-DST
 * UTC instant forever. Resolved by brute-force minute-stepping through real `Intl.DateTimeFormat`
 * zoned conversions rather than a hand-rolled offset table — correct by construction against
 * whatever DST rules the IANA database encodes for that zone, including a rule change nobody
 * hand-codes for.
 */
import type { JobDefinition } from '@/contracts/operations';

// ── interval ──────────────────────────────────────────────────────────────────────────────────

export function computeNextIntervalDueAt(previousDueAt: Date, intervalSeconds: number, from: Date): Date {
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    throw new Error(`interval schedule requires a positive number of seconds, got ${String(intervalSeconds)}`);
  }
  const intervalMs = intervalSeconds * 1000;
  let next = previousDueAt.getTime() + intervalMs;
  const fromMs = from.getTime();
  if (next <= fromMs) {
    const missedTicks = Math.floor((fromMs - next) / intervalMs) + 1;
    next += missedTicks * intervalMs;
  }
  return new Date(next);
}

// ── cron ──────────────────────────────────────────────────────────────────────────────────────

type CronField = { readonly kind: 'any' } | { readonly kind: 'values'; readonly values: readonly number[] };

const CRON_SEGMENT = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/u;

function parseCronField(raw: string, min: number, max: number): CronField {
  if (raw === '*') return { kind: 'any' };

  const values = new Set<number>();
  for (const segment of raw.split(',')) {
    const match = CRON_SEGMENT.exec(segment.trim());
    if (match === null) {
      throw new Error(`unsupported cron field segment '${segment}' in '${raw}'`);
    }
    const [, base, stepRaw] = match as unknown as [string, string, string | undefined];
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (step <= 0) throw new Error(`cron step must be positive: '${segment}'`);

    let rangeStart = min;
    let rangeEnd = max;
    if (base !== '*') {
      if (base.includes('-')) {
        const [startRaw, endRaw] = base.split('-') as [string, string];
        rangeStart = Number(startRaw);
        rangeEnd = Number(endRaw);
      } else {
        rangeStart = Number(base);
        rangeEnd = stepRaw === undefined ? Number(base) : max;
      }
    }
    if (rangeStart < min || rangeEnd > max || rangeStart > rangeEnd) {
      throw new Error(`cron field segment '${segment}' out of range [${String(min)}, ${String(max)}]`);
    }
    for (let value = rangeStart; value <= rangeEnd; value += step) values.add(value);
  }
  return { kind: 'values', values: [...values].sort((a, b) => a - b) };
}

function matchesField(field: CronField, value: number): boolean {
  return field.kind === 'any' || field.values.includes(value);
}

export type ParsedCron = {
  readonly minute: CronField;
  readonly hour: CronField;
  readonly dayOfMonth: CronField;
  readonly month: CronField;
  readonly dayOfWeek: CronField;
};

export function parseCronExpression(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/u);
  if (parts.length !== 5) {
    throw new Error(`cron expression must have 5 fields (minute hour day-of-month month day-of-week): '${expression}'`);
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [string, string, string, string, string];
  return {
    minute: parseCronField(minute, 0, 59),
    hour: parseCronField(hour, 0, 23),
    dayOfMonth: parseCronField(dayOfMonth, 1, 31),
    month: parseCronField(month, 1, 12),
    // 0 = Sunday, matching `Intl.DateTimeFormat`'s own `Sun`..`Sat` short-weekday ordering below.
    dayOfWeek: parseCronField(dayOfWeek, 0, 6),
  };
}

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

type ZonedParts = { readonly minute: number; readonly hour: number; readonly day: number; readonly month: number; readonly weekday: number };

// `computeNextCronDueAt` can probe up to a year of one-minute candidates; constructing a fresh
// `Intl.DateTimeFormat` per candidate (rather than per distinct time zone) was measurably slow
// enough to make the DST-boundary test flake past vitest's default timeout. Formatters are pure
// functions of their options, so caching one per zone is safe to share across every call.
const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = FORMATTER_CACHE.get(timeZone);
  if (cached !== undefined) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  FORMATTER_CACHE.set(timeZone, formatter);
  return formatter;
}

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  const hourText = get('hour');
  return {
    minute: Number(get('minute')),
    // `hourCycle: 'h23'` can still render midnight as "24" in some ICU builds; normalise it.
    hour: hourText === '24' ? 0 : Number(hourText),
    day: Number(get('day')),
    month: Number(get('month')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  };
}

/** A little over a year of one-minute steps — generous for any cadence this system seeds. */
const MAX_CRON_LOOKAHEAD_MINUTES = 366 * 24 * 60;

export function computeNextCronDueAt(expression: string, timeZone: string, from: Date): Date {
  const cron = parseCronExpression(expression);
  let candidateMs = (Math.floor(from.getTime() / 60_000) + 1) * 60_000;

  for (let step = 0; step < MAX_CRON_LOOKAHEAD_MINUTES; step += 1) {
    const candidate = new Date(candidateMs);
    const parts = zonedParts(candidate, timeZone);
    if (
      matchesField(cron.minute, parts.minute) &&
      matchesField(cron.hour, parts.hour) &&
      matchesField(cron.dayOfMonth, parts.day) &&
      matchesField(cron.month, parts.month) &&
      matchesField(cron.dayOfWeek, parts.weekday)
    ) {
      return candidate;
    }
    candidateMs += 60_000;
  }
  throw new Error(`no due instant found for cron expression '${expression}' in zone '${timeZone}' within the lookahead window`);
}

// ── dispatch ──────────────────────────────────────────────────────────────────────────────────

export type ScheduleFields = Pick<JobDefinition, 'scheduleType' | 'scheduleExpression' | 'displayTimezone' | 'nextDueAt'>;

export function computeNextDueAt(job: ScheduleFields, from: Date): Date {
  if (job.scheduleType === 'interval') {
    const intervalSeconds = Number(job.scheduleExpression);
    return computeNextIntervalDueAt(job.nextDueAt, intervalSeconds, from);
  }
  return computeNextCronDueAt(job.scheduleExpression, job.displayTimezone, from);
}
