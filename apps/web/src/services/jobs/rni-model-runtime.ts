import { canonicalHash } from '@/calc/canonical';
import { env } from '@/env';
import {
  type RniCanonicalModelInvocation,
  type RniFailedModelInvocation,
  type RniModelInvocationAttempt,
  type RniModelInvocationRecorder,
  type RniModelTransport,
  type RniModelTransportRequest,
  type RniImmutableModelRunConfig,
} from '@/rni/agents';
import type { OpenAiResponsesTransport, OpenAiWebSearchRequest } from '@/rni/discovery';
import { assertRniBalancedRuntimePolicy } from '@/rni/config';
import {
  findCurrentRniPriceBookVersion,
  findRniModelRunRoutes,
  reserveRniAiInvocation,
  settleRniAiInvocation,
  type RniAiReservation,
  type RniModelRunRouteRow,
} from '@/repositories/versions';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type RniTransportIdentity = {
  readonly configuredModelId: string;
  readonly canonicalProviderModelId: string;
  readonly modelRevision: string;
};

type JsonRecord = Readonly<Record<string, unknown>>;

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const readString = (record: JsonRecord | null, key: string): string | null => {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
};

const readNumber = (record: JsonRecord | null, key: string): number | null => {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
};

const readInteger = (record: JsonRecord | null, key: string): number | null => {
  const value = readNumber(record, key);
  return value !== null && Number.isInteger(value) ? value : null;
};

const toIso = (value: Date | string): string =>
  (value instanceof Date ? value : new Date(value)).toISOString();

