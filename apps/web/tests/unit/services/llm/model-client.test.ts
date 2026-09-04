import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createFixtureModelClient, permissiveBudgetGate } from '@/services/llm/model-client';
import type { ModelCallLogEntry, ModelCostEntry } from '@/services/llm/ports';
import type { ModelClientDeps } from '@/services/llm/model-client';

const FIXTURES_ROOT = join(process.cwd(), 'fixtures', 'llm');

const schema = z.object({
  itemId: z.string(),
  relevant: z.boolean(),
  relevanceScore: z.number(),
  reason: z.string(),
});

function testDeps(overrides: Partial<ModelClientDeps> = {}): {
  deps: ModelClientDeps;
  logs: ModelCallLogEntry[];
  costs: ModelCostEntry[];
} {
  const logs: ModelCallLogEntry[] = [];
  const costs: ModelCostEntry[] = [];
  const deps: ModelClientDeps = {
    budgetGate: permissiveBudgetGate,
    costSink: async (entry) => {
      costs.push(entry);
    },
    callLogSink: async (entry) => {
      logs.push(entry);
    },
    now: () => new Date('2026-09-04T00:00:00.000Z'),
    nextRequestId: (() => {
      let n = 0;
      return () => {
        n += 1;
        return `req-${String(n)}`;
      };
    })(),
    ...overrides,
  };
  return { deps, logs, costs };
}

describe('createFixtureModelClient', () => {
  it('returns a parsed, schema-valid result and records cost + call log', async () => {
    const { deps, logs, costs } = testDeps();
    const client = createFixtureModelClient(deps, FIXTURES_ROOT);

    const result = await client.classify(
      { task: 'relevance', promptVersion: 'relevance-v1', system: 's', prompt: 'p', maxOutputTokens: 100, fixtureCase: 'success' },
      schema,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.relevant).toBe(true);
    expect(result.meta.promptVersion).toBe('relevance-v1');
    expect(result.meta.temperature).toBe('0');
    expect(logs).toHaveLength(1);
    expect(logs[0]?.task).toBe('relevance');
    expect(costs).toHaveLength(1);
    expect(costs[0]?.costUsd).toBe('0.000210');
  });

  it('reports schema_invalid when the content is not JSON, and never coerces a value', async () => {
    const { deps } = testDeps();
    const client = createFixtureModelClient(deps, FIXTURES_ROOT);

    const result = await client.classify(
      { task: 'relevance', promptVersion: 'relevance-v1', system: 's', prompt: 'p', maxOutputTokens: 100, fixtureCase: 'malformed' },
      schema,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('schema_invalid');
  });

  it('reports schema_invalid when JSON parses but violates the schema', async () => {
    const { deps } = testDeps();
    const client = createFixtureModelClient(deps, FIXTURES_ROOT);

    const result = await client.classify(
      { task: 'relevance', promptVersion: 'relevance-v1', system: 's', prompt: 'p', maxOutputTokens: 100, fixtureCase: 'invalid_schema' },
      schema,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('schema_invalid');
    if (result.error.kind === 'schema_invalid') {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  it('reports an upstream error on a non-200 status, without a schema question', async () => {
    const { deps } = testDeps();
    const client = createFixtureModelClient(deps, FIXTURES_ROOT);

    const result = await client.classify(
      { task: 'relevance', promptVersion: 'relevance-v1', system: 's', prompt: 'p', maxOutputTokens: 100, fixtureCase: 'server_error' },
      schema,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'upstream', status: 503 });
  });

  it('is budget-checked before dispatch: a denied budget never reads a fixture at all', async () => {
    const { deps, logs } = testDeps({ budgetGate: { check: async () => ({ allowed: false, scope: 'global' }) } });
    const client = createFixtureModelClient(deps, FIXTURES_ROOT);

    const result = await client.classify(
      { task: 'relevance', promptVersion: 'relevance-v1', system: 's', prompt: 'p', maxOutputTokens: 100, fixtureCase: 'this-fixture-does-not-exist' },
      schema,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'budget_denied', scope: 'global' });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.errorClass).toBe('budget_denied');
  });

  it('throws a named error for a case with no recorded fixture, never inventing one inline', async () => {
    const { deps } = testDeps();
    const client = createFixtureModelClient(deps, FIXTURES_ROOT);

    await expect(
      client.classify(
        { task: 'relevance', promptVersion: 'relevance-v1', system: 's', prompt: 'p', maxOutputTokens: 100, fixtureCase: 'nonexistent' },
        schema,
      ),
    ).rejects.toThrow(/no LLM fixture recorded/);
  });
});
