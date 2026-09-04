import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  rniDimensionAssignment,
  rniDimensionKey,
  rniIsoTimestamp,
  rniSecurityMention,
  rniSecurityObservation,
  rniSignedDecimal,
  rniSourceItem,
  rniStance,
  rniUnitDecimal,
} from '@/rni/contracts';
import { hashRniModelInput } from '@/rni/model-input';
import type {
  RniCitationProposal,
  RniClassifiedClaim,
  RniClassifiedTheme,
  RniClassificationPolicy,
  RniClassifierEvidenceReader,
  RniClassifierInferencePort,
  RniObservationIdFactory,
  RniPersistedClassificationRequest,
  RniPersistedClassificationResult,
  RniSecurityNoiseAssessment,
} from './types';

export const RNI_INSUFFICIENT_CLAIM_SUMMARY = 'Insufficient relevant evidence.';

const dimensionProposal = z
  .object({
    supportStart: z.number().int().nonnegative().nullable(),
    supportEnd: z.number().int().positive().nullable(),
    dimension: rniDimensionKey,
    stance: rniStance,
    score: rniSignedDecimal.nullable(),
    rationale: z.string().min(1).max(2_000),
  })
  .strict()
  .refine((support) => (support.supportStart === null) === (support.supportEnd === null), {
    message: 'Support offsets must both be present or both be absent',
  });

const claimProposal = z
  .object({
    supportStart: z.number().int().nonnegative(),
    supportEnd: z.number().int().positive(),
    dimension: rniDimensionKey,
    claimText: z.string().min(1).max(2_000),
    claimType: z.enum(['fact_assertion', 'opinion', 'forecast', 'position', 'question', 'joke']),
    epistemicStatus: z.enum(['source_claim', 'unverified']),
  })
  .strict()
  .refine((support) => support.supportEnd > support.supportStart, {
    message: 'Support end must be greater than support start',
  });

const themeProposal = z
  .object({
    supportStart: z.number().int().nonnegative(),
    supportEnd: z.number().int().positive(),
    stableKey: z.string().min(1).max(100),
    stance: rniStance,
    score: rniSignedDecimal.nullable(),
    classificationConfidence: rniUnitDecimal,
  })
  .strict()
  .refine((support) => support.supportEnd > support.supportStart, {
    message: 'Support end must be greater than support start',
  });

const noiseProposal = z
  .object({
    supportStart: z.number().int().nonnegative(),
    supportEnd: z.number().int().positive(),
    isSarcastic: z.boolean(),
    sarcasmProbability: rniUnitDecimal,
    isMeme: z.boolean(),
    memeProbability: rniUnitDecimal,
    isSpam: z.boolean(),
    spamProbability: rniUnitDecimal,
    informationValue: rniUnitDecimal,
    assertionStrength: rniUnitDecimal,
    evidenceQuality: rniUnitDecimal,
    uncertainty: rniUnitDecimal,
    exclusionReason: z.enum(['off_topic', 'spam', 'unresolved_context']).nullable(),
  })
  .strict()
  .refine((support) => support.supportEnd > support.supportStart, {
    message: 'Noise support end must be greater than support start',
  });

export const rniClassifierModelOutput = z
  .object({
    stance: rniStance,
    stanceScore: rniSignedDecimal.nullable(),
    relevance: rniUnitDecimal,
    claimSummary: z.string().min(1).max(2_000),
    timeHorizon: z.string().max(100).nullable(),
    dimensions: z.array(dimensionProposal).length(4),
    claims: z.array(claimProposal).max(20),
    themes: z.array(themeProposal).max(20),
    noise: noiseProposal,
  })
  .strict();

const taxonomyCategory = z
  .object({
    definitionId: z.string().uuid(),
    stableKey: z.string().min(1).max(100),
    label: z.string().min(1).max(200),
    description: z.string().min(1).max(2_000),
    enabled: z.boolean(),
    classificationThreshold: rniUnitDecimal,
  })
  .strict();

const classificationPolicy = z
  .object({
    version: z.string().min(1),
    schemaVersion: z.string().min(1),
    neutralMaxAbsoluteScore: rniUnitDecimal,
    strongMinAbsoluteScore: rniUnitDecimal,
    binaryLabelThreshold: rniUnitDecimal,
  })
  .strict();

export const rniClassifierPolicyInput = classificationPolicy;
export const rniClassifierTaxonomyCategoryInput = taxonomyCategory;

