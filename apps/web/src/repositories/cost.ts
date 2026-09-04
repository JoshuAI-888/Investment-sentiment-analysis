/**
 * Cost events. Append-only: reconciliation writes a **successor** row rather than updating the
 * estimate, so what we believed a call cost at the time stays readable — which is what makes a
 * systematically wrong price book detectable rather than merely fixable.
 */
import { costEvent, type CostEvent } from '../contracts/cost';
import { camelizeRow, insertClause } from './rows';
import { getPool, type Queryable } from './client';

const COLUMNS =
  'id, occurred_at, provider, service, operation_or_model, feature, job_run_id, research_run_id, user_id, request_id, unit_type, request_units, billable_units, unit_price, currency, price_book_version, cost_usd, cost_status, cache_status, metadata, supersedes_cost_event_id';

export type NewCostEvent = Omit<CostEvent, 'id' | 'supersedesCostEventId'> & {
  id?: string;
  supersedesCostEventId?: string | null;
};

export async function insertCostEvent(
  input: NewCostEvent,
  db: Queryable = getPool(),
): Promise<CostEvent> {
  const { columns, placeholders, values } = insertClause({
    ...input,
    metadata: JSON.stringify(input.metadata ?? {}),
  });
  const { rows } = await db.query(
    `insert into cost_event (${columns}) values (${placeholders}) returning ${COLUMNS}`,
    values,
  );
  return costEvent.parse(camelizeRow(rows[0] as Record<string, unknown>));
}

export async function reconcileCostEvent(
  originalId: string,
  actual: { costUsd: string; unitPrice: string; priceBookVersion: string },
  db: Queryable = getPool(),
): Promise<CostEvent> {
  const original = await findCostEvent(originalId, db);
  if (original === null) throw new Error(`cost_event ${originalId} not found`);

  return insertCostEvent(
    {
      ...original,
      costUsd: actual.costUsd,
      unitPrice: actual.unitPrice,
      priceBookVersion: actual.priceBookVersion,
      costStatus: 'reconciled',
      supersedesCostEventId: originalId,
    },
    db,
  );
}

export async function findCostEvent(
  id: string,
  db: Queryable = getPool(),
): Promise<CostEvent | null> {
  const { rows } = await db.query(`select ${COLUMNS} from cost_event where id = $1`, [id]);
  const row = rows[0];
  return row === undefined ? null : costEvent.parse(camelizeRow(row as Record<string, unknown>));
}

/**
 * Total spend in a window, and the count of calls we could not price.
 *
 * The unpriced count is returned alongside the total rather than folded into it, because a
 * total that silently omits unpriced calls is the number that reads as comfortable on the day
 * D-32's ceiling is actually exhausted. `sum` over a nullable column already skips nulls —
 * this makes that skip visible instead of invisible.
 */
export async function spendInWindow(
  from: Date,
  to: Date,
  db: Queryable = getPool(),
): Promise<{ totalUsd: string; unpricedCount: number; pricedCount: number }> {
  const { rows } = await db.query<{ total: string | null; unpriced: string; priced: string }>(
    `select coalesce(sum(cost_usd), 0)::text as total,
            count(*) filter (where cost_usd is null)::text as unpriced,
            count(*) filter (where cost_usd is not null)::text as priced
       from cost_event
      where occurred_at >= $1 and occurred_at < $2
        -- Latest version of each event: keep a row unless some other row supersedes it. An
        -- earlier draft of this filtered on supersedes_cost_event_id is null, which keeps the
        -- superseded estimate and drops the reconciled figure — exactly backwards, and it would
        -- have reported the number we no longer believe.
        and not exists (
          select 1 from cost_event successor
           where successor.supersedes_cost_event_id = cost_event.id
        )`,
    [from, to],
  );

  const row = rows[0];
  return {
    totalUsd: row?.total ?? '0',
    unpricedCount: Number(row?.unpriced ?? '0'),
    pricedCount: Number(row?.priced ?? '0'),
  };
}
