import type { XPost, XPostMetrics } from '@/adapters/x';
import type { ProviderError, ProviderMeta, ProviderResult } from '@/contracts/provider';
import type { RniPlatformSlice } from '@/rni/contracts';

export type XConfiguredQuery = {
  queryId: string;
  query: string;
  scope: string;
  maxResults?: number;
};

export type XSourceSliceRequest = {
  runId: string;
  sliceId: string;
  windowStart: string;
  windowEnd: string;
  queries: readonly XConfiguredQuery[];
};

export type XAdapterSearchRequest = {
  query: string;
  maxResults?: number;
};

export interface XAdapterPort {
  search(request: XAdapterSearchRequest): Promise<ProviderResult<XPost[]>>;
}

export interface XSourceClock {
  now(): Date;
}

export type XSourceRetrieval = {
  queryId: string;
  query: string;
  retrievedAt: string;
  rank: number;
  providerMeta: ProviderMeta;
  captureMode: 'full_post';
  sourceMetadata: {
    subredditOrScope: string;
    authorHandleHash: string | null;
    publishedAt: string;
    lang: string | null;
    metrics: XPostMetrics;
    contentSha256: string;
  };
};

export type XSourceCandidate = {
  originalUrl: string;
  canonicalUrl: string;
  externalId: string;
  sourceKind: 'x_post';
  subredditOrScope: string;
  title: null;
  authorHandleHash: string | null;
  boundedContent: string;
  contentSha256: string;
  captureMode: 'full_post';
  publishedAt: string;
  publicationTimeVerified: true;
  lang: string | null;
  metrics: XPostMetrics;
  primaryQueryId: string;
  matchedQueryIds: readonly string[];
  retrievals: readonly XSourceRetrieval[];
  previousContentSha256: string | null;
};

export type RejectedXPost = {
  queryId: string;
  externalId: string;
  reason:
    | 'PUBLISHED_AT_MISSING'
    | 'PUBLISHED_AT_INVALID'
    | 'OUTSIDE_WINDOW'
    | 'NO_ANALYZABLE_CONTENT'
    | 'CONTENT_TOO_LONG'
    | 'WHOLE_PAGE_HTML';
};

export type XQueryTrace = {
  queryId: string;
  ok: boolean;
  returnedPostCount: number;
  providerMeta: ProviderMeta | null;
  errorKind: ProviderError['kind'] | 'unexpected_throw' | null;
};

export type XSourceSliceResult = {
  slice: RniPlatformSlice;
  candidates: readonly XSourceCandidate[];
  rejectedPosts: readonly RejectedXPost[];
  duplicatePostCount: number;
  changedContentVersionCount: number;
  queryTraces: readonly XQueryTrace[];
};
