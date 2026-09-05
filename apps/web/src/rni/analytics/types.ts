import type { RniDimensionKey, RniPlatform, RniSliceStatus } from '../contracts';

export const RNI_ANALYTICS_CODE_VERSION = 'rni-platform-analytics-v1';

export const RNI_CONFIDENCE_COMPONENT_KEYS = [
  'provenanceIntegrity',
  'evidenceQuality',
  'securityResolution',
  'breadthIndependence',
  'modelCalibration',
  'coverageRecency',
  'contradictionHandling',
] as const;

export type RniConfidenceComponentKey = (typeof RNI_CONFIDENCE_COMPONENT_KEYS)[number];

export const RNI_CONFIDENCE_PENALTY_KEYS = [
  'unresolvedMaterialClaim',
  'highNoise',
  'suspectedCoordination',
  'routeCapabilityDegradation',
] as const;

export type RniConfidencePenaltyKey = (typeof RNI_CONFIDENCE_PENALTY_KEYS)[number];

export type RniAnalyticsDimensionInput = {
  readonly dimension: RniDimensionKey;
  readonly score: string | null;
};

/** One persisted, eligible source/security observation projected into deterministic analytics. */
export type RniAnalyticsObservationInput = {
  readonly sourceItemId: string;
  readonly mentionIds: readonly string[];
  readonly platform: RniPlatform;
  readonly securityId: string;
  readonly communityOrScope: string;
  readonly analyticalCluster: string;
  readonly authorHash: string | null;
  readonly narrativeId: string | null;
  readonly independentNarrative: boolean;
  /** Stable identity shared by exact/near-duplicate observations. */
  readonly duplicateGroupKey: string;
  readonly duplicateGroupSize: string;
  readonly dimensions: readonly RniAnalyticsDimensionInput[];
  readonly informationValue: string;
  readonly evidenceQuality: string;
  readonly assertionStrength: string;
  readonly sarcasmProbability: string;
  readonly spamProbability: string;
  readonly memeProbability: string;
  readonly sourceWeight: string;
  readonly communityWeight: string;
  readonly publishedAt: string | null;
  readonly observedAt: string;
  readonly exclusionReason: 'off_topic' | 'spam' | 'unresolved_context' | null;
};

export type RniAnalyticsWindowInput = {
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly durationDays: string;
  readonly observations: readonly RniAnalyticsObservationInput[];
};

export type RniAnalyticsBaselineWindowInput = {
  readonly platform: RniPlatform;
  readonly securityId: string;
  readonly durationDays: string;
  readonly methodologyVersion: string;
  readonly windowEnd: string;
  readonly effectiveAttention: string;
  readonly inputSetHash: string;
};

export type RniAnalyticsMethodology = {
  readonly version: string;
  readonly codeVersion: typeof RNI_ANALYTICS_CODE_VERSION;
  readonly timestampBasis: 'published_at_else_observed_at';
  readonly memePenalty: string;
  readonly halfLifeHours: string;
  readonly lowBaseThreshold: string;
  readonly epsilon: string;
  readonly minimumEffectiveAttention: string;
  readonly minimumIndependentSources: string;
  readonly winsorLowerPercentile: string;
  readonly winsorUpperPercentile: string;
  readonly minimumBaselineWindows: string;
  readonly zScoreDecimalPlaces: '6';
  readonly highNarrativeConcentrationThreshold: string;
  readonly staleAfterHours: string;
  readonly confidenceWeights: Readonly<Record<RniConfidenceComponentKey, string>>;
  readonly confidenceBands: {
    readonly mediumMinimum: string;
    readonly highMinimum: string;
    readonly veryHighMinimum: string;
  };
  readonly confidenceCaps: {
    readonly singleSourceOrCommunity: string;
    readonly highNarrativeConcentration: string;
    readonly partialCoverage: string;
    readonly staleEvidence: string;
  };
};

