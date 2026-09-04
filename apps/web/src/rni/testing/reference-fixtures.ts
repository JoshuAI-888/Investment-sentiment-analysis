import type {
  RniCitation,
  RniCombinedSummary,
  RniComparativeRelation,
  RniPlatformSlice,
  RniRadarPage,
  RniRun,
  RniSecurityDetail,
  RniSecurityMention,
  RniSecurityObservation,
  RniSourceCommitResult,
  RniSourceItem,
  RniActiveUniverse,
  RniActiveUniverseVersion,
  RniStagedUniversePreview,
  RniUniverseSearchResult,
} from '../contracts';

const hashA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const hashB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

export const rniFixtureIds = {
  run: '00000000-0000-4000-8000-000000000001',
  source: '00000000-0000-4000-8000-000000000002',
  nvda: '00000000-0000-4000-8000-000000000003',
  amd: '00000000-0000-4000-8000-000000000004',
  nvdaMention: '00000000-0000-4000-8000-000000000005',
  amdMention: '00000000-0000-4000-8000-000000000006',
  nvdaObservation: '00000000-0000-4000-8000-000000000007',
  amdObservation: '00000000-0000-4000-8000-000000000008',
  classifierRun: '00000000-0000-4000-8000-000000000009',
  relation: '00000000-0000-4000-8000-000000000010',
  redditSlice: '00000000-0000-4000-8000-000000000011',
  xSlice: '00000000-0000-4000-8000-000000000012',
  summary: '00000000-0000-4000-8000-000000000013',
  redditCitation: '00000000-0000-4000-8000-000000000014',
  searchQuery: '00000000-0000-4000-8000-000000000015',
  xCitation: '00000000-0000-4000-8000-000000000016',
  msft: '00000000-0000-4000-8000-000000000017',
  pltr: '00000000-0000-4000-8000-000000000018',
} as const;

export const comparativeSource: RniSourceItem = {
  id: rniFixtureIds.source,
  platform: 'reddit',
  sourceKind: 'post',
  externalId: 'fixture-comparison-1',
  canonicalUrl: 'https://www.reddit.com/r/stocks/comments/fixture-comparison-1/',
  originalUrl: 'https://www.reddit.com/r/stocks/comments/fixture-comparison-1/',
  subredditOrScope: 'r/stocks',
  authorHandleHash: hashB,
  title: 'Two semiconductor execution stories',
  boundedContent: 'NVDA has execution momentum; AMD is still catching up.',
  contentSha256: hashA,
  captureMode: 'full_post',
  publishedAt: '2026-09-05T00:00:00.000Z',
  discoveredAt: '2026-09-05T00:05:00.000Z',
  observedAt: '2026-09-05T00:05:00.000Z',
  searchQueryId: rniFixtureIds.searchQuery,
  providerRequestId: 'fixture-web-search-1',
  metadata: { fixture: true },
  rightsPolicyVersion: 'rni-source-policy-v1',
  createdAt: '2026-09-05T00:05:01.000Z',
};

export const comparativeCitation: RniCitation = {
  id: rniFixtureIds.redditCitation,
  sourceItemId: rniFixtureIds.source,
  platform: 'reddit',
  url: comparativeSource.originalUrl,
  evidenceText: 'NVDA has execution momentum',
};

export const comparativeSourceCommit: RniSourceCommitResult = {
  sourceItemId: rniFixtureIds.source,
  sourceInserted: true,
  retrievalInserted: true,
  contentVersionInserted: true,
};

export const comparativeSourceDuplicateCommit: RniSourceCommitResult = {
  sourceItemId: rniFixtureIds.source,
  sourceInserted: false,
  retrievalInserted: false,
  contentVersionInserted: false,
};

export const comparativeMentions: readonly RniSecurityMention[] = [
  {
    id: rniFixtureIds.nvdaMention,
    sourceItemId: rniFixtureIds.source,
    securityId: rniFixtureIds.nvda,
    mentionText: 'NVDA',
    startOffset: 0,
    endOffset: 4,
    resolutionMethod: 'exact_ticker',
    resolutionConfidence: '1',
    modelRunId: null,
  },
  {
    id: rniFixtureIds.amdMention,
    sourceItemId: rniFixtureIds.source,
    securityId: rniFixtureIds.amd,
    mentionText: 'AMD',
    startOffset: 29,
    endOffset: 32,
    resolutionMethod: 'exact_ticker',
    resolutionConfidence: '1',
    modelRunId: null,
  },
];

