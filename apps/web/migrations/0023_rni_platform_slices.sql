-- 0023 — RNI runs and independently terminal Reddit/X platform slices.

create table rni_run (
  id                 uuid        primary key default gen_random_uuid(),
  idempotency_key    text        not null unique,
  trigger            text        not null,
  status             text        not null,
  window_start       timestamptz not null,
  window_end         timestamptz not null,
  comparison_start   timestamptz null,
  comparison_end     timestamptz null,
  universe_version   bigint      not null,
  config_version     bigint      not null,
  prompt_version     text        not null,
  ai_route           text        not null default 'openai_direct',
  requested_at       timestamptz not null,
  completed_at       timestamptz null,
  created_at         timestamptz not null default now(),

  constraint rni_run_idempotency_key_check check (length(idempotency_key) > 0),
  constraint rni_run_trigger_check check (trigger in ('schedule', 'manual', 'api')),
  constraint rni_run_status_check
    check (status in ('requested', 'running', 'complete', 'partial', 'failed', 'cancelled')),
  constraint rni_run_window_check check (window_end > window_start),
  constraint rni_run_comparison_pair_check check (
    (comparison_start is null and comparison_end is null)
    or (comparison_start is not null and comparison_end is not null and comparison_end > comparison_start)
  ),
  constraint rni_run_universe_version_fk
    foreign key (universe_version) references universe_version (id),
  constraint rni_run_config_version_fk
    foreign key (config_version) references config_version (id),
  constraint rni_run_prompt_version_check check (length(prompt_version) > 0),
  constraint rni_run_ai_route_check
    check (ai_route in ('openai_direct', 'vercel_ai_gateway'))
);

create table rni_platform_slice (
  id                          uuid        primary key default gen_random_uuid(),
  run_id                      uuid        not null references rni_run (id),
  platform                    text        not null,
  status                      text        not null,
  eligible_source_count       integer     not null default 0,
  coverage_disclosure         text        not null,
  last_attempt_at             timestamptz null,
  last_successful_refresh_at  timestamptz null,
  data_through_at             timestamptz null,
  computed_at                 timestamptz null,
  error_code                  text        null,
  created_at                  timestamptz not null default now(),

  constraint rni_platform_slice_run_platform_unique unique (run_id, platform),
  constraint rni_platform_slice_id_run_platform_unique unique (id, run_id, platform),
  constraint rni_platform_slice_platform_check check (platform in ('reddit', 'x')),
  constraint rni_platform_slice_status_check check (
    status in ('pending', 'running', 'complete', 'partial', 'failed', 'unavailable')
  ),
  constraint rni_platform_slice_source_count_check check (eligible_source_count >= 0),
  constraint rni_platform_slice_coverage_check check (length(coverage_disclosure) > 0)
);

alter table rni_narrative
  add constraint rni_narrative_run_id_fkey foreign key (run_id) references rni_run (id);

create index rni_platform_slice_status_idx on rni_platform_slice (status, run_id);

create or replace function rni_require_two_platform_slices() returns trigger
language plpgsql as $$
declare
  slice_count integer;
  platform_count integer;
begin
  select count(*), count(distinct platform)
    into slice_count, platform_count
    from rni_platform_slice
   where run_id = new.id and platform in ('reddit', 'x');

  if slice_count <> 2 or platform_count <> 2 then
    raise exception 'RNI run % requires exactly one reddit and one x platform slice', new.id
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger rni_run_two_platform_slices
  after insert on rni_run
  deferrable initially deferred
  for each row execute function rni_require_two_platform_slices();

create trigger rni_run_content_immutable
  before update or delete on rni_run
  for each row execute function reject_content_mutation('status', 'completed_at');

create trigger rni_platform_slice_content_immutable
  before update or delete on rni_platform_slice
  for each row execute function reject_content_mutation(
    'status',
    'eligible_source_count',
    'last_attempt_at',
    'last_successful_refresh_at',
    'data_through_at',
    'computed_at',
    'error_code'
  );

comment on table rni_platform_slice is
  'Exactly one Reddit and one X slice per run. Lifecycle, counts and freshness change independently; content identity and coverage disclosure remain immutable.';

create or replace function rni_summary_sections_valid(sections jsonb) returns boolean
language sql immutable strict as $$
  select
    jsonb_typeof(sections) = 'array'
    and jsonb_array_length(sections) = 3
    and (
      select
        count(distinct section ->> 'heading') = 3
        and bool_and(
          jsonb_typeof(section) = 'object'
          and section ->> 'heading' in ('Reddit sentiment', 'X sentiment', 'Combined summary')
          and section ->> 'status' in ('complete', 'partial', 'insufficient')
          and jsonb_typeof(section -> 'text') = 'string'
          and length(section ->> 'text') > 0
          and jsonb_typeof(section -> 'citationIds') = 'array'
        )
      from jsonb_array_elements(sections) as section
    )
$$;

create table rni_combined_summary (
  id                       uuid        primary key default gen_random_uuid(),
  run_id                   uuid        not null references rni_run (id),
  security_id              uuid        not null references security (id),
  reddit_platform          text        not null default 'reddit',
  reddit_platform_slice_id uuid        not null,
  x_platform               text        not null default 'x',
  x_platform_slice_id      uuid        not null,
  status                   text        not null,
  sections                 jsonb       not null,
  created_at               timestamptz not null,

  constraint rni_combined_summary_run_security_unique unique (run_id, security_id),
  constraint rni_combined_summary_reddit_platform_check check (reddit_platform = 'reddit'),
  constraint rni_combined_summary_x_platform_check check (x_platform = 'x'),
  constraint rni_combined_summary_distinct_slices_check
    check (reddit_platform_slice_id <> x_platform_slice_id),
  constraint rni_combined_summary_reddit_slice_fk
    foreign key (reddit_platform_slice_id, run_id, reddit_platform)
    references rni_platform_slice (id, run_id, platform),
  constraint rni_combined_summary_x_slice_fk
    foreign key (x_platform_slice_id, run_id, x_platform)
    references rni_platform_slice (id, run_id, platform),
  constraint rni_combined_summary_status_check
    check (status in ('complete', 'partial', 'insufficient')),
  constraint rni_combined_summary_sections_check check (rni_summary_sections_valid(sections))
);

create trigger rni_combined_summary_append_only
  before update or delete on rni_combined_summary
  for each row execute function reject_mutation();

comment on table rni_combined_summary is
  'Immutable cross-source summary referencing one Reddit and one X slice. Component slice facts are never copied over or mutated.';
