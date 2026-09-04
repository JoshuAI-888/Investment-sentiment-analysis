-- 0015 — F12's evaluation harness: eval runs, their per-answer results, and calibration scores.
-- Wave 3 (F12) writes these. F03 owns the schema baseline.

create table eval_run (
  id             uuid        primary key default gen_random_uuid(),
  kind           text        not null,
  corpus_version text        not null,
  model_ids      jsonb       not null default '{}'::jsonb,
  started_at     timestamptz not null default now(),
  completed_at   timestamptz null,
  summary        jsonb       null,
  gate_passed    boolean     null,
  created_at     timestamptz not null default now(),

  constraint eval_run_kind_check check (kind in ('corpus', 'seeded_error', 'calibration'))
);

comment on column eval_run.summary is
  'F12 §4.5: results are stored per run so a threshold change can be re-evaluated without re-running the models.';

-- Append-only: an eval run's outcome is a fact about the corpus at the model IDs recorded on it.
-- A re-run under a changed model route is a new row, never an update to this one (F12 §4.5).
create table eval_result (
  id                uuid        primary key default gen_random_uuid(),
  eval_run_id       uuid        not null references eval_run (id),
  pack_id           text        not null,
  answer_id         text        not null,
  kind              text        not null,
  fault_class       text        null,
  judge_c1          integer     null,
  judge_c2          integer     null,
  judge_c3          integer     null,
  judge_c4          integer     null,
  judge_violations  jsonb       not null default '[]'::jsonb,
  judge_rationale   text        null,
  verifier_outcome  text        null,
  created_at        timestamptz not null default now(),

  constraint eval_result_kind_check check (kind in ('gold', 'seeded_error')),
  constraint eval_result_fault_class_check check (
    fault_class is null or fault_class in (
      'wrong_number', 'swapped_ticker', 'unsupported_causal_claim', 'stale_date',
      'buy_recommendation', 'price_target', 'citation_unrelated_evidence',
      'stance_on_thin_sample', 'fabricated_evidence_id'
    )
  ),
  constraint eval_result_verifier_outcome_check check (
    verifier_outcome is null or verifier_outcome in ('verified', 'verification_failed', 'not_run')
  ),
  -- F12 §4.3: the judge's four axes are all-or-nothing — a run either scored a claim or didn't.
  constraint eval_result_judge_scores_together_check check (
    (judge_c1 is null and judge_c2 is null and judge_c3 is null and judge_c4 is null)
    or (judge_c1 is not null and judge_c2 is not null and judge_c3 is not null and judge_c4 is not null)
  ),
  constraint eval_result_judge_score_range_check check (
    (judge_c1 is null or judge_c1 between 1 and 5)
    and (judge_c2 is null or judge_c2 between 1 and 5)
    and (judge_c3 is null or judge_c3 between 1 and 5)
    and (judge_c4 is null or judge_c4 between 1 and 5)
  )
);

create index eval_result_eval_run_id_idx on eval_result (eval_run_id);

-- MT-11 — one human hand-score per sampled answer, on the same rubric the judge uses. Kept
-- separate from `eval_result` (which holds the judge's own scores for the same answer under a
-- 'calibration'-kind run) so the two never collide on the same row.
create table eval_calibration_score (
  id           uuid        primary key default gen_random_uuid(),
  eval_run_id  uuid        not null references eval_run (id),
  answer_id    text        not null,
  human_c1     integer     not null,
  human_c2     integer     not null,
  human_c3     integer     not null,
  human_c4     integer     not null,
  scored_by    text        not null,
  created_at   timestamptz not null default now(),

  constraint eval_calibration_score_range_check check (
    human_c1 between 1 and 5 and human_c2 between 1 and 5
    and human_c3 between 1 and 5 and human_c4 between 1 and 5
  )
);

create index eval_calibration_score_eval_run_id_idx on eval_calibration_score (eval_run_id);
