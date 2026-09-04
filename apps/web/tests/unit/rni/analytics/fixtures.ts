import type {
  RniAnalyticsMethodology,
  RniAnalyticsObservationInput,
  RniPlatformAnalyticsInput,
} from '../../../../src/rni/analytics';
import { RNI_ANALYTICS_CODE_VERSION } from '../../../../src/rni/analytics';
import type { RniPlatform } from '../../../../src/rni/contracts';

export const RUN_ID = '00000000-0000-4000-8000-000000000601';
export const REDDIT_SLICE_ID = '00000000-0000-4000-8000-000000000602';
export const X_SLICE_ID = '00000000-0000-4000-8000-000000000603';
export const SECURITY_ID = '00000000-0000-4000-8000-000000000604';

const dimensions = (score: string | null) => [
  { dimension: 'company_fundamentals' as const, score },
  { dimension: 'market_trading' as const, score },
  { dimension: 'catalyst_event' as const, score },
  { dimension: 'retail_narrative' as const, score },
];

function observation(input: {
  readonly sourceItemId: string;
  readonly mentionIds: readonly string[];
  readonly platform: RniPlatform;
  readonly securityId?: string;
  readonly community: string;
  readonly cluster: string;
  readonly authorHash: string;
  readonly narrativeId: string;
  readonly publishedAt: string;
  readonly score: string;
}): RniAnalyticsObservationInput {
  return {
    sourceItemId: input.sourceItemId,
    mentionIds: input.mentionIds,
    platform: input.platform,
    securityId: input.securityId ?? SECURITY_ID,
    communityOrScope: input.community,
    analyticalCluster: input.cluster,
    authorHash: input.authorHash,
    narrativeId: input.narrativeId,
    independentNarrative: true,
    duplicateGroupKey: input.sourceItemId,
    duplicateGroupSize: '1',
    dimensions: dimensions(input.score),
    informationValue: '1',
    evidenceQuality: '1',
    assertionStrength: '1',
    sarcasmProbability: '0',
    spamProbability: '0',
    memeProbability: '0',
    sourceWeight: '1',
    communityWeight: '1',
    publishedAt: input.publishedAt,
    observedAt: input.publishedAt,
    exclusionReason: null,
  };
}

export function methodology(version = 'methodology-v1'): RniAnalyticsMethodology {
  return {
    version,
    codeVersion: RNI_ANALYTICS_CODE_VERSION,
    timestampBasis: 'published_at_else_observed_at',
    memePenalty: '0.9',
    halfLifeHours: '1',
    lowBaseThreshold: '1',
    epsilon: '0.000001',
    minimumEffectiveAttention: '0.5',
    minimumIndependentSources: '2',
    winsorLowerPercentile: '0',
    winsorUpperPercentile: '1',
    minimumBaselineWindows: '3',
    zScoreDecimalPlaces: '6',
    highNarrativeConcentrationThreshold: '0.9',
    staleAfterHours: '24',
    confidenceWeights: {
      provenanceIntegrity: '0.20',
      evidenceQuality: '0.20',
      securityResolution: '0.15',
      breadthIndependence: '0.15',
      modelCalibration: '0.15',
      coverageRecency: '0.10',
      contradictionHandling: '0.05',
    },
    confidenceBands: {
      mediumMinimum: '40',
      highMinimum: '70',
      veryHighMinimum: '85',
    },
    confidenceCaps: {
      singleSourceOrCommunity: '69',
      highNarrativeConcentration: '69',
      partialCoverage: '69',
      staleEvidence: '39',
    },
  };
}

export function platformInput(platform: RniPlatform = 'reddit'): RniPlatformAnalyticsInput {
  const current = [
    observation({
      sourceItemId: '00000000-0000-4000-8000-000000000611',
      mentionIds: [
        '00000000-0000-4000-8000-000000000621',
        '00000000-0000-4000-8000-000000000622',
      ],
      platform,
      community: platform === 'reddit' ? 'wallstreetbets' : 'x-query-one',
      cluster: platform === 'reddit' ? 'wallstreetbets' : 'x-query-one',
      authorHash: '1'.repeat(64),
      narrativeId: '00000000-0000-4000-8000-000000000631',
      publishedAt: '2026-09-05T11:00:00Z',
      score: '1',
    }),
    observation({
      sourceItemId: '00000000-0000-4000-8000-000000000612',
      mentionIds: ['00000000-0000-4000-8000-000000000623'],
      platform,
      community: platform === 'reddit' ? 'stocks' : 'x-query-two',
      cluster: platform === 'reddit' ? 'stocks' : 'x-query-two',
      authorHash: '2'.repeat(64),
      narrativeId: '00000000-0000-4000-8000-000000000632',
      publishedAt: '2026-09-05T11:00:00Z',
      score: '-0.5',
    }),
  ];
  const comparison = [
    observation({
      sourceItemId: '00000000-0000-4000-8000-000000000613',
      mentionIds: ['00000000-0000-4000-8000-000000000624'],
      platform,
      community: platform === 'reddit' ? 'investing' : 'x-query-three',
      cluster: platform === 'reddit' ? 'investing' : 'x-query-three',
      authorHash: '3'.repeat(64),
      narrativeId: '00000000-0000-4000-8000-000000000633',
      publishedAt: '2026-09-04T11:00:00Z',
      score: '0',
    }),
  ];
  return {
    runId: RUN_ID,
    runSourceSliceId: platform === 'reddit' ? REDDIT_SLICE_ID : X_SLICE_ID,
    platform,
    securityId: SECURITY_ID,
    sliceStatus: 'complete',
    current: {
      windowStart: '2026-09-04T12:00:00Z',
      windowEnd: '2026-09-05T12:00:00Z',
      durationDays: '1',
      observations: current,
    },
    comparison: {
      windowStart: '2026-09-02T12:00:00Z',
      windowEnd: '2026-09-04T12:00:00Z',
      durationDays: '2',
      observations: comparison,
    },
    baseline: [
      {
        platform,
        securityId: SECURITY_ID,
        durationDays: '1',
        methodologyVersion: 'methodology-v1',
        windowEnd: '2026-08-28T12:00:00Z',
        effectiveAttention: '0',
        inputSetHash: 'a'.repeat(64),
      },
      {
        platform,
        securityId: SECURITY_ID,
        durationDays: '1',
        methodologyVersion: 'methodology-v1',
        windowEnd: '2026-08-29T12:00:00Z',
        effectiveAttention: '1',
        inputSetHash: 'b'.repeat(64),
      },
      {
        platform,
        securityId: SECURITY_ID,
        durationDays: '1',
        methodologyVersion: 'methodology-v1',
        windowEnd: '2026-08-30T12:00:00Z',
        effectiveAttention: '3',
        inputSetHash: 'c'.repeat(64),
      },
    ],
    confidenceComponents: {
      provenanceIntegrity: '1',
      evidenceQuality: '1',
      securityResolution: '1',
      breadthIndependence: '1',
      modelCalibration: '1',
      coverageRecency: '1',
      contradictionHandling: '1',
    },
    confidencePenalties: {
      unresolvedMaterialClaim: '0',
      highNoise: '0',
      suspectedCoordination: '0',
      routeCapabilityDegradation: '0',
    },
    confidenceReadiness: {
      narrativeStageTerminal: true,
      catalystStageTerminal: true,
    },
  };
}
