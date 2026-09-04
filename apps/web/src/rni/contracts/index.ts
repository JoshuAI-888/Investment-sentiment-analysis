import { z } from 'zod';

export const RNI_UNIVERSE_MAX_SYMBOLS = 600;

export const rniPlatform = z.enum(['reddit', 'x']);
export type RniPlatform = z.infer<typeof rniPlatform>;

export const rniSourceKind = z.enum(['post', 'comment', 'x_post']);
export type RniSourceKind = z.infer<typeof rniSourceKind>;

export const rniCaptureMode = z.enum(['full_post', 'full_comment', 'excerpt_only']);
export type RniCaptureMode = z.infer<typeof rniCaptureMode>;

export const rniStance = z.enum([
  'strong_bearish',
  'bearish',
  'neutral',
  'bullish',
  'strong_bullish',
  'insufficient',
]);
export type RniStance = z.infer<typeof rniStance>;

export const rniSliceStatus = z.enum([
  'pending',
  'running',
  'complete',
  'partial',
  'failed',
  'unavailable',
]);
export type RniSliceStatus = z.infer<typeof rniSliceStatus>;

export const rniRunStatus = z.enum([
  'requested',
  'running',
  'complete',
  'partial',
  'failed',
  'cancelled',
]);
export type RniRunStatus = z.infer<typeof rniRunStatus>;

export const rniRunTrigger = z.enum(['schedule', 'manual', 'api']);
export type RniRunTrigger = z.infer<typeof rniRunTrigger>;

export const rniAiRoute = z.enum(['openai_direct', 'vercel_ai_gateway']);
export type RniAiRoute = z.infer<typeof rniAiRoute>;

export const rniDimensionKey = z.enum([
  'company_fundamentals',
  'market_trading',
  'catalyst_event',
  'retail_narrative',
]);
export type RniDimensionKey = z.infer<typeof rniDimensionKey>;

export const rniCombinedStatus = z.enum(['complete', 'partial', 'insufficient']);
export type RniCombinedStatus = z.infer<typeof rniCombinedStatus>;

export const rniErrorCode = z.enum([
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'INVALID_REQUEST',
  'RUN_NOT_FOUND',
  'SOURCE_NOT_FOUND',
  'SOURCE_NOT_PERSISTED',
  'CITATION_INVALID',
  'PROVIDER_UNAVAILABLE',
  'BUDGET_EXHAUSTED',
  'UNIVERSE_SYNC_INVALID',
  'CONFLICT',
]);
export type RniErrorCode = z.infer<typeof rniErrorCode>;

export const rniIsoTimestamp = z.string().datetime({ offset: true });
export const rniSha256 = z.string().regex(/^[a-f0-9]{64}$/u);
export const rniUnitDecimal = z.string().regex(/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/u);
export const rniSignedDecimal = z.string().regex(/^-?(?:0(?:\.\d+)?|1(?:\.0+)?)$/u);

export const rniSourceItem = z
  .object({
    id: z.string().uuid(),
    platform: rniPlatform,
    sourceKind: rniSourceKind,
    externalId: z.string().min(1).nullable(),
    canonicalUrl: z.string().url(),
    originalUrl: z.string().url(),
    subredditOrScope: z.string().min(1),
    authorHandleHash: rniSha256.nullable(),
    title: z.string().max(600).nullable(),
    boundedContent: z.string().min(1).max(20_000),
    contentSha256: rniSha256,
    captureMode: rniCaptureMode,
    publishedAt: rniIsoTimestamp.nullable(),
    discoveredAt: rniIsoTimestamp,
    observedAt: rniIsoTimestamp,
    searchQueryId: z.string().uuid().nullable(),
    providerRequestId: z.string().min(1).nullable(),
    metadata: z.record(z.unknown()),
    rightsPolicyVersion: z.string().min(1),
    createdAt: rniIsoTimestamp,
  })
  .strict()
  .superRefine((source, context) => {
    if (/<!doctype\s+html|<html(?:\s|>)/iu.test(source.boundedContent)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['boundedContent'],
        message: 'Whole-page HTML is not valid bounded evidence',
      });
    }
    if (source.platform === 'x' && source.sourceKind !== 'x_post') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceKind'],
        message: 'X sources must use x_post',
      });
    }
    if (source.platform === 'reddit' && source.sourceKind === 'x_post') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceKind'],
        message: 'Reddit sources cannot use x_post',
      });
    }
  });
export type RniSourceItem = z.infer<typeof rniSourceItem>;

