/**
 * F16 §4.2 (F16b) — `updateJobMutation.schema`'s own validation surface, and the structural claim
 * that ADR-013's forbidden fields (the QStash schedule, `vercel.json`, the dispatch secret) and
 * every other non-editable `job_definition` column have no way to reach this schema at all.
 */
import { describe, expect, it } from 'vitest';
import { jobUpdateSchema } from '@/services/admin/jobs';

const JOB_ID = '11111111-1111-1111-1111-111111111111';

describe('jobUpdateSchema — structural non-editability (ADR-013 / F16 §4.2)', () => {
  it('has no key for any forbidden or non-editable job_definition column', () => {
    const shape = jobUpdateSchema.innerType().shape as Record<string, unknown>;
    const forbidden = [
      'jobKey',
      'scope',
      'priority',
      'maxRuntimeSeconds',
      'concurrencyPolicy',
      'dependencies',
      'maxCallsPerRun',
      'triggerEligible',
      'configVersion',
      // ADR-013's own three named things — not job_definition columns at all, but asserted
      // absent here too so a future edit accidentally adding one of these field names is caught
      // immediately by this test, not only by the source-grep in adr-013-invariants.test.ts.
      'qstashSchedule',
      'vercelConfig',
      'dispatchSecret',
    ];
    for (const key of forbidden) {
      expect(shape, `${key} must not be an editable field`).not.toHaveProperty(key);
    }
  });

  it('accepts a minimal, single-field edit (enabled only)', () => {
    const result = jobUpdateSchema.safeParse({
      reason: 'pausing for maintenance',
      expectedVersion: '3',
      jobId: JOB_ID,
      enabled: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an edit with no editable field at all', () => {
    const result = jobUpdateSchema.safeParse({
      reason: 'no-op edit',
      expectedVersion: '3',
      jobId: JOB_ID,
    });
    expect(result.success).toBe(false);
  });

  it('rejects scheduleType supplied without scheduleExpression', () => {
    const result = jobUpdateSchema.safeParse({
      reason: 'partial cadence edit',
      expectedVersion: '3',
      jobId: JOB_ID,
      scheduleType: 'cron',
    });
    expect(result.success).toBe(false);
  });

  it('rejects scheduleExpression supplied without scheduleType', () => {
    const result = jobUpdateSchema.safeParse({
      reason: 'partial cadence edit',
      expectedVersion: '3',
      jobId: JOB_ID,
      scheduleExpression: '0 12 * * *',
    });
    expect(result.success).toBe(false);
  });

  it('accepts scheduleType and scheduleExpression supplied together', () => {
    const result = jobUpdateSchema.safeParse({
      reason: 'cadence edit',
      expectedVersion: '3',
      jobId: JOB_ID,
      scheduleType: 'cron',
      scheduleExpression: '0 12 * * *',
      displayTimezone: 'UTC',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-numeric expectedVersion', () => {
    const result = jobUpdateSchema.safeParse({
      reason: 'edit',
      expectedVersion: 'not-a-version',
      jobId: JOB_ID,
      enabled: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a jobId that is not a UUID', () => {
    const result = jobUpdateSchema.safeParse({
      reason: 'edit',
      expectedVersion: '3',
      jobId: 'not-a-uuid',
      enabled: true,
    });
    expect(result.success).toBe(false);
  });

  it('accepts a null maxCostUsdPerRun (clearing the ceiling) and a decimal value', () => {
    expect(
      jobUpdateSchema.safeParse({
        reason: 'clear ceiling',
        expectedVersion: '3',
        jobId: JOB_ID,
        maxCostUsdPerRun: null,
      }).success,
    ).toBe(true);
    expect(
      jobUpdateSchema.safeParse({
        reason: 'set ceiling',
        expectedVersion: '3',
        jobId: JOB_ID,
        maxCostUsdPerRun: '5.00',
      }).success,
    ).toBe(true);
  });

  it('rejects a non-decimal maxCostUsdPerRun', () => {
    const result = jobUpdateSchema.safeParse({
      reason: 'bad ceiling',
      expectedVersion: '3',
      jobId: JOB_ID,
      maxCostUsdPerRun: 'five dollars',
    });
    expect(result.success).toBe(false);
  });
});
