import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  FixtureModelBackend,
  classifyBatch,
  type ClassifyBatchOptions,
  type ClassifyBatchOutcome,
  type ModelBackend,
} from '@/services/evidence/model-client';

const rowSchema = z.object({ itemId: z.string(), verdict: z.boolean() });
type Row = z.infer<typeof rowSchema>;

function baseOptions(
  overrides: Partial<ClassifyBatchOptions<Row>> & { readonly backend: ModelBackend },
): ClassifyBatchOptions<Row> {
  return {
    methodId: 'test.method',
    methodVersion: '1.0.0',
    promptVersion: 'test.method@1',
    model: 'test-model',
    rowSchema,
    rowKey: (row: Row) => row.itemId,
    requestedIds: ['a', 'b'],
    buildPrompt: () => ({ system: 's', user: 'u' }),
    ...overrides,
  };
}

describe('classifyBatch — F10 §4.4 retry-once-then-drop discipline', () => {
  it('admits every row when the first response is a valid, complete array', async () => {
    const backend = new FixtureModelBackend([
      { kind: 'json', body: [{ itemId: 'a', verdict: true }, { itemId: 'b', verdict: false }] },
    ]);
    const outcome = await classifyBatch(baseOptions({ backend }));
    expect(outcome.admitted.get('a')).toEqual({ itemId: 'a', verdict: true });
    expect(outcome.admitted.get('b')).toEqual({ itemId: 'b', verdict: false });
    expect(outcome.rejected.size).toBe(0);
    expect(outcome.records).toHaveLength(1);
    expect(outcome.records[0]?.attempt).toBe(1);
    expect(outcome.records[0]?.outcome).toBe('admitted_some');
  });

  it('retries once on a whole-response schema failure, then admits the repaired response', async () => {
    const backend = new FixtureModelBackend([
      { kind: 'invalid_json' },
      { kind: 'json', body: [{ itemId: 'a', verdict: true }, { itemId: 'b', verdict: true }] },
    ]);
    const outcome = await classifyBatch(baseOptions({ backend }));
    expect(outcome.records).toHaveLength(2);
    expect(outcome.records[0]?.outcome).toBe('schema_invalid');
    expect(outcome.records[0]?.attempt).toBe(1);
    expect(outcome.records[1]?.outcome).toBe('admitted_some');
    expect(outcome.records[1]?.attempt).toBe(2);
    expect(outcome.admitted.size).toBe(2);
  });

  it('drops every requested item — never coerces — when the retry also fails schema', async () => {
    const backend = new FixtureModelBackend([{ kind: 'invalid_json' }, { kind: 'invalid_json' }]);
    const outcome = await classifyBatch(baseOptions({ backend }));
    expect(outcome.admitted.size).toBe(0);
    expect(outcome.rejected.get('a')).toMatch(/repair retry/);
    expect(outcome.rejected.get('b')).toMatch(/repair retry/);
    expect(outcome.records).toHaveLength(2);
  });

  it('abstains — never substitutes — when the backend is unavailable on the first attempt', async () => {
    const backend = new FixtureModelBackend([{ kind: 'throw', message: 'ECONNREFUSED' }]);
    const outcome = await classifyBatch(baseOptions({ backend }));
    expect(outcome.admitted.size).toBe(0);
    expect(outcome.rejected.get('a')).toMatch(/unavailable/);
    expect(outcome.rejected.get('b')).toMatch(/unavailable/);
    expect(outcome.records).toHaveLength(1);
    expect(outcome.records[0]?.outcome).toBe('backend_unavailable');
  });

  it('does not retry a second time for a backend outage on the retry attempt itself', async () => {
    const backend = new FixtureModelBackend([{ kind: 'invalid_json' }, { kind: 'throw' }]);
    const outcome = await classifyBatch(baseOptions({ backend }));
    expect(outcome.records).toHaveLength(2);
    expect(outcome.rejected.get('a')).toMatch(/unavailable/);
  });

  it('rejects a single malformed row without retrying or failing its well-formed neighbours', async () => {
    const backend = new FixtureModelBackend([
      { kind: 'json', body: [{ itemId: 'a', verdict: 'not-a-boolean' }, { itemId: 'b', verdict: true }] },
    ]);
    const outcome = await classifyBatch(baseOptions({ backend }));
    expect(outcome.admitted.get('b')).toEqual({ itemId: 'b', verdict: true });
    expect(outcome.rejected.has('a')).toBe(true);
    // Only one HTTP attempt was made — a bad row does not trigger the whole-batch retry.
    expect(outcome.records).toHaveLength(1);
  });

  it('rejects an item the model never answered for', async () => {
    const backend = new FixtureModelBackend([{ kind: 'json', body: [{ itemId: 'a', verdict: true }] }]);
    const outcome = await classifyBatch(baseOptions({ backend }));
    expect(outcome.admitted.get('a')).toEqual({ itemId: 'a', verdict: true });
    expect(outcome.rejected.get('b')).toMatch(/no admissible result/);
  });

  it('rejects an item the model answered for twice — never picks a winner', async () => {
    const backend = new FixtureModelBackend([
      {
        kind: 'json',
        body: [
          { itemId: 'a', verdict: true },
          { itemId: 'a', verdict: false },
          { itemId: 'b', verdict: true },
        ],
      },
    ]);
    const outcome = await classifyBatch(baseOptions({ backend }));
    expect(outcome.rejected.get('a')).toMatch(/2 results/);
    expect(outcome.admitted.get('b')).toEqual({ itemId: 'b', verdict: true });
  });

  it('ignores a row answering for an item nobody asked about', async () => {
    const backend = new FixtureModelBackend([
      {
        kind: 'json',
        body: [
          { itemId: 'a', verdict: true },
          { itemId: 'b', verdict: true },
          { itemId: 'z', verdict: true },
        ],
      },
    ]);
    const outcome = await classifyBatch(baseOptions({ backend }));
    expect(outcome.admitted.size).toBe(2);
    expect([...outcome.admitted.keys()].sort()).toEqual(['a', 'b']);
  });

  it('throws for a caller bug — an empty requested-items list', async () => {
    const backend = new FixtureModelBackend([{ kind: 'json', body: [] }]);
    await expect(classifyBatch(baseOptions({ backend, requestedIds: [] }))).rejects.toThrow(
      /no requested items/,
    );
  });

  it('records the method id, version, prompt version and temperature on every attempt', async () => {
    const backend = new FixtureModelBackend([{ kind: 'json', body: [{ itemId: 'a', verdict: true }, { itemId: 'b', verdict: true }] }]);
    const outcome: ClassifyBatchOutcome<Row> = await classifyBatch(baseOptions({ backend }));
    expect(outcome.records[0]).toMatchObject({
      methodId: 'test.method',
      methodVersion: '1.0.0',
      promptVersion: 'test.method@1',
      model: 'test-model',
      temperature: 0,
    });
  });

  it('records cost as null (UNPRICED) when the backend reports no usage', async () => {
    const backend = new FixtureModelBackend([{ kind: 'json', body: [{ itemId: 'a', verdict: true }, { itemId: 'b', verdict: true }] }]);
    const outcome = await classifyBatch(baseOptions({ backend }));
    expect(outcome.records[0]?.usage.costUsd).toBeNull();
  });
});
