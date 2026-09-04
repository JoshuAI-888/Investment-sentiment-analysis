# Retail Narrative Intelligence Data Model and Lineage

**Database:** Neon PostgreSQL  
**Vector extension:** pgvector  
**Rule:** a source URL and retrieval record must commit before any downstream model input references the source.  
**Related:** [ARCHITECTURE.md](ARCHITECTURE.md), [EVALS_AND_GUARDRAILS.md](EVALS_AND_GUARDRAILS.md)

## 1. Conventions

- Primary keys are UUIDv7 unless an upstream immutable string ID is retained.
- Every tenant-owned table includes `tenant_id uuid not null` and RLS/tenant enforcement.
- Timestamps are `timestamptz`; analytic windows are half-open `[start_at, end_at)`.
- Money is never required for sentiment metrics; when stored, use decimal plus currency.
- JSONB is reserved for provider-native payloads, rule ASTs, schemas, and debug traces. Query-critical lineage uses foreign keys.
- Every derived record stores `run_id`, `methodology_version_id`, `created_at`, and an input hash or explicit input edges.
- Soft/tombstone state is used for source removal and legal restriction. Retention workers may erase permitted content while preserving minimal non-content audit fields where lawful.
- Enumeration values are constrained in the database or generated from contract schemas.

## 2. Entity graph

```text
tenant
  -> configuration_release
  -> analysis_schedule -> schedule_fire -> analysis_run -> analysis_window
                                             |
                                             +-> source_retrieval -> source_item -> source_content_version
                                             |                         |
                                             |                         +-> security_mention -> sentiment_observation
                                             |                         |                        |
                                             |                         |                        +-> observation_theme
                                             |                         +-> evidence_claim ------+
                                             |                                  |
                                             |                                  +-> claim_embedding
                                             |                                  +-> narrative_membership -> narrative
                                             |                                  +-> verification_record
                                             |
                                             +-> model_invocation -> model_input_evidence
                                             +-> metric_fact -> confidence_assessment
                                             +-> policy_evaluation
                                             +-> publication -> publication_sentence -> sentence_citation
```

## 3. Configuration and governance tables

### `tenant`

| Field | Type | Rule |
|---|---|---|
| `id` | uuid PK | Tenant boundary. |
| `slug` | text unique | Stable URL key. |
| `display_name` | text | Human label. |
| `default_timezone` | text | IANA name, e.g. `Pacific/Auckland`. |
| `status` | enum | `ACTIVE|SUSPENDED`. |

### `configuration_release`

Immutable manifest activated as a unit.

| Field | Type | Rule |
|---|---|---|
| `id` | uuid PK | Release ID. |
| `tenant_id` | uuid FK | Required. |
| `version` | integer | Unique per tenant. |
| `status` | enum | `DRAFT|IN_REVIEW|ACTIVE|SUPERSEDED|REJECTED`. |
| `methodology_version_id` | uuid FK | Metric/confidence formulas and parameters. |
| `theme_set_version_id` | uuid FK | Active taxonomy. |
| `policy_set_version_id` | uuid FK | Publication rules. |
| `agent_bundle_version_id` | uuid FK | Agent/prompt/tool definitions. |
| `source_config_version_id` | uuid FK | Sources, communities, weights, retention. |
| `model_route_config_id` | uuid FK | Direct/gateway capability profiles. |
| `created_by`, `reviewed_by`, `activated_by` | uuid | Separation of duties. |
| `created_at`, `activated_at` | timestamptz | Audit. |
| `content_hash` | text | Canonical manifest hash. |

### `agent_definition` and `prompt_version`

| Field | Type | Rule |
|---|---|---|
| `agent_definition.id` | uuid PK | Immutable definition version. |
| `agent_key` | text | `discovery`, `security_resolver`, `semantic_classifier`, `narrative_adjudicator`, `catalyst_verifier`, `challenger`, `synthesizer`, `eval_coach`. |
| `system_prompt_version_id` | uuid FK | Points to immutable prompt text. |
| `input_schema_id`, `output_schema_id` | uuid FK | JSON Schema registry. |
| `tool_allowlist` | text[] | Stable tool names. |
| `capability_profile` | text | e.g. `structured_low_cost`, `web_research`, `synthesis`. |
| `reasoning_effort`, `max_input_tokens`, `max_output_tokens`, `timeout_ms` | typed | Validated bounds. |
| `retry_policy` | jsonb | Constrained schema, no code. |
| `eval_suite_id` | uuid FK | Gate before activation. |
| `prompt_version.template` | text | Stable instruction text with named variables. |
| `prompt_version.content_hash` | text | Cache/version identity. |

