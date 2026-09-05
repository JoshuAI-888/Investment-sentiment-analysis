import { z } from 'zod';

import { canonicalHash } from '../../calc/canonical';
import {
  rniCitation,
  rniCombinedSummary,
  rniIsoTimestamp,
  rniPlatform,
  rniSourceItem,
} from '../contracts';
import { replayPlatformFacts } from '../convergence';
import type { RniConvergenceArtifact } from '../convergence';
import { canonicalizeRedditUrl } from '../discovery';
import {
  RNI_CITED_SYNTHESIS_CODE_VERSION,
  type RniChallengerAssessment,
  type RniChallengerInferencePort,
  type RniChallengerModelInput,
  type RniCitedSynthesisArtifact,
  type RniCitedSynthesisRequest,
  type RniCitedSynthesisResult,
  type RniClaimAssessment,
  type RniInferenceInvocationDescriptor,
  type RniSummaryStatement,
  type RniSynthesisClaim,
  type RniSynthesisEvidenceReader,
  type RniVerificationInferencePort,
  type RniVerificationModelInput,
  type RniVerifiedCitationEvidence,
} from './types';

const PLATFORM_ORDER = ['reddit', 'x'] as const;

const uniqueUuidArray = z
  .array(z.string().uuid())
  .max(100)
  .refine((values) => new Set(values).size === values.length, {
    message: 'Citation IDs must be unique',
  });
const nonEmptyUniqueUuidArray = z
  .array(z.string().uuid())
  .min(1)
  .max(100)
  .refine((values) => new Set(values).size === values.length, {
    message: 'Citation IDs must be unique',
  });

const claimSchema = z
  .object({
    id: z.string().uuid(),
    runId: z.string().uuid(),
    securityId: z.string().uuid(),
    platform: rniPlatform,
    kind: z.literal('catalyst'),
    claimText: z.string().trim().min(1).max(2_000),
    sourceCitationIds: nonEmptyUniqueUuidArray,
    verificationCutoffAt: rniIsoTimestamp,
  })
  .strict();

const invocationSchema = z
  .object({
    modelRunId: z.string().uuid(),
    stage: z.enum(['verification', 'challenger']),
    runId: z.string().uuid(),
    securityId: z.string().uuid(),
    modelId: z.string().min(1),
    promptVersion: z.string().min(1),
    policyVersion: z.string().min(1),
    rightsPolicyVersion: z.string().min(1),
    claimIds: uniqueUuidArray,
    assessmentCutoffAt: rniIsoTimestamp,
  })
  .strict();

const requestSchema = z
  .object({
    codeVersion: z.literal(RNI_CITED_SYNTHESIS_CODE_VERSION),
    policyVersion: z.string().min(1),
    rightsPolicyVersion: z.string().min(1),
    summaryId: z.string().uuid(),
    verificationInvocation: invocationSchema.extend({ stage: z.literal('verification') }),
    challengerInvocation: invocationSchema.extend({ stage: z.literal('challenger') }),
    createdAt: rniIsoTimestamp,
    convergenceArtifact: z.custom<RniConvergenceArtifact>(
      (value) => value !== null && typeof value === 'object',
      'A convergence artifact is required',
    ),
    claims: z
      .array(claimSchema)
      .max(50)
      .refine((claims) => new Set(claims.map(({ id }) => id)).size === claims.length, {
        message: 'Synthesis claim IDs must be unique',
      }),
    platformCitationIds: z
      .object({ reddit: uniqueUuidArray, x: uniqueUuidArray })
      .strict(),
    citationIds: uniqueUuidArray,
  })
  .strict();

const assessmentSchema = z
  .object({
    claimId: z.string().uuid(),
    verdict: z.enum(['supported', 'contradicted', 'contested', 'unverified']),
    supportingCitationIds: uniqueUuidArray,
    contradictingCitationIds: uniqueUuidArray,
  })
  .strict();

const verificationOutputSchema = z
  .object({
    assessments: z
      .array(assessmentSchema)
      .max(50)
      .refine(
        (assessments) =>
          new Set(assessments.map(({ claimId }) => claimId)).size === assessments.length,
        { message: 'Verification claim IDs must be unique' },
      ),
  })
  .strict();

const challengerOutputSchema = z
  .object({
    verdict: z.enum(['no_supported_challenge_found', 'material_challenge', 'insufficient']),
    challengedClaimId: z.string().uuid().nullable(),
    citationIds: uniqueUuidArray,
  })
  .strict();

type PreparedSynthesis = {
  readonly request: RniCitedSynthesisRequest;
  readonly modelInput: RniVerificationModelInput;
};

