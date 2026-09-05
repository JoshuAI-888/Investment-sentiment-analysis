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

Owner-approved RNI baseline, 2026-09-05:

- OpenAI Direct is the default route.
- Reddit discovery, security relationship resolution and semantic classification use
  `gpt-5.6-terra` with low reasoning effort.
- Catalyst verification and challenger calls use `gpt-5.6-sol` with low reasoning effort.
- Gateway is an explicit parity route to the same OpenAI model family. It has no silent
  cross-provider or unevaluated-model fallback; I10 must validate the configured Gateway slugs.
- RNI AI-spend hard limits are USD 2 per manual ticker run, USD 25 per full-universe run and USD 50
  per rolling 24 hours. Warn at USD 300 per calendar month and stop at USD 500.
- The RNI AI ledger includes model-token and OpenAI Web Search tool charges. X and FMP commercial
  charges are governed separately. Revisit these limits after the first measured full-universe
  run; any change creates a later versioned configuration and does not rewrite historical runs.
- Initial per-call limits are 16,000 input bytes/tokens and 2,000 output tokens for discovery,
  relationship and classifier; 64,000 input bytes/tokens and 2,000 output tokens for verifier;
  and 64,000 input bytes/tokens and 1,000 output tokens for challenger. Discovery allows three
  Web Search calls. Per-call caps are USD 0.15, 0.10, 0.10, 0.20 and 0.20 respectively; every
  timeout starts at 30 seconds.
- An admin may edit those bounded task envelopes at `/admin/settings/rni-ai`. Saving only stages
  an audited successor. `joshuai` must review the exact staged version, capability/price evidence,
  eval results and impact before separately activating it. The portal does not edit the global
  run/day/month controls and never changes running or historical calls.

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
AI_GATEWAY_BASE_URL                # optional; defaults to https://ai-gateway.vercel.sh/v1
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
8. Verify pre-dispatch worst-case reservation rejects calls that would cross the D-RNI-21 per-run,
   rolling-day or calendar-month hard limits, and that the monthly warning is observable.
9. Set `OPENAI_API_KEY` for every live RNI deployment even when the legacy application transport
   uses Gateway: D-RNI-21 keeps RNI Direct as the independent default route.
10. If Gateway is selected for a successor configuration, keep the request provider filter pinned
    to OpenAI, configure no fallback model, and require returned routing metadata to match the exact
    evaluated OpenAI model. Do not activate a staged successor until I11 live parity evidence and
    the explicit human approval gate pass.
11. Seed or discover a complete effective RNI price book before dispatch. Missing model-token or
    Web Search prices fail closed; Gateway-reported cost is observability evidence, not ledger
    settlement authority.
12. Retain the exact Gateway catalogue URL and response hash used for the price book. Catalogue
    token prices are per token; its OpenAI `web_search` field is normalized from the provider
    page's USD-per-1,000-search display to USD per search (D-RNI-24). Keep staged route input limits
    below the recorded first pricing-tier boundary or create a tier-aware successor. Reserve all
    three discovery searches allowed by the governed prompt.
13. Use the RNI Settings portal to review the active five aggregate limits. An administrator may
    lower them only within the D-RNI-21 ceilings and required order; saving activates an audited
    future-run successor. Confirm a subsequently admitted run snapshots the new limits while an
    already accepted run and its spend ledger remain unchanged.

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

