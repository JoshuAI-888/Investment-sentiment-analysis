import { z } from 'zod';

import { canonicalHash } from '../../calc/canonical';
import { D, exact, isDecimalString } from '../../calc/decimal';
import {
  rniDimensionKey,
  rniIsoTimestamp,
  rniPlatform,
  rniSha256,
  rniSignedDecimal,
  rniSliceStatus,
  rniStance,
} from '../contracts';
import {
  RNI_CONVERGENCE_CODE_VERSION,
  type RniConvergenceArtifact,
  type RniConvergenceDimensionInput,
  type RniConvergencePlatformInput,
  type RniConvergencePolicy,
  type RniConvergenceRequest,
  type RniConvergenceResult,
  type RniDimensionAgreementFact,
  type RniDirectionAgreement,
  type RniDirectionGroup,
} from './types';

const ZERO = new D('0');
const ONE = new D('1');
const PLATFORM_ORDER = ['reddit', 'x'] as const;

const nonnegativeDecimal = z
  .string()
  .refine(
    (value) =>
      isDecimalString(value) &&
      new D(value).isFinite() &&
      new D(value).greaterThanOrEqualTo(ZERO),
  );
const positiveDecimal = nonnegativeDecimal.refine((value) => new D(value).greaterThan(ZERO));

function scoreContradictsStance(stance: RniConvergenceDimensionInput['stance'], score: string): boolean {
  const value = new D(score);
  if (stance === 'bullish' || stance === 'strong_bullish') return !value.greaterThan(ZERO);
  if (stance === 'bearish' || stance === 'strong_bearish') return !value.lessThan(ZERO);
  return false;
}

const dimensionSchema = z
  .object({
    dimension: rniDimensionKey,
    stance: rniStance,
    score: rniSignedDecimal.nullable(),
  })
  .strict()
  .superRefine((dimension, context) => {
    if ((dimension.stance === 'insufficient') !== (dimension.score === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['score'],
        message: 'An insufficient dimension alone has a null score',
      });
    }
    if (dimension.score !== null && scoreContradictsStance(dimension.stance, dimension.score)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['score'],
        message: 'A directional dimension stance must agree with the score sign',
      });
    }
  });

const platformSchema = z
  .object({
    platform: rniPlatform,
    runId: z.string().uuid(),
    runSourceSliceId: z.string().uuid(),
    securityId: z.string().uuid(),
    methodologyVersion: z.string().min(1),
    windowStart: rniIsoTimestamp,
    windowEnd: rniIsoTimestamp,
    status: rniSliceStatus,
    stance: rniStance,
    stanceScore: rniSignedDecimal.nullable(),
    dimensions: z.array(dimensionSchema).length(4),
    effectiveAttention: nonnegativeDecimal,
    dataThroughAt: rniIsoTimestamp.nullable(),
    analyticsArtifactHash: rniSha256,
  })
  .strict()
  .superRefine((platform, context) => {
    if (Date.parse(platform.windowEnd) <= Date.parse(platform.windowStart)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['windowEnd'],
        message: 'A convergence window must end after it starts',
      });
    }
    const dimensions = platform.dimensions.map((dimension) => dimension.dimension);
    if (
      new Set(dimensions).size !== rniDimensionKey.options.length ||
      !rniDimensionKey.options.every((dimension) => dimensions.includes(dimension))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dimensions'],
        message: 'A convergence platform requires all four frozen dimensions exactly once',
      });
    }
    if ((platform.stance === 'insufficient') !== (platform.stanceScore === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stanceScore'],
        message: 'An insufficient platform alone has a null stance score',
      });
    }
    if (
      platform.stanceScore !== null &&
      scoreContradictsStance(platform.stance, platform.stanceScore)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stanceScore'],
        message: 'A directional platform stance must agree with the score sign',
      });
    }
    if (
      new D(platform.effectiveAttention).equals(ZERO) &&
      (platform.stance !== 'insufficient' ||
        platform.dimensions.some((dimension) => dimension.stance !== 'insufficient'))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['effectiveAttention'],
        message: 'Publishable sentiment requires positive effective attention',
      });
    }
    if (
      ['pending', 'running', 'failed', 'unavailable'].includes(platform.status) &&
      (platform.stance !== 'insufficient' ||
        platform.dimensions.some((dimension) => dimension.stance !== 'insufficient'))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stance'],
        message: 'A non-publishable platform state cannot carry a publishable stance',
      });
    }
  });

