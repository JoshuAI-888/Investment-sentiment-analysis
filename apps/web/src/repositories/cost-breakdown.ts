/**
 * F15 §4.7 — the cost ledger view's grouped read. Additive to `cost.ts`, which already owns
 * `spendInWindow`'s window total; this adds the per-provider/service breakdown the ledger table
 * needs, built the same way `spendInWindow` was (F03 §4.2): **unpriced is a separate, counted
 * bucket, never folded into a `$0.00` total** — D-11 left the global ceiling as the only budget
 * control, so a line that reads as free when it was merely unpriced is the exact failure mode
 * that ceiling exists to catch.
 */
import { getPool, type Queryable } from './client';

export type CostBreakdownRow = {
  readonly provider: string;
  readonly service: string;
  readonly pricedUsd: string;
  readonly pricedCount: number;
  readonly unpricedCount: number;
  readonly estimatedCount: number;
  readonly reconciledCount: number;
};

/**
 * Grouped by `(provider, service)`, latest version of each `cost_event` only (a row superseded
 * by a reconciliation is excluded — the same `not exists` guard `spendInWindow` uses, so the two
 * views can never disagree about which row is current).
 */
export async function costBreakdownInWindow(
  from: Date,
  to: Date,
  db: Queryable = getPool(),
): Promise<CostBreakdownRow[]> {
  const { rows } = await db.query<{
    provider: string;
    service: string;
    priced_usd: string | null;
    priced_count: string;
    unpriced_count: string;
    estimated_count: string;
    reconciled_count: string;
  }>(
    `select provider, service,
            coalesce(sum(cost_usd), 0)::text as priced_usd,
            count(*) filter (where cost_usd is not null)::text as priced_count,
            count(*) filter (where cost_status = 'unpriced')::text as unpriced_count,
            count(*) filter (where cost_status = 'estimated')::text as estimated_count,
            count(*) filter (where cost_status = 'reconciled')::text as reconciled_count
       from cost_event
      where occurred_at >= $1 and occurred_at < $2
        and not exists (
          select 1 from cost_event successor
           where successor.supersedes_cost_event_id = cost_event.id
        )
      group by provider, service
      order by priced_usd desc, provider, service`,
    [from, to],
  );

  return rows.map((row) => ({
    provider: row.provider,
    service: row.service,
    pricedUsd: row.priced_usd ?? '0',
    pricedCount: Number(row.priced_count),
    unpricedCount: Number(row.unpriced_count),
    estimatedCount: Number(row.estimated_count),
    reconciledCount: Number(row.reconciled_count),
  }));
}

export type BudgetPolicyRow = {
  readonly id: string;
  readonly scopeType: string;
  readonly scopeId: string;
  readonly period: string;
  readonly softLimit: string;
  readonly hardLimit: string;
  readonly enabled: boolean;
};

/** Current budget policies for an environment, read for the ledger's threshold display. */
export async function listBudgetPolicies(
  environment: string,
  db: Queryable = getPool(),
): Promise<BudgetPolicyRow[]> {
  const { rows } = await db.query<{
    id: string;
    scope_type: string;
    scope_id: string;
    period: string;
    soft_limit: string;
    hard_limit: string;
    enabled: boolean;
  }>(
    `select id, scope_type, scope_id, period, soft_limit, hard_limit, enabled
       from budget_policy
      where environment = $1
      order by scope_type, scope_id, period`,
    [environment],
  );
  return rows.map((row) => ({
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    period: row.period,
    softLimit: row.soft_limit,
    hardLimit: row.hard_limit,
    enabled: row.enabled,
  }));
}

export type NewBudgetPolicy = {
  readonly environment: string;
  readonly scopeType: string;
  readonly scopeId: string;
  readonly period: 'daily' | 'monthly';
  readonly softLimit: string;
  readonly hardLimit: string;
  readonly currency: string;
  readonly configVersion: string;
};

export async function insertBudgetPolicy(
  input: NewBudgetPolicy,
  db: Queryable = getPool(),
): Promise<BudgetPolicyRow> {
  const { rows } = await db.query<{
    id: string;
    scope_type: string;
    scope_id: string;
    period: string;
    soft_limit: string;
    hard_limit: string;
    enabled: boolean;
  }>(
    `insert into budget_policy (environment, scope_type, scope_id, period, soft_limit, hard_limit, currency, config_version)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id, scope_type, scope_id, period, soft_limit, hard_limit, enabled`,
    [
      input.environment,
      input.scopeType,
      input.scopeId,
      input.period,
      input.softLimit,
      input.hardLimit,
      input.currency,
      input.configVersion,
    ],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('insert into budget_policy returned no row');
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    period: row.period,
    softLimit: row.soft_limit,
    hardLimit: row.hard_limit,
    enabled: row.enabled,
  };
}