type ResolvedSynthesisEvidence = {
  readonly evidenceById: ReadonlyMap<
    string,
    Omit<RniVerifiedCitationEvidence, 'lineage'>
  >;
  readonly claimEvidenceById: ReadonlyMap<string, readonly RniVerifiedCitationEvidence[]>;
};

function sortIds(values: readonly string[]): readonly string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function normalizeClaim(claim: RniSynthesisClaim): RniSynthesisClaim {
  return {
    ...claim,
    claimText: claim.claimText.trim(),
    sourceCitationIds: sortIds(claim.sourceCitationIds),
  };
}

function normalizeRequest(
  parsed: z.infer<typeof requestSchema>,
  convergenceArtifact: RniConvergenceArtifact,
): RniCitedSynthesisRequest {
  const claims = parsed.claims
    .map(normalizeClaim)
    .sort(
      (left, right) =>
        PLATFORM_ORDER.indexOf(left.platform) - PLATFORM_ORDER.indexOf(right.platform) ||
        left.id.localeCompare(right.id),
    );
  return {
    ...parsed,
    convergenceArtifact,
    claims,
    platformCitationIds: {
      reddit: sortIds(parsed.platformCitationIds.reddit),
      x: sortIds(parsed.platformCitationIds.x),
    },
    citationIds: sortIds(parsed.citationIds),
  };
}

function validateRequestOwnership(request: RniCitedSynthesisRequest): void {
  const { runId, securityId, status } = request.convergenceArtifact.result;
  if (status === 'PENDING_CROSS_SOURCE') {
    throw new Error('RNI synthesis cannot run before both platform slices are terminal');
  }
  if (Date.parse(request.createdAt) < Date.parse(request.convergenceArtifact.inputSnapshot.asOf)) {
    throw new Error('RNI synthesis creation cannot precede its convergence facts');
  }
  if (request.verificationInvocation.modelRunId === request.challengerInvocation.modelRunId) {
    throw new Error('Verifier and challenger require distinct persisted model invocations');
  }
  const assessmentCutoffAt = request.convergenceArtifact.inputSnapshot.asOf;
  const claimIds = sortIds(request.claims.map(({ id }) => id));
  for (const invocation of [request.verificationInvocation, request.challengerInvocation]) {
    if (
      invocation.runId !== runId ||
      invocation.securityId !== securityId ||
      invocation.policyVersion !== request.policyVersion ||
      invocation.rightsPolicyVersion !== request.rightsPolicyVersion ||
      invocation.assessmentCutoffAt !== assessmentCutoffAt ||
      canonicalHash(sortIds(invocation.claimIds)) !== canonicalHash(claimIds)
    ) {
      throw new Error('Model invocation lineage does not match this synthesis request');
    }
  }
  for (const claim of request.claims) {
    if (claim.runId !== runId || claim.securityId !== securityId) {
      throw new Error('RNI synthesis refuses a cross-run or cross-security claim');
    }
    if (Date.parse(claim.verificationCutoffAt) > Date.parse(request.createdAt)) {
      throw new Error('Catalyst verification cutoff cannot follow synthesis creation');
    }
  }
  if (
    request.claims.some(({ verificationCutoffAt }) => verificationCutoffAt !== assessmentCutoffAt)
  ) {
    throw new Error('One synthesis verification batch requires one persisted assessment cutoff');
  }
  for (const platform of PLATFORM_ORDER) {
    const dataThroughAt = request.convergenceArtifact.result.platforms[platform].dataThroughAt;
    if (dataThroughAt !== null && Date.parse(dataThroughAt) > Date.parse(assessmentCutoffAt)) {
      throw new Error('Model-visible convergence facts cannot follow the assessment cutoff');
    }
  }
  const requestedIds = new Set(request.citationIds);
  for (const claim of request.claims) {
    if (claim.sourceCitationIds.some((citationId) => !requestedIds.has(citationId))) {
      throw new Error('Every catalyst source citation must be included in the evidence request');
    }
  }
  for (const platform of PLATFORM_ORDER) {
    if (request.platformCitationIds[platform].some((citationId) => !requestedIds.has(citationId))) {
      throw new Error('Every platform conclusion citation must be included in the evidence request');
    }
  }
}

function canonicalizeXStatusUrl(value: string): { canonicalUrl: string; externalId: string } | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./u, '');
    const match = url.pathname.match(/^\/(?:i\/web|[A-Za-z0-9_]+)\/status\/([0-9]+)\/?$/u);
    if (url.protocol !== 'https:' || host !== 'x.com' || match?.[1] === undefined) return null;
    return {
      canonicalUrl: `https://x.com/i/web/status/${match[1]}`,
      externalId: match[1],
    };
  } catch {
    return null;
  }
}

