-- 0004 — the Calculation Inspector's tables (ADR-019, F05 owns the builder).

-- ── calculation_snapshot ────────────────────────────────────────────────────────────────────
-- The immutable, replayable header for every deterministic value. `exact_result`, numeric
-- assumptions and trace values store **decimal strings inside JSON**, never binary floats.
create table calculation_snapshot (
  id                             uuid        primary key default gen_random_uuid(),
  metric_key                     text        not null,
  subject_type                   text        not null,
  subject_id                     text        not null,
  observation_key                text        null,
  scenario_type                  text        not null,
  official_calculation_id        uuid        null references calculation_snapshot (id),
  owner_user_id                  text        null,
  method_key                     text        not null,
  method_version                 text        not null,
  config_version                 bigint      not null,
  universe_version               bigint      null,
  assumption_profile_version     bigint      null,
  input_cutoff                   timestamptz not null,
  status                         text        not null,
  exact_result                   jsonb       not null,
  display_result                 jsonb       not null,
  -- F-07: a 180-point series is ONE artifact whose points live here, not 180 artifacts.
  points                         jsonb       null,
  assumptions                    jsonb       not null default '{}'::jsonb,
  warnings                       jsonb       not null default '[]'::jsonb,
  input_hash                     text        not null,
  result_hash                    text        not null,
  predecessor_calculation_id     uuid        null references calculation_snapshot (id),
  -- F-07: `permanent` for anything a claim ledger entry, a share grant or an open issue
  -- references. `standard` carries the 90-day retention of normalized data.
  retention_class                text        not null default 'standard',
  computed_at                    timestamptz not null default now(),
  expires_at                     timestamptz null,
  created_at                     timestamptz not null default now(),

  constraint calculation_scenario_type_check check (
    scenario_type in ('official', 'personal', 'shared')
  ),
  constraint calculation_status_check check (
    status in ('complete', 'insufficient_data', 'stale', 'ineligible', 'failed')
  ),
  constraint calculation_retention_class_check check (
    retention_class in ('standard', 'permanent')
  ),
  -- Source §7.2: `owner_user_id IS NULL` for official snapshots; a personal snapshot requires
  -- an owner. Enforced here rather than in a service, because a personal artifact with no
  -- owner is unreachable and an official one with an owner leaks identity into a share.
  constraint calculation_owner_matches_scenario_check check (
    (scenario_type = 'official' and owner_user_id is null)
    or (scenario_type = 'personal' and owner_user_id is not null)
    or (scenario_type = 'shared')
  )
);

-- The uniqueness key from source §7.2. `owner_user_id` and `observation_key` are nullable and
-- Postgres treats NULLs as distinct in a unique index, so `nulls not distinct` is required —
-- without it two official snapshots with identical identity both insert.
create unique index calculation_snapshot_identity_unique
  on calculation_snapshot (
    metric_key, subject_type, subject_id, observation_key, scenario_type,
    owner_user_id, method_version, config_version, input_hash
  )
  nulls not distinct;

comment on column calculation_snapshot.points is
  'F-07 / R-05. The unit of an artifact is a computation invocation, not a rendered pixel. A chart point is addressed as {calculation_id, point_index} and resolved from here — which satisfies "every chart point is inspectable" without 18,000 rows per series.';

comment on column calculation_snapshot.exact_result is
  'Decimal strings inside JSON. A JSON number is an IEEE 754 double the moment it is parsed, and the result hash would then depend on the parser.';

-- ── calculation_input ───────────────────────────────────────────────────────────────────────
create table calculation_input (
  calculation_id          uuid        not null references calculation_snapshot (id),
  input_key               text        not null,
  sequence                integer     not null,
  normalized_value        jsonb       not null,
  provider_original_value jsonb       null,
  data_type               text        not null,
  unit                    text        null,
  currency                text        null,
  scale                   text        null,
  provider                text        null,
  provider_record_id      text        null,
  raw_payload_id          uuid        null,
  source_url              text        null,
  primary_source_ref      jsonb       null,
  observed_at             timestamptz null,
  available_at            timestamptz null,
  ingested_at             timestamptz null,
  fiscal_period           jsonb       null,
  normalization_rule      text        null,
  transformation          jsonb       not null default '{}'::jsonb,
  quality_status          text        not null,
  freshness_status        text        not null,
  license_class           text        not null,
  redaction_class         text        not null,
  value_hash              text        not null,
  created_at              timestamptz not null default now(),

  primary key (calculation_id, input_key)
);

comment on column calculation_input.provider_original_value is
  'Retained only where the agreement permits, and rights-projected at read time. A raw_payload_id is a reference, not authorization to display the record. See docs/provider-rights.md.';

