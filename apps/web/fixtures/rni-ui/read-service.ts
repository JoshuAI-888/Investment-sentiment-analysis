import type {
  RniCitation,
  RniCombinedStatus,
  RniCombinedSummary,
  RniPlatformSlice,
  RniReadService,
  RniRun,
  RniRunStatus,
  RniSourceItem,
} from '@/rni/contracts';
import {
  comparativeCitation,
  comparativeSource,
  independentPlatformSlices,
  partialCombinedSummary,
  rniFixtureIds,
} from '@/rni/testing/reference-fixtures';

const FIXTURE_TIME = '2026-09-05T00:08:00.000Z';
const STALE_TIME = '2026-08-25T00:08:00.000Z';
const X_SOURCE_ID = '00000000-0000-4000-8000-000000000016';
const COMPLETE_SUMMARY_ID = '00000000-0000-4000-8000-000000000018';
const EMPTY_SUMMARY_ID = '00000000-0000-4000-8000-000000000019';
const FAILED_SUMMARY_ID = '00000000-0000-4000-8000-000000000021';
const UNPUBLISHED_SUMMARY_ID = '00000000-0000-4000-8000-000000000022';
const X_CITATION_ID = '00000000-0000-4000-8000-000000000023';
const HASH_C = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

export type RniUiFixtureState =
  | 'complete'
  | 'empty'
  | 'failed'
  | 'partial'
  | 'refreshing'
  | 'stale'
  | 'unpublished';

export type RniUiFixture = Readonly<{
  run: RniRun;
  platformSlices: readonly RniPlatformSlice[];
  summariesBySecurityId: Readonly<Record<string, RniCombinedSummary>>;
  citationsByCitationId: Readonly<Record<string, RniCitation>>;
  evidenceBySourceItemId: Readonly<Record<string, RniSourceItem>>;
}>;

export class RniFixtureNotFoundError extends Error {
  constructor(
    readonly resource: 'run' | 'security summary' | 'citation' | 'evidence',
    readonly id: string,
  ) {
    super(`RNI fixture ${resource} was not found: ${id}`);
    this.name = 'RniFixtureNotFoundError';
  }
}

function run(
  status: RniRunStatus,
  requestedAt = FIXTURE_TIME,
  completedAt: string | null = FIXTURE_TIME,
): RniRun {
  return {
    id: rniFixtureIds.run,
    idempotencyKey: 'rni-ui-fixture-run',
    trigger: 'manual',
    status,
    windowStart: '2026-09-04T00:00:00.000Z',
    windowEnd: '2026-09-05T00:00:00.000Z',
    comparisonStart: '2026-08-28T00:00:00.000Z',
    comparisonEnd: '2026-09-04T00:00:00.000Z',
    universeVersion: 'rni-universe-fixture-v1',
    configVersion: 'rni-config-fixture-v1',
    promptVersion: 'rni-prompt-fixture-v1',
    aiRoute: 'openai_direct',
    requestedAt,
    completedAt,
  };
}

function section(
  heading: 'Reddit sentiment' | 'X sentiment' | 'Combined summary',
  status: RniCombinedStatus,
  text: string,
  citationIds: readonly string[] = [],
): RniCombinedSummary['sections'][number] {
  return { heading, status, text, citationIds: [...citationIds] };
}

function summary(
  id: string,
  status: RniCombinedStatus,
  sections: RniCombinedSummary['sections'],
  createdAt = FIXTURE_TIME,
): RniCombinedSummary {
  return {
    id,
    runId: rniFixtureIds.run,
    securityId: rniFixtureIds.nvda,
    status,
    sections,
    createdAt,
  };
}

function slices(
  reddit: Partial<RniPlatformSlice>,
  x: Partial<RniPlatformSlice>,
): readonly RniPlatformSlice[] {
  return [
    { ...independentPlatformSlices[0]!, ...reddit },
    { ...independentPlatformSlices[1]!, ...x },
  ];
}

const xSource: RniSourceItem = {
  id: X_SOURCE_ID,
  platform: 'x',
  sourceKind: 'x_post',
  externalId: 'fixture-x-1',
  canonicalUrl: 'https://x.com/fixture/status/1',
  originalUrl: 'https://x.com/fixture/status/1',
  subredditOrScope: 'configured-x-fixture',
  authorHandleHash: null,
  title: null,
  boundedContent: 'NVDA demand remains strong in the observed X sample.',
  contentSha256: HASH_C,
  captureMode: 'full_post',
  publishedAt: '2026-09-05T00:01:00.000Z',
  discoveredAt: '2026-09-05T00:05:00.000Z',
  observedAt: '2026-09-05T00:05:00.000Z',
  searchQueryId: null,
  providerRequestId: 'fixture-x-search-1',
  metadata: { fixture: true },
  rightsPolicyVersion: 'rni-source-policy-v1',
  createdAt: '2026-09-05T00:05:01.000Z',
};