const policySchema = z
  .object({
    version: z.string().min(1),
    codeVersion: z.literal(RNI_CONVERGENCE_CODE_VERSION),
    dimensionDivergenceMinimum: rniSignedDecimal.refine((value) => new D(value).greaterThan(ZERO)),
    scaleImbalanceRatioThreshold: positiveDecimal.refine((value) => new D(value).greaterThan(ONE)),
    staleAfterHours: positiveDecimal,
  })
  .strict();

const requestSchema = z
  .object({
    asOf: rniIsoTimestamp,
    reddit: platformSchema,
    x: platformSchema,
    policy: policySchema,
  })
  .strict();

function normalizeDimensions(
  dimensions: readonly RniConvergenceDimensionInput[],
): readonly RniConvergenceDimensionInput[] {
  return rniDimensionKey.options.map((dimension) => {
    const match = dimensions.find((candidate) => candidate.dimension === dimension);
    if (match === undefined) throw new Error(`Missing convergence dimension ${dimension}`);
    return match;
  });
}

function normalizePlatform(platform: RniConvergencePlatformInput): RniConvergencePlatformInput {
  return { ...platform, dimensions: normalizeDimensions(platform.dimensions) };
}

function normalizeRequest(request: RniConvergenceRequest): RniConvergenceRequest {
  return {
    ...request,
    reddit: normalizePlatform(request.reddit),
    x: normalizePlatform(request.x),
  };
}

function validatePair(request: RniConvergenceRequest): void {
  if (request.reddit.platform !== 'reddit' || request.x.platform !== 'x') {
    throw new Error('RNI convergence requires one explicitly labelled Reddit and X slice');
  }
  const same = (
    left: keyof Pick<
      RniConvergencePlatformInput,
      'runId' | 'securityId' | 'methodologyVersion' | 'windowStart' | 'windowEnd'
    >,
  ): boolean => request.reddit[left] === request.x[left];
  if (
    !same('runId') ||
    !same('securityId') ||
    !same('methodologyVersion') ||
    !same('windowStart') ||
    !same('windowEnd')
  ) {
    throw new Error('RNI convergence refuses non-comparable platform slices');
  }
  if (request.reddit.runSourceSliceId === request.x.runSourceSliceId) {
    throw new Error('RNI convergence requires distinct platform slice identities');
  }
  if (Date.parse(request.asOf) < Date.parse(request.reddit.windowEnd)) {
    throw new Error('RNI convergence asOf cannot precede the analysis window end');
  }
  for (const platform of [request.reddit, request.x]) {
    if (
      platform.dataThroughAt !== null &&
      Date.parse(platform.dataThroughAt) > Date.parse(request.asOf)
    ) {
      throw new Error('RNI convergence data-through time cannot be in the future');
    }
  }
}

function directionGroup(stance: RniConvergencePlatformInput['stance']): RniDirectionGroup {
  if (stance === 'strong_bullish' || stance === 'bullish') return 'bullish';
  if (stance === 'strong_bearish' || stance === 'bearish') return 'bearish';
  if (stance === 'neutral') return 'neutral';
  return 'insufficient';
}

function compareDirections(input: {
  readonly redditStance: RniConvergenceDimensionInput['stance'];
  readonly xStance: RniConvergenceDimensionInput['stance'];
  readonly redditScore: string | null;
  readonly xScore: string | null;
  readonly divergenceMinimum: string;
}): { readonly agreement: RniDirectionAgreement; readonly delta: string | null } {
  if (input.redditScore === null || input.xScore === null) {
    return { agreement: 'insufficient', delta: null };
  }
  const redditDirection = directionGroup(input.redditStance);
  const xDirection = directionGroup(input.xStance);
  const delta = new D(input.redditScore).minus(input.xScore);
  if (redditDirection === xDirection) {
    return {
      agreement: delta.abs().greaterThanOrEqualTo(input.divergenceMinimum) ? 'mixed' : 'aligned',
      delta: exact(delta),
    };
  }
  if (
    (redditDirection === 'bullish' && xDirection === 'bearish') ||
    (redditDirection === 'bearish' && xDirection === 'bullish')
  ) {
    return { agreement: 'divergent', delta: exact(delta) };
  }
  return {
    agreement: delta.abs().greaterThanOrEqualTo(input.divergenceMinimum) ? 'divergent' : 'mixed',
    delta: exact(delta),
  };
}

