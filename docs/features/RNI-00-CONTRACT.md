# RNI-00 — Frozen integration contract

**Status:** binding for the Retail Narrative Intelligence lane.  
**Owner:** RNI coordinator.  
**Scope:** `apps/web/src/rni/**`, `apps/web/app/(rni)/**`, `apps/web/tests/**/rni/**`, new RNI
migrations and `docs/rni/**`.  
**Precedence:** this contract overrides legacy requirements only within that scope. All other
existing contracts remain binding.

## 1. Product invariants

1. Reddit and X are independent sentiment data sources. Neither is a fallback for the other.
2. Every user-facing result has three explicit sections: **Reddit sentiment**, **X sentiment**,
   and **Combined summary**. An unavailable source renders unavailable; it is never inferred.
3. The original discoverable URL and bounded source record are committed before any downstream
   LLM classification, clustering, analytics or synthesis.
4. A source comparing securities creates one source item, one mention per security, and one
   independently classified observation per security. Comparative relations are additional
   records, not a substitute for per-security stance.
5. Explanations and claims require persisted citations. Unsupported prose cannot publish.
6. Deterministic code calculates metrics. LLMs extract or classify semantic content; they do not
   calculate attention, velocity, z-score, breadth, weighted sentiment or confidence arithmetic.
7. RNI defaults to OpenAI Direct. The operator may select Vercel AI Gateway in Settings. This
   task-specific choice must not change the existing application's global transport default.
8. The active universe is the current FMP S&P 500 constituent set, refreshable and configurable.
   NVDA is the default selected security, not a one-symbol corpus.
9. A scheduled run and a manual run use the same idempotent orchestration path and expose last
   successful refresh, current status, data age and source-specific failures.
10. The surface provides bounded raw-data exploration with canonical citations and provenance.

## 2. Namespaces and ownership

| Lane | Exclusive implementation paths |
|---|---|
| DATA | `apps/web/src/rni/contracts/**`, `apps/web/src/rni/repositories/**`, RNI migrations `0020–0023`, `apps/web/tests/{contract,integration}/rni/data/**` |
| ENGINE | `apps/web/src/rni/{adapters,agents,analytics,orchestration,convergence}/**`, `apps/web/prompts/rni/**`, `apps/web/fixtures/rni/**`, engine/eval tests |
| SURFACE | `apps/web/app/(rni)/**`, `apps/web/src/rni/components/**`, `apps/web/tests/e2e/rni/**`, RNI route handlers owned by the contract |
| INTEGRATION | migration `0024`, shared navigation/config wiring, CI, composition roots, deploy verification and these state files |

Historical migrations and `apps/web/migrations/seed/universe-v1.json` are immutable. The RNI
universe change lands as a forward migration and a new versioned seed/snapshot. No lane edits
`apps/web/src/contracts/**` or legacy routes without an accepted coordinator contract change.

## 3. Frozen vocabulary

```ts
type RniPlatform = "reddit" | "x";
type RniCaptureMode = "full_post" | "full_comment" | "excerpt_only";
type RniStance = "strong_bearish" | "bearish" | "neutral" | "bullish" | "strong_bullish" | "insufficient";
type RniSliceStatus = "pending" | "running" | "complete" | "partial" | "failed" | "unavailable";
type RniRunTrigger = "schedule" | "manual" | "api";
type RniAiRoute = "openai_direct" | "vercel_ai_gateway";
type RniDimensionKey = "company_fundamentals" | "market_trading" | "catalyst_event" | "retail_narrative";
```

Administrators may add versioned theme categories, but the four required dimensions remain
present and separately visible. Configuration changes apply only to runs started after the new
version becomes active.

## 4. Source-first persistence

### 4.1 Acquisition

- Reddit acquisition uses OpenAI Responses API Web Search. It does not depend on Reddit API
  credentials. Queries include the configured subreddit group, ticker/company aliases and the
  requested retrieval window.
- Persist only the returned post/comment content or bounded excerpt plus relevant metadata. Do
  not store page HTML, navigation, unrelated comments, advertisements or full search pages.
- X uses the existing authorised X adapter through a new RNI composition layer and remains an
  independent platform slice.
- Canonicalise only for identity matching; preserve the returned original URL for citation.

### 4.2 Minimum source record

`rni_source_item` is append-only for evidence content and includes:

```text
id, platform, external_id?, canonical_url, original_url, subreddit_or_scope,
author_handle_hash?, title?, bounded_content, content_sha256, capture_mode,
published_at?, discovered_at, observed_at, search_query_id?, provider_request_id?,
metadata_json, rights_policy_version, created_at
```

`canonical_url` is unique with platform when an external ID is unavailable. A repeated discovery
upserts mutable observation metadata but never silently replaces different content: changed
content creates a version linked to the prior record.

The transaction that inserts the source item commits before enqueueing semantic work. Downstream
tables require `source_item_id` foreign keys. A classification request without a persisted source
ID fails closed.

### 4.3 Frozen source-persistence port

DATA implements the frozen `RniSourcePersistencePort.commitSource(source)` interface. Its promise
resolves only after the source, retrieval and content-version transaction commits, returning the
durable `sourceItemId` plus explicit `sourceInserted`, `retrievalInserted` and
`contentVersionInserted` idempotency flags. ENGINE may enqueue semantic work only from that
returned identity, never from the caller-proposed `source.id`. Duplicate delivery returns the
existing durable source identity and does not masquerade as a new write.

## 5. Security and observation contract

Security resolution produces `rni_security_mention(source_item_id, security_id, mention_text,
start_offset?, end_offset?, resolution_method, resolution_confidence, model_run_id?)`.