const joinUrl = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/+$/u, '')}/${path.replace(/^\/+/, '')}`;

const walk = (value: unknown, visit: (record: JsonRecord) => void): void => {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  const record = asRecord(value);
  if (record === null) return;
  visit(record);
  for (const nested of Object.values(record)) walk(nested, visit);
};

const responseToolCalls = (output: unknown): readonly string[] => {
  const calls: string[] = [];
  walk(output, (record) => {
    const type = readString(record, 'type');
    if (type === null || (!type.endsWith('_call') && type !== 'function_call')) return;
    const id = readString(record, 'id') ?? readString(record, 'call_id');
    if (id !== null) calls.push(id);
  });
  return [...new Set(calls)];
};

const responseCitations = (output: unknown): readonly string[] => {
  const citations: string[] = [];
  walk(output, (record) => {
    if (readString(record, 'type') !== 'url_citation') return;
    const url = readString(record, 'url');
    if (url === null) return;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') citations.push(parsed.href);
    } catch {
      // The governed parser will reject malformed citations. They are not copied into telemetry.
    }
  });
  return [...new Set(citations)];
};

const responseOutput = (output: unknown): unknown => {
  const texts: string[] = [];
  walk(output, (record) => {
    if (readString(record, 'type') === 'output_text') {
      const text = readString(record, 'text');
      if (text !== null) texts.push(text);
    }
  });
  const text = texts.join('');
  if (text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Preserve provider telemetry. The router's task schema will reject this as structured output.
    return text;
  }
};

const usageFrom = (raw: JsonRecord | null) => {
  const usage = asRecord(raw?.['usage']);
  const details = asRecord(usage?.['input_tokens_details']);
  const inputTokens = readInteger(usage, 'input_tokens');
  const outputTokens = readInteger(usage, 'output_tokens');
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens: inputTokens === null ? null : (readInteger(details, 'cached_tokens') ?? 0),
    cacheWriteTokens:
      inputTokens === null ? null : (readInteger(details, 'cache_write_tokens') ?? 0),
  };
};

type GatewayRouting = {
  readonly resolvedProvider: string;
  readonly finalProvider: string;
  readonly resolvedProviderApiModelId: string;
  readonly canonicalSlug: string;
  readonly costUsd: string | null;
  readonly modelAttempts: readonly JsonRecord[];
};

const gatewayRoutingFrom = (raw: JsonRecord): GatewayRouting => {
  const metadata =
    asRecord(raw['provider_metadata']) ?? asRecord(raw['providerMetadata']) ?? asRecord(raw['provider_meta']);
  const gateway = asRecord(metadata?.['gateway']);
  const routing = asRecord(gateway?.['routing']);
  const attempts = routing?.['modelAttempts'];
  if (!Array.isArray(attempts)) {
    throw new Error('Vercel AI Gateway response omitted auditable routing metadata');
  }
  const modelAttempts = attempts.map(asRecord);
  if (modelAttempts.some((attempt) => attempt === null)) {
    throw new Error('Vercel AI Gateway returned malformed model-attempt metadata');
  }
  return {
    resolvedProvider: readString(routing, 'resolvedProvider') ?? '',
    finalProvider: readString(routing, 'finalProvider') ?? '',
    resolvedProviderApiModelId: readString(routing, 'resolvedProviderApiModelId') ?? '',
    canonicalSlug: readString(routing, 'canonicalSlug') ?? '',
    costUsd: readString(gateway, 'cost'),
    modelAttempts: modelAttempts as JsonRecord[],
  };
};

const assertGatewayOpenAiOnly = (
  routing: GatewayRouting,
  identity: RniTransportIdentity,
): void => {
  if (
    routing.resolvedProvider !== 'openai' ||
    routing.finalProvider !== 'openai' ||
    routing.canonicalSlug !== identity.configuredModelId ||
    ![identity.canonicalProviderModelId, identity.modelRevision].includes(
      routing.resolvedProviderApiModelId,
    )
  ) {
    throw new Error('Vercel AI Gateway did not resolve the configured OpenAI-only model route');
  }
  if (routing.modelAttempts.length !== 1) {
    throw new Error('Vercel AI Gateway attempted an unconfigured fallback model');
  }
  const modelAttempt = routing.modelAttempts[0]!;
  if (readString(modelAttempt, 'canonicalSlug') !== identity.configuredModelId) {
    throw new Error('Vercel AI Gateway model-attempt identity does not match the configured route');
  }
  const providerAttempts = modelAttempt['providerAttempts'];
  if (
    !Array.isArray(providerAttempts) ||
    providerAttempts.length === 0 ||
    providerAttempts.some((attempt) => readString(asRecord(attempt), 'provider') !== 'openai')
  ) {
    throw new Error('Vercel AI Gateway attempted a non-OpenAI provider');
  }
};

const assertResponseModel = (rawModel: string, identity: RniTransportIdentity): void => {
  const accepted = new Set([
    identity.configuredModelId,
    identity.canonicalProviderModelId,
    identity.modelRevision,
    `openai/${identity.canonicalProviderModelId}`,
    `openai/${identity.modelRevision}`,
  ]);
  if (!accepted.has(rawModel)) throw new Error('Provider response model does not match the configured route');
};

export class RniProviderHttpError extends Error {
  constructor(
    readonly route: 'openai_direct' | 'vercel_ai_gateway',
    readonly status: number,
    readonly providerRequestId: string | null,
  ) {
    super(`${route} Responses request failed with HTTP ${status}`);
    this.name = 'RniProviderHttpError';
  }
}

type RniResponsesTransportOptions = {
  readonly route: 'openai_direct' | 'vercel_ai_gateway';
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly identities: readonly RniTransportIdentity[];
  readonly fetch?: FetchLike;
  readonly defaultTimeoutMs?: number;
};

/** Server-only OpenAI Responses transport shared by Direct and explicitly selected Gateway. */
export class RniResponsesHttpTransport implements RniModelTransport, OpenAiResponsesTransport {
  private readonly identities: ReadonlyMap<string, RniTransportIdentity>;
  private readonly fetch: FetchLike;

  constructor(private readonly options: RniResponsesTransportOptions) {
    if (options.apiKey.trim() === '') throw new Error(`${options.route} API key is required`);
    this.identities = new Map(options.identities.map((identity) => [identity.configuredModelId, identity]));
    if (this.identities.size !== options.identities.length) {
      throw new Error('RNI transport model identities must be unique by configured model ID');
    }
    this.fetch = options.fetch ?? fetch;
  }

  private identityFor(modelId: string): RniTransportIdentity {
    const identity = this.identities.get(modelId);
    if (identity === undefined) throw new Error(`RNI transport model ${modelId} is not configured`);
    return identity;
  }

  private async post(
    body: JsonRecord,
    identity: RniTransportIdentity,
    timeoutMs: number,
  ): Promise<{ readonly raw: JsonRecord; readonly latencyMs: number; readonly routing: GatewayRouting | null }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    try {
      const response = await this.fetch(joinUrl(this.options.baseUrl, 'responses'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new RniProviderHttpError(
          this.options.route,
          response.status,
          response.headers.get('x-request-id'),
        );
      }
      const raw = asRecord((await response.json()) as unknown);
      if (raw === null) throw new Error('Responses provider returned a non-object envelope');
      const rawModel = readString(raw, 'model');
      if (rawModel === null) throw new Error('Responses provider omitted the resolved model');
      assertResponseModel(rawModel, identity);
      const routing = this.options.route === 'vercel_ai_gateway' ? gatewayRoutingFrom(raw) : null;
      if (routing !== null) assertGatewayOpenAiOnly(routing, identity);
      return { raw, latencyMs: Math.max(0, Date.now() - startedAt), routing };
    } finally {
      clearTimeout(timeout);
    }
  }

  private governedBody(body: JsonRecord): JsonRecord {
    if (this.options.route === 'openai_direct') return body;
    return {
      ...body,
      providerOptions: { gateway: { only: ['openai'] } },
    };
  }

  async invoke(request: RniModelTransportRequest): Promise<unknown> {
    if (request.route !== this.options.route) {
      throw new Error('RNI transport route does not match the immutable invocation route');
    }
    const identity = this.identityFor(request.modelId);
    if (
      identity.canonicalProviderModelId !== request.canonicalProviderModelId ||
      identity.modelRevision !== request.modelRevision ||
      request.provider !== 'openai'
    ) {
      throw new Error('RNI transport identity does not match the immutable invocation route');
    }
    const body = this.governedBody({
      model: request.modelId,
      instructions: request.stablePrefix,
      input: request.dynamicSuffix,
      reasoning: { effort: request.reasoningEffort },
      text: {
        format: {
          type: 'json_schema',
          name: `${request.task}_output`,
          strict: true,
          schema: request.outputSchema,
        },
      },
      tools: request.tools,
      tool_choice: request.tools.length === 0 ? 'none' : 'required',
      parallel_tool_calls: false,
      max_output_tokens: request.limits.maxOutputTokens,
      ...(request.limits.maxToolCalls === 0
        ? {}
        : { max_tool_calls: request.limits.maxToolCalls }),
      prompt_cache_key: request.promptCacheKey,
      store: false,
    });
    const { raw, latencyMs, routing } = await this.post(body, identity, request.limits.timeoutMs);
    const output = raw['output'];
    return {
      responseId: readString(raw, 'id') ?? '',
      provider: 'openai',
      modelId: request.modelId,
      canonicalProviderModelId: request.canonicalProviderModelId,
      modelRevision: request.modelRevision,
      output: readString(raw, 'status') === 'completed' ? responseOutput(output) : null,
      usage: usageFrom(raw),
      latencyMs,
      costUsd: routing?.costUsd ?? null,
      toolCalls: responseToolCalls(output),
      citations: responseCitations(output),
    };
  }

  async create(request: OpenAiWebSearchRequest): Promise<unknown> {
    const identity = this.identityFor(request.model);
    const body = this.governedBody(request as unknown as JsonRecord);
    const { raw, routing } = await this.post(
      body,
      identity,
      this.options.defaultTimeoutMs ?? 30_000,
    );
    return {
      ...raw,
      provider: routing?.finalProvider ?? 'openai',
      model: identity.canonicalProviderModelId,
    };
  }
}

const identitiesFromConfig = (
  runConfig: RniImmutableModelRunConfig,
): readonly RniTransportIdentity[] => {
  const identities = new Map<string, RniTransportIdentity>();
  for (const route of runConfig.resolvedModels) {
    const identity = {
      configuredModelId: route.modelId,
      canonicalProviderModelId: route.canonicalProviderModelId,
      modelRevision: route.modelRevision,
    };
    const existing = identities.get(route.modelId);
    if (existing !== undefined && canonicalHash(existing) !== canonicalHash(identity)) {
      throw new Error(`Configured RNI model ${route.modelId} maps to conflicting identities`);
    }
    identities.set(route.modelId, identity);
  }
  return [...identities.values()];
};

export const loadRniImmutableModelRunConfig = async (
  runId: string,
  load: (id: string) => Promise<readonly RniModelRunRouteRow[]> = findRniModelRunRoutes,
): Promise<RniImmutableModelRunConfig> => {
  const rows = await load(runId);
  const first = rows[0];
  if (first === undefined || rows.length !== 5) {
    throw new Error('RNI run does not have five fresh governed model routes');
  }
  const resolvedAt = toIso(first.resolved_at);
  if (
    rows.some(
      (row) =>
        row.run_id !== first.run_id ||
        row.config_version !== first.config_version ||
        row.ai_route !== first.ai_route ||
        toIso(row.resolved_at) !== resolvedAt,
    )
  ) {
    throw new Error('RNI run model routes do not share one immutable configuration resolution');
  }
  if (
    rows.some(
      (row) =>
        row.provider !== 'openai' ||
        row.reasoning_effort !== 'low' ||
        row.policy_version !== 'rni-balanced-model-policy-v1' ||
        !row.supports_responses ||
        !row.supports_structured_outputs,
    )
  ) {
    throw new Error('RNI run model routes violate the approved provider/capability policy');
  }
  const config: RniImmutableModelRunConfig = {
    runId: first.run_id,
    configVersion: first.config_version,
    aiRoute: first.ai_route,
    resolvedAt,
    resolvedModels: rows.map((row) => ({
      task: row.task,
      provider: row.provider,
      modelId: row.configured_model_id,
      canonicalProviderModelId: row.canonical_provider_model_id,
      modelRevision: row.model_revision,
      promptVersion: row.prompt_version,
      reasoningEffort: 'low',
      capabilitySnapshotId: row.capability_snapshot_id,
      capabilityResponseHash: row.capability_response_hash,
      capabilityObservedAt: toIso(row.capability_observed_at),
      capabilityExpiresAt: toIso(row.capability_expires_at),
      supportsResponses: true,
      supportsStructuredOutputs: true,
      supportsWebSearch: row.supports_web_search,
      policyVersion: 'rni-balanced-model-policy-v1',
      envelope: {
        task: row.task,
        maxInputBytes: row.max_input_bytes,
        maxInputTokensReserved: row.max_input_tokens,
        maxOutputTokens: row.max_output_tokens,
        maxToolCalls: row.max_tool_calls,
        timeoutMs: row.timeout_ms,
        maxCostUsd: row.max_cost_usd,
      },
    })),
  };
  assertRniBalancedRuntimePolicy(config);
  return config;
};

export type RniBudgetStore = {
  readonly currentPriceBookVersion: () => Promise<string>;
  readonly reserve: (input: Parameters<typeof reserveRniAiInvocation>[0]) => Promise<RniAiReservation>;
  readonly settle: (input: Parameters<typeof settleRniAiInvocation>[0]) => Promise<string>;
};

export class RniAiBudgetDeniedError extends Error {
  constructor(readonly denialCode: string) {
    super(`RNI AI dispatch denied by ${denialCode}`);
    this.name = 'RniAiBudgetDeniedError';
  }
}

const invocationRequestHash = (attempt: RniModelInvocationAttempt): string =>
  canonicalHash({
    ...attempt,
    limits: {
      maxOutputTokens: String(attempt.limits.maxOutputTokens),
      timeoutMs: String(attempt.limits.timeoutMs),
      maxRetries: String(attempt.limits.maxRetries),
      maxToolCalls: String(attempt.limits.maxToolCalls),
      maxInputBytes: String(attempt.limits.maxInputBytes),
      maxInputTokensReserved: String(attempt.limits.maxInputTokensReserved),
      maxCostUsd: attempt.limits.maxCostUsd,
    },
  });

const resultAttempt = (
  result: RniCanonicalModelInvocation | RniFailedModelInvocation,
): RniModelInvocationAttempt => (result.status === 'failed' ? result.attempt : result);

const resultTelemetry = (
  result: RniCanonicalModelInvocation | RniFailedModelInvocation,
) => (result.status === 'failed' ? result.providerTelemetry : result);

export const createRniBudgetInvocationRecorder = (options: {
  readonly store?: RniBudgetStore;
  readonly onMonthlyWarning?: (input: {
    readonly runId: string;
    readonly invocationId: string;
  }) => void | Promise<void>;
} = {}): RniModelInvocationRecorder => {
  const store: RniBudgetStore = options.store ?? {
    currentPriceBookVersion: () => findCurrentRniPriceBookVersion(),
    reserve: (input) => reserveRniAiInvocation(input),
    settle: (input) => settleRniAiInvocation(input),
  };
  const started = new Map<string, { readonly requestHash: string }>();
  return {
    start: async (attempt) => {
      const invocationId = attempt.scope.modelRunId;
      const requestHash = invocationRequestHash(attempt);
      const reservation = await store.reserve({
        invocationId,
        runId: attempt.runId,
        task: attempt.task,
        requestHash,
        capabilitySnapshotId: attempt.capabilitySnapshotId,
        priceBookVersion: await store.currentPriceBookVersion(),
      });
      if (reservation.decision !== 'reserved') {
        throw new RniAiBudgetDeniedError(reservation.denialCode ?? 'unknown_budget_denial');
      }
      started.set(invocationId, { requestHash });
      if (reservation.warningEmitted) {
        await options.onMonthlyWarning?.({ runId: attempt.runId, invocationId });
      }
    },
    finish: async (result) => {
      const attempt = resultAttempt(result);
      const invocationId = attempt.scope.modelRunId;
      const reservation = started.get(invocationId);
      if (reservation === undefined) {
        throw new Error('RNI model invocation was not reserved before finalization');
      }
      const telemetry = resultTelemetry(result);
      if (
        telemetry === null ||
        telemetry.usage.inputTokens === null ||
        telemetry.usage.cachedInputTokens === null ||
        telemetry.usage.outputTokens === null
      ) {
        started.delete(invocationId);
        return;
      }
      await store.settle({
        invocationId,
        requestHash: reservation.requestHash,
        providerRequestId: telemetry.responseId,
        outcome: result.status,
        inputTokens: telemetry.usage.inputTokens,
        cachedInputTokens: telemetry.usage.cachedInputTokens,
        outputTokens: telemetry.usage.outputTokens,
        webSearchCalls:
          attempt.task === 'rni_discovery' ? new Set(telemetry.toolCalls).size : 0,
      });
      started.delete(invocationId);
    },
  };
};

export const createRniLiveModelTransports = (
  runConfig: RniImmutableModelRunConfig,
  options: { readonly fetch?: FetchLike } = {},
): {
  readonly openaiDirect: RniResponsesHttpTransport;
  readonly vercelAiGateway?: RniResponsesHttpTransport;
} => {
  if (env.OPENAI_API_KEY === undefined) {
    throw new Error('OPENAI_API_KEY is required for the RNI Direct-default transport');
  }
  const identities = identitiesFromConfig(runConfig);
  const openaiDirect = new RniResponsesHttpTransport({
    route: 'openai_direct',
    apiKey: env.OPENAI_API_KEY,
    baseUrl: 'https://api.openai.com/v1',
    identities,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  if (runConfig.aiRoute !== 'vercel_ai_gateway') return { openaiDirect };
  if (env.AI_GATEWAY_API_KEY === undefined) {
    throw new Error('AI_GATEWAY_API_KEY is required for the selected RNI Gateway route');
  }
  return {
    openaiDirect,
    vercelAiGateway: new RniResponsesHttpTransport({
      route: 'vercel_ai_gateway',
      apiKey: env.AI_GATEWAY_API_KEY,
      baseUrl: env.AI_GATEWAY_BASE_URL,
      identities,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    }),
  };
};
