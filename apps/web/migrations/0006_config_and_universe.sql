-- 0006 — versioned configuration and the governed universe (ADR-012, ADR-015).

-- ── config_version + app_setting ────────────────────────────────────────────────────────────
create table config_version (
  id             bigserial   primary key,
  environment    text        not null,
  status         text        not null,
  parent_version bigint      null references config_version (id),
  created_by     text        not null,
  change_reason  text        not null,
  created_at     timestamptz not null default now(),
  effective_at   timestamptz not null default now(),
  activated_at   timestamptz null,
  approved_by    text        null,
  checksum       text        not null,

  constraint config_version_status_check check (
    status in ('draft', 'staged', 'active', 'superseded', 'rolled_back')
  )
);

-- F03 §4.3: at most one active version per environment, enforced by a partial unique index
-- and NOT by application logic. Application logic is what fails during a concurrent
-- activation, which is the only moment this matters.
create unique index config_version_single_active
  on config_version (environment)
  where status = 'active';

create table app_setting (
  config_version         bigint  not null references config_version (id),
  setting_key            text    not null,
  scope_type             text    not null,
  scope_id               text    not null,
  value                  jsonb   not null,
  value_type             text    not null,
  governance_class       text    not null,
  setting_schema_version text    not null,
  method_affecting       boolean not null default false,
  sensitive              boolean not null default false,
  created_at             timestamptz not null default now(),

  primary key (config_version, setting_key, scope_type, scope_id),
  constraint app_setting_scope_check check (
    scope_type in ('global', 'provider', 'feature', 'route', 'user_tier')
  ),
  -- ADR-012: secrets are deployment-only and are never stored in this catalogue. The API
  -- rejects a sensitive write; this makes the row impossible rather than merely rejected,
  -- so a second write path cannot reintroduce it.
  constraint app_setting_no_secrets_check check (sensitive = false)
);

comment on constraint app_setting_no_secrets_check on app_setting is
  'ADR-012. Source §7.2 says "the API rejects sensitive=true writes". A check constraint is the version of that rule which survives a second write path being added.';

-- ── universe_version + universe_member ──────────────────────────────────────────────────────
create table universe_version (
  id              bigserial   primary key,
  environment     text        not null,
  config_version  bigint      not null references config_version (id),
  status          text        not null,
  parent_version  bigint      null references universe_version (id),
  selected_count  integer     not null default 0,
  selection_query jsonb       null,
  impact_preview  jsonb       not null default '{}'::jsonb,
  created_by      text        not null,
  change_reason   text        not null,
  created_at      timestamptz not null default now(),
  activated_at    timestamptz null,

  constraint universe_version_status_check check (
    status in ('draft', 'staged', 'active', 'superseded')
  ),
  -- D-27: the universe is 100 symbols. `universe.max_symbols` is enforced here as well as in
  -- the activation transaction, because source §7.2 requires "a database constraint AND an
  -- activation transaction" — the transaction bounds intent, the constraint bounds outcome.
  constraint universe_version_max_symbols_check check (selected_count <= 100)
);

create unique index universe_version_single_active
  on universe_version (environment)
  where status = 'active';

comment on column universe_version.selection_query is
  'Records bulk-filter intent for audit. It is NOT live membership — membership is materialized in universe_member at activation so a later catalogue change cannot silently alter a historical universe.';

create table universe_member (
  universe_version bigint      not null references universe_version (id),
  security_id      uuid        not null references security (id),
  enabled          boolean     not null default true,
  added_by         text        not null,
  selection_source text        not null,
  created_at       timestamptz not null default now(),

  primary key (universe_version, security_id),
  constraint universe_member_source_check check (
    selection_source in ('checkbox', 'bulk_filter', 'import', 'preset', 'seed')
  )
);

-- ── model_route ─────────────────────────────────────────────────────────────────────────────
create table model_route (
  config_version      bigint  not null references config_version (id),
  task                text    not null,
  transport           text    not null,
  primary_provider    text    not null,
  primary_model       text    not null,
  model_revision      text    not null,
  fallback_chain      jsonb   not null default '[]'::jsonb,
  prompt_version      text    not null,
  schema_version      text    not null,
  calibration_version text    null,
  temperature         numeric not null default 0,
  max_input_tokens    integer not null,
  max_output_tokens   integer not null,
  timeout_ms          integer not null,
  max_cost_usd        numeric not null,
  allowed_data_classes jsonb  not null default '[]'::jsonb,
  shadow_model        jsonb   null,
  canary_percent      numeric not null default 0,
  evaluation_run_id   uuid    null,
  enabled             boolean not null default true,
  created_at          timestamptz not null default now(),

  primary key (config_version, task)
);

comment on column model_route.model_revision is
  'Immutable. A hosted model whose ID can be retired may not produce anything that enters the corpus (product invariant §6.7). For stance scoring this is moot — D-13 moved it to the pinned scorer service entirely.';