Run an authenticated FMP capability probe against [`/stable/sp500-constituent`](https://site.financialmodelingprep.com/developer/docs/stable/sp-500). Record HTTP status, response schema/count/hash, retrieval time and entitlement result without logging the key.

Before the first current-constituent sync in a clean environment, a human must obtain and review
an FMP `/stable/profile` export for every candidate constituent. Store the reviewed file in an
approved secure location, not Git. Its JSON envelope is:

```json
{
  "source": "fmp_profile_export",
  "sourceEndpoint": "/stable/profile",
  "retrievedAt": "2026-09-05T00:00:00.000Z",
  "payloadSha256": "sha256-of-the-exact-ordered-securities-array",
  "securities": [
    {
      "symbol": "NVDA",
      "name": "NVIDIA Corporation",
      "exchange": "NASDAQ",
      "sector": "Technology",
      "industry": "Semiconductors",
      "cik": "0001045810",
      "currency": "USD"
    }
  ]
}
```

The export must contain 501–600 unique symbols including NVDA. Compute `payloadSha256` over the
exact JSON serialization of the ordered `securities` array, then run from the repository root:

```bash
pnpm --dir apps/web rni:bootstrap-security-master /secure/path/fmp-profile-export.json production joshuai
```

The importer is transactional and idempotent by environment plus payload hash. It aborts on a
hash/count/NVDA/duplicate failure or an ambiguous existing symbol, and emits the import identity,
inserted count, reused count and replay state. Review that output and its `audit_event` before
running the constituent sync.

The sync durably claims its environment/idempotency key before dispatching FMP. A concurrent
request for the same active key receives a retryable conflict with `retryAt`; it does not wait or
call FMP again. A later request replays the terminal provider, validation or staged outcome. If a
worker terminates and the claim expires, the next observation records a terminal abandoned-command
failure without redispatching. Review its command/provider audit before intentionally retrying
with a new idempotency key. Any provider attempt logged before abandonment remains bound to the
failed command. Staging and successful command completion commit atomically.
Resolve all members against the canonical security master and stage—but do not activate—the new
universe. Activation is blocked on empty, partial, duplicate, ambiguous, unresolved or over-600
membership. `joshuai` must first approve the exact staged version, then activate that unchanged
stored membership after reviewing its impact preview. NVDA must be present and is the default UI
selection.

## 7. Vercel deployment

1. Link repository/project and confirm build/root settings.
2. Configure Preview variables with non-production Neon branch and restricted keys.
3. Deploy Preview; run migration compatibility, health, auth, pipeline fixture, UI, MCP, and accessibility smoke tests.
4. Configure function regions/timeouts within current plan limits.
5. Configure `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY` and
   `QSTASH_NEXT_SIGNING_KEY` as server-only values. Set `APP_BASE_URL` to the exact public origin;
   QStash signs the exact `${APP_BASE_URL}/api/internal/rni/worker` destination. Rotate by placing
   the incoming key in `NEXT`, deploying, then promoting it to `CURRENT` only after both-key
   verification passes. Never print either key or return it from an API.
6. Configure a separate random `INTERNAL_DISPATCH_SECRET` of at least 16 characters. The external
   heartbeat calls `POST /api/internal/rni/dispatch` with `Authorization: Bearer <secret>`. Keep
   this secret out of QStash message bodies, portal settings and logs. Do not add Vercel Cron.
7. Provision the environment's trusted `rni-manual:<environment>` and
   `rni-scheduled:<environment>` job definitions through the application helper. Confirm the
   scheduled job remains full-universe, skip-concurrency, zero-jitter and free of caller-supplied
   dependencies or active windows.
8. Do not enable the heartbeat until the reviewed production worker executor is present. The
   current integration checkpoint intentionally returns unavailable before creating manual or
   scheduled work, claiming deliveries or contacting providers when that executor is absent.
9. Use the existing durable job/queue mechanisms for multi-stage processing. Queue consumers must
   be idempotent because delivery is at least once; Reddit and X jobs retain independent states.
   A 503 from a busy/deferred worker is retryable; terminal duplicate, stale or expired deliveries
   are acknowledged without rerunning effects.
10. Add custom domain/TLS and security headers.
11. Promote exact reviewed deployment to Production.

## 8. Initial schedules

Recommended demo default:

- one daily bounded market/watchlist refresh before the presentation window;
- primary period: last 24 hours;
- comparison: previous 7 days or prior equal period;
- one smaller freshness check later in the day if budget allows;
- explicit maximum sources, search calls, tokens, runtime, and cost;
- notifications only for failure, staleness, budget breach, or required human action.

Use the portal schedule preview to verify next five local and UTC times, including daylight-saving
boundaries. Intervals must be 300–31,536,000 seconds; cron is five-field and must not produce
adjacent preview fires less than five minutes apart. Saving or resuming advances the next due time
from the save transaction; missed periods are not backfilled. Trigger `Run now` once and confirm
coalescing against the next scheduled run.

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
