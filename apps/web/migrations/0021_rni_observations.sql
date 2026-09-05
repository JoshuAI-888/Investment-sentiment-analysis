-- 0021 — RNI source/security links and independent per-security observations.
--
-- A source has no blended stance. It first resolves one link for each security, then stores one
-- observation per source/security/classifier run with the frozen dimension-assignment payload.

create or replace function rni_dimension_assignments_valid(assignments jsonb) returns boolean
language sql immutable strict as $$
  select
    jsonb_typeof(assignments) = 'array'
    and jsonb_array_length(assignments) between 1 and 4
    and (
      select
        count(*) = jsonb_array_length(assignments)
        and count(distinct assignment ->> 'dimension') = jsonb_array_length(assignments)
        and bool_and(
          jsonb_typeof(assignment) = 'object'
          and assignment ->> 'dimension' in (
            'company_fundamentals', 'market_trading', 'catalyst_event', 'retail_narrative'
          )
          and assignment ->> 'stance' in (
            'strong_bearish', 'bearish', 'neutral', 'bullish', 'strong_bullish', 'insufficient'
          )
          and jsonb_typeof(assignment -> 'rationale') = 'string'
          and length(assignment ->> 'rationale') > 0
          and (
            jsonb_typeof(assignment -> 'score') = 'null'
            or (
              jsonb_typeof(assignment -> 'score') = 'string'
              and assignment ->> 'score' ~ '^-?(?:0(?:\.[0-9]+)?|1(?:\.0+)?)$'
            )
          )
        )
      from jsonb_array_elements(assignments) as assignment
    )
$$;

create table rni_security_mention (
  id                     uuid        primary key default gen_random_uuid(),
  source_item_id         uuid        not null references rni_source_item (id),
  security_id            uuid        not null references security (id),
  mention_text           text        not null,
  start_offset           integer     null,
  end_offset             integer     null,
  resolution_method      text        not null,
  resolution_confidence  numeric(5,4) not null,
  model_run_id           uuid        null,
  created_at             timestamptz not null default now(),

  constraint rni_security_mention_source_security_unique
    unique (source_item_id, security_id),
  constraint rni_security_mention_text_check check (length(mention_text) > 0),
  constraint rni_security_mention_offsets_check check (
    (start_offset is null or start_offset >= 0)
    and (end_offset is null or end_offset > 0)
    and (start_offset is null or end_offset is null or end_offset > start_offset)
  ),
  constraint rni_security_mention_resolution_method_check check (
    resolution_method in ('exact_ticker', 'company_alias', 'model_assisted', 'human_review')
  ),
  constraint rni_security_mention_resolution_confidence_check
    check (resolution_confidence between 0 and 1)
);

create index rni_security_mention_security_source_idx
  on rni_security_mention (security_id, source_item_id);

create table rni_security_observation (
  id                     uuid         primary key default gen_random_uuid(),
  source_item_id         uuid         not null,
  security_id            uuid         not null,
  stance                 text         not null,
  stance_score           numeric(5,4) null,
  relevance              numeric(5,4) not null,
  claim_summary          text         not null,
  time_horizon           text         null,
  dimension_assignments  jsonb        not null,
  classifier_run_id      uuid         not null,
  prompt_version         text         not null,
  model_id               text         not null,
  input_hash             text         not null,
  created_at             timestamptz  not null,

  constraint rni_security_observation_mention_fk
    foreign key (source_item_id, security_id)
    references rni_security_mention (source_item_id, security_id),
  constraint rni_security_observation_identity_unique
    unique (source_item_id, security_id, classifier_run_id),
  constraint rni_security_observation_stance_check check (
    stance in (
      'strong_bearish', 'bearish', 'neutral', 'bullish', 'strong_bullish', 'insufficient'
    )
  ),
  constraint rni_security_observation_stance_score_check
    check (stance_score is null or stance_score between -1 and 1),
  constraint rni_security_observation_relevance_check check (relevance between 0 and 1),
  constraint rni_security_observation_claim_summary_check
    check (length(claim_summary) between 1 and 2000),
  constraint rni_security_observation_time_horizon_check
    check (time_horizon is null or length(time_horizon) <= 100),
  constraint rni_security_observation_dimensions_check
    check (rni_dimension_assignments_valid(dimension_assignments)),
  constraint rni_security_observation_prompt_version_check check (length(prompt_version) > 0),
  constraint rni_security_observation_model_id_check check (length(model_id) > 0),
  constraint rni_security_observation_input_hash_check
    check (input_hash ~ '^[a-f0-9]{64}$')
);

create index rni_security_observation_security_created_idx
  on rni_security_observation (security_id, created_at desc, id desc);

create trigger rni_security_mention_append_only
  before update or delete on rni_security_mention
  for each row execute function reject_mutation();

create trigger rni_security_observation_append_only
  before update or delete on rni_security_observation
  for each row execute function reject_mutation();

comment on table rni_security_mention is
  'One resolved source/security edge. A multi-ticker source owns one row per security and never inherits a source-level stance.';

comment on table rni_security_observation is
  'Independent source/security classification with frozen dimension assignments and model-input provenance identifiers.';
