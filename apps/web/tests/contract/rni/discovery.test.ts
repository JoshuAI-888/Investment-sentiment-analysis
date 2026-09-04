import { describe, expect, it } from 'vitest';
import fixtureResponse from '../../unit/rni/discovery/fixtures/openai-web-search-response.json';
import { rniSourceItem } from '@/rni/contracts';
import { OpenAiRedditDiscovery } from '@/rni/discovery';

describe('RNI E01 discovery-to-frozen-source contract', () => {
  it('normalizes a Web Search candidate into a valid bounded persisted-source shape', async () => {
    const discovery = new OpenAiRedditDiscovery(
      { create: async () => fixtureResponse },
      { model: 'configured-model', maxOutputTokens: 2_000, maxToolCalls: 3 },
    );
    const result = await discovery.discover({
      queryId: '00000000-0000-4000-8000-000000000101',
      mode: 'on_demand_security',
      windowStart: '2026-09-04T00:00:00.000Z',
      windowEnd: '2026-09-05T00:00:00.000Z',
      communities: ['r/stocks'],
      securities: [{ ticker: 'NVDA', companyName: 'NVIDIA Corporation', aliases: ['NVIDIA'] }],
      maxCandidates: 20,
    });
    const candidate = result.candidates[0];
    expect(candidate).toBeDefined();

    const persisted = rniSourceItem.parse({
      id: '00000000-0000-4000-8000-000000000102',
      platform: 'reddit',
      sourceKind: candidate!.sourceKind,
      externalId: candidate!.externalId,
      canonicalUrl: candidate!.canonicalUrl,
      originalUrl: candidate!.originalUrl,
      subredditOrScope: candidate!.subredditOrScope,
      authorHandleHash: null,
      title: candidate!.title,
      boundedContent: candidate!.boundedContent,
      contentSha256: candidate!.contentSha256,
      captureMode: candidate!.captureMode,
      publishedAt: candidate!.publishedAt,
      discoveredAt: '2026-09-05T00:00:00.000Z',
      observedAt: '2026-09-05T00:00:00.000Z',
      searchQueryId: result.queryId,
      providerRequestId: result.providerRequestId,
      metadata: {
        providerSourceUrl: candidate!.providerSourceUrl,
        publicationTimeVerified: candidate!.publicationTimeVerified,
      },
      rightsPolicyVersion: 'rni-source-policy-v1',
      createdAt: '2026-09-05T00:00:01.000Z',
    });

    expect(persisted.canonicalUrl).toBe('https://www.reddit.com/r/stocks/comments/abc123/');
    expect(persisted.boundedContent).not.toMatch(/<html/iu);
  });
});
