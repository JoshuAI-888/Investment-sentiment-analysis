import { z } from 'zod';

import { canonicalHash, sha256Hex } from '../../calc/canonical';
import type { RniAiRoute, RniResolvedModelRoute } from '../contracts';
import {
  DiscoveryResponseError,
  OpenAiRedditDiscovery,
} from '../discovery/openai-web-search';
import type {
  OpenAiResponsesTransport,
  RedditDiscoveryRequest,
  RedditDiscoveryResult,
} from '../discovery/types';
import type {
  RniClassifierInferencePort,
  RniRelationshipInferencePort,
} from '../observations/types';
import {
  getRniPromptDefinition,
  type RniPromptTask,
} from '../../../prompts/rni/registry';
import type {
  RniChallengerInferencePort,
  RniChallengerModelInput,
  RniVerificationInferencePort,
  RniVerificationModelInput,
} from './types';

const transportResponseSchema = z
  .object({
    responseId: z.string().min(1),
    provider: z.string().min(1),
    modelId: z.string().min(1),
    modelRevision: z.string().min(1),
    output: z.unknown(),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative().nullable(),
        outputTokens: z.number().int().nonnegative().nullable(),
        cachedInputTokens: z.number().int().nonnegative().nullable(),
        cacheWriteTokens: z.number().int().nonnegative().nullable(),
      })
      .strict(),
    latencyMs: z.number().int().nonnegative().nullable(),
    costUsd: z.string().regex(/^\d+(?:\.\d+)?$/u).nullable(),
    toolCalls: z.array(z.string().min(1)),
    citations: z.array(z.string().url()),
  })
  .strict();

const uniqueUuidArray = z
  .array(z.string().uuid())
  .refine((values) => new Set(values).size === values.length, 'IDs must be unique');
const modelCallScopeSchema = z
  .object({
    modelRunId: z.string().uuid(),
    runId: z.string().uuid(),
    stage: z.enum(['discovery', 'relationship', 'classifier', 'verification', 'challenger']),
    securityId: z.string().uuid().nullable(),
    sourceItemIds: uniqueUuidArray,
    claimIds: uniqueUuidArray,
    assessmentCutoffAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict()
  .superRefine((scope, context) => {
    const noClaims = scope.claimIds.length === 0 && scope.assessmentCutoffAt === null;
    if (scope.stage === 'discovery') {
      if (scope.securityId !== null || scope.sourceItemIds.length !== 0 || !noClaims) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Discovery scope must be run-only' });
      }
    } else if (scope.stage === 'relationship') {
      if (scope.securityId !== null || scope.sourceItemIds.length !== 1 || !noClaims) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Relationship scope is one source' });
      }
    } else if (scope.stage === 'classifier') {
      if (scope.securityId === null || scope.sourceItemIds.length !== 1 || !noClaims) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Classifier scope is one source/security' });
      }
    } else if (scope.securityId === null || scope.assessmentCutoffAt === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Synthesis scope requires a security and assessment cutoff',
      });
    }
  });
const discoveryToolsSchema = z.tuple([
  z
    .object({
      type: z.literal('web_search'),
      filters: z.object({ allowed_domains: z.tuple([z.literal('reddit.com')]) }).strict(),
    })
    .strict(),
]);

export type RniImmutableModelRunConfig = {
  readonly runId: string;
  readonly configVersion: string;
  readonly aiRoute: RniAiRoute;
  readonly resolvedModels: readonly RniResolvedModelRoute[];
};

export type RniModelStage =
  | 'discovery'
  | 'relationship'
  | 'classifier'
  | 'verification'
  | 'challenger';
export type RniStructuredPromptTask = Exclude<RniPromptTask, 'rni_discovery'>;

export type RniModelCallScope = {
  readonly modelRunId: string;
  readonly runId: string;
  readonly stage: RniModelStage;
  readonly securityId: string | null;
  readonly sourceItemIds: readonly string[];
  readonly claimIds: readonly string[];
  readonly assessmentCutoffAt: string | null;
};

export type RniModelLimits = {
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly maxRetries: 0;
  readonly maxToolCalls: number;
};

