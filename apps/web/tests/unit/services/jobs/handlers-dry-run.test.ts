import { describe, expect, it, vi } from 'vitest';
import type { JobHandlerContext } from '../../../../src/services/jobs/registry';
import { attentionSnapshotHandler } from '../../../../src/services/jobs/handlers/attention';
import { marketDataPollHandler } from '../../../../src/services/jobs/handlers/market-data';

/**
 * F16 §4.4 / §6 DoD: "Every job supports a dry run that makes zero external calls." Proven here
 * by handing each handler a `db` and `dispatchTriggeredJob` that throw the instant they are
 * touched — a dry run that reached either would fail this test immediately, rather than merely
 * "happening" not to call a real adapter in this particular run.
 */
function poisonedContext(overrides: Partial<JobHandlerContext> = {}): JobHandlerContext {
  const explode = (label: string) => {
    throw new Error(`dry run must not touch ${label}`);
  };

  return {
    db: new Proxy({}, { get: () => explode('the database') }) as unknown as JobHandlerContext['db'],
    redis: new Proxy({}, { get: () => explode('redis') }) as unknown as JobHandlerContext['redis'],
    now: new Date('2026-09-05T12:00:00Z'),
    dueAt: new Date('2026-09-05T12:00:00Z'),
    dryRun: true,
    jobRun: {} as JobHandlerContext['jobRun'],
    jobDefinition: {} as JobHandlerContext['jobDefinition'],
    dispatchTriggeredJob: vi.fn(async () => explode('dispatchTriggeredJob')) as unknown as JobHandlerContext['dispatchTriggeredJob'],
    ...overrides,
  };
}

describe('dry run makes zero external calls', () => {
  it('attentionSnapshotHandler returns a dry-run summary without touching db/redis', async () => {
    const outcome = await attentionSnapshotHandler(poisonedContext());
    expect(outcome.status).toBe('succeeded');
    expect(outcome.dryRunSummary).toBeDefined();
    expect(outcome.dryRunSummary?.estimatedCostUsd).toBe('0');
  });

  it('marketDataPollHandler returns a dry-run summary without touching db/redis/dispatchTriggeredJob', async () => {
    const outcome = await marketDataPollHandler(poisonedContext());
    expect(outcome.status).toBe('succeeded');
    expect(outcome.dryRunSummary).toBeDefined();
    expect(outcome.dryRunSummary?.estimatedCostUsd).toBe('0');
  });
});