export const comparativeObservations: readonly RniSecurityObservation[] = [
  {
    id: rniFixtureIds.nvdaObservation,
    sourceItemId: rniFixtureIds.source,
    securityId: rniFixtureIds.nvda,
    stance: 'bullish',
    stanceScore: '0.65',
    relevance: '0.98',
    claimSummary: 'NVDA is presented as executing well.',
    timeHorizon: null,
    dimensions: [
      {
        dimension: 'company_fundamentals',
        stance: 'bullish',
        score: '0.65',
        rationale: 'Positive execution claim.',
      },
    ],
    classifierRunId: rniFixtureIds.classifierRun,
    promptVersion: 'rni-classifier-v1',
    modelId: 'fixture-model',
    inputHash: hashA,
    createdAt: '2026-09-05T00:06:00.000Z',
  },
  {
    id: rniFixtureIds.amdObservation,
    sourceItemId: rniFixtureIds.source,
    securityId: rniFixtureIds.amd,
    stance: 'bearish',
    stanceScore: '-0.45',
    relevance: '0.96',
    claimSummary: 'AMD is presented as trailing NVDA.',
    timeHorizon: null,
    dimensions: [
      {
        dimension: 'company_fundamentals',
        stance: 'bearish',
        score: '-0.45',
        rationale: 'Negative relative execution claim.',
      },
    ],
    classifierRunId: rniFixtureIds.classifierRun,
    promptVersion: 'rni-classifier-v1',
    modelId: 'fixture-model',
    inputHash: hashA,
    createdAt: '2026-09-05T00:06:00.000Z',
  },
];

export const comparativeRelation: RniComparativeRelation = {
  id: rniFixtureIds.relation,
  sourceItemId: rniFixtureIds.source,
  subjectSecurityId: rniFixtureIds.nvda,
  relation: 'preferred_over',
  objectSecurityId: rniFixtureIds.amd,
  evidenceText: comparativeSource.boundedContent,
};

export const independentPlatformSlices: readonly RniPlatformSlice[] = [
  {
    id: rniFixtureIds.redditSlice,
    runId: rniFixtureIds.run,
    platform: 'reddit',
    status: 'complete',
    eligibleSourceCount: 1,
    coverageDisclosure: 'Observed Reddit sample discovered through OpenAI Web Search.',
    lastAttemptAt: '2026-09-05T00:05:00.000Z',
    lastSuccessfulRefreshAt: '2026-09-05T00:07:00.000Z',
    dataThroughAt: '2026-09-05T00:00:00.000Z',
    computedAt: '2026-09-05T00:07:00.000Z',
    errorCode: null,
  },
  {
    id: rniFixtureIds.xSlice,
    runId: rniFixtureIds.run,
    platform: 'x',
    status: 'unavailable',
    eligibleSourceCount: 0,
    coverageDisclosure: 'Configured X sample unavailable; no fallback was used.',
    lastAttemptAt: '2026-09-05T00:05:00.000Z',
    lastSuccessfulRefreshAt: null,
    dataThroughAt: null,
    computedAt: null,
    errorCode: 'X_PROVIDER_UNAVAILABLE',
  },
];

export const partialCombinedSummary: RniCombinedSummary = {
  id: rniFixtureIds.summary,
  runId: rniFixtureIds.run,
  securityId: rniFixtureIds.nvda,
  status: 'partial',
  sections: [
    {
      heading: 'Reddit sentiment',
      status: 'complete',
      text: 'The observed Reddit sample is bullish on NVDA execution.',
      citationIds: [rniFixtureIds.redditCitation],
    },
    {
      heading: 'X sentiment',
      status: 'insufficient',
      text: 'X evidence is unavailable for this run.',
      citationIds: [],
    },
    {
      heading: 'Combined summary',
      status: 'partial',
      text: 'Only Reddit has publishable evidence; no cross-source agreement is claimed.',
      citationIds: [rniFixtureIds.redditCitation],
    },
  ],
  createdAt: '2026-09-05T00:08:00.000Z',
};

