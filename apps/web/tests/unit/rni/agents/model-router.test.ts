import { describe, expect, it, vi } from 'vitest';

import { RNI_PROMPT_REGISTRY } from '../../../../prompts/rni/registry';
import {
  createRniCitedSynthesisInferencePorts,
  createRniModelRouter,
  synthesizeCitedNarrative,
  type RniImmutableModelRunConfig,
  type RniModelTransport,
  type RniModelTransportRequest,
} from '../../../../src/rni/agents';
import {
  evidenceReader,
  NO_MATERIAL_CHALLENGE,
  SUPPORTED_ASSESSMENTS,
  synthesisRequest,
} from './fixtures';

const output = { assessments: [] } as const;

const config = (
  aiRoute: 'openai_direct' | 'vercel_ai_gateway' = 'openai_direct',
): RniImmutableModelRunConfig => ({
  runId: 'c0000000-0000-4000-8000-000000000001',
  configVersion: 'rni-config-v1',
  aiRoute,
  resolvedModels: [
    {
      task: 'rni_verification',
      provider: 'openai',
      modelId: aiRoute === 'openai_direct' ? 'configured-direct-model' : 'configured/gateway-model',
      modelRevision: 'configured-revision-2026-09-05',
      promptVersion: RNI_PROMPT_REGISTRY.rni_verification.promptVersion,
    },
    {
      task: 'rni_challenger',
      provider: 'openai',
      modelId: aiRoute === 'openai_direct' ? 'configured-direct-model' : 'configured/gateway-model',
      modelRevision: 'configured-revision-2026-09-05',
      promptVersion: RNI_PROMPT_REGISTRY.rni_challenger.promptVersion,
    },
  ],
});

const responseFor = (request: RniModelTransportRequest) => ({
  responseId: `response-${request.route}`,
  provider: request.provider,
  modelId: request.modelId,
  modelRevision: request.modelRevision,
  output,
  usage: {
    inputTokens: 120,
    outputTokens: 14,
    cachedInputTokens: 80,
    cacheWriteTokens: null,
  },
  latencyMs: 42,
  costUsd: '0.0012',
  toolCalls: [],
  citations: [],
});

const transport = (): RniModelTransport & { invoke: ReturnType<typeof vi.fn> } => ({
  invoke: vi.fn(async (request: RniModelTransportRequest) => responseFor(request)),
});

const invoke = (
  router: ReturnType<typeof createRniModelRouter>,
  runConfig: RniImmutableModelRunConfig,
  dynamicInput: unknown = { claims: ['claim-1'] },
  tenantCachePartition = 'tenant-hash-a',
) =>
  router.invoke({
    runConfig,
    task: 'rni_verification',
    scope: {
      modelRunId: 'c0000000-0000-4000-8000-000000000003',
      runId: runConfig.runId,
      stage: 'verification',
      securityId: 'c0000000-0000-4000-8000-000000000004',
      sourceItemIds: [],
      claimIds: [],
      assessmentCutoffAt: '2026-09-05T00:00:00.000Z',
    },
    tenantCachePartition,
    dynamicInput,
  });

