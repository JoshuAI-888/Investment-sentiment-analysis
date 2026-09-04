import type { RniDimensionKey, RniPlatform, RniSliceStatus, RniStance } from '../contracts';

export const RNI_CONVERGENCE_CODE_VERSION = 'rni-cross-source-facts-v1';

export type RniConvergenceDimensionInput = {
  readonly dimension: RniDimensionKey;
  readonly stance: RniStance;
  readonly score: string | null;
};

export type RniConvergencePlatformInput = {
  readonly platform: RniPlatform;
  readonly runId: string;
  readonly runSourceSliceId: string;
  readonly securityId: string;
  readonly methodologyVersion: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly status: RniSliceStatus;
  readonly stance: RniStance;
  readonly stanceScore: string | null;
  readonly dimensions: readonly RniConvergenceDimensionInput[];
  readonly effectiveAttention: string;
  readonly dataThroughAt: string | null;
  readonly analyticsArtifactHash: string;
};

export type RniConvergencePolicy = {
  readonly version: string;
  readonly codeVersion: typeof RNI_CONVERGENCE_CODE_VERSION;
  readonly dimensionDivergenceMinimum: string;
  readonly scaleImbalanceRatioThreshold: string;
  readonly staleAfterHours: string;
};

export type RniConvergenceRequest = {
  readonly asOf: string;
  readonly reddit: RniConvergencePlatformInput;
  readonly x: RniConvergencePlatformInput;
  readonly policy: RniConvergencePolicy;
};

export type RniCrossSourceStatus =
  | 'PENDING_CROSS_SOURCE'
  | 'COMPLETE_CROSS_SOURCE'
  | 'DIVERGENT_CROSS_SOURCE'
  | 'PARTIAL_CROSS_SOURCE'
  | 'INSUFFICIENT_CROSS_SOURCE';

export type RniDirectionGroup = 'bearish' | 'neutral' | 'bullish' | 'insufficient';

export type RniDirectionAgreement = 'aligned' | 'divergent' | 'mixed' | 'insufficient';

export type RniDimensionAgreementFact = {
  readonly dimension: RniDimensionKey;
  readonly redditStance: RniStance;
  readonly xStance: RniStance;
  readonly redditScore: string | null;
  readonly xScore: string | null;
  readonly scoreDelta: string | null;
  readonly agreement: RniDirectionAgreement;
};

export type RniConvergenceResult = {
  readonly runId: string;
  readonly securityId: string;
  readonly methodologyVersion: string;
  readonly status: RniCrossSourceStatus;
  readonly radarState: 'pending' | 'aligned' | 'divergent' | 'partial' | 'insufficient';
  /** Exact platform inputs are preserved; neither can be replaced by the other. */
  readonly platforms: {
    readonly reddit: RniConvergencePlatformInput;
    readonly x: RniConvergencePlatformInput;
  };
  readonly facts: {
    readonly overall: {
      readonly redditDirection: RniDirectionGroup;
      readonly xDirection: RniDirectionGroup;
      readonly redditScore: string | null;
      readonly xScore: string | null;
      readonly scoreDelta: string | null;
      readonly agreement: RniDirectionAgreement;
    };
    readonly dimensions: readonly RniDimensionAgreementFact[];
    readonly scaleImbalance: {
      readonly state: 'balanced' | 'reddit_higher' | 'x_higher' | 'unbounded' | 'unavailable';
      readonly dominantPlatform: RniPlatform | null;
      readonly ratio: string | null;
      readonly redditEffectiveAttention: string;
      readonly xEffectiveAttention: string;
    };
    readonly freshness: {
      readonly reddit: 'fresh' | 'stale' | 'unknown';
      readonly x: 'fresh' | 'stale' | 'unknown';
    };
    readonly coverage: {
      readonly redditStatus: RniSliceStatus;
      readonly xStatus: RniSliceStatus;
      readonly nonTerminalPlatforms: readonly RniPlatform[];
      readonly missingPlatforms: readonly RniPlatform[];
      readonly insufficientPlatforms: readonly RniPlatform[];
      readonly stalePlatforms: readonly RniPlatform[];
    };
  };
  readonly interpretation: 'cross_source_facts_only_no_pooled_metric';
};

export type RniConvergenceArtifact = {
  readonly calculationCodeVersion: typeof RNI_CONVERGENCE_CODE_VERSION;
  readonly policyVersion: string;
  readonly inputHash: string;
  readonly resultHash: string;
  readonly inputSnapshot: RniConvergenceRequest;
  readonly result: RniConvergenceResult;
};
