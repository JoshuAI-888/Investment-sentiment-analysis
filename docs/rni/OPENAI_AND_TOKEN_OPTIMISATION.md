# Retail Narrative Intelligence — OpenAI and Token Optimisation

**Default route:** OpenAI Direct  
**Optional route:** Vercel AI Gateway, selected in admin Settings for future runs  
**Objective:** maximise grounded quality per unit of latency and spend without weakening evidence, evaluation, or auditability.

## 1. Routing policy

The application owns a provider-neutral task contract. `OpenAIDirectAdapter` is the default; `VercelGatewayAdapter` is optional. Both must return the same internal envelope: response ID, resolved provider/model, model snapshot when available, structured output, usage, cached tokens, latency, cost estimate, tool calls, citations, and errors.

Route selection order:

1. explicit immutable run configuration;
2. active tenant setting;
3. system default `openai_direct`.

The route never changes mid-run silently. Fallback requires a configured policy, records the before/after route and model, and marks the run. Gateway provider options and failover are configured using current [Vercel AI Gateway provider guidance](https://vercel.com/docs/ai-gateway/models-and-providers/provider-options); the gateway supports the OpenAI Responses API surface ([Vercel announcement](https://vercel.com/changelog/ai-gateway-supports-openais-responses-api)).

## 2. Task-to-model strategy

Do not use one frontier model for every stage.

| Task | Preferred class | Reasoning posture |
|---|---|---|
| Ticker candidate lookup | deterministic SQL/alias matcher | no model unless ambiguity remains |
| Security disambiguation | small/fast structured-output model | low reasoning; bounded candidates |
| Sentiment/claims/themes | capable small model first | batched, strict schema; escalate uncertain cases |
| Embeddings | current supported embedding model | only normalized claim text; deduplicate before call |
| Narrative adjudication | stronger model on candidate pairs/clusters | retrieve top candidates, not whole corpus |
| Catalyst verification | capable model + web/search tools | domain-bounded; preserve sources |
| Challenger/synthesis | stronger model | only approved compact evidence packs |
| Citation validation | deterministic parser + small semantic judge | escalate disagreement/hard cases |
| Eval grading | pinned capable grader | calibrated to humans; offline/batch where practical |

Exact model IDs belong in versioned Settings and eval reports, not hard-coded prose. Upgrade only after regression evaluation.

## 3. Responses API and structured outputs

Use the Responses API for tool-enabled agents and strict JSON schemas for each stage. Structured Outputs constrain model responses to the supplied JSON Schema, reducing parser repair and retry waste ([OpenAI Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs)).

Practices:

- small schemas with enums and required nullable fields;
- stable field order and names across prompt versions;
- no free-form chain-of-thought storage or request;
- bounded evidence excerpts with IDs rather than database dumps;
- validate locally and retry only repairable failures;
- store schema/prompt/model versions and response ID;
- use tool allow-lists per stage;
- do not let source content choose tools.

## 4. Prompt-caching design

OpenAI prompt caching depends on an exact shared prefix. The current guide recommends placing stable content first and dynamic content later; cache usage is visible in token usage ([OpenAI Prompt Caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)).

### 4.1 Stable-prefix layout

```text
1. stable system policy and agent role
2. stable output schema and field definitions
3. stable tool definitions in stable order
4. stable few-shot examples and taxonomy version
5. explicit cache breakpoint when supported
6. dynamic run context, security candidates, evidence excerpts
7. final task instruction
```

Never place timestamps, request IDs, user names, random nonces, or evidence before the reusable prefix.

### 4.2 Tool stability

Removing or reordering tools can invalidate a cached prefix. Keep the canonical tool list/order stable and use `allowed_tools` or an equivalent runtime allow-list when supported rather than rebuilding the definitions per call. Tool authorization remains enforced server-side.

### 4.3 Cache keys and retention

- Derive a stable `prompt_cache_key` from tenant-safe agent/prompt/schema/tool/taxonomy versions, not user content.
- Never share a key across tenants when the prefix contains tenant material.
- For supported current models, explicit and implicit breakpoints may be available, with model-specific limits; the OpenAI guide currently describes up to four cache writes and a `30m` TTL for supported GPT-5.6-era models. Treat these as deploy-time capabilities, not timeless constants.
- Record cache key version, `cached_tokens`, cache-write tokens when reported, and latency/cost.
- Do not reduce security isolation or retain restricted content merely to improve cache hit rate.

### 4.4 Cache KPIs

Measure by agent/prompt/model:

- eligible input tokens;
- cached token ratio;
- cache write/read tokens;
- p50/p95 time to first token and total latency;
- cost per accepted structured object;
- invalid-schema and retry rate;
- cache hit rate after prompt deployment.

## 5. Input-token optimisation

1. **Persist then reference:** source content is stored once; downstream prompts receive evidence IDs plus only relevant spans.
2. **Deterministic prefilter:** SQL and alias matching shortlist securities before model disambiguation.
3. **Claim-first representation:** cluster normalized atomic claims, not entire posts.
4. **Deduplicate:** canonical URL, external ID, content hash, repost relation, and near-duplicate similarity before repeated model work.
5. **Delta process:** new/changed sources since watermark; do not reclassify immutable evidence unless configuration changes.
6. **Candidate retrieval:** pgvector retrieves a small narrative candidate set; model adjudicates only candidates.
7. **Compact vocabularies:** pass active taxonomy nodes relevant to the coverage scope plus a fallback, not every inactive theme.
8. **Batch cautiously:** group compatible items within context/output limits and preserve per-item IDs; isolate pathological long items.
9. **No page payloads:** OpenAI Web Search/source tools return bounded post/excerpt metadata; whole webpage HTML is never sent downstream.
10. **Summary hierarchy:** synthesis receives approved claims/metrics/citations rather than all raw comments.

## 6. Output-token optimisation

- Use enums, numeric scores, evidence span offsets, and concise rationales.
- Set task-specific output limits; large prose is reserved for final synthesis.
- Avoid asking intermediate agents to repeat input text.
- Generate one cited narrative summary, then compose views from structured records.
- Separate user-facing explanation from model-debug rationale.
- Stream only interactive final responses; background pipeline stages prefer complete structured objects.

## 7. Cascades and escalation

Use a measured cascade:

```text
deterministic resolution/prefilter
→ small model structured pass
→ deterministic confidence/validation
→ stronger model only for ambiguity, conflict, high-impact narratives, or failed validation
```

Escalation triggers must be explicit: ambiguous security margin, low classifier probability/calibration bucket, contradictory spans, schema repair failure, high-attention/low-breadth narrative, catalyst importance, or evaluator disagreement. Measure escalation precision; an indiscriminate cascade costs more than a single model.

## 8. Web Search persistence contract

OpenAI Web Search can return current information with citations. Request `web_search_call.action.sources` when available to obtain the fuller list of URLs consulted, and use domain filters for approved source classes; current documentation allows allowed-domain filters and describes a limit of up to 100 domains ([OpenAI Web Search guide](https://developers.openai.com/api/docs/guides/tools-web-search)).

For each discovered Reddit/forum result, persist before interpretation:

- canonical original URL and parsed external post/comment ID;
- source platform/type/community;
- returned title and bounded post/body/excerpt only;
- author display ID only if returned, permitted, and needed;
- published time and explicit precision;
- capture time, discovery query/call ID, provider, rank;
- capture level (`URL_ONLY`, `INDEXED_EXCERPT`, `POST_BODY`, `COMMENT_BODY`);
- content hash, language, availability, and terms/retention policy ID.

Do **not** persist search-result page HTML, source-site page chrome, hidden markup, unrelated comments, cookies, or ads. A comment becomes a separate source only with a stable comment permalink/ID. Discovery metadata that cannot be verified remains nullable/precision-labelled.

### Empirical spike, 4 September 2026

An integrated live search over recent Reddit investing results returned canonical post URLs, URL-parseable post IDs, subreddit, titles, bounded body/excerpts, and publication date/relative timing. Opening a result exposed author/body and some comment permalinks. Exact timestamps, complete comments, and stable score/comment counts were inconsistent. Therefore Web Search is fit for **sampled, evidence-first post discovery and bounded persistence**, but not for exhaustive firehose collection or precise attention-volume measurement. The product must display source coverage and may calculate attention only over the captured sample unless a terms-compliant retail-accessible source offers stronger metadata.

## 9. Cost controls

- Per-run limits for sources, characters, input/output tokens, web-search calls, embedding calls, retries, and wall time.
- Daily/tenant budget with warn, throttle, and stop thresholds.
- Cost estimate before manual full run/backfill.
- Record accepted-object cost rather than raw request cost alone.
- Retry only retryable errors with jitter; never loop on policy/schema failures.
- Offline evaluation and non-urgent backfills may use current lower-cost asynchronous/batch capabilities if compatible with retention and deadline.
- Abort downstream calls when provenance/policy gates fail.

### S&P 500 workload rule

The active universe may contain the complete current S&P 500, but a scheduled Reddit refresh must not generate one Web Search call per ticker per subreddit. Use two bounded modes:

- **scheduled discovery:** community/source-first searches retrieve current candidate discussions, followed by deterministic/LLM security resolution against the active universe;
- **on-demand analysis:** a bounded ticker/company-specific search for the selected active constituent.

X keeps a separate watch/query plan, call budget and checkpoint. Do not spend X quota because Reddit is sparse. Before activating a universe change, estimate scheduled search calls, X reads, expected source objects, model tokens and maximum run cost. Reject or stage a slower cadence when the configured budget would be exceeded.

## 10. Vercel deployment implications

AI Gateway provides a common route and observability but is not the source of business truth. Store provider response IDs, resolved provider/model, token/cost data, and failover path in Neon. Gateway configuration must preserve structured output/tool semantics and citation fields. Provider-specific options are isolated inside adapters.

Long-running end-to-end work should not rely on a single request. Reuse the repository's QStash/job orchestration rather than adding Vercel Cron. Multi-stage runs must be retryable and idempotent; duplicate delivery is expected and must be harmless. Reddit Web Search and X acquisition have separate checkpoints and retry budgets, and neither triggers the other as fallback.

## 11. Privacy and retention

OpenAI API data-retention behaviour and eligibility for modified abuse monitoring or zero-data-retention controls are account/endpoint dependent. Confirm current controls during deployment. Background mode and third-party MCP/tool calls may have distinct constraints. Store only the minimum request/response fields needed for audit and evals; redact secrets and personal data; enforce source and tenant retention policies.

## 12. Build-time token optimisation for coding agents

The five-day demo benefits from context discipline:

- keep one canonical specification per concern and link rather than copy;
- assign parallel branches by exclusive path ownership;
- give coding agents the task contract, owned paths, interfaces, tests, and relevant excerpts only;
- commit generated migrations/types/contracts early so downstream branches target stable interfaces;
- make small commits and request focused reviews;
- run targeted tests locally before broad suites;
- store architectural decisions in short ADRs rather than repeating rationale in prompts;
- use fixtures for the worked two-ticker example across database, pipeline, API, UI, and MCP tests;
- avoid sending raw source corpora to build agents; use sanitised fixtures.

## 13. Acceptance tests

1. OpenAI Direct is selected when no tenant override exists.
2. Gateway route produces the same internal schema and records resolved provider/model.
3. Cached-prefix A/B test preserves output quality and improves measured latency/cost on eligible calls.
4. Dynamic values after the breakpoint do not alter the stable prefix hash.
5. A changed prompt/schema/tool/taxonomy version produces a new cache-key version.
6. Duplicate content is not embedded/classified twice under the same configuration.
7. Small-model escalation matches configured triggers and remains within budget.
8. Web discovery persists canonical original URL plus bounded content/metadata before classification and never stores full HTML.
9. Every model call is attributable to run, stage, source/claim set, route, model, prompt/schema, tokens, cache, latency, and cost.
10. Budget exhaustion stops safely and exposes a partial/non-publishable run.