function freshness(
  platform: RniConvergencePlatformInput,
  asOf: string,
  policy: RniConvergencePolicy,
): 'fresh' | 'stale' | 'unknown' {
  if (platform.dataThroughAt === null) return 'unknown';
  const ageHours = new D(String(Date.parse(asOf)))
    .minus(String(Date.parse(platform.dataThroughAt)))
    .div('3600000');
  return ageHours.greaterThan(policy.staleAfterHours) ? 'stale' : 'fresh';
}

function scaleImbalance(input: {
  readonly reddit: RniConvergencePlatformInput;
  readonly x: RniConvergencePlatformInput;
  readonly comparable: boolean;
  readonly policy: RniConvergencePolicy;
}): RniConvergenceResult['facts']['scaleImbalance'] {
  const base = {
    redditEffectiveAttention: input.reddit.effectiveAttention,
    xEffectiveAttention: input.x.effectiveAttention,
  };
  if (!input.comparable) {
    return { ...base, state: 'unavailable', dominantPlatform: null, ratio: null };
  }
  const reddit = new D(input.reddit.effectiveAttention);
  const x = new D(input.x.effectiveAttention);
  if (reddit.equals(ZERO) && x.equals(ZERO)) {
    return { ...base, state: 'unavailable', dominantPlatform: null, ratio: null };
  }
  if (reddit.equals(ZERO) || x.equals(ZERO)) {
    return {
      ...base,
      state: 'unbounded',
      dominantPlatform: reddit.greaterThan(x) ? 'reddit' : 'x',
      ratio: null,
    };
  }
  const dominantPlatform = reddit.greaterThanOrEqualTo(x) ? 'reddit' : 'x';
  const high = dominantPlatform === 'reddit' ? reddit : x;
  const low = dominantPlatform === 'reddit' ? x : reddit;
  const ratio = high.div(low);
  if (ratio.lessThan(input.policy.scaleImbalanceRatioThreshold)) {
    return { ...base, state: 'balanced', dominantPlatform: null, ratio: exact(ratio) };
  }
  return {
    ...base,
    state: dominantPlatform === 'reddit' ? 'reddit_higher' : 'x_higher',
    dominantPlatform,
    ratio: exact(ratio),
  };
}

function orderedPlatforms(values: readonly ('reddit' | 'x')[]): readonly ('reddit' | 'x')[] {
  const selected = new Set(values);
  return PLATFORM_ORDER.filter((platform) => selected.has(platform));
}

