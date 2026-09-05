import { describe, expect, it, vi } from 'vitest';

import type {
  RniCanonicalModelInvocation,
  RniFailedModelInvocation,
  RniModelInvocationAttempt,
  RniModelTransportRequest,
} from '../../../src/rni/agents';
import type { OpenAiWebSearchRequest } from '../../../src/rni/discovery';
import {
  createRniBudgetInvocationRecorder,
  loadRniImmutableModelRunConfig,
  RniAiBudgetDeniedError,
  RniResponsesHttpTransport,
  type RniBudgetStore,
} from '../../../src/services/jobs/rni-model-runtime';
import type { RniModelRunRouteRow } from '../../../src/repositories/versions';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_RUN_ID = '22222222-2222-4222-8222-222222222222';
const HASH = 'a'.repeat(64);

const identity = {
  configuredModelId: 'gpt-5.6-terra',
  canonicalProviderModelId: 'gpt-5.6-terra',
  modelRevision: 'gpt-5.6-terra-2026-07-09',
} as const;

const gatewayIdentity = {
  ...identity,
  configuredModelId: 'openai/gpt-5.6-terra',
} as const;

const responseBody = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  id: 'resp_1',
  status: 'completed',
  model: identity.modelRevision,
  output: [
    {
      type: 'message',
      content: [{ type: 'output_text', text: '{"accepted":true}', annotations: [] }],
    },
  ],
  usage: {
    input_tokens: 120,
    output_tokens: 30,
    input_tokens_details: { cached_tokens: 80, cache_write_tokens: 0 },
  },
  ...overrides,
});

const okFetch = (body: unknown) =>
  vi.fn(
    async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );

const transportRequest = (
  overrides: Partial<RniModelTransportRequest> = {},
): RniModelTransportRequest => ({
  route: 'openai_direct',
  runId: RUN_ID,
  configVersion: '7',
  task: 'rni_relationship',
  scope: {
    modelRunId: MODEL_RUN_ID,
    runId: RUN_ID,
    stage: 'relationship',
    securityId: null,
    sourceItemIds: ['33333333-3333-4333-8333-333333333333'],
    claimIds: [],
    assessmentCutoffAt: null,
    executionAuthority: {
      stage: 'reddit',
      attempt: 1,
      token: '44444444-4444-4444-8444-444444444444',
    },
  },
  provider: 'openai',
  modelId: identity.configuredModelId,
  canonicalProviderModelId: identity.canonicalProviderModelId,
  modelRevision: identity.modelRevision,
  reasoningEffort: 'low',
  capabilitySnapshotId: 'capability-terra',
  capabilityResponseHash: HASH,
  capabilityObservedAt: '2026-09-05T00:00:00.000Z',
  capabilityExpiresAt: '2026-09-06T00:00:00.000Z',
  routeResolvedAt: '2026-09-05T01:00:00.000Z',
  modelPolicyVersion: 'rni-balanced-model-policy-v1',
  promptVersion: 'rni-relationship-v1',
  inputSchemaVersion: 'rni-relationship-input-v1',
  outputSchemaVersion: 'rni-relationship-output-v1',
  toolVersion: 'none-v1',
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['accepted'],
    properties: { accepted: { type: 'boolean' } },
  },
  stablePrefix: 'Stable governed policy.',
  stablePrefixHash: HASH,
  promptCacheKey: 'rni-cache-key',
  dynamicInputHash: HASH,
  dynamicSuffix: '<untrusted_evidence>{}</untrusted_evidence>',
  tools: [],
  limits: {
    maxInputBytes: 16_000,
    maxInputTokensReserved: 16_000,
    maxOutputTokens: 300,
    timeoutMs: 5_000,
    maxRetries: 0,
    maxToolCalls: 0,
    maxCostUsd: '0.10',
  },
  effectAuthority: { expiresAt: '2099-01-01T00:00:00.000Z' },
  ...overrides,
});