const xCitation: RniCitation = {
  id: X_CITATION_ID,
  sourceItemId: xSource.id,
  platform: 'x',
  url: xSource.originalUrl,
  evidenceText: 'NVDA demand remains strong',
};

const completeSummary = summary(COMPLETE_SUMMARY_ID, 'complete', [
  section(
    'Reddit sentiment',
    'complete',
    'The observed Reddit sample is bullish on NVDA execution.',
    [rniFixtureIds.redditCitation],
  ),
  section('X sentiment', 'complete', 'The observed X sample is also bullish on NVDA demand.', [
    X_CITATION_ID,
  ]),
  section(
    'Combined summary',
    'complete',
    'The sampled platforms agree on a bullish NVDA narrative.',
    [rniFixtureIds.redditCitation, X_CITATION_ID],
  ),
]);

const emptySummary = summary(EMPTY_SUMMARY_ID, 'insufficient', [
  section(
    'Reddit sentiment',
    'insufficient',
    'No usable Reddit evidence is available in this scope.',
  ),
  section('X sentiment', 'insufficient', 'No usable X evidence is available in this scope.'),
  section(
    'Combined summary',
    'insufficient',
    'No combined conclusion is published without usable source evidence.',
  ),
]);

const failedSummary = summary(FAILED_SUMMARY_ID, 'insufficient', [
  section(
    'Reddit sentiment',
    'insufficient',
    'Reddit processing failed before publishable evidence was available.',
  ),
  section(
    'X sentiment',
    'insufficient',
    'X processing failed before publishable evidence was available.',
  ),
  section(
    'Combined summary',
    'insufficient',
    'No combined conclusion is published while both source slices have failed.',
  ),
]);

const unpublishedSummary = summary(UNPUBLISHED_SUMMARY_ID, 'insufficient', [
  section(
    'Reddit sentiment',
    'insufficient',
    'Reddit evidence is not published because it does not meet the configured threshold.',
  ),
  section(
    'X sentiment',
    'insufficient',
    'X evidence is not published because it does not meet the configured threshold.',
  ),
  section(
    'Combined summary',
    'insufficient',
    'No combined conclusion is published until both platform requirements are met.',
  ),
]);

const completeSlices = slices(
  { status: 'complete' },
  {
    status: 'complete',
    eligibleSourceCount: 1,
    coverageDisclosure: 'Observed X sample from configured X queries.',
    lastAttemptAt: FIXTURE_TIME,
    lastSuccessfulRefreshAt: FIXTURE_TIME,
    dataThroughAt: '2026-09-05T00:01:00.000Z',
    computedAt: FIXTURE_TIME,
    errorCode: null,
  },
);

