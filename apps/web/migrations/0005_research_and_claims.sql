-- 0005 — the research run, its event stream, and the claim ledger.
-- Wave 3 (F11) writes these. F03 owns the schema baseline.

create table research_run (
  id             uuid        primary key default gen_random_uuid(),
  user_id        text        not null,
  security_id    uuid        null references security (id),
  question       text        not null,
  status         text        not null,
  coverage_status text       not null,
  input_cutoff   timestamptz not null,
  started_at     timestamptz not null default now(),
  completed_at   timestamptz null,
  prompt_version text        not null,
  model_route    jsonb       not null default '{}'::jsonb,
  tool_manifest  jsonb       not null default '{}'::jsonb,
  cost_usd       numeric     not null default 0,
  result         jsonb       null,
  error          jsonb       null,
  -- F-20 / R-18: retraction deletes nothing and is visible everywhere the run is.
  retracted_reason text      null,
  retracted_by     text      null,
  retracted_at     timestamptz null,
  created_at     timestamptz not null default now(),

  -- F-10 adds `degraded` and `verification_failed`; F-20 adds `retracted`.
  constraint research_run_status_check check (
    status in ('queued', 'running', 'complete', 'degraded', 'verification_failed',
               'retracted', 'failed', 'cancelled')
  ),
  -- A retracted run must say why and by whom. A retraction with no reason is indistinguishable
  -- from a bug, and the state exists precisely so a reader can tell those apart.
  constraint research_run_retraction_complete_check check (
    (status <> 'retracted')
    or (retracted_reason is not null and retracted_by is not null and retracted_at is not null)
  )
);

comment on column research_run.status is
  'F-10 / R-08: `verification_failed` withholds prose while deterministic metrics still render. F-20 / R-18: `retracted` is a state, not a delete — the run stays visible with its reason and actor.';

create table research_event (
  run_id     uuid        not null references research_run (id),
  sequence   integer     not null,
  event_type text        not null,
  label      text        not null,
  payload    jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  primary key (run_id, sequence)
);

create table claim_ledger (
  id                  uuid    primary key default gen_random_uuid(),
  run_id              uuid    not null references research_run (id),
  claim_text          text    not null,
  claim_type          text    not null,
  materiality         text    not null,
  evidence_ids        uuid[]  not null default '{}',
  metric_ids          text[]  not null default '{}',
  verification_status text    not null,
  verifier_notes      text    null,
  created_at          timestamptz not null default now(),

  constraint claim_type_check check (
    claim_type in ('fact', 'calculation', 'interpretation', 'hypothesis')
  ),
  constraint claim_materiality_check check (materiality in ('material', 'supporting')),
  constraint claim_verification_status_check check (
    verification_status in ('verified', 'unverified', 'contradicted', 'unsupported', 'withheld')
  ),
  -- Product invariant §6.3: every material factual claim resolves to an evidence_item or a
  -- calculation_id. A material fact with neither is the exact failure this ledger exists to
  -- make impossible, so it is a constraint rather than a review item.
  constraint claim_material_fact_has_support_check check (
    materiality <> 'material'
    or claim_type not in ('fact', 'calculation')
    or cardinality(evidence_ids) > 0
    or cardinality(metric_ids) > 0
  )
);
