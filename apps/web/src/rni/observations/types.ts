import type {
  RniComparativeRelation,
  RniReadService,
  RniSecurityMention,
} from '@/rni/contracts';

export type RniSecurityResolutionCandidate = {
  readonly id: string;
  readonly symbol: string;
  readonly name: string;
  readonly exchange: string;
  readonly aliases: readonly string[];
  readonly active: boolean;
};

export type RniBareTickerAmbiguityPolicy = {
  /** Version supplied by the governed universe/configuration owner for auditability. */
  readonly version: string;
  /** Symbols that must be cashtagged because their bare form is ambiguous prose. */
  readonly bareTickerSymbols: readonly string[];
};

export type RniSecurityResolutionRequest = {
  /** Must be the durable ID returned by source persistence. */
  readonly sourceItemId: string;
  readonly boundedContent: string;
  readonly candidates: readonly RniSecurityResolutionCandidate[];
  readonly ambiguityPolicy: RniBareTickerAmbiguityPolicy;
};

export type RniPersistedSourceResolutionRequest = Omit<
  RniSecurityResolutionRequest,
  'boundedContent'
>;

/** Frozen evidence reader narrowed to the one operation ENGINE consumes. */
export type RniCommittedEvidenceReader = Pick<RniReadService, 'getEvidence'>;

export type RniUnresolvedSecuritySpan = {
  readonly mentionText: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly reason: 'cashtag_required' | 'ambiguous_match';
  readonly candidateSecurityIds: readonly string[];
};

export type RniMentionIdFactory = (input: {
  readonly sourceItemId: string;
  readonly securityId: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly occurrence: number;
}) => string;

export type RniSecurityResolutionResult = {
  readonly mentions: readonly RniSecurityMention[];
  readonly unresolved: readonly RniUnresolvedSecuritySpan[];
};

export type RniRelationshipProposal = {
  readonly subjectSecurityId: string;
  readonly relation: RniComparativeRelation['relation'];
  readonly objectSecurityId: string;
  readonly evidenceStart: number;
  readonly evidenceEnd: number;
};

/**
 * Bounded model boundary. Source text is untrusted data, every candidate is supplied by the
 * deterministic resolver, and the implementation must expose no discovery or write tools.
 */
export interface RniRelationshipInferencePort {
  infer(input: {
    readonly sourceItemId: string;
    readonly boundedContent: string;
    readonly mentions: readonly RniSecurityMention[];
    readonly candidates: readonly RniSecurityResolutionCandidate[];
  }): Promise<unknown>;
}

export type RniRelationshipIdFactory = (input: {
  readonly sourceItemId: string;
  readonly subjectSecurityId: string;
  readonly relation: RniComparativeRelation['relation'];
  readonly objectSecurityId: string;
  readonly evidenceStart: number;
  readonly evidenceEnd: number;
  readonly occurrence: number;
}) => string;

export type RniSourceSecurityInterpretation = RniSecurityResolutionResult & {
  readonly relationships: readonly RniComparativeRelation[];
  readonly relationshipInferenceInvoked: boolean;
};
