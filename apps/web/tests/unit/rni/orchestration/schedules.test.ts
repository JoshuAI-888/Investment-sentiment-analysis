import { describe, expect, it } from 'vitest';
import { previewRniSchedule } from '@/rni/orchestration/schedules';
import { harness, scope } from './fixture';

describe('RNI schedule preview', () => {
  it('uses exact elapsed seconds for interval schedules and preserves the display timezone', () => {
    const results = previewRniSchedule(
      { scheduleType: 'interval', scheduleExpression: '300', displayTimezone: 'Pacific/Auckland' },
      new Date('2026-09-05T00:00:00Z'),
    );
    expect(results.map((result) => result.dueAt)).toEqual([
      '2026-09-05T00:05:00.000Z',
      '2026-09-05T00:10:00.000Z',
      '2026-09-05T00:15:00.000Z',
      '2026-09-05T00:20:00.000Z',
      '2026-09-05T00:25:00.000Z',
    ]);
    expect(results[0]!.localTime).toContain('12:05');
    expect(results[0]!.timezone).toBe('Pacific/Auckland');
  });

  it('skips a nonexistent Auckland spring-forward local time', () => {
    const next = previewRniSchedule(
      {
        scheduleType: 'cron',
        scheduleExpression: '30 2 * * *',
        displayTimezone: 'Pacific/Auckland',
      },
      new Date('2026-09-26T12:00:00Z'),
      1,
    );
    expect(next[0]!.dueAt).toBe('2026-09-27T13:30:00.000Z');
  });

  it('gives two distinct UTC fire identities in the repeated Auckland autumn hour', () => {
    const next = previewRniSchedule(
      {
        scheduleType: 'cron',
        scheduleExpression: '30 2 * * *',
        displayTimezone: 'Pacific/Auckland',
      },
      new Date('2026-04-04T12:00:00Z'),
      2,
    );
    expect(next.map((result) => result.dueAt)).toEqual([
      '2026-04-04T13:30:00.000Z',
      '2026-04-04T14:30:00.000Z',
    ]);
    expect(next[0]!.localTime).toBe(next[1]!.localTime);
  });

  it('supports minute steps and day-of-week bounds', () => {
    const next = previewRniSchedule(
      { scheduleType: 'cron', scheduleExpression: '*/15 9-17 * * 1-5', displayTimezone: 'UTC' },
      new Date('2026-09-04T17:45:00Z'),
      1,
    );
    expect(next[0]!.dueAt).toBe('2026-09-07T09:00:00.000Z');
  });

  it('finds five sparse leap-day fires without rejecting a valid annual cron', () => {
    const next = previewRniSchedule(
      { scheduleType: 'cron', scheduleExpression: '0 0 29 2 *', displayTimezone: 'UTC' },
      new Date('2024-03-01T00:00:00Z'),
      5,
    );
    expect(next.map(({ dueAt }) => dueAt)).toEqual([
      '2028-02-29T00:00:00.000Z',
      '2032-02-29T00:00:00.000Z',
      '2036-02-29T00:00:00.000Z',
      '2040-02-29T00:00:00.000Z',
      '2044-02-29T00:00:00.000Z',
    ]);
  });

  it.each(['0', '1.5', '-5', '1 second'])('rejects invalid interval %s', (expression) => {
    expect(() =>
      previewRniSchedule(
        { scheduleType: 'interval', scheduleExpression: expression, displayTimezone: 'UTC' },
        new Date(),
      ),
    ).toThrow();
  });

  it.each(['61 * * * *', '*/0 * * * *', '* * * *', '0 24 * * *'])(
    'rejects invalid cron %s',
    (expression) => {
      expect(() =>
        previewRniSchedule(
          { scheduleType: 'cron', scheduleExpression: expression, displayTimezone: 'UTC' },
          new Date(),
        ),
      ).toThrow();
    },
  );

  it('fails closed on unsupported shared job policies instead of ignoring them', async () => {
    for (const patch of [
      { jitterSeconds: 5 },
      { dependencies: ['another-job'] },
      { activeWindows: ['US-open'] },
      { concurrencyPolicy: 'queue' as const },
    ]) {
      const h = harness();
      Object.assign(h.store.data.definition, patch);
      await expect(h.service.requestManualRefresh({ idempotencyKey: 'a', scope })).rejects.toThrow(
        'INVALID_PLAN',
      );
      expect(h.store.data.jobs).toHaveLength(0);
    }
  });
});
