import { describe, expect, it } from 'vitest';
import { computeNextDueAt, InvalidScheduleError } from '../../../../src/services/jobs/schedule';
import type { JobDefinition } from '../../../../src/contracts/operations';

function job(overrides: Partial<JobDefinition> = {}): JobDefinition {
  return {
    id: 'job-1',
    jobKey: 'test_job',
    displayName: 'Test job',
    enabled: true,
    scheduleType: 'interval',
    scheduleExpression: '300',
    displayTimezone: 'UTC',
    activeWindows: [],
    jitterSeconds: 0,
    scope: {},
    priority: 100,
    maxRuntimeSeconds: 60,
    concurrencyPolicy: 'skip',
    maxAttempts: 3,
    backoffPolicy: {},
    dependencies: [],
    maxCallsPerRun: null,
    maxCostUsdPerRun: null,
    triggerEligible: false,
    nextDueAt: new Date('2026-09-01T00:00:00.000Z'),
    configVersion: '1',
    version: 1,
    updatedBy: 'test',
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('computeNextDueAt — interval schedules', () => {
  it('advances by exactly the configured number of seconds', () => {
    const from = new Date('2026-09-01T00:00:00.000Z');
    const next = computeNextDueAt(job({ scheduleType: 'interval', scheduleExpression: '300' }), from);
    expect(next.toISOString()).toBe('2026-09-01T00:05:00.000Z');
  });

  it('rejects a non-positive or non-integer interval rather than silently looping', () => {
    const from = new Date('2026-09-01T00:00:00.000Z');
    expect(() => computeNextDueAt(job({ scheduleExpression: '0' }), from)).toThrow(InvalidScheduleError);
    expect(() => computeNextDueAt(job({ scheduleExpression: '-5' }), from)).toThrow(InvalidScheduleError);
    expect(() => computeNextDueAt(job({ scheduleExpression: 'not-a-number' }), from)).toThrow(InvalidScheduleError);
    expect(() => computeNextDueAt(job({ scheduleExpression: '5.5' }), from)).toThrow(InvalidScheduleError);
  });
});

describe('computeNextDueAt — cron schedules, DST-aware', () => {
  it('resolves a plain UTC daily cron with no timezone complication', () => {
    const from = new Date('2026-09-01T00:00:00.000Z');
    const next = computeNextDueAt(
      job({ scheduleType: 'cron', scheduleExpression: '0 12 * * *', displayTimezone: 'UTC' }),
      from,
    );
    expect(next.toISOString()).toBe('2026-09-01T12:00:00.000Z');
  });

  it('crosses the US spring-forward DST boundary (America/New_York, 2027-03-14) at a UTC offset that shifts by exactly one hour', () => {
    const job9amEastern = job({ scheduleType: 'cron', scheduleExpression: '0 9 * * *', displayTimezone: 'America/New_York' });

    // Before the transition: 9am EST is UTC-5.
    const first = computeNextDueAt(job9amEastern, new Date('2027-03-13T12:00:00.000Z'));
    expect(first.toISOString()).toBe('2027-03-13T14:00:00.000Z');

    // After the transition: 9am EDT is UTC-4 — the *local* due time is unchanged (still 9am for
    // an operator reading the dashboard), even though the UTC instant moved by one hour. A
    // naive fixed-UTC-offset scheduler would have produced 2027-03-14T14:00:00.000Z (10am local)
    // instead — this is the exact defect a DST-aware library exists to avoid.
    const second = computeNextDueAt(job9amEastern, first);
    expect(second.toISOString()).toBe('2027-03-14T13:00:00.000Z');

    const diffHours = (second.getTime() - first.getTime()) / 3_600_000;
    expect(diffHours).toBe(23);
  });

  it('always returns an instant strictly after `from`, never `from` itself', () => {
    const exactlyOnTheHour = new Date('2026-09-01T12:00:00.000Z');
    const next = computeNextDueAt(
      job({ scheduleType: 'cron', scheduleExpression: '0 12 * * *', displayTimezone: 'UTC' }),
      exactlyOnTheHour,
    );
    expect(next.getTime()).toBeGreaterThan(exactlyOnTheHour.getTime());
    expect(next.toISOString()).toBe('2026-09-02T12:00:00.000Z');
  });

  it('throws InvalidScheduleError for a malformed cron expression rather than throwing an unlabelled error', () => {
    const from = new Date('2026-09-01T00:00:00.000Z');
    expect(() =>
      computeNextDueAt(job({ scheduleType: 'cron', scheduleExpression: 'not a cron expression' }), from),
    ).toThrow(InvalidScheduleError);
  });
});
