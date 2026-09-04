import { createHash } from 'node:crypto';
import { z } from 'zod';

import { canonicalHash } from '../../calc/canonical';
import type { RniAiRoute, RniResolvedModelRoute } from '../contracts';
import {
  RNI_PROMPT_REGISTRY,
  type RniPromptDefinition,
  type RniPromptTask,
} from '../../../prompts/rni/registry';
import type {
  RniChallengerInferencePort,
  RniChallengerModelInput,
  RniVerificationInferencePort,
  RniVerificationModelInput,
} from './types';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const transportResponseSchema = z
  .object({
    responseId: z.string().min(1),
    provider: z.string().min(1),
    modelId: z.string().min(1),
    modelRevision: z.string().min(1),
    output: z.unknown(),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        cachedInputTokens: z.number().int().nonnegative(),
        cacheWriteTokens: z.number().int().nonnegative().nullable(),
      })
      .strict(),
    latencyMs: z.number().int().nonnegative(),
    costUsd: z.string().regex(/^\d+(?:\.\d+)?$/u).nullable(),
    toolCalls: z.array(z.string().min(1)),
    citations: z.array(z.string().url()),
  })
  .strict();

export type RniImmutableModelRunConfig = {
  readonly runId: string;
  readonly configVersion: string;
  readonly aiRoute: RniAiRoute;
  readonly resolvedModels: readonly RniResolvedModelRoute[];
};

export type RniModelCallScope = {
  readonly modelRunId: string;
  readonly runId: string;
  readonly stage: 'verification' | 'challenger';
  readonly securityId: string;
  readonly sourceItemIds: readonly string[];
  readonly claimIds: readonly string[];
  readonly assessmentCutoffAt: string;
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
  readonly schemaVersion: string;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly stablePrefix: string;
  readonly stablePrefixHash: string;
  readonly promptCacheKey: string;
  readonly dynamicInputHash: string;
  readonly dynamicInput: unknown;
  readonly tools: readonly [];
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly maxRetries: number;
};

export interface RniModelTransport {
  invoke(request: RniModelTransportRequest): Promise<unknown>;
}

export type RniCanonicalModelInvocation = {
  readonly route: RniAiRoute;
  readonly runId: string;
  readonly configVersion: string;
  readonly task: RniPromptTask;
  readonly scope: RniModelCallScope;
  readonly responseId: string;
  readonly provider: string;
  readonly modelId: string;
  readonly modelRevision: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly stablePrefixHash: string;
  readonly promptCacheKey: string;
  readonly dynamicInputHash: string;
  readonly output: unknown;
  readonly usage: z.infer<typeof transportResponseSchema>['usage'];
  readonly latencyMs: number;
  readonly costUsd: string | null;
  readonly toolCalls: readonly string[];
  readonly citations: readonly string[];
};

export type RniModelRouter = {
  invoke(request: {
    readonly runConfig: RniImmutableModelRunConfig;
    readonly task: RniPromptTask;
    readonly scope: RniModelCallScope;
    readonly tenantCachePartition: string;
    readonly dynamicInput: unknown;
  }): Promise<RniCanonicalModelInvocation>;
};

const stablePrefixFor = (definition: RniPromptDefinition): string =>
  JSON.stringify({
    task: definition.task,
    promptVersion: definition.promptVersion,
    schemaVersion: definition.schemaVersion,
    toolVersion: definition.toolVersion,
    systemPolicy: definition.systemPolicy,
    outputSchema: definition.outputSchema,
    tools: definition.tools,
    finalInstruction: definition.finalInstruction,
  });

const resolvedModelFor = (
  config: RniImmutableModelRunConfig,
  task: RniPromptTask,
): RniResolvedModelRoute => {
  const matches = config.resolvedModels.filter((model) => model.task === task);
  if (matches.length !== 1) throw new Error(`RNI task ${task} must resolve exactly once`);
  return matches[0]!;
};