export type RniPlatformAnalyticsInput = {
  readonly runId: string;
  readonly runSourceSliceId: string;
  readonly platform: RniPlatform;
  readonly securityId: string;
  readonly sliceStatus: Extract<RniSliceStatus, 'complete' | 'partial' | 'failed' | 'unavailable'>;
  readonly current: RniAnalyticsWindowInput;
  readonly comparison: RniAnalyticsWindowInput | null;
  readonly baseline: readonly RniAnalyticsBaselineWindowInput[];
  readonly confidenceComponents: Readonly<Record<RniConfidenceComponentKey, string>>;
  readonly confidencePenalties: Readonly<Record<RniConfidencePenaltyKey, string>>;
  readonly confidenceReadiness: {
    readonly narrativeStageTerminal: boolean;
    readonly catalystStageTerminal: boolean;
  };
};

export type RniWeightedObservationTrace = {
  readonly sourceItemId: string;
  readonly weight: string;
  readonly baseQuality: string;
  readonly noise: string;
  readonly independence: string;
  readonly freshness: string;
};

export type RniSentimentMetric = {
  readonly dimension: RniDimensionKey;
  readonly sentimentIndex: string | null;
  readonly meanDirection: string | null;
  readonly effectiveAttention: string;
  readonly independentSourceCount: string;
  readonly sourceItemIds: readonly string[];
  readonly status: 'available' | 'insufficient_evidence';
};

export type RniZScoreMetric = {
  readonly value: string | null;
  readonly status: 'available' | 'insufficient_baseline' | 'zero_variance';
  readonly baselineWindowCount: string;
  readonly winsorizedLowerValue: string | null;
  readonly winsorizedUpperValue: string | null;
};

export type RniConfidenceBand = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';

export type RniConfidenceResult = {
  /** Frozen read-model compatible unit decimal. */
  readonly unitScore: string;
  /** Methodology display score from 0 through 100. */
  readonly score100: string;
  readonly uncappedScore100: string;
  readonly band: RniConfidenceBand;
  readonly weightedComponents: Readonly<Record<RniConfidenceComponentKey, string>>;
  readonly totalPenalty: string;
  readonly appliedCaps: readonly {
    readonly reason:
      | 'single_source_or_community'
      | 'high_narrative_concentration'
      | 'partial_coverage'
      | 'stale_evidence';
    readonly cap: string;
  }[];
  /** Confidence is defensibility of this result, never likelihood of price movement. */
  readonly meaning: 'evidence_defensibility_not_price_probability';
};

export type RniPlatformAnalyticsResult = {
  readonly platform: RniPlatform;
  readonly securityId: string;
  readonly rawMentions: string;
  /** Frozen-contract attention: distinct eligible persisted source items. */
  readonly attention: string;
  readonly effectiveAttention: string;
  readonly comparisonAttention: string | null;
  readonly comparisonEffectiveAttention: string | null;
  readonly absoluteAttentionChange: string | null;
  readonly percentAttentionChange: string | null;
  readonly currentAttentionRate: string;
  readonly comparisonAttentionRate: string | null;
  /** Frozen-contract velocity: relative change in comparable attention rates. */
  readonly velocity: string | null;
  /** DATA_MODEL_AND_LINEAGE rate delta, kept distinct from frozen-contract velocity. */
  readonly acceleration: string | null;
  readonly changeStatus: 'available' | 'missing_comparison' | 'emerging_from_low_base';
  readonly sentimentByDimension: readonly RniSentimentMetric[];
  readonly authorBreadth: string;
  readonly communityBreadth: string;
  readonly clusterAdjustedCommunityBreadth: string;
  readonly narrativeBreadth: string;
  readonly narrativeHhi: string;
  readonly independentSourceBreadth: string;
  readonly zScore: RniZScoreMetric;
  readonly confidence: RniConfidenceResult | null;
  readonly confidenceStatus:
    | 'available'
    | 'insufficient_evidence'
    | 'awaiting_narrative_stage'
    | 'awaiting_catalyst_stage';
  readonly weightTrace: readonly RniWeightedObservationTrace[];
};

export type RniPlatformAnalyticsArtifact = {
  readonly runId: string;
  readonly runSourceSliceId: string;
  readonly methodologyVersion: string;
  readonly calculationCodeVersion: typeof RNI_ANALYTICS_CODE_VERSION;
  readonly inputSetHash: string;
  readonly resultHash: string;
  readonly inputSnapshot: RniPlatformAnalyticsInput;
  readonly methodologySnapshot: RniAnalyticsMethodology;
  readonly result: RniPlatformAnalyticsResult;
};
