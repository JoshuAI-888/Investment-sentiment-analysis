import { z } from 'zod';

import { canonicalHash } from '../../calc/canonical';
import { D, exact, isDecimalString, type Dec } from '../../calc/decimal';
import {
  rniDimensionKey,
  rniIsoTimestamp,
  rniPlatform,
  rniSha256,
  rniSignedDecimal,
  rniUnitDecimal,
} from '../contracts';
import {
  RNI_ANALYTICS_CODE_VERSION,
  RNI_CONFIDENCE_COMPONENT_KEYS,
  RNI_CONFIDENCE_PENALTY_KEYS,
  type RniAnalyticsBaselineWindowInput,
  type RniAnalyticsMethodology,
  type RniAnalyticsObservationInput,
  type RniAnalyticsWindowInput,
  type RniConfidenceBand,
  type RniConfidenceComponentKey,
  type RniConfidencePenaltyKey,
  type RniConfidenceResult,
  type RniPlatformAnalyticsArtifact,
  type RniPlatformAnalyticsInput,
  type RniPlatformAnalyticsResult,
  type RniSentimentMetric,
  type RniWeightedObservationTrace,
  type RniZScoreMetric,
} from './types';

const ZERO = new D('0');
const ONE = new D('1');
const HUNDRED = new D('100');
const SENTIMENT_DECIMAL_PLACES = 1;
const CONFIDENCE_DECIMAL_PLACES = 0;
const Z_SCORE_DECIMAL_PLACES = 6;

const nonnegativeDecimal = z
  .string()
  .refine(
    (value) =>
      isDecimalString(value) && new D(value).isFinite() && new D(value).greaterThanOrEqualTo(ZERO),
  );
const positiveDecimal = nonnegativeDecimal.refine((value) => new D(value).greaterThan(ZERO));
const positiveIntegerDecimal = z.string().regex(/^[1-9]\d*$/u);
const scoreDecimal = z
  .string()
  .refine(
    (value) =>
      isDecimalString(value) &&
      new D(value).greaterThanOrEqualTo(ZERO) &&
      new D(value).lessThanOrEqualTo('100'),
  );

const dimensionInputSchema = z
  .object({
    dimension: rniDimensionKey,
    score: rniSignedDecimal.nullable(),
  })
  .strict();

const observationSchema = z
  .object({
    sourceItemId: z.string().uuid(),
    mentionIds: z.array(z.string().uuid()).min(1),
    platform: rniPlatform,
    securityId: z.string().uuid(),
    communityOrScope: z.string().min(1),
    analyticalCluster: z.string().min(1),
    authorHash: rniSha256.nullable(),
    narrativeId: z.string().uuid().nullable(),
    independentNarrative: z.boolean(),
    duplicateGroupKey: z.string().min(1),
    duplicateGroupSize: positiveIntegerDecimal,
    dimensions: z.array(dimensionInputSchema).length(4),
    informationValue: rniUnitDecimal,
    evidenceQuality: rniUnitDecimal,
    assertionStrength: rniUnitDecimal,
    sarcasmProbability: rniUnitDecimal,
    spamProbability: rniUnitDecimal,
    memeProbability: rniUnitDecimal,
    sourceWeight: rniUnitDecimal,
    communityWeight: rniUnitDecimal,
    publishedAt: rniIsoTimestamp.nullable(),
    observedAt: rniIsoTimestamp,
    exclusionReason: z.enum(['off_topic', 'spam', 'unresolved_context']).nullable(),
  })
  .strict()
  .superRefine((observation, context) => {
    const dimensions = observation.dimensions.map((assignment) => assignment.dimension);
    if (
      new Set(dimensions).size !== rniDimensionKey.options.length ||
      !rniDimensionKey.options.every((dimension) => dimensions.includes(dimension))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dimensions'],
        message: 'An analytics observation requires each frozen dimension exactly once',
      });
    }
    if (new Set(observation.mentionIds).size !== observation.mentionIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mentionIds'],
        message: 'An analytics observation cannot repeat a mention identity',
      });
    }
  });

