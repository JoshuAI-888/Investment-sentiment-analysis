/**
 * `substack.collect`'s handler: the translation between the collector's outcome and `job_run`,
 * and F16 §4.4's dry run.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/adapters/substack-publications', () => ({
  getSubstackPublications: async () => [
    { slug: 'alpha', name: 'Alpha', sector: 'Technology' },
    { slug: 'beta', name: 'Beta', sector: 'Energy' },
  ],
}));

const collectSubstackEvidence = vi.fn();
vi.mock('@/services/substack/collector', () => ({
  collectSubstackEvidence: (...args: unknown[]) => collectSubstackEvidence(...args),
}));

const { substackCollectHandler } = await import('@/services/jobs/handlers/substack');

function context(overrides: Record<string, unknown> = {}) {
  return {
    db: {} as never,
    redis: {} as never,
    now: new Date('2026-09-05T12:00:00Z'),
    dueAt: new Date('2026-09-05T12:00:00Z'),
    dryRun: false,
    jobRun: {} as never,
    jobDefinition: {} as never,
    dispatchTriggeredJob: async () => ({}) as never,
    ...overrides,
  } as never;
}

const okOutcome = {
  ok: true as const,
  observedAt: '2026-09-05T12:00:00.000Z',
  rows: [
    { evidenceItemId: 'e1', securityId: 's1' },
    { evidenceItemId: 'e2', securityId: null },
  ],
  entriesSeen: 5,
  enqueuedCount: 1,
  failedPublications: [],
  heartbeatWritten: true as const,
};

describe('substack.collect handler', () => {
  it('makes zero external calls on a dry run', async () => {
    collectSubstackEvidence.mockClear();
    const outcome = await substackCollectHandler(context({ dryRun: true }));

    // F16 §6: "every job supports a dry run that makes zero external calls". The collector is
    // the only thing here that can reach a network, so not calling it is the property.
    expect(collectSubstackEvidence).not.toHaveBeenCalled();
    expect(outcome.status).toBe('succeeded');
    expect(outcome.dryRunSummary?.estimatedCostUsd).toBe('0');
    expect(outcome.dryRunSummary?.willCall).toEqual([
      'https://alpha.substack.com/feed',
      'https://beta.substack.com/feed',
    ]);
  });

  it('reports the deferred-scoring backlog as pendingScoring', async () => {
    collectSubstackEvidence.mockClear();
    collectSubstackEvidence.mockResolvedValue(okOutcome);
    const outcome = await substackCollectHandler(context());

    // The whole point of registering this job before F20's durable queue exists: the size of the
    // unscored backlog must be a number an operator reads off the job history, not an inference.
    expect((outcome.metrics as Record<string, unknown>)['pendingScoring']).toBe(1);
  });

  it('counts attributed and unattributed rows separately', async () => {
    collectSubstackEvidence.mockClear();
    collectSubstackEvidence.mockResolvedValue(okOutcome);
    const metrics = (await substackCollectHandler(context())).metrics as Record<string, unknown>;

    // An unattributed row is written, not discarded (D-17) — so it must be visible as such
    // rather than silently folded into the written count.
    expect(metrics['attributed']).toBe(1);
    expect(metrics['unattributed']).toBe(1);
  });

  it('is succeeded on a clean run, including a quiet one', async () => {
    collectSubstackEvidence.mockClear();
    collectSubstackEvidence.mockResolvedValue({ ...okOutcome, rows: [], entriesSeen: 0, enqueuedCount: 0 });
    const outcome = await substackCollectHandler(context());

    // A weekly publication that published nothing is a real, quiet window — not a fault. Marking
    // it degraded would train an operator to ignore this job.
    expect(outcome.status).toBe('succeeded');
    expect(outcome.itemsWritten).toBe(0);
  });

  it('is degraded, not failed, when only some publications fail', async () => {
    collectSubstackEvidence.mockClear();
    collectSubstackEvidence.mockResolvedValue({
      ...okOutcome,
      failedPublications: [{ slug: 'beta', error: { kind: 'upstream', status: 500 } }],
    });
    const outcome = await substackCollectHandler(context());

    // The heartbeat was written and the items collected are real; one feed of two failing must
    // not discard the other's poll.
    expect(outcome.status).toBe('degraded');
    expect((outcome.metrics as Record<string, unknown>)['failedPublications']).toEqual(['beta']);
  });

  it('is failed when every publication failed, and writes no heartbeat', async () => {
    collectSubstackEvidence.mockClear();
    collectSubstackEvidence.mockResolvedValue({
      ok: false,
      observedAt: '2026-09-05T12:00:00.000Z',
      failedPublications: [
        { slug: 'alpha', error: { kind: 'upstream', status: 500 } },
        { slug: 'beta', error: { kind: 'timeout' } },
      ],
      message: 'every publication failed',
      heartbeatWritten: false,
    });
    const outcome = await substackCollectHandler(context());

    // The axis genuinely went dark. The absent heartbeat *is* the gap signal (F22), so this is a
    // failure rather than a degraded run that quietly claims coverage it does not have.
    expect(outcome.status).toBe('failed');
    expect((outcome.error as Record<string, unknown>)['kind']).toBe('total_outage');
  });
});
