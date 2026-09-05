export type RedditDiscoveryMode = 'scheduled_community' | 'on_demand_security';

export type RedditDiscoverySecurity = {
  ticker: string;
  companyName: string;
  aliases: readonly string[];
};

export type RedditDiscoveryRequest = {
  queryId: string;
  mode: RedditDiscoveryMode;
  windowStart: string;
  windowEnd: string;
  communities: readonly string[];
  securities: readonly RedditDiscoverySecurity[];
  maxCandidates: number;
};

export type RedditDiscoveryCandidate = {
  originalUrl: string;
  canonicalUrl: string;
  externalId: string;
  sourceKind: 'post' | 'comment';
  subredditOrScope: string;
  title: string | null;
  boundedContent: string;
  contentSha256: string;
  captureMode: 'excerpt_only';
  publishedAt: string | null;
  publicationTimeVerified: boolean;
  providerSourceUrl: string;
};

export type RedditDiscoveryUrlCandidate = {
  originalUrl: string;
  canonicalUrl: string;
  externalId: string;
  sourceKind: 'post' | 'comment';
  subredditOrScope: string;
  title: string | null;
  boundedContent: null;
  contentSha256: null;
  captureMode: null;
  publishedAt: null;
  publicationTimeVerified: false;
  providerSourceUrl: string;
  interpretationEligible: false;
};

export type ConsultedSource = {
  url: string;
  title: string | null;
};

export type RejectedDiscoveryCandidate = {
  url: string;
  reason:
    | 'DOMAIN_NOT_ALLOWED'
    | 'INVALID_REDDIT_URL'
    | 'COMMUNITY_NOT_CONFIGURED'
    | 'COMMUNITY_MISMATCH'
    | 'NOT_IN_PROVIDER_SOURCES'
    | 'NO_ANALYZABLE_CONTENT'
    | 'EXCERPT_NOT_SOURCE_BOUND'
    | 'PUBLISHED_AT_MISSING'
    | 'PUBLISHED_AT_NOT_SOURCE_BOUND'
    | 'WHOLE_PAGE_HTML'
    | 'OUTSIDE_WINDOW';
};

export type WebSearchActionTrace =
  | {
      callId: string;
      type: 'search';
      sources: readonly ConsultedSource[];
    }
  | {
      callId: string;
      type: 'open_page';
      url: string;
    }
  | {
      callId: string;
      type: 'find_in_page';
      url: string;
      pattern: string;
    };

export type DiscoveryUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
};

export type RedditDiscoveryResult = {
  queryId: string;
  providerRequestId: string;
  resolvedProvider: string | null;
  resolvedModel: string;
  promptVersion: string;
  candidates: readonly RedditDiscoveryCandidate[];
  urlOnlyCandidates: readonly RedditDiscoveryUrlCandidate[];
  consultedSources: readonly ConsultedSource[];
  webSearchActions: readonly WebSearchActionTrace[];
  rejectedCandidates: readonly RejectedDiscoveryCandidate[];
  limitations: readonly string[];
  usage: DiscoveryUsage;
  latencyMs: number;
};

export type OpenAiWebSearchRequest = {
  model: string;
  reasoning: { effort: 'low' };
  instructions: string;
  input: string;
  tools: readonly [
    {
      type: 'web_search';
      filters: { allowed_domains: readonly ['reddit.com'] };
    },
  ];
  tool_choice: 'required';
  include: readonly ['web_search_call.action.sources'];
  text: {
    format: {
      type: 'json_schema';
      name: 'rni_reddit_discovery_v1';
      strict: true;
      schema: Readonly<Record<string, unknown>>;
    };
  };
  max_output_tokens: number;
  max_tool_calls: number;
  parallel_tool_calls: false;
  store: false;
};

export interface OpenAiResponsesTransport {
  create(request: OpenAiWebSearchRequest): Promise<unknown>;
}
