-- 0012 — the one way past append-only, and it is narrow (F22 §4.3 vs F03 §4.1).
--
-- ── The conflict ────────────────────────────────────────────────────────────────────────────
--
-- F03 §4.1 makes `calculation_snapshot` append-only: no UPDATE, no DELETE.
-- F22 §4.3 gives artifacts a 90-day retention — which means deleting them.
--
-- Both are in the specification and the trigger blocked the retention job outright. Source §7.2
-- resolves it in a clause that is easy to read past: snapshot rows and their inputs and steps
-- are append-only **"outside a separately audited legal-retention process"**.
--
-- ── Why the two operations are not the same thing ───────────────────────────────────────────
--
-- Append-only protects against *mutation*: an artifact recomputed in place silently changes a
-- number somebody has already read, and product invariant §6.2 exists to make that impossible.
-- Retention removes a *whole expired artifact*. It rewrites nothing.
--
-- So UPDATE stays forbidden absolutely — there is no flag for it and no reason to want one.
-- DELETE becomes possible only inside a transaction that has explicitly declared itself the
-- retention process, which is a thing no ordinary code path does by accident.

create or replace function reject_mutation_except_retention() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception
      'Table % is append-only (F03 §4.1). UPDATE is not permitted, ever — there is no retention exception for it. Write a successor row; artifacts are never recomputed in place (product invariant §6.2).',
      tg_table_name
      using errcode = 'restrict_violation';
  end if;

  -- `true` as the second argument means "return null if unset" rather than raising.
  if coalesce(current_setting('app.retention_process', true), 'off') <> 'on' then
    raise exception
      'Table % is append-only (F03 §4.1). DELETE is permitted only inside the audited retention process (F22 §4.3, source §7.2). If this is that process, it must set app.retention_process and write its audit_event in the same transaction.',
      tg_table_name
      using errcode = 'restrict_violation';
  end if;

  return old;
end;
$$;

comment on function reject_mutation_except_retention() is
  'The only door through append-only, and it opens for DELETE alone. UPDATE has no exception because no legitimate process needs one: retention removes whole expired artifacts, it does not rewrite numbers.';

drop trigger calculation_snapshot_append_only on calculation_snapshot;
drop trigger calculation_input_append_only on calculation_input;
drop trigger calculation_step_append_only on calculation_step;

create trigger calculation_snapshot_append_only
  before update or delete on calculation_snapshot
  for each row execute function reject_mutation_except_retention();
create trigger calculation_input_append_only
  before update or delete on calculation_input
  for each row execute function reject_mutation_except_retention();
create trigger calculation_step_append_only
  before update or delete on calculation_step
  for each row execute function reject_mutation_except_retention();

-- Everything else in F03 §4.1's list keeps `reject_mutation()` unchanged: `audit_event`,
-- `claim_ledger`, `cost_event`, `research_event` and `calculation_validation_run` have no
-- finite retention and therefore no reason to be deletable at all.
