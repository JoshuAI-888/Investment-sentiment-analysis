-- 0024 — RNI S&P 500 universe upgrade (D-RNI-06).
--
-- The original governed universe was deliberately capped at 100 members. RNI uses a current,
-- versioned FMP S&P 500 snapshot, so this forward-only migration raises the hard database
-- ceiling to 600 and adds the lineage needed to stage that snapshot without rewriting any
-- historical universe version or member.

alter table universe_version
  drop constraint universe_version_max_symbols_check;

alter table universe_version
  add constraint universe_version_max_symbols_check
  check (selected_count between 0 and 600);

alter table universe_version
  add column source_provider text null,
  add column source_endpoint text null,
  add column source_retrieved_at timestamptz null,
  add column source_payload_hash text null,
  add column provider_call_id uuid null references provider_call_log (id),
  add column approved_by text null,
  add constraint universe_version_source_payload_hash_check check (
    source_payload_hash is null or source_payload_hash ~ '^[0-9a-f]{64}$'
  ),
  add constraint universe_version_fmp_lineage_check check (
    source_provider is distinct from 'fmp'
    or (
      source_endpoint = '/stable/sp500-constituent'
      and source_retrieved_at is not null
      and source_payload_hash is not null
      and provider_call_id is not null
    )
  );

comment on constraint universe_version_max_symbols_check on universe_version is
  'D-RNI-06. 600 is a safety ceiling for a complete current S&P 500 snapshot, including ordinary constituent share classes and composition churn; configured limits may be lower, never higher.';

comment on column universe_version.source_payload_hash is
  'SHA-256 of the validated FMP constituent JSON payload used to derive this immutable candidate. Historical non-FMP versions remain null.';

comment on column universe_version.approved_by is
  'One-way approval recorded on a staged successor before activation. It cannot be replaced or added after activation.';

-- FMP staging materialises membership before approval. Approval is a one-way lifecycle action;
-- source lineage, parentage and staged membership remain immutable content. The legacy trigger
-- intentionally did not know about approved_by, which 0024 introduces, so replace only this
-- table's trigger with a stricter universe-specific variant.
create or replace function reject_universe_version_mutation() returns trigger
language plpgsql as $$
declare
  old_content jsonb := to_jsonb(old) - 'status' - 'activated_at' - 'selected_count' - 'approved_by';
  new_content jsonb := to_jsonb(new) - 'status' - 'activated_at' - 'selected_count' - 'approved_by';
begin
  if tg_op = 'DELETE' then
    raise exception
      'Table universe_version is append-only. A version is superseded, never deleted.'
      using errcode = 'restrict_violation';
  end if;

  if old_content is distinct from new_content then
    raise exception
      'Table universe_version is append-only except for lifecycle state, activation, count and one-way approval.'
      using errcode = 'restrict_violation';
  end if;

  if old.approved_by is distinct from new.approved_by
     and not (
       old.approved_by is null
       and new.approved_by is not null
       and old.status = 'staged'
       and new.status = 'staged'
     ) then
    raise exception
      'universe_version approval is one-way and must be recorded while the version is staged.'
      using errcode = 'restrict_violation';
  end if;

  if old.source_provider = 'fmp' and old.selected_count is distinct from new.selected_count then
    raise exception
      'An FMP universe selected_count is immutable because staged membership is already materialised.'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

drop trigger universe_version_append_only on universe_version;
create trigger universe_version_append_only
  before update or delete on universe_version
  for each row execute function reject_universe_version_mutation();

create unique index universe_version_fmp_snapshot_unique
  on universe_version (environment, source_provider, source_payload_hash)
  where source_provider = 'fmp' and source_payload_hash is not null;

create table rni_universe_sync_command (
  environment         text        not null,
  idempotency_key     text        not null,
  actor_id            text        not null,
  correlation_id      text        not null,
  status              text        not null default 'running',
  result_payload      jsonb       null,
  error_message       text        null,
  provider_call_id    uuid        null references provider_call_log (id),
  source_payload_hash text        null,
  universe_version    bigint      null references universe_version (id),
  lease_expires_at    timestamptz null default (now() + interval '2 minutes'),
  created_at          timestamptz not null default now(),
  completed_at        timestamptz null,

  primary key (environment, idempotency_key),
  constraint rni_universe_sync_command_status_check
    check (status in ('running', 'completed', 'failed')),
  constraint rni_universe_sync_command_payload_hash_check
    check (source_payload_hash is null or source_payload_hash ~ '^[0-9a-f]{64}$'),
  constraint rni_universe_sync_command_terminal_check check (
    (status = 'running' and result_payload is null and error_message is null
      and completed_at is null and lease_expires_at is not null)
    or (status = 'completed' and result_payload is not null and error_message is null
      and completed_at is not null and lease_expires_at is null)
    or (status = 'failed' and result_payload is null and error_message is not null
      and completed_at is not null and lease_expires_at is null)
  )
);

comment on table rni_universe_sync_command is
  'Durable pre-provider idempotency claim for the FMP universe command. One environment/key has one terminal outcome and every replay returns that outcome without another provider call.';

create table rni_security_master_import (
  id                uuid        primary key default gen_random_uuid(),
  environment       text        not null,
  source_provider   text        not null default 'fmp',
  source_endpoint   text        not null,
  source_retrieved_at timestamptz not null,
  source_payload_hash text      not null,
  imported_count    integer     not null,
  reused_count      integer     not null,
  imported_by       text        not null,
  created_at        timestamptz not null default now(),

  constraint rni_security_master_import_provider_check check (source_provider = 'fmp'),
  constraint rni_security_master_import_hash_check check (source_payload_hash ~ '^[0-9a-f]{64}$'),
  constraint rni_security_master_import_count_check check (
    imported_count between 0 and 600 and reused_count between 0 and 600
    and imported_count + reused_count between 501 and 600
  ),
  constraint rni_security_master_import_unique unique (environment, source_payload_hash)
);

comment on table rni_security_master_import is
  'Versioned lineage for a human-reviewed FMP profile export used to bootstrap the canonical security master before current constituent synchronization.';

create table rni_security_master_import_member (
  import_id             uuid    not null references rni_security_master_import (id),
  security_id           uuid    not null references security (id),
  source_ordinal        integer not null,
  provider_symbol       text    not null,
  provider_company_name text    not null,
  provider_exchange     text    not null,
  provider_cik          text    null,

  primary key (import_id, security_id),
  constraint rni_security_master_import_member_ordinal_unique
    unique (import_id, source_ordinal),
  constraint rni_security_master_import_member_symbol_unique
    unique (import_id, provider_symbol),
  constraint rni_security_master_import_member_ordinal_check
    check (source_ordinal between 0 and 599)
);

comment on table rni_security_master_import_member is
  'Immutable mapping from each reviewed FMP profile-export row to the canonical security identity selected by that import.';

create trigger rni_security_master_import_append_only
  before update or delete on rni_security_master_import
  for each row execute function reject_mutation();

create trigger rni_security_master_import_member_append_only
  before update or delete on rni_security_master_import_member
  for each row execute function reject_mutation();

alter table universe_member
  drop constraint universe_member_source_check;

alter table universe_member
  add column provider_symbol text null,
  add column provider_company_name text null,
  add column constituent_first_added_at timestamptz null,
  add constraint universe_member_source_check check (
    selection_source in ('checkbox', 'bulk_filter', 'import', 'preset', 'seed', 'fmp_sp500')
  ),
  add constraint universe_member_fmp_lineage_check check (
    selection_source <> 'fmp_sp500'
    or (provider_symbol is not null and provider_company_name is not null)
  );

-- I07 / D-RNI-22 — atomic E05 semantic persistence.
--
-- `rni_evidence_claim` predates the four-dimension classifier. The nullable addition preserves
-- historical/imported rows while every I07-created semantic claim carries its exact dimension.
alter table rni_evidence_claim
  add column dimension text null,
  add constraint rni_evidence_claim_dimension_check check (
    dimension is null or dimension in (
      'company_fundamentals', 'market_trading', 'catalyst_event', 'retail_narrative'
    )
  );

create table rni_run_observation (
  run_id               uuid        not null references rni_run (id),
  observation_id       uuid        not null,
  source_item_id       uuid        not null,
  security_id          uuid        not null,
  semantic_output_hash text        not null,
  created_at           timestamptz not null default now(),

  primary key (run_id, observation_id),
  constraint rni_run_observation_observation_fk
    foreign key (observation_id, source_item_id, security_id)
    references rni_security_observation (id, source_item_id, security_id),
  constraint rni_run_observation_semantic_output_hash_check
    check (semantic_output_hash ~ '^[a-f0-9]{64}$'),
  constraint rni_run_observation_identity_unique
    unique (run_id, source_item_id, security_id)
);

comment on table rni_run_observation is
  'Immutable run membership and exact canonical E05 output identity for one independently classified source/security observation. One multi-ticker source therefore has one row per security and never shares semantic output.';

create table rni_observation_semantic_quality (
  observation_id       uuid         primary key,
  source_item_id       uuid         not null,
  security_id          uuid         not null,
  support_start        integer      not null,
  support_end          integer      not null,
  evidence_text        text         not null,
  is_sarcastic         boolean      not null,
  sarcasm_probability  numeric(5,4) not null,
  is_meme              boolean      not null,
  meme_probability     numeric(5,4) not null,
  is_spam              boolean      not null,
  spam_probability     numeric(5,4) not null,
  information_value    numeric(5,4) not null,
  assertion_strength   numeric(5,4) not null,
  evidence_quality     numeric(5,4) not null,
  uncertainty          numeric(5,4) not null,
  exclusion_reason     text         null,
  created_at           timestamptz  not null default now(),

  constraint rni_observation_semantic_quality_observation_fk
    foreign key (observation_id, source_item_id, security_id)
    references rni_security_observation (id, source_item_id, security_id),
  constraint rni_observation_semantic_quality_support_check check (
    support_start >= 0 and support_end > support_start
  ),
  constraint rni_observation_semantic_quality_evidence_check
    check (length(evidence_text) between 1 and 2000),
  constraint rni_observation_semantic_quality_probability_check check (
    sarcasm_probability between 0 and 1
    and meme_probability between 0 and 1
    and spam_probability between 0 and 1
    and information_value between 0 and 1
    and assertion_strength between 0 and 1
    and evidence_quality between 0 and 1
    and uncertainty between 0 and 1
  ),
  constraint rni_observation_semantic_quality_exclusion_check check (
    exclusion_reason is null or exclusion_reason in ('off_topic', 'spam', 'unresolved_context')
  )
);

comment on table rni_observation_semantic_quality is
  'Exact E05 source/security noise and evidence-quality sidecar. It is committed with the observation and remains independently replayable for E06.';

create trigger rni_run_observation_append_only
  before update or delete on rni_run_observation
  for each row execute function reject_mutation();

create trigger rni_observation_semantic_quality_append_only
  before update or delete on rni_observation_semantic_quality
  for each row execute function reject_mutation();

-- I07 / D-RNI-19 — durable cited-synthesis lineage.
--
-- These tables persist the already-accepted E07/E08 artifacts without widening the P0 source
-- vocabulary. Evidence remains a Reddit post/comment or X post. `corroborating` describes a
-- second retained social source; it is deliberately not a factual-verification assertion.

alter table rni_evidence_claim
  add constraint rni_evidence_claim_full_identity_unique
    unique (id, source_item_id, security_id, observation_id);

alter table rni_claim_citation
  add constraint rni_claim_citation_full_identity_unique
    unique (id, claim_id, source_item_id);

alter table rni_run_observation
  add constraint rni_run_observation_full_identity_unique
    unique (run_id, observation_id, source_item_id, security_id);

alter table rni_combined_summary
  add constraint rni_combined_summary_full_identity_unique
    unique (id, run_id, security_id);