const windowSchema = z
  .object({
    windowStart: rniIsoTimestamp,
    windowEnd: rniIsoTimestamp,
    durationDays: positiveDecimal,
    observations: z.array(observationSchema),
  })
  .strict()
  .superRefine((window, context) => {
    if (Date.parse(window.windowEnd) <= Date.parse(window.windowStart)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['windowEnd'],
        message: 'An analytics window must end after it starts',
      });
    }
    const actualDurationDays = new D(String(Date.parse(window.windowEnd)))
      .minus(String(Date.parse(window.windowStart)))
      .div('86400000');
    if (!actualDurationDays.equals(window.durationDays)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['durationDays'],
        message: 'Analytics durationDays must equal the exact timestamp interval',
      });
    }
    const sourceIds = window.observations.map((observation) => observation.sourceItemId);
    if (new Set(sourceIds).size !== sourceIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['observations'],
        message: 'A platform/security window cannot count one source observation twice',
      });
    }
    const mentionIds = window.observations.flatMap((observation) => observation.mentionIds);
    if (new Set(mentionIds).size !== mentionIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['observations'],
        message: 'A persisted security mention cannot belong to two source observations',
      });
    }
  });

const baselineSchema = z
  .object({
    platform: rniPlatform,
    securityId: z.string().uuid(),
    durationDays: positiveDecimal,
    methodologyVersion: z.string().min(1),
    windowEnd: rniIsoTimestamp,
    effectiveAttention: nonnegativeDecimal,
    inputSetHash: rniSha256,
  })
  .strict();

const confidenceComponentsSchema = z
  .object(
    Object.fromEntries(RNI_CONFIDENCE_COMPONENT_KEYS.map((key) => [key, rniUnitDecimal])) as Record<
      RniConfidenceComponentKey,
      typeof rniUnitDecimal
    >,
  )
  .strict();

const confidencePenaltiesSchema = z
  .object(
    Object.fromEntries(RNI_CONFIDENCE_PENALTY_KEYS.map((key) => [key, rniUnitDecimal])) as Record<
      RniConfidencePenaltyKey,
      typeof rniUnitDecimal
    >,
  )
  .strict();

const methodologySchema = z
  .object({
    version: z.string().min(1),
    codeVersion: z.literal(RNI_ANALYTICS_CODE_VERSION),
    timestampBasis: z.literal('published_at_else_observed_at'),
    memePenalty: rniUnitDecimal,
    halfLifeHours: positiveDecimal,
    lowBaseThreshold: positiveDecimal,
    epsilon: positiveDecimal,
    minimumEffectiveAttention: positiveDecimal,
    minimumIndependentSources: positiveIntegerDecimal,
    winsorLowerPercentile: rniUnitDecimal,
    winsorUpperPercentile: rniUnitDecimal,
    minimumBaselineWindows: positiveIntegerDecimal,
    zScoreDecimalPlaces: z.literal('6'),
    highNarrativeConcentrationThreshold: rniUnitDecimal,
    staleAfterHours: positiveDecimal,
    confidenceWeights: confidenceComponentsSchema,
    confidenceBands: z
      .object({
        mediumMinimum: scoreDecimal,
        highMinimum: scoreDecimal,
        veryHighMinimum: scoreDecimal,
      })
      .strict(),
    confidenceCaps: z
      .object({
        singleSourceOrCommunity: scoreDecimal,
        highNarrativeConcentration: scoreDecimal,
        partialCoverage: scoreDecimal,
        staleEvidence: scoreDecimal,
      })
      .strict(),
  })
  .strict()
  .superRefine((methodology, context) => {
    const weightSum = RNI_CONFIDENCE_COMPONENT_KEYS.reduce(
      (sum, key) => sum.plus(methodology.confidenceWeights[key]),
      new D('0'),
    );
    if (!weightSum.equals(ONE)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confidenceWeights'],
        message: 'Confidence component weights must sum exactly to 1',
      });
    }
    if (
      new D(methodology.winsorLowerPercentile).greaterThanOrEqualTo(
        methodology.winsorUpperPercentile,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['winsorUpperPercentile'],
        message: 'The upper winsor percentile must exceed the lower percentile',
      });
    }
    if (new D(methodology.epsilon).greaterThan(methodology.lowBaseThreshold)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['epsilon'],
        message: 'Epsilon cannot exceed the positive low-base suppression threshold',
      });
    }
    const medium = new D(methodology.confidenceBands.mediumMinimum);
    const high = new D(methodology.confidenceBands.highMinimum);
    const veryHigh = new D(methodology.confidenceBands.veryHighMinimum);
    if (
      medium.isNegative() ||
      !medium.lessThan(high) ||
      !high.lessThan(veryHigh) ||
      veryHigh.greaterThan(HUNDRED)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confidenceBands'],
        message: 'Confidence band boundaries must be ordered inside 0..100',
      });
    }
    if (new D(methodology.minimumBaselineWindows).lessThan('2')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['minimumBaselineWindows'],
        message: 'Sample standard deviation requires at least two baseline windows',
      });
    }
  });

