import { afterEach, describe, expect, it } from 'vitest';
import { getJobHandler, registerJobHandler, resetJobHandlersForTesting } from '../../../../src/services/jobs/registry';

describe('job handler registry', () => {
  afterEach(() => {
    resetJobHandlersForTesting();
  });

  it('returns undefined for an unregistered job_key', () => {
    expect(getJobHandler('nothing.registered')).toBeUndefined();
  });

  it('returns the exact handler registered for a job_key', async () => {
    const handler = async () => ({ status: 'succeeded' as const });
    registerJobHandler('some.job', handler);
    expect(getJobHandler('some.job')).toBe(handler);
  });

  it('throws on a duplicate registration for the same job_key — a build-time mistake, not a runtime condition', () => {
    registerJobHandler('duplicate.job', async () => ({ status: 'succeeded' as const }));
    expect(() => registerJobHandler('duplicate.job', async () => ({ status: 'succeeded' as const }))).toThrow();
  });

  it('does not hardcode an exhaustive union — any string job_key may be registered', () => {
    registerJobHandler('substack.collect', async () => ({ status: 'succeeded' as const }));
    registerJobHandler('a-brand-new-job-nobody-has-heard-of-yet', async () => ({ status: 'succeeded' as const }));
    expect(getJobHandler('substack.collect')).toBeDefined();
    expect(getJobHandler('a-brand-new-job-nobody-has-heard-of-yet')).toBeDefined();
  });
});