export type RniModelTransportRequest = {
  readonly route: RniAiRoute;
  readonly runId: string;
  readonly configVersion: string;
  readonly task: RniPromptTask;
  readonly scope: RniModelCallScope;
  readonly provider: string;
  readonly modelId: string;
  readonly modelRevision: string;
  readonly promptVersion: string;
  readonly inputSchemaVersion: string;
  readonly outputSchemaVersion: string;
  readonly toolVersion: string;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly stablePrefix: string;
  readonly stablePrefixHash: string;
  readonly promptCacheKey: string;
  readonly dynamicInputHash: string;
  readonly dynamicSuffix: string;
  readonly tools: readonly Readonly<Record<string, unknown>>[];
  readonly limits: RniModelLimits;
};

export interface RniModelTransport {
  invoke(request: RniModelTransportRequest): Promise<unknown>;
}

export type RniModelInvocationAttempt = Omit<
  RniModelTransportRequest,
  'outputSchema' | 'stablePrefix' | 'dynamicSuffix'
>;

export type RniCanonicalModelInvocation = RniModelInvocationAttempt & {
  readonly status: 'succeeded';
  readonly responseId: string;
  readonly output: unknown;
  readonly usage: z.infer<typeof transportResponseSchema>['usage'];
  readonly latencyMs: number | null;
  readonly costUsd: string | null;
  readonly toolCalls: readonly string[];
  readonly citations: readonly string[];
};

export type RniFailedProviderTelemetry = {
  readonly responseId: string;
  readonly provider: string;
  readonly modelId: string;
  readonly modelRevision: string | null;
  readonly usage: z.infer<typeof transportResponseSchema>['usage'];
  readonly latencyMs: number | null;
  readonly costUsd: string | null;
  readonly toolCalls: readonly string[];
  readonly citations: readonly string[];
};

export type RniModelFailureCode =
  | 'provider_failure'
  | 'response_envelope_invalid'
  | 'model_identity_mismatch'
  | 'forbidden_tool_call'
  | 'structured_output_invalid'
  | 'discovery_response_invalid';

export type RniFailedModelInvocation = {
  readonly status: 'failed';
  readonly attempt: RniModelInvocationAttempt;
  readonly error: {
    readonly name: 'RniModelInvocationFailure';
    readonly code: RniModelFailureCode;
    readonly message: string;
  };
  readonly providerTelemetry: RniFailedProviderTelemetry | null;
};

export interface RniModelInvocationRecorder {
  start(attempt: RniModelInvocationAttempt): Promise<void>;
  finish(result: RniCanonicalModelInvocation | RniFailedModelInvocation): Promise<void>;
}

export type RniModelRouter = {
  invoke(request: {
    readonly runConfig: RniImmutableModelRunConfig;
    readonly task: RniStructuredPromptTask;
    readonly scope: RniModelCallScope;
    readonly tenantCachePartition: string;
    readonly dynamicInput: unknown;
  }): Promise<RniCanonicalModelInvocation>;
};

const expectedStage = (task: RniPromptTask): RniModelStage => task.replace('rni_', '') as RniModelStage;

const resolvedModelFor = (
  config: RniImmutableModelRunConfig,
  task: RniPromptTask,
): RniResolvedModelRoute => {
  const matches = config.resolvedModels.filter((model) => model.task === task);
  if (matches.length !== 1) throw new Error(`RNI task ${task} must resolve exactly once`);
  return matches[0]!;
};

const validateInputBinding = (
  task: RniStructuredPromptTask,
  input: unknown,
  scope: RniModelCallScope,
  model: RniResolvedModelRoute,
): void => {
  if (task === 'rni_relationship') {
    const parsed = input as Parameters<RniRelationshipInferencePort['infer']>[0];
    if (scope.sourceItemIds.length !== 1 || scope.sourceItemIds[0] !== parsed.sourceItemId) {
      throw new Error('Relationship input does not match the persisted model-call scope');
    }
    return;
  }
  if (task === 'rni_classifier') {
    const parsed = input as Omit<Parameters<RniClassifierInferencePort['infer']>[0], 'modelRunId'>;
    if (
      parsed.modelId !== model.modelId ||
      parsed.promptVersion !== model.promptVersion ||
      scope.securityId !== parsed.targetSecurityId ||
      scope.sourceItemIds.length !== 1 ||
      scope.sourceItemIds[0] !== parsed.sourceItemId
    ) {
      throw new Error('Classifier input does not match the persisted model-call scope');
    }
    return;
  }
  const parsed = input as RniVerificationModelInput | RniChallengerModelInput;
  if (
    parsed.invocation.modelRunId !== scope.modelRunId ||
    parsed.invocation.runId !== scope.runId ||
    parsed.invocation.securityId !== scope.securityId ||
    parsed.invocation.modelId !== model.modelId ||
    parsed.invocation.promptVersion !== model.promptVersion ||
    parsed.invocation.stage !== scope.stage ||
    canonicalHash(parsed.invocation.claimIds) !== canonicalHash(scope.claimIds) ||
    parsed.invocation.assessmentCutoffAt !== scope.assessmentCutoffAt
  ) {
    throw new Error('Synthesis input does not match the persisted model-call scope');
  }
};

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error('Unknown RNI model invocation failure');