const inputSchema = z
  .object({
    runId: z.string().uuid(),
    runSourceSliceId: z.string().uuid(),
    platform: rniPlatform,
    securityId: z.string().uuid(),
    sliceStatus: z.enum(['complete', 'partial', 'failed', 'unavailable']),
    current: windowSchema,
    comparison: windowSchema.nullable(),
    baseline: z.array(baselineSchema),
    confidenceComponents: confidenceComponentsSchema,
    confidencePenalties: confidencePenaltiesSchema,
    confidenceReadiness: z
      .object({
        narrativeStageTerminal: z.boolean(),
        catalystStageTerminal: z.boolean(),
      })
      .strict(),
  })
  .strict();

function clampUnit(value: Dec): Dec {
  if (value.lessThan(ZERO)) return ZERO;
  if (value.greaterThan(ONE)) return ONE;
  return value;
}

function sum(values: readonly Dec[]): Dec {
  return values.reduce((total, value) => total.plus(value), new D('0'));
}

function distinctCount(values: readonly string[]): string {
  return String(new Set(values).size);
}

function normalizeObservation(
  observation: RniAnalyticsObservationInput,
): RniAnalyticsObservationInput {
  return {
    ...observation,
    mentionIds: [...observation.mentionIds].sort(),
    dimensions: rniDimensionKey.options.map((dimension) => {
      const assignment = observation.dimensions.find(
        (candidate) => candidate.dimension === dimension,
      );
      if (assignment === undefined) throw new Error(`Missing analytics dimension ${dimension}`);
      return assignment;
    }),
  };
}

function normalizeWindow(window: RniAnalyticsWindowInput): RniAnalyticsWindowInput {
  return {
    ...window,
    observations: [...window.observations]
      .map(normalizeObservation)
      .sort((left, right) => left.sourceItemId.localeCompare(right.sourceItemId)),
  };
}

function normalizeInput(input: RniPlatformAnalyticsInput): RniPlatformAnalyticsInput {
  return {
    ...input,
    current: normalizeWindow(input.current),
    comparison: input.comparison === null ? null : normalizeWindow(input.comparison),
    baseline: [...input.baseline].sort(
      (left, right) =>
        left.windowEnd.localeCompare(right.windowEnd) ||
        left.inputSetHash.localeCompare(right.inputSetHash),
    ),
  };
}

