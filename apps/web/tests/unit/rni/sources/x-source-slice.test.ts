import { describe, expect, it, vi } from 'vitest';
import type { XPost } from '@/adapters/x';
import type { ProviderError, ProviderMeta, ProviderResult } from '@/contracts/provider';
import {
  createExistingXAdapterPort,
  runXSourceSlice,
} from '@/rni/sources';
import type {
  ExistingXAdapterPortOptions,
  XAdapterPort,
  XSourceSliceRequest,
} from '@/rni/sources';

const runId = '00000000-0000-4000-8000-000000000201';
const sliceId = '00000000-0000-4000-8000-000000000202';
const firstQueryId = '00000000-0000-4000-8000-000000000203';
const secondQueryId = '00000000-0000-4000-8000-000000000204';
const attemptedAt = '2026-09-05T01:30:00.000Z';

const request: XSourceSliceRequest = {
  runId,
  sliceId,
  windowStart: '2026-09-04T00:00:00.000Z',
  windowEnd: '2026-09-05T00:00:00.000Z',
  queries: [
    {
      queryId: firstQueryId,
      query: '$NVDA -is:retweet lang:en',
      scope: 'configured-semiconductors',
      maxResults: 20,
    },
  ],
};

const meta: ProviderMeta = {
  provider: 'x',
  endpoint: 'search_recent',
  requestedAt: '2026-09-05T01:29:59.000Z',
  latencyMs: 41,
  cache: 'miss',
  quotaRemaining: 980,
  costUsd: '0.005',
  payloadRef: 'fixture:x:search_recent:success',
};

const metrics = {
  retweetCount: 3,
  replyCount: 1,
  likeCount: 12,
  quoteCount: 0,
  bookmarkCount: 2,
  impressionCount: 480,
};

function post(overrides: Partial<XPost> = {}): XPost {
  return {
    id: '1900000000000000001',
    text: '$NVDA execution remains the focus.',
    authorId: '1000000000000000001',
    authorUsername: 'Example_Trader',
    createdAt: request.windowStart,
    lang: 'en',
    metrics,
    ...overrides,
  };
}

function success(
  data: XPost[],
  metaOverrides: Partial<ProviderMeta> = {},
): ProviderResult<XPost[]> {
  return { ok: true, data, meta: { ...meta, ...metaOverrides } };
}

function failure(error: ProviderError): ProviderResult<XPost[]> {
  return { ok: false, error, meta: { ...meta, costUsd: null } };
}

