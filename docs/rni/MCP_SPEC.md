# Retail Narrative Intelligence — MCP Server Specification

**Protocol baseline:** Model Context Protocol `2025-06-18`  
**Transport:** Streamable HTTP  
**Endpoint:** `https://<host>/mcp`  
**Clients:** ChatGPT custom connectors and Claude custom integrations  
**Default posture:** read-only; mutation tools require explicit scopes and confirmations

## 1. Purpose and boundaries

The MCP server lets authorised assistants query the same governed evidence, analytics, lineage, and methodology as the portal. It does not scrape sources on behalf of an arbitrary client, reveal secrets, bypass row-level security, execute trades, or provide uncited investment recommendations.

Every answer-producing tool returns machine-addressable citations. The server is an access layer over stored objects; it is not a second analytical truth system.

MCP specifies **tools**, **resources**, and **prompts**. The server implements all three but clients may expose only a subset. Feature negotiation occurs during `initialize`; unsupported client capabilities must not break read tools. See the [MCP specification](https://modelcontextprotocol.io/specification/2025-06-18/index).

## 2. Transport and session behaviour

- Streamable HTTP at `/mcp`, supporting POST and GET as required by the negotiated protocol.
- `MCP-Protocol-Version: 2025-06-18` after initialization.
- JSON-RPC messages use unique request IDs and structured error data.
- Session IDs, when issued, are unguessable and scoped to user, tenant, and client.
- Origin validation, HTTPS, bounded payload size, request timeouts, and rate limits are mandatory.
- Long operations return a durable `run_id`; clients poll/read the run resource instead of holding the HTTP request open.
- Tool calls are idempotent when `idempotency_key` is supplied; mutation calls require it.

## 3. Authorization

Use OAuth 2.1 resource-server patterns from the [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization):

- protected-resource metadata at `/.well-known/oauth-protected-resource` identifies authorization servers;
- tokens are audience-bound to this MCP server and never passed through to upstream sources;
- PKCE is required for public clients;
- dynamic client registration or client metadata documents are supported where the authorization server permits them;
- token expiry, refresh, and revocation are enforced;
- tenant/user identity is mapped to database RLS context on every call.

Scopes:

| Scope | Permission |
|---|---|
| `rni:read` | published signals, narratives, methodology, freshness |
| `rni:evidence:read` | captured bounded evidence and lineage |
| `rni:runs:read` | run, stage, usage, and evaluation status |
| `rni:run` | start bounded analysis/recompute/refresh |
| `rni:schedules:write` | create/update/pause schedules |
| `rni:config:read` | active configuration and versions |
| `rni:config:write` | create drafts only |
| `rni:admin` | activate approved configuration and administer tenant |

ChatGPT developer mode can add a remote MCP app, and organisations can apply workspace controls; confirm current client requirements before deployment using [OpenAI’s custom MCP guidance](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt). Claude custom integrations support remote MCP servers and OAuth flows; confirm the current flow in [Anthropic’s integration guidance](https://support.anthropic.com/en/articles/11503834-building-custom-integrations-via-remote-mcp-servers).

## 4. Common types

### 4.1 Security reference

```json
{
  "security_id": "uuid",
  "ticker": "NVDA",
  "company_name": "NVIDIA Corporation",
  "exchange": "NASDAQ"
}
```

### 4.2 Window

```json
{
  "start": "2026-09-03T00:00:00Z",
  "end": "2026-09-04T00:00:00Z",
  "timezone": "Pacific/Auckland"
}
```

### 4.3 Citation

```json
{
  "citation_id": "uuid",
  "source_item_id": "uuid",
  "source_url": "https://www.reddit.com/r/stocks/comments/.../",
  "source_type": "FORUM_POST",
  "title": "Original post title",
  "published_at": "2026-09-03T08:21:00Z",
  "published_at_precision": "exact",
  "quote": "bounded supporting excerpt",
  "start_char": 142,
  "end_char": 219,
  "relationship": "supports",
  "availability": "available"
}
```

Quotes are bounded excerpts, escaped as text, and subject to source policy. `source_url` is always the canonical original URL, not a search-result URL.

### 4.4 Tool result envelope

```json
{
  "schema_version": "1.0",
  "request_id": "uuid",
  "as_of": "2026-09-04T00:05:12Z",
  "freshness": {"state": "current", "data_through_at": "2026-09-03T23:58:00Z"},
  "configuration_version": "cfg_42",
  "data": {},
  "citations": [],
  "warnings": [],
  "next_cursor": null
}
```

The human-readable MCP `content` must be derivable from `structuredContent`. Return `isError: true` for tool execution errors with stable error codes such as `AMBIGUOUS_SECURITY`, `STALE_DATA`, `INSUFFICIENT_EVIDENCE`, `FORBIDDEN`, `RUN_CONFLICT`, and `BUDGET_EXCEEDED`.

## 5. Read tools

### 5.1 Discovery and lookup

| Tool | Required input | Output / rules |
|---|---|---|
| `resolve_security` | `query` | Ranked matches with ticker, company, exchange, identifiers; abstain on ambiguity |
| `search_evidence` | `query`, bounded `window`; optional security/theme/source filters | Matching source items with original URLs and excerpts; cursor pagination |
| `get_source_item` | `source_item_id` | Captured post/comment/transcript segment, metadata, availability and canonical URL; never whole-page HTML |
| `get_source_lineage` | `source_item_id` | Discovery call → source → mentions/observations/claims → narratives/metrics → explanations/publications |
| `search_securities` | filters and cursor | Security master records; ticker always paired with company |
| `get_active_universe` | optional version/as-of | Active FMP-derived S&P 500 membership, source/retrieval/activation times, count and freshness; read-only |

### 5.2 Analytics

| Tool | Required input | Output / rules |
|---|---|---|
| `get_radar` | primary/comparison windows and optional coverage filters | Ranked signals, all four dimensions, attention, z-score, confidence, breadth, citations |
| `get_security_signal` | `security_id`, primary/comparison windows | Three explicit outputs: Reddit sentiment, X sentiment, and combined summary; each includes independent dimensions, freshness, coverage, narratives, metrics, confidence and platform-labelled citations |
| `compare_security_windows` | `security_id`, two explicit windows | Deterministic deltas and cited narrative explanation |
| `list_narratives` | window plus filters | Narrative lifecycle, attention, breadth, concentration, confidence |
| `get_narrative` | `narrative_id` | Claims, supporting/opposing evidence, catalysts, challenger, lifecycle and citations |
| `list_themes` | active/as-of version | Taxonomy and aggregate signal |
| `get_theme_signal` | `theme_id`, window | Securities, four-dimension stance, narratives, evidence and citations |
| `explain_metric` | metric name, optional metric record ID | Definition, formula, parameter/config version, inputs and caveats |

### 5.3 Operations and governance

| Tool | Required input | Output / rules |
|---|---|---|
| `get_freshness` | optional scope | attempt/success/data-through/computed timestamps, SLA and state |
| `list_runs` | filters and cursor | Run IDs, type, scope, status, provider route, time, usage and failure summary |
| `get_run` | `run_id` | Stage states, heartbeats, counts, warnings, model/token/cache/cost aggregates |
| `get_methodology` | optional version | formulas, assumptions, active parameters, prompt/policy/taxonomy IDs |
| `get_eval_summary` | eval run/config version | measured scores, thresholds, regressions, examples, AI suggestions labelled as suggestions |
| `get_configuration` | config version/as-of | Redacted configuration; never secrets or full credentials |
| `list_schedules` | optional active filter | cadence, timezone, scope, next runs and status |

## 6. Mutation tools

Mutation tools are disabled unless client and user both have the required scope. Descriptions must be explicit enough that a client can obtain human confirmation before invocation.

| Tool | Scope | Inputs | Result |
|---|---|---|---|
| `start_analysis` | `rni:run` | security/coverage scope, windows, config version, route, budget, `idempotency_key` | durable run ID and cost estimate acknowledgement |
| `refresh_evidence` | `rni:run` | source/coverage scope, watermark, limits, route, key | discovery-only run ID |
| `recompute_analysis` | `rni:run` | immutable evidence selection, stages, config version, key | downstream run ID; no new discovery |
| `cancel_run` | `rni:run` | run ID, reason, key | cancellation requested/result |
| `create_schedule` | `rni:schedules:write` | cadence, timezone, scope, windows, limits, route, key | draft/active schedule depending on policy |
| `update_schedule` | `rni:schedules:write` | schedule ID, expected version, patch, key | updated schedule or version conflict |
| `pause_schedule` | `rni:schedules:write` | schedule ID, reason, key | paused schedule |
| `create_config_draft` | `rni:config:write` | parent version, typed patch, rationale, key | draft plus validation/impact-preview links |
| `run_evaluation` | `rni:config:write` | candidate config, eval-set version, budget, key | evaluation run ID |
| `activate_configuration` | `rni:admin` | candidate ID, approval ID, expected active version, key | activation audit record |

No MCP tool may generate or transmit an order. `start_analysis` must reject an unbounded source, date, or security scope.

## 7. Resources

Resources expose stable, addressable read models:

| URI template | MIME type | Content |
|---|---|---|
| `rni://methodology/{version}` | `application/json` and `text/markdown` | formulas, policies, assumptions |
| `rni://security/{security_id}/signal?start={iso}&end={iso}` | `application/json` | saved signal only |
| `rni://narrative/{narrative_id}` | `application/json` | cited narrative record |
| `rni://source/{source_item_id}` | `application/json` | bounded captured evidence and metadata |
| `rni://run/{run_id}` | `application/json` | run/stage state and usage |
| `rni://eval/{eval_run_id}` | `application/json` | immutable evaluation report |
| `rni://taxonomy/{version}` | `application/json` | theme taxonomy |
| `rni://universe/{version}` | `application/json` | immutable universe membership, FMP source lineage and activation metadata |

Resource subscriptions may be added for run state if both server and client negotiate them. Do not assume all clients support subscriptions; `get_run` remains canonical.

## 8. Prompts

Prompts are optional client conveniences, not hidden policy:

- `analyse_security` — arguments: security, primary window, comparison window; instructs client to call evidence-backed read tools and distinguish fact, source claim, inference, and uncertainty.
- `compare_securities` — arguments: two or more securities and window; requires per-security observations rather than transferring one sentiment label across all names.
- `challenge_narrative` — argument: narrative ID; retrieves supporting and opposing evidence and asks for the strongest defensible counter-case.
- `explain_methodology` — argument: metric; uses the saved methodology resource.

Server governance, authorization, citation enforcement, and abstention do not depend on the client using these prompts.

## 9. Citation and explanation contract

1. Every factual sentence in generated `summary` text includes citation IDs.
2. Citation IDs resolve to stored `source_item_id` and immutable evidence spans.
3. Search-engine result URLs are not accepted as original citations.
4. A derived metric cites analytical provenance plus the underlying evidence set or a queryable evidence-set resource.
5. Unsupported claims produce `INSUFFICIENT_EVIDENCE`, not fluent filler.
6. Conflicting evidence is returned, not filtered merely for disagreeing.
7. Client-side rendering must preserve citations; plain-text fallback appends numbered canonical URLs.
8. Reddit and X results remain separate objects. `combined_summary` references both component IDs, describes disagreement or missing coverage, and never uses one source as fallback for the other.

## 10. Tool safety metadata

Where client schemas support annotations:

- read tools: `readOnlyHint: true`, `idempotentHint: true`;
- recompute/refresh: `destructiveHint: false`, `idempotentHint: true` when key provided;
- cancel/activation/schedule mutation: accurately mark non-read-only and potential external impact;
- no tool is labelled open-world unless it directly accesses outside systems; this server’s read tools use stored data.

Treat annotations as UX hints, never authorization controls.

## 11. Pagination, limits, and cost

- Cursor pagination; no offsets for mutable collections.
- Default 25 items, maximum 100; source text truncated by default with explicit bounded expansion.
- Maximum window and backfill depend on tenant policy.
- MCP read calls do not silently start expensive model work.
- Mutation estimates are returned before execution in UI-mediated flows; server also enforces hard budgets.
- Caches vary by user/tenant/configuration and may not cross authorization boundaries.

## 12. Observability and audit

Record request ID, OAuth client ID, user/tenant, tool, normalized input hash, run ID, result count, latency, error code, and mutation outcome. Redact tokens, secrets, full prompts containing restricted evidence, and personal data. Audit logs are append-only and retention-controlled.

Metrics: request rate, p50/p95 latency, error rate by tool, authorization failures, citation completeness, stale-data responses, run conflicts, payload size, and client/protocol version.

## 13. Compatibility test matrix

Test against current ChatGPT custom MCP and Claude custom integration flows before release:

1. initialize and capability negotiation;
2. OAuth authorization, refresh, revocation, and wrong-audience rejection;
3. tool discovery and JSON Schema validation;
4. structured content plus human-readable fallback;
5. resource reads and URI-template encoding;
6. citation rendering and canonical URL preservation;
7. long run creation followed by status reads;
8. confirmation shown before mutation;
9. cancellation and idempotent retry;
10. client without resources/prompts still completes read workflows.

## 14. Acceptance tests

1. `get_source_item` returns only the persisted post/comment/transcript segment and relevant metadata, never full webpage HTML.
2. A comparative post is returned as one source, multiple mentions, and independent per-security observations.
3. `get_security_signal` never returns a factual explanation without resolvable citations.
4. All mutation tools reject missing idempotency keys and insufficient scopes.
5. Tokens issued for another audience or tenant are rejected.
6. A stale scope includes an explicit freshness warning.
7. Tool schemas pass MCP client validation and contract tests in both target clients.
8. Resources are tenant-isolated under concurrent requests.
9. Secrets and source credentials cannot be returned by any tool or resource.
10. An attempted order/trade request returns a bounded out-of-scope response.
