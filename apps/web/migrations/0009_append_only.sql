-- 0009 — append-only enforcement, F03 §4.1, at the DATABASE level.
--
-- "Enforced at the database level (revoke UPDATE/DELETE, or a trigger)". Triggers are used
-- rather than REVOKE because the application connects as the owner on a managed Postgres, and
-- an owner's privileges cannot be revoked from itself in a way that survives. A trigger binds
-- regardless of who connects, which is the property being bought.
--
-- ── The tension in the spec, and how it is resolved ────────────────────────────────────────
--
-- §4.1 lists `config_version` and `universe_version` as append-only. §4.3 requires activation
-- to "deactivate the current, insert/activate the successor" — which is an UPDATE of the
-- current row. Both cannot be literally true.
--
-- Resolved by distinguishing content from lifecycle. The *content* of a version — what it
-- configures, who created it, why, its checksum — is immutable. Its `status` and activation
-- timestamps are lifecycle and must transition, or §4.3's transaction cannot exist and the
-- partial unique index has nothing to protect. So those two tables reject DELETE always and
-- reject UPDATE of every column except the named lifecycle ones.
--
-- The other eight are strictly append-only: no UPDATE, no DELETE, no exceptions.

create or replace function reject_mutation() returns trigger
language plpgsql as $$
begin
  raise exception
    'Table % is append-only (F03 §4.1). % is not permitted. Write a successor row; artifacts are never recomputed in place (product invariant §6.2).',
    tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

comment on function reject_mutation() is
  'F03 §4.1. The error names the table, the operation and the rule, because the person who hits this is usually about to argue that their case is special.';

do $$
declare
  t text;
begin
  foreach t in array array[
    'calculation_snapshot',
    'calculation_input',
    'calculation_step',
    'calculation_validation_run',
    'claim_ledger',
    'audit_event',
    'cost_event',
    'research_event'
  ]
  loop
    execute format(
      'create trigger %I_append_only before update or delete on %I
         for each row execute function reject_mutation()',
      t, t
    );
  end loop;
end;
$$;

-- ── Lifecycle-only mutation for the two versioned tables ────────────────────────────────────

-- The lifecycle columns are passed per table rather than hardcoded, because they differ and
-- the difference is not arbitrary. `universe_version.selected_count` is materialised AT
-- activation — membership is written in the same transaction, so the count is not knowable
-- when the draft is inserted. It is an outcome of activating, exactly like `activated_at`,
-- not part of what the version configures.
create or replace function reject_content_mutation() returns trigger
language plpgsql as $$
declare
  lifecycle text[] := tg_argv;
  old_content jsonb := to_jsonb(old);
  new_content jsonb := to_jsonb(new);
  col text;
begin
  if tg_op = 'DELETE' then
    raise exception
      'Table % is append-only (F03 §4.1). A version is superseded, never deleted — deleting one orphans every artifact that recorded it.',
      tg_table_name
      using errcode = 'restrict_violation';
  end if;

  foreach col in array lifecycle loop
    old_content := old_content - col;
    new_content := new_content - col;
  end loop;

  if old_content is distinct from new_content then
    raise exception
      'Table % is append-only except for its lifecycle columns (F03 §4.1 and §4.3). Only % may change; the version''s content is what artifacts recorded and must stay reproducible. Create a successor version instead.',
      tg_table_name, array_to_string(lifecycle, ', ')
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger config_version_append_only
  before update or delete on config_version
  for each row execute function reject_content_mutation('status', 'activated_at', 'approved_by');

create trigger universe_version_append_only
  before update or delete on universe_version
  for each row execute function reject_content_mutation('status', 'activated_at', 'selected_count');

-- ── Reconciliation writes a successor, it does not update ───────────────────────────────────
-- `cost_event.cost_status` moves estimated → actual → reconciled. Under strict append-only that
-- transition cannot be an UPDATE, so it is a new row pointing at the one it replaces. This is
-- the same rule F20 §4.4 applies to re-scoring and §6.2 applies to artifacts, and it is better
-- than an update besides: what we believed a call cost at the time stays readable.
alter table cost_event
  add column supersedes_cost_event_id uuid null references cost_event (id);

comment on column cost_event.supersedes_cost_event_id is
  'Reconciliation writes a successor. The estimate that was wrong stays on the record, which is what makes an over- or under-estimating price book detectable rather than merely fixable.';

create index cost_event_supersedes_idx on cost_event (supersedes_cost_event_id)
  where supersedes_cost_event_id is not null;