const requestSchema = z
  .object({
    sourceItemId: z.string().uuid(),
    mentions: z
      .array(rniSecurityMention)
      .min(1)
      .max(100)
      .refine((mentions) => new Set(mentions.map(({ id }) => id)).size === mentions.length, {
        message: 'Classification mention IDs must be unique',
      }),
    taxonomy: z
      .object({
        version: z.string().min(1),
        categories: z
          .array(taxonomyCategory)
          .max(100)
          .superRefine((categories, context) => {
            if (
              new Set(categories.map(({ definitionId }) => definitionId)).size !==
              categories.length
            ) {
              context.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Theme taxonomy definition IDs must be unique',
              });
            }
            if (
              new Set(categories.map(({ stableKey }) => stableKey)).size !== categories.length
            ) {
              context.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Theme taxonomy stable keys must be unique',
              });
            }
          }),
      })
      .strict(),
    classificationPolicy,
    classifierRunId: z.string().uuid(),
    promptVersion: z.string().min(1),
    modelId: z.string().min(1),
    createdAt: rniIsoTimestamp,
  })
  .strict();

type ParsedRequest = z.infer<typeof requestSchema>;
type ParsedOutput = z.infer<typeof rniClassifierModelOutput>;
type ParsedSupport = { readonly supportStart: number; readonly supportEnd: number };

function decimalParts(value: string): { whole: string; fraction: string } {
  const normalized = value.startsWith('-') ? value.slice(1) : value;
  const [whole = '0', fraction = ''] = normalized.split('.');
  return { whole, fraction };
}

function compareUnitDecimals(left: string, right: string): number {
  const leftParts = decimalParts(left);
  const rightParts = decimalParts(right);
  if (leftParts.whole !== rightParts.whole) {
    return leftParts.whole < rightParts.whole ? -1 : 1;
  }
  const width = Math.max(leftParts.fraction.length, rightParts.fraction.length);
  const leftFraction = leftParts.fraction.padEnd(width, '0');
  const rightFraction = rightParts.fraction.padEnd(width, '0');
  if (leftFraction === rightFraction) return 0;
  return leftFraction < rightFraction ? -1 : 1;
}

function isZero(value: string): boolean {
  return /^-?0(?:\.0+)?$/u.test(value);
}

function expectedStance(score: string, policy: RniClassificationPolicy) {
  const magnitude = score.startsWith('-') ? score.slice(1) : score;
  if (compareUnitDecimals(magnitude, policy.neutralMaxAbsoluteScore) <= 0) return 'neutral';
  const isStrong = compareUnitDecimals(magnitude, policy.strongMinAbsoluteScore) >= 0;
  if (score.startsWith('-')) return isStrong ? 'strong_bearish' : 'bearish';
  return isStrong ? 'strong_bullish' : 'bullish';
}

function validatePolicy(policy: RniClassificationPolicy): void {
  if (
    compareUnitDecimals(policy.neutralMaxAbsoluteScore, policy.strongMinAbsoluteScore) >= 0 ||
    isZero(policy.strongMinAbsoluteScore) ||
    isZero(policy.binaryLabelThreshold)
  ) {
    throw new Error('RNI classification policy thresholds are invalid');
  }
}

function validateStanceScore(
  stance: z.infer<typeof rniStance>,
  score: string | null,
  policy: RniClassificationPolicy,
): void {
  if (stance === 'insufficient') {
    if (score !== null) throw new Error('An insufficient RNI stance cannot carry a score');
    return;
  }
  if (score === null || expectedStance(score, policy) !== stance) {
    throw new Error('RNI classifier stance does not match the pinned score policy');
  }
}

function validateSupport(input: {
  support: ParsedSupport;
  content: string;
  targetMentions: ParsedRequest['mentions'];
}): string {
  if (input.support.supportEnd > input.content.length) {
    throw new Error('RNI classifier support span exceeds bounded source content');
  }
  const evidenceText = input.content.slice(input.support.supportStart, input.support.supportEnd);
  if (evidenceText.trim() === '') throw new Error('RNI classifier support span is blank');
  const coversTarget = input.targetMentions.some(
    (mention) =>
      mention.startOffset !== null &&
      mention.endOffset !== null &&
      mention.startOffset >= input.support.supportStart &&
      mention.endOffset <= input.support.supportEnd,
  );
  if (!coversTarget) {
    throw new Error('RNI classifier support span must cover a resolved target-security mention');
  }
  return evidenceText;
}

