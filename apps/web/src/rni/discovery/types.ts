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
    | 'WHOLE_PAGE_HTML'
    | 'OUTSIDE_WINDOW';
};

export type DiscoveryUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
};

export type RedditDiscoveryResult = {
  queryId: string;
  providerRequestId: string;
  resolvedModel: string;
  promptVersion: 'rni-discovery-v1';
  candidates: readonly RedditDiscoveryCandidate[];
  consultedSources: readonly ConsultedSource[];
  rejectedCandidates: readonly RejectedDiscoveryCandidate[];
  limitations: readonly string[];
  usage: DiscoveryUsage;
  latencyMs: number;
};

export type OpenAiWebSearchRequest = {
  model: string;
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
