# Retail Narrative Intelligence — Deployment and Human Intervention

This runbook contains the actions that cannot safely be inferred or automated. It assumes the existing Vercel-hosted Next.js application, Neon PostgreSQL, QStash orchestration, OpenAI Direct for RNI by default, and an optional Vercel AI Gateway route. pgvector is deferred for the overnight vertical slice.

**Production approver:** `joshuai`  
**Confirmed scope:** isolated RNI vertical slice; Reddit through OpenAI Web Search; X independent; current FMP S&P 500 universe; read-only MCP skeleton.

## 1. Human-owned decisions before deployment

Record owner, reviewer, date, and evidence for:

- approved public/retail-accessible source list and current terms/retention policy;
- whether each paid source is genuinely available to a typical private retail trader with a credit card;
- sectors, regions, exchanges, communities, watchlists, and ticker universe;
- primary window (default 1 day), comparison presets, baseline length, and freshness SLA;
- model per agent, OpenAI project, spend limits, data-retention controls, and gateway fallback policy;
- theme taxonomy and confidence/guardrail thresholds;
- user roles, identity provider, data-retention periods, and incident owners;
- demo disclaimers and confirmation that trading/execution is out of scope.

Prohibited for the Milford constrained demo: Bloomberg, FactSet, LSEG/Refinitiv, broker research, institutional feeds, or any source a normal private retail user could not obtain. A convenient API does not make its terms suitable; approve use and redistribution separately.

## 2. Accounts and projects

Human setup:

1. Create/select OpenAI organisation and least-privilege project; set budget alerts and hard operational limits where available.
2. Create Vercel team/project with separate Preview and Production environment variables.
3. Provision Neon project with separate production branch and ephemeral preview/test branches; enable `vector` extension.
4. Configure identity provider and OAuth authorization server for portal/MCP.
5. If enabling AI Gateway, configure provider credentials/routing and review observability/retention settings.
6. Establish current permitted access method for each source. Do not bypass authentication, robots, rate limits, or terms.

No secret is committed to Git or pasted into issue/agent prompts.

## 3. Environment variables

Set through Vercel/approved secret storage. Names are illustrative; validate against implementation.

```text
DATABASE_URL
DATABASE_URL_UNPOOLED              # migrations only, if required
OPENAI_API_KEY
OPENAI_PROJECT_ID
AI_ROUTE_DEFAULT=openai_direct
AI_GATEWAY_API_KEY                 # optional
AI_GATEWAY_BASE_URL                # optional
FMP_API_KEY
X_BEARER_TOKEN
QSTASH_TOKEN
QSTASH_CURRENT_SIGNING_KEY
QSTASH_NEXT_SIGNING_KEY
AUTH_ISSUER
AUTH_AUDIENCE
AUTH_CLIENT_ID
AUTH_CLIENT_SECRET                 # confidential server only
MCP_PUBLIC_ORIGIN
APP_PUBLIC_ORIGIN
ENCRYPTION_KEY_REFERENCE           # key-manager reference, not raw export where possible
OTEL_EXPORTER_OTLP_ENDPOINT        # optional approved collector
```

Never expose database, OpenAI, gateway, cron, or OAuth client secrets through `NEXT_PUBLIC_*` variables.

## 4. Database

Human/reviewer steps:

1. Confirm region, retention, point-in-time recovery, connection pooling, and access roles.
2. Create least-privilege roles for app runtime, migrations, read-only analytics, and incident response.
3. Apply migrations to an ephemeral Neon branch first.
4. Run schema, idempotency, universe-ceiling, source-slice, citation and lineage tests. Run existing authorization tests; do not add multi-tenancy or pgvector solely for this slice.
5. Review migration plan and backup/restore point.
6. Apply production migration using the migration role.
7. Seed versioned default configuration, security master, themes, policies, prompts, and evaluation set.
8. Verify a publication-to-source lineage query and cross-tenant denial.

