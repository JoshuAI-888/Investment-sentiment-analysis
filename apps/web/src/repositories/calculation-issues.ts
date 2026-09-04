/**
 * `calculation_issue` — F15 §4.6's issue queue. Additive to `artifacts.ts`/`retention.ts`, which
 * already read this table (retention's "is this issue still open" exclusion, the Inspector's own
 * issue list); this file is the write side those two never needed.
 *
 * Unlike `calculation_snapshot`/`audit_event`, `calculation_issue` carries **no** append-only
 * trigger (`migrations/0009_append_only.sql` names it in neither list) — it is a workflow row,
 * and `status`/`resolution_*`/`updated_at` genuinely transition. What must not happen is the
 * *calculation* being mutated: resolution names a **different**, already-computed
 * `calculation_snapshot` via `resolution_calculation_id` rather than touching the original.
 */
import { calculationIssue, type CalculationIssue } from '../contracts/calculation';
import { camelizeRow } from './rows';
import { getPool, type Queryable } from './client';

const COLUMNS =
  'id, calculation_id, input_key, step_key, reporter_user_id, issue_type, description, status, assigned_to, admin_notes, resolution_summary, resolution_calculation_id, created_at, updated_at, resolved_at';

export async function findCalculationIssueById(
  id: string,
  db: Queryable = getPool(),
): Promise<CalculationIssue | null> {
  const { rows } = await db.query(`select ${COLUMNS} from calculation_issue where id = $1`, [id]);
  const row = rows[0];
  return row === undefined ? null : calculationIssue.parse(camelizeRow(row as Record<string, unknown>));
}

export type CalculationIssueListQuery = {
  readonly status?: CalculationIssue['status'] | undefined;
  readonly limit?: number | undefined;
};

export async function listCalculationIssues(
  query: CalculationIssueListQuery,
  db: Queryable = getPool(),
): Promise<CalculationIssue[]> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  if (query.status !== undefined) {
    const { rows } = await db.query(
      `select ${COLUMNS} from calculation_issue where status = $1 order by created_at desc limit $2`,
      [query.status, limit],
    );
    return rows.map((row) => calculationIssue.parse(camelizeRow(row as Record<string, unknown>)));
  }
  const { rows } = await db.query(
    `select ${COLUMNS} from calculation_issue order by created_at desc limit $1`,
    [limit],
  );
  return rows.map((row) => calculationIssue.parse(camelizeRow(row as Record<string, unknown>)));
}

export type ResolutionUpdate = {
  readonly status: 'resolved' | 'rejected';
  readonly adminNotes: string | null;
  readonly resolutionSummary: string;
  /** Required for `resolved`; must be `null` for `rejected` (nothing to point at). */
  readonly resolutionCalculationId: string | null;
};

/**
 * `expectedUpdatedAt` is this row's optimistic-concurrency token (`calculation_issue` has no
 * integer version column). The `where updated_at = $expected` clause makes a stale write affect
 * zero rows rather than silently overwriting a concurrent admin's resolution — `null` is
 * returned in that case and the caller (the F15 mutation pipeline) reports the conflict.
 */
export async function resolveCalculationIssue(
  id: string,
  expectedUpdatedAt: Date,
  update: ResolutionUpdate,
  db: Queryable = getPool(),
): Promise<CalculationIssue | null> {
  const { rows } = await db.query(
    `update calculation_issue
        set status = $1, admin_notes = $2, resolution_summary = $3,
            resolution_calculation_id = $4, resolved_at = now(), updated_at = now()
      where id = $5 and updated_at = $6
      returning ${COLUMNS}`,
    [
      update.status,
      update.adminNotes,
      update.resolutionSummary,
      update.resolutionCalculationId,
      id,
      expectedUpdatedAt,
    ],
  );
  const row = rows[0];
  return row === undefined ? null : calculationIssue.parse(camelizeRow(row as Record<string, unknown>));
}
