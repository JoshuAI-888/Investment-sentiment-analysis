import { describe, expect, it } from 'vitest';
import { evaluateHeartbeat, HEARTBEAT_STALE_THRESHOLD_MINUTES } from '../../../../src/services/jobs/heartbeat';

describe('evaluateHeartbeat (F16 §4.5, D-16)', () => {
  it('is stale when nothing has ever completed successfully', () => {
    const result = evaluateHeartbeat(null, new Date());
    expect(result.stale).toBe(true);
    expect(result.lastSuccessfulCompletedAt).toBeNull();
  });

  it('is healthy just inside the threshold', () => {
    const now = new Date('2026-09-05T12:00:00Z');
    const last = new Date(now.getTime() - (HEARTBEAT_STALE_THRESHOLD_MINUTES - 1) * 60_000);
    const result = evaluateHeartbeat(last, now);
    expect(result.stale).toBe(false);
  });

  it('is stale just past the threshold', () => {
    const now = new Date('2026-09-05T12:00:00Z');
    const last = new Date(now.getTime() - (HEARTBEAT_STALE_THRESHOLD_MINUTES + 1) * 60_000);
    const result = evaluateHeartbeat(last, now);
    expect(result.stale).toBe(true);
  });

  it('respects a custom threshold', () => {
    const now = new Date('2026-09-05T12:00:00Z');
    const last = new Date(now.getTime() - 10 * 60_000);
    expect(evaluateHeartbeat(last, now, 5).stale).toBe(true);
    expect(evaluateHeartbeat(last, now, 15).stale).toBe(false);
  });
});
