import { afterEach, describe, expect, it } from 'vitest';
import { readXCeilings } from '../../../../src/services/jobs/x-ceiling';

const ENV_KEYS = ['X_MONTHLY_READ_CEILING', 'X_DAILY_READ_CEILING', 'X_READS_PER_TRIGGER_EVENT'] as const;

describe('readXCeilings', () => {
  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it('defaults every ceiling to zero (D-32) when nothing is configured', () => {
    expect(readXCeilings()).toEqual({ monthlyReadCeiling: 0, dailyReadCeiling: 0, perEventReadCeiling: 0 });
  });

  it('honours an explicit override once the price trigger is switched on (D-32)', () => {
    process.env['X_MONTHLY_READ_CEILING'] = '30000';
    process.env['X_DAILY_READ_CEILING'] = '1430';
    process.env['X_READS_PER_TRIGGER_EVENT'] = '100';
    expect(readXCeilings()).toEqual({ monthlyReadCeiling: 30_000, dailyReadCeiling: 1430, perEventReadCeiling: 100 });
  });

  it('rejects a negative or non-integer override rather than silently falling back', () => {
    process.env['X_READS_PER_TRIGGER_EVENT'] = '-1';
    expect(() => readXCeilings()).toThrow();
  });
});
