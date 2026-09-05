import Decimal from 'decimal.js';
import { budgetUsage, refreshPlan, type RniBudgetUsage, type RniRefreshPlan } from './types';

export class RniOrchestrationError extends Error {
  constructor(
    readonly code:
      | 'CONFLICT'
      | 'NOT_FOUND'
      | 'INVALID_PLAN'
      | 'BUDGET_RUN'
      | 'BUDGET_DAY'
      | 'BUDGET_MONTH'
      | 'STALE_EXECUTION'
      | 'NOT_DUE'
      | 'INVALID_SIGNATURE',
  ) {
    super(`RNI orchestration: ${code}`);
    this.name = 'RniOrchestrationError';
  }
}

/** Worst-case task envelope cost, including the caller's explicit total retry allowance. */
export function estimateRniRefreshBudget(input: RniRefreshPlan) {
  const plan = refreshPlan.parse(input);
  const perPlatform = { reddit: new Decimal(0), x: new Decimal(0) };
  for (const platform of ['reddit', 'x'] as const) {
    for (const envelope of plan.envelopes) {
      perPlatform[platform] = perPlatform[platform].plus(
        new Decimal(envelope.maxCostUsd).mul(plan.calls[platform][envelope.task]),
      );
    }
  }
  const total = perPlatform.reddit.plus(perPlatform.x);
  const runLimit = Decimal.min(plan.scopePreview.kind === 'ticker' ? 2 : 25, plan.maxCostUsd);
  if (total.gt(runLimit)) throw new RniOrchestrationError('BUDGET_RUN');
  return {
    redditUsd: perPlatform.reddit.toFixed(),
    xUsd: perPlatform.x.toFixed(),
    totalUsd: total.toFixed(),
    runLimitUsd: runLimit.toFixed(),
  };
}

/** Usage is before the new admission. Equality at a hard boundary is permitted. */
export function assertRniAggregateBudget(costUsd: string, input: RniBudgetUsage) {
  const usage = budgetUsage.parse(input);
  const cost = new Decimal(costUsd);
  if (!cost.isFinite() || cost.isNegative()) throw new RniOrchestrationError('INVALID_PLAN');
  if (new Decimal(usage.rollingDayUsd).plus(cost).gt(50))
    throw new RniOrchestrationError('BUDGET_DAY');
  const month = new Decimal(usage.calendarMonthUsd).plus(cost);
  if (month.gt(500)) throw new RniOrchestrationError('BUDGET_MONTH');
  return { monthlyWarning: month.gte(300) };
}
