-- 0008 — cost accounting, budgets, audit and the method registry.

create table unit_price_book (
  price_book_version  text        not null,
  provider            text        not null,
  service             text        not null,
  operation_or_model  text        not null,
  unit_type           text        not null,
  unit_price          numeric     not null,
  currency            text        not null default 'USD',
  effective_from      timestamptz not null,
  effective_until     timestamptz null,
  source_reference    text        not null,
  created_at          timestamptz not null default now(),

  primary key (price_book_version, provider, service, operation_or_model, unit_type)
);

create table cost_event (
  id                  uuid        primary key default gen_random_uuid(),
  occurred_at         timestamptz not null,
  provider            text        not null,
  service             text        not null,
  operation_or_model  text        not null,
  feature             text        not null,
  job_run_id          uuid        null references job_run (id),
  research_run_id     uuid        null references research_run (id),
  user_id             text        null,
  request_id          text        not null,
  unit_type           text        not null,
  request_units       numeric     not null,
  billable_units      numeric     not null,
  unit_price          numeric     null,
  currency            text        not null default 'USD',
  price_book_version  text        null,
  -- Source §7.2 names this `cost_amount`; F03 §4.2 names it `cost_usd`. Both refer to the same
  -- column and the amendment wins, since it is the one that states the nullability rule.
  cost_usd            numeric     null,
  cost_status         text        not null,
  cache_status        text        not null,
  metadata            jsonb       not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),

  constraint cost_event_unit_type_check check (
    unit_type in ('call', 'search', 'input_token', 'output_token', 'compute_second', 'post_read')
  ),
  constraint cost_event_status_check check (
    cost_status in ('estimated', 'actual', 'reconciled', 'unpriced')
  ),
  -- F03 §4.2: null means unpriced, and there is NO zero default. A zero would sum into the
  -- monthly total as though the call were free, and D-32's global ceiling is the only budget
  -- control left after D-11 — so an unpriced call silently under-reporting is the one error
  -- this table must not make.
  constraint cost_event_unpriced_is_null_check check (
    (cost_status = 'unpriced') = (cost_usd is null)
  )
);

comment on column cost_event.cost_usd is
  'Nullable, no zero default (F03 §4.2). NULL means unpriced — we made the call and do not know what it cost. Zero means it was free. Collapsing those two is how a month reads as comfortable on the day the ceiling is actually exhausted.';

create index cost_event_occurred_idx on cost_event (occurred_at desc);

create table budget_policy (
  id             uuid    primary key default gen_random_uuid(),
  environment    text    not null,
  scope_type     text    not null,
  scope_id       text    not null,
  period         text    not null,
  soft_limit     numeric not null,
  hard_limit     numeric not null,
  currency       text    not null default 'USD',
  actions        jsonb   not null default '{}'::jsonb,
  enabled        boolean not null default true,
  config_version bigint  not null references config_version (id),
  created_at     timestamptz not null default now(),

  constraint budget_scope_check check (
    scope_type in ('global', 'provider', 'feature', 'model_route')
  ),
  constraint budget_period_check check (period in ('daily', 'monthly')),
  constraint budget_limits_ordered_check check (soft_limit <= hard_limit)
);

comment on table budget_policy is
  'D-11 cut per-account budgets, which makes the `global` scope the only budget control the product has (DEPLOY.md MT-12) — more load-bearing than it was, not less. D-32 starts X ceilings at zero.';

create table audit_event (
  id             uuid        primary key default gen_random_uuid(),
  occurred_at    timestamptz not null default now(),
  actor_id       text        not null,
  actor_role     text        not null,
  action         text        not null,
  object_type    text        not null,
  object_id      text        not null,
  environment    text        not null,
  reason         text        not null,
  before_value   jsonb       null,
  after_value    jsonb       null,
  result         text        not null,
  request_id     text        not null,
  correlation_id text        not null,
  ip_hash        text        null,
  user_agent     text        null,
  approval       jsonb       null,
  rollback_of    uuid        null references audit_event (id),
  created_at     timestamptz not null default now(),

  constraint audit_result_check check (result in ('success', 'failure', 'rejected'))
);

create index audit_event_object_idx on audit_event (object_type, object_id, occurred_at desc);

create table method_registry (
  method_key                     text        not null,
  method_version                 text        not null,
  display_name                   text        not null,
  family                         text        not null,
  plain_language                 text        not null,
  formula_latex                  text        null,
  input_contract                 jsonb       not null,
  parameter_schema               jsonb       not null,
  assumptions                    jsonb       not null default '{}'::jsonb,
  output_contract                jsonb       not null,
  working_precision              integer     not null,
  rounding_rule                  text        not null,
  user_editable_assumption_keys  jsonb       not null default '[]'::jsonb,
  example_fixture_key            text        not null,
  change_summary                 text        not null,
  failure_behavior               text        not null,
  source_code_ref                text        not null,
  -- D-09: a metric may only make a claim about returns once it carries a Tier D4 record.
  -- `check:copy` reads this column; a claim without the record is a build failure.
  tier_d4_record                 text        null,
  active_from                    timestamptz not null default now(),
  retired_at                     timestamptz null,
  created_at                     timestamptz not null default now(),

  primary key (method_key, method_version)
);

comment on column method_registry.tier_d4_record is
  'D-09. NULL means the metric has not passed Tier D4 and carries the §6.4 disclosure verbatim. Non-null links the versioned backtest record and licenses the metric to state its tested relationship — with its IC, Newey-West t-statistic and sample period. It never licenses advice.';