describe('I10C — live model transport and budget composition', () => {
  it('sends Direct structured requests with the immutable low-reasoning and cache policy', async () => {
    const requestFetch = okFetch(responseBody());
    const transport = new RniResponsesHttpTransport({
      route: 'openai_direct',
      apiKey: 'direct-secret',
      baseUrl: 'https://api.openai.example/v1/',
      identities: [identity],
      fetch: requestFetch,
    });

    const result = await transport.invoke(transportRequest());

    expect(requestFetch).toHaveBeenCalledOnce();
    const [url, init] = requestFetch.mock.calls[0]!;
    expect(url).toBe('https://api.openai.example/v1/responses');
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer direct-secret');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'gpt-5.6-terra',
      instructions: 'Stable governed policy.',
      input: '<untrusted_evidence>{}</untrusted_evidence>',
      reasoning: { effort: 'low' },
      tool_choice: 'none',
      parallel_tool_calls: false,
      prompt_cache_key: 'rni-cache-key',
      store: false,
    });
    expect(body).not.toHaveProperty('providerOptions');
    expect(result).toMatchObject({
      responseId: 'resp_1',
      provider: 'openai',
      output: { accepted: true },
      usage: { inputTokens: 120, outputTokens: 30, cachedInputTokens: 80 },
      toolCalls: [],
      citations: [],
    });
  });

  it('refuses an expired execution authority at the provider HTTP boundary', async () => {
    const requestFetch = okFetch(responseBody());
    const transport = new RniResponsesHttpTransport({
      route: 'openai_direct',
      apiKey: 'direct-secret',
      baseUrl: 'https://api.openai.example/v1/',
      identities: [identity],
      fetch: requestFetch,
      nowMs: () => Date.parse('2026-09-05T01:00:00.000Z'),
    });

    await expect(
      transport.invoke(
        transportRequest({ effectAuthority: { expiresAt: '2026-09-05T00:59:59.999Z' } }),
      ),
    ).rejects.toThrow(/authority expired before dispatch/u);
    expect(requestFetch).not.toHaveBeenCalled();
  });

  it('pins Gateway to OpenAI, records actual routing and accepts no model fallback', async () => {
    const gatewayMetadata = {
      gateway: {
        cost: '0.0123',
        routing: {
          resolvedProvider: 'openai',
          finalProvider: 'openai',
          resolvedProviderApiModelId: identity.modelRevision,
          canonicalSlug: gatewayIdentity.configuredModelId,
          modelAttempts: [
            {
              canonicalSlug: gatewayIdentity.configuredModelId,
              providerAttempts: [{ provider: 'openai', success: true }],
            },
          ],
        },
      },
    };
    const requestFetch = okFetch(
      responseBody({
        model: gatewayIdentity.configuredModelId,
        provider_metadata: gatewayMetadata,
      }),
    );
    const transport = new RniResponsesHttpTransport({
      route: 'vercel_ai_gateway',
      apiKey: 'gateway-secret',
      baseUrl: 'https://gateway.example/v1',
      identities: [gatewayIdentity],
      fetch: requestFetch,
    });

    const result = await transport.invoke(
      transportRequest({
        route: 'vercel_ai_gateway',
        modelId: gatewayIdentity.configuredModelId,
      }),
    );

    const body = JSON.parse(String(requestFetch.mock.calls[0]![1]?.body)) as Record<
      string,
      unknown
    >;
    expect(body.providerOptions).toEqual({ gateway: { only: ['openai'] } });
    expect(JSON.stringify(body)).not.toContain('models');
    expect(result).toMatchObject({ provider: 'openai', costUsd: '0.0123' });
  });

  it('fails closed when Gateway omits or crosses auditable OpenAI routing metadata', async () => {
    const absentMetadata = new RniResponsesHttpTransport({
      route: 'vercel_ai_gateway',
      apiKey: 'gateway-secret',
      baseUrl: 'https://gateway.example/v1',
      identities: [gatewayIdentity],
      fetch: okFetch(responseBody({ model: gatewayIdentity.configuredModelId })),
    });
    await expect(
      absentMetadata.invoke(
        transportRequest({
          route: 'vercel_ai_gateway',
          modelId: gatewayIdentity.configuredModelId,
        }),
      ),
    ).rejects.toThrow('omitted auditable routing metadata');

    const crossedMetadata = new RniResponsesHttpTransport({
      route: 'vercel_ai_gateway',
      apiKey: 'gateway-secret',
      baseUrl: 'https://gateway.example/v1',
      identities: [gatewayIdentity],
      fetch: okFetch(
        responseBody({
          model: gatewayIdentity.configuredModelId,
          provider_metadata: {
            gateway: {
              routing: {
                resolvedProvider: 'azure',
                finalProvider: 'azure',
                resolvedProviderApiModelId: identity.modelRevision,
                canonicalSlug: gatewayIdentity.configuredModelId,
                modelAttempts: [
                  {
                    canonicalSlug: gatewayIdentity.configuredModelId,
                    providerAttempts: [{ provider: 'azure', success: true }],
                  },
                ],
              },
            },
          },
        }),
      ),
    });
    await expect(
      crossedMetadata.invoke(
        transportRequest({
          route: 'vercel_ai_gateway',
          modelId: gatewayIdentity.configuredModelId,
        }),
      ),
    ).rejects.toThrow('did not resolve the configured OpenAI-only model route');
  });

  it('normalizes governed discovery identity without changing its request or source trace', async () => {
    const requestFetch = okFetch(
      responseBody({
        output: [{ type: 'web_search_call', id: 'ws_1', status: 'completed' }],
      }),
    );
    const transport = new RniResponsesHttpTransport({
      route: 'openai_direct',
      apiKey: 'direct-secret',
      baseUrl: 'https://api.openai.example/v1',
      identities: [identity],
      fetch: requestFetch,
    });
    const request: OpenAiWebSearchRequest = {
      model: identity.configuredModelId,
      reasoning: { effort: 'low' },
      instructions: 'governed',
      input: 'bounded',
      tools: [{ type: 'web_search', filters: { allowed_domains: ['reddit.com'] } }],
      tool_choice: 'required',
      include: ['web_search_call.action.sources'],
      text: {
        format: {
          type: 'json_schema',
          name: 'rni_reddit_discovery_v1',
          strict: true,
          schema: { type: 'object' },
        },
      },
      max_output_tokens: 100,
      max_tool_calls: 1,
      parallel_tool_calls: false,
      store: false,
    };

    const result = (await transport.create(request, {
      expiresAt: '2099-01-01T00:00:00.000Z',
    })) as Record<string, unknown>;

    expect(result.provider).toBe('openai');
    expect(result.model).toBe(identity.canonicalProviderModelId);
    expect(JSON.parse(String(requestFetch.mock.calls[0]![1]?.body))).toEqual(request);
  });

  it('loads exactly one fresh approved five-task runtime policy', async () => {
    const now = new Date('2026-09-05T01:00:00.000Z');
    const observed = new Date('2026-09-05T00:00:00.000Z');
    const expires = new Date('2026-09-06T00:00:00.000Z');
    const rows: RniModelRunRouteRow[] = [
      ['rni_discovery', 'gpt-5.6-terra', true],
      ['rni_relationship', 'gpt-5.6-terra', false],
      ['rni_classifier', 'gpt-5.6-terra', false],
      ['rni_verification', 'gpt-5.6-sol', false],
      ['rni_challenger', 'gpt-5.6-sol', false],
    ].map(([task, model, webSearch]) => ({
      run_id: RUN_ID,
      config_version: '7',
      ai_route: 'openai_direct',
      resolved_at: now,
      task: task as RniModelRunRouteRow['task'],
      provider: 'openai',
      configured_model_id: String(model),
      canonical_provider_model_id: String(model),
      model_revision: `${String(model)}-2026-07-09`,
      reasoning_effort: 'low',
      prompt_version:
        task === 'rni_discovery'
          ? 'rni-discovery-v2'
          : task === 'rni_relationship'
            ? 'rni-relationship-v1'
            : task === 'rni_classifier'
              ? 'rni-classifier-v1'
              : task === 'rni_verification'
                ? 'rni-verification-v1'
                : 'rni-challenger-v1',
      policy_version: 'rni-balanced-model-policy-v1',
      capability_snapshot_id: `cap-${String(model)}`,
      capability_response_hash: HASH,
      capability_observed_at: observed,
      capability_expires_at: expires,
      supports_responses: true,
      supports_structured_outputs: true,
      supports_web_search: Boolean(webSearch),
      max_input_bytes: task === 'rni_verification' || task === 'rni_challenger' ? 64_000 : 16_000,
      max_input_tokens: task === 'rni_verification' || task === 'rni_challenger' ? 64_000 : 16_000,
      max_output_tokens: task === 'rni_challenger' ? 1_000 : 2_000,
      max_tool_calls: task === 'rni_discovery' ? 3 : 0,
      timeout_ms: 30_000,
      max_cost_usd:
        task === 'rni_discovery'
          ? '0.15'
          : task === 'rni_verification' || task === 'rni_challenger'
            ? '0.20'
            : '0.10',
    }));

    const config = await loadRniImmutableModelRunConfig(RUN_ID, async () => rows);

    expect(config).toMatchObject({
      runId: RUN_ID,
      configVersion: '7',
      aiRoute: 'openai_direct',
      resolvedAt: now.toISOString(),
    });
    expect(config.resolvedModels).toHaveLength(5);
  });

  it('reserves before dispatch, emits the once-only warning and settles exact telemetry', async () => {
    const store: RniBudgetStore = {
      currentPriceBookVersion: vi.fn(async () => 'rni-prices-v1'),
      reserve: vi.fn(
        async (): Promise<Awaited<ReturnType<RniBudgetStore['reserve']>>> => ({
          invocationId: MODEL_RUN_ID,
          decision: 'reserved',
          estimatedCostUsd: '0.8',
          denialCode: null,
          warningEmitted: true,
          dispatchAuthorized: true,
        }),
      ),
      effectFence: vi.fn(async () => '2099-01-01T00:00:00.000Z'),
      settle: vi.fn(async () => '0.2'),
    };
    const onMonthlyWarning = vi.fn(async () => {
      throw new Error('warning notification unavailable');
    });
    const recorder = createRniBudgetInvocationRecorder({ store, onMonthlyWarning });
    const request = transportRequest({
      task: 'rni_discovery',
      scope: { ...transportRequest().scope, stage: 'discovery', sourceItemIds: [] },
    });
    const {
      outputSchema: _outputSchema,
      stablePrefix: _stablePrefix,
      dynamicSuffix: _dynamicSuffix,
      effectAuthority: _effectAuthority,
      ...attempt
    } = request;
    const success: RniCanonicalModelInvocation = {
      ...attempt,
      status: 'succeeded',
      responseId: 'resp_1',
      output: {},
      usage: { inputTokens: 120, outputTokens: 30, cachedInputTokens: 80, cacheWriteTokens: 0 },
      latencyMs: 20,
      costUsd: '999',
      toolCalls: ['ws_1', 'ws_1'],
      citations: [],
    };

    await recorder.start(attempt);
    expect(onMonthlyWarning).not.toHaveBeenCalled();
    await expect(recorder.effectFence(attempt)).resolves.toEqual({
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    await expect(recorder.finish(success)).resolves.toBeUndefined();

    expect(store.reserve).toHaveBeenCalledOnce();
    expect(store.effectFence).toHaveBeenCalledOnce();
    expect(onMonthlyWarning).toHaveBeenCalledWith({ runId: RUN_ID, invocationId: MODEL_RUN_ID });
    expect(store.settle).toHaveBeenCalledWith(
      expect.objectContaining({
        invocationId: MODEL_RUN_ID,
        providerRequestId: 'resp_1',
        outcome: 'succeeded',
        inputTokens: 120,
        cachedInputTokens: 80,
        outputTokens: 30,
        webSearchCalls: 1,
      }),
    );
    expect(store.settle).not.toHaveBeenCalledWith(
      expect.objectContaining({ actualCostUsd: '999' }),
    );
  });

  it('denies before provider dispatch and retains a reservation on ambiguous failure', async () => {
    const deniedStore: RniBudgetStore = {
      currentPriceBookVersion: vi.fn(async () => 'rni-prices-v1'),
      reserve: vi.fn(
        async (): Promise<Awaited<ReturnType<RniBudgetStore['reserve']>>> => ({
          invocationId: MODEL_RUN_ID,
          decision: 'denied',
          estimatedCostUsd: null,
          denialCode: 'rolling_24h_hard_limit',
          warningEmitted: false,
          dispatchAuthorized: false,
        }),
      ),
      effectFence: vi.fn(async () => '2099-01-01T00:00:00.000Z'),
      settle: vi.fn(async () => '0'),
    };
    const request = transportRequest();
    const {
      outputSchema: _outputSchema,
      stablePrefix: _stablePrefix,
      dynamicSuffix: _dynamicSuffix,
      effectAuthority: _effectAuthority,
      ...attempt
    } = request;
    await expect(
      createRniBudgetInvocationRecorder({ store: deniedStore }).start(attempt),
    ).rejects.toBeInstanceOf(RniAiBudgetDeniedError);
    expect(deniedStore.settle).not.toHaveBeenCalled();

    const reservedStore: RniBudgetStore = {
      ...deniedStore,
      reserve: vi.fn(
        async (): Promise<Awaited<ReturnType<RniBudgetStore['reserve']>>> => ({
          invocationId: MODEL_RUN_ID,
          decision: 'reserved',
          estimatedCostUsd: '0.8',
          denialCode: null,
          warningEmitted: false,
          dispatchAuthorized: true,
        }),
      ),
    };
    const recorder = createRniBudgetInvocationRecorder({ store: reservedStore });
    const failure: RniFailedModelInvocation = {
      status: 'failed',
      attempt: attempt as RniModelInvocationAttempt,
      error: {
        name: 'RniModelInvocationFailure',
        code: 'provider_failure',
        message: 'The configured model provider call failed.',
      },
      providerTelemetry: null,
    };
    await recorder.start(attempt);
    await recorder.finish(failure);
    expect(reservedStore.settle).not.toHaveBeenCalled();

    const replayStore: RniBudgetStore = {
      ...reservedStore,
      reserve: vi.fn(
        async (): Promise<Awaited<ReturnType<RniBudgetStore['reserve']>>> => ({
          invocationId: MODEL_RUN_ID,
          decision: 'reserved',
          estimatedCostUsd: '0.8',
          denialCode: null,
          warningEmitted: false,
          dispatchAuthorized: false,
        }),
      ),
    };
    await expect(
      createRniBudgetInvocationRecorder({ store: replayStore }).start(attempt),
    ).rejects.toMatchObject({ denialCode: 'reservation_replay' });
    expect(replayStore.settle).not.toHaveBeenCalled();
  });
});
