import { describe, expect, it, vi } from 'vitest';

import {
  RNI_PROMPT_HISTORY,
  RNI_PROMPT_REGISTRY,
} from '../../../../prompts/rni/registry';
import {
  createRniCitedSynthesisInferencePorts,
  createRniModelRouter,
  createRniObservationInferencePorts,
  createRniRoutedRedditDiscovery,
  synthesizeCitedNarrative,
  type RniImmutableModelRunConfig,
  type RniModelInvocationRecorder,
  type RniModelTransport,
  type RniModelTransportRequest,
} from '../../../../src/rni/agents';
import type { OpenAiResponsesTransport } from '../../../../src/rni/discovery';
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
      task: 'rni_discovery',
      provider: 'openai',
      modelId: aiRoute === 'openai_direct' ? 'configured-direct-model' : 'configured/gateway-model',
      modelRevision: 'configured-revision-2026-09-05',
      promptVersion: RNI_PROMPT_REGISTRY.rni_discovery.promptVersion,
    },
    {
      task: 'rni_relationship',
      provider: 'openai',
      modelId: aiRoute === 'openai_direct' ? 'configured-direct-model' : 'configured/gateway-model',
      modelRevision: 'configured-revision-2026-09-05',
      promptVersion: RNI_PROMPT_REGISTRY.rni_relationship.promptVersion,
    },
    {
      task: 'rni_classifier',
      provider: 'openai',
      modelId: aiRoute === 'openai_direct' ? 'configured-direct-model' : 'configured/gateway-model',
      modelRevision: 'configured-revision-2026-09-05',
      promptVersion: RNI_PROMPT_REGISTRY.rni_classifier.promptVersion,
    },
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

const discoveryTransport = (): OpenAiResponsesTransport & { create: ReturnType<typeof vi.fn> } => ({
  create: vi.fn(async (request) => ({
    id: `discovery-${request.model}`,
    status: 'completed',
    model: request.model,
    output: [
      {
        id: `search-${request.model}`,
        type: 'web_search_call',
        status: 'completed',
        action: { type: 'search', sources: [] },
      },
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: JSON.stringify({ candidates: [], limitations: ['No eligible fixture result.'] }),
            annotations: [],
          },
        ],
      },
    ],
    usage: { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 3 } },
  })),
});

const recording = () => {
  const starts: unknown[] = [];
  const finishes: unknown[] = [];
  const recorder: RniModelInvocationRecorder = {
    start: vi.fn(async (attempt) => {
      starts.push(attempt);
    }),
    finish: vi.fn(async (result) => {
      finishes.push(result);
    }),
  };
  return { recorder, starts, finishes };
};

const verificationInput = (runConfig = config(), facts: unknown = {}) => {
  const resolvedModel = runConfig.resolvedModels.find(({ task }) => task === 'rni_verification') ??
    config().resolvedModels.find(({ task }) => task === 'rni_verification')!;
  return {
    policy: {
      version: 'rni-verification-policy-v1',
      sourceContentTreatment: 'untrusted_data' as const,
      allowedTools: [] as const,
      outputTextPublication: 'forbidden_structured_verdicts_only' as const,
    },
    invocation: {
    modelRunId: 'c0000000-0000-4000-8000-000000000003',
    stage: 'verification' as const,
    runId: runConfig.runId,
    securityId: 'c0000000-0000-4000-8000-000000000004',
      modelId: resolvedModel.modelId,
      promptVersion: resolvedModel.promptVersion,
    policyVersion: 'policy-v1',
    rightsPolicyVersion: 'rights-v1',
    claimIds: [],
    assessmentCutoffAt: '2026-09-05T00:00:00.000Z',
    },
    runId: runConfig.runId,
    securityId: 'c0000000-0000-4000-8000-000000000004',
    convergenceFacts: {
      ...synthesisRequest().convergenceArtifact.result,
      methodologyVersion:
        Object.keys(facts as object).length === 0 ? 'convergence-v1' : JSON.stringify(facts),
    },
    claimInputs: [],
  };
};

const invoke = (
  router: ReturnType<typeof createRniModelRouter>,
  runConfig: RniImmutableModelRunConfig,
  dynamicInput?: unknown,
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
    dynamicInput: dynamicInput ?? verificationInput(runConfig),
  });