function validatePublicationUrl(source: z.infer<typeof rniSourceItem>): void {
  if (source.platform === 'reddit') {
    const canonical = canonicalizeRedditUrl(source.canonicalUrl);
    const original = canonicalizeRedditUrl(source.originalUrl);
    if (
      canonical === null ||
      original === null ||
      canonical.canonicalUrl !== source.canonicalUrl ||
      original.canonicalUrl !== source.canonicalUrl ||
      canonical.sourceKind !== source.sourceKind ||
      original.sourceKind !== source.sourceKind ||
      canonical.externalId !== source.externalId ||
      original.externalId !== source.externalId
    ) {
      throw new Error('Reddit publication evidence requires an approved canonical post URL');
    }
    return;
  }
  const canonical = canonicalizeXStatusUrl(source.canonicalUrl);
  const original = canonicalizeXStatusUrl(source.originalUrl);
  if (
    canonical?.canonicalUrl !== source.canonicalUrl ||
    original?.canonicalUrl !== source.canonicalUrl ||
    canonical.externalId !== source.externalId ||
    original.externalId !== source.externalId
  ) {
    throw new Error('X publication evidence requires a canonical status URL');
  }
}

async function validateTrustedInputs(
  request: RniCitedSynthesisRequest,
  reader: RniSynthesisEvidenceReader,
): Promise<void> {
  const activeRightsPolicyVersion = await reader.getActiveRightsPolicyVersion(
    request.convergenceArtifact.result.runId,
  );
  if (activeRightsPolicyVersion !== request.rightsPolicyVersion) {
    throw new Error('Synthesis request does not use the trusted active rights policy');
  }
  await Promise.all(
    request.claims.map(async (claim) => {
      const persisted = normalizeClaim(
        claimSchema.parse(await reader.getSynthesisClaim(claim.id)),
      );
      if (canonicalHash(persisted) !== canonicalHash(claim)) {
        throw new Error('Synthesis claim text, cutoff, or lineage differs from persisted state');
      }
    }),
  );
  await Promise.all(
    [request.verificationInvocation, request.challengerInvocation].map(async (invocation) => {
      const persisted = invocationSchema.parse(
        await reader.getModelInvocation(invocation.modelRunId),
      ) as RniInferenceInvocationDescriptor;
      if (canonicalHash(persisted) !== canonicalHash(invocation)) {
        throw new Error('Model invocation descriptor differs from persisted lineage');
      }
    }),
  );
}