const failureMessages: Readonly<Record<RniModelFailureCode, string>> = {
  provider_failure: 'The configured model provider call failed.',
  response_envelope_invalid: 'The model provider returned an invalid response envelope.',
  model_identity_mismatch: 'The model provider returned an unexpected model identity.',
  forbidden_tool_call: 'The model provider returned a forbidden tool call.',
  structured_output_invalid: 'The model provider returned invalid structured output.',
  discovery_response_invalid: 'The discovery provider returned an invalid governed response.',
};

const persistedFailure = (code: RniModelFailureCode): RniFailedModelInvocation['error'] => ({
  name: 'RniModelInvocationFailure',
  code,
  message: failureMessages[code],
});

export const createRniModelRouter = (deps: {
  readonly openaiDirect: RniModelTransport;
  readonly vercelAiGateway?: RniModelTransport;
  readonly recorder: RniModelInvocationRecorder;
}): RniModelRouter => ({
  invoke: async ({ runConfig, task, scope, tenantCachePartition, dynamicInput }) => {
    if (runConfig.runId.trim() === '' || runConfig.configVersion.trim() === '') {
      throw new Error('Immutable RNI run and config identities are required');
    }
    if (tenantCachePartition.trim() === '') throw new Error('Tenant cache partition is required');
    const parsedScope = modelCallScopeSchema.parse(scope);
    if (parsedScope.runId !== runConfig.runId || parsedScope.stage !== expectedStage(task)) {
      throw new Error('RNI model-call scope does not match the immutable run/task');
    }

    const model = resolvedModelFor(runConfig, task);
    if (runConfig.aiRoute === 'openai_direct' && model.provider !== 'openai') {
      throw new Error('OpenAI Direct requires an OpenAI-resolved provider');
    }
    const definition = getRniPromptDefinition(task, model.promptVersion);
    const parsedInput = definition.parseInput(dynamicInput);
    validateInputBinding(task, parsedInput, parsedScope, model);
    const cacheContextVersion =
      task === 'rni_classifier'
        ? (parsedInput as Parameters<RniClassifierInferencePort['infer']>[0]).taxonomy.version
        : null;
    const stablePrefix = definition.serializeStablePrefix(cacheContextVersion);
    const stablePrefixHash = sha256Hex(stablePrefix);
    const serializedInput = definition.serializeInput(dynamicInput);
    const dynamicInputHash = serializedInput.dynamicInputHash;
    const dynamicSuffix = serializedInput.dynamicSuffix;
    const promptCacheKey = canonicalHash({
      tenantCachePartition,
      route: runConfig.aiRoute,
      provider: model.provider,
      modelId: model.modelId,
      modelRevision: model.modelRevision,
      task,
      promptVersion: definition.promptVersion,
      inputSchemaVersion: definition.inputSchemaVersion,
      outputSchemaVersion: definition.outputSchemaVersion,
      toolVersion: definition.toolVersion,
      cacheContextVersion,
      stablePrefixHash,
    });
    const limits = definition.limits;
    const attempt: RniModelInvocationAttempt = {
      route: runConfig.aiRoute,
      runId: runConfig.runId,
      configVersion: runConfig.configVersion,
      task,
      scope: parsedScope,
      provider: model.provider,
      modelId: model.modelId,
      modelRevision: model.modelRevision,
      promptVersion: definition.promptVersion,
      inputSchemaVersion: definition.inputSchemaVersion,
      outputSchemaVersion: definition.outputSchemaVersion,
      toolVersion: definition.toolVersion,
      stablePrefixHash,
      promptCacheKey,
      dynamicInputHash,
      tools: definition.tools,
      limits,
    };
    await deps.recorder.start(attempt);

    let invocation: RniCanonicalModelInvocation;
    let parsedResponse: z.infer<typeof transportResponseSchema> | undefined;
    let failureCode: RniModelFailureCode = 'provider_failure';
    try {
      const transport =
        runConfig.aiRoute === 'openai_direct' ? deps.openaiDirect : deps.vercelAiGateway;
      if (transport === undefined) {
        throw new Error('Configured Vercel AI Gateway transport is unavailable');
      }
      const rawResponse = await transport.invoke({
          ...attempt,
          outputSchema: definition.outputSchema,
          stablePrefix,
          dynamicSuffix,
        });
      failureCode = 'response_envelope_invalid';
      const response = transportResponseSchema.parse(rawResponse);
      parsedResponse = response;
      failureCode = 'model_identity_mismatch';
      if (
        response.provider !== model.provider ||
        response.modelId !== model.modelId ||
        response.modelRevision !== model.modelRevision
      ) {
        throw new Error('RNI transport silently changed the resolved provider or model');
      }
      failureCode = 'forbidden_tool_call';
      if (response.toolCalls.length > 0) {
        throw new Error(`RNI ${task} transport returned a forbidden tool call`);
      }
      failureCode = 'structured_output_invalid';
      const parsedOutput = definition.parseOutput(response.output);
      invocation = {
        ...attempt,
        status: 'succeeded',
        responseId: response.responseId,
        output: parsedOutput,
        usage: response.usage,
        latencyMs: response.latencyMs,
        costUsd: response.costUsd,
        toolCalls: response.toolCalls,
        citations: response.citations,
      };
    } catch (cause) {
      const error = asError(cause);
      try {
        await deps.recorder.finish({
          status: 'failed',
          attempt,
          error: persistedFailure(failureCode),
          providerTelemetry:
            parsedResponse === undefined
              ? null
              : {
                  responseId: parsedResponse.responseId,
                  provider: parsedResponse.provider,
                  modelId: parsedResponse.modelId,
                  modelRevision: parsedResponse.modelRevision,
                  usage: parsedResponse.usage,
                  latencyMs: parsedResponse.latencyMs,
                  costUsd: parsedResponse.costUsd,
                  toolCalls: parsedResponse.toolCalls,
                  citations: parsedResponse.citations,
                },
        });
      } catch (finalizationCause) {
        throw new AggregateError(
          [error, asError(finalizationCause)],
          'RNI provider call and failed-invocation finalization both failed',
          { cause: error },
        );
      }
      throw error;
    }
    await deps.recorder.finish(invocation);
    return invocation;
  },
});