### `source_community` and `source_community_cluster`

These tables make the requested initial subreddit list versioned and keep provenance separate from analytical grouping.

| Field | Type | Rule |
|---|---|---|
| `source_community.id` | uuid PK | Immutable row version. |
| `source_config_version_id` | uuid FK | Owning source configuration. |
| `platform`, `community_key` | text | For example `REDDIT`, `wallstreetbets`, or `X`, an approved watch/query key; unique per configuration. |
| `display_name` | text | For example `r/wallstreetbets`. |
| `monitoring_group` | enum | `PRIMARY|CONCENTRATED|SECTOR_TICKER|LONG_HORIZON`. |
| `enabled`, `cadence_class` | typed | Primary uses every eligible cadence. |
| `default_weight` | numeric | Bounded; does not replace breadth/concentration checks. |
| `terms_policy_id`, `retention_policy_id` | uuid FK | Current approved use. |
| `source_community_cluster.id` | uuid PK | Analytical cluster version. |
| `cluster_key` | text | e.g. `GME_RETAIL_CLUSTER`. |
| `member_community_id` | uuid FK | `r/Superstonk` and `r/GME` are separate members. |

`source_item.community` always stores the exact source community. Metrics expose `distinct_exact_communities` and `distinct_community_clusters`; independence/concentration uses the more conservative cluster-adjusted measure.

### `theme_definition`

| Field | Type | Rule |
|---|---|---|
| `id` | uuid PK | Versioned row. |
| `theme_set_version_id` | uuid FK | Immutable set. |
| `stable_key` | text | Persists across renames. |
| `name`, `description` | text | Clear classifier definition. |
| `parent_stable_key` | text nullable | Hierarchy. |
| `synonyms` | text[] | Admin maintained. |
| `positive_examples`, `negative_examples` | jsonb | Reviewed examples with source rights. |
| `classification_threshold` | numeric(5,4) | `[0,1]`. |
| `enabled` | boolean | Disabled themes stay interpretable on old runs. |

### `policy_definition`

| Field | Type | Rule |
|---|---|---|
| `id` | uuid PK | Immutable rule version. |
| `policy_set_version_id` | uuid FK | Set membership. |
| `stable_key`, `name`, `description` | text | Human-readable identity. |
| `severity` | enum | `INFO|WARN|WITHHOLD_FINDING|BLOCK_RUN`. |
| `expression_ast` | jsonb | Allowlisted fields/operators only. |
| `enabled` | boolean | Versioned. |
| `message_template` | text | Display reason. |
| `test_case_ids` | uuid[] | Required positive/negative tests. |

## 4. Security master

### `issuer`

`id`, `legal_name`, `display_name`, `country_code`, `lei nullable`, `cik nullable`, `website_url`, `ir_url`, `active_from`, `active_to`.

### `security`

`id`, `issuer_id`, `security_type`, `primary_ticker`, `exchange_mic`, `currency`, `isin nullable`, `figi nullable`, `cusip nullable restricted`, `active_from`, `active_to`, `status`, `security_master_version`.

### `security_alias`

`id`, `security_id`, `alias_text`, `alias_type` (`TICKER|COMPANY|PRODUCT|FORMER_TICKER`), `valid_from`, `valid_to`, `case_sensitive`, `ambiguity_class`, `source_url`.

Every portal/API result joins security to issuer so the display can always be `ticker — company`.

### `universe_version` and `universe_member`

