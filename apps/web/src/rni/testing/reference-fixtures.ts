import type {
  RniCombinedSummary,
  RniComparativeRelation,
  RniPlatformSlice,
  RniSecurityMention,
  RniSecurityObservation,
  RniSourceCommitResult,
  RniSourceItem,
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
