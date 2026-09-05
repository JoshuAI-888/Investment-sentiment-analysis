import type {
  RniCitation,
  RniCombinedSummary,
  RniPlatform,
  RniReadService,
  RniSourceItem,
} from '../contracts';
import type { RniConvergenceArtifact, RniConvergenceResult } from '../convergence';

export const RNI_CITED_SYNTHESIS_CODE_VERSION = 'rni-cited-synthesis-v1';

export type RniSynthesisClaim = {
  readonly id: string;
  readonly runId: string;
  readonly securityId: string;
  readonly platform: RniPlatform;
  readonly kind: 'catalyst';
  readonly claimText: string;
  readonly sourceCitationIds: readonly string[];
  readonly verificationCutoffAt: string;
};

export type RniCitationEvidenceRole =
  | 'social_claim'
  | 'corroborating'
  | 'counterevidence';

/** Trusted D-RNI-19 lineage boundary; coordinator-owned I07 supplies durable composition. */
export type RniCitationPublicationLineage = {
  readonly claimId: string | null;
  readonly citationId: string;
  readonly runId: string;
  readonly securityId: string;
  readonly evidenceRole: RniCitationEvidenceRole;
  readonly analyticsArtifactHash: string | null;
  readonly rightsPolicyVersion: string;
};

export type RniInferenceInvocationDescriptor<
  TStage extends 'verification' | 'challenger' = 'verification' | 'challenger',
> = {
  readonly modelRunId: string;
  readonly stage: TStage;
  readonly runId: string;
  readonly securityId: string;
  readonly modelId: string;
  readonly promptVersion: string;
  readonly policyVersion: string;
  readonly rightsPolicyVersion: string;
  readonly claimIds: readonly string[];
  readonly assessmentCutoffAt: string;
};

export type RniCitedSynthesisRequest = {
  readonly codeVersion: typeof RNI_CITED_SYNTHESIS_CODE_VERSION;
  readonly policyVersion: string;
  readonly rightsPolicyVersion: string;
  readonly summaryId: string;
  readonly verificationInvocation: RniInferenceInvocationDescriptor<'verification'>;
  readonly challengerInvocation: RniInferenceInvocationDescriptor<'challenger'>;
  readonly createdAt: string;
  readonly convergenceArtifact: RniConvergenceArtifact;
  readonly claims: readonly RniSynthesisClaim[];
  readonly platformCitationIds: {
    readonly reddit: readonly string[];
    readonly x: readonly string[];
  };
  readonly citationIds: readonly string[];
};

export type RniVerifiedCitationEvidence = {
  readonly lineage: RniCitationPublicationLineage;
  readonly citation: RniCitation;
  readonly source: RniSourceItem;
};

export type RniVerificationClaimInput = {
  readonly claim: RniSynthesisClaim;
  readonly evidence: readonly RniVerifiedCitationEvidence[];
};

export type RniVerificationModelInput = {
  readonly policy: {
    readonly version: string;
    readonly sourceContentTreatment: 'untrusted_data';
    readonly allowedTools: readonly [];
    readonly outputTextPublication: 'forbidden_structured_verdicts_only';
  };
  readonly invocation: RniInferenceInvocationDescriptor<'verification'>;
  readonly runId: string;
  readonly securityId: string;
  readonly convergenceFacts: RniConvergenceResult;
  readonly claimInputs: readonly RniVerificationClaimInput[];
};

export type RniClaimVerdict = 'supported' | 'contradicted' | 'contested' | 'unverified';

export type RniClaimAssessment = {
  readonly claimId: string;
  readonly verdict: RniClaimVerdict;
  readonly supportingCitationIds: readonly string[];
  readonly contradictingCitationIds: readonly string[];
};

export interface RniVerificationInferencePort {
  verify(input: RniVerificationModelInput): Promise<unknown>;
}

export type RniChallengerModelInput = Omit<RniVerificationModelInput, 'invocation'> & {
  readonly invocation: RniInferenceInvocationDescriptor<'challenger'>;
  readonly verification: readonly RniClaimAssessment[];
};

export type RniChallengerAssessment = {
  readonly verdict: 'no_supported_challenge_found' | 'material_challenge' | 'insufficient';
  readonly challengedClaimId: string | null;
  readonly citationIds: readonly string[];
};

export interface RniChallengerInferencePort {
  challenge(input: RniChallengerModelInput): Promise<unknown>;
}

export type RniSummaryStatement = {
  readonly heading: 'Reddit sentiment' | 'X sentiment' | 'Combined summary';
  readonly origin:
    | 'platform_conclusion'
    | 'corroborated_catalyst'
    | 'challenged_catalyst'
    | 'cross_source_fact'
    | 'coverage_disclosure';
  readonly text: string;
  readonly citationIds: readonly string[];
};

export type RniCitedSynthesisResult = {
  readonly summary: RniCombinedSummary;
  /** Exact E07 component records remain separate and cannot be replaced by synthesis. */
  readonly platformConclusions: RniConvergenceResult['platforms'];
  readonly statements: readonly RniSummaryStatement[];
  readonly verification: readonly RniClaimAssessment[];
  readonly challenger: RniChallengerAssessment;
  readonly interpretation: 'deterministic_citation_gated_no_pooled_metric';
};

export type RniCitedSynthesisArtifact = {
  readonly calculationCodeVersion: typeof RNI_CITED_SYNTHESIS_CODE_VERSION;
  readonly policyVersion: string;
  readonly inputHash: string;
  readonly verificationInputHash: string;
  readonly challengerInputHash: string;
  readonly resultHash: string;
  readonly requestSnapshot: RniCitedSynthesisRequest;
  readonly modelInputSnapshot: RniVerificationModelInput;
  readonly verificationOutputSnapshot: readonly RniClaimAssessment[];
  readonly challengerOutputSnapshot: RniChallengerAssessment;
  readonly result: RniCitedSynthesisResult;
};

export type RniSynthesisEvidenceReader = Pick<RniReadService, 'getCitation' | 'getEvidence'> & {
  getCitationLineage(
    claimId: string | null,
    citationId: string,
  ): Promise<RniCitationPublicationLineage | null>;
  getSynthesisClaim(claimId: string): Promise<RniSynthesisClaim>;
  getModelInvocation(modelRunId: string): Promise<RniInferenceInvocationDescriptor>;
  getActiveRightsPolicyVersion(runId: string): Promise<string>;
};
