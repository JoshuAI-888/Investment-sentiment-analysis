-- 0016 — seed a job_definition row for the Substack collector (MT-08/MT-15, D-29).
--
-- `services/collect/substack-collector.ts#collectSubstackItems` is the real, already-built
-- collector this migration wires as a dispatchable job — mirroring migration 0014's exact
-- `market_data_poll`/`attention_poll` pattern, for the third and last Wave-1 collector this lane
-- delivers. See `docs/progress/collect.md` for why Reddit has no equivalent row (D-39: discarded,
-- not this migration's concern) and this feature's own report for the one real gap this migration
-- cannot close on its own: `job-service.ts#DISPATCH_TABLE` still needs one line added to actually
-- reach `runSubstackPoll` (`services/jobs/collectors.ts`'s own doc comment) — that file is outside
-- this lane's do-not-edit list, so seeding the row here does not by itself make the job
-- dispatchable end to end.
--
-- **Schedule: `interval`, 86400 seconds (daily).** `docs/features/F04-provider-platform.md`'s own
-- cost-shape table names this cadence directly for Substack RSS ("Free, slow (publication
-- cadence)... Poll daily-ish"), unlike `market_data_poll`/`attention_poll`'s five-minute interval
-- (`migration 0014`) — a five-minute poll of 13 RSS feeds whose publications post at most a few
-- times a week would be nearly all redundant, guid-deduped no-op calls (`collector.ts`'s own doc:
-- dedup is on `(publicationSlug, guid)`, so a re-poll of an unchanged feed writes nothing new but
-- still spends the call).
--
-- ## The same `config_version` bootstrap gap migration 0014 already named
--
-- `job_definition.config_version` is a NOT NULL foreign key, and this codebase still has no
-- production bootstrap path for it (confirmed unchanged since 0014's own note: `insertConfigVersion`/
-- `activateConfigVersion` are called only from tests). This migration follows 0014's own
-- conditional-seed pattern exactly — an INSERT ... SELECT sourced from whichever `config_version`
-- is currently active for 'production' — so a database with none yet (every fresh/CI database,
-- and today's actual production database, per 0014's own note) gets zero rows inserted, no error.
-- The same follow-up 0014 already flagged (SPINE bootstraps a production `config_version`, then a
-- follow-up migration or manual insert actually seeds these rows) applies here too, not separately.

insert into job_definition
  (job_key, display_name, enabled, schedule_type, schedule_expression, display_timezone,
   priority, max_runtime_seconds, concurrency_policy, max_attempts, trigger_eligible,
   max_calls_per_run, next_due_at, config_version, updated_by)
select
  'substack_poll', 'Substack collector (13-publication set, MT-15/D-29)', true, 'interval', '86400', 'UTC',
  30, 300, 'skip', 3, false,
  null, now(), cv.id, 'migration:0016'
from config_version cv
where cv.environment = 'production' and cv.status = 'active'
on conflict (job_key) do nothing;