create or replace function rni_uuid_array_valid(value jsonb) returns boolean
language sql immutable strict as $$
  select
    jsonb_typeof(value) = 'array'
    and coalesce((
      select bool_and(
        jsonb_typeof(item) = 'string'
        and trim(both '"' from item::text) ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
      from jsonb_array_elements(value) as item
    ), true)
    and jsonb_array_length(value) = (
      select count(distinct item)
      from jsonb_array_elements_text(value) as item
    )
$$;

create table rni_platform_analytics_artifact (
  id                       uuid        primary key default gen_random_uuid(),
  run_id                   uuid        not null references rni_run (id),
  platform_slice_id        uuid        not null,
  platform                 text        not null,
  security_id              uuid        not null references security (id),
  methodology_version      text        not null,
  calculation_code_version text        not null,
  input_hash               text        not null,
  result_hash              text        not null,
  artifact_hash            text        not null,
  input_snapshot           jsonb       not null,
  result_snapshot          jsonb       not null,
  created_at               timestamptz not null,

  constraint rni_platform_analytics_slice_fk
    foreign key (platform_slice_id, run_id, platform)
    references rni_platform_slice (id, run_id, platform),
  constraint rni_platform_analytics_platform_check check (platform in ('reddit', 'x')),
  constraint rni_platform_analytics_versions_check check (
    length(methodology_version) > 0 and length(calculation_code_version) > 0
  ),
  constraint rni_platform_analytics_hashes_check check (
    input_hash ~ '^[a-f0-9]{64}$'
    and result_hash ~ '^[a-f0-9]{64}$'
    and artifact_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint rni_platform_analytics_snapshots_check check (
    jsonb_typeof(input_snapshot) = 'object'
    and jsonb_typeof(result_snapshot) = 'object'
  ),
  constraint rni_platform_analytics_identity_unique
    unique (run_id, security_id, platform, artifact_hash),
  constraint rni_platform_analytics_full_identity_unique
    unique (id, run_id, security_id, platform, artifact_hash)
);

comment on table rni_platform_analytics_artifact is
  'Immutable E06 platform analytics artifact. Reddit and X retain separate slices, snapshots and hashes; no pooled analytics row exists.';

create table rni_convergence_artifact (
  id                       uuid        primary key default gen_random_uuid(),
  run_id                   uuid        not null references rni_run (id),
  security_id              uuid        not null references security (id),
  reddit_platform          text        not null default 'reddit',
  reddit_analytics_id      uuid        not null,
  reddit_artifact_hash     text        not null,
  x_platform               text        not null default 'x',
  x_analytics_id           uuid        not null,
  x_artifact_hash          text        not null,
  policy_version           text        not null,
  calculation_code_version text        not null,
  input_hash               text        not null,
  result_hash              text        not null,
  input_snapshot           jsonb       not null,
  result_snapshot          jsonb       not null,
  created_at               timestamptz not null,

  constraint rni_convergence_reddit_platform_check check (reddit_platform = 'reddit'),
  constraint rni_convergence_x_platform_check check (x_platform = 'x'),
  constraint rni_convergence_distinct_analytics_check
    check (reddit_analytics_id <> x_analytics_id),
  constraint rni_convergence_reddit_analytics_fk
    foreign key (
      reddit_analytics_id, run_id, security_id, reddit_platform, reddit_artifact_hash
    ) references rni_platform_analytics_artifact (
      id, run_id, security_id, platform, artifact_hash
    ),
  constraint rni_convergence_x_analytics_fk
    foreign key (x_analytics_id, run_id, security_id, x_platform, x_artifact_hash)
    references rni_platform_analytics_artifact (
      id, run_id, security_id, platform, artifact_hash
    ),
  constraint rni_convergence_versions_check check (
    length(policy_version) > 0 and length(calculation_code_version) > 0
  ),
  constraint rni_convergence_hashes_check check (
    input_hash ~ '^[a-f0-9]{64}$' and result_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint rni_convergence_snapshots_check check (
    jsonb_typeof(input_snapshot) = 'object' and jsonb_typeof(result_snapshot) = 'object'
  ),
  constraint rni_convergence_identity_unique unique (run_id, security_id, input_hash),
  constraint rni_convergence_full_identity_unique unique (id, run_id, security_id)
);

comment on table rni_convergence_artifact is
  'Immutable E07 artifact bound by composite foreign keys to the exact Reddit and X analytics artifact identities and hashes.';

create table rni_synthesis_batch (
  id                              uuid        primary key default gen_random_uuid(),
  run_id                          uuid        not null references rni_run (id),
  security_id                     uuid        not null references security (id),
  assessment_cutoff_at            timestamptz not null,
  policy_version                  text        not null,
  rights_policy_version           text        not null,
  ordered_citation_ids            jsonb       not null,
  reddit_platform_citation_ids    jsonb       not null,
  x_platform_citation_ids         jsonb       not null,
  created_at                      timestamptz not null,

  constraint rni_synthesis_batch_versions_check check (
    length(policy_version) > 0 and length(rights_policy_version) > 0
  ),
  constraint rni_synthesis_batch_time_check check (created_at >= assessment_cutoff_at),
  constraint rni_synthesis_batch_citation_arrays_check check (
    rni_uuid_array_valid(ordered_citation_ids)
    and rni_uuid_array_valid(reddit_platform_citation_ids)
    and rni_uuid_array_valid(x_platform_citation_ids)
  ),
  constraint rni_synthesis_batch_identity_unique unique (
    run_id, security_id, assessment_cutoff_at, policy_version, rights_policy_version
  ),
  constraint rni_synthesis_batch_full_identity_unique unique (
    id, run_id, security_id, assessment_cutoff_at, policy_version, rights_policy_version
  ),
  constraint rni_synthesis_batch_artifact_identity_unique
    unique (id, run_id, security_id, policy_version)
);

create table rni_synthesis_claim_input (
  batch_id                  uuid        not null,
  run_id                    uuid        not null,
  security_id               uuid        not null,
  assessment_cutoff_at      timestamptz not null,
  policy_version            text        not null,
  rights_policy_version     text        not null,
  ordinal                   integer     not null,
  claim_id                  uuid        not null,
  source_item_id            uuid        not null,
  observation_id            uuid        not null,
  platform                  text        not null,
  source_citation_ids       jsonb       not null,
  created_at                timestamptz not null default now(),

  primary key (batch_id, claim_id),
  constraint rni_synthesis_claim_input_ordinal_unique unique (batch_id, ordinal),
  constraint rni_synthesis_claim_input_batch_fk
    foreign key (
      batch_id, run_id, security_id, assessment_cutoff_at,
      policy_version, rights_policy_version
    ) references rni_synthesis_batch (
      id, run_id, security_id, assessment_cutoff_at,
      policy_version, rights_policy_version
    ),
  constraint rni_synthesis_claim_input_claim_fk
    foreign key (claim_id, source_item_id, security_id, observation_id)
    references rni_evidence_claim (id, source_item_id, security_id, observation_id),
  constraint rni_synthesis_claim_input_run_observation_fk
    foreign key (run_id, observation_id, source_item_id, security_id)
    references rni_run_observation (run_id, observation_id, source_item_id, security_id),
  constraint rni_synthesis_claim_input_source_platform_fk
    foreign key (source_item_id, platform) references rni_source_item (id, platform),
  constraint rni_synthesis_claim_input_ordinal_check check (ordinal >= 0),
  constraint rni_synthesis_claim_input_platform_check check (platform in ('reddit', 'x')),
  constraint rni_synthesis_claim_input_citations_check
    check (jsonb_array_length(source_citation_ids) > 0 and rni_uuid_array_valid(source_citation_ids))
);

create or replace function rni_synthesis_claim_is_catalyst() returns trigger
language plpgsql as $$
declare
  claim_dimension text;
begin
  select dimension into claim_dimension
    from rni_evidence_claim
   where id = new.claim_id;
  if claim_dimension is distinct from 'catalyst_event' then
    raise exception 'RNI synthesis accepts only persisted catalyst_event claims'
      using errcode = 'check_violation',
            constraint = 'rni_synthesis_claim_input_catalyst';
  end if;
  return new;
end;
$$;

create trigger rni_synthesis_claim_input_catalyst
  before insert on rni_synthesis_claim_input
  for each row execute function rni_synthesis_claim_is_catalyst();

create or replace function rni_sanitized_model_usage_valid(value jsonb) returns boolean
language plpgsql immutable strict as $$
declare
  usage_key text;
  usage_value jsonb;
  numeric_value numeric;
begin
  if jsonb_typeof(value) <> 'object' then return false; end if;
  for usage_key in select jsonb_object_keys(value)
  loop
    if usage_key not in (
      'inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens'
    ) then
      return false;
    end if;
    usage_value := value -> usage_key;
    if jsonb_typeof(usage_value) = 'null' then continue; end if;
    if jsonb_typeof(usage_value) <> 'number' then return false; end if;
    begin
      numeric_value := (usage_value #>> '{}')::numeric;
    exception when others then
      return false;
    end;
    if numeric_value < 0 or trunc(numeric_value) <> numeric_value then return false; end if;
  end loop;
  return true;
end;
$$;

create table rni_synthesis_model_invocation (
  id                    uuid        primary key,
  batch_id              uuid        not null references rni_synthesis_batch (id),
  stage                 text        not null,
  status                text        not null default 'prepared',
  model_id              text        not null,
  model_revision        text        not null,
  prompt_version        text        not null,
  ordered_claim_ids     jsonb       not null,
  input_hash            text        not null,
  prepared_snapshot     jsonb       not null,
  output_hash           text        null,
  terminal_metadata     jsonb       null,
  prepared_at           timestamptz not null,
  completed_at          timestamptz null,

  constraint rni_synthesis_model_invocation_stage_check
    check (stage in ('verification', 'challenger')),
  constraint rni_synthesis_model_invocation_status_check
    check (status in ('prepared', 'succeeded', 'failed')),
  constraint rni_synthesis_model_invocation_versions_check check (
    length(model_id) > 0 and length(model_revision) > 0 and length(prompt_version) > 0
  ),
  constraint rni_synthesis_model_invocation_claims_check
    check (rni_uuid_array_valid(ordered_claim_ids)),
  constraint rni_synthesis_model_invocation_input_hash_check
    check (input_hash ~ '^[a-f0-9]{64}$'),
  constraint rni_synthesis_model_invocation_prepared_snapshot_check
    check (jsonb_typeof(prepared_snapshot) = 'object'),
  constraint rni_synthesis_model_invocation_terminal_check check (
    (status = 'prepared' and output_hash is null and terminal_metadata is null
      and completed_at is null)
    or (
      status = 'succeeded'
      and output_hash ~ '^[a-f0-9]{64}$'
      and completed_at is not null
      and completed_at >= prepared_at
      and jsonb_typeof(terminal_metadata) = 'object'
      and terminal_metadata ->> 'outcome' = 'succeeded'
      and not (terminal_metadata ? 'errorCode')
      and terminal_metadata - array[
        'outcome', 'responseId', 'usage', 'latencyMs', 'costUsd'
      ] = '{}'::jsonb
      and (
        not (terminal_metadata ? 'usage')
        or rni_sanitized_model_usage_valid(terminal_metadata -> 'usage')
      )
    )
    or (
      status = 'failed'
      and output_hash is null
      and completed_at is not null
      and completed_at >= prepared_at
      and jsonb_typeof(terminal_metadata) = 'object'
      and terminal_metadata ->> 'outcome' = 'failed'
      and terminal_metadata ->> 'errorCode' in (
        'provider_failure', 'response_envelope_invalid', 'model_identity_mismatch',
        'forbidden_tool_call', 'structured_output_invalid', 'discovery_response_invalid'
      )
      and terminal_metadata - array[
        'outcome', 'errorCode', 'responseId', 'usage', 'latencyMs', 'costUsd'
      ] = '{}'::jsonb
      and (
        not (terminal_metadata ? 'usage')
        or rni_sanitized_model_usage_valid(terminal_metadata -> 'usage')
      )
    )
  ),
  constraint rni_synthesis_model_invocation_stage_unique unique (batch_id, stage),
  constraint rni_synthesis_model_invocation_full_identity_unique
    unique (id, batch_id, stage),
  constraint rni_synthesis_model_invocation_input_identity_unique
    unique (id, batch_id, stage, input_hash)
);

create or replace function rni_synthesis_invocation_starts_prepared() returns trigger
language plpgsql as $$
begin
  if new.status <> 'prepared' then
    raise exception 'RNI synthesis model invocation must be persisted before dispatch'
      using errcode = 'check_violation',
            constraint = 'rni_synthesis_model_invocation_starts_prepared';
  end if;
  return new;
end;
$$;

create trigger rni_synthesis_model_invocation_starts_prepared
  before insert on rni_synthesis_model_invocation
  for each row execute function rni_synthesis_invocation_starts_prepared();

create or replace function rni_synthesis_invocation_transition_valid() returns trigger
language plpgsql as $$
begin
  if old.status <> 'prepared' or new.status not in ('succeeded', 'failed') then
    raise exception 'RNI synthesis model invocation permits one prepared-to-terminal transition'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger rni_synthesis_model_invocation_transition
  before update on rni_synthesis_model_invocation
  for each row execute function rni_synthesis_invocation_transition_valid();

create trigger rni_synthesis_model_invocation_content_immutable
  before update or delete on rni_synthesis_model_invocation
  for each row execute function reject_content_mutation(
    'status', 'output_hash', 'terminal_metadata', 'completed_at'
  );

create table rni_synthesis_citation_role (
  id                       uuid        primary key default gen_random_uuid(),
  batch_id                 uuid        not null,
  run_id                   uuid        not null,
  security_id              uuid        not null,
  assessment_cutoff_at     timestamptz not null,
  policy_version           text        not null,
  rights_policy_version    text        not null,
  target_claim_id          uuid        null,
  citation_id              uuid        not null,
  evidence_claim_id        uuid        not null,
  source_item_id           uuid        not null,
  observation_id           uuid        not null,
  platform                 text        not null,
  evidence_role            text        not null,
  analytics_artifact_id    uuid        null,
  analytics_artifact_hash  text        null,
  created_at               timestamptz not null default now(),

  constraint rni_synthesis_citation_role_batch_fk
    foreign key (
      batch_id, run_id, security_id, assessment_cutoff_at,
      policy_version, rights_policy_version
    ) references rni_synthesis_batch (
      id, run_id, security_id, assessment_cutoff_at,
      policy_version, rights_policy_version
    ),
  constraint rni_synthesis_citation_role_target_fk
    foreign key (batch_id, target_claim_id)
    references rni_synthesis_claim_input (batch_id, claim_id),
  constraint rni_synthesis_citation_role_citation_fk
    foreign key (citation_id, evidence_claim_id, source_item_id)
    references rni_claim_citation (id, claim_id, source_item_id),
  constraint rni_synthesis_citation_role_evidence_claim_fk
    foreign key (evidence_claim_id, source_item_id, security_id, observation_id)
    references rni_evidence_claim (id, source_item_id, security_id, observation_id),
  constraint rni_synthesis_citation_role_run_observation_fk
    foreign key (run_id, observation_id, source_item_id, security_id)
    references rni_run_observation (run_id, observation_id, source_item_id, security_id),
  constraint rni_synthesis_citation_role_source_platform_fk
    foreign key (source_item_id, platform) references rni_source_item (id, platform),
  constraint rni_synthesis_citation_role_analytics_fk
    foreign key (
      analytics_artifact_id, run_id, security_id, platform, analytics_artifact_hash
    ) references rni_platform_analytics_artifact (
      id, run_id, security_id, platform, artifact_hash
    ),
  constraint rni_synthesis_citation_role_platform_check check (platform in ('reddit', 'x')),
  constraint rni_synthesis_citation_role_value_check check (
    evidence_role in ('social_claim', 'corroborating', 'counterevidence')
  ),
  constraint rni_synthesis_citation_role_shape_check check (
    (
      target_claim_id is null and evidence_role = 'social_claim'
      and analytics_artifact_id is not null and analytics_artifact_hash is not null
    )
    or (
      target_claim_id is not null
      and analytics_artifact_id is null and analytics_artifact_hash is null
    )
  ),
  constraint rni_synthesis_citation_role_full_identity_unique
    unique (id, batch_id, citation_id)
);

create unique index rni_synthesis_citation_role_identity_unique
  on rni_synthesis_citation_role (
    batch_id,
    coalesce(target_claim_id, '00000000-0000-0000-0000-000000000000'::uuid),
    citation_id
  );

create or replace function rni_publication_canonical_url_valid(
  value_platform text,
  value_source_kind text,
  value_external_id text,
  value_canonical_url text
) returns boolean language plpgsql immutable as $$
declare
  url_parts text[];
begin
  if value_external_id is null then return false; end if;
  if value_platform = 'reddit' and value_source_kind = 'post' then
    url_parts := regexp_match(
      value_canonical_url,
      '^https://www[.]reddit[.]com/r/([a-z0-9_]+)/comments/([a-z0-9]+)/$'
    );
    return url_parts is not null and 't3_' || url_parts[2] = value_external_id;
  elsif value_platform = 'reddit' and value_source_kind = 'comment' then
    url_parts := regexp_match(
      value_canonical_url,
      '^https://www[.]reddit[.]com/r/([a-z0-9_]+)/comments/([a-z0-9]+)/_/([a-z0-9]+)/$'
    );
    return url_parts is not null and 't1_' || url_parts[3] = value_external_id;
  elsif value_platform = 'x' and value_source_kind = 'x_post' then
    url_parts := regexp_match(
      value_canonical_url,
      '^https://x[.]com/i/web/status/([0-9]+)$'
    );
    return url_parts is not null and url_parts[1] = value_external_id;
  end if;
  return false;
end;
$$;

create or replace function rni_synthesis_citation_role_valid() returns trigger
language plpgsql as $$
declare
  source_row rni_source_item%rowtype;
  target_row record;
begin
  select * into source_row from rni_source_item where id = new.source_item_id;
  if source_row.id is null
     or source_row.rights_policy_version <> new.rights_policy_version
     or source_row.source_status <> 'active' then
    raise exception 'RNI publication evidence requires active source rights matching the synthesis batch'
      using errcode = 'check_violation',
            constraint = 'rni_synthesis_citation_role_source_rights';
  end if;
  if not rni_publication_canonical_url_valid(
    source_row.platform,
    source_row.source_kind,
    source_row.external_id,
    source_row.canonical_url
  ) then
    raise exception 'RNI publication evidence requires a strict canonical Reddit or X URL'
      using errcode = 'check_violation',
            constraint = 'rni_synthesis_citation_role_canonical_url';
  end if;
  if source_row.discovered_at > new.assessment_cutoff_at
     or source_row.observed_at > new.assessment_cutoff_at then
    raise exception 'RNI publication evidence cannot follow the point-in-time cutoff'
      using errcode = 'check_violation',
            constraint = 'rni_synthesis_citation_role_point_in_time';
  end if;

  if new.target_claim_id is not null then
    select source_item_id, platform into target_row
      from rni_synthesis_claim_input
     where batch_id = new.batch_id and claim_id = new.target_claim_id;
    if new.evidence_role = 'social_claim' then
      if new.evidence_claim_id <> new.target_claim_id
         or new.source_item_id <> target_row.source_item_id
         or new.platform <> target_row.platform then
        raise exception 'RNI social_claim role must cite the exact persisted catalyst claim source'
          using errcode = 'check_violation',
                constraint = 'rni_synthesis_citation_role_claim_source';
      end if;
    else
      if new.source_item_id = target_row.source_item_id then
        raise exception 'RNI corroboration and counterevidence cannot self-cite the catalyst source'
          using errcode = 'check_violation',
                constraint = 'rni_synthesis_citation_role_no_self_citation';
      end if;
      if source_row.published_at is null
         or source_row.published_at > new.assessment_cutoff_at then
        raise exception 'RNI corroboration and counterevidence require known publication by the cutoff'
          using errcode = 'check_violation',
                constraint = 'rni_synthesis_citation_role_published_point_in_time';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger rni_synthesis_citation_role_valid
  before insert on rni_synthesis_citation_role
  for each row execute function rni_synthesis_citation_role_valid();

create or replace function rni_validate_synthesis_batch_manifests(value_batch_id uuid)
returns void language plpgsql as $$
declare
  batch_row rni_synthesis_batch%rowtype;
  expected jsonb;
  claim_row record;
begin
  select * into batch_row from rni_synthesis_batch where id = value_batch_id;
  if batch_row.id is null then return; end if;

  select coalesce(jsonb_agg(to_jsonb(citation_id::text) order by citation_id::text), '[]'::jsonb)
    into expected
    from (
      select distinct citation_id
      from rni_synthesis_citation_role
      where batch_id = value_batch_id
    ) as citations;
  if expected <> batch_row.ordered_citation_ids then
    raise exception 'RNI synthesis citation manifest must equal the exact persisted role set'
      using errcode = 'check_violation',
            constraint = 'rni_synthesis_batch_exact_citation_manifest';
  end if;

  select coalesce(jsonb_agg(to_jsonb(citation_id::text) order by citation_id::text), '[]'::jsonb)
    into expected
    from rni_synthesis_citation_role
   where batch_id = value_batch_id and target_claim_id is null and platform = 'reddit';
  if expected <> batch_row.reddit_platform_citation_ids then
    raise exception 'RNI Reddit platform citation manifest does not match its analytics roles'
      using errcode = 'check_violation',
            constraint = 'rni_synthesis_batch_exact_reddit_manifest';
  end if;

  select coalesce(jsonb_agg(to_jsonb(citation_id::text) order by citation_id::text), '[]'::jsonb)
    into expected
    from rni_synthesis_citation_role
   where batch_id = value_batch_id and target_claim_id is null and platform = 'x';
  if expected <> batch_row.x_platform_citation_ids then
    raise exception 'RNI X platform citation manifest does not match its analytics roles'
      using errcode = 'check_violation',
            constraint = 'rni_synthesis_batch_exact_x_manifest';
  end if;

  for claim_row in
    select claim_id, source_citation_ids
      from rni_synthesis_claim_input
     where batch_id = value_batch_id
  loop
    select coalesce(jsonb_agg(to_jsonb(citation_id::text) order by citation_id::text), '[]'::jsonb)
      into expected
      from rni_synthesis_citation_role
     where batch_id = value_batch_id
       and target_claim_id = claim_row.claim_id
       and evidence_role = 'social_claim';
    if expected <> claim_row.source_citation_ids then
      raise exception 'RNI catalyst source-citation manifest must equal its exact social_claim roles'
        using errcode = 'check_violation',
              constraint = 'rni_synthesis_claim_exact_source_manifest';
    end if;
  end loop;
end;
$$;

create or replace function rni_validate_synthesis_invocation() returns trigger
language plpgsql as $$
declare
  expected jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(claim_id::text) order by ordinal), '[]'::jsonb)
    into expected
    from rni_synthesis_claim_input
   where batch_id = new.batch_id;
  if expected <> new.ordered_claim_ids then
    raise exception 'RNI verifier and challenger must use the exact ordered persisted claim set'
      using errcode = 'check_violation',
            constraint = 'rni_synthesis_model_invocation_exact_claims';
  end if;
  perform rni_validate_synthesis_batch_manifests(new.batch_id);
  return null;
end;
$$;

create constraint trigger rni_synthesis_model_invocation_exact_inputs
  after insert or update on rni_synthesis_model_invocation
  deferrable initially deferred
  for each row execute function rni_validate_synthesis_invocation();

create or replace function rni_revalidate_synthesis_claim_input() returns trigger
language plpgsql as $$
declare
  invocation_row rni_synthesis_model_invocation%rowtype;
begin
  for invocation_row in
    select * from rni_synthesis_model_invocation where batch_id = new.batch_id
  loop
    perform rni_validate_synthesis_batch_manifests(new.batch_id);
    if invocation_row.ordered_claim_ids <> (
      select coalesce(jsonb_agg(to_jsonb(claim_id::text) order by ordinal), '[]'::jsonb)
      from rni_synthesis_claim_input where batch_id = new.batch_id
    ) then
      raise exception 'RNI claim input cannot alter a prepared invocation claim set'
        using errcode = 'check_violation',
              constraint = 'rni_synthesis_claim_input_prepared_exactness';
    end if;
  end loop;
  return null;
end;
$$;

create constraint trigger rni_synthesis_claim_input_revalidate
  after insert on rni_synthesis_claim_input
  deferrable initially deferred
  for each row execute function rni_revalidate_synthesis_claim_input();

create or replace function rni_revalidate_synthesis_citation_role() returns trigger
language plpgsql as $$
begin
  if exists (
    select 1 from rni_synthesis_model_invocation where batch_id = new.batch_id
  ) then
    perform rni_validate_synthesis_batch_manifests(new.batch_id);
  end if;
  return null;
end;
$$;

create constraint trigger rni_synthesis_citation_role_revalidate
  after insert on rni_synthesis_citation_role
  deferrable initially deferred
  for each row execute function rni_revalidate_synthesis_citation_role();

create table rni_catalyst_assessment (
  batch_id                   uuid        not null,
  run_id                     uuid        not null,
  security_id                uuid        not null,
  assessment_cutoff_at       timestamptz not null,
  policy_version             text        not null,
  rights_policy_version      text        not null,
  claim_id                   uuid        not null,
  verifier_invocation_id     uuid        not null,
  verifier_stage             text        not null default 'verification',
  verdict                    text        not null,
  supporting_citation_ids    jsonb       not null,
  contradicting_citation_ids jsonb       not null,
  assessment_hash            text        not null,
  created_at                 timestamptz not null default now(),

  primary key (batch_id, claim_id),
  constraint rni_catalyst_assessment_batch_fk
    foreign key (
      batch_id, run_id, security_id, assessment_cutoff_at,
      policy_version, rights_policy_version
    ) references rni_synthesis_batch (
      id, run_id, security_id, assessment_cutoff_at,
      policy_version, rights_policy_version
    ),
  constraint rni_catalyst_assessment_claim_fk
    foreign key (batch_id, claim_id)
    references rni_synthesis_claim_input (batch_id, claim_id),
  constraint rni_catalyst_assessment_invocation_fk
    foreign key (verifier_invocation_id, batch_id, verifier_stage)
    references rni_synthesis_model_invocation (id, batch_id, stage),
  constraint rni_catalyst_assessment_verifier_stage_check
    check (verifier_stage = 'verification'),
  constraint rni_catalyst_assessment_verdict_check
    check (verdict in ('supported', 'contradicted', 'contested', 'unverified')),
  constraint rni_catalyst_assessment_citations_check check (
    rni_uuid_array_valid(supporting_citation_ids)
    and rni_uuid_array_valid(contradicting_citation_ids)
  ),
  constraint rni_catalyst_assessment_hash_check
    check (assessment_hash ~ '^[a-f0-9]{64}$')
);

create or replace function rni_validate_catalyst_assessment(
  value_batch_id uuid,
  value_claim_id uuid
) returns void language plpgsql as $$
declare
  assessment_row rni_catalyst_assessment%rowtype;
  invocation_status text;
  expected_supporting jsonb;
  expected_contradicting jsonb;
begin
  select * into assessment_row
    from rni_catalyst_assessment
   where batch_id = value_batch_id and claim_id = value_claim_id;
  if assessment_row.batch_id is null then return; end if;

  select status into invocation_status
    from rni_synthesis_model_invocation
   where id = assessment_row.verifier_invocation_id;
  if invocation_status is distinct from 'succeeded' then
    raise exception 'RNI catalyst assessment requires the terminal successful verifier invocation'
      using errcode = 'check_violation',
            constraint = 'rni_catalyst_assessment_terminal_verifier';
  end if;

  select coalesce(jsonb_agg(to_jsonb(citation_id::text) order by citation_id::text), '[]'::jsonb)
    into expected_supporting
    from rni_synthesis_citation_role
   where batch_id = value_batch_id and target_claim_id = value_claim_id
     and evidence_role = 'corroborating';
  select coalesce(jsonb_agg(to_jsonb(citation_id::text) order by citation_id::text), '[]'::jsonb)
    into expected_contradicting
    from rni_synthesis_citation_role
   where batch_id = value_batch_id and target_claim_id = value_claim_id
     and evidence_role = 'counterevidence';
  if assessment_row.supporting_citation_ids <> expected_supporting
     or assessment_row.contradicting_citation_ids <> expected_contradicting then
    raise exception 'RNI catalyst assessment citation sets must equal the exact claim-role edges'
      using errcode = 'check_violation',
            constraint = 'rni_catalyst_assessment_exact_citations';
  end if;
  if not (
    (assessment_row.verdict = 'supported'
      and jsonb_array_length(expected_supporting) > 0
      and jsonb_array_length(expected_contradicting) = 0)
    or (assessment_row.verdict = 'contradicted'
      and jsonb_array_length(expected_supporting) = 0
      and jsonb_array_length(expected_contradicting) > 0)
    or (assessment_row.verdict = 'contested'
      and jsonb_array_length(expected_supporting) > 0
      and jsonb_array_length(expected_contradicting) > 0)
    or (assessment_row.verdict = 'unverified'
      and jsonb_array_length(expected_supporting) = 0
      and jsonb_array_length(expected_contradicting) = 0)
  ) then
    raise exception 'RNI catalyst assessment verdict does not match its social evidence roles'
      using errcode = 'check_violation',
            constraint = 'rni_catalyst_assessment_verdict_shape';
  end if;
end;
$$;

create or replace function rni_catalyst_assessment_constraint() returns trigger
language plpgsql as $$
begin
  perform rni_validate_catalyst_assessment(new.batch_id, new.claim_id);
  return null;
end;
$$;

create constraint trigger rni_catalyst_assessment_valid
  after insert on rni_catalyst_assessment
  deferrable initially deferred
  for each row execute function rni_catalyst_assessment_constraint();

create table rni_challenger_selection (
  batch_id                 uuid        primary key references rni_synthesis_batch (id),
  challenger_invocation_id uuid        not null,
  challenger_stage         text        not null default 'challenger',
  verdict                  text        not null,
  challenged_claim_id      uuid        null,
  citation_ids             jsonb       not null,
  selection_hash           text        not null,
  created_at               timestamptz not null default now(),

  constraint rni_challenger_selection_invocation_fk
    foreign key (challenger_invocation_id, batch_id, challenger_stage)
    references rni_synthesis_model_invocation (id, batch_id, stage),
  constraint rni_challenger_selection_claim_fk
    foreign key (batch_id, challenged_claim_id)
    references rni_synthesis_claim_input (batch_id, claim_id),
  constraint rni_challenger_selection_stage_check check (challenger_stage = 'challenger'),
  constraint rni_challenger_selection_verdict_check check (
    verdict in ('no_supported_challenge_found', 'material_challenge', 'insufficient')
  ),
  constraint rni_challenger_selection_citations_check check (rni_uuid_array_valid(citation_ids)),
  constraint rni_challenger_selection_hash_check check (selection_hash ~ '^[a-f0-9]{64}$')
);

create or replace function rni_validate_challenger_selection(value_batch_id uuid)
returns void language plpgsql as $$
declare
  selection_row rni_challenger_selection%rowtype;
  invocation_status text;
  expected jsonb;
  support_count integer;
  counter_count integer;
begin
  select * into selection_row from rni_challenger_selection where batch_id = value_batch_id;
  if selection_row.batch_id is null then return; end if;
  select status into invocation_status
    from rni_synthesis_model_invocation where id = selection_row.challenger_invocation_id;
  if invocation_status is distinct from 'succeeded' then
    raise exception 'RNI challenger selection requires the terminal successful challenger invocation'
      using errcode = 'check_violation',
            constraint = 'rni_challenger_selection_terminal_invocation';
  end if;

  select count(*) filter (where evidence_role = 'corroborating'),
         count(*) filter (where evidence_role = 'counterevidence')
    into support_count, counter_count
    from rni_synthesis_citation_role
   where batch_id = value_batch_id and target_claim_id is not null;
  if selection_row.verdict = 'material_challenge' then
    if selection_row.challenged_claim_id is null then
      raise exception 'RNI material challenge must select one persisted catalyst claim'
        using errcode = 'check_violation',
              constraint = 'rni_challenger_selection_shape';
    end if;
    select coalesce(jsonb_agg(to_jsonb(citation_id::text) order by citation_id::text), '[]'::jsonb)
      into expected
      from rni_synthesis_citation_role
     where batch_id = value_batch_id
       and target_claim_id = selection_row.challenged_claim_id
       and evidence_role = 'counterevidence';
    if selection_row.citation_ids <> expected or jsonb_array_length(expected) = 0 then
      raise exception 'RNI material challenge must select the exact counterevidence set'
        using errcode = 'check_violation',
              constraint = 'rni_challenger_selection_exact_citations';
    end if;
  elsif selection_row.verdict = 'no_supported_challenge_found' then
    if selection_row.challenged_claim_id is not null
       or jsonb_array_length(selection_row.citation_ids) <> 0
       or counter_count <> 0 or support_count = 0 then
      raise exception 'RNI no-challenge selection requires support and no persisted counterevidence'
        using errcode = 'check_violation',
              constraint = 'rni_challenger_selection_shape';
    end if;
  elsif selection_row.challenged_claim_id is not null
     or jsonb_array_length(selection_row.citation_ids) <> 0
     or counter_count <> 0 or support_count <> 0 then
    raise exception 'RNI insufficient challenger selection requires no corroborating or counter evidence'
      using errcode = 'check_violation',
            constraint = 'rni_challenger_selection_shape';
  end if;
end;
$$;

create or replace function rni_challenger_selection_constraint() returns trigger
language plpgsql as $$
begin
  perform rni_validate_challenger_selection(new.batch_id);
  return null;
end;
$$;

create constraint trigger rni_challenger_selection_valid
  after insert on rni_challenger_selection
  deferrable initially deferred
  for each row execute function rni_challenger_selection_constraint();

-- Once assessments or a challenger selection exist, a later role insert must revalidate those
-- exact sets as well as the original request manifest. This keeps child INSERTs from becoming a
-- back door around append-only parent artifacts.
create or replace function rni_revalidate_synthesis_citation_role() returns trigger
language plpgsql as $$
begin
  if exists (
    select 1 from rni_synthesis_model_invocation where batch_id = new.batch_id
  ) then
    perform rni_validate_synthesis_batch_manifests(new.batch_id);
  end if;
  if new.target_claim_id is not null then
    perform rni_validate_catalyst_assessment(new.batch_id, new.target_claim_id);
  end if;
  perform rni_validate_challenger_selection(new.batch_id);
  return null;
end;
$$;

create table rni_cited_synthesis_artifact (
  id                           uuid        primary key,
  run_id                       uuid        not null,
  security_id                  uuid        not null,
  batch_id                     uuid        not null references rni_synthesis_batch (id),
  convergence_artifact_id      uuid        not null,
  verifier_invocation_id       uuid        not null,
  verifier_stage               text        not null default 'verification',
  verification_input_hash      text        not null,
  challenger_invocation_id     uuid        not null,
  challenger_stage             text        not null default 'challenger',
  challenger_input_hash        text        not null,
  calculation_code_version     text        not null,
  policy_version               text        not null,
  input_hash                   text        not null,
  result_hash                  text        not null,
  request_snapshot             jsonb       not null,
  model_input_snapshot         jsonb       not null,
  verification_output_snapshot jsonb       not null,
  challenger_output_snapshot   jsonb       not null,
  result_snapshot              jsonb       not null,
  statement_count              integer     not null,
  created_at                   timestamptz not null,

  constraint rni_cited_synthesis_summary_fk
    foreign key (id, run_id, security_id)
    references rni_combined_summary (id, run_id, security_id),
  constraint rni_cited_synthesis_convergence_fk
    foreign key (convergence_artifact_id, run_id, security_id)
    references rni_convergence_artifact (id, run_id, security_id),
  constraint rni_cited_synthesis_batch_fk
    foreign key (batch_id, run_id, security_id, policy_version)
    references rni_synthesis_batch (id, run_id, security_id, policy_version),
  constraint rni_cited_synthesis_verifier_fk
    foreign key (
      verifier_invocation_id, batch_id, verifier_stage, verification_input_hash
    ) references rni_synthesis_model_invocation (id, batch_id, stage, input_hash),
  constraint rni_cited_synthesis_challenger_fk
    foreign key (
      challenger_invocation_id, batch_id, challenger_stage, challenger_input_hash
    ) references rni_synthesis_model_invocation (id, batch_id, stage, input_hash),
  constraint rni_cited_synthesis_stages_check
    check (verifier_stage = 'verification' and challenger_stage = 'challenger'),
  constraint rni_cited_synthesis_distinct_invocations_check
    check (verifier_invocation_id <> challenger_invocation_id),
  constraint rni_cited_synthesis_versions_check check (
    length(calculation_code_version) > 0 and length(policy_version) > 0
  ),
  constraint rni_cited_synthesis_hashes_check check (
    verification_input_hash ~ '^[a-f0-9]{64}$'
    and challenger_input_hash ~ '^[a-f0-9]{64}$'
    and input_hash ~ '^[a-f0-9]{64}$'
    and result_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint rni_cited_synthesis_snapshots_check check (
    jsonb_typeof(request_snapshot) = 'object'
    and jsonb_typeof(model_input_snapshot) = 'object'
    and jsonb_typeof(verification_output_snapshot) = 'array'
    and jsonb_typeof(challenger_output_snapshot) = 'object'
    and jsonb_typeof(result_snapshot) = 'object'
  ),
  constraint rni_cited_synthesis_statement_count_check check (statement_count >= 3),
  constraint rni_cited_synthesis_statement_identity_unique unique (id, batch_id)
);

create table rni_publication_statement (
  id              uuid        primary key default gen_random_uuid(),
  synthesis_id    uuid        not null references rni_cited_synthesis_artifact (id),
  batch_id        uuid        not null references rni_synthesis_batch (id),
  ordinal         integer     not null,
  heading         text        not null,
  section_status  text        not null,
  origin          text        not null,
  statement_text  text        not null,
  citation_ids    jsonb       not null,
  created_at      timestamptz not null default now(),

  constraint rni_publication_statement_ordinal_unique unique (synthesis_id, ordinal),
  constraint rni_publication_statement_synthesis_batch_fk
    foreign key (synthesis_id, batch_id)
    references rni_cited_synthesis_artifact (id, batch_id),
  constraint rni_publication_statement_full_identity_unique
    unique (id, synthesis_id, batch_id),
  constraint rni_publication_statement_ordinal_check check (ordinal >= 0),
  constraint rni_publication_statement_heading_check check (
    heading in ('Reddit sentiment', 'X sentiment', 'Combined summary')
  ),
  constraint rni_publication_statement_section_status_check
    check (section_status in ('complete', 'partial', 'insufficient')),
  constraint rni_publication_statement_origin_check check (
    origin in (
      'platform_conclusion', 'corroborated_catalyst', 'challenged_catalyst',
      'cross_source_fact', 'coverage_disclosure'
    )
  ),
  constraint rni_publication_statement_heading_origin_check check (
    (origin = 'platform_conclusion' and heading in ('Reddit sentiment', 'X sentiment'))
    or (origin in ('corroborated_catalyst', 'challenged_catalyst', 'cross_source_fact')
      and heading = 'Combined summary')
    or origin = 'coverage_disclosure'
  ),
  constraint rni_publication_statement_text_check
    check (length(statement_text) between 1 and 4000),
  constraint rni_publication_statement_citations_check check (
    rni_uuid_array_valid(citation_ids)
    and (origin = 'coverage_disclosure' or jsonb_array_length(citation_ids) > 0)
  )
);

create table rni_publication_statement_citation (
  statement_id      uuid        not null,
  synthesis_id      uuid        not null,
  batch_id          uuid        not null,
  citation_ordinal  integer     not null,
  citation_role_id  uuid        not null,
  citation_id       uuid        not null,
  created_at        timestamptz not null default now(),

  primary key (statement_id, citation_id),
  constraint rni_publication_statement_citation_ordinal_unique
    unique (statement_id, citation_ordinal),
  constraint rni_publication_statement_citation_statement_fk
    foreign key (statement_id, synthesis_id, batch_id)
    references rni_publication_statement (id, synthesis_id, batch_id),
  constraint rni_publication_statement_citation_role_fk
    foreign key (citation_role_id, batch_id, citation_id)
    references rni_synthesis_citation_role (id, batch_id, citation_id),
  constraint rni_publication_statement_citation_ordinal_check
    check (citation_ordinal >= 0)
);

create or replace function rni_expected_summary_sections(value_synthesis_id uuid)
returns jsonb language sql stable as $$
  with headings(heading, heading_ordinal) as (
    values ('Reddit sentiment'::text, 0), ('X sentiment'::text, 1),
           ('Combined summary'::text, 2)
  ), statement_groups as (
    select
      heading,
      count(distinct section_status) as status_count,
      min(section_status) as section_status,
      string_agg(statement_text, ' ' order by ordinal) as section_text
    from rni_publication_statement
    where synthesis_id = value_synthesis_id
    group by heading
  ), citation_groups as (
    select heading, coalesce(
      (
        select jsonb_agg(to_jsonb(citation_id::text) order by citation_id::text)
        from (
          select distinct edge.citation_id
          from rni_publication_statement as statement
          join rni_publication_statement_citation as edge
            on edge.statement_id = statement.id
          where statement.synthesis_id = value_synthesis_id
            and statement.heading = headings.heading
        ) as citations
      ),
      '[]'::jsonb
    ) as citation_ids
    from headings
  )
  select case
    when count(statement_groups.heading) = 3
      and bool_and(statement_groups.status_count = 1)
    then jsonb_agg(
      jsonb_build_object(
        'heading', headings.heading,
        'status', statement_groups.section_status,
        'text', statement_groups.section_text,
        'citationIds', citation_groups.citation_ids
      ) order by headings.heading_ordinal
    )
    else null
  end
  from headings
  left join statement_groups using (heading)
  join citation_groups using (heading)
$$;

create or replace function rni_validate_publication_graph(value_synthesis_id uuid)
returns void language plpgsql as $$
declare
  artifact_row rni_cited_synthesis_artifact%rowtype;
  statement_row rni_publication_statement%rowtype;
  statement_total integer;
  heading_total integer;
  expected jsonb;
  expected_sections jsonb;
  persisted_sections jsonb;
begin
  select * into artifact_row
    from rni_cited_synthesis_artifact where id = value_synthesis_id;
  if artifact_row.id is null then return; end if;

  select count(*), count(distinct heading)
    into statement_total, heading_total
    from rni_publication_statement where synthesis_id = value_synthesis_id;
  if statement_total <> artifact_row.statement_count or heading_total <> 3
     or exists (
       select 1
       from generate_series(0, artifact_row.statement_count - 1) as expected_ordinal
       where not exists (
         select 1 from rni_publication_statement
         where synthesis_id = value_synthesis_id and ordinal = expected_ordinal
       )
     ) then
    raise exception 'RNI publication statements must be complete, contiguous and cover all three headings'
      using errcode = 'check_violation',
            constraint = 'rni_publication_statement_complete_order';
  end if;

  for statement_row in
    select * from rni_publication_statement
     where synthesis_id = value_synthesis_id
  loop
    select coalesce(
        jsonb_agg(to_jsonb(citation_id::text) order by citation_ordinal),
        '[]'::jsonb
      ) into expected
      from rni_publication_statement_citation
     where statement_id = statement_row.id;
    if expected <> statement_row.citation_ids then
      raise exception 'RNI publication statement citation edges must equal its ordered citation manifest'
        using errcode = 'check_violation',
              constraint = 'rni_publication_statement_exact_citations';
    end if;
    if statement_row.origin <> 'coverage_disclosure' and jsonb_array_length(expected) = 0 then
      raise exception 'Every non-coverage RNI publication statement requires a citation'
        using errcode = 'check_violation',
              constraint = 'rni_publication_statement_requires_citation';
    end if;
  end loop;

  select rni_expected_summary_sections(value_synthesis_id) into expected_sections;
  select sections into persisted_sections
    from rni_combined_summary where id = value_synthesis_id;
  if expected_sections is null or persisted_sections is distinct from expected_sections then
    raise exception 'RNI combined summary sections must exactly project ordered publication statements and citation edges'
      using errcode = 'check_violation',
            constraint = 'rni_combined_summary_exact_statement_projection';
  end if;
end;
$$;

create or replace function rni_validate_cited_synthesis_artifact() returns trigger
language plpgsql as $$
declare
  verifier_status text;
  challenger_status text;
  input_count integer;
  assessment_count integer;
begin
  select status into verifier_status
    from rni_synthesis_model_invocation where id = new.verifier_invocation_id;
  select status into challenger_status
    from rni_synthesis_model_invocation where id = new.challenger_invocation_id;
  if verifier_status is distinct from 'succeeded'
     or challenger_status is distinct from 'succeeded' then
    raise exception 'RNI cited synthesis requires distinct terminal successful verifier and challenger invocations'
      using errcode = 'check_violation',
            constraint = 'rni_cited_synthesis_terminal_invocations';
  end if;
  select count(*) into input_count
    from rni_synthesis_claim_input where batch_id = new.batch_id;
  select count(*) into assessment_count
    from rni_catalyst_assessment where batch_id = new.batch_id;
  if input_count <> assessment_count then
    raise exception 'RNI cited synthesis requires exactly one assessment for every catalyst input'
      using errcode = 'check_violation',
            constraint = 'rni_cited_synthesis_complete_assessments';
  end if;
  if not exists (select 1 from rni_challenger_selection where batch_id = new.batch_id) then
    raise exception 'RNI cited synthesis requires one persisted challenger selection'
      using errcode = 'check_violation',
            constraint = 'rni_cited_synthesis_challenger_selection';
  end if;
  perform rni_validate_synthesis_batch_manifests(new.batch_id);
  perform rni_validate_publication_graph(new.id);
  return null;
end;
$$;

create constraint trigger rni_cited_synthesis_artifact_valid
  after insert on rni_cited_synthesis_artifact
  deferrable initially deferred
  for each row execute function rni_validate_cited_synthesis_artifact();

create or replace function rni_validate_future_combined_summary() returns trigger
language plpgsql as $$
declare
  artifact_count integer;
begin
  select count(*) into artifact_count
    from rni_cited_synthesis_artifact
   where id = new.id and run_id = new.run_id and security_id = new.security_id;
  if artifact_count <> 1 then
    raise exception 'A new RNI combined summary requires one complete cited synthesis artifact in the same transaction'
      using errcode = 'check_violation',
            constraint = 'rni_combined_summary_requires_cited_artifact';
  end if;
  perform rni_validate_publication_graph(new.id);
  return null;
end;
$$;

-- Installed after historical rows already exist, so compatibility is preserved. Every future
-- summary insert is checked only at transaction commit, after its artifact/statements/edges can
-- be written atomically.
create constraint trigger rni_combined_summary_requires_cited_artifact
  after insert on rni_combined_summary
  deferrable initially deferred
  for each row execute function rni_validate_future_combined_summary();

create or replace function rni_revalidate_publication_graph() returns trigger
language plpgsql as $$
begin
  perform rni_validate_publication_graph(new.synthesis_id);
  return null;
end;
$$;

create constraint trigger rni_publication_statement_valid
  after insert on rni_publication_statement
  deferrable initially deferred
  for each row execute function rni_revalidate_publication_graph();

create or replace function rni_revalidate_publication_edge() returns trigger
language plpgsql as $$
begin
  perform rni_validate_publication_graph(new.synthesis_id);
  return null;
end;
$$;

create constraint trigger rni_publication_statement_citation_valid
  after insert on rni_publication_statement_citation
  deferrable initially deferred
  for each row execute function rni_revalidate_publication_edge();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'rni_platform_analytics_artifact',
    'rni_convergence_artifact',
    'rni_synthesis_batch',
    'rni_synthesis_claim_input',
    'rni_synthesis_citation_role',
    'rni_catalyst_assessment',
    'rni_challenger_selection',
    'rni_cited_synthesis_artifact',
    'rni_publication_statement',
    'rni_publication_statement_citation'
  ]
  loop
    execute format(
      'create trigger %I_append_only before update or delete on %I
         for each row execute function reject_mutation()',
      table_name, table_name
    );
  end loop;
end;
$$;

comment on table rni_synthesis_batch is
  'Trusted run/security/cutoff/policy boundary for one E08 request and its exact evidence manifest.';
comment on table rni_synthesis_model_invocation is
  'Verifier and challenger calls are prepared before dispatch, use the same ordered claim set, store only allowlisted terminal metadata, and permit one lifecycle transition.';
comment on table rni_synthesis_citation_role is
  'Claim-specific Reddit/X evidence role with point-in-time, rights, run, security, self-citation and exact analytics protections.';
comment on table rni_cited_synthesis_artifact is
  'Immutable hash-addressed E08 replay snapshots linked to exact E07 facts, verifier/challenger lineage, assessments, challenger selection and ordered publication trace.';

-- D-RNI-21 — immutable RNI model capability/configuration lineage and atomic AI spend control.
-- Capability discovery is live integration work; this migration stores its evidence without
-- manufacturing provider slugs or credentials. Historical non-RNI model routes remain nullable.
create table rni_model_capability_snapshot (
  id                          text        primary key,
  ai_route                    text        not null,
  configured_model_id         text        not null,
  provider                    text        not null,
  canonical_provider_model_id text        not null,
  model_revision              text        not null,
  response_hash               text        not null,
  observed_at                 timestamptz not null,
  expires_at                  timestamptz not null,
  available                   boolean     not null,
  supports_responses          boolean     not null,
  supports_structured_outputs boolean     not null,
  supports_web_search         boolean     not null,
  reasoning_efforts           jsonb       not null,
  created_at                  timestamptz not null default now(),

  constraint rni_model_capability_route_check
    check (ai_route in ('openai_direct', 'vercel_ai_gateway')),
  constraint rni_model_capability_identity_check check (
    length(id) > 0 and length(configured_model_id) > 0 and provider = 'openai'
    and length(canonical_provider_model_id) > 0 and length(model_revision) > 0
  ),
  constraint rni_model_capability_hash_check check (response_hash ~ '^[0-9a-f]{64}$'),
  constraint rni_model_capability_window_check check (expires_at > observed_at),
  constraint rni_model_capability_reasoning_check check (
    jsonb_typeof(reasoning_efforts) = 'array'
    and reasoning_efforts <@ '["none", "low", "medium", "high", "xhigh", "max"]'::jsonb
  ),
  constraint rni_model_capability_direct_identity_check check (
    ai_route <> 'openai_direct' or configured_model_id = canonical_provider_model_id
  ),
  constraint rni_model_capability_full_identity_unique unique (
    id, ai_route, configured_model_id, provider, canonical_provider_model_id, model_revision
  )
);

create trigger rni_model_capability_snapshot_append_only
  before update or delete on rni_model_capability_snapshot
  for each row execute function reject_mutation();

create table rni_ai_config (
  config_version             bigint      primary key references config_version (id),
  ai_route                   text        not null,
  model_policy_version       text        not null,
  budget_policy_version      text        not null,
  manual_run_hard_usd        numeric     not null,
  full_universe_hard_usd     numeric     not null,
  rolling_24h_hard_usd       numeric     not null,
  monthly_warning_usd        numeric     not null,
  monthly_hard_usd           numeric     not null,
  currency                   text        not null default 'USD',
  created_at                 timestamptz not null default now(),

  constraint rni_ai_config_route_check
    check (ai_route in ('openai_direct', 'vercel_ai_gateway')),
  constraint rni_ai_config_versions_check
    check (length(model_policy_version) > 0 and length(budget_policy_version) > 0),
  constraint rni_ai_config_limits_check check (
    manual_run_hard_usd > 0
    and manual_run_hard_usd <= full_universe_hard_usd
    and full_universe_hard_usd <= rolling_24h_hard_usd
    and rolling_24h_hard_usd <= monthly_warning_usd
    and monthly_warning_usd <= monthly_hard_usd
  ),
  constraint rni_ai_config_currency_check check (currency = 'USD'),
  constraint rni_ai_config_route_unique unique (config_version, ai_route)
);

create or replace function rni_validate_ai_config() returns trigger
language plpgsql as $$
declare
  config_status text;
begin
  select status into config_status from config_version where id = new.config_version;
  if config_status is distinct from 'draft' then
    raise exception 'RNI AI configuration can only be attached to a draft successor config'
      using errcode = 'check_violation', constraint = 'rni_ai_config_requires_draft';
  end if;
  if new.model_policy_version <> 'rni-balanced-model-policy-v1'
     or new.budget_policy_version <> 'rni-ai-budget-policy-v1' then
    raise exception 'RNI AI configuration uses an unapproved policy version'
      using errcode = 'check_violation', constraint = 'rni_ai_config_approved_policy';
  end if;
  if new.manual_run_hard_usd <> 2
       or new.full_universe_hard_usd <> 25
       or new.rolling_24h_hard_usd <> 50
       or new.monthly_warning_usd <> 300
       or new.monthly_hard_usd <> 500 then
    raise exception 'D-RNI-21 policy v1 requires the owner-approved 2/25/50/300/500 USD limits'
      using errcode = 'check_violation', constraint = 'rni_ai_config_policy_v1_limits';
  end if;
  return new;
end;
$$;

create trigger rni_ai_config_valid
  before insert on rni_ai_config
  for each row execute function rni_validate_ai_config();
create trigger rni_ai_config_append_only
  before update or delete on rni_ai_config
  for each row execute function reject_mutation();

alter table model_route
  add column ai_route text null,
  add column canonical_provider_model_id text null,
  add column reasoning_effort text null,
  add column capability_snapshot_id text null,
  add column policy_version text null,
  add constraint model_route_rni_lineage_complete_check check (
    task not in (
      'rni_discovery', 'rni_relationship', 'rni_classifier', 'rni_verification', 'rni_challenger'
    )
    or (
      ai_route is not null and canonical_provider_model_id is not null
      and reasoning_effort is not null and capability_snapshot_id is not null
      and policy_version is not null
    )
  ) not valid,
  add constraint model_route_rni_ai_route_check check (
    ai_route is null or ai_route in ('openai_direct', 'vercel_ai_gateway')
  ),
  add constraint model_route_rni_reasoning_check check (
    reasoning_effort is null or reasoning_effort in ('none', 'low', 'medium', 'high', 'xhigh', 'max')
  ),
  add constraint model_route_rni_config_fk foreign key (config_version, ai_route)
    references rni_ai_config (config_version, ai_route) not valid,
  add constraint model_route_rni_capability_fk foreign key (
    capability_snapshot_id, ai_route, primary_model, primary_provider,
    canonical_provider_model_id, model_revision
  ) references rni_model_capability_snapshot (
    id, ai_route, configured_model_id, provider, canonical_provider_model_id, model_revision
  ) not valid,
  add constraint model_route_rni_invocation_identity_unique unique (
    config_version, task, ai_route, capability_snapshot_id
  ),
  add constraint model_route_rni_task_route_unique unique (config_version, task, ai_route);

create or replace function rni_validate_model_route() returns trigger
language plpgsql as $$
declare
  config_row rni_ai_config%rowtype;
  capability_row rni_model_capability_snapshot%rowtype;
  config_status text;
  expected_model text;
begin
  if new.task not in (
    'rni_discovery', 'rni_relationship', 'rni_classifier', 'rni_verification', 'rni_challenger'
  ) then
    return new;
  end if;

  select * into config_row from rni_ai_config where config_version = new.config_version;
  select status into config_status from config_version where id = new.config_version;
  select * into capability_row from rni_model_capability_snapshot where id = new.capability_snapshot_id;
  if config_row.config_version is null or capability_row.id is null then
    raise exception 'RNI model routes require durable configuration and capability lineage'
      using errcode = 'check_violation', constraint = 'model_route_rni_lineage';
  end if;
  if config_status is distinct from 'draft' then
    raise exception 'RNI model routes can only be added to a draft successor config'
      using errcode = 'check_violation', constraint = 'model_route_rni_requires_draft';
  end if;
  if new.ai_route is distinct from config_row.ai_route
     or new.policy_version is distinct from config_row.model_policy_version
     or new.primary_provider <> 'openai'
     or new.fallback_chain <> '[]'::jsonb
     or new.reasoning_effort <> 'low'
     or not capability_row.available
     or not capability_row.supports_responses
     or not capability_row.supports_structured_outputs
     or not (capability_row.reasoning_efforts ? 'low') then
    raise exception 'RNI model route is not an available OpenAI low-reasoning no-fallback route'
      using errcode = 'check_violation', constraint = 'model_route_rni_policy';
  end if;
  if new.task = 'rni_discovery' and not capability_row.supports_web_search then
    raise exception 'RNI discovery requires a Web Search-capable model snapshot'
      using errcode = 'check_violation', constraint = 'model_route_rni_discovery_capability';
  end if;
  if new.policy_version = 'rni-balanced-model-policy-v1' then
    expected_model := case
      when new.task in ('rni_discovery', 'rni_relationship', 'rni_classifier') then 'gpt-5.6-terra'
      else 'gpt-5.6-sol'
    end;
    if new.canonical_provider_model_id <> expected_model then
      raise exception 'RNI balanced policy task/model mapping is invalid'
        using errcode = 'check_violation', constraint = 'model_route_rni_balanced_mapping';
    end if;
  end if;
  return new;
end;
$$;

create trigger model_route_rni_valid
  before insert or update on model_route
  for each row execute function rni_validate_model_route();

create or replace function rni_reject_locked_model_route_mutation() returns trigger
language plpgsql as $$
declare
  route_task text := case when tg_op = 'DELETE' then old.task else new.task end;
  route_config bigint := case when tg_op = 'DELETE' then old.config_version else new.config_version end;
  config_status text;
begin
  if route_task in (
    'rni_discovery', 'rni_relationship', 'rni_classifier', 'rni_verification', 'rni_challenger'
  ) then
    select status into config_status from config_version where id = route_config;
    if config_status is distinct from 'draft' then
      raise exception 'Activated RNI model routes are immutable; create a successor config'
        using errcode = 'restrict_violation';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger model_route_rni_locked
  before update or delete on model_route
  for each row execute function rni_reject_locked_model_route_mutation();

create or replace function rni_validate_ai_config_activation() returns trigger
language plpgsql as $$
declare
  route_count integer;
  task_count integer;
  stale_count integer;
begin
  if new.status = 'active' and old.status is distinct from 'active'
     and exists (select 1 from rni_ai_config where config_version = new.id) then
    select count(*), count(distinct task), count(*) filter (where c.expires_at <= clock_timestamp())
      into route_count, task_count, stale_count
      from model_route mr
      join rni_model_capability_snapshot c on c.id = mr.capability_snapshot_id
     where mr.config_version = new.id
       and mr.task in (
         'rni_discovery', 'rni_relationship', 'rni_classifier',
         'rni_verification', 'rni_challenger'
       );
    if route_count <> 5 or task_count <> 5 then
      raise exception 'Active RNI configuration requires exactly five governed task routes'
        using errcode = 'check_violation', constraint = 'rni_ai_config_exact_routes';
    end if;
    if stale_count <> 0 then
      raise exception 'Active RNI configuration requires fresh capability snapshots'
        using errcode = 'check_violation', constraint = 'rni_ai_config_fresh_capabilities';
    end if;
  end if;
  return new;
end;
$$;

create trigger rni_ai_config_activation_valid
  before update on config_version
  for each row execute function rni_validate_ai_config_activation();

alter table rni_run
  add constraint rni_run_config_route_unique unique (id, config_version, ai_route);

create table rni_run_execution_scope (
  run_id       uuid        primary key references rni_run (id),
  scope_kind   text        not null,
  security_id  uuid        null references security (id),
  created_at   timestamptz not null default now(),

  constraint rni_run_execution_scope_kind_check
    check (scope_kind in ('manual_ticker', 'full_universe')),
  constraint rni_run_execution_scope_security_check check (
    (scope_kind = 'manual_ticker' and security_id is not null)
    or (scope_kind = 'full_universe' and security_id is null)
  ),
  constraint rni_run_execution_scope_identity_unique unique (run_id, scope_kind)
);

create or replace function rni_validate_run_execution_scope() returns trigger
language plpgsql as $$
declare
  run_row rni_run%rowtype;
begin
  select * into run_row from rni_run where id = new.run_id;
  if new.scope_kind = 'manual_ticker' then
    if run_row.trigger <> 'manual' then
      raise exception 'Manual ticker budget scope requires a manual run'
        using errcode = 'check_violation', constraint = 'rni_run_scope_manual_trigger';
    end if;
    if not exists (
      select 1 from universe_member
       where universe_version = run_row.universe_version
         and security_id = new.security_id and enabled
    ) then
      raise exception 'Manual ticker budget scope must name an enabled run-universe member'
        using errcode = 'check_violation', constraint = 'rni_run_scope_universe_member';
    end if;
  end if;
  return new;
end;
$$;

create trigger rni_run_execution_scope_valid
  before insert on rni_run_execution_scope
  for each row execute function rni_validate_run_execution_scope();
create trigger rni_run_execution_scope_append_only
  before update or delete on rni_run_execution_scope
  for each row execute function reject_mutation();

create table rni_ai_model_invocation (
  id                        uuid        primary key,
  run_id                    uuid        not null,
  config_version            bigint      not null,
  task                      text        not null,
  ai_route                  text        not null,
  capability_snapshot_id    text        not null,
  request_hash              text        not null,
  decision                  text        not null,
  estimated_cost_usd        numeric     null,
  denial_code               text        null,
  price_book_version        text        not null,
  reservation_cost_event_id uuid        null references cost_event (id),
  synthesis_invocation_id   uuid        null references rni_synthesis_model_invocation (id),
  created_at                timestamptz not null default now(),

  constraint rni_ai_invocation_task_check check (task in (
    'rni_discovery', 'rni_relationship', 'rni_classifier', 'rni_verification', 'rni_challenger'
  )),
  constraint rni_ai_invocation_hash_check check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint rni_ai_invocation_decision_check check (decision in ('reserved', 'denied')),
  constraint rni_ai_invocation_decision_shape_check check (
    (decision = 'reserved' and estimated_cost_usd is not null and estimated_cost_usd >= 0
      and denial_code is null and reservation_cost_event_id is not null)
    or
    (decision = 'denied' and estimated_cost_usd is null
      and denial_code is not null and reservation_cost_event_id is null)
  ),
  constraint rni_ai_invocation_synthesis_identity_check check (
    (task in ('rni_verification', 'rni_challenger') and synthesis_invocation_id = id)
    or (task not in ('rni_verification', 'rni_challenger') and synthesis_invocation_id is null)
  ),
  constraint rni_ai_invocation_run_fk foreign key (run_id, config_version, ai_route)
    references rni_run (id, config_version, ai_route),
  constraint rni_ai_invocation_config_fk foreign key (config_version, ai_route)
    references rni_ai_config (config_version, ai_route),
  constraint rni_ai_invocation_scope_fk foreign key (run_id)
    references rni_run_execution_scope (run_id),
  constraint rni_ai_invocation_route_fk foreign key (config_version, task, ai_route)
    references model_route (config_version, task, ai_route),
  constraint rni_ai_invocation_capability_fk foreign key (capability_snapshot_id)
    references rni_model_capability_snapshot (id)
);

create or replace function rni_validate_ai_invocation_capability() returns trigger
language plpgsql as $$
declare
  route_row model_route%rowtype;
  capability_row rni_model_capability_snapshot%rowtype;
  synthesis_stage text;
begin
  select * into route_row from model_route
   where config_version = new.config_version and task = new.task and ai_route = new.ai_route;
  select * into capability_row from rni_model_capability_snapshot
   where id = new.capability_snapshot_id;
  if capability_row.id is null
     or capability_row.ai_route <> route_row.ai_route
     or capability_row.configured_model_id <> route_row.primary_model
     or capability_row.provider <> route_row.primary_provider
     or capability_row.canonical_provider_model_id <> route_row.canonical_provider_model_id
     or capability_row.model_revision <> route_row.model_revision
     or not capability_row.available
     or not capability_row.supports_responses
     or not capability_row.supports_structured_outputs
     or not (capability_row.reasoning_efforts ? route_row.reasoning_effort)
     or (new.task = 'rni_discovery' and not capability_row.supports_web_search)
     or capability_row.observed_at > new.created_at
     or capability_row.expires_at <= new.created_at then
    raise exception 'RNI invocation requires a fresh exact capability snapshot for its immutable route'
      using errcode = 'check_violation', constraint = 'rni_ai_invocation_fresh_capability';
  end if;
  if new.task in ('rni_verification', 'rni_challenger') then
    select stage into synthesis_stage from rni_synthesis_model_invocation where id = new.id;
    if synthesis_stage is distinct from (
      case when new.task = 'rni_verification' then 'verifier' else 'challenger' end
    ) then
      raise exception 'RNI synthesis invocation stage does not match its governed model task'
        using errcode = 'check_violation', constraint = 'rni_ai_invocation_synthesis_stage';
    end if;
  end if;
  return new;
end;
$$;

create trigger rni_ai_model_invocation_capability_valid
  before insert on rni_ai_model_invocation
  for each row execute function rni_validate_ai_invocation_capability();

create table rni_ai_model_settlement (
  invocation_id        uuid        primary key references rni_ai_model_invocation (id),
  request_hash         text        not null,
  provider_request_id  text        not null,
  outcome              text        not null,
  input_tokens         integer     not null,
  cached_input_tokens  integer     not null,
  output_tokens        integer     not null,
  web_search_calls     integer     not null,
  actual_cost_usd      numeric     not null,
  actual_cost_event_id uuid        not null references cost_event (id),
  completed_at         timestamptz not null default now(),

  constraint rni_ai_settlement_hash_check check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint rni_ai_settlement_outcome_check check (outcome in ('succeeded', 'failed')),
  constraint rni_ai_settlement_usage_check check (
    input_tokens >= 0 and cached_input_tokens >= 0 and cached_input_tokens <= input_tokens
    and output_tokens >= 0 and web_search_calls >= 0 and actual_cost_usd >= 0
  )
);

create table rni_ai_budget_warning (
  config_version   bigint      not null references rni_ai_config (config_version),
  environment      text        not null,
  period_start     timestamptz not null,
  warning_code     text        not null,
  effective_usd    numeric     not null,
  emitted_at       timestamptz not null default now(),
  primary key (environment, period_start, warning_code),
  constraint rni_ai_budget_warning_code_check check (warning_code = 'monthly_warning'),
  constraint rni_ai_budget_warning_amount_check check (effective_usd >= 0)
);

create index rni_ai_model_invocation_run_idx on rni_ai_model_invocation (run_id, created_at);
create index rni_ai_model_invocation_window_idx on rni_ai_model_invocation (created_at);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'rni_ai_model_invocation', 'rni_ai_model_settlement', 'rni_ai_budget_warning'
  ]
  loop
    execute format(
      'create trigger %I_append_only before update or delete on %I
         for each row execute function reject_mutation()',
      table_name, table_name
    );
  end loop;
end;
$$;

create or replace function rni_ai_effective_spend(
  p_environment text,
  p_from timestamptz,
  p_to timestamptz,
  p_run_id uuid default null
) returns numeric
language sql stable as $$
  select coalesce(sum(coalesce(s.actual_cost_usd, i.estimated_cost_usd)), 0)
    from rni_ai_model_invocation i
    join rni_run r on r.id = i.run_id
    join config_version cv on cv.id = i.config_version
    left join rni_ai_model_settlement s on s.invocation_id = i.id
   where i.decision = 'reserved'
     and cv.environment = p_environment
     and i.created_at >= p_from and i.created_at < p_to
     and (p_run_id is null or i.run_id = p_run_id)
$$;

create or replace function rni_reserve_ai_invocation(
  p_invocation_id uuid,
  p_run_id uuid,
  p_task text,
  p_request_hash text,
  p_capability_snapshot_id text,
  p_price_book_version text
) returns table (
  invocation_id uuid,
  decision text,
  estimated_cost_usd numeric,
  denial_code text,
  warning_emitted boolean
)
language plpgsql as $$
declare
  existing rni_ai_model_invocation%rowtype;
  run_row rni_run%rowtype;
  scope_row rni_run_execution_scope%rowtype;
  config_row rni_ai_config%rowtype;
  route_row model_route%rowtype;
  now_at timestamptz := clock_timestamp();
  input_price numeric;
  output_price numeric;
  search_price numeric := 0;
  estimate numeric;
  run_spend numeric;
  rolling_spend numeric;
  month_spend numeric;
  run_limit numeric;
  deny text;
  reservation_event uuid;
  warning_inserted boolean := false;
  warning_rows integer := 0;
  run_environment text;
  config_status text;
  month_start timestamptz;
begin
  if p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'RNI invocation request hash must be lowercase SHA-256'
      using errcode = 'check_violation';
  end if;

  select * into run_row from rni_run where id = p_run_id for share;
  if run_row.id is null then raise exception 'RNI run % not found', p_run_id; end if;
  select * into config_row from rni_ai_config where config_version = run_row.config_version;
  select * into scope_row from rni_run_execution_scope where run_id = p_run_id;
  select * into route_row from model_route
   where config_version = run_row.config_version and task = p_task and ai_route = run_row.ai_route;
  if config_row.config_version is null or scope_row.run_id is null or route_row.task is null then
    raise exception 'RNI invocation requires exact run scope, route and configuration lineage'
      using errcode = 'check_violation';
  end if;

  select status, environment into strict config_status, run_environment
    from config_version where id = run_row.config_version for share;

  perform pg_advisory_xact_lock(hashtextextended('rni-ai-budget:' || run_environment, 0));
  select * into existing from rni_ai_model_invocation where id = p_invocation_id;
  if existing.id is not null then
    if existing.run_id <> p_run_id or existing.task <> p_task
       or existing.request_hash <> p_request_hash
       or existing.capability_snapshot_id <> p_capability_snapshot_id
       or existing.price_book_version <> p_price_book_version then
      raise exception 'RNI invocation idempotency key was reused with different intent'
        using errcode = 'unique_violation';
    end if;
    return query select existing.id, existing.decision, existing.estimated_cost_usd,
      existing.denial_code, false;
    return;
  end if;
  if config_status <> 'active' or run_row.status not in ('requested', 'running') then
    raise exception 'RNI invocation requires an active config and a non-terminal run'
      using errcode = 'check_violation';
  end if;

  select unit_price into input_price from unit_price_book
   where price_book_version = p_price_book_version and provider = 'openai'
     and service = 'openai_responses'
     and operation_or_model = route_row.canonical_provider_model_id
     and unit_type = 'input_token' and currency = 'USD'
     and effective_from <= now_at and (effective_until is null or effective_until > now_at);
  select unit_price into output_price from unit_price_book
   where price_book_version = p_price_book_version and provider = 'openai'
     and service = 'openai_responses'
     and operation_or_model = route_row.canonical_provider_model_id
     and unit_type = 'output_token' and currency = 'USD'
     and effective_from <= now_at and (effective_until is null or effective_until > now_at);
  if p_task = 'rni_discovery' then
    select unit_price into search_price from unit_price_book
     where price_book_version = p_price_book_version and provider = 'openai'
       and service = 'openai_web_search' and operation_or_model = 'web_search'
       and unit_type = 'search' and currency = 'USD'
       and effective_from <= now_at and (effective_until is null or effective_until > now_at);
  end if;

  if input_price is null or output_price is null or search_price is null then
    insert into rni_ai_model_invocation (
      id, run_id, config_version, task, ai_route, capability_snapshot_id, request_hash,
      decision, denial_code, price_book_version, synthesis_invocation_id, created_at
    ) values (
      p_invocation_id, p_run_id, run_row.config_version, p_task, run_row.ai_route,
      p_capability_snapshot_id, p_request_hash, 'denied', 'unpriced_component',
      p_price_book_version,
      case when p_task in ('rni_verification', 'rni_challenger') then p_invocation_id else null end,
      now_at
    );
    return query select p_invocation_id, 'denied'::text, null::numeric,
      'unpriced_component'::text, false;
    return;
  end if;

  estimate := route_row.max_input_tokens * input_price
    + route_row.max_output_tokens * output_price + search_price;
  month_start := date_trunc('month', now_at at time zone 'UTC') at time zone 'UTC';
  run_limit := case when scope_row.scope_kind = 'manual_ticker'
    then config_row.manual_run_hard_usd else config_row.full_universe_hard_usd end;
  run_spend := rni_ai_effective_spend(
    run_environment,
    '-infinity'::timestamptz, 'infinity'::timestamptz, p_run_id
  );
  rolling_spend := rni_ai_effective_spend(
    run_environment,
    now_at - interval '24 hours', now_at + interval '1 microsecond'
  );
  month_spend := rni_ai_effective_spend(
    run_environment,
    month_start, now_at + interval '1 microsecond'
  );

  deny := case
    when estimate > route_row.max_cost_usd then 'route_hard_limit'
    when run_spend + estimate > run_limit then 'run_hard_limit'
    when rolling_spend + estimate > config_row.rolling_24h_hard_usd then 'rolling_24h_hard_limit'
    when month_spend + estimate > config_row.monthly_hard_usd then 'monthly_hard_limit'
    else null
  end;
  if deny is not null then
    insert into rni_ai_model_invocation (
      id, run_id, config_version, task, ai_route, capability_snapshot_id, request_hash,
      decision, denial_code, price_book_version, synthesis_invocation_id, created_at
    ) values (
      p_invocation_id, p_run_id, run_row.config_version, p_task, run_row.ai_route,
      p_capability_snapshot_id, p_request_hash, 'denied', deny,
      p_price_book_version,
      case when p_task in ('rni_verification', 'rni_challenger') then p_invocation_id else null end,
      now_at
    );
    return query select p_invocation_id, 'denied'::text, null::numeric, deny, false;
    return;
  end if;

  insert into cost_event (
    occurred_at, provider, service, operation_or_model, feature, request_id, unit_type,
    request_units, billable_units, unit_price, currency, price_book_version, cost_usd,
    cost_status, cache_status, metadata
  ) values (
    now_at, 'openai', 'rni_ai_reservation', route_row.canonical_provider_model_id, 'rni',
    p_invocation_id::text, 'call', 1, 1, estimate, 'USD', p_price_book_version, estimate,
    'estimated', 'miss', jsonb_build_object(
      'run_id', p_run_id, 'task', p_task, 'ai_route', run_row.ai_route,
      'capability_snapshot_id', p_capability_snapshot_id
    )
  ) returning id into reservation_event;
  insert into rni_ai_model_invocation (
    id, run_id, config_version, task, ai_route, capability_snapshot_id, request_hash,
    decision, estimated_cost_usd, price_book_version, reservation_cost_event_id,
    synthesis_invocation_id, created_at
  ) values (
    p_invocation_id, p_run_id, run_row.config_version, p_task, run_row.ai_route,
    p_capability_snapshot_id, p_request_hash, 'reserved', estimate,
    p_price_book_version, reservation_event,
    case when p_task in ('rni_verification', 'rni_challenger') then p_invocation_id else null end,
    now_at
  );

  if month_spend + estimate >= config_row.monthly_warning_usd then
    insert into rni_ai_budget_warning (
      config_version, environment, period_start, warning_code, effective_usd, emitted_at
    ) values (
      config_row.config_version,
      run_environment,
      month_start, 'monthly_warning', month_spend + estimate, now_at
    ) on conflict do nothing;
    get diagnostics warning_rows = row_count;
    warning_inserted := warning_rows = 1;
  end if;
  return query select p_invocation_id, 'reserved'::text, estimate, null::text, warning_inserted;
end;
$$;

create or replace function rni_settle_ai_invocation(
  p_invocation_id uuid,
  p_request_hash text,
  p_provider_request_id text,
  p_outcome text,
  p_input_tokens integer,
  p_cached_input_tokens integer,
  p_output_tokens integer,
  p_web_search_calls integer
) returns numeric
language plpgsql as $$
declare
  invocation_row rni_ai_model_invocation%rowtype;
  settlement_row rni_ai_model_settlement%rowtype;
  route_row model_route%rowtype;
  input_price numeric;
  output_price numeric;
  search_price numeric := 0;
  actual numeric;
  actual_event uuid;
begin
  select * into invocation_row from rni_ai_model_invocation where id = p_invocation_id;
  if invocation_row.id is null or invocation_row.decision <> 'reserved' then
    raise exception 'Only a reserved RNI invocation can be settled'
      using errcode = 'check_violation';
  end if;
  if invocation_row.request_hash <> p_request_hash then
    raise exception 'RNI settlement request hash does not match its reservation'
      using errcode = 'check_violation';
  end if;
  select * into settlement_row from rni_ai_model_settlement where invocation_id = p_invocation_id;
  if settlement_row.invocation_id is not null then
    if settlement_row.request_hash <> p_request_hash
       or settlement_row.provider_request_id <> p_provider_request_id
       or settlement_row.outcome <> p_outcome
       or settlement_row.input_tokens <> p_input_tokens
       or settlement_row.cached_input_tokens <> p_cached_input_tokens
       or settlement_row.output_tokens <> p_output_tokens
       or settlement_row.web_search_calls <> p_web_search_calls then
      raise exception 'RNI settlement replay differs from the committed result'
        using errcode = 'unique_violation';
    end if;
    return settlement_row.actual_cost_usd;
  end if;
  select * into route_row from model_route
   where config_version = invocation_row.config_version and task = invocation_row.task
     and ai_route = invocation_row.ai_route
     and capability_snapshot_id = invocation_row.capability_snapshot_id;
  if p_outcome not in ('succeeded', 'failed')
     or p_input_tokens < 0 or p_cached_input_tokens < 0
     or p_cached_input_tokens > p_input_tokens or p_output_tokens < 0
     or p_input_tokens > route_row.max_input_tokens
     or p_output_tokens > route_row.max_output_tokens
     or p_web_search_calls < 0
     or (invocation_row.task = 'rni_discovery' and p_web_search_calls > 1)
     or (invocation_row.task <> 'rni_discovery' and p_web_search_calls <> 0) then
    raise exception 'RNI settlement usage exceeds the reserved invocation envelope'
      using errcode = 'check_violation';
  end if;
  select unit_price into input_price from unit_price_book
   where price_book_version = invocation_row.price_book_version and provider = 'openai'
     and service = 'openai_responses'
     and operation_or_model = route_row.canonical_provider_model_id
     and unit_type = 'input_token' and currency = 'USD';
  select unit_price into output_price from unit_price_book
   where price_book_version = invocation_row.price_book_version and provider = 'openai'
     and service = 'openai_responses'
     and operation_or_model = route_row.canonical_provider_model_id
     and unit_type = 'output_token' and currency = 'USD';
  if invocation_row.task = 'rni_discovery' then
    select unit_price into search_price from unit_price_book
     where price_book_version = invocation_row.price_book_version and provider = 'openai'
       and service = 'openai_web_search' and operation_or_model = 'web_search'
       and unit_type = 'search' and currency = 'USD';
  end if;
  if input_price is null or output_price is null or search_price is null then
    raise exception 'RNI settlement price components are unavailable'
      using errcode = 'check_violation';
  end if;
  actual := p_input_tokens * input_price + p_output_tokens * output_price
    + p_web_search_calls * search_price;
  if actual > invocation_row.estimated_cost_usd then
    raise exception 'RNI actual cost exceeds its worst-case reservation'
      using errcode = 'check_violation';
  end if;
  insert into cost_event (
    occurred_at, provider, service, operation_or_model, feature, request_id, unit_type,
    request_units, billable_units, unit_price, currency, price_book_version, cost_usd,
    cost_status, cache_status, metadata, supersedes_cost_event_id
  ) values (
    clock_timestamp(), 'openai', 'rni_ai_actual', route_row.canonical_provider_model_id,
    'rni', p_invocation_id::text, 'call', 1, 1, actual, 'USD',
    invocation_row.price_book_version, actual, 'reconciled', 'miss',
    jsonb_build_object('provider_request_id', p_provider_request_id, 'outcome', p_outcome),
    invocation_row.reservation_cost_event_id
  ) returning id into actual_event;
  insert into rni_ai_model_settlement (
    invocation_id, request_hash, provider_request_id, outcome, input_tokens,
    cached_input_tokens, output_tokens, web_search_calls, actual_cost_usd,
    actual_cost_event_id
  ) values (
    p_invocation_id, p_request_hash, p_provider_request_id, p_outcome, p_input_tokens,
    p_cached_input_tokens, p_output_tokens, p_web_search_calls, actual, actual_event
  );
  return actual;
end;
$$;

comment on table rni_ai_config is
  'Versioned D-RNI-21 route selection and AI spend ceilings. Secrets and provider credentials never enter this table.';
comment on table rni_ai_model_invocation is
  'One immutable pre-dispatch decision. Reserved calls retain worst-case exposure until an exact settlement exists; denied calls never dispatch.';
comment on table rni_ai_budget_warning is
  'Once-only calendar-month warning evidence, serialized with reservation decisions.';
