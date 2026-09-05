import type {
  RniCommittedEvidenceReader,
  RniMentionIdFactory,
  RniPersistedSourceResolutionRequest,
  RniRelationshipIdFactory,
  RniRelationshipInferencePort,
  RniSecurityResolutionRequest,
  RniSourceSecurityInterpretation,
} from './types';
import { rniSourceItem } from '@/rni/contracts';
import { z } from 'zod';
import { resolveSecurityMentions } from './resolver';
import { inferComparativeRelations } from './relationships';

async function resolveSourceSecurities(
  request: RniSecurityResolutionRequest,
  deps: {
    readonly mentionIdFactory: RniMentionIdFactory;
    readonly relationshipIdFactory: RniRelationshipIdFactory;
    readonly relationshipInference: RniRelationshipInferencePort;
  },
): Promise<RniSourceSecurityInterpretation> {
  const resolution = resolveSecurityMentions(request, deps.mentionIdFactory);
  const relationships = await inferComparativeRelations({
    sourceItemId: request.sourceItemId,
    boundedContent: request.boundedContent,
    mentions: resolution.mentions,
    candidates: request.candidates,
    inference: deps.relationshipInference,
    idFactory: deps.relationshipIdFactory,
  });
  return {
    ...resolution,
    relationships,
    relationshipInferenceInvoked: new Set(resolution.mentions.map((item) => item.securityId)).size >= 2,
  };
}

/** Reads bounded evidence by durable source ID before any resolver or model input is built. */
export async function resolvePersistedSourceSecurities(
  request: RniPersistedSourceResolutionRequest,
  deps: {
    readonly evidence: RniCommittedEvidenceReader;
    readonly mentionIdFactory: RniMentionIdFactory;
    readonly relationshipIdFactory: RniRelationshipIdFactory;
    readonly relationshipInference: RniRelationshipInferencePort;
  },
): Promise<RniSourceSecurityInterpretation> {
  const sourceItemId = z.string().uuid().parse(request.sourceItemId);
  const evidence = rniSourceItem.parse(await deps.evidence.getEvidence(sourceItemId));
  if (evidence.id !== sourceItemId) {
    throw new Error('RNI evidence reader returned a different durable source identity');
  }
  return resolveSourceSecurities(
    {
      ...request,
      sourceItemId,
      boundedContent: evidence.boundedContent,
    },
    deps,
  );
}
