import { describe, expect, it } from 'vitest';

import { RNI_PROMPT_REGISTRY } from '../../../prompts/rni/registry';
import { createRniModelRouter } from '../../../src/rni/agents';
import { rniRunRequest } from '../../../src/rni/contracts';

describe('RNI provider-neutral model boundary', () => {
  it('inherits the frozen OpenAI Direct default and exposes no hardcoded model or credential', async () => {
    const run = rniRunRequest.parse({
      idempotencyKey: 'rni-e09-direct-default',
      trigger: 'manual',
      ticker: 'NVDA',
      windowStart: '2026-09-04T00:00:00.000Z',
      windowEnd: '2026-09-05T00:00:00.000Z',
      comparisonStart: null,
      comparisonEnd: null,
    });
    expect(run.aiRoute).toBe('openai_direct');
    expect(JSON.stringify(RNI_PROMPT_REGISTRY)).not.toMatch(/api[_-]?key|bearer|https?:\/\//iu);
    expect(JSON.stringify(RNI_PROMPT_REGISTRY)).not.toMatch(/gpt-|claude-|gemini-/iu);

    const routerSource = createRniModelRouter.toString();
    expect(routerSource).not.toMatch(/gateway\.ai|api[_-]?key|bearer/iu);
  });

  it('pins versioned injection-resistant, no-tool verifier and challenger prefixes', () => {
    for (const definition of Object.values(RNI_PROMPT_REGISTRY)) {
      expect(definition.promptVersion).toMatch(/^rni-.+-v\d+$/u);
      expect(definition.schemaVersion).toMatch(/^rni-.+-schema-v\d+$/u);
      expect(definition.toolVersion).toBe('rni-no-tools-v1');
      expect(definition.tools).toEqual([]);
      expect(definition.systemPolicy).toMatch(/untrusted data/u);
      expect(definition.systemPolicy).toMatch(/structured fields only/u);
      expect(definition.finalInstruction).not.toHaveLength(0);
      expect(definition.limits.maxOutputTokens).toBeGreaterThan(0);
      expect(definition.limits.maxRetries).toBeLessThanOrEqual(1);
    }
    expect(RNI_PROMPT_REGISTRY.rni_verification.systemPolicy).toMatch(
      /not independent factual verification/u,
    );
  });
});
