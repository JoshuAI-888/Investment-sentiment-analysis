import { z } from 'zod';

import { RNI_PROMPT_REGISTRY, type RniPromptTask } from '../../../prompts/rni/registry';
import {
  rniTaskEnvelope,
  type RniAiRoute,
  type RniResolvedModelRoute,
  type RniTaskEnvelope,
} from '../contracts';

export const RNI_BALANCED_MODEL_POLICY_VERSION = 'rni-balanced-model-policy-v1' as const;
export const RNI_BALANCED_REASONING_EFFORT = 'low' as const;
export const RNI_DEFAULT_AI_ROUTE = 'openai_direct' as const;

export const RNI_APPROVED_TASK_ENVELOPES = {
  rni_discovery: {
    task: 'rni_discovery', maxInputBytes: 16_000, maxInputTokensReserved: 16_000,
    maxOutputTokens: 2_000, maxToolCalls: 3, timeoutMs: 30_000, maxCostUsd: '0.15',
  },
  rni_relationship: {
    task: 'rni_relationship', maxInputBytes: 16_000, maxInputTokensReserved: 16_000,
    maxOutputTokens: 2_000, maxToolCalls: 0, timeoutMs: 30_000, maxCostUsd: '0.10',
  },
  rni_classifier: {
    task: 'rni_classifier', maxInputBytes: 16_000, maxInputTokensReserved: 16_000,
    maxOutputTokens: 2_000, maxToolCalls: 0, timeoutMs: 30_000, maxCostUsd: '0.10',
  },
  rni_verification: {
    task: 'rni_verification', maxInputBytes: 64_000, maxInputTokensReserved: 64_000,
    maxOutputTokens: 2_000, maxToolCalls: 0, timeoutMs: 30_000, maxCostUsd: '0.20',
  },
  rni_challenger: {
    task: 'rni_challenger', maxInputBytes: 64_000, maxInputTokensReserved: 64_000,
    maxOutputTokens: 1_000, maxToolCalls: 0, timeoutMs: 30_000, maxCostUsd: '0.20',
  },
} as const satisfies Readonly<Record<RniPromptTask, RniTaskEnvelope>>;

const APPROVED_MODELS = {
  terra: 'gpt-5.6-terra',
  sol: 'gpt-5.6-sol',
} as const;

const TASK_POLICY = {
  rni_discovery: { family: 'terra', requiresWebSearch: true },
  rni_relationship: { family: 'terra', requiresWebSearch: false },
  rni_classifier: { family: 'terra', requiresWebSearch: false },
  rni_verification: { family: 'sol', requiresWebSearch: false },
  rni_challenger: { family: 'sol', requiresWebSearch: false },
} as const satisfies Readonly<
  Record<RniPromptTask, { readonly family: keyof typeof APPROVED_MODELS; readonly requiresWebSearch: boolean }>
>;

const capabilitySchema = z
  .object({
    route: z.enum(['openai_direct', 'vercel_ai_gateway']),
    configuredModelId: z.string().min(1),
    provider: z.literal('openai'),
    providerModelId: z.enum([APPROVED_MODELS.terra, APPROVED_MODELS.sol]),
    modelRevision: z.string().min(1),
    capabilitySnapshotId: z.string().min(1),
    capabilityResponseHash: z.string().regex(/^[a-f0-9]{64}$/u),
    observedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    available: z.boolean(),
    supportsResponses: z.boolean(),
    supportsStructuredOutputs: z.boolean(),
    supportsWebSearch: z.boolean(),
    reasoningEfforts: z.array(z.enum(['none', 'low', 'medium', 'high', 'xhigh', 'max'])),
  })
  .strict()
  .refine((capability) => new Date(capability.expiresAt) > new Date(capability.observedAt), {
    message: 'Capability expiry must be after observation',
    path: ['expiresAt'],
  });

export type RniModelCapability = z.infer<typeof capabilitySchema>;

export type RniRuntimeModelRoute = RniResolvedModelRoute & {
  readonly canonicalProviderModelId: string;
  readonly reasoningEffort: typeof RNI_BALANCED_REASONING_EFFORT;
  readonly capabilitySnapshotId: string;
  readonly capabilityResponseHash: string;
  readonly capabilityObservedAt: string;
  readonly capabilityExpiresAt: string;
  readonly supportsResponses: true;
  readonly supportsStructuredOutputs: true;
  readonly supportsWebSearch: boolean;
  readonly policyVersion: typeof RNI_BALANCED_MODEL_POLICY_VERSION;
  readonly envelope: RniTaskEnvelope;
};

export type RniResolvedRuntimePolicy = {
  readonly aiRoute: RniAiRoute;
  readonly resolvedAt: string;
  readonly resolvedModels: readonly RniRuntimeModelRoute[];
};

type RuntimePolicyInput = RniResolvedRuntimePolicy;

