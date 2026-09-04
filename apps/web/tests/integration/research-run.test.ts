import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import { closePool, getPool } from '../../src/repositories/client';
import {
  insertResearchRun,
  appendResearchEvent,
  patchResearchRun,
  listResearchEvents,
  insertClaimLedgerEntries,
  retractResearchRun,
  RunNotRetractableError,
} from '../../src/repositories/research';

const url = databaseUrl();

/**
 * F11 §5's integration level: "run persists and replays from events after a simulated reload";
 * "retraction propagates to every render surface" — this suite proves the repository layer those
 * two DoD lines depend on, against real Postgres (append-only triggers, the retraction check
 * constraint, and the retraction transaction's audit_event write all exist only in the database).
 */
describe.skipIf(url === undefined)('research_run / research_event / claim_ledger repository', () => {
  let pool: pg.Pool;
  let securityId: string;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
    getPool(url);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
    const { rows } = await pool.query<{ id: string }>(
      `insert into security (symbol, name, exchange, asset_type, currency)
       values ('AAPL', 'Apple Inc.', 'NASDAQ', 'equity', 'USD') returning id`,
    );
    securityId = rows[0]?.id as string;
  });

  afterAll(async () => {
    await closePool();
    await pool.end();
  });

  it('a run persists and replays from its event log after a simulated reload', async () => {
    const run = await insertResearchRun(
      {
        userId: 'u1',
        securityId,
        question: 'What is going on with AAPL?',
        coverageStatus: 'unknown',
        inputCutoff: new Date(),
        promptVersion: 'synthesis-v1',
        modelRoute: {},
        toolManifest: {},
      },
      pool,
    );
    expect(run.status).toBe('queued');

    await appendResearchEvent({ runId: run.id, sequence: 1, eventType: 'state', label: 'queued', payload: {} }, pool);
    await appendResearchEvent({ runId: run.id, sequence: 2, eventType: 'state', label: 'gathering', payload: {} }, pool);
    await patchResearchRun(run.id, { status: 'running' }, pool);
    await appendResearchEvent({ runId: run.id, sequence: 3, eventType: 'state', label: 'complete', payload: {} }, pool);
    const finalRun = await patchResearchRun(
      run.id,
      { status: 'complete', completedAt: new Date(), result: { outcome: 'answered', prose: { summary: 'x' } }, costUsd: '0.010000' },
      pool,
    );

    // "Simulated reload" — a fresh read, not anything cached from the writes above.
    const events = await listResearchEvents(run.id, pool);
    expect(events.map((e) => e.label)).toEqual(['queued', 'gathering', 'complete']);
    expect(events.map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect(finalRun.status).toBe('complete');
    expect(finalRun.costUsd).toBe('0.010000');
  });

  it('retraction is only reachable from complete/degraded, updates the row, and writes an audit_event in the same transaction', async () => {
    const run = await insertResearchRun(
      { userId: 'u1', securityId, question: 'q', coverageStatus: 'unknown', inputCutoff: new Date(), promptVersion: 'synthesis-v1', modelRoute: {}, toolManifest: {} },
      pool,
    );

    // Not yet complete — retraction must be refused, not silently accepted.
    await expect(retractResearchRun({ id: run.id, reason: 'bad answer', actorId: 'admin1' })).rejects.toThrow(RunNotRetractableError);

    await patchResearchRun(run.id, { status: 'complete', completedAt: new Date(), result: { outcome: 'answered' } }, pool);

    const retracted = await retractResearchRun({ id: run.id, reason: 'a cited figure was later corrected upstream', actorId: 'admin1' });
    expect(retracted.status).toBe('retracted');
    expect(retracted.retractedReason).toBe('a cited figure was later corrected upstream');
    expect(retracted.retractedBy).toBe('admin1');
    expect(retracted.retractedAt).not.toBeNull();

    const { rows: auditRows } = await pool.query(
      `select action, object_type, object_id, result from audit_event where object_id = $1 and action = 'retract'`,
      [run.id],
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({ action: 'retract', object_type: 'research_run', object_id: run.id, result: 'success' });

    // "Notify" (F-20) — nothing was deleted; the run, and every future read of it, still shows retracted.
    const { rows: runRows } = await pool.query(`select status from research_run where id = $1`, [run.id]);
    expect(runRows[0]).toMatchObject({ status: 'retracted' });
  });

  it('a claim ledger entry for a material fact with no evidence or metric IDs is rejected by the database itself', async () => {
    const run = await insertResearchRun(
      { userId: 'u1', securityId, question: 'q', coverageStatus: 'unknown', inputCutoff: new Date(), promptVersion: 'synthesis-v1', modelRoute: {}, toolManifest: {} },
      pool,
    );

    await expect(
      insertClaimLedgerEntries(
        [
          {
            runId: run.id,
            claimText: 'An unsupported material claim.',
            claimType: 'fact',
            materiality: 'material',
            evidenceIds: [],
            metricIds: [],
            verificationStatus: 'verified',
            verifierNotes: null,
          },
        ],
        pool,
      ),
    ).rejects.toThrow();
  });

  it('research_event is append-only — an UPDATE against it is rejected by the database', async () => {
    const run = await insertResearchRun(
      { userId: 'u1', securityId, question: 'q', coverageStatus: 'unknown', inputCutoff: new Date(), promptVersion: 'synthesis-v1', modelRoute: {}, toolManifest: {} },
      pool,
    );
    await appendResearchEvent({ runId: run.id, sequence: 1, eventType: 'state', label: 'queued', payload: {} }, pool);

    await expect(pool.query(`update research_event set label = 'tampered' where run_id = $1 and sequence = 1`, [run.id])).rejects.toThrow();
  });
});
