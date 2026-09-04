-- 0014 — seed job_definition rows for F16a's Wave 1 dispatch core (F16 §0/§4.1/§4.1b).
--
-- market_data_poll and attention_poll are the two real, already-built collectors this feature
-- wires as dispatchable jobs (services/market/collector.ts, services/attention/collector.ts).
-- x_sampling_window is D-15's trigger-eligible target: seeded so the trigger path has a real,
-- structural row to look up (`trigger_eligible = true`), but `enabled = false` — F16a builds the
-- dispatch mechanism (eligibility check, budget refusal, idempotency), not a real X-fetching
-- collector, and D-32's X read ceiling starts at zero regardless. Reddit is not seeded: D-39
-- (docs/MEMORY.md) records that the legacy product discarded Reddit-Data-API sourcing entirely —
-- RNI replaces it — so there is no reddit_poll job for this feature to seed. Substack is not
-- seeded either, for a different, honestly-reported reason: no Substack collector *service*
-- exists yet to call (F04's adapter is merged; nothing persists a poll of it the way the other
-- two collectors do) — see this feature's report.
--
-- ## The bootstrap gap this migration cannot paper over
--
-- `job_definition.config_version` is a NOT NULL foreign key to `config_version(id)` (migration
-- 0007). This codebase has **no bootstrap path that ever creates a production `config_version`
-- row** — `repositories/versions.ts#insertConfigVersion`/`activateConfigVersion` are called only
-- from tests and from test-only helpers (`services/*/testing.ts`); `repositories/universe-seed.ts
-- #seedUniverse` requires one to already exist and throws `"No active config_version in
-- {environment}"` rather than create one. Migrations in this codebase are schema-only by
-- established convention (0006_config_and_universe.sql, every other migration here) — seed *data*
-- is a deliberate script run against a live database (scripts/seed-universe.ts), never baked into
-- a migration that runs unconditionally, once, against every environment including every fresh
-- CI/test database `tests/integration/helpers/db.ts#resetSchema` creates from scratch.
--
-- A hardcoded `job_definition` INSERT naming a `config_version` id would therefore either violate
-- the NOT NULL constraint on first run (no config_version exists yet anywhere) or, worse, invent
-- a fabricated bootstrap config_version this session has no standing to author (config
-- versioning is F03/SPINE's territory). Instead, this migration seeds conditionally: each INSERT
-- is an INSERT ... SELECT sourced from whichever config_version is currently active for
-- 'production', so a database with none yet gets **zero rows inserted, no error** — safe for
-- every existing test's `resetSchema()` — and a real production database, once a config_version
-- is eventually bootstrapped, would get real rows *if this migration had not already run*.
--
-- **That parenthetical is the honest, load-bearing limitation, reported rather than hidden**
-- (per this feature's brief): because `scripts/migrate.ts` applies every migration exactly once,
-- ledgered by filename, this migration seeds nothing at all against today's actual production
-- database (no config_version has ever been activated there — confirmed by the absence of any
-- bootstrap call site above). Once SPINE supplies a config_version bootstrap path, whoever wires
-- it up will need a **follow-up migration** (or a one-time manual INSERT) to actually seed these
-- three rows in production — this file alone will not do it retroactively. Flagged to the
-- coordinator to raise with SPINE.

insert into job_definition
  (job_key, display_name, enabled, schedule_type, schedule_expression, display_timezone,
   priority, max_runtime_seconds, concurrency_policy, max_attempts, trigger_eligible,
   max_calls_per_run, next_due_at, config_version, updated_by)
select
  'market_data_poll', 'Market data poll (daily bars, D-31)', true, 'interval', '300', 'UTC',
  10, 120, 'skip', 3, false,
  null, now(), cv.id, 'migration:0014'
from config_version cv
where cv.environment = 'production' and cv.status = 'active'
on conflict (job_key) do nothing;

insert into job_definition
  (job_key, display_name, enabled, schedule_type, schedule_expression, display_timezone,
   priority, max_runtime_seconds, concurrency_policy, max_attempts, trigger_eligible,
   max_calls_per_run, next_due_at, config_version, updated_by)
select
  'attention_poll', 'Attention poll (ApeWisdom board, D-30)', true, 'interval', '300', 'UTC',
  20, 120, 'skip', 3, false,
  null, now(), cv.id, 'migration:0014'
from config_version cv
where cv.environment = 'production' and cv.status = 'active'
on conflict (job_key) do nothing;

-- D-15/§4.1b: trigger-eligible so `findTriggerEligibleJobDefinition` can find it structurally,
-- `enabled = false` so it can never be clock-dispatched or, per D-32's own zero-ceiling policy,
-- meaningfully triggered either. `max_calls_per_run = 100` is D-20/D-32's own named
-- `X_READS_PER_TRIGGER_EVENT` figure, recorded here as the bound this row would carry once
-- enabled — not yet enforced by anything (F18 is unbuilt), and not itself a claim that X spend is
-- authorized.
insert into job_definition
  (job_key, display_name, enabled, schedule_type, schedule_expression, display_timezone,
   priority, max_runtime_seconds, concurrency_policy, max_attempts, trigger_eligible,
   max_calls_per_run, next_due_at, config_version, updated_by)
select
  'x_sampling_window', 'X sampling window (trigger-dispatched, D-15 — not yet wired, D-32)',
  false, 'interval', '3600', 'UTC',
  5, 60, 'skip', 1, true,
  100, now(), cv.id, 'migration:0014'
from config_version cv
where cv.environment = 'production' and cv.status = 'active'
on conflict (job_key) do nothing;