function validateScope(
  input: RniPlatformAnalyticsInput,
  methodology: RniAnalyticsMethodology,
): void {
  if (input.sliceStatus === 'failed' || input.sliceStatus === 'unavailable') {
    const hasNonzeroConfidenceInput = [
      ...Object.values(input.confidenceComponents),
      ...Object.values(input.confidencePenalties),
    ].some((value) => !new D(value).equals(ZERO));
    if (
      input.current.observations.length !== 0 ||
      input.comparison !== null ||
      input.baseline.length !== 0 ||
      hasNonzeroConfidenceInput ||
      !input.confidenceReadiness.narrativeStageTerminal ||
      !input.confidenceReadiness.catalystStageTerminal
    ) {
      throw new Error(
        'RNI failed or unavailable analytics requires canonical terminal zero-evidence input',
      );
    }
  }
  const windows = input.comparison === null ? [input.current] : [input.current, input.comparison];
  if (
    input.comparison !== null &&
    Date.parse(input.comparison.windowEnd) > Date.parse(input.current.windowStart)
  ) {
    throw new Error('RNI analytics comparison window cannot overlap the current window');
  }
  if (input.comparison !== null) {
    const currentSourceIds = new Set(
      input.current.observations.map((observation) => observation.sourceItemId),
    );
    if (
      input.comparison.observations.some((observation) =>
        currentSourceIds.has(observation.sourceItemId),
      )
    ) {
      throw new Error('RNI analytics refuses a source assigned to both disjoint windows');
    }
  }
  for (const window of windows) {
    for (const observation of window.observations) {
      if (observation.platform !== input.platform || observation.securityId !== input.securityId) {
        throw new Error('RNI analytics refuses cross-platform or cross-security observations');
      }
      if (observation.exclusionReason !== null) {
        throw new Error('RNI analytics refuses explicitly excluded semantic evidence');
      }
      const eligibleAt = observation.publishedAt ?? observation.observedAt;
      if (
        Date.parse(eligibleAt) < Date.parse(window.windowStart) ||
        Date.parse(eligibleAt) >= Date.parse(window.windowEnd)
      ) {
        throw new Error('RNI analytics refuses an observation outside its half-open window');
      }
    }
    const duplicateGroups = new Map<string, { readonly size: Dec; count: Dec }>();
    for (const observation of window.observations) {
      const declaredSize = new D(observation.duplicateGroupSize);
      const existing = duplicateGroups.get(observation.duplicateGroupKey);
      if (existing !== undefined && !existing.size.equals(declaredSize)) {
        throw new Error('RNI analytics duplicate-group members disagree on group size');
      }
      duplicateGroups.set(observation.duplicateGroupKey, {
        size: existing?.size ?? declaredSize,
        count: (existing?.count ?? new D('0')).plus(ONE),
      });
    }
    for (const group of duplicateGroups.values()) {
      if (group.size.lessThan(group.count)) {
        throw new Error('RNI analytics duplicate-group size is smaller than its window members');
      }
    }
  }
  for (const baseline of input.baseline) {
    if (
      baseline.platform !== input.platform ||
      baseline.securityId !== input.securityId ||
      !new D(baseline.durationDays).equals(input.current.durationDays) ||
      baseline.methodologyVersion !== methodology.version
    ) {
      throw new Error('RNI analytics refuses a non-comparable baseline window');
    }
    if (Date.parse(baseline.windowEnd) > Date.parse(input.current.windowStart)) {
      throw new Error('RNI analytics baseline windows must be strictly historical');
    }
  }
  const baselineEnds = input.baseline.map((window) => window.windowEnd);
  if (new Set(baselineEnds).size !== baselineEnds.length) {
    throw new Error('RNI analytics refuses duplicate baseline windows');
  }
  const baselineHashes = input.baseline.map((window) => window.inputSetHash);
  if (new Set(baselineHashes).size !== baselineHashes.length) {
    throw new Error('RNI analytics refuses duplicate baseline artifacts');
  }
  let previousBaseline: RniAnalyticsBaselineWindowInput | undefined;
  for (const baseline of input.baseline) {
    if (previousBaseline !== undefined) {
      const gapDays = new D(String(Date.parse(baseline.windowEnd)))
        .minus(String(Date.parse(previousBaseline.windowEnd)))
        .div('86400000');
      if (!gapDays.equals(input.current.durationDays)) {
        throw new Error('RNI analytics requires a gap-free comparable baseline series');
      }
    }
    previousBaseline = baseline;
  }
}

function ageHours(observation: RniAnalyticsObservationInput, window: RniAnalyticsWindowInput): Dec {
  const eligibleAt = observation.publishedAt ?? observation.observedAt;
  return new D(String(Date.parse(window.windowEnd)))
    .minus(String(Date.parse(eligibleAt)))
    .div('3600000');
}

function observationWeight(
  observation: RniAnalyticsObservationInput,
  window: RniAnalyticsWindowInput,
  methodology: RniAnalyticsMethodology,
): RniWeightedObservationTrace {
  const baseQuality = new D(observation.informationValue)
    .times(observation.evidenceQuality)
    .times(observation.assertionStrength);
  const noise = ONE.minus(observation.sarcasmProbability)
    .times(ONE.minus(observation.spamProbability))
    .times(ONE.minus(new D(methodology.memePenalty).times(observation.memeProbability)));
  const independence = ONE.div(new D(observation.duplicateGroupSize).sqrt());
  const freshness = new D('2')
    .ln()
    .negated()
    .times(ageHours(observation, window))
    .div(methodology.halfLifeHours)
    .exp();
  const weight = clampUnit(
    baseQuality
      .times(noise)
      .times(independence)
      .times(observation.sourceWeight)
      .times(observation.communityWeight)
      .times(freshness),
  );
  return {
    sourceItemId: observation.sourceItemId,
    weight: exact(weight),
    baseQuality: exact(baseQuality),
    noise: exact(noise),
    independence: exact(independence),
    freshness: exact(freshness),
  };
}

