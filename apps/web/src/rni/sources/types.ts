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

export type XAdapterContractViolation = {
  provider: 'x';
  endpoint: string;
  issues: readonly string[];
  payloadRef: string | null;
};

export type XAdapterSearchOutcome = {
  providerResult: ProviderResult<XPost[]>;
  responseCompleteness: 'complete' | 'partial';
  contractViolations: readonly XAdapterContractViolation[];
};

export interface XAdapterPort {
  search(request: XAdapterSearchRequest): Promise<XAdapterSearchOutcome>;
}

export interface XSourceClock {
  now(): Date;
}

export interface XAuthorIdentityHasher {
  hashStableAuthorId(authorId: string): string;
}

export type XSourceSliceDependencies = {
  clock?: XSourceClock;
  authorIdentityHasher?: XAuthorIdentityHasher;
};

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
  responseCompleteness: 'complete' | 'partial' | null;
  contractViolations: readonly XAdapterContractViolation[];
};

export type XContentTransition = {
  externalId: string;
  fromContentSha256: string | null;
  toContentSha256: string;
  queryId: string;
  retrievedAt: string;
};

export type XSourceSliceResult = {
  slice: RniPlatformSlice;
  /** Exactly one latest, interpretation-eligible candidate per external ID. */
  candidates: readonly XSourceCandidate[];
  /** Every distinct content version, including superseded and later-reverted versions. */
  persistenceVersions: readonly XSourceCandidate[];
  contentTransitions: readonly XContentTransition[];
  rejectedPosts: readonly RejectedXPost[];
  duplicatePostCount: number;
  changedContentVersionCount: number;
  queryTraces: readonly XQueryTrace[];
};
