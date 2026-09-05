/**
 * Cost recording for the two priced model calls (synthesis, verification) — lane-review finding
 * 2. `02-ARCHITECTURE-CONTRACTS.md` §4.6: "Every call: ... recorded to `cost_event` with
 * `costUsd` or `null`." Before this file, F11 recorded neither, so `research_run.cost_usd`
 * always read `'0'` (§6.6's exact forbidden case — "unpriced" rendering as `$0.00`) and D-20's
 * global ceiling could never see a single dollar of research spend no matter how many runs
 * executed.
 *
 * **The price is an estimate, stated as one.** No price book exists anywhere in this codebase
 * yet — every existing `cost_event` writer (`services/{dashboard,market,attention}/
 * provider-deps.ts`) either passes a provider-reported `costUsd` or `null` for a free-tier call;
 * none computes a price from first principles, because none has needed to before now. Per-model
 * token pricing is real and public, but ADR-017 forbids hardcoding a model id, and no versioned
 * price-book config exists to look one up by whatever `AI_MODEL_SYNTHESIS`/`AI_MODEL_VERIFY`
 * resolve to at runtime. `ESTIMATED_PRICE_PER_1K_*_TOKENS_USD` below is a conservative, named,
 * revisitable blended rate — the same accepted pattern `services/dashboard/budget.ts` already
 * uses for `GLOBAL_BUDGET_CEILING_USD` ("not yet operator-editable... the constant is the
 * honest state of the world today"). `costStatus: 'estimated'` (not `'actual'`) records that
 * honestly in the row itself; F18 is the eventual home for a real, operator-editable price book.
 */
import Decimal from 'decimal.js';
import { insertCostEvent, type NewCostEvent } from '@/repositories/cost';
import { getPool, type Queryable } from '@/repositories/client';

export type ModelUsage = { promptTokens: number; completionTokens: number };

/** Stated, revisitable default — see this module's docstring. Not a live provider value. */
export const ESTIMATED_PRICE_PER_1K_INPUT_TOKENS_USD = '0.005';
/** Output tokens are conventionally priced higher than input across every major vendor. */
export const ESTIMATED_PRICE_PER_1K_OUTPUT_TOKENS_USD = '0.015';

/** Pure. `usage: null` (a client that reported no token counts) yields `null` — never a guessed number. */
export function estimateCostUsd(usage: ModelUsage | null): string | null {
  if (usage === null) return null;
  const input = new Decimal(usage.promptTokens).div(1000).mul(ESTIMATED_PRICE_PER_1K_INPUT_TOKENS_USD);
  const output = new Decimal(usage.completionTokens).div(1000).mul(ESTIMATED_PRICE_PER_1K_OUTPUT_TOKENS_USD);
  return input.plus(output).toFixed(6);
}

export type ModelCostRecordInput = {
  runId: string;
  userId: string;
  task: 'synthesis' | 'verify';
  model: string;
  usage: ModelUsage | null;
  requestId: string;
  occurredAt: Date;
};

/**
 * Pure — builds the exact row `recordModelCost` inserts, without touching the database. Split
 * out so the mapping (which field gets which value, and the `unpriced`/`estimated` status
 * split) has a unit test that needs no `Queryable` at all.
 */
export function buildModelCostEvent(input: ModelCostRecordInput): NewCostEvent {
  const costUsd = estimateCostUsd(input.usage);
  const totalTokens = input.usage === null ? null : input.usage.promptTokens + input.usage.completionTokens;

  return {
    occurredAt: input.occurredAt,
    provider: 'model_gateway',
    service: 'research',
    operationOrModel: input.model,
    feature: `research.${input.task}`,
    jobRunId: null,
    researchRunId: input.runId,
    userId: input.userId,
    requestId: input.requestId,
    // `unitType` has no combined "tokens" member (contracts/cost.ts) — the call itself is the
    // billable unit; the real token breakdown is carried in `metadata` for audit, not lost.
    unitType: 'call',
    requestUnits: '1',
    billableUnits: '1',
    unitPrice: null,
    currency: 'USD',
    priceBookVersion: null,
    costUsd,
    costStatus: costUsd === null ? 'unpriced' : 'estimated',
    cacheStatus: 'miss',
    metadata: input.usage === null ? {} : { promptTokens: input.usage.promptTokens, completionTokens: input.usage.completionTokens, totalTokens },
  };
}

export async function recordModelCost(
  input: ModelCostRecordInput,
  db: Queryable = getPool(),
): Promise<{ costUsd: string | null }> {
  const row = buildModelCostEvent(input);
  await insertCostEvent(row, db);
  return { costUsd: row.costUsd };
}

/**
 * `research_run.cost_usd` (unlike `cost_event.cost_usd`) is a non-nullable decimal — the
 * contract has no "unpriced" state for it. This is the running total `orchestrator.ts` persists
 * there instead of a hardcoded `'0'` (lane-review finding 2's second half: "`$0.00`... is
 * exactly what you're doing"). It accumulates synchronously from each call's own estimate,
 * independent of whether the corresponding `cost_event` insert (fire-and-forget) has actually
 * completed — the authoritative ledger for budget purposes is always `cost_event`, scoped by
 * `researchRunId`; this is a best-effort display total for the run row alone. An unpriced call
 * (`usage: null`) contributes `0` here — a real limitation given the field's own non-nullable
 * shape, not a silent one: every unpriced contribution is still visible in `cost_event` as
 * `costStatus: 'unpriced'`, which is the surface product invariant §6.6 actually governs.
 */
export function createCostAccumulator(): { add: (costUsd: string | null) => void; total: () => string } {
  let total = new Decimal(0);
  return {
    add: (costUsd) => {
      if (costUsd === null) return;
      total = total.plus(costUsd);
    },
    total: () => total.toFixed(6),
  };
}