Reuse the repository's existing governed universe tables. The active default is a normalized snapshot from FMP's current [`/stable/sp500-constituent`](https://site.financialmodelingprep.com/developer/docs/stable/sp-500) endpoint, not a hard-coded or social-attention-selected list.

`universe_version`: `id`, `environment`, `config_version`, `status`, `parent_version`, `selected_count`, `selection_query`, `impact_preview`, `source_provider`, `source_endpoint`, `source_retrieved_at`, `source_payload_hash`, `provider_call_id`, `created_by`, `change_reason`, `created_at`, `activated_at`, `approved_by`.

`universe_member`: `universe_version`, `security_id`, `enabled`, `added_by`, `selection_source` (`FMP_SP500|CHECKBOX|BULK_FILTER|IMPORT|PRESET`), `provider_symbol`, `provider_company_name`, `constituent_first_added_at nullable`, `created_at`.

The existing 100-member check is replaced by a forward migration with a 600-member database safety ceiling. The configured active maximum can be lower but never higher. Synchronization is atomic: empty, duplicate, unresolved, ambiguous, incomplete or over-ceiling input cannot activate. A successful refresh creates a new version; historical runs retain their original `universe_version`.

## 5. Runs and schedules

### `analysis_schedule`

| Field | Type | Rule |
|---|---|---|
| `id` | uuid PK | Schedule. |
| `tenant_id` | uuid FK | Required. |
| `name` | text | Human label. |
| `rrule_or_cron` | text | Parsed by scheduler service; UI renders meaning. |
| `timezone` | text | IANA timezone. |
| `universe_definition` | jsonb | Defaults to the active FMP S&P 500 universe version; may contain a governed staged/custom selection. |
| `run_mode` | enum | `REFRESH_DATA|RECOMPUTE|FULL_RERUN`. |
| `configuration_release_id` | uuid FK | Pinned or `use_active=true`. |
| `next_due_at`, `last_attempt_at`, `last_success_at` | timestamptz | Kept separate. |
| `enabled` | boolean | Operational control. |

### `schedule_fire`

`id`, `schedule_id`, `due_at`, `claimed_at`, `run_id`, `status`, unique `(schedule_id, due_at)`. This is the scheduler idempotency boundary.

### `analysis_run`

| Field | Type | Rule |
|---|---|---|
| `id` | uuid PK | Run ID. |
| `request_type` | enum | `USER|SCHEDULE|API|MCP|BACKFILL`. |
| `requested_by` | uuid nullable | Actor. |
| `idempotency_key` | text | Unique per tenant/request family. |
| `status` | enum | Lifecycle in PRD. |
| `coverage_mode` | enum | Legacy/run-level envelope only; platform truth lives in `run_source_slice`. |
| `configuration_release_id` | uuid FK | Immutable manifest. |
| `ai_route_requested`, `ai_route_actual` | enum | Direct/gateway. |
| `code_commit_sha` | text | Reproducibility. |
| `as_of`, `started_at`, `completed_at` | timestamptz | Timing. |
| `source_success_count`, `source_failure_count` | integer | Honest coverage. |
| `limitation_summary` | text | Required for sampled mode. |

### `analysis_window`

`run_id`, `window_kind` (`PRIMARY|PREVIOUS_EQUIVALENT|TRAILING_CONTEXT|BASELINE`), `start_at`, `end_at`, `configured_days`, `timezone`, unique `(run_id, window_kind)`.

### `run_source_slice`

One independently executed platform slice per run/window. This prevents an X result from being mistaken for a Reddit fallback or a combined result.

| Field | Type | Rule |
|---|---|---|
| `id`, `run_id` | uuid | Durable identity and parent run. |
| `platform` | enum | `REDDIT|X`; unique with run/window/source-config version. |
| `acquisition_method` | enum | `OPENAI_WEB_SEARCH|X_ADAPTER`. |
| `coverage_mode` | enum | `REDDIT_SAMPLED_WEB_DISCOVERY|X_CONFIGURED_SAMPLE`. |
| `status` | enum | `QUEUED|RUNNING|COMPLETE|PARTIAL|INSUFFICIENT|FAILED`. |
| `source_config_version_id` | uuid FK | Exact subreddit policy or X watch/query configuration. |
| `attempted_at`, `last_success_at`, `data_through_at`, `computed_at` | timestamptz nullable | Never substitute attempt for success. |
| `usable_source_count`, `failed_source_count` | integer | Platform-specific denominators. |
| `limitation_summary`, `failure_code` | text nullable | Required for incomplete/failed states. |

The combined stage references both slice IDs. It never overwrites either slice.

## 6. Source provenance

### `source_item`

One external post, comment, filing, article, video episode, or other source object.

| Field | Type | Rule |
|---|---|---|
| `id` | uuid PK | Evidence ID. |
| `tenant_id` | uuid FK | Boundary. |
| `platform` | enum | `REDDIT|X|SEC|COMPANY_IR|NEWS|YOUTUBE|PODCAST|SUBSTACK|MARKET_DATA|OTHER`. |
| `source_type` | enum | `POST|COMMENT|ARTICLE|FILING|TRANSCRIPT|VIDEO|DATA_POINT`. |
| `external_id` | text nullable | Reddit `t3_x`/`t1_x`, filing accession, etc. |
| `parent_source_item_id` | uuid nullable FK | Comment→post, filing exhibit→filing. |
| `original_url` | text | Required; source URL, not search-result URL. |
| `canonical_url` | text | Canonicalized, with original retained. |
| `community` | text nullable | e.g. subreddit. |
| `author_hash` | text nullable | Tenant-salted if permitted. |
| `title` | text nullable | Post/article title. |
| `source_created_at` | timestamptz nullable | Null when only relative/unknown; do not guess. |
| `source_created_at_precision` | enum | `EXACT|DATE|RELATIVE|UNKNOWN`. |
| `status` | enum | `ACTIVE|DELETED|UNAVAILABLE|RESTRICTED|TOMBSTONED`. |
| `first_seen_at`, `last_seen_at` | timestamptz | Retrieval observations. |
| `natural_key_hash` | text | Unique with tenant/platform. |

### `source_retrieval`

| Field | Type | Rule |
|---|---|---|
| `id` | uuid PK | Each discovery/fetch event. |
| `run_id`, `source_item_id` | uuid FK | Required. |
| `provider` | text | `OPENAI_WEB_SEARCH`, `X_ADAPTER`, etc. Reddit Data API is not a configured dependency. |
| `provider_request_id` | text nullable | Trace. |
| `retrieval_query` | text | Exact normalized query or endpoint params. |
| `retrieved_at` | timestamptz | System time. |
| `rank` | integer nullable | Search rank. |
| `returned_url` | text | Provider-returned URL. |
| `citation_label` | text nullable | Provider annotation. |
| `capture_level` | enum | `URL_ONLY|INDEXED_EXCERPT|POST_BODY|POST_AND_SELECTED_COMMENTS|FULL_PERMITTED_OBJECT`. |
| `http_status` | integer nullable | Direct fetch only. |
| `provider_payload_hash` | text | Integrity. |
| `terms_policy_version` | text | Acquisition policy. |

### `source_content_version`

| Field | Type | Rule |
|---|---|---|
| `id` | uuid PK | Content version. |
| `source_item_id`, `source_retrieval_id` | uuid FK | Provenance. |
| `content_text` | text nullable | Only permitted post/comment/excerpt, never page chrome. |
| `content_format` | enum | `PLAIN_TEXT|MARKDOWN|JSON_FIELDS`. |
| `language` | text nullable | BCP-47. |
| `content_hash` | text | SHA-256 over normalized permitted content. |
| `normalization_version` | text | Transform. |
| `is_complete_object` | boolean | False for search excerpt. |
| `retention_expires_at` | timestamptz nullable | Policy. |
| `redaction_state` | enum | `NONE|PII_REDACTED|CONTENT_REMOVED`. |

**Database enforcement:** a deferred constraint/trigger rejects `model_input_evidence` when `source_item.first_seen_at > model_invocation.started_at` or no committed retrieval/content version exists. `URL_ONLY` cannot be semantic model input.

## 7. Semantic objects

### `security_mention`

`id`, `source_content_version_id`, `security_id nullable`, `matched_text`, `start_offset`, `end_offset`, `resolution_method`, `resolution_confidence`, `resolver_invocation_id nullable`, `status` (`RESOLVED|AMBIGUOUS|UNRESOLVED|REJECTED`). Offsets address the exact normalized content version.

### `sentiment_observation`

| Field | Type | Rule |
|---|---|---|
| `id` | uuid PK | Per source/security/dimension. |
| `security_mention_id`, `security_id` | uuid FK | Required and consistent. |
| `dimension` | enum | `STOCK|COMPANY|TRADING_INTENT|THEME`. |
| `direction_score` | numeric(5,4) | `[-1,1]`. |
| `label` | enum | `STRONG_BEARISH|BEARISH|NEUTRAL|BULLISH|STRONG_BULLISH|INSUFFICIENT`. |
| `classification_confidence` | numeric(5,4) | Model confidence, not system confidence. |
| `support_start`, `support_end` | integer | Span offsets. |
| `is_sarcastic`, `is_meme`, `is_spam` | boolean | Labels. |
| `sarcasm_probability`, `meme_probability`, `spam_probability` | numeric(5,4) | `[0,1]`. |
| `investment_information_score` | numeric(5,4) | `[0,1]`. |
| `assertion_strength`, `evidence_quality` | numeric(5,4) | `[0,1]`. |
| `classifier_invocation_id` | uuid FK | Model provenance. |
| `observation_schema_version` | text | Contract. |

Unique: `(security_mention_id, dimension, classifier_invocation_id)`.

### `security_relationship`

`id`, `source_content_version_id`, `subject_security_id`, `object_security_id`, `relationship_type`, `direction_confidence`, `support_start`, `support_end`, `classifier_invocation_id`.

### `evidence_claim`

`id`, `source_content_version_id`, `security_id nullable`, `claim_text`, `claim_type` (`FACT_ASSERTION|OPINION|FORECAST|POSITION|QUESTION|JOKE`), `epistemic_status` (`SOURCE_CLAIM|VERIFIED_FACT|ANALYTICAL_INFERENCE|UNVERIFIED|CONTRADICTED`), `support_start`, `support_end`, `extractor_invocation_id`.

### `observation_theme`

`observation_id`, `theme_definition_id`, `classification_confidence`, `theme_direction_score`, PK `(observation_id, theme_definition_id)`.

## 8. Vectors and narratives

### `claim_embedding`

| Field | Type | Rule |
|---|---|---|
| `claim_id` | uuid PK/FK | One current vector per embedding version. |
| `embedding_model` | text | Exact model ID. |
| `embedding_dimensions` | integer | Must match column/index profile. |
| `embedding` | `vector(n)` | Dimension fixed by migration/profile. |
| `input_hash` | text | Reuse/dedup. |
| `created_at` | timestamptz | Audit. |

At demo scale, use exact cosine distance. HNSW is optional after measured recall/latency tests. Neon supports pgvector and documents HNSW/IVFFlat tradeoffs; see [Neon vector optimization](https://neon.com/docs/ai/ai-vector-search-optimization).

### `narrative`

`id`, `run_id`, `security_id nullable`, `canonical_thesis`, `direction`, `horizon`, `status`, `adjudicator_invocation_id`, `first_source_at`, `last_source_at`, `independent_source_count`, `raw_repetition_count`.

### `narrative_membership`

`narrative_id`, `claim_id`, `similarity`, `membership_confidence`, `is_independent`, `duplicate_group_hash`, `adjudication_reason`, PK `(narrative_id, claim_id)`.

### `verification_record`

`id`, `claim_id`, `verdict`, `verified_statement`, `verification_source_item_id`, `verifier_invocation_id`, `source_quality`, `published_at`, `checked_at`, `limitations`. Every factual verdict has at least one source edge or is `UNVERIFIED`.

## 9. Model invocation lineage

### `model_invocation`

`id`, `run_id`, `stage`, `route`, `provider`, `model`, `capability_profile`, `agent_definition_id`, `prompt_version_id`, `input_schema_id`, `output_schema_id`, `started_at`, `completed_at`, `provider_request_id`, `status`, `refusal_reason`, `input_tokens`, `output_tokens`, `cached_input_tokens`, `cache_write_tokens`, `tool_call_count`, `latency_ms`, `cost_amount nullable`, `cost_currency nullable`, `request_hash`, `response_hash`, `retry_of_id nullable`.

### `model_input_evidence`

`model_invocation_id`, `source_item_id`, `source_content_version_id`, `purpose`, `input_order`, PK `(model_invocation_id, source_content_version_id, purpose)`.

### `model_tool_call`

`id`, `model_invocation_id`, `tool_name`, `arguments_redacted`, `started_at`, `completed_at`, `status`, `result_hash`, `source_retrieval_id nullable`.

Provider payloads containing sensitive content are encrypted/restricted and retention-limited. Canonical usage stays queryable.

## 10. Deterministic metrics

All parameters below live in an immutable `methodology_version.parameters` document with schema/range validation. Portal editing creates a draft version; it cannot mutate old results.

### 10.1 Observation weight

For observation `i`:

```text
base_quality_i = information_i × evidence_quality_i × assertion_strength_i
noise_i = (1 - sarcasm_p_i) × (1 - spam_p_i) × (1 - meme_penalty × meme_p_i)
independence_i = 1 / sqrt(max(1, duplicate_group_size_i))
freshness_i = exp(-ln(2) × age_hours_i / half_life_hours)
weight_i = clamp(base_quality_i × noise_i × independence_i × source_weight × community_weight × freshness_i, 0, 1)
```

Default `meme_penalty=0.9`, `half_life_hours=24`; defaults are hypotheses requiring eval/calibration, not universal truths.

### 10.2 Effective attention

```text
raw_mentions = count(distinct eligible security_mentions)
effective_attention = Σ weight_i
```

Raw mentions show conversation volume. Effective attention discounts low-information, duplicate, and stale observations. Both must be displayed so weighting is auditable.

### 10.3 Sentiment index

For security `s`, dimension `d`, window `w`:

```text
mean_direction = Σ(weight_i × direction_score_i) / Σ(weight_i)
sentiment_index = round(100 × mean_direction, 1)
```

Range is `-100` to `+100`. Require minimum effective attention and minimum independent sources; otherwise publish `INSUFFICIENT_EVIDENCE`.

### 10.4 Attention change and velocity

```text
absolute_change = attention_current - attention_previous
percent_change = absolute_change / max(attention_previous, epsilon)
velocity = attention_current / window_duration_days
acceleration = velocity_current - velocity_previous
```

When the previous value is below `low_base_threshold`, percent change is suppressed because tiny denominators exaggerate growth. Show absolute change and “emerging from low base.”

### 10.5 Attention z-score

For a rolling baseline of comparable windows:

```text
x_t = log1p(effective_attention_t)
z = (x_t - mean(x_baseline)) / stddev_samp(x_baseline)
```

Winsorize baseline `x` at configurable percentiles before mean/stddev. Require at least `min_baseline_windows` (default 20) and non-zero standard deviation. A z-score of `+2` means current log-attention is two baseline standard deviations above its normal level; it is unusual attention, not a 98% probability of a price move and not a sentiment direction.

### 10.6 Breadth and concentration

```text
author_breadth = distinct permitted author_hashes
community_breadth = distinct communities
narrative_breadth = count(independent narratives)
share_k = narrative_effective_attention_k / total_effective_attention
narrative_hhi = Σ share_k²
```

HHI approaches 1 when attention is concentrated in one repeated thesis. Display raw author breadth only where identifiers are permitted; otherwise use source and community breadth.

### 10.7 Confidence engine

Each component is `[0,1]` and records its inputs:

| Component | Default weight | Meaning |
|---|---:|---|
| Provenance integrity | 0.20 | URL, permitted text/span, timestamps, lineage, and citation health. |
| Evidence quality | 0.20 | Information, source quality, assertion support, and catalyst corroboration. |
| Security resolution | 0.15 | Weighted confidence that observations refer to the correct security. |
| Breadth and independence | 0.15 | Independent narratives/sources/communities versus repetition. |
| Model calibration | 0.15 | Relevant eval performance for this dimension/source/slice and schema success. |
| Coverage and recency | 0.10 | Source success, compatible windows, freshness, and missingness. |
| Contradiction handling | 0.05 | Whether credible contrary evidence was searched and represented. |

```text
base = Σ(component_j × configured_weight_j)
penalty = unresolved_material_claim_penalty
        + high_noise_penalty
        + suspected_coordination_penalty
        + route_capability_degradation_penalty
confidence_score = round(100 × clamp(base - penalty, 0, 1))
```

Default bands: `<40 LOW`, `40–69 MEDIUM`, `70–84 HIGH`, `85–100 VERY_HIGH`. Confidence means “defensibility of this system result given evidence and method,” not likelihood the stock rises or the underlying claim is true. Admin may adjust weights/bands only through a methodology release; weights must sum to 1.

### `metric_fact`

`id`, `run_id`, `run_source_slice_id`, `platform_scope` (`REDDIT|X`), `security_id nullable`, `theme_definition_id nullable`, `window_kind`, `dimension nullable`, `metric_key`, `numeric_value`, `unit`, `sample_count`, `effective_sample_size`, `methodology_version_id`, `calculation_code_version`, `input_set_hash`, `calculation_trace jsonb`.

Platform-specific metrics are mandatory. No `COMBINED` metric row may be created by simply pooling Reddit and X observations or raw counts.

### `confidence_assessment`

`id`, `run_id`, `run_source_slice_id`, `platform_scope` (`REDDIT|X`), `subject_type`, `subject_id`, `score`, `band`, `component_values jsonb`, `penalties jsonb`, `methodology_version_id`.

### `cross_source_summary`

`id`, `run_id`, `security_id`, `reddit_source_slice_id`, `x_source_slice_id`, `status` (`COMPLETE_CROSS_SOURCE|DIVERGENT_CROSS_SOURCE|PARTIAL_CROSS_SOURCE|INSUFFICIENT_CROSS_SOURCE`), `reddit_metric_fact_ids uuid[]`, `x_metric_fact_ids uuid[]`, `agreement_facts jsonb`, `publication_id nullable`, `methodology_version_id`, `created_at`.

`agreement_facts` is deterministic and contains comparable-window direction deltas, dimension-level agreement flags and missing/stale-source flags. Narrative prose belongs in the cited publication. The row cannot replace or mutate either platform's metric/confidence records.

## 11. Policies, publications, and citations

### `policy_evaluation`

`id`, `run_id`, `policy_definition_id`, `subject_type`, `subject_id`, `result` (`PASS|WARN|WITHHOLD|BLOCK`), `input_snapshot`, `message`, `evaluated_at`, `engine_version`.

### `publication`

`id`, `run_id`, `publication_type`, `version`, `status` (`DRAFT|PUBLISHED|WITHHELD|RETRACTED|EVIDENCE_RESTRICTED`), `published_at`, `content_hash`, `supersedes_id nullable`.

### `publication_sentence`

`id`, `publication_id`, `ordinal`, `sentence_text`, `statement_class` (`SYSTEM_METRIC|VERIFIED_FACT|SOURCE_CLAIM|ANALYTICAL_INFERENCE|LIMITATION`), `synthesizer_invocation_id`.

### `sentence_citation`

`publication_sentence_id`, `evidence_claim_id nullable`, `metric_fact_id nullable`, `source_item_id`, `citation_label`, `validation_status`, `validated_at`, PK across sentence and cited object.

Any sentence class other than `LIMITATION` requires an appropriate metric or source citation. “Why” API responses are projections of these rows, never newly generated uncited text.

## 12. Freshness model

### `freshness_state`

`tenant_id`, `scope_type` (`SOURCE|COMMUNITY|SECURITY|RADAR|PUBLICATION`), `scope_id`, `last_attempt_at`, `last_success_at`, `data_through_at`, `expected_interval_seconds`, `lag_seconds`, `status` (`FRESH|AGING|STALE|UNKNOWN|FAILED`), `reason`.

Default status calculation:

```text
age = now - data_through_at
FRESH   if age <= expected_interval × green_multiplier
AGING   if age <= expected_interval × amber_multiplier
STALE   otherwise
FAILED  if latest required acquisition failed and no newer success exists
UNKNOWN if no successful retrieval exists
```

The UI displays both `data_through_at` and `last_success_at`; `last_attempt_at` cannot masquerade as freshness.

## 13. Audit and reliability tables

- `stage_run`: lease, attempt, status, input/output hashes, error class, retry time.
- `event_outbox`: transactional event payload and publish status.
- `event_inbox`: consumed event ID and handler version for deduplication.
- `audit_event`: actor, action, object, before/after hashes, IP/session metadata, timestamp.
- `review_queue_item`: unresolved security, failed citation, high-impact low-confidence output, proposed config change.
- `export_job`: filters, requester, row count, expiry, policy decision.
- `deletion_request`: source/platform key, scope, status, verification, completed time.
- `eval_run`, `eval_item_result`, `eval_recommendation`: detailed in Evals spec.

## 14. Field-to-field lineage

| Published field | Direct source | Transform | Upstream fields |
|---|---|---|---|
| Ticker/company | `security` + `issuer` | Active-as-of join | `security.primary_ticker`, `issuer.display_name`, security-master version. |
| Source link | `source_item` | None | `original_url`; returned URL preserved in `source_retrieval`. |
| Source excerpt | `source_content_version` | Permitted normalization/redaction | Retrieval capture, normalization version, content hash. |
| Dimension score | `metric_fact` | Weighted mean ×100 | Observation direction/quality/noise; duplicate group; source/community weights; freshness. |
| Attention | `metric_fact` | Count and sum weights | Eligible mentions and observation weights. |
| Attention change | `metric_fact` | Current minus previous; guarded ratio | Comparable primary and previous window metrics. |
| Z-score | `metric_fact` | Log1p, winsorized baseline standardization | Baseline window attention values and parameters. |
| Narrative | `narrative` | Vector candidates + LLM adjudication | Claims, embeddings, similarity, adjudicator version. |
| Catalyst status | `verification_record` | Verifier proposal + evidence class | Source claim and external source item(s). |
| Confidence | `confidence_assessment` | Weighted components minus penalties | Provenance, quality, resolution, breadth, eval slice, coverage, contradiction. |
| Why sentence | `publication_sentence` | Bounded synthesis | Approved metric facts and citation manifest. |
| Citation | `sentence_citation` | Deterministic validation | Claim/metric → observation/verification → source item → original URL. |

## 15. Worked multi-ticker example

Source text:

> “Broadcom is probably the better company but NVDA has way more momentum. AVGO feels too expensive after earnings, so I'd rather buy NVDA calls.”

Persisted sequence:

1. `source_item SRC-2001`: `platform=REDDIT`, `source_type=POST`, original URL, external post ID, subreddit, source time.
2. `source_retrieval RET-2001`: exact query, OpenAI Web Search provider, retrieved time, `POST_BODY` or `INDEXED_EXCERPT` capture level.
3. `source_content_version CNT-2001`: only the post text above, not page navigation or unrelated recommendations.
4. Mentions: `M-AVGO` at the AVGO/Broadcom spans and `M-NVDA` at NVDA spans.
5. AVGO observations: company `+0.75`; stock `-0.55`; trading intent `-0.40`; AI theme `+0.80`.
6. NVDA observations: company `+0.55`; stock `+0.40`; trading intent `+0.90`; AI theme `+0.80`.
7. Relationship: `NVDA PREFERRED_OVER AVGO` with exact supporting span.
8. Claims: Broadcom business quality positive; AVGO valuation expensive; NVDA momentum stronger; author prefers NVDA calls.
9. Narrative memberships keep valuation and momentum mechanisms distinct unless adjudicator evidence justifies a shared comparison narrative.
10. Metrics aggregate AVGO and NVDA independently. The common source contributes to each with separate quality and direction.
11. Publication sentence “Retail discussion in this sample prefers NVDA to AVGO on momentum while still viewing Broadcom's business positively” cites `SRC-2001` and both observation IDs.

Regression assertions:

- exactly one source item and one content version;
- two resolved securities;
- no `source_sentiment` field/table exists;
- four applicable dimension rows per security;
- relationship direction is not reversed;
- every observation support span lies inside `CNT-2001`;
- published sentence fails if the source URL or either required observation edge is removed.

## 16. Live Web Search persistence spike

On 2026-09-04, the available live web-search surface was tested against current r/stocks and r/wallstreetbets results. It returned pages such as an AVGO discussion and LULU/NVDA threads with canonical post URL, subreddit, parseable Reddit post ID, title, post text or excerpt, visible publication timing, and selected comments. Opening the AVGO result exposed the author and comment permalinks such as `/comment/{comment_id}/`.

Sample canonical results used in the spike (volatile external content):

- [AVGO discussion in r/stocks](https://www.reddit.com/r/stocks/comments/1w68fx4/avgo_missed_opportunity_or_value_trap_curious/)
- [LULU discussion in r/wallstreetbets](https://www.reddit.com/r/wallstreetbets/comments/1w6ja03/lulu_is_anyone_in_this_bloodbath/)
- [NVIDIA/Hugging Face discussion in r/stocks](https://www.reddit.com/r/stocks/comments/1w6wwp0/official_nvidia_to_acquire_hugging_face/)

Fitness by field:

| Field | Observed fitness | Persistence rule |
|---|---|---|
| Original post URL | High | Required; store verbatim plus canonical URL. |
| External post ID | High | Parse only from validated Reddit URL; store `t3_` prefix in normalized form. |
| Subreddit/community | High | Parse URL and cross-check visible page label. |
| Title | High | Persist normalized title. |
| Post body | Medium-high | Persist returned post body with capture level and content hash; mark incomplete if excerpted. |
| Retrieval time | High | System timestamp. |
| Exact creation timestamp | Low-medium | Persist only when exact; otherwise date/relative precision plus null exact time. |
| Author | Medium | Store tenant-salted hash only if returned and permitted; not required for signal. |
| Score/upvotes | Low-medium | Treat as volatile retrieval snapshot, not authoritative or stable. |
| Comment count | Low | Do not use as a complete denominator. |
| Selected comment text | Medium | Persist each as a separate `source_item` only with a comment permalink/ID; otherwise keep as unaddressable excerpt excluded from independent counts. |
| All comments | Not fit | Requires an approved Reddit/API acquisition path. |

Conclusion: Web Search is fit for **sampled post-level discovery and evidence persistence** when the stored object is the returned post/excerpt plus relevant metadata—not the whole webpage. It is not fit for exhaustive comment ingestion, exact volume measurement, or stable engagement statistics. The test used the integrated search surface because no project `OPENAI_API_KEY` was available in the workspace; implementation must repeat the spike against the raw Responses API payload and archive a sanitized fixture before closing the acquisition task.

## 17. Required database tests

- Foreign-key and tenant-boundary tests for every lineage edge.
- Transaction test proving source commit precedes model-input insert.
- Unique/idempotency tests for schedule fires, source upsert, stage retries, observations, and publications.
- Property tests for metric ranges, zero denominators, low baselines, constant baselines, and weight normalization.
- Golden SQL snapshot for the multi-ticker example.
- RLS tests for portal and MCP roles, including guessed IDs and cross-tenant joins.
- Retention/takedown test that removes displayable content and updates affected publication state.
- Vector recall benchmark against exact search before enabling approximate index.
- Migration forward/backward or forward-fix rehearsal on an isolated Neon branch.
