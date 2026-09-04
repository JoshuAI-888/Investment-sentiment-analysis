-- 0007 — job definitions, job runs, provider policy and raw payloads (ADR-013).

create table job_definition (
  id                    uuid        primary key default gen_random_uuid(),
  job_key               text        not null unique,
  display_name          text        not null,
  enabled               boolean     not null default true,
  schedule_type         text        not null,
  schedule_expression   text        not null,
  display_timezone      text        not null default 'UTC',
  active_windows        jsonb       not null default '[]'::jsonb,
  jitter_seconds        integer     not null default 0,
  scope                 jsonb       not null default '{}'::jsonb,
  priority              integer     not null default 100,
  max_runtime_seconds   integer     not null,
  concurrency_policy    text        not null default 'skip',
  max_attempts          integer     not null default 3,
  backoff_policy        jsonb       not null default '{}'::jsonb,
  dependencies          jsonb       not null default '[]'::jsonb,
  max_calls_per_run     integer     null,
  max_cost_usd_per_run  numeric     null,
  -- D-15: the trigger path may only dispatch a job that was registered trigger-eligible, and
  -- eligibility is a seeded column rather than a runtime decision (F16 §4.1b).
  trigger_eligible      boolean     not null default false,
  next_due_at           timestamptz not null,
  config_version        bigint      not null references config_version (id),
  version               integer     not null default 1,
  updated_by            text        not null,
  updated_at            timestamptz not null default now(),
  created_at            timestamptz not null default now(),

  constraint job_schedule_type_check check (schedule_type in ('interval', 'cron')),
  constraint job_concurrency_policy_check check (
    concurrency_policy in ('skip', 'queue', 'cancel_running')
  )
);

comment on column job_definition.trigger_eligible is
  'D-15 / F16 §4.1b. A market-data spike may open an X sampling window, but only against a job registered here as eligible. Making this a seeded column rather than a runtime predicate is what stops a spike from dispatching something nobody costed.';

create table job_run (
  id                  uuid        primary key default gen_random_uuid(),
  job_id              uuid        not null references job_definition (id),
  trigger_type        text        not null,
  idempotency_key     text        not null unique,
  config_version      bigint      not null references config_version (id),
  universe_version    bigint      null references universe_version (id),
  status              text        not null,
  attempt             integer     not null default 1,
  dry_run             boolean     not null default false,
  requested_by        text        null,
  request_reason      text        null,
  lock_key            text        not null,
  started_at          timestamptz null,
  completed_at        timestamptz null,
  data_as_of          timestamptz null,
  items_read          integer     not null default 0,
  items_written       integer     not null default 0,
  provider_calls      integer     not null default 0,
  estimated_cost_usd  numeric     not null default 0,
  unpriced_units      jsonb       not null default '{}'::jsonb,
  error               jsonb       null,
  metrics             jsonb       not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),

  constraint job_run_trigger_type_check check (
    -- `triggered` is D-15's second dispatch path: opened by a market-data event, not a clock.
    trigger_type in ('scheduled', 'manual', 'bootstrap', 'retry', 'triggered')
  ),
  constraint job_run_status_check check (
    status in ('queued', 'running', 'succeeded', 'degraded', 'failed', 'cancelled', 'skipped')
  )
);

comment on column job_run.idempotency_key is
  'F16 §4.1: derived from (job_id, due_at). A re-delivery of the same due instant is a no-op, and the UNIQUE constraint is what makes that true under concurrency rather than under review.';

create index job_run_job_started_idx on job_run (job_id, started_at desc);

create table provider_policy (
  config_version       bigint  not null references config_version (id),
  provider             text    not null,
  enabled              boolean not null default true,
  plan_name            text    not null,
  allowed_operations   jsonb   not null default '[]'::jsonb,
  default_job_id       uuid    null references job_definition (id),
  timeout_ms           integer not null,
  retry_count          integer not null default 2,
  daily_call_cap       integer null,
  warning_age_seconds  integer not null,
  hard_expiry_seconds  integer not null,
  retention_days       integer not null,
  rights_status        text    not null,
  attribution_text     text    null,
  created_at           timestamptz not null default now(),

  primary key (config_version, provider),
  constraint provider_policy_rights_status_check check (
    rights_status in ('internal_only', 'display_permitted', 'not_established', 'blocked')
  )
);

comment on column provider_policy.rights_status is
  'Mirrors docs/provider-rights.md. `not_established` is the default and is NOT the same as `blocked` — it means nobody has checked, which is the state most providers are actually in.';

create table data_agreement (
  id                       uuid    primary key default gen_random_uuid(),
  provider                 text    not null,
  product_name             text    not null,
  agreement_status         text    not null,
  allowed_purposes         jsonb   not null default '[]'::jsonb,
  prohibited_purposes      jsonb   not null default '[]'::jsonb,
  geographic_scope         jsonb   not null default '{}'::jsonb,
  user_product_scope       jsonb   not null default '{}'::jsonb,
  attribution_requirements text    null,
  retention_days           integer null,
  deletion_obligations     text    null,
  quota_terms              jsonb   not null default '{}'::jsonb,
  contract_owner           text    not null,
  operational_contact      text    null,
  document_reference       text    null,
  starts_at                date    null,
  renews_at                date    null,
  expires_at               date    null,
  next_review_at           date    not null,
  reviewed_by              text    not null,
  reviewed_at              timestamptz not null default now(),
  notes                    text    null,
  created_at               timestamptz not null default now()
);

comment on column data_agreement.deletion_obligations is
  'The open Reddit conflict lands here. Product invariant §6.8 retains full Reddit bodies indefinitely; the Data API terms impose deletion obligations. The approved agreement decides, and this column is where the answer gets recorded rather than remembered.';

create table provider_call_log (
  id                  uuid        primary key default gen_random_uuid(),
  provider            text        not null,
  operation           text        not null,
  request_fingerprint text        not null,
  status_code         integer     null,
  latency_ms          integer     not null,
  cache_status        text        not null,
  items_returned      integer     null,
  estimated_cost_usd  numeric     not null default 0,
  started_at          timestamptz not null,
  error_class         text        null,
  created_at          timestamptz not null default now()
);

create index provider_call_log_provider_started_idx on provider_call_log (provider, started_at desc);

create table raw_provider_payload (
  id                  uuid        primary key default gen_random_uuid(),
  provider            text        not null,
  operation           text        not null,
  job_run_id          uuid        null references job_run (id),
  research_run_id     uuid        null references research_run (id),
  security_id         uuid        null references security (id),
  request_fingerprint text        not null,
  http_status         integer     null,
  sanitized_payload   jsonb       null,
  payload_hash        text        not null,
  content_class       text        not null,
  redaction_status    text        not null,
  rights_status       text        not null,
  parser_version      text        not null,
  data_as_of          timestamptz null,
  ingested_at         timestamptz not null default now(),
  retention_until     timestamptz not null,
  created_at          timestamptz not null default now()
);

comment on table raw_provider_payload is
  'Store a hash and metadata WITHOUT a payload where rights forbid raw retention — sanitized_payload is nullable for exactly that case. Never store authorization headers, API keys, unrestricted personal data, or full social content unless the agreement explicitly permits it.';