function port(results: readonly (ProviderResult<XPost[]> | Error)[]): XAdapterPort {
  let index = 0;
  return {
    async search() {
      const result = results[index++];
      if (result === undefined) throw new Error('Missing fake X result');
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

const clock = { now: () => new Date(attemptedAt) };

describe('existing X adapter composition port', () => {
  it('passes only the configured X request and adapter settings to the existing adapter', async () => {
    const adapter = vi.fn(async () => success([post()]));
    const deps = {} as ExistingXAdapterPortOptions['deps'];
    const configuredPort = createExistingXAdapterPort(
      {
        providerMode: 'live',
        bearerToken: 'secret-token',
        cacheTtlMs: 5_000,
        deps,
      },
      adapter,
    );

    await configuredPort.search({ query: '$NVDA lang:en', maxResults: 20 });

    expect(adapter).toHaveBeenCalledWith(
      {
        query: '$NVDA lang:en',
        maxResults: 20,
        bearerToken: 'secret-token',
        cacheTtlMs: 5_000,
      },
      'live',
      deps,
    );
  });

  it('rejects live composition without a bearer token before any adapter call', () => {
    const adapter = vi.fn(async () => success([]));
    expect(() =>
      createExistingXAdapterPort(
        { providerMode: 'live', deps: {} as ExistingXAdapterPortOptions['deps'] },
        adapter,
      ),
    ).toThrow(/bearerToken is required in live mode/u);
    expect(adapter).not.toHaveBeenCalled();
  });
});

describe('independent X terminal source slice', () => {
  it('normalizes in-window posts and treats the interval as start-inclusive and end-exclusive', async () => {
    const beforeStart = post({
      id: '1900000000000000000',
      createdAt: '2026-09-03T23:59:59.999Z',
    });
    const atEnd = post({ id: '1900000000000000002', createdAt: request.windowEnd });
    const result = await runXSourceSlice(
      request,
      port([success([beforeStart, post(), atEnd])]),
      clock,
    );

    expect(result.slice).toMatchObject({
      platform: 'x',
      status: 'complete',
      eligibleSourceCount: 1,
      lastAttemptAt: attemptedAt,
      lastSuccessfulRefreshAt: attemptedAt,
      dataThroughAt: request.windowStart,
      errorCode: null,
    });
    expect(result.candidates[0]).toMatchObject({
      externalId: '1900000000000000001',
      canonicalUrl: 'https://x.com/i/web/status/1900000000000000001',
      originalUrl: 'https://x.com/i/web/status/1900000000000000001',
      sourceKind: 'x_post',
      subredditOrScope: 'configured-semiconductors',
      captureMode: 'full_post',
      publicationTimeVerified: true,
      primaryQueryId: firstQueryId,
      matchedQueryIds: [firstQueryId],
    });
    expect(result.candidates[0]?.contentSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.candidates[0]?.authorHandleHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.rejectedPosts).toEqual([
      { queryId: firstQueryId, externalId: beforeStart.id, reason: 'OUTSIDE_WINDOW' },
      { queryId: firstQueryId, externalId: atEnd.id, reason: 'OUTSIDE_WINDOW' },
    ]);
    expect(result.slice.computedAt).toBeNull();
  });

  it('marks missing timestamps partial and excludes them from interpretation', async () => {
    const result = await runXSourceSlice(
      request,
      port([success([post({ createdAt: null })])]),
      clock,
    );

    expect(result.slice).toMatchObject({ status: 'partial', eligibleSourceCount: 0 });
    expect(result.rejectedPosts[0]?.reason).toBe('PUBLISHED_AT_MISSING');
  });

  it('records an honest zero-result adapter success without claiming platform completeness', async () => {
    const result = await runXSourceSlice(request, port([success([])]), clock);

    expect(result.slice).toMatchObject({
      status: 'complete',
      eligibleSourceCount: 0,
      lastSuccessfulRefreshAt: attemptedAt,
      dataThroughAt: null,
    });
    expect(result.slice.coverageDisclosure).toContain('no eligible in-window posts');
    expect(result.slice.coverageDisclosure).toContain('no platform-wide completeness');
  });

  it('keeps usable results when another configured X query fails and marks only X partial', async () => {
    const twoQueries = {
      ...request,
      queries: [
        ...request.queries,
        {
          queryId: secondQueryId,
          query: '$AMD -is:retweet lang:en',
          scope: 'configured-semiconductors',
        },
      ],
    };
    const result = await runXSourceSlice(
      twoQueries,
      port([success([post()]), failure({ kind: 'upstream', status: 503 })]),
      clock,
    );

    expect(result.slice).toMatchObject({
      platform: 'x',
      status: 'partial',
      eligibleSourceCount: 1,
      errorCode: 'X_SOURCE_PARTIAL',
    });
    expect(result.queryTraces.map(({ errorKind }) => errorKind)).toEqual([null, 'upstream']);
  });

  it('maps terminal entitlement failures to unavailable without a Reddit fallback', async () => {
    const result = await runXSourceSlice(
      request,
      port([failure({ kind: 'entitlement', endpoint: 'search_recent', status: 403 })]),
      clock,
    );

    expect(result.slice).toMatchObject({
      platform: 'x',
      status: 'unavailable',
      eligibleSourceCount: 0,
      lastSuccessfulRefreshAt: null,
      errorCode: 'X_PROVIDER_UNAVAILABLE',
    });
    expect(result.slice.coverageDisclosure).toContain('no Reddit fallback');
    expect(result.candidates).toEqual([]);
  });

  it('maps all non-dispatchable provider conditions to unavailable', async () => {
    const errors: ProviderError[] = [
      { kind: 'quota', resetAt: null },
      { kind: 'budget_denied', scope: 'account' },
      { kind: 'circuit_open', openedAt: '2026-09-05T01:00:00.000Z' },
    ];

    for (const error of errors) {
      const result = await runXSourceSlice(request, port([failure(error)]), clock);
      expect(result.slice.status).toBe('unavailable');
      expect(result.queryTraces[0]?.errorKind).toBe(error.kind);
    }
  });

  it('maps transient failures and unexpected throws to failed terminal traces', async () => {
    const upstream = await runXSourceSlice(
      request,
      port([failure({ kind: 'upstream', status: 503 })]),
      clock,
    );
    expect(upstream.slice.status).toBe('failed');
    expect(upstream.queryTraces[0]?.errorKind).toBe('upstream');

    const thrown = await runXSourceSlice(request, port([new Error('boom')]), clock);
    expect(thrown.slice.status).toBe('failed');
    expect(thrown.queryTraces[0]?.errorKind).toBe('unexpected_throw');
  });

  it('maps mixed terminal provider failures to failed rather than unavailable', async () => {
    const twoQueries = {
      ...request,
      queries: [
        ...request.queries,
        {
          queryId: secondQueryId,
          query: '$AMD -is:retweet lang:en',
          scope: 'configured-semiconductors',
        },
      ],
    };
    const result = await runXSourceSlice(
      twoQueries,
      port([
        failure({ kind: 'entitlement', endpoint: 'search_recent', status: 403 }),
        failure({ kind: 'upstream', status: 503 }),
      ]),
      clock,
    );

    expect(result.slice.status).toBe('failed');
    expect(result.queryTraces.map(({ errorKind }) => errorKind)).toEqual([
      'entitlement',
      'upstream',
    ]);
  });

  it('deduplicates the same post across configured queries and preserves query lineage', async () => {
    const twoQueries = {
      ...request,
      queries: [
        ...request.queries,
        {
          queryId: secondQueryId,
          query: 'NVIDIA lang:en',
          scope: 'configured-company-watch',
        },
      ],
    };
    const result = await runXSourceSlice(
      twoQueries,
      port([
        success([post()]),
        success(
          [post({ id: 'outside', createdAt: request.windowEnd }), post()],
          { payloadRef: 'fixture:x:search_recent:second-query' },
        ),
      ]),
      clock,
    );

    expect(result.slice.status).toBe('complete');
    expect(result.candidates).toHaveLength(1);
    expect(result.duplicatePostCount).toBe(1);
    expect(result.candidates[0]?.matchedQueryIds).toEqual([firstQueryId, secondQueryId]);
    expect(
      result.candidates[0]?.retrievals.map(({ queryId, rank, providerMeta }) => ({
        queryId,
        rank,
        payloadRef: providerMeta.payloadRef,
      })),
    ).toEqual([
      { queryId: firstQueryId, rank: 1, payloadRef: meta.payloadRef },
      {
        queryId: secondQueryId,
        rank: 2,
        payloadRef: 'fixture:x:search_recent:second-query',
      },
    ]);
  });

  it('preserves changed bytes for the same post as a linked content version', async () => {
    const twoQueries = {
      ...request,
      queries: [
        ...request.queries,
        {
          queryId: secondQueryId,
          query: 'NVIDIA lang:en',
          scope: 'configured-company-watch',
        },
      ],
    };
    const result = await runXSourceSlice(
      twoQueries,
      port([success([post()]), success([post({ text: '$NVDA edited source bytes.' })])]),
      clock,
    );

    expect(result.candidates).toHaveLength(2);
    expect(result.slice.eligibleSourceCount).toBe(1);
    expect(result.changedContentVersionCount).toBe(1);
    expect(result.candidates[1]?.previousContentSha256).toBe(
      result.candidates[0]?.contentSha256,
    );
    expect(result.candidates[1]?.contentSha256).not.toBe(
      result.candidates[0]?.contentSha256,
    );
  });

  it('upserts mutable metadata on same-content rediscovery and retains each snapshot', async () => {
    const twoQueries = {
      ...request,
      queries: [
        ...request.queries,
        {
          queryId: secondQueryId,
          query: 'NVIDIA lang:en',
          scope: 'configured-company-watch',
        },
      ],
    };
    const initialMetrics = { ...metrics, likeCount: 1 };
    const updatedMetrics = { ...metrics, likeCount: 99 };
    const result = await runXSourceSlice(
      twoQueries,
      port([
        success([post({ authorUsername: null, lang: null, metrics: initialMetrics })]),
        success([post({ authorUsername: 'Known_Trader', lang: 'en', metrics: updatedMetrics })]),
      ]),
      clock,
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      subredditOrScope: 'configured-company-watch',
      lang: 'en',
      metrics: updatedMetrics,
    });
    expect(result.candidates[0]?.authorHandleHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      result.candidates[0]?.retrievals.map(({ sourceMetadata }) => ({
        authorHandleHash: sourceMetadata.authorHandleHash,
        lang: sourceMetadata.lang,
        likeCount: sourceMetadata.metrics.likeCount,
      })),
    ).toEqual([
      { authorHandleHash: null, lang: null, likeCount: 1 },
      {
        authorHandleHash: result.candidates[0]?.authorHandleHash,
        lang: 'en',
        likeCount: 99,
      },
    ]);
    expect(result.candidates[0]?.retrievals[0]?.sourceMetadata.contentSha256).toBe(
      result.candidates[0]?.contentSha256,
    );
  });

  it('rejects invalid windows before invoking the adapter', async () => {
    const search = vi.fn(async () => success([]));
    await expect(
      runXSourceSlice({ ...request, windowEnd: request.windowStart }, { search }, clock),
    ).rejects.toThrow(/windowEnd must be after windowStart/u);
    expect(search).not.toHaveBeenCalled();
  });
});
