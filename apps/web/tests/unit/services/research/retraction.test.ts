import { describe, expect, it } from 'vitest';
import { retractRun } from '../../../../src/services/research/retraction';
import { createFakeClock, createInMemoryAuditLog, createInMemoryResearchRepository } from '../../../../src/services/research/testing';
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
  it('retracts a complete run, appends a retraction event, and writes a successful audit entry', async () => {
    const repo = createInMemoryResearchRepository();
    const run = await seedRun(repo, 'complete');
    const clock = createFakeClock(new Date('2026-09-01T00:00:00Z'));
    const audit = createInMemoryAuditLog();

    const retracted = await retractRun(repo, clock, audit, {
      runId: run.id,
      reason: 'stale price target reference found',
      actor: 'admin-1',
      expectedStatus: 'complete',
    });

    expect(retracted.status).toBe('retracted');
    expect(retracted.retractedReason).toBe('stale price target reference found');
    expect(retracted.retractedBy).toBe('admin-1');

    const events = await repo.listEvents(run.id);
    expect(events.some((event) => event.eventType === 'retraction')).toBe(true);

    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({ action: 'research.retract', objectId: run.id, result: 'success', actorId: 'admin-1' });
  });

  it('retracts a degraded run', async () => {
    const repo = createInMemoryResearchRepository();
    const run = await seedRun(repo, 'degraded');
    const clock = createFakeClock(new Date());
    const retracted = await retractRun(repo, clock, createInMemoryAuditLog(), { runId: run.id, reason: 'r', actor: 'a', expectedStatus: 'degraded' });
    expect(retracted.status).toBe('retracted');
  });

  it('refuses to retract a failed run, and records a rejected audit entry', async () => {
    const repo = createInMemoryResearchRepository();
    const run = await seedRun(repo, 'failed');
    const clock = createFakeClock(new Date());
    const audit = createInMemoryAuditLog();
    await expect(retractRun(repo, clock, audit, { runId: run.id, reason: 'r', actor: 'a', expectedStatus: 'failed' })).rejects.toThrow(
      RetractionError,
    );
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]?.result).toBe('rejected');
  });

  it('refuses an empty reason (R-18)', async () => {
    const repo = createInMemoryResearchRepository();
    const run = await seedRun(repo, 'complete');
    const clock = createFakeClock(new Date());
    await expect(
      retractRun(repo, clock, createInMemoryAuditLog(), { runId: run.id, reason: '   ', actor: 'a', expectedStatus: 'complete' }),
    ).rejects.toThrow(RetractionError);
  });

  it('refuses a run that does not exist', async () => {
    const repo = createInMemoryResearchRepository();
    const clock = createFakeClock(new Date());
    await expect(
      retractRun(repo, clock, createInMemoryAuditLog(), { runId: 'nonexistent', reason: 'r', actor: 'a', expectedStatus: 'complete' }),
    ).rejects.toThrow(RetractionError);
  });

  it('refuses when the run has moved on since the caller last read it (ARCH §8 optimistic-concurrency check, lane-review finding 8)', async () => {
    const repo = createInMemoryResearchRepository();
    const run = await seedRun(repo, 'complete');
    const clock = createFakeClock(new Date());
    // The caller believes the run is still "degraded" — stale by the time this request lands.
    await expect(
      retractRun(repo, clock, createInMemoryAuditLog(), { runId: run.id, reason: 'r', actor: 'a', expectedStatus: 'degraded' }),
    ).rejects.toThrow(RetractionError);

    // Nothing was mutated by the refused attempt.
    const reread = await repo.getRun(run.id);
    expect(reread?.status).toBe('complete');
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
    await retractRun(repo, clock, createInMemoryAuditLog(), { runId: run.id, reason: 'r', actor: 'a', expectedStatus: 'complete' });

    const claims = await repo.listClaims(run.id);
    expect(claims).toHaveLength(1);
    const stillReadable = await repo.getRun(run.id);
    expect(stillReadable).not.toBeNull();
  });
});
