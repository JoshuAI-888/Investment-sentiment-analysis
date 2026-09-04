/**
 * `eval_run`, `eval_result` and `eval_calibration_score` (migration `0015`). SQL lives here and
 * nowhere else (F03 DoD item 9, `no-sql-outside-repositories`).
 *
 * **This feature's own small, additive repository** — `CLAUDE.md`: "a small additive migration+
 * repository for `EvalResult` storage [is] clearly F12's own territory." Mirrors
 * `repositories/research.ts`'s precedent for the identical situation: a wholly new table set with
 * no prior repository, introduced by the same feature that needs it, nothing existing edited.
 *
 * **`eval_result`/`eval_calibration_score` are insert-only by construction** — no function here
 * issues an `update` or `delete` against either. `eval_run` is not: `patchEvalRun` is the one
 * place its `completedAt`/`summary`/`gatePassed` are written after creation, the identical shape
 * `repositories/research.ts#patchResearchRun` uses for `research_run`'s own mutable current-state
 * columns.
 */
import {
  evalRun,
  evalResult,
  evalCalibrationScore,
  type EvalRun,
  type EvalResult,
  type EvalCalibrationScore,
} from '../contracts/eval';
import { camelizeRow, type Row } from './rows';
import { getPool, type Queryable } from './client';

// ── eval_run ─────────────────────────────────────────────────────────────────────────────────

const RUN_COLUMNS =
  'id, kind, corpus_version, model_ids, started_at, completed_at, summary, gate_passed, created_at';

function parseRun(row: Row): EvalRun {
  return evalRun.parse(camelizeRow(row));
}

export type NewEvalRun = {
  readonly kind: EvalRun['kind'];
  readonly corpusVersion: string;
  readonly modelIds: unknown;
};

export async function insertEvalRun(input: NewEvalRun, db: Queryable = getPool()): Promise<EvalRun> {
  const { rows } = await db.query(
    `insert into eval_run (kind, corpus_version, model_ids)
     values ($1, $2, $3)
     returning ${RUN_COLUMNS}`,
    [input.kind, input.corpusVersion, JSON.stringify(input.modelIds ?? {})],
  );
  const row = rows[0] as Row | undefined;
  if (row === undefined) throw new Error('insert into eval_run returned no row');
  return parseRun(row);
}

export async function findEvalRun(id: string, db: Queryable = getPool()): Promise<EvalRun | null> {
  const { rows } = await db.query(`select ${RUN_COLUMNS} from eval_run where id = $1`, [id]);
  const row = rows[0] as Row | undefined;
  return row === undefined ? null : parseRun(row);
}

export type EvalRunPatch = {
  readonly completedAt?: Date;
  readonly summary?: unknown;
  readonly gatePassed?: boolean;
};

/** The one place `eval_run`'s post-creation columns are written — mirrors `patchResearchRun`. */
export async function patchEvalRun(
  id: string,
  patch: EvalRunPatch,
  db: Queryable = getPool(),
): Promise<EvalRun> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (patch.completedAt !== undefined) {
    sets.push(`completed_at = $${String(i)}`);
    values.push(patch.completedAt);
    i += 1;
  }
  if (patch.summary !== undefined) {
    sets.push(`summary = $${String(i)}`);
    values.push(JSON.stringify(patch.summary));
    i += 1;
  }
  if (patch.gatePassed !== undefined) {
    sets.push(`gate_passed = $${String(i)}`);
    values.push(patch.gatePassed);
    i += 1;
  }

  if (sets.length === 0) {
    const existing = await findEvalRun(id, db);
    if (existing === null) throw new Error(`eval_run ${id} not found`);
    return existing;
  }

  values.push(id);
  const { rows } = await db.query(
    `update eval_run set ${sets.join(', ')} where id = $${String(i)} returning ${RUN_COLUMNS}`,
    values,
  );
  const row = rows[0] as Row | undefined;
  if (row === undefined) throw new Error(`eval_run ${id} not found`);
  return parseRun(row);
}

