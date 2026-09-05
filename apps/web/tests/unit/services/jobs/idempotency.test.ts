import { describe, expect, it } from 'vitest';
import { buildDispatchIdempotencyKey } from '../../../../src/services/jobs/idempotency';

describe('buildDispatchIdempotencyKey', () => {
  it('derives the same key for the same (job_id, due_at) every time', () => {
    const dueAt = new Date('2026-09-05T12:00:00.000Z');
    const a = buildDispatchIdempotencyKey('job-1', dueAt);
    const b = buildDispatchIdempotencyKey('job-1', new Date(dueAt.getTime()));
    expect(a).toBe(b);
  });

  it('derives a different key for a different job with the same due_at', () => {
    const dueAt = new Date('2026-09-05T12:00:00.000Z');
    expect(buildDispatchIdempotencyKey('job-1', dueAt)).not.toBe(buildDispatchIdempotencyKey('job-2', dueAt));
  });

  it('derives a different key for the same job at a different due_at', () => {
    const a = buildDispatchIdempotencyKey('job-1', new Date('2026-09-05T12:00:00.000Z'));
    const b = buildDispatchIdempotencyKey('job-1', new Date('2026-09-05T12:05:00.000Z'));
    expect(a).not.toBe(b);
  });

  it('an extra component (the trigger path) changes the key deterministically', () => {
    const dueAt = new Date('2026-09-05T12:00:00.000Z');
    const withSecurityA = buildDispatchIdempotencyKey('window-job', dueAt, 'security-a');
    const withSecurityB = buildDispatchIdempotencyKey('window-job', dueAt, 'security-b');
    const withoutExtra = buildDispatchIdempotencyKey('window-job', dueAt);

    expect(withSecurityA).not.toBe(withSecurityB);
    expect(withSecurityA).not.toBe(withoutExtra);
    expect(buildDispatchIdempotencyKey('window-job', dueAt, 'security-a')).toBe(withSecurityA);
  });
});