export const rniSourceCommitResult = z
  .object({
    sourceItemId: z.string().uuid(),
    sourceInserted: z.boolean(),
    retrievalInserted: z.boolean(),
    contentVersionInserted: z.boolean(),
  })
  .strict();
export type RniSourceCommitResult = z.infer<typeof rniSourceCommitResult>;

/**
 * The DATA implementation resolves only after its source/retrieval/content transaction commits.
 * ENGINE must not enqueue interpretation from the caller-proposed `source.id`; it may use only
 * the committed identity returned here. A duplicate returns the existing durable identity and
 * explicit false flags rather than masquerading as a new write.
 */
export interface RniSourcePersistencePort {
  commitSource(source: RniSourceItem): Promise<RniSourceCommitResult>;
}

export const rniSecurityMention = z
  .object({
    id: z.string().uuid(),
    sourceItemId: z.string().uuid(),
    securityId: z.string().uuid(),
    mentionText: z.string().min(1),
    startOffset: z.number().int().nonnegative().nullable(),
    endOffset: z.number().int().positive().nullable(),
    resolutionMethod: z.enum(['exact_ticker', 'company_alias', 'model_assisted', 'human_review']),
    resolutionConfidence: rniUnitDecimal,
    modelRunId: z.string().uuid().nullable(),
  })
  .strict()
  .refine(
    (mention) =>
      mention.startOffset === null ||
      mention.endOffset === null ||
      mention.endOffset > mention.startOffset,
    { message: 'endOffset must be greater than startOffset', path: ['endOffset'] },
  );
export type RniSecurityMention = z.infer<typeof rniSecurityMention>;

export const rniDimensionAssignment = z
  .object({
    dimension: rniDimensionKey,
    stance: rniStance,
    score: rniSignedDecimal.nullable(),
    rationale: z.string().min(1),
  })
  .strict();
export type RniDimensionAssignment = z.infer<typeof rniDimensionAssignment>;

export const rniSecurityObservation = z
  .object({
    id: z.string().uuid(),
    sourceItemId: z.string().uuid(),
    securityId: z.string().uuid(),
    stance: rniStance,
    stanceScore: rniSignedDecimal.nullable(),
    relevance: rniUnitDecimal,
    claimSummary: z.string().min(1).max(2_000),
    timeHorizon: z.string().max(100).nullable(),
    dimensions: z.array(rniDimensionAssignment).min(1),
    classifierRunId: z.string().uuid(),
    promptVersion: z.string().min(1),
    modelId: z.string().min(1),
    inputHash: rniSha256,
    createdAt: rniIsoTimestamp,
  })
  .strict();
export type RniSecurityObservation = z.infer<typeof rniSecurityObservation>;

export const rniComparativeRelation = z
  .object({
    id: z.string().uuid(),
    sourceItemId: z.string().uuid(),
    subjectSecurityId: z.string().uuid(),
    relation: z.enum(['preferred_over', 'less_preferred_than', 'similar_to', 'contrasts_with']),
    objectSecurityId: z.string().uuid(),
    evidenceText: z.string().min(1).max(2_000),
  })
  .strict()
  .refine((relation) => relation.subjectSecurityId !== relation.objectSecurityId, {
    message: 'A comparative relation requires two securities',
    path: ['objectSecurityId'],
  });
export type RniComparativeRelation = z.infer<typeof rniComparativeRelation>;

export const rniPlatformSlice = z
  .object({
    id: z.string().uuid(),
    runId: z.string().uuid(),
    platform: rniPlatform,
    status: rniSliceStatus,
    eligibleSourceCount: z.number().int().nonnegative(),
    coverageDisclosure: z.string().min(1),
    lastAttemptAt: rniIsoTimestamp.nullable(),
    lastSuccessfulRefreshAt: rniIsoTimestamp.nullable(),
    dataThroughAt: rniIsoTimestamp.nullable(),
    computedAt: rniIsoTimestamp.nullable(),
    errorCode: z.string().min(1).nullable(),
  })
  .strict();
export type RniPlatformSlice = z.infer<typeof rniPlatformSlice>;

