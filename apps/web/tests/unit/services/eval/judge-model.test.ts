import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createFixtureEvalModelClient,
  systemEvalModelClientDeps,
  permissiveEvalModelBudgetGate,
  noopEvalModelCostSink,
  vendorOf,
  assertJudgeDiffersFromSynthesis,
  SameModelJudgeError,
  EvalModelFixtureNotFoundError,
  type EvalModelClientDeps,
} from '@/services/eval/judge-model';

function fixturesRootWith(task: string, fixtureCase: string, body: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'f12-llm-fixtures-'));
  mkdirSync(join(root, task), { recursive: true });
  writeFileSync(join(root, task, `${fixtureCase}.json`), JSON.stringify(body));
  return root;
}

function deps(overrides: Partial<EvalModelClientDeps> = {}): EvalModelClientDeps {
  return {
    ...systemEvalModelClientDeps,
    budgetGate: permissiveEvalModelBudgetGate,
    costSink: noopEvalModelCostSink,
    evalRunId: 'run-1',
    ...overrides,
  };
}

const echoSchema = z.object({ ok: z.boolean() });

describe('createFixtureEvalModelClient', () => {
  it('parses and validates a recorded fixture', async () => {
    const root = fixturesRootWith('judge', 'success', {
      status: 200,
      body: { modelId: 'google/gemini-fake', tokensIn: 10, tokensOut: 5, costUsd: '0.001000', content: JSON.stringify({ ok: true }) },
    });
    const client = createFixtureEvalModelClient(deps(), root);
    const result = await client.run({ task: 'judge', promptVersion: 'v1', system: 's', prompt: 'p', maxOutputTokens: 100 }, echoSchema);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ ok: true });
  });

  it('reports schema_invalid rather than coercing a malformed response', async () => {
    const root = fixturesRootWith('judge', 'malformed', {
      status: 200,
      body: { modelId: 'google/gemini-fake', tokensIn: 1, tokensOut: 1, costUsd: null, content: JSON.stringify({ wrong: 'shape' }) },
    });
    const client = createFixtureEvalModelClient(deps(), root);
    const result = await client.run(
      { task: 'judge', promptVersion: 'v1', system: 's', prompt: 'p', maxOutputTokens: 100, fixtureCase: 'malformed' },
      echoSchema,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('schema_invalid');
  });

  it('throws a named error rather than a bare ENOENT when no fixture was recorded', async () => {
    const root = mkdtempSync(join(tmpdir(), 'f12-llm-fixtures-empty-'));
    const client = createFixtureEvalModelClient(deps(), root);
    await expect(
      client.run({ task: 'judge', promptVersion: 'v1', system: 's', prompt: 'p', maxOutputTokens: 100, fixtureCase: 'nope' }, echoSchema),
    ).rejects.toThrow(EvalModelFixtureNotFoundError);
  });

  it('a denied budget short-circuits before dispatch, with no cost recorded', async () => {
    const root = fixturesRootWith('judge', 'success', { status: 200, body: { modelId: 'x', tokensIn: null, tokensOut: null, costUsd: null, content: '{}' } });
    let costCalls = 0;
    const client = createFixtureEvalModelClient(
      deps({ budgetGate: { check: async () => ({ allowed: false, message: 'over budget' }) }, costSink: async () => { costCalls += 1; } }),
      root,
    );
    const result = await client.run({ task: 'judge', promptVersion: 'v1', system: 's', prompt: 'p', maxOutputTokens: 100 }, echoSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('budget_denied');
    expect(costCalls).toBe(0);
  });

  it('an HTTP error status is reported as upstream, not coerced', async () => {
    const root = fixturesRootWith('judge', 'server_error', { status: 500, body: { modelId: 'x', tokensIn: null, tokensOut: null, costUsd: null, content: '' } });
    const client = createFixtureEvalModelClient(deps(), root);
    const result = await client.run({ task: 'judge', promptVersion: 'v1', system: 's', prompt: 'p', maxOutputTokens: 100, fixtureCase: 'server_error' }, echoSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: 'upstream', status: 500 });
  });
});

describe('vendorOf (re-exported from services/research/model-tasks)', () => {
  it('extracts the vendor prefix from a "<vendor>/<model>" id', () => {
    expect(vendorOf('openai/gpt-5.2')).toBe('openai');
    expect(vendorOf('no-slash-id')).toBeNull();
  });
});

describe('assertJudgeDiffersFromSynthesis', () => {
  it('is silent when the judge and synthesiser models differ', () => {
    expect(() => assertJudgeDiffersFromSynthesis('anthropic/claude-opus-5', 'openai/gpt-5.2')).not.toThrow();
  });

  it('throws SameModelJudgeError when the judge reuses the synthesis model id — F12 §4.3', () => {
    expect(() => assertJudgeDiffersFromSynthesis('openai/gpt-5.2', 'openai/gpt-5.2')).toThrow(SameModelJudgeError);
  });

  it('does not forbid same-vendor-different-model — F12 §4.3 says "a different model", not "a different vendor" (unlike D-34)', () => {
    expect(() => assertJudgeDiffersFromSynthesis('openai/gpt-5.2', 'openai/gpt-5-mini')).not.toThrow();
  });
});
