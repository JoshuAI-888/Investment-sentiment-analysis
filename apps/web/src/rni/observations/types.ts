import type {
  RniComparativeRelation,
  RniDimensionKey,
  RniPlatform,
  RniReadService,
  RniSecurityObservation,
  RniSecurityMention,
  RniStance,
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

export type RniThemeTaxonomySnapshot = {
  readonly version: string;
  readonly categories: readonly {
    readonly definitionId: string;
    readonly stableKey: string;
    readonly label: string;
    readonly description: string;
    readonly enabled: boolean;
    readonly classificationThreshold: string;
  }[];
};

export type RniClassificationPolicy = {
  readonly version: string;
  readonly schemaVersion: string;
  readonly neutralMaxAbsoluteScore: string;
  readonly strongMinAbsoluteScore: string;
  readonly binaryLabelThreshold: string;
};

export type RniEvidenceSpan = {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly evidenceText: string;
};

export type RniClassifiedClaim = RniEvidenceSpan & {
  readonly sourceItemId: string;
  readonly securityId: string;
  readonly dimension: RniDimensionKey;
  readonly claimText: string;
  readonly claimType: 'fact_assertion' | 'opinion' | 'forecast' | 'position' | 'question' | 'joke';
  readonly epistemicStatus: 'source_claim' | 'unverified';
};

export type RniClassifiedTheme = RniEvidenceSpan & {
  readonly sourceItemId: string;
  readonly securityId: string;
  readonly taxonomyVersion: string;
  readonly themeDefinitionId: string;
  readonly stableKey: string;
  readonly stance: RniStance;
  readonly score: string | null;
  readonly classificationConfidence: string;
};

export type RniSecurityNoiseAssessment = RniEvidenceSpan & {
  readonly sourceItemId: string;
  readonly securityId: string;
  readonly isSarcastic: boolean;
  readonly sarcasmProbability: string;
  readonly isMeme: boolean;
  readonly memeProbability: string;
  readonly isSpam: boolean;
  readonly spamProbability: string;
  readonly informationValue: string;
  readonly assertionStrength: string;
  readonly evidenceQuality: string;
  readonly uncertainty: string;
  readonly exclusionReason: 'off_topic' | 'spam' | 'unresolved_context' | null;
};

export type RniCitationProposal = {
  readonly sourceItemId: string;
  readonly securityId: string;
  readonly dimension: RniDimensionKey;
  readonly claimText: string;
  readonly claimType: RniClassifiedClaim['claimType'];
  readonly epistemicStatus: RniClassifiedClaim['epistemicStatus'];
  readonly platform: RniPlatform;
  readonly url: string;
  readonly evidenceText: string;
  readonly startOffset: number;
  readonly endOffset: number;
};

export type RniPersistedClassificationRequest = {
  readonly sourceItemId: string;
  readonly mentions: readonly RniSecurityMention[];
  readonly taxonomy: RniThemeTaxonomySnapshot;
  readonly classificationPolicy: RniClassificationPolicy;
  /** Durable model-run identity created by orchestration before classification. */
  readonly classifierRunId: string;
  readonly promptVersion: string;
  readonly modelId: string;
  readonly createdAt: string;
};

export type RniClassifierEvidenceReader = Pick<RniReadService, 'getEvidence'>;

export interface RniClassifierInferencePort {
  infer(input: {
    /** Exact durable model-call identity preallocated for this classification batch. */
    readonly modelRunId: string;
    readonly policy: {
      readonly sourceContentTreatment: 'untrusted_data';
      readonly allowedTools: readonly [];
      readonly classification: RniClassificationPolicy;
    };
    readonly promptVersion: string;
    readonly modelId: string;
    readonly sourceItemId: string;
    readonly platform: RniPlatform;
    readonly untrustedBoundedContent: string;
    readonly targetSecurityId: string;
    readonly targetMentions: readonly RniSecurityMention[];
    readonly contextMentions: readonly RniSecurityMention[];
    readonly taxonomy: RniThemeTaxonomySnapshot;
  }): Promise<unknown>;
}

export type RniObservationIdFactory = (input: {
  readonly sourceItemId: string;
  readonly securityId: string;
  readonly classifierRunId: string;
  readonly occurrence: number;
}) => string;

export type RniPersistedClassificationResult = {
  readonly observations: readonly RniSecurityObservation[];
  readonly claims: readonly RniClassifiedClaim[];
  readonly themes: readonly RniClassifiedTheme[];
  readonly noise: readonly RniSecurityNoiseAssessment[];
  readonly citationProposals: readonly RniCitationProposal[];
  readonly inputHashesBySecurity: Readonly<Record<string, string>>;
};
