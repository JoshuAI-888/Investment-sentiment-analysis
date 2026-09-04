import { describe, expect, it } from 'vitest';
import { scheduledIdempotencyKey, triggeredIdempotencyKey } from '../../../../src/services/jobs/idempotency';

describe('scheduledIdempotencyKey', () => {
  it('is derived from (job_id, due_at) and nothing else', () => {
    const key = scheduledIdempotencyKey('job-1', new Date('2026-09-01T00:05:00.000Z'));
    expect(key).toBe('job-1:2026-09-01T00:05:00.000Z');
  });

  it('produces the identical key for the identical (job_id, due_at) pair, every time', () => {
    const a = scheduledIdempotencyKey('job-1', new Date('2026-09-01T00:05:00.000Z'));
    const b = scheduledIdempotencyKey('job-1', new Date('2026-09-01T00:05:00.000Z'));
    expect(a).toBe(b);
  });

  it('a different due_at for the same job produces a different key', () => {
    const a = scheduledIdempotencyKey('job-1', new Date('2026-09-01T00:05:00.000Z'));
    const b = scheduledIdempotencyKey('job-1', new Date('2026-09-01T00:10:00.000Z'));
    expect(a).not.toBe(b);
  });

  it('a different job for the same due_at produces a different key', () => {
    const a = scheduledIdempotencyKey('job-1', new Date('2026-09-01T00:05:00.000Z'));
    const b = scheduledIdempotencyKey('job-2', new Date('2026-09-01T00:05:00.000Z'));
    expect(a).not.toBe(b);
  });
});

describe('triggeredIdempotencyKey', () => {
  it('is stable across repeated evaluations of the same triggering bar — one spike, one window', () => {
    const observedAt = '2026-09-01T00:00:00.000Z';
    const first = triggeredIdempotencyKey('x-job', 'sec-1', observedAt);
    const second = triggeredIdempotencyKey('x-job', 'sec-1', observedAt);
    expect(first).toBe(second);
  });

  it('a different security or a different observed_at produces a different key', () => {
    const base = triggeredIdempotencyKey('x-job', 'sec-1', '2026-09-01T00:00:00.000Z');
    expect(triggeredIdempotencyKey('x-job', 'sec-2', '2026-09-01T00:00:00.000Z')).not.toBe(base);
    expect(triggeredIdempotencyKey('x-job', 'sec-1', '2026-09-02T00:00:00.000Z')).not.toBe(base);
  });
});