export const referenceRun: RniRun = {
  id: rniFixtureIds.run,
  idempotencyKey: 'fixture-radar-run',
  trigger: 'manual',
  status: 'partial',
  windowStart: '2026-09-04T00:00:00.000Z',
  windowEnd: '2026-09-05T00:00:00.000Z',
  comparisonStart: '2026-09-03T00:00:00.000Z',
  comparisonEnd: '2026-09-04T00:00:00.000Z',
  universeVersion: 'fixture-universe-v1',
  configVersion: 'fixture-config-v1',
  promptVersion: 'fixture-prompt-v1',
  aiRoute: 'openai_direct',
  requestedAt: '2026-09-05T00:00:00.000Z',
  completedAt: '2026-09-05T00:08:00.000Z',
};

export const referenceRadarPage: RniRadarPage = {
  run: referenceRun,
  rows: [
    {
      security: {
        id: rniFixtureIds.nvda,
        ticker: 'NVDA',
        companyName: 'NVIDIA Corporation',
        exchange: 'NASDAQ',
      },
      reddit: {
        platform: 'reddit',
        status: 'complete',
        stance: 'bullish',
        summary: 'The observed Reddit sample is bullish on NVDA execution.',
        eligibleSourceCount: 2,
        coverageDisclosure: 'Observed Reddit sample discovered through OpenAI Web Search.',
        confidence: '0.82',
        lastSuccessfulRefreshAt: '2026-09-05T00:07:00.000Z',
        dataThroughAt: '2026-09-05T00:00:00.000Z',
        computedAt: '2026-09-05T00:07:00.000Z',
        citationIds: [rniFixtureIds.redditCitation],
      },
      x: {
        platform: 'x',
        status: 'complete',
        stance: 'bearish',
        summary: 'The configured X sample is bearish on near-term valuation.',
        eligibleSourceCount: 5,
        coverageDisclosure: 'Configured X query sample; not platform-wide coverage.',
        confidence: '0.74',
        lastSuccessfulRefreshAt: '2026-09-05T00:06:00.000Z',
        dataThroughAt: '2026-09-05T00:00:00.000Z',
        computedAt: '2026-09-05T00:07:30.000Z',
        citationIds: [rniFixtureIds.xCitation],
      },
      combined: {
        state: 'divergent',
        summary: 'Reddit and X disagree; neither source result is replaced or averaged away.',
        citationIds: [rniFixtureIds.redditCitation, rniFixtureIds.xCitation],
      },
    },
    {
      security: {
        id: rniFixtureIds.amd,
        ticker: 'AMD',
        companyName: 'Advanced Micro Devices, Inc.',
        exchange: 'NASDAQ',
      },
      reddit: {
        platform: 'reddit',
        status: 'complete',
        stance: 'bearish',
        summary: 'The observed Reddit sample presents AMD as trailing NVDA.',
        eligibleSourceCount: 1,
        coverageDisclosure: 'Observed Reddit sample discovered through OpenAI Web Search.',
        confidence: '0.68',
        lastSuccessfulRefreshAt: '2026-09-05T00:07:00.000Z',
        dataThroughAt: '2026-09-05T00:00:00.000Z',
        computedAt: '2026-09-05T00:07:00.000Z',
        citationIds: [rniFixtureIds.redditCitation],
      },
      x: {
        platform: 'x',
        status: 'unavailable',
        stance: 'insufficient',
        summary: 'X evidence is unavailable for this run.',
        eligibleSourceCount: 0,
        coverageDisclosure: 'Configured X sample unavailable; no fallback was used.',
        confidence: null,
        lastSuccessfulRefreshAt: null,
        dataThroughAt: null,
        computedAt: null,
        citationIds: [],
      },
      combined: {
        state: 'partial',
        summary: 'Only Reddit has publishable evidence; no cross-source agreement is claimed.',
        citationIds: [rniFixtureIds.redditCitation],
      },
    },
  ],
  nextCursor: null,
};

const referenceActiveUniverseVersion = {
  id: '100',
  status: 'active' as const,
  parentVersion: '99',
  securityCount: 503,
  source: 'fmp_sp500_constituent' as const,
  retrievedAt: '2026-09-04T23:30:00.000Z',
  payloadSha256: hashA,
  createdAt: '2026-09-04T23:31:00.000Z',
};

export const referenceActiveUniverse: RniActiveUniverse = {
  version: referenceActiveUniverseVersion,
  defaultSecurity: referenceRadarPage.rows[0]!.security,
};

export const referenceLegacyActiveUniverseVersion: RniActiveUniverseVersion = {
  id: '98',
  status: 'active',
  parentVersion: null,
  securityCount: 100,
  source: 'legacy_seed',
  retrievedAt: null,
  payloadSha256: null,
  createdAt: '2026-09-01T00:00:00.000Z',
};