async function resolveEvidence(
  request: RniCitedSynthesisRequest,
  reader: RniSynthesisEvidenceReader,
): Promise<ResolvedSynthesisEvidence> {
  const evidence = await Promise.all(
    request.citationIds.map(async (citationId) => {
      const citation = rniCitation.parse(await reader.getCitation(citationId));
      if (citation.id !== citationId) {
        throw new Error('Citation lookup returned a different persisted citation identity');
      }
      const source = rniSourceItem.parse(await reader.getEvidence(citation.sourceItemId));
      if (source.id !== citation.sourceItemId) {
        throw new Error('Evidence lookup returned a different persisted source identity');
      }
      if (source.platform !== citation.platform) {
        throw new Error('Citation and persisted evidence platform lineage must match');
      }
      validatePublicationUrl(source);
      if (citation.url !== source.originalUrl) {
        throw new Error('Publication citation URL must equal its persisted original source URL');
      }
      if (source.rightsPolicyVersion !== request.rightsPolicyVersion) {
        throw new Error('Publication evidence does not match the active rights policy');
      }
      if (!source.boundedContent.includes(citation.evidenceText)) {
        throw new Error('Citation evidence text must exist in persisted bounded evidence');
      }
      return { citation, source };
    }),
  );
  const evidenceById = new Map(evidence.map((entry) => [entry.citation.id, entry]));
  const validateLineage = (
    lineage: Awaited<ReturnType<RniSynthesisEvidenceReader['getCitationLineage']>>,
    claimId: string | null,
    citationId: string,
  ) => {
    if (
      lineage === null ||
      lineage.claimId !== claimId ||
      lineage.citationId !== citationId ||
      lineage.runId !== request.convergenceArtifact.result.runId ||
      lineage.securityId !== request.convergenceArtifact.result.securityId ||
      lineage.rightsPolicyVersion !== request.rightsPolicyVersion
    ) {
      throw new Error(
        'Citation role lookup did not verify claim, run, security, and rights policy',
      );
    }
    return lineage;
  };
  const claimEvidenceById = new Map<string, readonly RniVerifiedCitationEvidence[]>();
  for (const claim of request.claims) {
    const claimEvidence = (
      await Promise.all(
        request.citationIds.map(async (citationId) => {
          const lineage = await reader.getCitationLineage(claim.id, citationId);
          if (lineage === null) return null;
          const validated = validateLineage(lineage, claim.id, citationId);
          const persisted = evidenceById.get(citationId);
          if (persisted === undefined) {
            throw new Error('Claim-specific citation role references unavailable evidence');
          }
          return { ...persisted, lineage: validated };
        }),
      )
    ).filter((entry): entry is RniVerifiedCitationEvidence => entry !== null);
    const claimEvidenceByCitation = new Map(
      claimEvidence.map((entry) => [entry.citation.id, entry]),
    );
    for (const citationId of claim.sourceCitationIds) {
      const persisted = claimEvidenceByCitation.get(citationId);
      if (
        persisted?.citation.platform !== claim.platform ||
        persisted.lineage.evidenceRole !== 'social_claim'
      ) {
        throw new Error('Catalyst claim citations must remain on the claim platform');
      }
    }
    claimEvidenceById.set(claim.id, claimEvidence);
  }
  for (const platform of PLATFORM_ORDER) {
    for (const citationId of request.platformCitationIds[platform]) {
      const persisted = evidenceById.get(citationId);
      const lineage = validateLineage(
        await reader.getCitationLineage(null, citationId),
        null,
        citationId,
      );
      if (
        persisted?.citation.platform !== platform ||
        lineage.evidenceRole !== 'social_claim' ||
        lineage.analyticsArtifactHash !==
          request.convergenceArtifact.result.platforms[platform].analyticsArtifactHash
      ) {
        throw new Error(
          'Platform conclusion citations must remain in the exact platform analytics lineage',
        );
      }
      if (
        !claimEvidenceIsAvailableBy(
          { ...persisted, lineage },
          request.convergenceArtifact.inputSnapshot.asOf,
        )
      ) {
        throw new Error('Publication evidence was discovered or observed after the cutoff');
      }
    }
  }
  return { evidenceById, claimEvidenceById };
}

async function prepareSynthesis(
  rawRequest: RniCitedSynthesisRequest,
  reader: RniSynthesisEvidenceReader,
): Promise<PreparedSynthesis> {
  const parsed = requestSchema.parse(rawRequest);
  const convergenceArtifact = replayPlatformFacts(parsed.convergenceArtifact);
  const request = normalizeRequest(parsed, convergenceArtifact);
  validateRequestOwnership(request);
  await validateTrustedInputs(request, reader);
  const resolvedEvidence = await resolveEvidence(request, reader);
  const claimInputs = request.claims.map((claim) => {
    const claimSourceIds = new Set(claim.sourceCitationIds);
    const claimEvidence = resolvedEvidence.claimEvidenceById.get(claim.id) ?? [];
    const claimEvidenceByCitation = new Map(
      claimEvidence.map((entry) => [entry.citation.id, entry]),
    );
    for (const citationId of claimSourceIds) {
      const persistedClaimEvidence = claimEvidenceByCitation.get(citationId);
      if (
        persistedClaimEvidence === undefined ||
        !claimEvidenceIsAvailableBy(persistedClaimEvidence, claim.verificationCutoffAt)
      ) {
        throw new Error('Catalyst claim evidence was discovered or observed after the cutoff');
      }
    }
    return {
      claim,
      evidence: claimEvidence.filter(
        (entry) =>
          claimSourceIds.has(entry.citation.id) ||
          ((entry.lineage.evidenceRole === 'corroborating' ||
            entry.lineage.evidenceRole === 'counterevidence') &&
            corroborationEvidenceIsAvailableBy(entry, claim.verificationCutoffAt)),
      ),
    };
  });
  for (const platform of PLATFORM_ORDER) {
    const platformFacts = request.convergenceArtifact.result.platforms[platform];
    const publishable =
      (platformFacts.status === 'complete' || platformFacts.status === 'partial') &&
      request.convergenceArtifact.result.facts.freshness[platform] === 'fresh' &&
      platformFacts.stance !== 'insufficient' &&
      platformFacts.stanceScore !== null;
    if (publishable !== (request.platformCitationIds[platform].length > 0)) {
      throw new Error('Platform conclusion citation availability must match the E07 conclusion');
    }
  }
  return {
    request,
    modelInput: {
      policy: {
        version: request.policyVersion,
        sourceContentTreatment: 'untrusted_data',
        allowedTools: [],
        outputTextPublication: 'forbidden_structured_verdicts_only',
      },
      invocation: request.verificationInvocation,
      runId: request.convergenceArtifact.result.runId,
      securityId: request.convergenceArtifact.result.securityId,
      convergenceFacts: request.convergenceArtifact.result,
      claimInputs,
    },
  };
}

