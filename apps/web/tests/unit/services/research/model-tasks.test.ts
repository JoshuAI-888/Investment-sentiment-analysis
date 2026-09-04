import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createFixtureResearchModelClient,
  systemResearchModelClientDeps,
  permissiveResearchModelBudgetGate,
  vendorOf,
  assertDifferentVendors,
  SameVendorVerifierError,
  ResearchModelFixtureNotFoundError,
  type ResearchModelClientDeps,
} from '@/services/research/model-tasks';

function fixturesRootWith(task: string, fixtureCase: string, body: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'f11-llm-fixtures-'));
  mkdirSync(join(root, task), { recursive: true });
  writeFileSync(join(root, task, `${fixtureCase}.json`), JSON.stringify(body));
  return root;
}

function deps(overrides: Partial<ResearchModelClientDeps> = {}): ResearchModelClientDeps {
  return {
    ...systemResearchModelClientDeps,
    budgetGate: permissiveResearchModelBudgetGate,
    costSink: async () => {},
    callLogSink: async () => {},
    runId: 'run-1',
    ...overrides,
  };
}

const echoSchema = z.object({ ok: z.boolean() });

describe('createFixtureResearchModelClient', () => {
  it('parses and validates a recorded fixture', async () => {
    const root = fixturesRootWith('synthesis', 'success', {
      status: 200,
      body: { modelId: 'openai/gpt-fake', tokensIn: 10, tokensOut: 5, costUsd: '0.001000', content: JSON.stringify({ ok: true }) },
    });
    const client = createFixtureResearchModelClient(deps(), root);
    const result = await client.run({ task: 'synthesis', promptVersion: 'v1', system: 's', prompt: 'p', maxOutputTokens: 100 }, echoSchema);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ ok: true });
  });

  it('reports schema_invalid rather than coercing a malformed response', async () => {
    const root = fixturesRootWith('verify', 'malformed', {
      status: 200,
      body: { modelId: 'openai/gpt-fake', tokensIn: 1, tokensOut: 1, costUsd: null, content: JSON.stringify({ wrong: 'shape' }) },
    });
    const client = createFixtureResearchModelClient(deps(), root);
    const result = await client.run(
      { task: 'verify', promptVersion: 'v1', system: 's', prompt: 'p', maxOutputTokens: 100, fixtureCase: 'malformed' },
      echoSchema,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('schema_invalid');
  });

  it('throws a named error rather than a bare ENOENT when no fixture was recorded', async () => {
    const root = mkdtempSync(join(tmpdir(), 'f11-llm-fixtures-empty-'));
    const client = createFixtureResearchModelClient(deps(), root);
    await expect(
      client.run({ task: 'followup', promptVersion: 'v1', system: 's', prompt: 'p', maxOutputTokens: 100, fixtureCase: 'nope' }, echoSchema),
    ).rejects.toThrow(ResearchModelFixtureNotFoundError);
  });

  it('short-circuits on a denied budget check before ever attempting to read a fixture', async () => {
    const root = mkdtempSync(join(tmpdir(), 'f11-llm-fixtures-unused-'));
    const client = createFixtureResearchModelClient(
      deps({ budgetGate: { check: async () => ({ allowed: false, scope: 'global', message: 'over the D-20 ceiling' }) } }),
      root,
    );
    const result = await client.run({ task: 'synthesis', promptVersion: 'v1', system: 's', prompt: 'p', maxOutputTokens: 100 }, echoSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('budget_denied');
      if (result.error.kind === 'budget_denied') expect(result.error.message).toContain('D-20');
    }
  });

  it('records a cost_event-shaped entry through the injected cost sink when the fixture is priced', async () => {
    const root = fixturesRootWith('synthesis', 'success', {
      status: 200,
      body: { modelId: 'openai/gpt-fake', tokensIn: 10, tokensOut: 5, costUsd: '0.002500', content: JSON.stringify({ ok: true }) },
    });
    const recorded: unknown[] = [];
    const client = createFixtureResearchModelClient(deps({ costSink: async (entry) => { recorded.push(entry); } }), root);
    await client.run({ task: 'synthesis', promptVersion: 'v1', system: 's', prompt: 'p', maxOutputTokens: 100 }, echoSchema);
    expect(recorded).toHaveLength(1);
    expect((recorded[0] as { costUsd: string }).costUsd).toBe('0.002500');
  });
});

describe('D-34 — vendorOf / assertDifferentVendors', () => {
  it('extracts the vendor prefix from a Gateway-shaped model id', () => {
    expect(vendorOf('openai/gpt-4o')).toBe('openai');
    expect(vendorOf('anthropic/claude-3-5-sonnet')).toBe('anthropic');
  });

  it('returns null for a model id with no vendor prefix', () => {
    expect(vendorOf('gpt-4o')).toBeNull();
  });

  it('allows two different declared vendors', () => {
    expect(() => assertDifferentVendors('openai/gpt-4o', 'anthropic/claude-3-5-sonnet')).not.toThrow();
  });

  it('throws when synthesis and verify resolve to the same vendor — the real, load-bearing D-34 check', () => {
    expect(() => assertDifferentVendors('openai/gpt-4o', 'openai/gpt-4o-mini')).toThrow(SameVendorVerifierError);
  });

  it('throws when both model ids carry no vendor prefix at all and are identical', () => {
    expect(() => assertDifferentVendors('gpt-4o', 'gpt-4o')).toThrow(SameVendorVerifierError);
  });
});