Each resolved mention produces a distinct `rni_security_observation` with:

```text
id, source_item_id, security_id, stance, stance_score, relevance,
claim_summary, time_horizon?, dimension_assignments, classifier_run_id,
prompt_version, model_id, input_hash, created_at
```

Example: “NVDA has execution; AMD is still catching up” becomes one source, bullish NVDA,
bearish AMD, and `rni_comparative_relation(NVDA, preferred_over, AMD)`. One blended stance is
invalid. Ambiguous cashtags/names abstain and enter review rather than being guessed.

## 6. Run and platform slices

`rni_run` stores trigger, requested window, comparison window, universe/config/prompt versions,
AI route, status and timestamps. It owns exactly two `rni_platform_slice` records, one per
platform, each with independent lifecycle, counts, coverage disclosure, freshness and error.

Combined synthesis may run when both slices are terminal (`complete`, `partial`, `failed` or
`unavailable`). Its status is:

- `complete`: both sources meet publication thresholds;
- `partial`: exactly one source is publishable or either has a disclosed coverage gap;
- `insufficient`: neither source is publishable.

It must not numerically pool incomparable samples into a platform-wide sentiment score. It may
describe agreement, disagreement and source-specific magnitude with citations.

## 7. Deterministic analytics

All calculations use decimal-safe pure functions and versioned parameters:

- `sentiment_index = sum(weight_i * stance_score_i) / sum(weight_i)`;
- `attention = count(distinct eligible source_item_id)` within platform/security/window;
- `attention_change = current_attention - comparison_attention` and percent only when baseline > 0;
- `velocity = (current_rate - comparison_rate) / comparison_rate`, otherwise explicit undefined;
- `z_score = (current_value - baseline_mean) / baseline_stddev`, undefined when the baseline is
  too short or standard deviation is zero;
- `breadth = distinct eligible communities_or_scopes`;
- confidence is a versioned deterministic function of evidence volume, source breadth,
  independent narrative count, model agreement, recency and verified-catalyst support, with
  penalties for concentration, ambiguity, staleness and conflicting evidence.

Metric artifacts persist formula version, exact inputs, parameters, result, unit, run ID and
source lineage. Portal settings expose safe, bounded versions of windows, minimum evidence,
weights and taxonomy; invalid combinations are rejected and audited.

## 8. Agent boundary

LLM stages are limited to security/alias resolution assistance, per-security relevance and
stance, claim/theme extraction, narrative clustering assistance, catalyst verification,
challenger analysis and cited synthesis. Every call uses a versioned system prompt, strict
structured output, explicit tool allowlist, token/tool budgets and a persisted model-run record.

OpenAI Web Search citations are discovery candidates, not publication evidence until the bounded
source item exists. Synthesis tools return only persisted evidence IDs and citation URLs.

## 9. Universe contract

FMP `/stable/sp500-constituent` is authoritative for the active S&P 500 snapshot when the plan is
entitled. Sync stages a candidate snapshot, resolves each member to the security master and
publishes an impact preview. Activation fails closed on empty/partial payloads, duplicate or
unresolved members, missing NVDA, or more than 600 members. `joshuai` approves production
activation. Manual inclusions/exclusions are versioned and visible in Settings.

## 10. HTTP and service boundary

Initial authenticated routes:

```text
GET  /api/rni/radar
GET  /api/rni/securities/:ticker
GET  /api/rni/evidence
GET  /api/rni/runs/:runId
POST /api/rni/runs
POST /api/rni/runs/:runId/retry
GET  /api/rni/settings
PATCH /api/rni/settings
POST /api/rni/universe/sync
POST /api/rni/schedules
```

Command routes require CSRF/authz, an idempotency key and audit entry. Read responses expose
source-slice freshness and citation lineage. MCP v1 is read-only and invokes the same read
service; it cannot bypass portal authentication, publication gates or evidence redaction.

`RniReadService.getCitation(citationId)` resolves a summary citation ID to its persisted source
identity, platform, canonical citation URL and bounded supporting text. Consumers then call
`getEvidence(sourceItemId)`; they must not guess that a citation ID is a source ID or bypass the
read service to join storage-private tables.

`RniReadService.getRadarPage(query)` is the cursor-paginated cross-lane boundary for the Retail
Radar. Each row carries the canonical security ID together with ticker, company name and
exchange, plus structurally separate `reddit`, `x` and `combined` cells. Platform cells own
their sample count, coverage, confidence, freshness, stance, explanation and citation IDs;
there is no row-level pooled source count. A combined cell may be aligned or divergent only
when both independently labelled platform cells are terminal and publishable. Pending,
unavailable, failed or insufficient platform states remain explicit and cannot be relabelled as
cross-source agreement.

## 11. Publication and test gates

A claim publishes only when every claim citation resolves to a persisted source item, belongs to
the run/security, and supports the claim. Missing, duplicated, mismatched or unverifiable URLs
cause abstention. Raw explorer content is bounded, escaped and never interpreted as instructions.

Merge acceptance requires frozen tests for: multi-ticker opposing stance; comparative relation;
URL-before-classification; duplicate delivery; excerpt-only capture; Reddit unavailable while X
completes; X unavailable while Reddit completes; cross-source divergence; zero/short baseline;
FMP >500 constituents and invalid payloads; manual double-click and scheduled redelivery; citation
deletion/mismatch; authz; prompt injection; deterministic replay; and legacy regression.

Live source checks are recorded deployment gates, never deterministic CI dependencies.
