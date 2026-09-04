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
  universe_version   text        not null,
  config_version     text        not null,
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
  constraint rni_run_universe_version_check check (length(universe_version) > 0),
  constraint rni_run_config_version_check check (length(config_version) > 0),
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