describe('RNI model router', () => {
  it('routes Reddit Web Search through the immutable run route and records governed tool lineage', async () => {
    const direct = discoveryTransport();
    const gateway = discoveryTransport();
    const records = recording();
    const input = {
      queryId: 'c0000000-0000-4000-8000-000000000031',
      mode: 'on_demand_security' as const,
      windowStart: '2026-09-04T00:00:00.000Z',
      windowEnd: '2026-09-05T00:00:00.000Z',
      communities: ['r/stocks'],
      securities: [{ ticker: 'NVDA', companyName: 'NVIDIA', aliases: ['NVIDIA'] }],
      maxCandidates: 20,
    };
    const routed = createRniRoutedRedditDiscovery({
      runConfig: config('vercel_ai_gateway'),
      tenantCachePartition: 'tenant-hash-a',
      openaiDirect: direct,
      vercelAiGateway: gateway,
      recorder: records.recorder,
      modelRunIdForQuery: () => 'c0000000-0000-4000-8000-000000000032',
    });

    await expect(routed.discover(input)).resolves.toMatchObject({
      queryId: input.queryId,
      resolvedModel: 'configured/gateway-model',
    });
    expect(direct.create).not.toHaveBeenCalled();
    expect(gateway.create).toHaveBeenCalledOnce();
    expect(records.starts).toHaveLength(1);
    expect(records.finishes).toHaveLength(1);
    expect(records.starts[0]).toMatchObject({
      task: 'rni_discovery',
      route: 'vercel_ai_gateway',
      toolVersion: 'rni-openai-web-search-v1',
      limits: { maxToolCalls: 3, maxRetries: 0 },
      tools: [{ type: 'web_search', filters: { allowed_domains: ['reddit.com'] } }],
    });
    const directRecords = recording();
    await createRniRoutedRedditDiscovery({
      runConfig: config(),
      tenantCachePartition: 'tenant-hash-a',
      openaiDirect: direct,
      vercelAiGateway: gateway,
      recorder: directRecords.recorder,
      modelRunIdForQuery: () => 'c0000000-0000-4000-8000-000000000033',
    }).discover(input);
    expect(direct.create).toHaveBeenCalledOnce();
    expect(gateway.create).toHaveBeenCalledOnce();
    expect(directRecords.starts[0]).toMatchObject({ task: 'rni_discovery', route: 'openai_direct' });

    const invalidRecords = recording();
    const invalidTransport = discoveryTransport();
    await expect(
      createRniRoutedRedditDiscovery({
        runConfig: config(),
        tenantCachePartition: 'tenant-hash-a',
        openaiDirect: invalidTransport,
        recorder: invalidRecords.recorder,
        modelRunIdForQuery: () => 'not-a-uuid',
      }).discover(input),
    ).rejects.toThrow();
    expect(invalidRecords.starts).toHaveLength(0);
    expect(invalidTransport.create).not.toHaveBeenCalled();

    const historicalTransport = discoveryTransport();
    const historicalConfig = {
      ...config(),
      resolvedModels: config().resolvedModels.map((model) =>
        model.task === 'rni_discovery' ? { ...model, promptVersion: 'rni-discovery-v1' } : model,
      ),
    };
    await createRniRoutedRedditDiscovery({
      runConfig: historicalConfig,
      tenantCachePartition: 'tenant-hash-a',
      openaiDirect: historicalTransport,
      recorder: recording().recorder,
      modelRunIdForQuery: () => 'c0000000-0000-4000-8000-000000000034',
    }).discover(input);
    const historicalRequest = historicalTransport.create.mock.calls[0]?.[0];
    expect(historicalRequest.instructions).toMatch(/Discover sampled Reddit candidate URLs/u);
    expect(historicalRequest.input).toMatch(/Return sampled candidates and disclose search limitations\.$/u);
  });

  it('uses the immutable Direct route and emits the complete canonical invocation envelope', async () => {
    const direct = transport();
    const gateway = transport();
    const result = await invoke(
      createRniModelRouter({ openaiDirect: direct, vercelAiGateway: gateway, recorder: recording().recorder }),
      config(),
    );

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
    const router = createRniModelRouter({
      openaiDirect: direct,
      vercelAiGateway: gateway,
      recorder: recording().recorder,
    });
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
    const router = createRniModelRouter({ openaiDirect: direct, recorder: recording().recorder });
    const firstConfig = config();
    const first = await invoke(router, firstConfig, verificationInput(firstConfig, { claims: ['first'] }));
    const secondConfig = {
      ...config(),
      runId: 'c0000000-0000-4000-8000-000000000002',
    };
    const second = await invoke(
      router,
      secondConfig,
      verificationInput(secondConfig, { claims: ['second'] }),
    );

    expect(first.stablePrefixHash).toBe(second.stablePrefixHash);
    expect(first.promptCacheKey).toBe(second.promptCacheKey);
    expect(first.dynamicInputHash).not.toBe(second.dynamicInputHash);
    expect(direct.invoke.mock.calls[0]?.[0].dynamicSuffix).not.toEqual(
      direct.invoke.mock.calls[1]?.[0].dynamicSuffix,
    );
    expect(direct.invoke.mock.calls[0]?.[0].dynamicSuffix).toMatch(
      /^<rni_dynamic_input version="1">\n.*\n<\/rni_dynamic_input>\nReturn one assessment/u,
    );
  });

  it('partitions cache keys by tenant and route/model identity', async () => {
    const router = createRniModelRouter({
      openaiDirect: transport(),
      vercelAiGateway: transport(),
      recorder: recording().recorder,
    });
    const base = await invoke(router, config());
    const tenant = await invoke(router, config(), undefined, 'tenant-hash-b');
    const gateway = await invoke(router, config('vercel_ai_gateway'));

    expect(new Set([base.promptCacheKey, tenant.promptCacheKey, gateway.promptCacheKey])).toHaveLength(3);
  });

  it('replays an exact historical prompt version after a successor exists', async () => {
    const records = recording();
    const router = createRniModelRouter({ openaiDirect: transport(), recorder: records.recorder });
    const currentConfig = config();
    const historicalConfig = {
      ...currentConfig,
      resolvedModels: currentConfig.resolvedModels.map((model) =>
        model.task === 'rni_verification'
          ? { ...model, promptVersion: 'rni-verification-v1' }
          : model,
      ),
    };
    const historical = await invoke(router, historicalConfig, verificationInput(historicalConfig));
    const current = await invoke(router, currentConfig);

    expect(historical.promptVersion).toBe('rni-verification-v1');
    expect(current.promptVersion).toBe('rni-verification-v2');
    expect(historical.stablePrefixHash).not.toBe(current.stablePrefixHash);
  });

  it('fails closed on unavailable Gateway without silently falling back to Direct', async () => {
    const direct = transport();
    await expect(invoke(createRniModelRouter({ openaiDirect: direct, recorder: recording().recorder }), config('vercel_ai_gateway'))).rejects.toThrow(
      /Gateway transport is unavailable/u,
    );
    expect(direct.invoke).not.toHaveBeenCalled();
  });

  it('rejects a non-OpenAI provider on the OpenAI Direct route before dispatch', async () => {
    const direct = transport();
    const runConfig = config();
    await expect(
      invoke(createRniModelRouter({ openaiDirect: direct, recorder: recording().recorder }), {
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
    const router = createRniModelRouter({ openaiDirect: direct, recorder: recording().recorder });
    await expect(invoke(router, { ...config(), resolvedModels: [] })).rejects.toThrow(/resolve exactly once/u);
    await expect(
      invoke(router, {
        ...config(),
        resolvedModels: [
          ...config().resolvedModels,
          config().resolvedModels.find(({ task }) => task === 'rni_verification')!,
        ],
      }),
    ).rejects.toThrow(/resolve exactly once/u);
    await expect(
      invoke(router, {
        ...config(),
        resolvedModels: config().resolvedModels.map((model) =>
          model.task === 'rni_verification' ? { ...model, promptVersion: 'unapproved-draft' } : model,
        ),
      }),
    ).rejects.toThrow(/Unknown or duplicate RNI prompt/u);
    expect(direct.invoke).not.toHaveBeenCalled();
  });

  it('rejects silent provider/model changes, forbidden tools and invalid structured output', async () => {
    const changed = transport();
    changed.invoke.mockImplementationOnce(async (request: RniModelTransportRequest) => ({
      ...responseFor(request),
      modelId: 'silent-fallback-model',
    }));
    await expect(invoke(createRniModelRouter({ openaiDirect: changed, recorder: recording().recorder }), config())).rejects.toThrow(/silently changed/u);

    const tool = transport();
    tool.invoke.mockImplementationOnce(async (request: RniModelTransportRequest) => ({
      ...responseFor(request),
      toolCalls: ['web_search'],
    }));
    await expect(invoke(createRniModelRouter({ openaiDirect: tool, recorder: recording().recorder }), config())).rejects.toThrow(/forbidden tool/u);

    const invalidOutput = transport();
    invalidOutput.invoke.mockImplementationOnce(async (request: RniModelTransportRequest) => ({
      ...responseFor(request),
      output: { assessments: [], extra: 'forbidden' },
    }));
    await expect(
      invoke(
        createRniModelRouter({
          openaiDirect: invalidOutput,
          recorder: recording().recorder,
        }),
        config(),
      ),
    ).rejects.toThrow();

    const invalidInput = transport();
    await expect(
      createRniModelRouter({
        openaiDirect: invalidInput,
        recorder: recording().recorder,
      }).invoke({
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
        dynamicInput: { ...verificationInput(config()), extra: 'forbidden' },
      }),
    ).rejects.toThrow();
    expect(invalidInput.invoke).not.toHaveBeenCalled();

    const nestedInvalidInput = transport();
    const validInput = verificationInput(config());
    await expect(
      invoke(
        createRniModelRouter({
          openaiDirect: nestedInvalidInput,
          recorder: recording().recorder,
        }),
        config(),
        { ...validInput, policy: { ...validInput.policy, injected: true } },
      ),
    ).rejects.toThrow();
    expect(nestedInvalidInput.invoke).not.toHaveBeenCalled();
  });

  it('durably starts and finalizes a failed preallocated invocation before propagating it', async () => {
    const records = recording();
    const failed: RniModelTransport = {
      invoke: vi.fn(async () => {
        throw new Error('provider unavailable');
      }),
    };
    await expect(
      invoke(createRniModelRouter({ openaiDirect: failed, recorder: records.recorder }), config()),
    ).rejects.toThrow('provider unavailable');

    expect(records.starts).toHaveLength(1);
    expect(records.finishes).toHaveLength(1);
    expect(records.finishes[0]).toMatchObject({
      status: 'failed',
      attempt: {
        toolVersion: 'rni-no-tools-v1',
        limits: { maxOutputTokens: 2_000, timeoutMs: 30_000, maxRetries: 0 },
      },
      error: { message: 'provider unavailable' },
    });
  });

  it('never double-finalizes when either success or failure finalization throws', async () => {
    const successFinish = vi.fn(async () => {
      throw new Error('success persistence failed');
    });
    await expect(
      invoke(
        createRniModelRouter({
          openaiDirect: transport(),
          recorder: { start: vi.fn(async () => undefined), finish: successFinish },
        }),
        config(),
      ),
    ).rejects.toThrow('success persistence failed');
    expect(successFinish).toHaveBeenCalledOnce();

    const providerError = new Error('provider unavailable');
    const failureFinish = vi.fn(async () => {
      throw new Error('failure persistence failed');
    });
    await expect(
      invoke(
        createRniModelRouter({
          openaiDirect: {
            invoke: vi.fn(async () => {
              throw providerError;
            }),
          },
          recorder: { start: vi.fn(async () => undefined), finish: failureFinish },
        }),
        config(),
      ),
    ).rejects.toMatchObject({ cause: providerError });
    expect(failureFinish).toHaveBeenCalledOnce();
  });

  it('deep-freezes active and historical prompt definitions', () => {
    expect(Object.isFrozen(RNI_PROMPT_HISTORY)).toBe(true);
    expect(Object.isFrozen(RNI_PROMPT_REGISTRY)).toBe(true);
    expect(Object.isFrozen(RNI_PROMPT_REGISTRY.rni_verification)).toBe(true);
    expect(Object.isFrozen(RNI_PROMPT_REGISTRY.rni_classifier.outputSchema)).toBe(true);
    expect(() => {
      (RNI_PROMPT_REGISTRY.rni_verification as { promptVersion: string }).promptVersion =
        'tampered';
    }).toThrow();
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
    const records = recording();
    const ports = createRniCitedSynthesisInferencePorts(createRniModelRouter({ openaiDirect: direct, recorder: records.recorder }), {
      runConfig,
      tenantCachePartition: 'tenant-hash-a',
    });

    await synthesizeCitedNarrative(request, evidenceReader({ request }), ports.verifier, ports.challenger);
    const succeeded = records.finishes.filter(
      (value): value is { status: 'succeeded'; scope: { modelRunId: string; stage: string } } =>
        typeof value === 'object' && value !== null && 'status' in value && value.status === 'succeeded',
    );
    expect(succeeded.map(({ scope }) => [scope.modelRunId, scope.stage])).toEqual([
      [request.verificationInvocation.modelRunId, 'verification'],
      [request.challengerInvocation.modelRunId, 'challenger'],
    ]);
    expect(succeeded.every(({ scope }) => scope.modelRunId.length > 0)).toBe(true);
  });

  it('routes the active relationship and per-security classifier ports through the same boundary', async () => {
    const runConfig = config();
    const records = recording();
    const sourceItemId = 'c0000000-0000-4000-8000-000000000021';
    const securityId = 'c0000000-0000-4000-8000-000000000022';
    const mention = {
      id: 'c0000000-0000-4000-8000-000000000023',
      sourceItemId,
      securityId,
      mentionText: 'NVDA',
      startOffset: 0,
      endOffset: 4,
      resolutionMethod: 'exact_ticker' as const,
      resolutionConfidence: '1',
      modelRunId: null,
    };
    const classifierOutput = {
      stance: 'insufficient',
      stanceScore: null,
      relevance: '0',
      claimSummary: 'Insufficient relevant evidence.',
      timeHorizon: null,
      dimensions: [
        'company_fundamentals',
        'market_trading',
        'catalyst_event',
        'retail_narrative',
      ].map((dimension) => ({
        supportStart: null,
        supportEnd: null,
        dimension,
        stance: 'insufficient',
        score: null,
        rationale: 'Insufficient evidence.',
      })),
      claims: [],
      themes: [],
      noise: {
        supportStart: 0,
        supportEnd: 4,
        isSarcastic: false,
        sarcasmProbability: '0',
        isMeme: false,
        memeProbability: '0',
        isSpam: false,
        spamProbability: '0',
        informationValue: '0',
        assertionStrength: '0',
        evidenceQuality: '0',
        uncertainty: '1',
        exclusionReason: null,
      },
    };
    const direct: RniModelTransport = {
      invoke: async (call) => ({
        ...responseFor(call),
        output: call.task === 'rni_relationship' ? { relationships: [] } : classifierOutput,
      }),
    };
    const ports = createRniObservationInferencePorts(
      createRniModelRouter({ openaiDirect: direct, recorder: records.recorder }),
      {
        runConfig,
        tenantCachePartition: 'tenant-hash-a',
        relationshipModelRunIdForSource: () =>
          'c0000000-0000-4000-8000-000000000024',
      },
    );

    await expect(
      ports.relationship.infer({
        sourceItemId,
        boundedContent: 'NVDA versus AMD',
        mentions: [
          mention,
          {
            ...mention,
            id: 'c0000000-0000-4000-8000-000000000026',
            securityId: 'c0000000-0000-4000-8000-000000000027',
            mentionText: 'AMD',
            startOffset: 12,
            endOffset: 15,
          },
        ],
        candidates: [
          { id: securityId, symbol: 'NVDA', name: 'NVIDIA', exchange: 'NASDAQ', aliases: [], active: true },
          { id: 'c0000000-0000-4000-8000-000000000027', symbol: 'AMD', name: 'AMD', exchange: 'NASDAQ', aliases: [], active: true },
        ],
      }),
    ).resolves.toEqual({ relationships: [] });
    await expect(
      ports.classifier.infer({
        modelRunId: 'c0000000-0000-4000-8000-000000000025',
        policy: {
          sourceContentTreatment: 'untrusted_data',
          allowedTools: [],
          classification: {
            version: 'classification-v1',
            schemaVersion: 'classification-schema-v1',
            neutralMaxAbsoluteScore: '0.1',
            strongMinAbsoluteScore: '0.6',
            binaryLabelThreshold: '0.5',
          },
        },
        promptVersion: RNI_PROMPT_REGISTRY.rni_classifier.promptVersion,
        modelId: 'configured-direct-model',
        sourceItemId,
        platform: 'reddit',
        untrustedBoundedContent: 'NVDA',
        targetSecurityId: securityId,
        targetMentions: [mention],
        contextMentions: [],
        taxonomy: { version: 'taxonomy-v1', categories: [] },
      }),
    ).resolves.toMatchObject({ stance: 'insufficient' });
    expect(
      records.starts.map((value) =>
        typeof value === 'object' && value !== null && 'task' in value ? value.task : null,
      ),
    ).toEqual(['rni_relationship', 'rni_classifier']);
  });
});
