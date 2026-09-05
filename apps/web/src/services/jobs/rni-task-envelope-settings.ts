import { canonicalHash } from '@/calc/canonical';
import {
  RNI_APPROVED_TASK_ENVELOPES,
} from '@/rni/config';
import {
  rniTaskEnvelopeSetting,
  rniTaskEnvelopeUpdateRequest,
  rniTaskEnvelopeUpdateResult,
  type RniTaskEnvelopeSettingsService,
} from '@/rni/contracts';
import {
  findActiveConfigVersion,
  findActiveRniTaskEnvelopeSetting,
  stageRniTaskEnvelopeSuccessor,
} from '@/repositories/versions';
import { RNI_PROMPT_REGISTRY } from '../../../prompts/rni/registry';

const hashRequest = (request: ReturnType<typeof rniTaskEnvelopeUpdateRequest.parse>): string =>
  canonicalHash({
    idempotencyKey: request.idempotencyKey,
    reason: request.reason,
    envelopes: request.envelopes.map((envelope) => ({
      ...envelope,
      maxInputBytes: String(envelope.maxInputBytes),
      maxInputTokensReserved: String(envelope.maxInputTokensReserved),
      maxOutputTokens: String(envelope.maxOutputTokens),
      maxToolCalls: String(envelope.maxToolCalls),
      timeoutMs: String(envelope.timeoutMs),
    })),
  });

export class RniTaskEnvelopeConfigurationUnavailableError extends Error {
  override readonly name = 'RniTaskEnvelopeConfigurationUnavailableError';
}

export const createRniTaskEnvelopeSettingsService = (options: {
  readonly environment: string;
  readonly actorId: string;
}): RniTaskEnvelopeSettingsService => ({
  getCurrentTaskEnvelopes: async () => {
    const persisted = await findActiveRniTaskEnvelopeSetting(options.environment);
    if (persisted !== null) return rniTaskEnvelopeSetting.parse(persisted);
    const active = await findActiveConfigVersion(options.environment);
    if (active === null) {
      throw new RniTaskEnvelopeConfigurationUnavailableError(
        `No active config_version in ${options.environment}`,
      );
    }
    return rniTaskEnvelopeSetting.parse({
      configVersion: active.id,
      status: 'active',
      effectiveAt: active.effectiveAt,
      envelopes: Object.values(RNI_APPROVED_TASK_ENVELOPES),
    });
  },
  stageFutureTaskEnvelopes: async (rawRequest) => {
    const request = rniTaskEnvelopeUpdateRequest.parse(rawRequest);
    const result = await stageRniTaskEnvelopeSuccessor({
      environment: options.environment,
      actorId: options.actorId,
      idempotencyKey: request.idempotencyKey,
      requestHash: hashRequest(request),
      reason: request.reason,
      routes: request.envelopes.map((envelope) => ({
        ...envelope,
        promptVersion: RNI_PROMPT_REGISTRY[envelope.task].promptVersion,
        schemaVersion: RNI_PROMPT_REGISTRY[envelope.task].outputSchemaVersion,
      })),
    });
    return rniTaskEnvelopeUpdateResult.parse(result);
  },
});
