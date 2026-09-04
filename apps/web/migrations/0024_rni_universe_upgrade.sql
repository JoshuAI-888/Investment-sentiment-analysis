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
  run_id         uuid        not null references rni_run (id),
  observation_id uuid        not null,
  source_item_id uuid        not null,
  security_id    uuid        not null,
  created_at     timestamptz not null default now(),

  primary key (run_id, observation_id),
  constraint rni_run_observation_observation_fk
    foreign key (observation_id, source_item_id, security_id)
    references rni_security_observation (id, source_item_id, security_id),
  constraint rni_run_observation_identity_unique
    unique (run_id, source_item_id, security_id)
);

comment on table rni_run_observation is
  'Immutable run membership for an independently classified source/security observation. One multi-ticker source therefore has one row per security and never shares semantic output.';

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