function validateNoise(
  output: ParsedOutput,
  policy: RniClassificationPolicy,
  allDimensionsInsufficient: boolean,
): void {
  for (const [flag, probability] of [
    [output.noise.isSarcastic, output.noise.sarcasmProbability],
    [output.noise.isMeme, output.noise.memeProbability],
    [output.noise.isSpam, output.noise.spamProbability],
  ] as const) {
    if ((compareUnitDecimals(probability, policy.binaryLabelThreshold) >= 0) !== flag) {
      throw new Error('RNI semantic label does not match the pinned probability threshold');
    }
  }
  if ((output.noise.exclusionReason === 'spam') !== output.noise.isSpam) {
    throw new Error('RNI spam exclusion must match the spam label');
  }
  if (output.noise.exclusionReason !== null) {
    if (
      output.stance !== 'insufficient' ||
      !allDimensionsInsufficient ||
      !isZero(output.relevance) ||
      output.claimSummary !== RNI_INSUFFICIENT_CLAIM_SUMMARY ||
      output.claims.length > 0 ||
      output.themes.length > 0
    ) {
      throw new Error('Excluded RNI evidence must abstain without claims or themes');
    }
  }
}

function stableInputHash(input: Parameters<RniClassifierInferencePort['infer']>[0]): string {
  const { modelRunId: _routingIdentity, ...modelVisibleInput } = input;
  return hashRniModelInput(modelVisibleInput);
}