-- ── calculation_step ────────────────────────────────────────────────────────────────────────
create table calculation_step (
  calculation_id       uuid    not null references calculation_snapshot (id),
  sequence             integer not null,
  step_key             text    not null,
  parent_step_key      text    null,
  label                text    not null,
  formula_symbolic     text    not null,
  formula_substituted  text    not null,
  operands             jsonb   not null default '[]'::jsonb,
  exact_output         jsonb   not null,
  display_output       jsonb   not null,
  unit                 text    null,
  rounding_rule        text    null,
  status               text    not null,
  notes                jsonb   not null default '[]'::jsonb,
  step_hash            text    not null,
  created_at           timestamptz not null default now(),

  primary key (calculation_id, sequence),
  constraint calculation_step_key_unique unique (calculation_id, step_key),
  constraint calculation_step_status_check check (
    status in ('applied', 'excluded', 'clamped', 'missing', 'warning')
  )
);

-- ── user_assumption_profile ─────────────────────────────────────────────────────────────────
create table user_assumption_profile (
  id                   uuid        primary key default gen_random_uuid(),
  user_id              text        not null,
  method_key           text        not null,
  scope_type           text        not null,
  subject_id           text        null,
  overrides            jsonb       not null default '{}'::jsonb,
  base_method_version  text        not null,
  base_config_version  bigint      not null,
  version              bigint      not null,
  status               text        not null,
  updated_by           text        not null,
  updated_by_role      text        not null,
  change_reason        text        not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  reset_at             timestamptz null,

  constraint user_assumption_scope_check check (
    scope_type in ('account_default', 'subject_override')
  ),
  constraint user_assumption_status_check check (status in ('active', 'reset', 'superseded')),
  constraint user_assumption_role_check check (updated_by_role in ('user', 'admin'))
);

create unique index user_assumption_profile_version_unique
  on user_assumption_profile (user_id, method_key, scope_type, subject_id, version)
  nulls not distinct;

-- Only one active row per user/method/scope/subject. Resolution precedence is
-- subject_override > account_default > official default.
create unique index user_assumption_profile_single_active
  on user_assumption_profile (user_id, method_key, scope_type, subject_id)
  nulls not distinct
  where status = 'active';

-- ── calculation_share ───────────────────────────────────────────────────────────────────────
create table calculation_share (
  id                    uuid        primary key default gen_random_uuid(),
  source_calculation_id uuid        not null references calculation_snapshot (id),
  shared_snapshot_id    uuid        not null references calculation_snapshot (id),
  created_by            text        not null,
  visibility            text        not null default 'authenticated_entitled',
  created_at            timestamptz not null default now(),
  revoked_at            timestamptz null,
  revoked_by            text        null,

  constraint calculation_share_visibility_check check (visibility in ('authenticated_entitled'))
);

-- ── calculation_issue ───────────────────────────────────────────────────────────────────────
create table calculation_issue (
  id                        uuid        primary key default gen_random_uuid(),
  calculation_id            uuid        not null references calculation_snapshot (id),
  input_key                 text        null,
  step_key                  text        null,
  reporter_user_id          text        not null,
  issue_type                text        not null,
  description               text        not null,
  status                    text        not null default 'new',
  assigned_to               text        null,
  admin_notes               text        null,
  resolution_summary        text        null,
  resolution_calculation_id uuid        null references calculation_snapshot (id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  resolved_at               timestamptz null,

  constraint calculation_issue_type_check check (
    issue_type in ('source', 'provider_original', 'normalization', 'units', 'formula',
                   'assumption', 'stale', 'rounding', 'other')
  ),
  constraint calculation_issue_status_check check (
    status in ('new', 'triaged', 'investigating', 'resolved', 'rejected')
  )
);

-- ── calculation_validation_run ──────────────────────────────────────────────────────────────
create table calculation_validation_run (
  id                    uuid        primary key default gen_random_uuid(),
  calculation_id        uuid        not null references calculation_snapshot (id),
  requested_by          text        not null,
  trigger_type          text        not null,
  method_version        text        not null,
  input_hash_expected   text        not null,
  input_hash_actual     text        not null,
  result_hash_expected  text        not null,
  result_hash_actual    text        not null,
  status                text        not null,
  differences           jsonb       not null default '{}'::jsonb,
  started_at            timestamptz not null default now(),
  completed_at          timestamptz null,
  created_at            timestamptz not null default now(),

  constraint validation_trigger_check check (
    trigger_type in ('user_replay', 'scheduled_sample', 'release_test', 'issue_review')
  ),
  constraint validation_status_check check (
    status in ('pass', 'mismatch', 'method_unavailable', 'error')
  )
);
