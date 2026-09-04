/**
 * Two read-only `calculation_snapshot` queries `repositories/calculations.ts` does not expose —
 * "find the latest calculation for a method+subject" (`explain_spike` needs the latest
 * `market.spike_detection` verdict) and "find calculations for a method+subject in a date range"
 * (`get_historical_window`).
 *
 * **A standalone cross-lane gap-fill, the same shape `repositories/jobs.ts` already documents
 * for exactly this situation** ("SQL lives here and nowhere else... built as a standalone
 * cross-lane gap-fill... F16a's dispatch core needs repository functions over [these tables]
 * that only SPINE can write"). F21 (unallocated Wave 3) needs a read `repositories/
 * calculations.ts` (SPINE-owned) does not yet expose, and `CLAUDE.md` says "a needed contract
 * change is reported, not made" for a path another lane owns — but `architecture/
 * no-sql-outside-repositories` also means that read cannot live in `services/mcp/` at all: SQL
 * is only legal inside `src/repositories/`. This file is the resolution both rules point to: a
 * **new, additive file under `repositories/`**, not an edit to the SPINE file the query
 * logically belongs on. It parses rows through the same `calculationSnapshot` zod schema
 * `repositories/calculations.ts` itself parses against, so a schema drift on that table is still
 * caught here even though the query text is duplicated.
 * **Reported to SPINE:** `findLatestCalculationByMethod`/`findCalculationsInRange` are natural
 * additions to `repositories/calculations.ts` itself for whoever next touches that file — this
 * standalone module exists only so F21 does not have to edit it to ship.
 *
 * This file only ever `select`s — it has no insert/update path, matching F21 §3's "F21 reads. It
 * does not compute."
 */
import { calculationSnapshot, type CalculationSnapshot } from '@/contracts/calculation';
import { camelizeRow } from '@/repositories/rows';
import { getPool, type Queryable } from '@/repositories/client';

const COLUMNS =
  'id, metric_key, subject_type, subject_id, observation_key, scenario_type, official_calculation_id, owner_user_id, method_key, method_version, config_version, universe_version, assumption_profile_version, input_cutoff, status, exact_result, display_result, points, assumptions, warnings, input_hash, result_hash, predecessor_calculation_id, retention_class, computed_at, expires_at';

/** The most recent `calculation_snapshot` row for one method key against one subject, regardless of `status` (an abstained/`insufficient_data` row is still the "latest verdict"). `null` when none exists yet. */
export async function findLatestCalculationByMethod(
  methodKey: string,
  subjectId: string,
  db: Queryable = getPool(),
): Promise<CalculationSnapshot | null> {
  const { rows } = await db.query(
    `select ${COLUMNS} from calculation_snapshot
     where method_key = $1 and subject_id = $2
     order by computed_at desc
     limit 1`,
    [methodKey, subjectId],
  );
  const row = rows[0];
  return row === undefined ? null : calculationSnapshot.parse(camelizeRow(row as Record<string, unknown>));
}

/**
 * Every `calculation_snapshot` row for one method key against one subject whose `computed_at`
 * falls in `[from, to]`, oldest first. Bounded by `limit` (default 200 — `get_historical_window`
 * narrows this further per §5's corpus-leak discipline: a series tool is still a bounded read,
 * not an open-ended one).
 */
export async function findCalculationsInRange(
  methodKey: string,
  subjectId: string,
  from: Date,
  to: Date,
  limit = 200,
  db: Queryable = getPool(),
): Promise<readonly CalculationSnapshot[]> {
  const { rows } = await db.query(
    `select ${COLUMNS} from calculation_snapshot
     where method_key = $1 and subject_id = $2 and computed_at >= $3 and computed_at <= $4
     order by computed_at asc
     limit $5`,
    [methodKey, subjectId, from, to, limit],
  );
  return rows.map((row) => calculationSnapshot.parse(camelizeRow(row as Record<string, unknown>)));
}