export const assertRniBalancedRuntimePolicy = (input: RuntimePolicyInput): void => {
  const resolvedAt = z.string().datetime({ offset: true }).parse(input.resolvedAt);
  const tasks = Object.keys(TASK_POLICY) as readonly RniPromptTask[];
  if (input.resolvedModels.length !== tasks.length) {
    throw new Error('RNI runtime policy must resolve exactly five tasks');
  }
  for (const task of tasks) {
    const matches = input.resolvedModels.filter((route) => route.task === task);
    if (matches.length !== 1) throw new Error(`RNI runtime policy must resolve ${task} exactly once`);
    const route = matches[0]!;
    const expectedModel = APPROVED_MODELS[TASK_POLICY[task].family];
    if (
      route.provider !== 'openai' ||
      route.canonicalProviderModelId !== expectedModel ||
      route.reasoningEffort !== RNI_BALANCED_REASONING_EFFORT ||
      route.policyVersion !== RNI_BALANCED_MODEL_POLICY_VERSION
    ) {
      throw new Error(`RNI runtime policy has an unapproved mapping for ${task}`);
    }
    if (
      route.supportsResponses !== true ||
      route.supportsStructuredOutputs !== true ||
      (TASK_POLICY[task].requiresWebSearch && route.supportsWebSearch !== true)
    ) {
      throw new Error(`RNI runtime policy lacks required capabilities for ${task}`);
    }
    const envelope = rniTaskEnvelope.parse(route.envelope);
    if (envelope.task !== task) {
      throw new Error(`RNI runtime policy has a crossed task envelope for ${task}`);
    }
    if (input.aiRoute === 'openai_direct' && route.modelId !== route.canonicalProviderModelId) {
      throw new Error(`RNI Direct dispatch identity does not match ${task}'s approved model`);
    }
    z.string().min(1).parse(route.capabilitySnapshotId);
    z.string().regex(/^[a-f0-9]{64}$/u).parse(route.capabilityResponseHash);
    const observedAt = z.string().datetime({ offset: true }).parse(route.capabilityObservedAt);
    const expiresAt = z.string().datetime({ offset: true }).parse(route.capabilityExpiresAt);
    if (new Date(observedAt) > new Date(resolvedAt) || new Date(expiresAt) <= new Date(resolvedAt)) {
      throw new Error(`RNI runtime policy has stale capability lineage for ${task}`);
    }
  }
};

const capabilityFor = (
  capabilities: readonly RniModelCapability[],
  route: RniAiRoute,
  providerModelId: (typeof APPROVED_MODELS)[keyof typeof APPROVED_MODELS],
): RniModelCapability => {
  const matches = capabilities.filter(
    (capability) => capability.route === route && capability.providerModelId === providerModelId,
  );
  if (matches.length !== 1) {
    throw new Error(`RNI ${route} must expose exactly one capability for ${providerModelId}`);
  }
  return matches[0]!;
};

/**
 * Resolve the owner-approved D-RNI-21 policy from a freshly captured capability catalogue.
 * Gateway slugs are data supplied by that catalogue; this module never manufactures one.
 */
export const resolveRniBalancedModelPolicy = (input: {
  readonly aiRoute?: RniAiRoute;
  readonly capabilities: readonly RniModelCapability[];
  readonly now: string;
}): RniResolvedRuntimePolicy => {
  const capabilities = input.capabilities.map((capability) => capabilitySchema.parse(capability));
  const aiRoute = input.aiRoute ?? RNI_DEFAULT_AI_ROUTE;
  const now = z.string().datetime({ offset: true }).parse(input.now);
  const selected = new Map<keyof typeof APPROVED_MODELS, RniModelCapability>();

  for (const family of Object.keys(APPROVED_MODELS) as readonly (keyof typeof APPROVED_MODELS)[]) {
    const providerModelId = APPROVED_MODELS[family];
    const capability = capabilityFor(capabilities, aiRoute, providerModelId);
    if (!capability.available) {
      throw new Error(`RNI ${aiRoute} model ${capability.configuredModelId} is unavailable`);
    }
    if (aiRoute === 'openai_direct' && capability.configuredModelId !== capability.providerModelId) {
      throw new Error(`RNI Direct dispatch identity does not match ${providerModelId}`);
    }
    if (new Date(capability.observedAt) > new Date(now) || new Date(capability.expiresAt) <= new Date(now)) {
      throw new Error(`RNI ${aiRoute} model ${capability.configuredModelId} capability is stale`);
    }
    if (capability.provider !== 'openai' || capability.providerModelId !== providerModelId) {
      throw new Error(`RNI ${aiRoute} model ${capability.configuredModelId} is not approved OpenAI parity`);
    }
    if (
      !capability.supportsResponses ||
      !capability.supportsStructuredOutputs ||
      !capability.reasoningEfforts.includes(RNI_BALANCED_REASONING_EFFORT)
    ) {
      throw new Error(`RNI ${aiRoute} model ${capability.configuredModelId} lacks required capabilities`);
    }
    selected.set(family, capability);
  }

  const discoveryCapability = selected.get('terra')!;
  if (!discoveryCapability.supportsWebSearch) {
    throw new Error(`RNI ${aiRoute} discovery model lacks governed Web Search capability`);
  }

  const resolved: RniResolvedRuntimePolicy = {
    aiRoute,
    resolvedAt: now,
    resolvedModels: (Object.keys(TASK_POLICY) as readonly RniPromptTask[]).map((task) => {
      const taskPolicy = TASK_POLICY[task];
      const capability = selected.get(taskPolicy.family)!;
      if (taskPolicy.requiresWebSearch && !capability.supportsWebSearch) {
        throw new Error(`RNI ${task} requires governed Web Search capability`);
      }
      return {
        task,
        provider: capability.provider,
        modelId: capability.configuredModelId,
        canonicalProviderModelId: capability.providerModelId,
        modelRevision: capability.modelRevision,
        promptVersion: RNI_PROMPT_REGISTRY[task].promptVersion,
        reasoningEffort: RNI_BALANCED_REASONING_EFFORT,
        capabilitySnapshotId: capability.capabilitySnapshotId,
        capabilityResponseHash: capability.capabilityResponseHash,
        capabilityObservedAt: capability.observedAt,
        capabilityExpiresAt: capability.expiresAt,
        supportsResponses: true,
        supportsStructuredOutputs: true,
        supportsWebSearch: capability.supportsWebSearch,
        policyVersion: RNI_BALANCED_MODEL_POLICY_VERSION,
        envelope: RNI_APPROVED_TASK_ENVELOPES[task],
      };
    }),
  };
  assertRniBalancedRuntimePolicy(resolved);
  return resolved;
};
