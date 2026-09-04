import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFixtureModelClient, permissiveBudgetGate } from '@/services/llm/model-client';
import type { ModelClientDeps } from '@/services/llm/model-client';
import { classifyCollision } from '@/services/evidence/entity-collision';

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

const INPUT = { itemId: 'item-1', token: 'AI', symbol: 'AI', companyName: 'C3.ai, Inc.', text: 'AI beat earnings estimates this quarter.' };

describe('classifyCollision', () => {
  it('confirms when context corroborates the ambiguous token', async () => {
    const client = createFixtureModelClient(testDeps(), FIXTURES_ROOT);
    const outcome = await classifyCollision({ ...INPUT, fixtureCase: 'confirmed' }, client);
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.verdict.confirmed).toBe(true);
  });

  it('does not confirm when context indicates the ordinary word, never assumed confirmed', async () => {
    const client = createFixtureModelClient(testDeps(), FIXTURES_ROOT);
    const outcome = await classifyCollision({ ...INPUT, token: 'IT', fixtureCase: 'rejected' }, client);
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.verdict.confirmed).toBe(false);
  });

  it('drops to unclear on a repeated schema-invalid response, never assumed confirmed', async () => {
    const client = createFixtureModelClient(testDeps(), FIXTURES_ROOT);
    const outcome = await classifyCollision({ ...INPUT, fixtureCase: 'malformed' }, client);
    expect(outcome.kind).toBe('unclear');
  });
});