function computeResult(request: RniConvergenceRequest): RniConvergenceResult {
  const redditFreshness = freshness(request.reddit, request.asOf, request.policy);
  const xFreshness = freshness(request.x, request.asOf, request.policy);
  const nonTerminalPlatforms = orderedPlatforms(
    PLATFORM_ORDER.filter(
      (platform) => request[platform].status === 'pending' || request[platform].status === 'running',
    ),
  );
  const missingPlatforms = orderedPlatforms(
    PLATFORM_ORDER.filter(
      (platform) => request[platform].status === 'failed' || request[platform].status === 'unavailable',
    ),
  );
  const stalePlatforms = orderedPlatforms(
    PLATFORM_ORDER.filter((platform) =>
      platform === 'reddit' ? redditFreshness === 'stale' : xFreshness === 'stale',
    ),
  );
  const ready = (platform: 'reddit' | 'x'): boolean =>
    (request[platform].status === 'complete' || request[platform].status === 'partial') &&
    (platform === 'reddit' ? redditFreshness === 'fresh' : xFreshness === 'fresh');
  const readyReddit = ready('reddit');
  const readyX = ready('x');
  const publishableOverall = (platform: 'reddit' | 'x'): boolean =>
    ready(platform) &&
    request[platform].stance !== 'insufficient' &&
    request[platform].stanceScore !== null;
  const publishableReddit = publishableOverall('reddit');
  const publishableX = publishableOverall('x');
  const insufficientPlatforms = orderedPlatforms(
    PLATFORM_ORDER.filter(
      (platform) =>
        !nonTerminalPlatforms.includes(platform) &&
        !missingPlatforms.includes(platform) &&
        !stalePlatforms.includes(platform) &&
        !publishableOverall(platform),
    ),
  );
  const dimensions: readonly RniDimensionAgreementFact[] = rniDimensionKey.options.map(
    (dimension) => {
      const reddit = request.reddit.dimensions.find((candidate) => candidate.dimension === dimension);
      const x = request.x.dimensions.find((candidate) => candidate.dimension === dimension);
      if (reddit === undefined || x === undefined) throw new Error(`Missing ${dimension}`);
      const comparable =
        readyReddit && readyX && reddit.score !== null && x.score !== null;
      const comparison = comparable
        ? compareDirections({
            redditStance: reddit.stance,
            xStance: x.stance,
            redditScore: reddit.score,
            xScore: x.score,
            divergenceMinimum: request.policy.dimensionDivergenceMinimum,
          })
        : { agreement: 'insufficient' as const, delta: null };
      return {
        dimension,
        redditStance: reddit.stance,
        xStance: x.stance,
        redditScore: reddit.score,
        xScore: x.score,
        scoreDelta: comparison.delta,
        agreement: comparison.agreement,
      };
    },
  );
  const overallComparable = publishableReddit && publishableX;
  const overallComparison = overallComparable
    ? compareDirections({
        redditStance: request.reddit.stance,
        xStance: request.x.stance,
        redditScore: request.reddit.stanceScore,
        xScore: request.x.stanceScore,
        divergenceMinimum: request.policy.dimensionDivergenceMinimum,
      })
    : { agreement: 'insufficient' as const, delta: null };
  const isDisagreement = (agreement: RniDirectionAgreement): boolean =>
    agreement === 'divergent' || agreement === 'mixed';
  const hasDivergence =
    isDisagreement(overallComparison.agreement) ||
    dimensions.some((dimension) => isDisagreement(dimension.agreement));

  let status: RniConvergenceResult['status'];
  let radarState: RniConvergenceResult['radarState'];
  if (nonTerminalPlatforms.length > 0) {
    status = 'PENDING_CROSS_SOURCE';
    radarState = 'pending';
  } else if (!publishableReddit && !publishableX) {
    status = 'INSUFFICIENT_CROSS_SOURCE';
    radarState = 'insufficient';
  } else if (
    !publishableReddit ||
    !publishableX ||
    request.reddit.status === 'partial' ||
    request.x.status === 'partial'
  ) {
    status = 'PARTIAL_CROSS_SOURCE';
    radarState = 'partial';
  } else if (hasDivergence) {
    status = 'DIVERGENT_CROSS_SOURCE';
    radarState = 'divergent';
  } else {
    status = 'COMPLETE_CROSS_SOURCE';
    radarState = 'aligned';
  }

  return {
    runId: request.reddit.runId,
    securityId: request.reddit.securityId,
    methodologyVersion: request.reddit.methodologyVersion,
    status,
    radarState,
    platforms: { reddit: request.reddit, x: request.x },
    facts: {
      overall: {
        redditDirection: directionGroup(request.reddit.stance),
        xDirection: directionGroup(request.x.stance),
        redditScore: request.reddit.stanceScore,
        xScore: request.x.stanceScore,
        scoreDelta: overallComparison.delta,
        agreement: overallComparison.agreement,
      },
      dimensions,
      scaleImbalance: scaleImbalance({
        reddit: request.reddit,
        x: request.x,
        comparable: readyReddit && readyX,
        policy: request.policy,
      }),
      freshness: { reddit: redditFreshness, x: xFreshness },
      coverage: {
        redditStatus: request.reddit.status,
        xStatus: request.x.status,
        nonTerminalPlatforms,
        missingPlatforms,
        insufficientPlatforms,
        stalePlatforms,
      },
    },
    interpretation: 'cross_source_facts_only_no_pooled_metric',
  };
}

export function convergePlatformFacts(rawRequest: RniConvergenceRequest): RniConvergenceArtifact {
  const request = normalizeRequest(requestSchema.parse(rawRequest));
  validatePair(request);
  const result = computeResult(request);
  return {
    calculationCodeVersion: request.policy.codeVersion,
    policyVersion: request.policy.version,
    inputHash: canonicalHash(request),
    resultHash: canonicalHash(result),
    inputSnapshot: request,
    result,
  };
}

export function replayPlatformFacts(artifact: RniConvergenceArtifact): RniConvergenceArtifact {
  if (
    artifact.calculationCodeVersion !== artifact.inputSnapshot.policy.codeVersion ||
    artifact.policyVersion !== artifact.inputSnapshot.policy.version
  ) {
    throw new Error('RNI convergence replay lineage mismatch');
  }
  const replayed = convergePlatformFacts(artifact.inputSnapshot);
  if (artifact.inputHash !== replayed.inputHash) {
    throw new Error('RNI convergence replay input hash mismatch');
  }
  if (artifact.resultHash !== replayed.resultHash || canonicalHash(artifact.result) !== replayed.resultHash) {
    throw new Error('RNI convergence replay result mismatch');
  }
  return replayed;
}