function classifierCallId(batchId: string, sourceItemId: string, securityId: string): string {
  const digest = createHash('sha256')
    .update(`${batchId}:${sourceItemId}:${securityId}`, 'utf8')
    .digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function validateAndBuildTarget(input: {
  output: ParsedOutput;
  request: ParsedRequest;
  source: z.infer<typeof rniSourceItem>;
  securityId: string;
  targetMentions: ParsedRequest['mentions'];
  inputHash: string;
  observationId: string;
  classifierRunId: string;
}): {
  observation: z.infer<typeof rniSecurityObservation>;
  claims: RniClassifiedClaim[];
  themes: RniClassifiedTheme[];
  noise: RniSecurityNoiseAssessment;
  citationProposals: RniCitationProposal[];
} {
  const { output, request, source, securityId, targetMentions } = input;
  validateStanceScore(output.stance, output.stanceScore, request.classificationPolicy);
  const dimensionKeys = output.dimensions.map(({ dimension }) => dimension);
  if (
    new Set(dimensionKeys).size !== rniDimensionKey.options.length ||
    !rniDimensionKey.options.every((dimension) => dimensionKeys.includes(dimension))
  ) {
    throw new Error('RNI classifier must return each of the four dimensions exactly once');
  }
  const dimensions = rniDimensionKey.options.map(
    (dimension) => output.dimensions.find((candidate) => candidate.dimension === dimension)!,
  );

  const claims: RniClassifiedClaim[] = output.claims
    .map((claim) => ({
      sourceItemId: source.id,
      securityId,
      dimension: claim.dimension,
      claimText: claim.claimText,
      claimType: claim.claimType,
      epistemicStatus: claim.epistemicStatus,
      startOffset: claim.supportStart,
      endOffset: claim.supportEnd,
      evidenceText: validateSupport({
        support: claim,
        content: source.boundedContent,
        targetMentions,
      }),
    }))
    .sort(
      (left, right) =>
        left.dimension.localeCompare(right.dimension) ||
        left.startOffset - right.startOffset ||
        left.endOffset - right.endOffset ||
        left.claimType.localeCompare(right.claimType) ||
        left.claimText.localeCompare(right.claimText),
    );
  const claimKeys = claims.map(
    (claim) =>
      `${claim.dimension}:${claim.claimType}:${claim.epistemicStatus}:${claim.startOffset}:${claim.endOffset}:${claim.claimText}`,
  );
  if (new Set(claimKeys).size !== claimKeys.length) {
    throw new Error('RNI classifier returned duplicate claim proposals');
  }

  for (const dimension of dimensions) {
    validateStanceScore(dimension.stance, dimension.score, request.classificationPolicy);
    const dimensionClaims = claims.filter((claim) => claim.dimension === dimension.dimension);
    if (dimension.stance === 'insufficient') {
      if (
        dimension.supportStart !== null ||
        dimension.supportEnd !== null ||
        dimensionClaims.length > 0
      ) {
        throw new Error('An insufficient RNI dimension cannot carry support or claims');
      }
      continue;
    }
    if (dimension.supportStart === null || dimension.supportEnd === null) {
      throw new Error('A classified RNI dimension requires exact source support');
    }
    validateSupport({
      support: { supportStart: dimension.supportStart, supportEnd: dimension.supportEnd },
      content: source.boundedContent,
      targetMentions,
    });
    if (
      !dimensionClaims.some(
        (claim) =>
          claim.startOffset === dimension.supportStart && claim.endOffset === dimension.supportEnd,
      )
    ) {
      throw new Error('A classified RNI dimension requires a matching claim support span');
    }
  }

  const allDimensionsInsufficient = dimensions.every(
    ({ stance }) => stance === 'insufficient',
  );
  if ((output.stance === 'insufficient') !== allDimensionsInsufficient) {
    throw new Error('RNI overall insufficiency must match its four dimensions');
  }
  if (output.stance === 'insufficient') {
    if (
      output.claimSummary !== RNI_INSUFFICIENT_CLAIM_SUMMARY ||
      !isZero(output.relevance) ||
      claims.length > 0 ||
      output.themes.length > 0
    ) {
      throw new Error('Insufficient RNI observations cannot publish claims or themes');
    }
  } else if (
    claims.length === 0 ||
    !claims.some(({ claimText }) => claimText === output.claimSummary)
  ) {
    throw new Error('A classified RNI observation requires a source-bound claim summary');
  }
  validateNoise(output, request.classificationPolicy, allDimensionsInsufficient);
  const noiseEvidenceText = validateSupport({
    support: output.noise,
    content: source.boundedContent,
    targetMentions,
  });

  const enabledThemes = new Map(
    request.taxonomy.categories
      .filter(({ enabled }) => enabled)
      .map((category) => [category.stableKey, category]),
  );
  const themes: RniClassifiedTheme[] = output.themes
    .map((theme) => {
      const definition = enabledThemes.get(theme.stableKey);
      if (definition === undefined) {
        throw new Error('RNI classifier output referenced an unknown or disabled versioned theme');
      }
      validateStanceScore(theme.stance, theme.score, request.classificationPolicy);
      if (
        compareUnitDecimals(theme.classificationConfidence, definition.classificationThreshold) <
        0
      ) {
        throw new Error('RNI theme classification did not meet its pinned threshold');
      }
      return {
        sourceItemId: source.id,
        securityId,
        taxonomyVersion: request.taxonomy.version,
        themeDefinitionId: definition.definitionId,
        stableKey: theme.stableKey,
        stance: theme.stance,
        score: theme.score,
        classificationConfidence: theme.classificationConfidence,
        startOffset: theme.supportStart,
        endOffset: theme.supportEnd,
        evidenceText: validateSupport({
          support: theme,
          content: source.boundedContent,
          targetMentions,
        }),
      };
    })
    .sort(
      (left, right) =>
        left.stableKey.localeCompare(right.stableKey) ||
        left.startOffset - right.startOffset ||
        left.endOffset - right.endOffset,
    );
  if (new Set(themes.map(({ stableKey }) => stableKey)).size !== themes.length) {
    throw new Error('RNI classifier returned duplicate theme assignments');
  }

  const observation = rniSecurityObservation.parse({
    id: input.observationId,
    sourceItemId: source.id,
    securityId,
    stance: output.stance,
    stanceScore: output.stanceScore,
    relevance: output.relevance,
    claimSummary: output.claimSummary,
    timeHorizon: output.timeHorizon,
    dimensions: dimensions.map(
      ({ supportStart: _supportStart, supportEnd: _supportEnd, ...dimension }) =>
        rniDimensionAssignment.parse(dimension),
    ),
    classifierRunId: input.classifierRunId,
    promptVersion: request.promptVersion,
    modelId: request.modelId,
    inputHash: input.inputHash,
    createdAt: request.createdAt,
  });
  const {
    supportStart: noiseStartOffset,
    supportEnd: noiseEndOffset,
    ...semanticNoise
  } = output.noise;
  const noise: RniSecurityNoiseAssessment = {
    sourceItemId: source.id,
    securityId,
    startOffset: noiseStartOffset,
    endOffset: noiseEndOffset,
    evidenceText: noiseEvidenceText,
    ...semanticNoise,
  };
  const citationProposals = claims.map(
    ({
      securityId: claimSecurityId,
      dimension,
      claimText,
      claimType,
      epistemicStatus,
      evidenceText,
      startOffset,
      endOffset,
    }) => ({
      sourceItemId: source.id,
      securityId: claimSecurityId,
      dimension,
      claimText,
      claimType,
      epistemicStatus,
      platform: source.platform,
      url: source.originalUrl,
      evidenceText,
      startOffset,
      endOffset,
    }),
  );
  return { observation, claims, themes, noise, citationProposals };
}

/**
 * Reads committed evidence, invokes one bounded no-tool classifier per security, and validates
 * every proposal before returning frozen observations plus non-publishable semantic sidecars.
 */
export async function classifyPersistedSecurityObservations(
  request: RniPersistedClassificationRequest,
  deps: {
    readonly evidence: RniClassifierEvidenceReader;
    readonly inference: RniClassifierInferencePort;
    readonly observationIdFactory: RniObservationIdFactory;
  },
): Promise<RniPersistedClassificationResult> {
  const parsedRequest = requestSchema.parse(request);
  validatePolicy(parsedRequest.classificationPolicy);
  const source = rniSourceItem.parse(await deps.evidence.getEvidence(parsedRequest.sourceItemId));
  if (source.id !== parsedRequest.sourceItemId) {
    throw new Error('RNI classifier evidence reader returned a different durable source identity');
  }
  for (const mention of parsedRequest.mentions) {
    if (mention.sourceItemId !== source.id) {
      throw new Error('RNI classifier received a mention from another source');
    }
    if (
      mention.startOffset === null ||
      mention.endOffset === null ||
      mention.endOffset > source.boundedContent.length ||
      source.boundedContent.slice(mention.startOffset, mention.endOffset) !== mention.mentionText
    ) {
      throw new Error('RNI classifier mention does not match persisted source offsets');
    }
  }

  const mentions = [...parsedRequest.mentions].sort(
    (left, right) =>
      left.securityId.localeCompare(right.securityId) ||
      (left.startOffset ?? -1) - (right.startOffset ?? -1) ||
      left.id.localeCompare(right.id),
  );
  const securityIds = [...new Set(mentions.map(({ securityId }) => securityId))].sort();
  const enabledTaxonomy = {
    ...parsedRequest.taxonomy,
    categories: parsedRequest.taxonomy.categories
      .filter(({ enabled }) => enabled)
      .sort((left, right) => left.stableKey.localeCompare(right.stableKey)),
  };
  const targetResults = await Promise.all(
    securityIds.map(async (securityId, occurrence) => {
      const targetMentions = mentions.filter((mention) => mention.securityId === securityId);
      const contextMentions = mentions.filter((mention) => mention.securityId !== securityId);
      const modelRunId = classifierCallId(parsedRequest.classifierRunId, source.id, securityId);
      const modelInput: Parameters<RniClassifierInferencePort['infer']>[0] = {
        modelRunId,
        policy: Object.freeze({
          sourceContentTreatment: 'untrusted_data' as const,
          allowedTools: Object.freeze([]) as readonly [],
          classification: parsedRequest.classificationPolicy,
        }),
        promptVersion: parsedRequest.promptVersion,
        modelId: parsedRequest.modelId,
        sourceItemId: source.id,
        platform: source.platform,
        untrustedBoundedContent: source.boundedContent,
        targetSecurityId: securityId,
        targetMentions,
        contextMentions,
        taxonomy: enabledTaxonomy,
      };
      const inputHash = stableInputHash(modelInput);
      const output = rniClassifierModelOutput.parse(
        await deps.inference.infer(modelInput),
      );
      return validateAndBuildTarget({
        output,
        request: parsedRequest,
        source,
        securityId,
        targetMentions,
        inputHash,
        classifierRunId: modelRunId,
        observationId: deps.observationIdFactory({
          sourceItemId: source.id,
          securityId,
          classifierRunId: modelRunId,
          occurrence,
        }),
      });
    }),
  );

  return {
    observations: targetResults.map(({ observation }) => observation),
    claims: targetResults.flatMap(({ claims }) => claims),
    themes: targetResults.flatMap(({ themes }) => themes),
    noise: targetResults.map(({ noise }) => noise),
    citationProposals: targetResults.flatMap(({ citationProposals }) => citationProposals),
    inputHashesBySecurity: Object.fromEntries(
      targetResults.map(({ observation }) => [observation.securityId, observation.inputHash]),
    ),
  };
}