export const createRniRoutedRedditDiscovery = (deps: {
  readonly runConfig: RniImmutableModelRunConfig;
  readonly tenantCachePartition: string;
  readonly openaiDirect: OpenAiResponsesTransport;
  readonly vercelAiGateway?: OpenAiResponsesTransport;
  readonly recorder: RniModelInvocationRecorder;
  readonly modelRunIdForQuery: (queryId: string) => string;
  readonly nowMs?: () => number;
}): { readonly discover: (request: RedditDiscoveryRequest) => Promise<RedditDiscoveryResult> } => ({
  discover: async (input) => {
    if (deps.tenantCachePartition.trim() === '') throw new Error('Tenant cache partition is required');
    const task = 'rni_discovery' as const;
    const model = resolvedModelFor(deps.runConfig, task);
    if (deps.runConfig.aiRoute === 'openai_direct' && model.provider !== 'openai') {
      throw new Error('OpenAI Direct requires an OpenAI-resolved provider');
    }
    const definition = getRniPromptDefinition(task, model.promptVersion);
    const governedTools = discoveryToolsSchema.parse(definition.tools);
    const parsedInput = definition.parseInput(input) as RedditDiscoveryRequest;
    const stablePrefix = definition.serializeStablePrefix(null);
    const stablePrefixHash = sha256Hex(stablePrefix);
    const serializedInput = definition.serializeInput(input);
    const dynamicSuffix = serializedInput.dynamicSuffix;
    const dynamicInputHash = serializedInput.dynamicInputHash;
    const promptCacheKey = canonicalHash({
      tenantCachePartition: deps.tenantCachePartition,
      route: deps.runConfig.aiRoute,
      provider: model.provider,
      modelId: model.modelId,
      modelRevision: model.modelRevision,
      task,
      promptVersion: definition.promptVersion,
      inputSchemaVersion: definition.inputSchemaVersion,
      outputSchemaVersion: definition.outputSchemaVersion,
      toolVersion: definition.toolVersion,
      cacheContextVersion: null,
      stablePrefixHash,
    });
    const scope = modelCallScopeSchema.parse({
      modelRunId: deps.modelRunIdForQuery(parsedInput.queryId),
      runId: deps.runConfig.runId,
      stage: 'discovery',
      securityId: null,
      sourceItemIds: [],
      claimIds: [],
      assessmentCutoffAt: null,
    });
    const attempt: RniModelInvocationAttempt = {
      route: deps.runConfig.aiRoute,
      runId: deps.runConfig.runId,
      configVersion: deps.runConfig.configVersion,
      task,
      scope,
      provider: model.provider,
      modelId: model.modelId,
      modelRevision: model.modelRevision,
      promptVersion: definition.promptVersion,
      inputSchemaVersion: definition.inputSchemaVersion,
      outputSchemaVersion: definition.outputSchemaVersion,
      toolVersion: definition.toolVersion,
      stablePrefixHash,
      promptCacheKey,
      dynamicInputHash,
      tools: definition.tools,
      limits: definition.limits,
    };
    await deps.recorder.start(attempt);

    let invocation: RniCanonicalModelInvocation;
    let result: RedditDiscoveryResult;
    let providerTelemetry: RniFailedProviderTelemetry | null = null;
    let failureCode: RniModelFailureCode = 'provider_failure';
    try {
      const transport =
        deps.runConfig.aiRoute === 'openai_direct'
          ? deps.openaiDirect
          : deps.vercelAiGateway;
      if (transport === undefined) {
        throw new Error('Configured Vercel AI Gateway discovery transport is unavailable');
      }
      result = await new OpenAiRedditDiscovery(transport, {
        model: model.modelId,
        maxOutputTokens: definition.limits.maxOutputTokens,
        maxToolCalls: definition.limits.maxToolCalls,
        ...(deps.nowMs === undefined ? {} : { nowMs: deps.nowMs }),
        governance: {
          promptVersion: definition.promptVersion,
          systemPolicy: definition.systemPolicy,
          finalInstruction: definition.finalInstruction,
          outputSchema: definition.outputSchema,
          parseOutput: definition.parseOutput,
          tools: governedTools,
          serializeInput: () => dynamicSuffix,
        },
      }).discover(parsedInput);
      providerTelemetry = {
        responseId: result.providerRequestId,
        provider: model.provider,
        modelId: result.resolvedModel,
        modelRevision: null,
        usage: { ...result.usage, cacheWriteTokens: null },
        latencyMs: result.latencyMs,
        costUsd: null,
        toolCalls: result.webSearchActions.map(({ callId }) => callId),
        citations: result.consultedSources.map(({ url }) => url),
      };
      failureCode = 'model_identity_mismatch';
      if (result.resolvedModel !== model.modelId) {
        throw new Error('RNI discovery transport silently changed the resolved model');
      }
      invocation = {
        ...attempt,
        status: 'succeeded',
        responseId: result.providerRequestId,
        output: result,
        usage: {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          cachedInputTokens: result.usage.cachedInputTokens,
          cacheWriteTokens: null,
        },
        latencyMs: result.latencyMs,
        costUsd: null,
        toolCalls: result.webSearchActions.map(({ callId }) => callId),
        citations: result.consultedSources.map(({ url }) => url),
      };
    } catch (cause) {
      const error = asError(cause);
      if (cause instanceof DiscoveryResponseError) {
        failureCode = 'discovery_response_invalid';
      }
      if (cause instanceof DiscoveryResponseError && cause.providerTelemetry !== null) {
        providerTelemetry = {
          responseId: cause.providerTelemetry.responseId,
          provider: model.provider,
          modelId: cause.providerTelemetry.resolvedModel,
          modelRevision: null,
          usage: { ...cause.providerTelemetry.usage, cacheWriteTokens: null },
          latencyMs: cause.providerTelemetry.latencyMs,
          costUsd: null,
          toolCalls: cause.providerTelemetry.toolCalls,
          citations: cause.providerTelemetry.citations,
        };
      }
      try {
        await deps.recorder.finish({
          status: 'failed',
          attempt,
          error: persistedFailure(failureCode),
          providerTelemetry,
        });
      } catch (finalizationCause) {
        throw new AggregateError(
          [error, asError(finalizationCause)],
          'RNI discovery and failed-invocation finalization both failed',
          { cause: error },
        );
      }
      throw error;
    }
    await deps.recorder.finish(invocation);
    return result;
  },
});

