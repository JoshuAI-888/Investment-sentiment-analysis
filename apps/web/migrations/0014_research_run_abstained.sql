-- 0014 — adds the `abstained` research_run status (F11 §4.1; `02-ARCHITECTURE-CONTRACTS.md` §4.5).
--
-- `research_run_status_check` (0005) predates the Wave-3 re-lock's state machine and has no way
-- to represent "the run finished honestly with nothing to say" — insufficient evidence is not an
-- error (`failed`) and produces no prose (not `complete`). Without this state a genuine
-- abstention would have to be recorded as one of those two, either mislabelling a normal outcome
-- as a failure or hiding it inside `complete` where a reader would expect prose that was never
-- produced.
--
-- The `gathering` / `analyzing` / `synthesizing` / `verifying` sub-stages the same state machine
-- names are deliberately **not** added here. `research_run.status` is queried for coarse
-- outcome — is this run done, and how — while per-stage progress is what `research_event`
-- exists for (F11 §4.1: "a run survives reload because the events are the source of truth, not
-- the stream"). Splitting `status` further would duplicate that source of truth in two places
-- that could drift; a stage transition while `status = 'running'` is a `research_event` row, not
-- a status value. See `MEMORY.md` D-42.

alter table research_run drop constraint research_run_status_check;
alter table research_run add constraint research_run_status_check check (
  status in ('queued', 'running', 'complete', 'degraded', 'verification_failed',
             'abstained', 'retracted', 'failed', 'cancelled')
);
