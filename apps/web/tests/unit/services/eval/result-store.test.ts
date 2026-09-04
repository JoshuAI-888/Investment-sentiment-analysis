import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  compareRuns,
  createFileEvalResultStore,
  createInMemoryEvalResultStore,
} from '../../../../src/services/eval/result-store';
import type { EvalRunRecord } from '../../../../src/services/eval/contracts';

function record(overrides: Partial<EvalRunRecord> = {}): EvalRunRecord {
  return {
    runId: randomUUID(),
    runAt: new Date('2026-09-04T00:00:00.000Z'),
    corpusVersion: 'starter-corpus-v1',
    modelRoute: { judgeModelId: 'judge-model', judgeModelVersion: '2026-09-01', temperature: 0 },
    tierC: {
      passed: true,
      perAxisMean: { c1: 5, c2: 5, c3: 5, c4: 5 },
      overallMean: 5,
      c2Floor: 3,
      c2Failures: [],
      tierBViolationCount: 0,
      reasons: [],
    },
    verifier: null,
    calibration: null,
    ...overrides,
  };
}

describe('createInMemoryEvalResultStore', () => {
  it('stores runs in insertion order and reports the latest', async () => {
    const store = createInMemoryEvalResultStore();
    const a = record();
    const b = record();
    await store.save(a);
    await store.save(b);
    expect(await store.list()).toEqual([a, b]);
    expect(await store.latest()).toEqual(b);
  });

  it('reports null latest for an empty store', async () => {
    const store = createInMemoryEvalResultStore();
    expect(await store.latest()).toBeNull();
  });
});

describe('createFileEvalResultStore', () => {
  const path = join(tmpdir(), `eval-result-store-test-${randomUUID()}.jsonl`);

  afterEach(() => {
    rmSync(path, { force: true });
  });

  it('appends runs to a JSON-lines file and reads them back validated', async () => {
    const store = createFileEvalResultStore(path);
    const a = record();
    const b = record();
    await store.save(a);
    await store.save(b);

    const all = await store.list();
    expect(all).toHaveLength(2);
    expect(all[0]!.runId).toBe(a.runId);
    expect(all[1]!.runId).toBe(b.runId);
    expect((await store.latest())!.runId).toBe(b.runId);
  });

  it('returns an empty list when the file does not exist yet', async () => {
    const store = createFileEvalResultStore(path);
    expect(await store.list()).toEqual([]);
    expect(await store.latest()).toBeNull();
  });
});

describe('compareRuns', () => {
  it('flags an unexplained movement when the score moves without a model-route change', () => {
    const previous = record({ tierC: { ...record().tierC, overallMean: 4.5 } });
    const current = record({ tierC: { ...record().tierC, overallMean: 4.0 } });
    const comparison = compareRuns(previous, current);
    expect(comparison.modelRouteChanged).toBe(false);
    expect(comparison.unexplainedMovement).toBe(true);
    expect(comparison.overallMeanDelta).toBeCloseTo(-0.5, 10);
  });

  it('does not flag a movement as unexplained when the model route changed', () => {
    const previous = record({
      modelRoute: { judgeModelId: 'judge-a', judgeModelVersion: 'v1', temperature: 0 },
      tierC: { ...record().tierC, overallMean: 4.5 },
    });
    const current = record({
      modelRoute: { judgeModelId: 'judge-b', judgeModelVersion: 'v1', temperature: 0 },
      tierC: { ...record().tierC, overallMean: 4.0 },
    });
    const comparison = compareRuns(previous, current);
    expect(comparison.modelRouteChanged).toBe(true);
    expect(comparison.unexplainedMovement).toBe(false);
  });

  it('does not flag a tiny, within-tolerance movement as unexplained', () => {
    const previous = record({ tierC: { ...record().tierC, overallMean: 4.5 } });
    const current = record({ tierC: { ...record().tierC, overallMean: 4.505 } });
    const comparison = compareRuns(previous, current);
    expect(comparison.unexplainedMovement).toBe(false);
  });
});
