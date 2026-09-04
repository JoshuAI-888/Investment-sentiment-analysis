/**
 * F16 §4.4 (F16b) — "next-run preview is shown per job in the admin UI." Pure logic tests for
 * `previewNextDueAt`/`cadenceOrDueTimeChanged`; the DST-aware cron arithmetic itself is F16a's own
 * `computeNextDueAt` and is not re-tested here (`tests/unit/services/jobs/schedule.test.ts` covers
 * it) — this file proves the *layer this feature adds on top*: what instant to preview from, given
 * a candidate edit.
 */
import { describe, expect, it } from 'vitest';
import { cadenceOrDueTimeChanged, previewNextDueAt } from '@/services/admin/job-schedule-preview';
import { InvalidScheduleError } from '@/services/jobs/schedule';
import type { JobDefinition } from '@/contracts/operations';

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

describe('previewNextDueAt', () => {
  it('an explicit nextDueAt override is the preview outright, ignoring any cadence on the row', () => {
    const current = job({ nextDueAt: new Date('2026-09-01T00:00:00Z') });
    const override = new Date('2026-12-25T00:00:00Z');
    const preview = previewNextDueAt(current, { nextDueAt: override }, new Date('2026-09-01T00:00:00Z'));
    expect(preview).toBe(override);
  });

  it('no schedule-shaping field touched — the preview is the job\'s current next_due_at, unchanged', () => {
    const current = job({ nextDueAt: new Date('2026-09-01T00:00:00Z') });
    const preview = previewNextDueAt(current, {}, new Date('2026-09-05T00:00:00Z'));
    expect(preview).toBe(current.nextDueAt);
  });

  it('a cadence edit is previewed from `now`, not from the job\'s stale next_due_at', () => {
    const current = job({
      scheduleType: 'interval',
      scheduleExpression: '300',
      nextDueAt: new Date('2020-01-01T00:00:00Z'), // long stale
    });
    const now = new Date('2026-09-01T00:00:00Z');
    const preview = previewNextDueAt(current, { scheduleExpression: '60' }, now);
    expect(preview.toISOString()).toBe('2026-09-01T00:01:00.000Z');
  });

  it('changing only scheduleType (keeping the current expression as interpreted under the new type) still recomputes from now', () => {
    const current = job({ scheduleType: 'interval', scheduleExpression: '0 12 * * *', displayTimezone: 'UTC' });
    const now = new Date('2026-09-01T00:00:00Z');
    const preview = previewNextDueAt(current, { scheduleType: 'cron' }, now);
    expect(preview.toISOString()).toBe('2026-09-01T12:00:00.000Z');
  });

  it('crosses the US spring-forward DST boundary the same way F16a\'s own computeNextDueAt does — this feature reuses it, not reimplements it', () => {
    const current = job({
      scheduleType: 'interval',
      scheduleExpression: '300',
      displayTimezone: 'UTC',
    });
    // An edit that touches cadence (even re-affirming the same eventual values) is what puts this
    // function on the "recompute from now" path — an untouched edit (`{}`) would correctly return
    // the row's stale `next_due_at` unchanged instead, which is a different case (covered above).
    const cronEdit = {
      scheduleType: 'cron' as const,
      scheduleExpression: '0 9 * * *',
      displayTimezone: 'America/New_York',
    };

    const beforeTransition = previewNextDueAt(current, cronEdit, new Date('2027-03-13T12:00:00.000Z'));
    expect(beforeTransition.toISOString()).toBe('2027-03-13T14:00:00.000Z');

    const afterTransition = previewNextDueAt(current, cronEdit, beforeTransition);
    expect(afterTransition.toISOString()).toBe('2027-03-14T13:00:00.000Z');

    const diffHours = (afterTransition.getTime() - beforeTransition.getTime()) / 3_600_000;
    expect(diffHours).toBe(23);
  });

  it('a malformed cron candidate throws InvalidScheduleError, not a silent fallback', () => {
    const current = job({ scheduleType: 'interval', scheduleExpression: '300' });
    expect(() =>
      previewNextDueAt(current, { scheduleType: 'cron', scheduleExpression: 'not a cron' }, new Date()),
    ).toThrow(InvalidScheduleError);
  });
});

describe('cadenceOrDueTimeChanged', () => {
  it('is false when nothing schedule-shaping is present', () => {
    expect(cadenceOrDueTimeChanged({})).toBe(false);
  });

  it.each([
    { nextDueAt: new Date() },
    { scheduleType: 'cron' as const },
    { scheduleExpression: '0 12 * * *' },
    { displayTimezone: 'America/New_York' },
  ])('is true when %o is present', (edit) => {
    expect(cadenceOrDueTimeChanged(edit)).toBe(true);
  });
});
