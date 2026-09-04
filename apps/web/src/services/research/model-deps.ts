/**
 * Real (Postgres-backed) `ResearchModelClientDeps` for `model-tasks.ts` — mirrors
 * `services/dashboard/provider-deps.ts`'s exact shape: a real budget gate over the shared
 * `cost_event` global-ceiling check, a real cost sink writing `cost_event`, a no-op call log.
 *
 * **The budget gate is real, not the permissive placeholder.** `services/dashboard/budget.ts`'s
 * `checkGlobalBudget` (D-20's $350/month ceiling) already exists and is reused verbatim — every
 * research run's first priced call goes through it, satisfying F11 §6 DoD "every run is
 * budget-checked before its first priced call" with an actual check rather than a documented
 * stub `F18` is meant to replace later (`services/llm/model-client.ts`'s own
 * `permissiveBudgetGate` is that stub, for F10's two classify tasks — this module does not reuse
 * it, and does not need to: the same global-ceiling mechanism the dashboard already established
 * applies unchanged to a second caller).
 *
 * **The cost sink writes real `cost_event` rows, `research_run_id` populated.**
 * `contracts/cost.ts#costEvent` already carries a `researchRunId: uuid.nullable()` column — put
 * there ahead of this feature, evidently anticipating it — so this is the first writer to use it.
 * `services/llm/model-client.ts`'s own docstring reports a gap here ("LLM calls do not flow
 * through `cost_event`") for a different reason: it worried `contracts/provider.ts#providerId`
 * (an exhaustive union `adapters/rate-limit.ts` switches on) would need a new `'llm'` member.
 * That union constrains `cost_event.provider` nowhere — `costEvent.provider` is a plain
 * `z.string().min(1)` — so writing `provider: 'vercel_gateway'` here needs no contract change at
 * all. Reported as a correction to that gap note, not a repeat of it.
 */
import { checkGlobalBudget } from '@/services/dashboard/budget';
import { insertCostEvent } from '@/repositories/cost';
import { getPool, type Queryable } from '@/repositories/client';
import type {
  ResearchModelBudgetGate,
  ResearchModelCallLogSink,
  ResearchModelCostSink,
} from './model-tasks';

export function realResearchModelBudgetGate(db: Queryable = getPool()): ResearchModelBudgetGate {
  return {
    check: async () => {
      const result = await checkGlobalBudget(new Date(), db);
      if (result.allowed) return { allowed: true };
      return { allowed: false, scope: 'global', message: result.message };
    },
  };
}

export function researchCostSinkOverCostEvent(db: Queryable = getPool()): ResearchModelCostSink {
  return async (entry) => {
    await insertCostEvent(
      {
        occurredAt: entry.occurredAt,
        provider: 'vercel_gateway',
        service: 'llm',
        operationOrModel: entry.modelId === '' ? entry.task : entry.modelId,
        feature: 'F11',
        jobRunId: null,
        researchRunId: entry.runId,
        userId: null,
        requestId: entry.requestId,
        unitType: 'call',
        requestUnits: '1',
        billableUnits: '1',
        unitPrice: null,
        currency: 'USD',
        priceBookVersion: null,
        costUsd: entry.costUsd,
        costStatus: entry.costUsd === null ? 'unpriced' : 'actual',
        cacheStatus: 'miss',
        metadata: { task: entry.task },
      },
      db,
    );
  };
}

/** An accepted gap, matching `services/dashboard/provider-deps.ts`'s identical `noopCallLog` — `provider_call_log` is HTTP-adapter-shaped, not LLM-call-shaped (see `services/llm/ports.ts`'s own docstring). */
export const noopResearchCallLog: ResearchModelCallLogSink = async () => {};
