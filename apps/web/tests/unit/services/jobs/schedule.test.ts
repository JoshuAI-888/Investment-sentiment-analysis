import { describe, expect, it } from 'vitest';
import {
  computeNextCronDueAt,
  computeNextDueAt,
  computeNextIntervalDueAt,
  parseCronExpression,
} from '../../../../src/services/jobs/schedule';

describe('computeNextIntervalDueAt', () => {
  it('advances by exactly one interval when the dispatcher is on time', () => {
    const previous = new Date('2026-09-05T12:00:00.000Z');
    const from = new Date('2026-09-05T12:00:01.000Z');
    expect(computeNextIntervalDueAt(previous, 300, from).toISOString()).toBe('2026-09-05T12:05:00.000Z');
  });

  it('catches up to the next future tick when the dispatcher runs late (missed several ticks)', () => {
    const previous = new Date('2026-09-05T12:00:00.000Z');
    // 17 minutes late against a 5-minute cadence: the next due instant on the original cadence
    // strictly after `from`, not "5 minutes from whenever we noticed."
    const from = new Date('2026-09-05T12:17:00.000Z');
    expect(computeNextIntervalDueAt(previous, 300, from).toISOString()).toBe('2026-09-05T12:20:00.000Z');
  });

  it('rejects a non-positive interval', () => {
    expect(() => computeNextIntervalDueAt(new Date(), 0, new Date())).toThrow();
    expect(() => computeNextIntervalDueAt(new Date(), -5, new Date())).toThrow();
  });

  it('never drifts across a DST boundary — pure epoch arithmetic', () => {
    // 2026-03-08 is within the US spring-forward window; an interval schedule must not care.
    const previous = new Date('2026-03-08T00:00:00.000Z');
    const from = new Date('2026-03-08T00:00:01.000Z');
    expect(computeNextIntervalDueAt(previous, 300, from).toISOString()).toBe('2026-03-08T00:05:00.000Z');
  });
});

describe('parseCronExpression', () => {
  it('parses a wildcard field as matching everything', () => {
    const parsed = parseCronExpression('* * * * *');
    expect(parsed.minute).toEqual({ kind: 'any' });
  });

  it('parses a comma list', () => {
    const parsed = parseCronExpression('0,30 * * * *');
    expect(parsed.minute).toEqual({ kind: 'values', values: [0, 30] });
  });

  it('parses a range', () => {
    const parsed = parseCronExpression('* * * * 1-5');
    expect(parsed.dayOfWeek).toEqual({ kind: 'values', values: [1, 2, 3, 4, 5] });
  });

  it('rejects an expression without exactly 5 fields', () => {
    expect(() => parseCronExpression('* * * *')).toThrow();
  });

  it('rejects an out-of-range value', () => {
    expect(() => parseCronExpression('99 * * * *')).toThrow();
  });
});

describe('computeNextCronDueAt — DST correctness (F16 §5)', () => {
  it('resolves 09:30 America/New_York to the correct UTC instant on both sides of the year', () => {
    const winterDue = computeNextCronDueAt('30 9 * * *', 'America/New_York', new Date('2026-01-15T00:00:00Z'));
    const summerDue = computeNextCronDueAt('30 9 * * *', 'America/New_York', new Date('2026-06-01T00:00:00Z'));

    // EST is UTC-5 in winter: 09:30 local = 14:30 UTC.
    expect(winterDue.toISOString()).toBe('2026-01-15T14:30:00.000Z');
    // EDT is UTC-4 in summer: 09:30 local = 13:30 UTC.
    expect(summerDue.toISOString()).toBe('2026-06-01T13:30:00.000Z');
  });

  it('lands on local 09:30 every day through March, and the spring-forward jump is visible in the UTC gaps', () => {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    });

    const dueDates: Date[] = [];
    let cursor = new Date('2026-03-01T00:00:00.000Z');
    for (let i = 0; i < 20; i += 1) {
      const due = computeNextCronDueAt('30 9 * * *', 'America/New_York', cursor);
      dueDates.push(due);
      cursor = due;
    }

    for (const due of dueDates) {
      expect(formatter.format(due)).toBe('09:30');
    }

    const gapsMs = dueDates.slice(1).map((due, index) => due.getTime() - (dueDates[index] as Date).getTime());
    const fullDayMs = 24 * 60 * 60 * 1000;
    const shortDayMs = 23 * 60 * 60 * 1000; // the spring-forward day is one hour shorter in UTC terms

    // Every gap is either an ordinary day or the one DST-shortened day — never anything else,
    // and the shortened gap must actually appear somewhere in this window.
    for (const gap of gapsMs) {
      expect([fullDayMs, shortDayMs]).toContain(gap);
    }
    expect(gapsMs).toContain(shortDayMs);
  });

  it('lands on local 09:30 every day through the fall-back window too', () => {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    });

    const dueDates: Date[] = [];
    let cursor = new Date('2026-10-25T00:00:00.000Z');
    for (let i = 0; i < 14; i += 1) {
      const due = computeNextCronDueAt('30 9 * * *', 'America/New_York', cursor);
      dueDates.push(due);
      cursor = due;
    }

    for (const due of dueDates) {
      expect(formatter.format(due)).toBe('09:30');
    }

    const gapsMs = dueDates.slice(1).map((due, index) => due.getTime() - (dueDates[index] as Date).getTime());
    const fullDayMs = 24 * 60 * 60 * 1000;
    const longDayMs = 25 * 60 * 60 * 1000; // the fall-back day is one hour longer in UTC terms
    for (const gap of gapsMs) {
      expect([fullDayMs, longDayMs]).toContain(gap);
    }
    expect(gapsMs).toContain(longDayMs);
  });
});

describe('computeNextDueAt', () => {
  it('dispatches to the interval computation for schedule_type "interval"', () => {
    const job = {
      scheduleType: 'interval' as const,
      scheduleExpression: '300',
      displayTimezone: 'UTC',
      nextDueAt: new Date('2026-09-05T12:00:00.000Z'),
    };
    const from = new Date('2026-09-05T12:00:01.000Z');
    expect(computeNextDueAt(job, from).toISOString()).toBe('2026-09-05T12:05:00.000Z');
  });

  it('dispatches to the cron computation for schedule_type "cron"', () => {
    const job = {
      scheduleType: 'cron' as const,
      scheduleExpression: '30 9 * * *',
      displayTimezone: 'America/New_York',
      nextDueAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    expect(computeNextDueAt(job, new Date('2026-01-15T00:00:00Z')).toISOString()).toBe('2026-01-15T14:30:00.000Z');
  });
});