export const createRniModelRouter = (transports: {
  readonly openaiDirect: RniModelTransport;
  readonly vercelAiGateway?: RniModelTransport;
}): RniModelRouter => ({
  invoke: async ({
    runConfig,
    task,
    scope,
    tenantCachePartition,
    dynamicInput,
  }) => {
    if (runConfig.runId.trim() === '' || runConfig.configVersion.trim() === '') {
      throw new Error('Immutable RNI run and config identities are required');
    }
    if (tenantCachePartition.trim() === '') {
      throw new Error('Tenant cache partition is required');
    }
    if (scope.runId !== runConfig.runId || scope.stage !== task.replace('rni_', '')) {
      throw new Error('RNI model-call scope does not match the immutable run/task');
    }

    const definition = RNI_PROMPT_REGISTRY[task];
    const model = resolvedModelFor(runConfig, task);
    if (runConfig.aiRoute === 'openai_direct' && model.provider !== 'openai') {
      throw new Error('OpenAI Direct requires an OpenAI-resolved provider');
    }
    if (model.promptVersion !== definition.promptVersion) {
      throw new Error(`Persisted prompt version does not match active ${task} definition`);
    }

    const stablePrefix = stablePrefixFor(definition);
    const stablePrefixHash = sha256(stablePrefix);
    const dynamicInputHash = canonicalHash(dynamicInput);
    const promptCacheKey = sha256(
      JSON.stringify({
        tenantCachePartition,
        route: runConfig.aiRoute,
        provider: model.provider,
        modelId: model.modelId,
        modelRevision: model.modelRevision,
        task,
        promptVersion: definition.promptVersion,
        schemaVersion: definition.schemaVersion,
        toolVersion: definition.toolVersion,
        stablePrefixHash,
      }),
    );
    const transport =
      runConfig.aiRoute === 'openai_direct'
        ? transports.openaiDirect
        : transports.vercelAiGateway;
    if (transport === undefined) {
      throw new Error('Configured Vercel AI Gateway transport is unavailable');
    }

    const raw = await transport.invoke({
      route: runConfig.aiRoute,
      runId: runConfig.runId,
      configVersion: runConfig.configVersion,
      task,
      scope,
      provider: model.provider,
      modelId: model.modelId,
      modelRevision: model.modelRevision,
      promptVersion: definition.promptVersion,
      schemaVersion: definition.schemaVersion,
      outputSchema: definition.outputSchema,
      stablePrefix,
      stablePrefixHash,
      promptCacheKey,
      dynamicInputHash,
      dynamicInput,
      tools: definition.tools,
      ...definition.limits,
    });
    const response = transportResponseSchema.parse(raw);
    if (
      response.provider !== model.provider ||
      response.modelId !== model.modelId ||
      response.modelRevision !== model.modelRevision
    ) {
      throw new Error('RNI transport silently changed the resolved provider or model');
    }
    if (response.toolCalls.length > 0) {
      throw new Error(`RNI ${task} transport returned a forbidden tool call`);
    }

    return {
      route: runConfig.aiRoute,
      runId: runConfig.runId,
      configVersion: runConfig.configVersion,
      task,
      scope,
      responseId: response.responseId,
      provider: response.provider,
      modelId: response.modelId,
      modelRevision: response.modelRevision,
      promptVersion: definition.promptVersion,
      schemaVersion: definition.schemaVersion,
      stablePrefixHash,
      promptCacheKey,
      dynamicInputHash,
      output: definition.parseOutput(response.output),
      usage: response.usage,
      latencyMs: response.latencyMs,
      costUsd: response.costUsd,
      toolCalls: response.toolCalls,
      citations: response.citations,
    };
  },
});

const sourceIds = (input: Pick<RniVerificationModelInput, 'claimInputs'>): readonly string[] =>
  [
    ...new Set(
      input.claimInputs.flatMap(({ evidence }) => evidence.map(({ source }) => source.id)),
    ),
  ].sort();

const callScope = (
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
  deps: {
    readonly runConfig: RniImmutableModelRunConfig;
    readonly tenantCachePartition: string;
    readonly recordInvocation: (invocation: RniCanonicalModelInvocation) => Promise<void>;
  },
): {
  readonly verifier: RniVerificationInferencePort;
  readonly challenger: RniChallengerInferencePort;
} => {
  const invoke = async (
    task: RniPromptTask,
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
    const invocation = await router.invoke({
      runConfig: deps.runConfig,
      task,
      scope: callScope(input),
      tenantCachePartition: deps.tenantCachePartition,
      dynamicInput: input,
    });
    await deps.recordInvocation(invocation);
    return invocation.output;
  };

  return {
    verifier: { verify: (input) => invoke('rni_verification', input) },
    challenger: { challenge: (input) => invoke('rni_challenger', input) },
  };
};
