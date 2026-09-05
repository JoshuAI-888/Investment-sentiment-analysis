/**
 * `attention.snapshot` — wraps F08's existing collector (`services/attention/collector.ts`) in
 * the `JobHandler` shape `JobService` calls (F16 §4.1 step 5). No collection logic lives here;
 * this file only translates between the collector's own outcome shape and `job_run`'s columns,
 * and implements F16 §4.4's dry run (zero external calls) before any real work happens.
 */
import { collectAttentionSnapshots } from '@/services/attention/collector';
import type { JobHandler } from '../registry';

export const ATTENTION_SNAPSHOT_JOB_KEY = 'attention.snapshot';

export const attentionSnapshotHandler: JobHandler = async (ctx) => {
  if (ctx.dryRun) {
    return {
      status: 'succeeded',
      dryRunSummary: {
        willCall: ['ApeWisdom ranking board (fetchApeWisdomRanking)'],
        estimatedCostUsd: '0',
        message:
          'Would poll ApeWisdom for the current attention board and persist one attention_snapshot ' +
          'per matched active security. ApeWisdom is free and keyless — this run would cost $0.',
      },
    };
  }

  const outcome = await collectAttentionSnapshots({ db: ctx.db, now: ctx.now });

  if (!outcome.ok) {
    return {
      status: 'failed',
      providerCalls: 1,
      estimatedCostUsd: '0',
      error: { kind: outcome.error.kind, message: outcome.message },
    };
  }

  const insertedCount = outcome.results.filter((result) => result.inserted).length;
  return {
    // A provider contact with nothing usable to show for it is degraded, not a hard failure —
    // matching `services/attention/pipeline.ts`'s own `degraded` distinction for this collector.
    status: outcome.results.length > 0 ? 'succeeded' : 'degraded',
    itemsRead: outcome.results.length + outcome.unmatchedTickers.length + outcome.malformedEntries.length,
    itemsWritten: insertedCount,
    providerCalls: 1,
    estimatedCostUsd: '0',
    dataAsOf: new Date(outcome.observedAt),
    metrics: {
      matched: outcome.results.length,
      inserted: insertedCount,
      unmatchedTickers: outcome.unmatchedTickers.length,
      malformedEntries: outcome.malformedEntries.length,
    },
  };
};