Neon supports branching for isolated development/testing and pgvector for vector search; validate current operational guidance in [Neon branching](https://neon.com/docs/guides/branching-intro) and [vector search optimisation](https://neon.com/docs/ai/ai-vector-search-optimization).

## 5. OpenAI configuration

1. Confirm approved models are available in the selected region/project and pin accepted snapshots where possible.
2. Validate Responses API tools, Structured Outputs schemas, Web Search source-list inclusion, domain filters, and citation rendering.
3. Confirm account data controls and retention for every endpoint/tool used. Background mode and third-party tools can differ.
4. Configure per-agent token/output/tool limits and project spend alerts.
5. Run the frozen eval set against exact model/prompt/schema versions.
6. Run prompt-cache probe and record eligible/cached tokens, latency, cost, and quality.
7. Do not enable fallback to an unevaluated model.

## 6. Sources and discovery

Create a reviewed source register with:

```text
source type | access method | public/retail availability | allowed domains
terms owner | collection limits | stored fields | retention | deletion process
coverage caveat | status | review date
```

Seed source-configuration version 1 with the four groups in `PRD.md` §3.1. Verify all 24 exact subreddit keys, then verify `r/Superstonk` and `r/GME` are separate provenance values mapped to one `GME_RETAIL_CLUSTER`. Do not collapse their source rows or URLs.

Minimum preferred verification sources are public issuer investor-relations pages, SEC EDGAR and relevant public regulator/exchange sites. SEC EDGAR APIs are public and do not require API keys ([SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)). Public forums, newsletters, podcasts, videos, and retail market-data products require individual review.

For the demo, OpenAI Web Search is the Reddit acquisition path and has no Reddit Data API dependency. Store canonical URL, returned post/body/excerpt and relevant metadata only; never full page HTML. Label excerpt-only captures and sampled coverage. Configure and verify the existing X adapter separately; record its credentials, permitted watch/query scope, rate limits and freshness. X is never a Reddit fallback.

Run an authenticated FMP capability probe against [`/stable/sp500-constituent`](https://site.financialmodelingprep.com/developer/docs/stable/sp-500). Record HTTP status, response schema/count/hash, retrieval time and entitlement result without logging the key. Resolve all members against the canonical security master and stage—but do not activate—the new universe. Activation is blocked on empty, partial, duplicate, ambiguous, unresolved or over-600 membership. `joshuai` reviews the impact preview and activates production. NVDA must be present and is the default UI selection.

## 7. Vercel deployment

1. Link repository/project and confirm build/root settings.
2. Configure Preview variables with non-production Neon branch and restricted keys.
3. Deploy Preview; run migration compatibility, health, auth, pipeline fixture, UI, MCP, and accessibility smoke tests.
4. Configure function regions/timeouts within current plan limits.
5. Configure the repository's QStash signing keys, heartbeat destination and production job definitions. Do not add Vercel Cron.
6. Use the existing durable job/queue mechanisms for multi-stage processing. Queue consumers must be idempotent because delivery is at least once; Reddit and X jobs retain independent states.
7. Add custom domain/TLS and security headers.
8. Promote exact reviewed deployment to Production.

## 8. Initial schedules

Recommended demo default:

- one daily bounded market/watchlist refresh before the presentation window;
- primary period: last 24 hours;
- comparison: previous 7 days or prior equal period;
- one smaller freshness check later in the day if budget allows;
- explicit maximum sources, search calls, tokens, runtime, and cost;
- notifications only for failure, staleness, budget breach, or required human action.

Use the portal schedule preview to verify next five local and UTC times, including daylight-saving boundaries. Trigger `Run now` once and confirm coalescing against the next scheduled run.

## 9. MCP deployment

1. Publish `/mcp` over HTTPS and protected-resource metadata.
2. Register audience/scopes and redirect/client metadata rules in the authorization server.
3. Test token audience, expiry, refresh, revocation, PKCE, tenant mapping, and RLS.
4. Add the remote MCP endpoint in current ChatGPT developer/custom-connector flow and Claude custom integration flow.
5. Verify read tools first; enable mutation tools only after confirmation UX and audits pass.
6. Confirm canonical citations survive both clients.
7. Reject an attempted trade/order call and a cross-tenant source lookup.

## 10. Release verification

Run the full story in Production or a production-equivalent environment:

1. Search a named ticker/company.
2. Start a bounded full run using OpenAI Direct.
3. Confirm original source records commit before observations.
4. Inspect a multi-ticker item and independent sentiments.
5. View four dimensions, attention, z-score, confidence, breadth, and plain-language help.
6. Open every explanation citation to exact captured evidence and original URL.
7. Verify raw explorer contains no whole-page HTML.
8. Confirm freshness and run-stage status.
9. Recompute from stored evidence under a draft configuration without mutating history.
10. Query the same signal over MCP in both target clients.
11. Run eval/release gate and inspect failure suggestions.
12. Switch a test tenant to Gateway for a future run and verify resolved route; restore Direct default.

## 11. Observability and alerts

Human owners must configure:

- workflow stuck/lease expired;
- last successful refresh beyond SLA;
- source discovery zero/large deviation;
- provider error/circuit breaker/fallback;
- schema/citation/publication-gate failure;
- database connection/storage/replication issue;
- authentication/authorization anomaly;
- token/cost budget warn and stop;
- eval regression;
- deletion/retention job failure.

Dashboards join request → run → stage → model call → source/claim → publication using IDs, without logging secrets or full restricted evidence.

## 12. Rollback and recovery

- **Application:** promote the last known-good immutable Vercel deployment.
- **Configuration:** move active pointer to the prior approved version; do not overwrite history.
- **Model/prompt:** disable candidate and resume prior evaluated tuple.
- **Schedule:** pause before rollback if it could create more affected runs.
- **Database:** prefer forward-compatible corrective migration; use restore/PITR only with incident owner approval and tested runbook.
- **Publication:** mark affected publications withdrawn/superseded while retaining audit/lineage according to policy.
- **Source/provider:** open circuit, show partial/stale state, and continue only safe independent stages.

After recovery, replay from the last committed checkpoint with the same idempotency keys or a documented superseding run.

## 13. Presentation-day checklist

- [ ] Production health, data-through, and last-success checked.
- [ ] Named ticker has enough permitted evidence or a rehearsed honest insufficient-evidence path.
- [ ] One comparative post proof is available.
- [ ] Every demo explanation citation resolves.
- [ ] Cost/headroom and OpenAI/Vercel/Neon service status reviewed.
- [ ] Cron will not collide with presentation run.
- [ ] Backup screenshots/export exist only as presentation fallback and are labelled with as-of time.
- [ ] Direct route active by default; Gateway demonstration optional.
- [ ] Presenter can explain sampled coverage, confidence, z-score, and deterministic-versus-LLM boundary.
- [ ] No institutional or prohibited data appears.

## 14. Post-deployment human review

Within one business day, review failed/partial runs, source coverage, citation samples, eval slices, model/cache/cost metrics, access/audit logs, and user feedback. Convert issues into adjudicated eval cases before changing active prompts or thresholds.