export const rniUiFixtureCatalogue: Readonly<Record<RniUiFixtureState, RniUiFixture>> = {
  complete: {
    run: run('complete'),
    platformSlices: completeSlices,
    summariesBySecurityId: { [rniFixtureIds.nvda]: completeSummary },
    citationsByCitationId: {
      [comparativeCitation.id]: comparativeCitation,
      [xCitation.id]: xCitation,
    },
    evidenceBySourceItemId: { [comparativeSource.id]: comparativeSource, [xSource.id]: xSource },
  },
  empty: {
    run: run('complete'),
    platformSlices: slices(
      { status: 'complete', eligibleSourceCount: 0 },
      { status: 'complete', eligibleSourceCount: 0, errorCode: null },
    ),
    summariesBySecurityId: { [rniFixtureIds.nvda]: emptySummary },
    citationsByCitationId: {},
    evidenceBySourceItemId: {},
  },
  failed: {
    run: run('failed'),
    platformSlices: slices(
      {
        status: 'failed',
        errorCode: 'REDDIT_PROVIDER_UNAVAILABLE',
        lastSuccessfulRefreshAt: null,
        dataThroughAt: null,
        computedAt: null,
      },
      { status: 'failed', errorCode: 'X_PROVIDER_UNAVAILABLE' },
    ),
    summariesBySecurityId: { [rniFixtureIds.nvda]: failedSummary },
    citationsByCitationId: {},
    evidenceBySourceItemId: {},
  },
  partial: {
    run: run('partial'),
    platformSlices: independentPlatformSlices,
    summariesBySecurityId: { [rniFixtureIds.nvda]: partialCombinedSummary },
    citationsByCitationId: { [comparativeCitation.id]: comparativeCitation },
    evidenceBySourceItemId: { [comparativeSource.id]: comparativeSource },
  },
  refreshing: {
    run: run('running', FIXTURE_TIME, null),
    platformSlices: slices(
      {
        status: 'running',
        lastSuccessfulRefreshAt: null,
        dataThroughAt: null,
        computedAt: null,
        errorCode: null,
      },
      {
        status: 'pending',
        lastAttemptAt: null,
        lastSuccessfulRefreshAt: null,
        dataThroughAt: null,
        computedAt: null,
        errorCode: null,
      },
    ),
    // The frozen contract permits synthesis only after both platform slices are terminal.
    // Consumers derive this durable in-progress state from getRun/getPlatformSlices and must not
    // request a security summary until that condition holds.
    summariesBySecurityId: {},
    citationsByCitationId: {},
    evidenceBySourceItemId: {},
  },
  stale: {
    run: run('partial', STALE_TIME, STALE_TIME),
    platformSlices: slices(
      {
        status: 'complete',
        lastAttemptAt: STALE_TIME,
        lastSuccessfulRefreshAt: STALE_TIME,
        dataThroughAt: STALE_TIME,
        computedAt: STALE_TIME,
      },
      {
        status: 'unavailable',
        lastAttemptAt: STALE_TIME,
        lastSuccessfulRefreshAt: null,
        dataThroughAt: null,
        computedAt: null,
      },
    ),
    summariesBySecurityId: {
      [rniFixtureIds.nvda]: { ...partialCombinedSummary, createdAt: STALE_TIME },
    },
    citationsByCitationId: { [comparativeCitation.id]: comparativeCitation },
    evidenceBySourceItemId: { [comparativeSource.id]: comparativeSource },
  },
  unpublished: {
    run: run('partial'),
    platformSlices: slices(
      { status: 'partial', eligibleSourceCount: 1 },
      {
        status: 'partial',
        eligibleSourceCount: 1,
        errorCode: null,
        lastSuccessfulRefreshAt: FIXTURE_TIME,
        dataThroughAt: FIXTURE_TIME,
        computedAt: FIXTURE_TIME,
      },
    ),
    summariesBySecurityId: { [rniFixtureIds.nvda]: unpublishedSummary },
    citationsByCitationId: {},
    evidenceBySourceItemId: { [comparativeSource.id]: comparativeSource, [xSource.id]: xSource },
  },
};

function copy<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Fixture-only implementation of the frozen read boundary. It deliberately exposes no
 * repository or provider APIs, so RNI pages can develop before composition is available.
 */
export class FixtureRniReadService implements RniReadService {
  constructor(private readonly fixture: RniUiFixture) {}

  async getRun(runId: string): Promise<RniRun> {
    if (runId !== this.fixture.run.id) throw new RniFixtureNotFoundError('run', runId);
    return copy(this.fixture.run);
  }

  async getPlatformSlices(runId: string): Promise<readonly RniPlatformSlice[]> {
    if (runId !== this.fixture.run.id) throw new RniFixtureNotFoundError('run', runId);
    return copy(this.fixture.platformSlices);
  }

  async getSecuritySummary(runId: string, securityId: string): Promise<RniCombinedSummary> {
    if (runId !== this.fixture.run.id) throw new RniFixtureNotFoundError('run', runId);
    const result = this.fixture.summariesBySecurityId[securityId];
    if (!result) throw new RniFixtureNotFoundError('security summary', securityId);
    return copy(result);
  }

  async getCitation(citationId: string): Promise<RniCitation> {
    const result = this.fixture.citationsByCitationId[citationId];
    if (!result) throw new RniFixtureNotFoundError('citation', citationId);
    return copy(result);
  }

  async getEvidence(sourceItemId: string): Promise<RniSourceItem> {
    const result = this.fixture.evidenceBySourceItemId[sourceItemId];
    if (!result) throw new RniFixtureNotFoundError('evidence', sourceItemId);
    return copy(result);
  }
}

export function createFixtureRniReadService(state: RniUiFixtureState = 'complete'): RniReadService {
  return new FixtureRniReadService(rniUiFixtureCatalogue[state]);
}