export const rniRun = z
  .object({
    id: z.string().uuid(),
    idempotencyKey: z.string().min(1),
    trigger: rniRunTrigger,
    status: rniRunStatus,
    windowStart: rniIsoTimestamp,
    windowEnd: rniIsoTimestamp,
    comparisonStart: rniIsoTimestamp.nullable(),
    comparisonEnd: rniIsoTimestamp.nullable(),
    universeVersion: z.string().min(1),
    configVersion: z.string().min(1),
    promptVersion: z.string().min(1),
    aiRoute: rniAiRoute.default('openai_direct'),
    requestedAt: rniIsoTimestamp,
    completedAt: rniIsoTimestamp.nullable(),
  })
  .strict()
  .refine((run) => new Date(run.windowEnd) > new Date(run.windowStart), {
    message: 'windowEnd must be after windowStart',
    path: ['windowEnd'],
  });
export type RniRun = z.infer<typeof rniRun>;

export const rniRunRequest = z
  .object({
    idempotencyKey: z.string().min(1),
    trigger: rniRunTrigger,
    ticker: z.string().regex(/^[A-Z][A-Z0-9.-]{0,9}$/u),
    windowStart: rniIsoTimestamp,
    windowEnd: rniIsoTimestamp,
    comparisonStart: rniIsoTimestamp.nullable(),
    comparisonEnd: rniIsoTimestamp.nullable(),
    aiRoute: rniAiRoute.default('openai_direct'),
  })
  .strict()
  .refine((request) => new Date(request.windowEnd) > new Date(request.windowStart), {
    message: 'windowEnd must be after windowStart',
    path: ['windowEnd'],
  });
export type RniRunRequest = z.infer<typeof rniRunRequest>;

export const rniUniverseMemberCandidate = z
  .object({
    ticker: z.string().regex(/^[A-Z][A-Z0-9.-]{0,9}$/u),
    companyName: z.string().min(1),
    exchange: z.string().min(1),
    fmpSymbol: z.string().min(1),
  })
  .strict();

export const rniUniverseSnapshotCandidate = z
  .object({
    source: z.literal('fmp_sp500_constituent'),
    retrievedAt: rniIsoTimestamp,
    payloadSha256: rniSha256,
    members: z.array(rniUniverseMemberCandidate).min(1).max(RNI_UNIVERSE_MAX_SYMBOLS),
  })
  .strict()
  .refine((snapshot) => snapshot.members.some((member) => member.ticker === 'NVDA'), {
    message: 'The S&P 500 candidate must contain NVDA',
    path: ['members'],
  });
export type RniUniverseSnapshotCandidate = z.infer<typeof rniUniverseSnapshotCandidate>;

export const rniErrorEnvelope = z
  .object({
    error: z
      .object({
        code: rniErrorCode,
        message: z.string().min(1),
        retryable: z.boolean(),
        requestId: z.string().min(1),
        details: z.record(z.unknown()).optional(),
      })
      .strict(),
  })
  .strict();
export type RniErrorEnvelope = z.infer<typeof rniErrorEnvelope>;

export const rniCitation = z
  .object({
    id: z.string().uuid(),
    sourceItemId: z.string().uuid(),
    platform: rniPlatform,
    url: z.string().url(),
    evidenceText: z.string().min(1).max(2_000),
  })
  .strict();
export type RniCitation = z.infer<typeof rniCitation>;

export const rniSummarySection = z
  .object({
    heading: z.enum(['Reddit sentiment', 'X sentiment', 'Combined summary']),
    status: rniCombinedStatus,
    text: z.string().min(1),
    citationIds: z.array(z.string().uuid()),
  })
  .strict();

export const rniCombinedSummary = z
  .object({
    id: z.string().uuid(),
    runId: z.string().uuid(),
    securityId: z.string().uuid(),
    status: rniCombinedStatus,
    sections: z.array(rniSummarySection).length(3),
    createdAt: rniIsoTimestamp,
  })
  .strict()
  .refine(
    (summary) =>
      new Set(summary.sections.map((section) => section.heading)).size === 3 &&
      ['Reddit sentiment', 'X sentiment', 'Combined summary'].every((heading) =>
        summary.sections.some((section) => section.heading === heading),
      ),
    { message: 'All three distinct summary sections are required', path: ['sections'] },
  );
export type RniCombinedSummary = z.infer<typeof rniCombinedSummary>;