function weightedWindow(
  window: RniAnalyticsWindowInput,
  methodology: RniAnalyticsMethodology,
): { readonly traces: readonly RniWeightedObservationTrace[]; readonly attention: Dec } {
  const traces = window.observations.map((observation) =>
    observationWeight(observation, window, methodology),
  );
  return { traces, attention: sum(traces.map((trace) => new D(trace.weight))) };
}

function sentimentByDimension(
  observations: readonly RniAnalyticsObservationInput[],
  traces: readonly RniWeightedObservationTrace[],
  methodology: RniAnalyticsMethodology,
): readonly RniSentimentMetric[] {
  const traceBySource = new Map(traces.map((trace) => [trace.sourceItemId, trace]));
  return rniDimensionKey.options.map((dimension) => {
    const eligible = observations.flatMap((observation) => {
      const assignment = observation.dimensions.find(
        (candidate) => candidate.dimension === dimension,
      );
      const trace = traceBySource.get(observation.sourceItemId);
      if (
        assignment?.score === null ||
        assignment === undefined ||
        trace === undefined ||
        new D(trace.weight).lessThanOrEqualTo(ZERO)
      ) {
        return [];
      }
      return [{ observation, score: new D(assignment.score), weight: new D(trace.weight) }];
    });
    const effectiveAttention = sum(eligible.map((item) => item.weight));
    const independentSourceCount = new Set(
      eligible.map((item) => item.observation.duplicateGroupKey),
    ).size;
    const sourceItemIds = [
      ...new Set(eligible.map((item) => item.observation.sourceItemId)),
    ].sort();
    const enoughAttention = effectiveAttention.greaterThanOrEqualTo(
      methodology.minimumEffectiveAttention,
    );
    const enoughSources = new D(String(independentSourceCount)).greaterThanOrEqualTo(
      methodology.minimumIndependentSources,
    );
    if (!enoughAttention || !enoughSources || effectiveAttention.equals(ZERO)) {
      return {
        dimension,
        sentimentIndex: null,
        meanDirection: null,
        effectiveAttention: exact(effectiveAttention),
        independentSourceCount: String(independentSourceCount),
        sourceItemIds,
        status: 'insufficient_evidence',
      };
    }
    const meanDirection = sum(eligible.map((item) => item.weight.times(item.score))).div(
      effectiveAttention,
    );
    return {
      dimension,
      sentimentIndex: meanDirection
        .times(HUNDRED)
        .toDecimalPlaces(SENTIMENT_DECIMAL_PLACES, D.ROUND_HALF_EVEN)
        .toFixed(SENTIMENT_DECIMAL_PLACES),
      meanDirection: exact(meanDirection),
      effectiveAttention: exact(effectiveAttention),
      independentSourceCount: String(independentSourceCount),
      sourceItemIds,
      status: 'available',
    };
  });
}

function nearestRank(sorted: readonly Dec[], percentile: Dec): Dec {
  // Methodology v1 pins winsor cutoffs to the deterministic nearest-rank convention.
  if (percentile.equals(ZERO)) return sorted.at(0) as Dec;
  const rank = percentile.times(String(sorted.length)).ceil();
  return (
    sorted.find((_value, index) => new D(String(index)).plus(ONE).greaterThanOrEqualTo(rank)) ??
    (sorted.at(-1) as Dec)
  );
}

function sampleStandardDeviation(values: readonly Dec[]): Dec {
  const first = values.at(0) as Dec;
  if (values.every((value) => value.equals(first))) return new D('0');
  const mean = sum(values).div(String(values.length));
  const squaredDeviations = values.map((value) => value.minus(mean).pow('2'));
  return sum(squaredDeviations)
    .div(new D(String(values.length)).minus(ONE))
    .sqrt();
}

