import { describe, expect, it } from 'vitest';
import type { XPost } from '@/adapters/x';
import type { ProviderResult } from '@/contracts/provider';
import { rniPlatformSlice, rniSourceItem } from '@/rni/contracts';
import { runXSourceSlice } from '@/rni/sources';
import type { XAdapterPort } from '@/rni/sources';

const runId = '00000000-0000-4000-8000-000000000301';
const sliceId = '00000000-0000-4000-8000-000000000302';
const queryId = '00000000-0000-4000-8000-000000000303';
const observedAt = '2026-09-05T01:30:00.000Z';
const providerMeta = {
  provider: 'x' as const,
  endpoint: 'search_recent',
  requestedAt: '2026-09-05T01:29:59.000Z',
  latencyMs: 41,
  cache: 'miss' as const,
  quotaRemaining: 980,
  costUsd: '0.005',
  payloadRef: 'fixture:x:search_recent:success',
};
const request = {
  runId,
  sliceId,
  windowStart: '2026-09-04T00:00:00.000Z',
  windowEnd: '2026-09-05T00:00:00.000Z',
  queries: [
    {
      queryId,
      query: '$NVDA -is:retweet lang:en',
      scope: 'configured-semiconductors',
    },
  ],
};
const xPost: XPost = {
  id: '1900000000000000001',
  text: '$NVDA execution remains the focus.',
  authorId: '1000000000000000001',
  authorUsername: 'example_trader',
  createdAt: '2026-09-04T12:00:00.000Z',
  lang: 'en',
  metrics: {
    retweetCount: 3,
    replyCount: 1,
    likeCount: 12,
    quoteCount: 0,
    bookmarkCount: 2,
    impressionCount: 480,
  },
};
const clock = { now: () => new Date(observedAt) };

function port(result: ProviderResult<XPost[]>): XAdapterPort {
  return { search: async () => result };
}

describe('RNI E02 X source-slice frozen contracts', () => {
  it('maps an existing-adapter success into valid X slice and source shapes', async () => {
    const result = await runXSourceSlice(
      request,
      port({ ok: true, data: [xPost], meta: providerMeta }),
      clock,
    );
    const candidate = result.candidates[0];
    expect(candidate).toBeDefined();

    const slice = rniPlatformSlice.parse(result.slice);
    const source = rniSourceItem.parse({
      id: '00000000-0000-4000-8000-000000000304',
      platform: 'x',
      sourceKind: candidate!.sourceKind,
      externalId: candidate!.externalId,
      canonicalUrl: candidate!.canonicalUrl,
      originalUrl: candidate!.originalUrl,
      subredditOrScope: candidate!.subredditOrScope,
      authorHandleHash: candidate!.authorHandleHash,
      title: candidate!.title,
      boundedContent: candidate!.boundedContent,
      contentSha256: candidate!.contentSha256,
      captureMode: candidate!.captureMode,
      publishedAt: candidate!.publishedAt,
      discoveredAt: observedAt,
      observedAt,
      searchQueryId: candidate!.primaryQueryId,
      providerRequestId: null,
      metadata: {
        lang: candidate!.lang,
        metrics: candidate!.metrics,
        matchedQueryIds: candidate!.matchedQueryIds,
        retrievals: candidate!.retrievals,
        previousContentSha256: candidate!.previousContentSha256,
        publicationTimeVerified: candidate!.publicationTimeVerified,
      },
      rightsPolicyVersion: 'rni-source-policy-v1',
      createdAt: observedAt,
    });

    expect(slice).toMatchObject({ platform: 'x', status: 'complete', eligibleSourceCount: 1 });
    expect(slice.computedAt).toBeNull();
    expect(source).toMatchObject({ platform: 'x', sourceKind: 'x_post' });
  });

  it('maps an existing-adapter failure into a valid independent unavailable X slice', async () => {
    const result = await runXSourceSlice(
      request,
      port({
        ok: false,
        error: { kind: 'entitlement', endpoint: 'search_recent', status: 403 },
        meta: { ...providerMeta, costUsd: null },
      }),
      clock,
    );

    const slice = rniPlatformSlice.parse(result.slice);
    expect(slice).toMatchObject({
      platform: 'x',
      status: 'unavailable',
      eligibleSourceCount: 0,
      errorCode: 'X_PROVIDER_UNAVAILABLE',
    });
    expect(slice.coverageDisclosure).toContain('no Reddit fallback');
    expect(result.candidates).toEqual([]);
  });
});
