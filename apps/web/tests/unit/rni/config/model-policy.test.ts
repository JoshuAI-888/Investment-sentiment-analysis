import { describe, expect, it } from 'vitest';

import {
  RNI_BALANCED_MODEL_POLICY_VERSION,
  resolveRniBalancedModelPolicy,
  type RniModelCapability,
} from '../../../../src/rni/config';

const capability = (
  route: RniModelCapability['route'],
  providerModelId: RniModelCapability['providerModelId'],
  overrides: Partial<RniModelCapability> = {},
): RniModelCapability => ({
  route,
  configuredModelId:
    route === 'openai_direct' ? providerModelId : `configured-openai/${providerModelId}`,
  provider: 'openai',
  providerModelId,
  modelRevision: `${providerModelId}-2026-07-09`,
  capabilitySnapshotId: `catalogue-${route}-2026-09-05`,
  capabilityResponseHash: 'a'.repeat(64),
  observedAt: '2026-09-05T00:00:00.000Z',
  expiresAt: '2026-09-05T01:00:00.000Z',
  available: true,
  supportsResponses: true,
  supportsStructuredOutputs: true,
  supportsWebSearch: true,
  reasoningEfforts: ['low', 'medium'],
  ...overrides,
});

const catalogue = (): readonly RniModelCapability[] => [
  capability('openai_direct', 'gpt-5.6-terra'),
  capability('openai_direct', 'gpt-5.6-sol'),
  capability('vercel_ai_gateway', 'gpt-5.6-terra'),
  capability('vercel_ai_gateway', 'gpt-5.6-sol'),
];

