-- 0010 — coverage integrity and the point-in-time floor (F22, D-16, D-17).
--
-- F03 owns the bitemporal tables. F22 owns the model that makes their gaps visible, and this
-- migration is that model. **It cannot be retrofitted**: under D-16 there is no backfill, so a
-- gap not recorded when it happened is a gap nobody can ever reconstruct, and a coverage floor
-- not written on the first collected item is a floor that gets guessed later.

-- ── collector_start ─────────────────────────────────────────────────────────────────────────
-- The coverage floor, written ONCE per axis on first collection and never again.
--
-- §8's last risk row is the reason this is a table and not a config value: "the coverage floor
-- is set from a mutable config value" — a config change would silently move the floor of every
-- historical view, and the views would keep rendering confidently.
create table collector_start (
  axis        text        primary key,
  started_at  timestamptz not null,
  recorded_at timestamptz not null default now(),
  note        text        not null,

  constraint collector_start_axis_check check (
    axis in ('reddit', 'x', 'substack', 'market')
  )
);

comment on table collector_start is
  'One row per axis, written once on first collection. F22 DoD: "the collector start date is recorded once, immutably, and is what the coverage floor reads". The trigger below is what makes "once" true.';

create or replace function reject_collector_start_mutation() returns trigger
language plpgsql as $$
begin
  raise exception
    'collector_start is written once per axis and never changed (F22 §4.4, DoD item 10). % is not permitted. Moving a coverage floor silently re-labels every historical view built on it, and under D-16 there is no way to check the new value against anything.',
    tg_op
    using errcode = 'restrict_violation';
end;
$$;

create trigger collector_start_write_once
  before update or delete on collector_start
  for each row execute function reject_collector_start_mutation();

-- ── coverage_gap ────────────────────────────────────────────────────────────────────────────
-- Every gap is permanent. `permanent: true` is a literal in the type (F22 §3), so there is no
-- column for it here — a nullable boolean would invite a row that claims otherwise.
create table coverage_gap (
  id            uuid        primary key default gen_random_uuid(),
  axis          text        not null,
  gap_from      timestamptz not null,
  gap_to        timestamptz not null,
  reason        text        not null,
  detected_at   timestamptz not null default now(),
  detail        jsonb       not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),

  constraint coverage_gap_axis_check check (axis in ('reddit', 'x', 'substack', 'market')),
  constraint coverage_gap_reason_check check (
    reason in ('collector_down', 'provider_outage', 'quota_exhausted', 'budget_denied', 'unknown')
  ),
  constraint coverage_gap_ordered_check check (gap_to > gap_from),
  constraint coverage_gap_unique unique (axis, gap_from, gap_to)
);

comment on table coverage_gap is
  'D-16: collection is forward-only, so there is no kind of gap other than permanent. F22 §3 makes `permanent: true` a literal in the type rather than a column, because a column invites a row that claims otherwise.';

comment on column coverage_gap.reason is
  'budget_denied is F16 §4.1b''s refused sampling window. A window that would breach an X ceiling is refused and recorded here — never silently truncated, because a shortened window is a sample nobody can describe.';

create index coverage_gap_axis_from_idx on coverage_gap (axis, gap_from desc);

-- Gaps are append-only for the same reason artifacts are: a gap that can be edited is a gap
-- that can be edited away, and the edit would be invisible in every view built on it.
create trigger coverage_gap_append_only
  before update or delete on coverage_gap
  for each row execute function reject_mutation();

-- ── collector_heartbeat ─────────────────────────────────────────────────────────────────────
-- What gap detection reads. The dispatcher's own heartbeat (F16 §4.5) alerts on a stalled
-- dispatcher; this records per-axis liveness, which is a different question: the dispatcher can
-- be perfectly healthy while one provider returns nothing.
create table collector_heartbeat (
  axis         text        not null,
  observed_at  timestamptz not null,
  items_seen   integer     not null default 0,
  job_run_id   uuid        null references job_run (id),
  created_at   timestamptz not null default now(),

  primary key (axis, observed_at),
  constraint collector_heartbeat_axis_check check (
    axis in ('reddit', 'x', 'substack', 'market')
  )
);

comment on column collector_heartbeat.items_seen is
  'Zero is a legitimate heartbeat: the collector ran and the window was genuinely quiet. That is NOT a gap, and conflating the two would manufacture gaps on every quiet weekend.';

create index collector_heartbeat_axis_observed_idx
  on collector_heartbeat (axis, observed_at desc);

-- ── storage growth measurement ──────────────────────────────────────────────────────────────
-- F22 §4.5: a MEASURED MB/month figure per class, re-measured quarterly. This replaces F-07's
-- fixed ceiling, which is the wrong instrument for a corpus designed to grow forever.
create table storage_measurement (
  id            uuid        primary key default gen_random_uuid(),
  measured_at   timestamptz not null default now(),
  retention_class text      not null,
  table_name    text        not null,
  total_bytes   bigint      not null,
  row_count     bigint      not null,
  created_at    timestamptz not null default now(),

  constraint storage_measurement_class_check check (
    retention_class in ('permanent_corpus', 'artifacts', 'raw_payloads', 'operational')
  )
);

create index storage_measurement_at_idx on storage_measurement (measured_at desc);

comment on table storage_measurement is
  'F22 §4.5. Measured, not projected — a projection is what F03 §4.5 produced and it depended entirely on an assumed refresh cadence. The growth RATE is the instrument; a fixed ceiling on a permanent corpus only ever tells you the day you crossed it.';
