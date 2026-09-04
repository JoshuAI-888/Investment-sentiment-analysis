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