describe('D-RNI-21 balanced model policy', () => {
  it('resolves Direct to Terra/low for collection semantics and Sol/low for adjudication', () => {
    const resolved = resolveRniBalancedModelPolicy({
      capabilities: catalogue(),
      now: '2026-09-05T00:30:00.000Z',
    });

    expect(resolved.aiRoute).toBe('openai_direct');
    expect(resolved.resolvedModels).toHaveLength(5);
    expect(
      resolved.resolvedModels.map(({ task, modelId, reasoningEffort, policyVersion }) => ({
        task,
        modelId,
        reasoningEffort,
        policyVersion,
      })),
    ).toEqual([
      { task: 'rni_discovery', modelId: 'gpt-5.6-terra', reasoningEffort: 'low', policyVersion: RNI_BALANCED_MODEL_POLICY_VERSION },
      { task: 'rni_relationship', modelId: 'gpt-5.6-terra', reasoningEffort: 'low', policyVersion: RNI_BALANCED_MODEL_POLICY_VERSION },
      { task: 'rni_classifier', modelId: 'gpt-5.6-terra', reasoningEffort: 'low', policyVersion: RNI_BALANCED_MODEL_POLICY_VERSION },
      { task: 'rni_verification', modelId: 'gpt-5.6-sol', reasoningEffort: 'low', policyVersion: RNI_BALANCED_MODEL_POLICY_VERSION },
      { task: 'rni_challenger', modelId: 'gpt-5.6-sol', reasoningEffort: 'low', policyVersion: RNI_BALANCED_MODEL_POLICY_VERSION },
    ]);
  });

  it('uses only the capability-catalogue Gateway slugs for same-family parity', () => {
    const resolved = resolveRniBalancedModelPolicy({
      aiRoute: 'vercel_ai_gateway',
      capabilities: catalogue(),
      now: '2026-09-05T00:30:00.000Z',
    });

    expect(resolved.resolvedModels.map(({ modelId }) => modelId)).toEqual([
      'configured-openai/gpt-5.6-terra',
      'configured-openai/gpt-5.6-terra',
      'configured-openai/gpt-5.6-terra',
      'configured-openai/gpt-5.6-sol',
      'configured-openai/gpt-5.6-sol',
    ]);
    expect(resolved.resolvedModels.every(({ provider }) => provider === 'openai')).toBe(true);
  });

  it.each<readonly [string, Partial<RniModelCapability>]>([
    ['unavailable model', { available: false }],
    ['missing structured output', { supportsStructuredOutputs: false }],
    ['missing low reasoning', { reasoningEfforts: ['medium'] }],
    ['missing Responses API', { supportsResponses: false }],
  ])('fails closed for %s', (_name, overrides) => {
    const capabilities = catalogue().map((entry) =>
      entry.route === 'vercel_ai_gateway' && entry.providerModelId === 'gpt-5.6-sol'
        ? capability('vercel_ai_gateway', 'gpt-5.6-sol', overrides)
        : entry,
    );
    expect(() =>
      resolveRniBalancedModelPolicy({
        aiRoute: 'vercel_ai_gateway',
        capabilities,
        now: '2026-09-05T00:30:00.000Z',
      }),
    ).toThrow();
  });

  it('fails closed when the discovery model cannot use governed Web Search', () => {
    const capabilities = catalogue().map((entry) =>
      entry.route === 'openai_direct' && entry.providerModelId === 'gpt-5.6-terra'
        ? capability('openai_direct', 'gpt-5.6-terra', { supportsWebSearch: false })
        : entry,
    );
    expect(() =>
      resolveRniBalancedModelPolicy({
        aiRoute: 'openai_direct',
        capabilities,
        now: '2026-09-05T00:30:00.000Z',
      }),
    ).toThrow(/Web Search/u);
  });

  it('rejects duplicate or missing capability identities instead of guessing', () => {
    const duplicate = [
      ...catalogue(),
      capability('vercel_ai_gateway', 'gpt-5.6-terra', {
        configuredModelId: 'another-configured-slug',
      }),
    ];
    expect(() =>
      resolveRniBalancedModelPolicy({
        aiRoute: 'vercel_ai_gateway',
        capabilities: duplicate,
        now: '2026-09-05T00:30:00.000Z',
      }),
    ).toThrow(/exactly one capability/u);

    const missing = catalogue().filter(
      ({ route, providerModelId }) =>
        !(route === 'openai_direct' && providerModelId === 'gpt-5.6-sol'),
    );
    expect(() =>
      resolveRniBalancedModelPolicy({
        aiRoute: 'openai_direct',
        capabilities: missing,
        now: '2026-09-05T00:30:00.000Z',
      }),
    ).toThrow(/exactly one capability/u);
  });

  it('rejects an expired capability snapshot', () => {
    expect(() =>
      resolveRniBalancedModelPolicy({
        aiRoute: 'vercel_ai_gateway',
        capabilities: catalogue(),
        now: '2026-09-05T01:00:00.000Z',
      }),
    ).toThrow(/stale/u);
  });

  it('rejects a Gateway catalogue entry that claims a non-OpenAI provider', () => {
    const capabilities = catalogue().map((entry) =>
      entry.route === 'vercel_ai_gateway' && entry.providerModelId === 'gpt-5.6-sol'
        ? ({ ...entry, provider: 'azure' } as unknown as RniModelCapability)
        : entry,
    );
    expect(() =>
      resolveRniBalancedModelPolicy({
        aiRoute: 'vercel_ai_gateway',
        capabilities,
        now: '2026-09-05T00:30:00.000Z',
      }),
    ).toThrow();
  });

  it.each(['gpt-5.6-terra', 'gpt-5.6-sol'] as const)(
    'rejects a Direct %s dispatch ID that differs from its approved canonical model',
    (providerModelId) => {
      const capabilities = catalogue().map((entry) =>
        entry.route === 'openai_direct' && entry.providerModelId === providerModelId
          ? { ...entry, configuredModelId: `different-${providerModelId}` }
          : entry,
      );
      expect(() =>
        resolveRniBalancedModelPolicy({
          capabilities,
          now: '2026-09-05T00:30:00.000Z',
        }),
      ).toThrow(/Direct dispatch identity/u);
    },
  );
});
