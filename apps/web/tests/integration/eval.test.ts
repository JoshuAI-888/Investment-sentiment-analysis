/**
 * F12's own additive persistence (migration `0015`) against a real Postgres — the append-only/
 * range constraints in `eval_result`/`eval_calibration_score` and `patchEvalRun`'s current-state
 * update exist only in the database, mirroring `tests/integration/versions.test.ts`'s own
 * reasoning for testing this against the real thing rather than a mock.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import {
  insertEvalRun,
  findEvalRun,
  patchEvalRun,
  listEvalRuns,
  insertEvalResult,
  insertEvalResults,
  listEvalResultsForRun,
  insertEvalCalibrationScore,
  listEvalCalibrationScoresForRun,
} from '../../src/repositories/eval';
import { closePool, getPool } from '../../src/repositories/client';

const url = databaseUrl();

describe.skipIf(url === undefined)('F12 §3 "Produces" — eval_run / eval_result / eval_calibration_score', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
    getPool(url);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
  });

  afterAll(async () => {
    await closePool();
    await pool?.end();
  });

  it('inserts an eval_run, patches its terminal state, and reads it back', async () => {
    const run = await insertEvalRun({ kind: 'corpus', corpusVersion: 'v1', modelIds: { judge: 'google/gemini-3-pro' } });
    expect(run.completedAt).toBeNull();
    expect(run.gatePassed).toBeNull();

    const patched = await patchEvalRun(run.id, { completedAt: new Date(), summary: { corpusMean: '4.5000' }, gatePassed: true });
    expect(patched.gatePassed).toBe(true);
    expect(patched.completedAt).not.toBeNull();
    expect(patched.summary).toEqual({ corpusMean: '4.5000' });

    const found = await findEvalRun(run.id);
    expect(found?.id).toBe(run.id);
  });

  it('lists runs filtered by kind, most recent first', async () => {
    const a = await insertEvalRun({ kind: 'corpus', corpusVersion: 'v1', modelIds: {} });
    await new Promise((r) => setTimeout(r, 5));
    const b = await insertEvalRun({ kind: 'seeded_error', corpusVersion: 'v1', modelIds: {} });

    const corpusRuns = await listEvalRuns('corpus');
    expect(corpusRuns.map((r) => r.id)).toEqual([a.id]);

    const all = await listEvalRuns();
    expect(all.map((r) => r.id)).toEqual([b.id, a.id]);
  });

  it('stores per-run eval_result rows and reads them back for that run only', async () => {
    const runA = await insertEvalRun({ kind: 'corpus', corpusVersion: 'v1', modelIds: {} });
    const runB = await insertEvalRun({ kind: 'corpus', corpusVersion: 'v1', modelIds: {} });

    await insertEvalResults(
      [
        { evalRunId: runA.id, packId: 'clear-01', answerId: 'clear-01', kind: 'gold', faultClass: null, judgeC1: 5, judgeC2: 5, judgeC3: 5, judgeC4: 4, judgeViolations: [], judgeRationale: 'good', verifierOutcome: null },
        { evalRunId: runA.id, packId: 'clear-02', answerId: 'clear-02', kind: 'gold', faultClass: null, judgeC1: 4, judgeC2: 4, judgeC3: 4, judgeC4: 4, judgeViolations: [], judgeRationale: 'good', verifierOutcome: null },
      ],
      pool,
    );
    await insertEvalResult(
      { evalRunId: runB.id, packId: 'clear-01', answerId: 'clear-01', kind: 'gold', faultClass: null, judgeC1: 3, judgeC2: 3, judgeC3: 3, judgeC4: 3, judgeViolations: [], judgeRationale: 'ok', verifierOutcome: null },
      pool,
    );

    const resultsForA = await listEvalResultsForRun(runA.id);
    expect(resultsForA).toHaveLength(2);
    expect(resultsForA.every((r) => r.evalRunId === runA.id)).toBe(true);
  });

  it('rejects a judge score outside 1..5 at the database level (defence in depth beyond the zod schema)', async () => {
    const run = await insertEvalRun({ kind: 'corpus', corpusVersion: 'v1', modelIds: {} });
    await expect(
      pool.query(
        `insert into eval_result (eval_run_id, pack_id, answer_id, kind, judge_c1, judge_c2, judge_c3, judge_c4)
         values ($1, 'p', 'a', 'gold', 9, 5, 5, 5)`,
        [run.id],
      ),
    ).rejects.toThrow();
  });

  it('rejects a partial judge score set — all four axes or none (defence in depth)', async () => {
    const run = await insertEvalRun({ kind: 'corpus', corpusVersion: 'v1', modelIds: {} });
    await expect(
      pool.query(
        `insert into eval_result (eval_run_id, pack_id, answer_id, kind, judge_c1)
         values ($1, 'p', 'a', 'gold', 5)`,
        [run.id],
      ),
    ).rejects.toThrow();
  });

  it('stores a calibration score (MT-11) scoped to its own run', async () => {
    const run = await insertEvalRun({ kind: 'calibration', corpusVersion: 'v1', modelIds: {} });
    await insertEvalCalibrationScore({ evalRunId: run.id, answerId: 'clear-01', humanC1: 4, humanC2: 5, humanC3: 4, humanC4: 3, scoredBy: 'owner' });

    const scores = await listEvalCalibrationScoresForRun(run.id);
    expect(scores).toHaveLength(1);
    expect(scores[0]?.scoredBy).toBe('owner');
  });
});