function isPlatformReady(input: RniVerificationModelInput, platform: 'reddit' | 'x'): boolean {
  const facts = input.convergenceFacts;
  return (
    (facts.platforms[platform].status === 'complete' ||
      facts.platforms[platform].status === 'partial') &&
    facts.facts.freshness[platform] === 'fresh' &&
    facts.platforms[platform].stance !== 'insufficient' &&
    facts.platforms[platform].stanceScore !== null
  );
}

function claimEvidenceIsAvailableBy(
  evidence: RniVerifiedCitationEvidence,
  cutoff: string,
): boolean {
  const cutoffMs = Date.parse(cutoff);
  return (
    Date.parse(evidence.source.discoveredAt) <= cutoffMs &&
    Date.parse(evidence.source.observedAt) <= cutoffMs
  );
}

function corroborationEvidenceIsAvailableBy(
  evidence: RniVerifiedCitationEvidence,
  cutoff: string,
): boolean {
  return (
    claimEvidenceIsAvailableBy(evidence, cutoff) &&
    evidence.source.publishedAt !== null &&
    Date.parse(evidence.source.publishedAt) <= Date.parse(cutoff)
  );
}

function validateVerification(
  rawOutput: unknown,
  input: RniVerificationModelInput,
): readonly RniClaimAssessment[] {
  const parsed = verificationOutputSchema.parse(rawOutput);
  if (parsed.assessments.length !== input.claimInputs.length) {
    throw new Error('Verification must assess every catalyst claim exactly once');
  }
  const claimInputs = new Map(input.claimInputs.map((entry) => [entry.claim.id, entry]));
  const assessments = parsed.assessments
    .map((assessment) => ({
      ...assessment,
      supportingCitationIds: sortIds(assessment.supportingCitationIds),
      contradictingCitationIds: sortIds(assessment.contradictingCitationIds),
    }))
    .sort((left, right) => left.claimId.localeCompare(right.claimId));
  for (const assessment of assessments) {
    const claimInput = claimInputs.get(assessment.claimId);
    if (claimInput === undefined) {
      throw new Error('Verification invented an unknown catalyst claim');
    }
    const { claim } = claimInput;
    const evidence = new Map(
      claimInput.evidence.map((entry) => [entry.citation.id, entry]),
    );
    const supporting = new Set(assessment.supportingCitationIds);
    const contradicting = new Set(assessment.contradictingCitationIds);
    const claimSourceItemIds = new Set(
      claim.sourceCitationIds.map((citationId) => {
        const sourceCitation = evidence.get(citationId);
        if (sourceCitation === undefined) {
          throw new Error('Catalyst source citation disappeared before verification');
        }
        return sourceCitation.citation.sourceItemId;
      }),
    );
    for (const citationId of supporting) {
      const persisted = evidence.get(citationId);
      if (
        persisted?.lineage.evidenceRole !== 'corroborating' ||
        !corroborationEvidenceIsAvailableBy(persisted, claim.verificationCutoffAt)
      ) {
        throw new Error('Catalyst support requires separate persisted corroboration by the cutoff');
      }
      if (claimSourceItemIds.has(persisted.citation.sourceItemId)) {
        throw new Error('Catalyst support cannot reuse the claim source under another citation');
      }
    }
    for (const citationId of contradicting) {
      const persisted = evidence.get(citationId);
      if (
        persisted?.lineage.evidenceRole !== 'counterevidence' ||
        !corroborationEvidenceIsAvailableBy(persisted, claim.verificationCutoffAt)
      ) {
        throw new Error('Catalyst contradiction requires persisted counterevidence by the cutoff');
      }
      if (claimSourceItemIds.has(persisted.citation.sourceItemId)) {
        throw new Error(
          'Catalyst contradiction cannot reuse the claim source under another citation',
        );
      }
    }
    if ([...supporting].some((citationId) => contradicting.has(citationId))) {
      throw new Error('One citation cannot both support and contradict the same claim');
    }
    const shapeIsValid =
      (assessment.verdict === 'supported' && supporting.size > 0 && contradicting.size === 0) ||
      (assessment.verdict === 'contradicted' && supporting.size === 0 && contradicting.size > 0) ||
      (assessment.verdict === 'contested' && supporting.size > 0 && contradicting.size > 0) ||
      (assessment.verdict === 'unverified' && supporting.size === 0 && contradicting.size === 0);
    if (!shapeIsValid) throw new Error('Verification verdict and citation evidence disagree');
    if (
      assessment.verdict !== 'unverified' &&
      !isPlatformReady(input, claim.platform)
    ) {
      throw new Error('Non-fresh or non-publishable platform evidence cannot pass verification');
    }
  }
  return assessments;
}