const sourceIds = (input: Pick<RniVerificationModelInput, 'claimInputs'>): readonly string[] =>
  [...new Set(input.claimInputs.flatMap(({ evidence }) => evidence.map(({ source }) => source.id)))].sort();

const synthesisScope = (
  input: RniVerificationModelInput | RniChallengerModelInput,
): RniModelCallScope => ({
  modelRunId: input.invocation.modelRunId,
  runId: input.runId,
  stage: input.invocation.stage,
  securityId: input.securityId,
  sourceItemIds: sourceIds(input),
  claimIds: [...input.invocation.claimIds],
  assessmentCutoffAt: input.invocation.assessmentCutoffAt,
});

export const createRniCitedSynthesisInferencePorts = (
  router: RniModelRouter,
  deps: { readonly runConfig: RniImmutableModelRunConfig; readonly tenantCachePartition: string },
): { readonly verifier: RniVerificationInferencePort; readonly challenger: RniChallengerInferencePort } => {
  const invoke = async (
    task: 'rni_verification' | 'rni_challenger',
    input: RniVerificationModelInput | RniChallengerModelInput,
  ): Promise<unknown> => {
    const expected = resolvedModelFor(deps.runConfig, task);
    if (
      input.invocation.runId !== deps.runConfig.runId ||
      input.invocation.modelId !== expected.modelId ||
      input.invocation.promptVersion !== expected.promptVersion
    ) {
      throw new Error('Persisted synthesis invocation does not match the immutable model route');
    }
    return (
      await router.invoke({
        runConfig: deps.runConfig,
        task,
        scope: synthesisScope(input),
        tenantCachePartition: deps.tenantCachePartition,
        dynamicInput: input,
      })
    ).output;
  };
  return {
    verifier: { verify: (input) => invoke('rni_verification', input) },
    challenger: { challenge: (input) => invoke('rni_challenger', input) },
  };
};