export const referenceUniverseSearchResult: RniUniverseSearchResult = {
  version: referenceActiveUniverseVersion,
  query: 'micro',
  members: [
    {
      id: rniFixtureIds.msft,
      ticker: 'MSFT',
      companyName: 'Microsoft Corporation',
      exchange: 'NASDAQ',
    },
  ],
  hasMore: false,
};

export const referenceStagedUniversePreview: RniStagedUniversePreview = {
  activeVersion: referenceActiveUniverseVersion,
  stagedVersion: {
    id: '101',
    status: 'staged',
    parentVersion: referenceActiveUniverseVersion.id,
    securityCount: 504,
    source: 'fmp_sp500_constituent',
    retrievedAt: '2026-09-05T00:30:00.000Z',
    payloadSha256: hashB,
    createdAt: '2026-09-05T00:31:00.000Z',
  },
  added: [
    {
      id: rniFixtureIds.pltr,
      ticker: 'PLTR',
      companyName: 'Palantir Technologies Inc.',
      exchange: 'NASDAQ',
    },
  ],
  removed: [],
};

export const referenceSecurityDetail: RniSecurityDetail = {
  runId: rniFixtureIds.run,
  security: referenceRadarPage.rows[0]!.security,
  reddit: {
    platform: 'reddit',
    status: 'complete',
    summary: 'The observed Reddit sample is bullish on NVDA execution.',
    citationIds: [rniFixtureIds.redditCitation],
    dimensions: [
      {
        dimension: 'company_fundamentals',
        stance: 'bullish',
        score: '0.75',
        rationale: 'Execution and product demand are viewed positively.',
        citationIds: [rniFixtureIds.redditCitation],
      },
      {
        dimension: 'market_trading',
        stance: 'bullish',
        score: '0.62',
        rationale: 'The sampled discussion expresses positive trading intent.',
        citationIds: [rniFixtureIds.redditCitation],
      },
      {
        dimension: 'catalyst_event',
        stance: 'neutral',
        score: '0.05',
        rationale: 'No dominant near-term catalyst stance appears in the sample.',
        citationIds: [rniFixtureIds.redditCitation],
      },
      {
        dimension: 'retail_narrative',
        stance: 'bullish',
        score: '0.70',
        rationale: 'The sampled narrative emphasizes continued execution momentum.',
        citationIds: [rniFixtureIds.redditCitation],
      },
    ],
    eligibleSourceCount: 2,
    coverageDisclosure: 'Observed Reddit sample discovered through OpenAI Web Search.',
    confidence: '0.82',
    lastSuccessfulRefreshAt: '2026-09-05T00:07:00.000Z',
    dataThroughAt: '2026-09-05T00:00:00.000Z',
    computedAt: '2026-09-05T00:07:00.000Z',
  },
  x: {
    platform: 'x',
    status: 'complete',
    summary: 'The configured X sample is bearish on near-term valuation.',
    citationIds: [rniFixtureIds.xCitation],
    dimensions: [
      {
        dimension: 'company_fundamentals',
        stance: 'neutral',
        score: '0.08',
        rationale: 'The sample does not take a clear stance on business fundamentals.',
        citationIds: [rniFixtureIds.xCitation],
      },
      {
        dimension: 'market_trading',
        stance: 'bearish',
        score: '-0.68',
        rationale: 'The sampled discussion expresses valuation and near-term trading concern.',
        citationIds: [rniFixtureIds.xCitation],
      },
      {
        dimension: 'catalyst_event',
        stance: 'neutral',
        score: '0',
        rationale: 'No dominant catalyst stance appears in the configured sample.',
        citationIds: [rniFixtureIds.xCitation],
      },
      {
        dimension: 'retail_narrative',
        stance: 'bearish',
        score: '-0.58',
        rationale: 'The configured sample emphasizes valuation pressure.',
        citationIds: [rniFixtureIds.xCitation],
      },
    ],
    eligibleSourceCount: 5,
    coverageDisclosure: 'Configured X query sample; not platform-wide coverage.',
    confidence: '0.74',
    lastSuccessfulRefreshAt: '2026-09-05T00:06:00.000Z',
    dataThroughAt: '2026-09-05T00:00:00.000Z',
    computedAt: '2026-09-05T00:07:30.000Z',
  },
};
