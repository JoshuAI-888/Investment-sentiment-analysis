import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFixtureModelClient, permissiveBudgetGate } from '@/services/llm/model-client';
import type { ModelClientDeps } from '@/services/llm/model-client';
import { classifyRelevance } from '@/services/evidence/relevance';

const FIXTURES_ROOT = join(process.cwd(), 'fixtures', 'llm');

function testDeps(): ModelClientDeps {
  return {
    budgetGate: permissiveBudgetGate,
    costSink: async () => {},
    callLogSink: async () => {},
    now: () => new Date('2026-09-04T00:00:00.000Z'),
    nextRequestId: (() => {
      let n = 0;
      return () => {
        n += 1;
        return `req-${String(n)}`;
      };
    })(),
  };
}

const INPUT = { itemId: 'item-1', symbol: 'AAPL', companyName: 'Apple Inc.', text: 'Apple launched a new product today.' };

describe('classifyRelevance', () => {
  it('returns ok on a clean success response', async () => {
    const client = createFixtureModelClient(testDeps(), FIXTURES_ROOT);
    const outcome = await classifyRelevance({ ...INPUT, fixtureCase: 'success' }, client);
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.verdict.relevant).toBe(true);
    expect(outcome.verdict.relevanceScore).toBeGreaterThan(0);
  });

  it('returns ok with relevant:false for a clean negative response, not unclear', async () => {
    const client = createFixtureModelClient(testDeps(), FIXTURES_ROOT);
    const outcome = await classifyRelevance({ ...INPUT, fixtureCase: 'irrelevant' }, client);
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.verdict.relevant).toBe(false);
  });

  it('retries once on a schema-invalid response and recovers if the repair is valid', async () => {
    const client = createFixtureModelClient(testDeps(), FIXTURES_ROOT);
    const outcome = await classifyRelevance({ ...INPUT, fixtureCase: 'invalid_schema' }, client);
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.verdict.relevant).toBe(true);
    expect(outcome.verdict.reason).toMatch(/Corrected/);
  });

  it('drops to unclear — never coerced — when both the original and the repair are invalid', async () => {
    const client = createFixtureModelClient(testDeps(), FIXTURES_ROOT);
    const outcome = await classifyRelevance({ ...INPUT, fixtureCase: 'malformed' }, client);
    expect(outcome.kind).toBe('unclear');
    if (outcome.kind !== 'unclear') return;
    expect(outcome.detail).toMatch(/schema-invalid twice/);
  });

  it('reports unclear on a non-schema failure (upstream) without attempting a repair call', async () => {
    const client = createFixtureModelClient(testDeps(), FIXTURES_ROOT);
    const outcome = await classifyRelevance({ ...INPUT, fixtureCase: 'server_error' }, client);
    expect(outcome.kind).toBe('unclear');
    if (outcome.kind !== 'unclear') return;
    expect(outcome.detail).toMatch(/model call failed: upstream/);
  });
});