function zScore(
  currentAttention: Dec,
  baseline: readonly RniAnalyticsBaselineWindowInput[],
  methodology: RniAnalyticsMethodology,
): RniZScoreMetric {
  const baselineWindowCount = String(baseline.length);
  if (new D(baselineWindowCount).lessThan(methodology.minimumBaselineWindows)) {
    return {
      value: null,
      status: 'insufficient_baseline',
      baselineWindowCount,
      winsorizedLowerValue: null,
      winsorizedUpperValue: null,
    };
  }
  const logged = baseline
    .map((window) => new D(window.effectiveAttention).plus(ONE).ln())
    .sort((left, right) => left.comparedTo(right));
  const lower = nearestRank(logged, new D(methodology.winsorLowerPercentile));
  const upper = nearestRank(logged, new D(methodology.winsorUpperPercentile));
  const winsorized = logged.map((value) =>
    value.lessThan(lower) ? lower : value.greaterThan(upper) ? upper : value,
  );
  const standardDeviation = sampleStandardDeviation(winsorized);
  if (standardDeviation.equals(ZERO)) {
    return {
      value: null,
      status: 'zero_variance',
      baselineWindowCount,
      winsorizedLowerValue: exact(lower),
      winsorizedUpperValue: exact(upper),
    };
  }
  const mean = sum(winsorized).div(String(winsorized.length));
  return {
    value: exact(
      currentAttention
        .plus(ONE)
        .ln()
        .minus(mean)
        .div(standardDeviation)
        .toDecimalPlaces(Z_SCORE_DECIMAL_PLACES, D.ROUND_HALF_EVEN),
    ),
    status: 'available',
    baselineWindowCount,
    winsorizedLowerValue: exact(lower),
    winsorizedUpperValue: exact(upper),
  };
}

function narrativeMetrics(
  observations: readonly RniAnalyticsObservationInput[],
  traces: readonly RniWeightedObservationTrace[],
): { readonly breadth: string; readonly hhi: string } {
  const traceBySource = new Map(traces.map((trace) => [trace.sourceItemId, trace]));
  const independentNarratives = new Set(
    observations.flatMap((observation) =>
      observation.independentNarrative && observation.narrativeId !== null
        ? [observation.narrativeId]
        : [],
    ),
  );
  const buckets = new Map<string, Dec>();
  for (const observation of observations) {
    const bucket = observation.narrativeId ?? `unclustered:${observation.sourceItemId}`;
    const weight = new D(traceBySource.get(observation.sourceItemId)?.weight ?? '0');
    buckets.set(bucket, (buckets.get(bucket) ?? new D('0')).plus(weight));
  }
  const total = sum([...buckets.values()]);
  const hhi = total.equals(ZERO)
    ? ZERO
    : sum([...buckets.values()].map((weight) => weight.div(total).pow('2')));
  return { breadth: String(independentNarratives.size), hhi: exact(hhi) };
}

function confidenceBand(score: Dec, methodology: RniAnalyticsMethodology): RniConfidenceBand {
  if (score.greaterThanOrEqualTo(methodology.confidenceBands.veryHighMinimum)) return 'VERY_HIGH';
  if (score.greaterThanOrEqualTo(methodology.confidenceBands.highMinimum)) return 'HIGH';
  if (score.greaterThanOrEqualTo(methodology.confidenceBands.mediumMinimum)) return 'MEDIUM';
  return 'LOW';
}

