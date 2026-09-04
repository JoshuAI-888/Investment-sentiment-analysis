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
  );

comment on constraint universe_version_max_symbols_check on universe_version is
  'D-RNI-06. 600 is a safety ceiling for a complete current S&P 500 snapshot, including ordinary constituent share classes and composition churn; configured limits may be lower, never higher.';

comment on column universe_version.source_payload_hash is
  'SHA-256 of the exact FMP constituent response used to derive this immutable candidate. Historical non-FMP versions remain null.';

comment on column universe_version.approved_by is
  'Immutable approval recorded on the successor version before activation. The append-only trigger deliberately does not permit this field to change.';

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
