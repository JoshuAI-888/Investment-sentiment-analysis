import { describe, expect, it } from 'vitest';
import { validateScheduleCadence } from '../../../src/rni/settings/schedule/cadence';
import { scheduleUpdateRequest } from '../../../src/rni/settings/schedule/schemas';

const after = new Date('2026-09-05T00:00:00Z');
const cadence = {
  scheduleType: 'interval' as const,
  scheduleExpression: '3600',
  displayTimezone: 'UTC',
};

describe('bounded schedule settings validation', () => {
  it.each(['300', '31536000'])('accepts interval boundary %s', (scheduleExpression) => {
    expect(validateScheduleCadence({ ...cadence, scheduleExpression }, after)).toHaveLength(5);
  });
  it.each(['0', '299', '31536001', '1.5', '-300', '300s', '0300', '999999999999999999'])(
    'rejects interval %s',
    (scheduleExpression) => {
      expect(() => validateScheduleCadence({ ...cadence, scheduleExpression }, after)).toThrow(
        'invalid',
      );
    },
  );
  it.each(['* * * * *', '*/2 * * * *', '*/4 * * * *', '* * * *', '61 * * * *'])(
    'rejects invalid or too-frequent cron %s',
    (scheduleExpression) => {
      expect(() =>
        validateScheduleCadence({ ...cadence, scheduleType: 'cron', scheduleExpression }, after),
      ).toThrow('invalid');
    },
  );
  it('accepts five-minute cron and uses the shared spring/fall DST rules', () => {
    expect(
      validateScheduleCadence(
        { ...cadence, scheduleType: 'cron', scheduleExpression: '*/5 * * * *' },
        after,
      ),
    ).toHaveLength(5);
    const cron = {
      scheduleType: 'cron' as const,
      scheduleExpression: '30 2 * * *',
      displayTimezone: 'Pacific/Auckland',
    };
    expect(validateScheduleCadence(cron, new Date('2026-09-26T12:00:00Z'))[0]!.dueAt).toBe(
      '2026-09-27T13:30:00.000Z',
    );
    expect(
      validateScheduleCadence(cron, new Date('2026-04-04T12:00:00Z'))
        .slice(0, 2)
        .map((v) => v.dueAt),
    ).toEqual(['2026-04-04T13:30:00.000Z', '2026-04-04T14:30:00.000Z']);
  });
  it.each(['Invalid/Timezone', '+01:00', 'x'.repeat(101)])(
    'rejects timezone %s',
    (displayTimezone) => {
      expect(() => validateScheduleCadence({ ...cadence, displayTimezone }, after)).toThrow(
        'invalid',
      );
    },
  );
  it('requires a strict intent and normalizes bounded reason and key', () => {
    const request = {
      ...cadence,
      expectedVersion: 1,
      enabled: true,
      reason: ' changed ',
      idempotencyKey: ' key ',
    };
    expect(scheduleUpdateRequest.parse(request)).toMatchObject({
      reason: 'changed',
      idempotencyKey: 'key',
    });
    for (const field of [
      'jobId',
      'environment',
      'actorId',
      'scope',
      'nextDueAt',
      'maxCostUsdPerRun',
    ])
      expect(scheduleUpdateRequest.safeParse({ ...request, [field]: 'injected' }).success).toBe(
        false,
      );
    for (const patch of [
      { reason: '' },
      { reason: 'x'.repeat(501) },
      { expectedVersion: 0 },
      { enabled: 'yes' },
      { idempotencyKey: 'x'.repeat(201) },
    ])
      expect(scheduleUpdateRequest.safeParse({ ...request, ...patch }).success).toBe(false);
  });
});
