import { describe, expect, it } from 'vitest';
import { STAGE_BUDGET_MS, TOTAL_BUDGET_MS, withDeadline } from '../../../../src/services/research/latency-budget';
import { createFakeClock } from '../../../../src/services/research/testing';

describe('withDeadline', () => {
  it('resolves with the value when the work finishes before the budget', async () => {
    const clock = createFakeClock(new Date('2026-01-01T00:00:00Z'));
    const result = await withDeadline(Promise.resolve('done'), 1_000, clock);
    expect(result).toEqual({ value: 'done', elapsedMs: expect.any(Number), timedOut: false });
  });

  it('reports timedOut when the work never settles', async () => {
    const clock = createFakeClock(new Date('2026-01-01T00:00:00Z'));
    const neverSettles = new Promise<string>(() => {
      // deliberately never resolves
    });
    const result = await withDeadline(neverSettles, 1_000, clock);
    expect(result.timedOut).toBe(true);
    expect(result.value).toBeNull();
  });

  it('propagates a genuine rejection rather than waiting for the timeout', async () => {
    const clock = createFakeClock(new Date('2026-01-01T00:00:00Z'));
    await expect(withDeadline(Promise.reject(new Error('boom')), 1_000, clock)).rejects.toThrow('boom');
  });
});

describe('STAGE_BUDGET_MS / TOTAL_BUDGET_MS', () => {
  it('sums to no more than the total 30s hard cap (F11 §4.2)', () => {
    const sum = Object.values(STAGE_BUDGET_MS).reduce((total, ms) => total + ms, 0);
    expect(sum).toBeLessThanOrEqual(TOTAL_BUDGET_MS);
  });
});
