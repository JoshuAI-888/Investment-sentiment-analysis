/**
 * Turns the two real, already-built collectors (`services/market/collector.ts`'s
 * `collectMarketSnapshots`, `services/attention/collector.ts`'s `collectAttentionSnapshots`) into
 * `JobRunOutcome` shapes `job-service.ts#JobService.execute` can hand to `finishJobRun`, and — for
 * `market_data_poll` only — runs the trigger pass (`trigger.ts`) as part of the same execution.
 *
 * Reddit is deliberately absent from this dispatch table. D-39 (`docs/MEMORY.md`) records that
 * the legacy product discarded Reddit-Data-API sourcing entirely — RNI is what replaced it — so
 * there is no `reddit_poll` job for Wave 1 to seed or dispatch. Substack is absent for a
 * different reason: no Substack collector *service* module exists yet to call (F04's adapter —
 * `adapters/substack.ts` — is merged, but nothing persists a poll of it into `raw_provider_
 * payload`/a normalized snapshot the way `services/market/collector.ts` and
 * `services/attention/collector.ts` do). Both gaps are reported, not silently worked around — see
 * this feature's final report.
 */
import type { JobDefinition } from '@/contracts/operations';
import type { JobRunOutcome } from '@/repositories/jobs';
import { collectMarketSnapshots, type CollectMarketSnapshotsOutcome } from '@/services/market/collector';
import { collectAttentionSnapshots } from '@/services/attention/collector';
import type { Queryable } from '@/repositories/client';
import { runTriggerPass, type TriggerDispatchRequest } from './trigger';

export const MARKET_DATA_POLL_JOB_KEY = 'market_data_poll';
export const ATTENTION_POLL_JOB_KEY = 'attention_poll';

export type CollectorRunResult = {
  readonly outcome: JobRunOutcome;
  /** Non-empty only when a fired spike passed every check (budget, eligibility) this run — see `trigger.ts`. Always empty under D-32's zero ceiling. */
  readonly triggerDispatchRequests: readonly TriggerDispatchRequest[];
};

function marketOutcomeStatus(outcome: CollectMarketSnapshotsOutcome): JobRunOutcome['status'] {
  if (outcome.failures.length === 0) return 'succeeded';
  if (outcome.results.length === 0) return 'failed';
  return 'degraded';
}

export async function runMarketDataPoll(
  job: JobDefinition,
  db: Queryable,
  now: Date,
): Promise<CollectorRunResult> {
  const pollOutcome = await collectMarketSnapshots({ db, now });

  // Captured fresh, *after* every `insertMarketSnapshot` call above has completed and stamped
  // its own `ingestedAt` — never the poll's own `now`, which can predate those writes and make
  // `marketSnapshotHistory`'s as-of read (`trigger.ts#evaluateMarketSpike`) miss the very
  // observation this tick just wrote. See `trigger.ts`'s module doc.
  const triggerPass = await runTriggerPass(pollOutcome, job, { db });

  const outcome: JobRunOutcome = {
    status: marketOutcomeStatus(pollOutcome),
    completedAt: new Date(),
    itemsRead: pollOutcome.results.length + pollOutcome.failures.length,
    itemsWritten: pollOutcome.results.filter((r) => r.inserted).length,
    providerCalls: pollOutcome.results.length + pollOutcome.failures.length,
    estimatedCostUsd: '0',
    dataAsOf: new Date(pollOutcome.collectedAt),
    metrics: {
      failures: pollOutcome.failures.map((f) => ({ symbol: f.symbol, reason: f.reason, message: f.message })),
      spikeVerdicts: triggerPass.verdicts,
    },
  };

  return { outcome, triggerDispatchRequests: triggerPass.dispatchRequests };
}

export async function runAttentionPoll(db: Queryable, now: Date): Promise<CollectorRunResult> {
  const result = await collectAttentionSnapshots({ db, now });

  if (!result.ok) {
    return {
      outcome: {
        status: 'failed',
        completedAt: new Date(),
        itemsRead: 0,
        itemsWritten: 0,
        providerCalls: 1,
        estimatedCostUsd: '0',
        error: { kind: result.error.kind, message: result.message },
      },
      triggerDispatchRequests: [],
    };
  }

  const outcome: JobRunOutcome = {
    status: result.malformedEntries.length === 0 && result.unmatchedTickers.length === 0 ? 'succeeded' : 'degraded',
    completedAt: new Date(),
    itemsRead: result.results.length + result.unmatchedTickers.length + result.malformedEntries.length,
    itemsWritten: result.results.filter((r) => r.inserted).length,
    providerCalls: 1,
    estimatedCostUsd: '0',
    dataAsOf: new Date(result.observedAt),
    metrics: {
      unmatchedTickers: result.unmatchedTickers,
      malformedEntries: result.malformedEntries,
    },
  };

  return { outcome, triggerDispatchRequests: [] };
}