function validateChallenger(
  rawOutput: unknown,
  input: RniChallengerModelInput,
): RniChallengerAssessment {
  const parsed = challengerOutputSchema.parse(rawOutput);
  const citationIds = sortIds(parsed.citationIds);
  const supporting = new Set(input.verification.flatMap((item) => item.supportingCitationIds));
  const contradicting = new Set(
    input.verification.flatMap((item) => item.contradictingCitationIds),
  );
  const challenged = input.verification.find(
    ({ claimId }) => claimId === parsed.challengedClaimId,
  );
  const shapeIsValid =
    (parsed.verdict === 'material_challenge' &&
      parsed.challengedClaimId !== null &&
      challenged !== undefined &&
      (challenged.verdict === 'contradicted' || challenged.verdict === 'contested') &&
      citationIds.length > 0 &&
      citationIds.length === challenged.contradictingCitationIds.length &&
      citationIds.every((citationId) => challenged.contradictingCitationIds.includes(citationId))) ||
    (parsed.verdict === 'no_supported_challenge_found' &&
      parsed.challengedClaimId === null &&
      contradicting.size === 0 &&
      supporting.size > 0 &&
      citationIds.length === 0) ||
    (parsed.verdict === 'insufficient' &&
      parsed.challengedClaimId === null &&
      supporting.size === 0 &&
      contradicting.size === 0 &&
      citationIds.length === 0);
  if (!shapeIsValid) {
    throw new Error('Challenger verdict must be grounded in the verified citation sets');
  }
  return { verdict: parsed.verdict, challengedClaimId: parsed.challengedClaimId, citationIds };
}

function sentenceClaimText(claimText: string): string {
  return claimText.trim().replace(/\s+/gu, ' ');
}

function uniqueSortedCitations(statements: readonly RniSummaryStatement[]): readonly string[] {
  return sortIds([...new Set(statements.flatMap(({ citationIds }) => citationIds))]);
}

function platformStatus(
  input: RniVerificationModelInput,
  platform: 'reddit' | 'x',
): 'complete' | 'partial' | 'insufficient' {
  const platformFacts = input.convergenceFacts.platforms[platform];
  if (
    !isPlatformReady(input, platform) ||
    platformFacts.stance === 'insufficient' ||
    platformFacts.stanceScore === null
  ) {
    return 'insufficient';
  }
  return platformFacts.status === 'partial' ? 'partial' : 'complete';
}

function platformConclusionStatement(
  input: RniVerificationModelInput,
  request: RniCitedSynthesisRequest,
  platform: 'reddit' | 'x',
): RniSummaryStatement {
  const label = platform === 'reddit' ? 'Reddit' : 'X';
  const platformFacts = input.convergenceFacts.platforms[platform];
  const status = platformStatus(input, platform);
  if (status !== 'insufficient') {
    return {
      heading: platform === 'reddit' ? 'Reddit sentiment' : 'X sentiment',
      origin: 'platform_conclusion',
      text: `${label} platform conclusion: ${platformFacts.stance.replaceAll('_', ' ')}.`,
      citationIds: request.platformCitationIds[platform],
    };
  }
  const reason =
    platformFacts.status === 'failed' || platformFacts.status === 'unavailable'
      ? platformFacts.status
      : input.convergenceFacts.facts.freshness[platform] !== 'fresh'
        ? `${input.convergenceFacts.facts.freshness[platform]} freshness`
        : 'insufficient sentiment evidence';
  return {
    heading: platform === 'reddit' ? 'Reddit sentiment' : 'X sentiment',
    origin: 'coverage_disclosure',
    text: `${label} platform conclusion: ${reason}.`,
    citationIds: [],
  };
}

