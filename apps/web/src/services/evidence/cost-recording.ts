/**
 * Wires a `ModelCallAttemptRecord` (`model-client.ts`) to `repositories/cost.ts`'s
 * `insertCostEvent` — F10 §6's DoD: "model/route/prompt version and cost recorded per call."
 *
 * Kept out of `pack-builder.ts` deliberately: a `cost_event` row needs a `feature`/`requestId`
 * the pack builder itself has no natural value for (it is not a request handler and does not
 * know why it was invoked — a ticker-page render, a research run, an eval pass). This is the
 * piece a caller with that context wires through `BuildEvidencePackDeps.onModelCallRecord`.
 */
import { insertCostEvent } from '@/repositories/cost';
import type { Queryable } from '@/repositories/client';
import type { ModelCallAttemptRecord } from './model-client';

export type CostRecordingContext = {
  readonly feature: string;
  readonly requestId: string;
  readonly jobRunId?: string | null;
  readonly researchRunId?: string | null;
  readonly userId?: string | null;
};

/**
 * `costUsd: null` (UNPRICED) is recorded, never coerced to `'0'` — `contracts/cost.ts`'s own
 * refinement rejects a mismatched `costStatus`/`costUsd` pair, so this mapping has to get that
 * right or every call would fail its own contract at insert time.
 */
export async function recordModelCallCost(
  record: ModelCallAttemptRecord,
  methodTitle: string,
  context: CostRecordingContext,
  db: Queryable,
): Promise<void> {
  const isUnpriced = record.usage.costUsd === null;
  await insertCostEvent(
    {
      occurredAt: new Date(record.requestedAt),
      provider: 'vercel_gateway',
      service: record.methodId,
      operationOrModel: `${record.model} (${methodTitle}, ${record.promptVersion}, attempt ${record.attempt})`,
      feature: context.feature,
      jobRunId: context.jobRunId ?? null,
      researchRunId: context.researchRunId ?? null,
      userId: context.userId ?? null,
      requestId: context.requestId,
      unitType: 'call',
      requestUnits: '1',
      billableUnits: '1',
      unitPrice: null,
      currency: 'USD',
      priceBookVersion: null,
      costUsd: record.usage.costUsd,
      costStatus: isUnpriced ? 'unpriced' : 'actual',
      cacheStatus: 'miss',
      metadata: {
        methodVersion: record.methodVersion,
        temperature: record.temperature,
        outcome: record.outcome,
        promptTokens: record.usage.promptTokens,
        completionTokens: record.usage.completionTokens,
      },
      supersedesCostEventId: null,
    },
    db,
  );
}