function buildConfidence(input: {
  readonly snapshot: RniPlatformAnalyticsInput;
  readonly methodology: RniAnalyticsMethodology;
  readonly independentSourceBreadth: string;
  readonly communityBreadth: string;
  readonly narrativeHhi: string;
  readonly maxAgeHours: Dec;
}): NonNullable<RniPlatformAnalyticsResult['confidence']> {
  const weightedComponents = Object.fromEntries(
    RNI_CONFIDENCE_COMPONENT_KEYS.map((key) => [
      key,
      exact(
        new D(input.snapshot.confidenceComponents[key]).times(
          input.methodology.confidenceWeights[key],
        ),
      ),
    ]),
  ) as Record<RniConfidenceComponentKey, string>;
  const base = sum(RNI_CONFIDENCE_COMPONENT_KEYS.map((key) => new D(weightedComponents[key])));
  const totalPenalty = sum(
    RNI_CONFIDENCE_PENALTY_KEYS.map((key) => new D(input.snapshot.confidencePenalties[key])),
  );
  const uncappedUnit = clampUnit(base.minus(totalPenalty));
  const uncappedScore = uncappedUnit
    .times(HUNDRED)
    .toDecimalPlaces(CONFIDENCE_DECIMAL_PLACES, D.ROUND_HALF_EVEN);
  const caps: Array<RniConfidenceResult['appliedCaps'][number]> = [];
  if (
    new D(input.independentSourceBreadth).lessThanOrEqualTo(ONE) ||
    new D(input.communityBreadth).lessThanOrEqualTo(ONE)
  ) {
    caps.push({
      reason: 'single_source_or_community',
      cap: input.methodology.confidenceCaps.singleSourceOrCommunity,
    });
  }
  if (
    new D(input.narrativeHhi).greaterThanOrEqualTo(
      input.methodology.highNarrativeConcentrationThreshold,
    )
  ) {
    caps.push({
      reason: 'high_narrative_concentration',
      cap: input.methodology.confidenceCaps.highNarrativeConcentration,
    });
  }
  if (input.snapshot.sliceStatus === 'partial') {
    caps.push({
      reason: 'partial_coverage',
      cap: input.methodology.confidenceCaps.partialCoverage,
    });
  }
  if (input.maxAgeHours.greaterThanOrEqualTo(input.methodology.staleAfterHours)) {
    caps.push({ reason: 'stale_evidence', cap: input.methodology.confidenceCaps.staleEvidence });
  }
  const cappedScore = caps.reduce(
    (score, candidate) => (new D(candidate.cap).lessThan(score) ? new D(candidate.cap) : score),
    uncappedScore,
  );
  const roundedScore = cappedScore.toDecimalPlaces(CONFIDENCE_DECIMAL_PLACES, D.ROUND_HALF_EVEN);
  const score100 = roundedScore.toFixed(CONFIDENCE_DECIMAL_PLACES);
  return {
    unitScore: exact(roundedScore.div(HUNDRED)),
    score100,
    uncappedScore100: uncappedScore.toFixed(CONFIDENCE_DECIMAL_PLACES),
    band: confidenceBand(roundedScore, input.methodology),
    weightedComponents,
    totalPenalty: exact(totalPenalty),
    appliedCaps: caps.sort((left, right) => left.reason.localeCompare(right.reason)),
    meaning: 'evidence_defensibility_not_price_probability',
  };
}