function assembleResult(
  input: RniVerificationModelInput,
  verification: readonly RniClaimAssessment[],
  challenger: RniChallengerAssessment,
  request: RniCitedSynthesisRequest,
): RniCitedSynthesisResult {
  const claims = new Map(input.claimInputs.map(({ claim }) => [claim.id, claim]));
  const redditStatement = platformConclusionStatement(input, request, 'reddit');
  const xStatement = platformConclusionStatement(input, request, 'x');
  const redditStatements: RniSummaryStatement[] = [redditStatement];
  const xStatements: RniSummaryStatement[] = [xStatement];
  const redditCitations = uniqueSortedCitations(redditStatements);
  const xCitations = uniqueSortedCitations(xStatements);
  const redditStatus = platformStatus(input, 'reddit');
  const xStatus = platformStatus(input, 'x');
  const combinedStatements: RniSummaryStatement[] = [];
  if (redditStatus !== 'insufficient' && xStatus !== 'insufficient') {
    const state = input.convergenceFacts.radarState;
    const text =
      state === 'aligned'
        ? 'Reddit and X cited platform conclusions align on cross-source direction.'
        : state === 'divergent'
          ? 'Reddit and X cited platform conclusions diverge on cross-source direction or magnitude.'
          : 'Reddit and X retain separate cited conclusions with a disclosed partial cross-source state.';
    combinedStatements.push({
      heading: 'Combined summary',
      origin: 'cross_source_fact',
      text,
      citationIds: sortIds([...redditCitations, ...xCitations]),
    });
  } else if (redditStatus !== 'insufficient' || xStatus !== 'insufficient') {
    const available = redditStatus !== 'insufficient' ? 'Reddit' : 'X';
    combinedStatements.push({
      heading: 'Combined summary',
      origin: 'cross_source_fact',
      text: `Cross-source synthesis is partial; the ${available} platform conclusion remains independently available.`,
      citationIds: available === 'Reddit' ? redditCitations : xCitations,
    });
  } else {
    combinedStatements.push({
      heading: 'Combined summary',
      origin: 'coverage_disclosure',
      text: 'Both platform conclusions remain insufficient for cross-source synthesis.',
      citationIds: [],
    });
  }
  for (const assessment of verification) {
    const claim = claims.get(assessment.claimId);
    if (claim === undefined) throw new Error('Verified claim disappeared during synthesis');
    if (assessment.verdict === 'supported') {
      combinedStatements.push({
        heading: 'Combined summary',
        origin: 'corroborated_catalyst',
        text: `Separate persisted social evidence corroborates the catalyst claim: “${sentenceClaimText(claim.claimText)}”`,
        citationIds: sortIds([
          ...claim.sourceCitationIds,
          ...assessment.supportingCitationIds,
        ]),
      });
    } else if (
      (assessment.verdict === 'contradicted' || assessment.verdict === 'contested') &&
      challenger.challengedClaimId === assessment.claimId
    ) {
      combinedStatements.push({
        heading: 'Combined summary',
        origin: 'challenged_catalyst',
        text: `Cited counterevidence challenges catalyst claim: “${sentenceClaimText(claim.claimText)}”`,
        citationIds: sortIds([
          ...claim.sourceCitationIds,
          ...assessment.supportingCitationIds,
          ...assessment.contradictingCitationIds,
        ]),
      });
    }
  }
  if (challenger.verdict === 'no_supported_challenge_found') {
    combinedStatements.push({
      heading: 'Combined summary',
      origin: 'coverage_disclosure',
      text: 'Challenger analysis found no supported challenge within the supplied persisted evidence.',
      citationIds: [],
    });
  }
  const combinedCitations = uniqueSortedCitations(combinedStatements);
  const combinedStatus =
    redditStatus === 'insufficient' && xStatus === 'insufficient'
      ? 'insufficient'
      : redditStatus === 'insufficient' ||
          xStatus === 'insufficient' ||
          redditStatus === 'partial' ||
          xStatus === 'partial' ||
          input.convergenceFacts.radarState === 'partial'
        ? 'partial'
        : 'complete';
  const allStatements = [redditStatement, xStatement, ...combinedStatements];
  for (const statement of allStatements) {
    if (statement.origin !== 'coverage_disclosure' && statement.citationIds.length === 0) {
      throw new Error('Every publishable synthesis statement requires a persisted citation');
    }
  }
  const summary = rniCombinedSummary.parse({
    id: request.summaryId,
    runId: input.runId,
    securityId: input.securityId,
    status: combinedStatus,
    sections: [
      {
        heading: 'Reddit sentiment',
        status: redditStatus,
        text: redditStatements.map(({ text }) => text).join(' '),
        citationIds: redditCitations,
      },
      {
        heading: 'X sentiment',
        status: xStatus,
        text: xStatements.map(({ text }) => text).join(' '),
        citationIds: xCitations,
      },
      {
        heading: 'Combined summary',
        status: combinedStatus,
        text: combinedStatements.map(({ text }) => text).join(' '),
        citationIds: combinedCitations,
      },
    ],
    createdAt: request.createdAt,
  });
  return {
    summary,
    platformConclusions: input.convergenceFacts.platforms,
    statements: allStatements,
    verification,
    challenger,
    interpretation: 'deterministic_citation_gated_no_pooled_metric',
  };
}