export const rniRadarQuery = z
  .object({
    runId: z.string().uuid(),
    cursor: z.string().min(1).nullable().optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export type RniRadarQuery = z.input<typeof rniRadarQuery>;

export const rniRadarSecurity = z
  .object({
    id: z.string().uuid(),
    ticker: z.string().regex(/^[A-Z][A-Z0-9.-]{0,9}$/u),
    companyName: z.string().min(1),
    exchange: z.string().min(1),
  })
  .strict();
export type RniRadarSecurity = z.infer<typeof rniRadarSecurity>;

export const rniRadarPlatformCell = z
  .object({
    platform: rniPlatform,
    status: rniSliceStatus,
    stance: rniStance,
    summary: z.string().min(1),
    eligibleSourceCount: z.number().int().nonnegative(),
    coverageDisclosure: z.string().min(1),
    confidence: rniUnitDecimal.nullable(),
    lastSuccessfulRefreshAt: rniIsoTimestamp.nullable(),
    dataThroughAt: rniIsoTimestamp.nullable(),
    computedAt: rniIsoTimestamp.nullable(),
    citationIds: z.array(z.string().uuid()),
  })
  .strict()
  .superRefine((cell, context) => {
    if (
      ['pending', 'running', 'failed', 'unavailable'].includes(cell.status) &&
      cell.stance !== 'insufficient'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stance'],
        message: 'A non-publishable platform state must remain insufficient, never neutral',
      });
    }
  });
export type RniRadarPlatformCell = z.infer<typeof rniRadarPlatformCell>;

export const rniRadarCombinedState = z.enum([
  'pending',
  'aligned',
  'divergent',
  'partial',
  'insufficient',
]);
export type RniRadarCombinedState = z.infer<typeof rniRadarCombinedState>;

export const rniRadarCombinedCell = z
  .object({
    state: rniRadarCombinedState,
    summary: z.string().min(1),
    citationIds: z.array(z.string().uuid()),
  })
  .strict();
export type RniRadarCombinedCell = z.infer<typeof rniRadarCombinedCell>;

export const rniRadarRow = z
  .object({
    security: rniRadarSecurity,
    reddit: rniRadarPlatformCell,
    x: rniRadarPlatformCell,
    combined: rniRadarCombinedCell,
  })
  .strict()
  .superRefine((row, context) => {
    if (row.reddit.platform !== 'reddit') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reddit', 'platform'],
        message: 'The Reddit cell must contain only Reddit results',
      });
    }
    if (row.x.platform !== 'x') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['x', 'platform'],
        message: 'The X cell must contain only X results',
      });
    }

    const nonTerminal = new Set<RniSliceStatus>(['pending', 'running']);
    const missing = new Set<RniSliceStatus>(['failed', 'unavailable']);
    const hasNonTerminal = nonTerminal.has(row.reddit.status) || nonTerminal.has(row.x.status);
    const hasMissing = missing.has(row.reddit.status) || missing.has(row.x.status);
    const hasInsufficientPlatform =
      row.reddit.stance === 'insufficient' || row.x.stance === 'insufficient';
    if (hasNonTerminal && row.combined.state !== 'pending') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['combined', 'state'],
        message: 'Cross-source synthesis remains pending until both platform cells are terminal',
      });
    }
    if (!hasNonTerminal && row.combined.state === 'pending') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['combined', 'state'],
        message: 'A terminal pair cannot remain in the pending cross-source state',
      });
    }
    if (hasMissing && (row.combined.state === 'aligned' || row.combined.state === 'divergent')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['combined', 'state'],
        message: 'A missing platform cannot produce aligned or divergent cross-source synthesis',
      });
    }
    if (
      hasInsufficientPlatform &&
      (row.combined.state === 'aligned' || row.combined.state === 'divergent')
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['combined', 'state'],
        message: 'An insufficient platform cannot produce aligned or divergent synthesis',
      });
    }
  });
export type RniRadarRow = z.infer<typeof rniRadarRow>;

export const rniRadarPage = z
  .object({
    run: rniRun,
    rows: z.array(rniRadarRow).max(100),
    nextCursor: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((page, context) => {
    const securityIds = page.rows.map((row) => row.security.id);
    if (new Set(securityIds).size !== securityIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rows'],
        message: 'A Radar page cannot repeat a security',
      });
    }
  });
export type RniRadarPage = z.infer<typeof rniRadarPage>;

export interface RniReadService {
  getRadarPage(query: RniRadarQuery): Promise<RniRadarPage>;
  getRun(runId: string): Promise<RniRun>;
  getPlatformSlices(runId: string): Promise<readonly RniPlatformSlice[]>;
  getSecuritySummary(runId: string, securityId: string): Promise<RniCombinedSummary>;
  getCitation(citationId: string): Promise<RniCitation>;
  getEvidence(sourceItemId: string): Promise<RniSourceItem>;
}