export async function listEvalRuns(
  kind: EvalRun['kind'] | null = null,
  db: Queryable = getPool(),
): Promise<readonly EvalRun[]> {
  const { rows } =
    kind === null
      ? await db.query(`select ${RUN_COLUMNS} from eval_run order by started_at desc`)
      : await db.query(`select ${RUN_COLUMNS} from eval_run where kind = $1 order by started_at desc`, [kind]);
  return rows.map((row) => parseRun(row as Row));
}

// ── eval_result ──────────────────────────────────────────────────────────────────────────────

const RESULT_COLUMNS =
  'id, eval_run_id, pack_id, answer_id, kind, fault_class, judge_c1, judge_c2, judge_c3, judge_c4, ' +
  'judge_violations, judge_rationale, verifier_outcome, created_at';

export type NewEvalResult = Omit<EvalResult, 'id' | 'createdAt'>;

export async function insertEvalResult(
  input: NewEvalResult,
  db: Queryable = getPool(),
): Promise<EvalResult> {
  const { rows } = await db.query(
    `insert into eval_result
       (eval_run_id, pack_id, answer_id, kind, fault_class, judge_c1, judge_c2, judge_c3, judge_c4,
        judge_violations, judge_rationale, verifier_outcome)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     returning ${RESULT_COLUMNS}`,
    [
      input.evalRunId,
      input.packId,
      input.answerId,
      input.kind,
      input.faultClass,
      input.judgeC1,
      input.judgeC2,
      input.judgeC3,
      input.judgeC4,
      JSON.stringify(input.judgeViolations ?? []),
      input.judgeRationale,
      input.verifierOutcome,
    ],
  );
  const row = rows[0] as Row | undefined;
  if (row === undefined) throw new Error('insert into eval_result returned no row');
  return evalResult.parse(camelizeRow(row));
}

export async function insertEvalResults(
  inputs: readonly NewEvalResult[],
  db: Queryable = getPool(),
): Promise<readonly EvalResult[]> {
  const out: EvalResult[] = [];
  for (const input of inputs) out.push(await insertEvalResult(input, db));
  return out;
}

export async function listEvalResultsForRun(
  evalRunId: string,
  db: Queryable = getPool(),
): Promise<readonly EvalResult[]> {
  const { rows } = await db.query(
    `select ${RESULT_COLUMNS} from eval_result where eval_run_id = $1 order by created_at asc`,
    [evalRunId],
  );
  return rows.map((row) => evalResult.parse(camelizeRow(row as Row)));
}

// ── eval_calibration_score (MT-11) ──────────────────────────────────────────────────────────

const CALIBRATION_COLUMNS =
  'id, eval_run_id, answer_id, human_c1, human_c2, human_c3, human_c4, scored_by, created_at';

export type NewEvalCalibrationScore = Omit<EvalCalibrationScore, 'id' | 'createdAt'>;

export async function insertEvalCalibrationScore(
  input: NewEvalCalibrationScore,
  db: Queryable = getPool(),
): Promise<EvalCalibrationScore> {
  const { rows } = await db.query(
    `insert into eval_calibration_score
       (eval_run_id, answer_id, human_c1, human_c2, human_c3, human_c4, scored_by)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning ${CALIBRATION_COLUMNS}`,
    [input.evalRunId, input.answerId, input.humanC1, input.humanC2, input.humanC3, input.humanC4, input.scoredBy],
  );
  const row = rows[0] as Row | undefined;
  if (row === undefined) throw new Error('insert into eval_calibration_score returned no row');
  return evalCalibrationScore.parse(camelizeRow(row));
}

export async function listEvalCalibrationScoresForRun(
  evalRunId: string,
  db: Queryable = getPool(),
): Promise<readonly EvalCalibrationScore[]> {
  const { rows } = await db.query(
    `select ${CALIBRATION_COLUMNS} from eval_calibration_score where eval_run_id = $1 order by created_at asc`,
    [evalRunId],
  );
  return rows.map((row) => evalCalibrationScore.parse(camelizeRow(row as Row)));
}
