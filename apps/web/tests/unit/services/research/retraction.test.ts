import { describe, expect, it } from 'vitest';
import { retractRun } from '../../../../src/services/research/retraction';
import { createFakeClock, createInMemoryResearchRepository } from '../../../../src/services/research/testing';
import { RetractionError } from '../../../../src/services/research/ports';

async function seedRun(repo: ReturnType<typeof createInMemoryResearchRepository>, status: string) {
  const run = await repo.createRun({
    id: '11111111-1111-1111-1111-111111111111',
    userId: 'user-1',
    securityId: null,
    question: 'q',
    status: 'queued' as never,
    coverageStatus: 'pending',
    inputCutoff: new Date(),
    startedAt: new Date(),
    promptVersion: 'v1',
    modelRoute: {},
    toolManifest: {},
  });
  return repo.updateRun(run.id, { status: status as never, completedAt: new Date(), costUsd: '0', result: null, error: null });
}

describe('retractRun', () => {
  it('retracts a complete run and appends a retraction event', async () => {
    const repo = createInMemoryResearchRepository();
    const run = await seedRun(repo, 'complete');
    const clock = createFakeClock(new Date('2026-09-01T00:00:00Z'));

    const retracted = await retractRun(repo, clock, { runId: run.id, reason: 'stale price target reference found', actor: 'admin-1' });

    expect(retracted.status).toBe('retracted');
    expect(retracted.retractedReason).toBe('stale price target reference found');
    expect(retracted.retractedBy).toBe('admin-1');

    const events = await repo.listEvents(run.id);
    expect(events.some((event) => event.eventType === 'retraction')).toBe(true);
  });

  it('retracts a degraded run', async () => {
    const repo = createInMemoryResearchRepository();
    const run = await seedRun(repo, 'degraded');
    const clock = createFakeClock(new Date());
    const retracted = await retractRun(repo, clock, { runId: run.id, reason: 'r', actor: 'a' });
    expect(retracted.status).toBe('retracted');
  });

  it('refuses to retract a failed run', async () => {
    const repo = createInMemoryResearchRepository();
    const run = await seedRun(repo, 'failed');
    const clock = createFakeClock(new Date());
    await expect(retractRun(repo, clock, { runId: run.id, reason: 'r', actor: 'a' })).rejects.toThrow(RetractionError);
  });

  it('refuses an empty reason (R-18)', async () => {
    const repo = createInMemoryResearchRepository();
    const run = await seedRun(repo, 'complete');
    const clock = createFakeClock(new Date());
    await expect(retractRun(repo, clock, { runId: run.id, reason: '   ', actor: 'a' })).rejects.toThrow(RetractionError);
  });

  it('refuses a run that does not exist', async () => {
    const repo = createInMemoryResearchRepository();
    const clock = createFakeClock(new Date());
    await expect(retractRun(repo, clock, { runId: 'nonexistent', reason: 'r', actor: 'a' })).rejects.toThrow(RetractionError);
  });

  it('deletes nothing — the run, and any claims already on record, remain readable after retraction', async () => {
    const repo = createInMemoryResearchRepository();
    const run = await seedRun(repo, 'complete');
    await repo.insertClaims([
      {
        runId: run.id,
        claimText: 'a claim',
        claimType: 'interpretation',
        materiality: 'supporting',
        evidenceIds: [],
        metricIds: [],
        verificationStatus: 'verified',
        verifierNotes: null,
      },
    ]);
    const clock = createFakeClock(new Date());
    await retractRun(repo, clock, { runId: run.id, reason: 'r', actor: 'a' });

    const claims = await repo.listClaims(run.id);
    expect(claims).toHaveLength(1);
    const stillReadable = await repo.getRun(run.id);
    expect(stillReadable).not.toBeNull();
  });
});
