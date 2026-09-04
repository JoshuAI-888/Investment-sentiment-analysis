import { z } from 'zod';
import {
  rniComparativeRelation,
  rniSecurityMention,
  type RniSecurityMention,
} from '@/rni/contracts';
import type {
  RniRelationshipIdFactory,
  RniRelationshipInferencePort,
  RniRelationshipProposal,
  RniSecurityResolutionCandidate,
} from './types';

const proposal = z
  .object({
    subjectSecurityId: z.string().uuid(),
    relation: z.enum(['preferred_over', 'less_preferred_than', 'similar_to', 'contrasts_with']),
    objectSecurityId: z.string().uuid(),
    evidenceStart: z.number().int().nonnegative(),
    evidenceEnd: z.number().int().positive(),
  })
  .strict()
  .refine((value) => value.subjectSecurityId !== value.objectSecurityId, {
    message: 'A comparative proposal requires two securities',
    path: ['objectSecurityId'],
  });

export const rniRelationshipModelOutput = z
  .object({ relationships: z.array(proposal).max(20) })
  .strict();

function canonicalProposal(input: RniRelationshipProposal): RniRelationshipProposal {
  if (input.relation === 'less_preferred_than') {
    return {
      ...input,
      subjectSecurityId: input.objectSecurityId,
      relation: 'preferred_over',
      objectSecurityId: input.subjectSecurityId,
    };
  }
  if (
    (input.relation === 'similar_to' || input.relation === 'contrasts_with') &&
    input.subjectSecurityId > input.objectSecurityId
  ) {
    return {
      ...input,
      subjectSecurityId: input.objectSecurityId,
      objectSecurityId: input.subjectSecurityId,
    };
  }
  return input;
}

/**
 * Calls the bounded inference port, then deterministically validates IDs, spans and inverse or
 * symmetric duplicates before constructing frozen comparative records.
 */
export async function inferComparativeRelations(input: {
  readonly sourceItemId: string;
  readonly boundedContent: string;
  readonly mentions: readonly RniSecurityMention[];
  readonly candidates: readonly RniSecurityResolutionCandidate[];
  readonly inference: RniRelationshipInferencePort;
  readonly idFactory: RniRelationshipIdFactory;
}): Promise<readonly z.infer<typeof rniComparativeRelation>[]> {
  const sourceItemId = z.string().uuid().parse(input.sourceItemId);
  const content = z.string().min(1).max(20_000).parse(input.boundedContent);
  const mentions = input.mentions.map((mention) => rniSecurityMention.parse(mention));
  if (mentions.some((mention) => mention.sourceItemId !== sourceItemId)) {
    throw new Error('RNI relation inference received a mention from another source');
  }
  const resolvedIds = new Set(mentions.map((mention) => mention.securityId));
  if (resolvedIds.size < 2) return [];

  const activeCandidates = input.candidates.filter(
    (candidate) => candidate.active && resolvedIds.has(candidate.id),
  );
  const parsed = rniRelationshipModelOutput.parse(
    await input.inference.infer({
      sourceItemId,
      boundedContent: content,
      mentions,
      candidates: activeCandidates,
    }),
  );

  const canonical = new Map<
    string,
    { proposal: RniRelationshipProposal; evidenceText: string }
  >();
  for (const rawProposal of parsed.relationships) {
    const normalized = canonicalProposal(rawProposal);
    if (
      !resolvedIds.has(normalized.subjectSecurityId) ||
      !resolvedIds.has(normalized.objectSecurityId)
    ) {
      throw new Error('RNI relationship proposal referenced an unresolved security');
    }
    if (normalized.evidenceEnd > content.length) {
      throw new Error('RNI relationship evidence span exceeds bounded source content');
    }
    const evidenceText = content.slice(normalized.evidenceStart, normalized.evidenceEnd);
    if (evidenceText.trim() === '') {
      throw new Error('RNI relationship evidence span is empty');
    }
    const coversSecurity = (securityId: string) =>
      mentions.some(
        (mention) =>
          mention.securityId === securityId &&
          mention.startOffset !== null &&
          mention.endOffset !== null &&
          mention.startOffset >= normalized.evidenceStart &&
          mention.endOffset <= normalized.evidenceEnd,
      );
    if (
      !coversSecurity(normalized.subjectSecurityId) ||
      !coversSecurity(normalized.objectSecurityId)
    ) {
      throw new Error('RNI relationship evidence must cover both resolved security mentions');
    }
    const key = [
      normalized.subjectSecurityId,
      normalized.relation,
      normalized.objectSecurityId,
    ].join(':');
    const current = canonical.get(key);
    const nextSpanLength = normalized.evidenceEnd - normalized.evidenceStart;
    const currentSpanLength = current
      ? current.proposal.evidenceEnd - current.proposal.evidenceStart
      : Number.POSITIVE_INFINITY;
    if (
      current === undefined ||
      nextSpanLength < currentSpanLength ||
      (nextSpanLength === currentSpanLength &&
        (normalized.evidenceStart < current.proposal.evidenceStart ||
          (normalized.evidenceStart === current.proposal.evidenceStart &&
            normalized.evidenceEnd < current.proposal.evidenceEnd)))
    ) {
      canonical.set(key, { proposal: normalized, evidenceText });
    }
  }

  return [...canonical.values()]
    .sort(
      (left, right) =>
        left.proposal.subjectSecurityId.localeCompare(right.proposal.subjectSecurityId) ||
        left.proposal.relation.localeCompare(right.proposal.relation) ||
        left.proposal.objectSecurityId.localeCompare(right.proposal.objectSecurityId) ||
        left.proposal.evidenceStart - right.proposal.evidenceStart ||
        left.proposal.evidenceEnd - right.proposal.evidenceEnd,
    )
    .map(({ proposal: normalized, evidenceText }, occurrence) =>
      rniComparativeRelation.parse({
        id: input.idFactory({
          sourceItemId,
          ...normalized,
          occurrence,
        }),
        sourceItemId,
        subjectSecurityId: normalized.subjectSecurityId,
        relation: normalized.relation,
        objectSecurityId: normalized.objectSecurityId,
        evidenceText,
      }),
    );
}