describe('RNI model router', () => {
  it('uses the immutable Direct route and emits the complete canonical invocation envelope', async () => {
    const direct = transport();
    const gateway = transport();
    const result = await invoke(createRniModelRouter({ openaiDirect: direct, vercelAiGateway: gateway }), config());

    expect(direct.invoke).toHaveBeenCalledOnce();
    expect(gateway.invoke).not.toHaveBeenCalled();
    expect(direct.invoke.mock.calls[0]?.[0].outputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });
    expect(result).toMatchObject({
      route: 'openai_direct',
      provider: 'openai',
      modelId: 'configured-direct-model',
      output,
      usage: { cachedInputTokens: 80 },
      latencyMs: 42,
      costUsd: '0.0012',
    });
  });

  it('keeps Direct and Gateway payload/envelope semantics at parity while preserving route lineage', async () => {
    const direct = transport();
    const gateway = transport();
    const router = createRniModelRouter({ openaiDirect: direct, vercelAiGateway: gateway });
    const directResult = await invoke(router, config('openai_direct'));
    const gatewayResult = await invoke(router, config('vercel_ai_gateway'));

    expect(gateway.invoke).toHaveBeenCalledOnce();
    expect(directResult.output).toEqual(gatewayResult.output);
    expect(directResult.usage).toEqual(gatewayResult.usage);
    expect(directResult.stablePrefixHash).toBe(gatewayResult.stablePrefixHash);
    expect(gatewayResult).toMatchObject({
      route: 'vercel_ai_gateway',
      provider: 'openai',
      modelId: 'configured/gateway-model',
    });
  });

  it('places dynamic evidence after the reusable prefix so run IDs and evidence do not change its hash', async () => {
    const direct = transport();
    const router = createRniModelRouter({ openaiDirect: direct });
    const first = await invoke(router, config(), { claims: ['first'] });
    const second = await invoke(
      router,
      { ...config(), runId: 'c0000000-0000-4000-8000-000000000002' },
      { claims: ['second'], requestedAt: '2099-01-01T00:00:00.000Z' },
    );

    expect(first.stablePrefixHash).toBe(second.stablePrefixHash);
    expect(first.promptCacheKey).toBe(second.promptCacheKey);
    expect(first.dynamicInputHash).not.toBe(second.dynamicInputHash);
    expect(direct.invoke.mock.calls[0]?.[0].dynamicInput).not.toEqual(
      direct.invoke.mock.calls[1]?.[0].dynamicInput,
    );
  });

  it('partitions cache keys by tenant and route/model identity', async () => {
    const router = createRniModelRouter({ openaiDirect: transport(), vercelAiGateway: transport() });
    const base = await invoke(router, config());
    const tenant = await invoke(router, config(), {}, 'tenant-hash-b');
    const gateway = await invoke(router, config('vercel_ai_gateway'));

    expect(new Set([base.promptCacheKey, tenant.promptCacheKey, gateway.promptCacheKey])).toHaveLength(3);
  });

  it('fails closed on unavailable Gateway without silently falling back to Direct', async () => {
    const direct = transport();
    await expect(invoke(createRniModelRouter({ openaiDirect: direct }), config('vercel_ai_gateway'))).rejects.toThrow(
      /Gateway transport is unavailable/u,
    );
    expect(direct.invoke).not.toHaveBeenCalled();
  });

  it('rejects a non-OpenAI provider on the OpenAI Direct route before dispatch', async () => {
    const direct = transport();
    const runConfig = config();
    await expect(
      invoke(createRniModelRouter({ openaiDirect: direct }), {
        ...runConfig,
        resolvedModels: runConfig.resolvedModels.map((model) => ({
          ...model,
          provider: 'not-openai',
        })),
      }),
    ).rejects.toThrow(/OpenAI Direct requires/u);
    expect(direct.invoke).not.toHaveBeenCalled();
  });

  it('rejects missing/duplicate task resolution and prompt-version drift before transport', async () => {
    const direct = transport();
    const router = createRniModelRouter({ openaiDirect: direct });
    await expect(invoke(router, { ...config(), resolvedModels: [] })).rejects.toThrow(/resolve exactly once/u);
    await expect(
      invoke(router, {
        ...config(),
        resolvedModels: [...config().resolvedModels, config().resolvedModels[0]!],
      }),
    ).rejects.toThrow(/resolve exactly once/u);
    await expect(
      invoke(router, {
        ...config(),
        resolvedModels: config().resolvedModels.map((model) =>
          model.task === 'rni_verification' ? { ...model, promptVersion: 'unapproved-draft' } : model,
        ),
      }),
    ).rejects.toThrow(/Persisted prompt version/u);
    expect(direct.invoke).not.toHaveBeenCalled();
  });

  it('rejects silent provider/model changes, forbidden tools and invalid structured output', async () => {
    const changed = transport();
    changed.invoke.mockImplementationOnce(async (request: RniModelTransportRequest) => ({
      ...responseFor(request),
      modelId: 'silent-fallback-model',
    }));
    await expect(invoke(createRniModelRouter({ openaiDirect: changed }), config())).rejects.toThrow(/silently changed/u);

    const tool = transport();
    tool.invoke.mockImplementationOnce(async (request: RniModelTransportRequest) => ({
      ...responseFor(request),
      toolCalls: ['web_search'],
    }));
    await expect(invoke(createRniModelRouter({ openaiDirect: tool }), config())).rejects.toThrow(/forbidden tool/u);

    const invalid = transport();
    invalid.invoke.mockImplementationOnce(async (request: RniModelTransportRequest) => ({
      ...responseFor(request),
      output: { assessments: [], extra: 'forbidden' },
    }));
    await expect(
      createRniModelRouter({ openaiDirect: invalid }).invoke({
        runConfig: config(),
        task: 'rni_verification',
        scope: {
          modelRunId: 'c0000000-0000-4000-8000-000000000003',
          runId: config().runId,
          stage: 'verification',
          securityId: 'c0000000-0000-4000-8000-000000000004',
          sourceItemIds: [],
          claimIds: [],
          assessmentCutoffAt: '2026-09-05T00:00:00.000Z',
        },
        tenantCachePartition: 'tenant-hash-a',
        dynamicInput: {},
      }),
    ).rejects.toThrow();
  });

  it('adapts E08 verifier/challenger calls with separate persisted scopes and records both envelopes', async () => {
    const base = synthesisRequest();
    const runConfig: RniImmutableModelRunConfig = {
      ...config(),
      runId: base.convergenceArtifact.result.runId,
    };
    const request = {
      ...base,
      verificationInvocation: {
        ...base.verificationInvocation,
        modelId: 'configured-direct-model',
        promptVersion: RNI_PROMPT_REGISTRY.rni_verification.promptVersion,
      },
      challengerInvocation: {
        ...base.challengerInvocation,
        modelId: 'configured-direct-model',
        promptVersion: RNI_PROMPT_REGISTRY.rni_challenger.promptVersion,
      },
    };
    const direct: RniModelTransport = {
      invoke: async (call) => ({
        ...responseFor(call),
        output:
          call.task === 'rni_verification'
            ? { assessments: SUPPORTED_ASSESSMENTS }
            : NO_MATERIAL_CHALLENGE,
      }),
    };
    const recorded: Array<{ scope: { modelRunId: string; stage: string } }> = [];
    const ports = createRniCitedSynthesisInferencePorts(createRniModelRouter({ openaiDirect: direct }), {
      runConfig,
      tenantCachePartition: 'tenant-hash-a',
      recordInvocation: async (invocation) => {
        recorded.push(invocation);
      },
    });

    await synthesizeCitedNarrative(request, evidenceReader({ request }), ports.verifier, ports.challenger);
    expect(recorded.map(({ scope }) => [scope.modelRunId, scope.stage])).toEqual([
      [request.verificationInvocation.modelRunId, 'verification'],
      [request.challengerInvocation.modelRunId, 'challenger'],
    ]);
    expect(recorded.every(({ scope }) => scope.modelRunId.length > 0)).toBe(true);
  });
});
