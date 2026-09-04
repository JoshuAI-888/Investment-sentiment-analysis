/**
 * Calculation artifacts (ADR-019). **Append-only, enforced by the database** — there is
 * deliberately no `update` or `delete` function in this module, and adding one would not help:
 * the trigger in `0009_append_only.sql` rejects it regardless of the call site.
 */
import {
  calculationSnapshot,
  type CalculationSnapshot,
  type CalculationPoint,
} from '../contracts/calculation';
import { camelizeRow, insertClause } from './rows';
import { getPool, withTransaction, type Queryable } from './client';

const COLUMNS =
  'id, metric_key, subject_type, subject_id, observation_key, scenario_type, official_calculation_id, owner_user_id, method_key, method_version, config_version, universe_version, assumption_profile_version, input_cutoff, status, exact_result, display_result, points, assumptions, warnings, input_hash, result_hash, predecessor_calculation_id, retention_class, computed_at, expires_at';

export type NewCalculationSnapshot = Omit<
  CalculationSnapshot,
  'id' | 'computedAt' | 'points' | 'warnings'
> & {
  id?: string;
  points?: readonly CalculationPoint[] | null;
  warnings?: readonly string[];
};

export async function insertCalculationSnapshot(
  input: NewCalculationSnapshot,
  db: Queryable = getPool(),
): Promise<CalculationSnapshot> {
  const { columns, placeholders, values } = insertClause({
    ...input,
    points: input.points === undefined || input.points === null ? null : JSON.stringify(input.points),
    warnings: JSON.stringify(input.warnings ?? []),
    exactResult: JSON.stringify(input.exactResult),
    displayResult: JSON.stringify(input.displayResult),
    assumptions: JSON.stringify(input.assumptions ?? {}),
  });

  const { rows } = await db.query(
    `insert into calculation_snapshot (${columns}) values (${placeholders}) returning ${COLUMNS}`,
    values,
  );
  return calculationSnapshot.parse(camelizeRow(rows[0] as Record<string, unknown>));
}

export async function findCalculationSnapshot(
  id: string,
  db: Queryable = getPool(),
): Promise<CalculationSnapshot | null> {
  const { rows } = await db.query(`select ${COLUMNS} from calculation_snapshot where id = $1`, [id]);
  const row = rows[0];
  return row === undefined
    ? null
    : calculationSnapshot.parse(camelizeRow(row as Record<string, unknown>));
}

/**
 * Fresh data creates a successor; nothing is recomputed in place (product invariant §6.2).
 * The predecessor stays readable, which is what lets a reader see that a number changed and
 * why — rather than seeing only that it is different from what they remember.
 */
export async function insertSuccessor(
  predecessorId: string,
  input: NewCalculationSnapshot,
  db: Queryable = getPool(),
): Promise<CalculationSnapshot> {
  return insertCalculationSnapshot({ ...input, predecessorCalculationId: predecessorId }, db);
}

export type ArtifactBody = {
  snapshot: NewCalculationSnapshot;
  inputs: readonly Record<string, unknown>[];
  steps: readonly Record<string, unknown>[];
};

/** Header, inputs and steps in one transaction. A half-written artifact is not inspectable. */
export async function insertArtifact(body: ArtifactBody): Promise<CalculationSnapshot> {
  return withTransaction(async (tx) => {
    const snapshot = await insertCalculationSnapshot(body.snapshot, tx);

    for (const input of body.inputs) {
      const { columns, placeholders, values } = insertClause({
        ...input,
        calculationId: snapshot.id,
      });
      await tx.query(
        `insert into calculation_input (${columns}) values (${placeholders})`,
        values,
      );
    }

    for (const step of body.steps) {
      const { columns, placeholders, values } = insertClause({
        ...step,
        calculationId: snapshot.id,
      });
      await tx.query(`insert into calculation_step (${columns}) values (${placeholders})`, values);
    }

    return snapshot;
  });
}