async function calculateFromOutputs(
  prepared: PreparedSynthesis,
  rawVerification: unknown,
  rawChallenger: unknown,
): Promise<RniCitedSynthesisArtifact> {
  const verification = validateVerification(rawVerification, prepared.modelInput);
  const challengerInput: RniChallengerModelInput = {
    ...prepared.modelInput,
    invocation: prepared.request.challengerInvocation,
    verification,
  };
  const challenger = validateChallenger(rawChallenger, challengerInput);
  const result = assembleResult(
    prepared.modelInput,
    verification,
    challenger,
    prepared.request,
  );
  return {
    calculationCodeVersion: prepared.request.codeVersion,
    policyVersion: prepared.request.policyVersion,
    inputHash: canonicalHash(prepared.request),
    verificationInputHash: canonicalHash(prepared.modelInput),
    challengerInputHash: canonicalHash(challengerInput),
    resultHash: canonicalHash(result),
    requestSnapshot: prepared.request,
    modelInputSnapshot: prepared.modelInput,
    verificationOutputSnapshot: verification,
    challengerOutputSnapshot: challenger,
    result,
  };
}

export async function synthesizeCitedNarrative(
  request: RniCitedSynthesisRequest,
  reader: RniSynthesisEvidenceReader,
  verifier: RniVerificationInferencePort,
  challenger: RniChallengerInferencePort,
): Promise<RniCitedSynthesisArtifact> {
  const prepared = await prepareSynthesis(request, reader);
  const hasEligibleClaim = prepared.modelInput.claimInputs.some(({ claim }) =>
    isPlatformReady(prepared.modelInput, claim.platform),
  );
  if (!hasEligibleClaim) {
    return calculateFromOutputs(
      prepared,
      {
        assessments: prepared.modelInput.claimInputs.map(({ claim }) => ({
          claimId: claim.id,
          verdict: 'unverified',
          supportingCitationIds: [],
          contradictingCitationIds: [],
        })),
      },
      { verdict: 'insufficient', challengedClaimId: null, citationIds: [] },
    );
  }
  const rawVerification = await verifier.verify(prepared.modelInput);
  const verification = validateVerification(rawVerification, prepared.modelInput);
  const challengerInput: RniChallengerModelInput = {
    ...prepared.modelInput,
    invocation: prepared.request.challengerInvocation,
    verification,
  };
  const hasEligibleVerdict = verification.some(({ verdict }) => verdict !== 'unverified');
  const rawChallenger = hasEligibleVerdict
    ? await challenger.challenge(challengerInput)
    : { verdict: 'insufficient', challengedClaimId: null, citationIds: [] };
  return calculateFromOutputs(prepared, rawVerification, rawChallenger);
}

export async function replayCitedSynthesis(
  artifact: RniCitedSynthesisArtifact,
  reader: RniSynthesisEvidenceReader,
): Promise<RniCitedSynthesisArtifact> {
  if (
    artifact.calculationCodeVersion !== artifact.requestSnapshot.codeVersion ||
    artifact.policyVersion !== artifact.requestSnapshot.policyVersion
  ) {
    throw new Error('RNI cited-synthesis replay lineage mismatch');
  }
  const prepared = await prepareSynthesis(artifact.requestSnapshot, reader);
  if (artifact.inputHash !== canonicalHash(prepared.request)) {
    throw new Error('RNI cited-synthesis replay input hash mismatch');
  }
  if (artifact.verificationInputHash !== canonicalHash(prepared.modelInput)) {
    throw new Error('RNI cited-synthesis replay verification-input mismatch');
  }
  if (canonicalHash(artifact.modelInputSnapshot) !== artifact.verificationInputHash) {
    throw new Error('RNI cited-synthesis replay model-input snapshot mismatch');
  }
  const replayed = await calculateFromOutputs(
    prepared,
    { assessments: artifact.verificationOutputSnapshot },
    artifact.challengerOutputSnapshot,
  );
  if (artifact.challengerInputHash !== replayed.challengerInputHash) {
    throw new Error('RNI cited-synthesis replay challenger-input mismatch');
  }
  if (artifact.resultHash !== replayed.resultHash || canonicalHash(artifact.result) !== replayed.resultHash) {
    throw new Error('RNI cited-synthesis replay result mismatch');
  }
  return replayed;
}