export const createRniObservationInferencePorts = (
  router: RniModelRouter,
  deps: {
    readonly runConfig: RniImmutableModelRunConfig;
    readonly tenantCachePartition: string;
    readonly relationshipModelRunIdForSource: (sourceItemId: string) => string;
  },
): { readonly relationship: RniRelationshipInferencePort; readonly classifier: RniClassifierInferencePort } => ({
  relationship: {
    infer: async (input) =>
      (
        await router.invoke({
          runConfig: deps.runConfig,
          task: 'rni_relationship',
          scope: {
            modelRunId: deps.relationshipModelRunIdForSource(input.sourceItemId),
            runId: deps.runConfig.runId,
            stage: 'relationship',
            securityId: null,
            sourceItemIds: [input.sourceItemId],
            claimIds: [],
            assessmentCutoffAt: null,
          },
          tenantCachePartition: deps.tenantCachePartition,
          dynamicInput: input,
        })
      ).output,
  },
  classifier: {
    infer: async (input) => {
      const expected = resolvedModelFor(deps.runConfig, 'rni_classifier');
      if (input.modelId !== expected.modelId || input.promptVersion !== expected.promptVersion) {
        throw new Error('Classifier input does not match the immutable model route');
      }
      const { modelRunId: _routingIdentity, ...modelVisibleInput } = input;
      return (
        await router.invoke({
          runConfig: deps.runConfig,
          task: 'rni_classifier',
          scope: {
            modelRunId: input.modelRunId,
            runId: deps.runConfig.runId,
            stage: 'classifier',
            securityId: input.targetSecurityId,
            sourceItemIds: [input.sourceItemId],
            claimIds: [],
            assessmentCutoffAt: null,
          },
          tenantCachePartition: deps.tenantCachePartition,
          dynamicInput: modelVisibleInput,
        })
      ).output;
    },
  },
});