function computeResult(
  input: RniPlatformAnalyticsInput,
  methodology: RniAnalyticsMethodology,
): RniPlatformAnalyticsResult {
  const current = weightedWindow(input.current, methodology);
  const comparison =
    input.comparison === null ? null : weightedWindow(input.comparison, methodology);
  const currentAttention = new D(
    distinctCount(input.current.observations.map((observation) => observation.sourceItemId)),
  );
  const comparisonAttention =
    input.comparison === null
      ? null
      : new D(
          distinctCount(
            input.comparison.observations.map((observation) => observation.sourceItemId),
          ),
        );
  const currentRate = currentAttention.div(input.current.durationDays);
  const comparisonRate =
    comparisonAttention === null || input.comparison === null
      ? null
      : comparisonAttention.div(input.comparison.durationDays);
  let changeStatus: RniPlatformAnalyticsResult['changeStatus'] = 'missing_comparison';
  let absoluteAttentionChange: string | null = null;
  let percentAttentionChange: string | null = null;
  let velocity: string | null = null;
  let acceleration: string | null = null;
  if (comparison !== null && comparisonRate !== null) {
    const absolute = currentAttention.minus(comparisonAttention as Dec);
    absoluteAttentionChange = exact(absolute);
    acceleration = exact(currentRate.minus(comparisonRate));
    if ((comparisonAttention as Dec).lessThan(methodology.lowBaseThreshold)) {
      changeStatus = 'emerging_from_low_base';
    } else {
      changeStatus = 'available';
      percentAttentionChange = exact(absolute.div(comparisonAttention as Dec));
    }
    velocity = comparisonRate.equals(ZERO)
      ? null
      : exact(currentRate.minus(comparisonRate).div(comparisonRate));
  }

  const mentionIds = input.current.observations.flatMap((observation) => observation.mentionIds);
  const currentTraceBySource = new Map(current.traces.map((trace) => [trace.sourceItemId, trace]));
  const contributingObservations = input.current.observations.filter((observation) =>
    new D(currentTraceBySource.get(observation.sourceItemId)?.weight ?? '0').greaterThan(ZERO),
  );
  const independentSourceBreadth = distinctCount(
    contributingObservations.map((observation) => observation.duplicateGroupKey),
  );
  const communityBreadth = distinctCount(
    contributingObservations.map((observation) => observation.communityOrScope),
  );
  const clusterBreadth = distinctCount(
    contributingObservations.map((observation) => observation.analyticalCluster),
  );
  const authorBreadth = distinctCount(
    contributingObservations.flatMap((observation) =>
      observation.authorHash === null ? [] : [observation.authorHash],
    ),
  );
  const narratives = narrativeMetrics(contributingObservations, current.traces);
  const ages = contributingObservations.map((observation) => ageHours(observation, input.current));
  const maxAgeHours = ages.reduce(
    (oldest, age) => (age.greaterThan(oldest) ? age : oldest),
    new D('0'),
  );

  let confidenceStatus: RniPlatformAnalyticsResult['confidenceStatus'] = 'available';
  if (!input.confidenceReadiness.narrativeStageTerminal) {
    confidenceStatus = 'awaiting_narrative_stage';
  } else if (!input.confidenceReadiness.catalystStageTerminal) {
    confidenceStatus = 'awaiting_catalyst_stage';
  } else if (
    current.attention.equals(ZERO) ||
    current.attention.lessThan(methodology.minimumEffectiveAttention) ||
    new D(independentSourceBreadth).lessThan(methodology.minimumIndependentSources)
  ) {
    confidenceStatus = 'insufficient_evidence';
  }
  const confidence =
    confidenceStatus === 'available'
      ? buildConfidence({
          snapshot: input,
          methodology,
          independentSourceBreadth,
          communityBreadth,
          narrativeHhi: narratives.hhi,
          maxAgeHours,
        })
      : null;

  return {
    platform: input.platform,
    securityId: input.securityId,
    rawMentions: distinctCount(mentionIds),
    attention: exact(currentAttention),
    effectiveAttention: exact(current.attention),
    comparisonAttention: comparisonAttention === null ? null : exact(comparisonAttention),
    comparisonEffectiveAttention: comparison === null ? null : exact(comparison.attention),
    absoluteAttentionChange,
    percentAttentionChange,
    currentAttentionRate: exact(currentRate),
    comparisonAttentionRate: comparisonRate === null ? null : exact(comparisonRate),
    velocity,
    acceleration,
    changeStatus,
    sentimentByDimension: sentimentByDimension(
      input.current.observations,
      current.traces,
      methodology,
    ),
    authorBreadth,
    communityBreadth,
    clusterAdjustedCommunityBreadth: clusterBreadth,
    narrativeBreadth: narratives.breadth,
    narrativeHhi: narratives.hhi,
    independentSourceBreadth,
    zScore: zScore(current.attention, input.baseline, methodology),
    confidence,
    confidenceStatus,
    weightTrace: current.traces,
  };
}

export function calculatePlatformAnalytics(
  rawInput: RniPlatformAnalyticsInput,
  rawMethodology: RniAnalyticsMethodology,
): RniPlatformAnalyticsArtifact {
  const methodology = methodologySchema.parse(rawMethodology);
  const input = normalizeInput(inputSchema.parse(rawInput));
  validateScope(input, methodology);
  const inputSetHash = canonicalHash({ input, methodology });
  const result = computeResult(input, methodology);
  return {
    runId: input.runId,
    runSourceSliceId: input.runSourceSliceId,
    methodologyVersion: methodology.version,
    calculationCodeVersion: methodology.codeVersion,
    inputSetHash,
    resultHash: canonicalHash(result),
    inputSnapshot: input,
    methodologySnapshot: methodology,
    result,
  };
}

export function replayPlatformAnalytics(
  artifact: RniPlatformAnalyticsArtifact,
): RniPlatformAnalyticsArtifact {
  if (
    artifact.runId !== artifact.inputSnapshot.runId ||
    artifact.runSourceSliceId !== artifact.inputSnapshot.runSourceSliceId ||
    artifact.methodologyVersion !== artifact.methodologySnapshot.version ||
    artifact.calculationCodeVersion !== artifact.methodologySnapshot.codeVersion
  ) {
    throw new Error('RNI analytics replay artifact lineage mismatch');
  }
  const replayed = calculatePlatformAnalytics(artifact.inputSnapshot, artifact.methodologySnapshot);
  if (artifact.inputSetHash !== replayed.inputSetHash) {
    throw new Error('RNI analytics replay input hash mismatch');
  }
  if (
    artifact.resultHash !== replayed.resultHash ||
    canonicalHash(artifact.result) !== replayed.resultHash
  ) {
    throw new Error('RNI analytics replay result mismatch');
  }
  return replayed;
}
