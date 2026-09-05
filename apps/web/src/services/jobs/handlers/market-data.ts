/**
 * `market-data.poll` — F16 §4.1b step 1: "an ordinary clock job... the only part of this loop
 * that runs unconditionally, and it is free." Wraps F04's existing collector
 * (`services/market/collector.ts`) for persistence, then runs the price trigger
 * (`services/jobs/trigger.ts`) once per security using the exact bar series the collector's own
 * `onBarsFetched` hook hands back — no second provider call for data already fetched this tick.
 *
 * **Never gated by budget (D-15 binding rule).** Nothing in this handler checks any budget or
 * ceiling before persisting a snapshot — only the *trigger* evaluation inside it (a downstream,
 * per-security, post-persistence step) ever consults the X ceilings, and only after a spike
 * verdict already fired. A budget exhausted for X reads has no effect on whether this poll runs
 * or persists.
 */
import type { DailyBar } from '@/adapters/market';
import { collectMarketSnapshots } from '@/services/market/collector';
import { evaluateMarketDataTrigger, type TriggerEvaluationOutcome } from '../trigger';
import type { JobHandler } from '../registry';

export const MARKET_DATA_POLL_JOB_KEY = 'market-data.poll';

export const marketDataPollHandler: JobHandler = async (ctx) => {
  if (ctx.dryRun) {
    return {
      status: 'succeeded',
      dryRunSummary: {
        willCall: ['FMP historical-price-full (fetchDailyBars), once per active security'],
        estimatedCostUsd: '0',
        message:
          'Would poll FMP daily bars for every active security, persist the newest usable close ' +
          'as a market_snapshot, and evaluate the price.regime spike trigger for each — flat-rate ' +
          'subscription, $0 marginal cost regardless of universe size.',
      },
    };
  }

  const barsBySecurity = new Map<string, { readonly symbol: string; readonly bars: readonly DailyBar[] }>();
  const collected = await collectMarketSnapshots({
    db: ctx.db,
    now: ctx.now,
    onBarsFetched: (security, bars) => {
      barsBySecurity.set(security.id, { symbol: security.symbol, bars });
    },
  });

  const triggerOutcomes: TriggerEvaluationOutcome[] = [];
  for (const [securityId, { symbol, bars }] of barsBySecurity) {
    if (bars.length === 0) continue; // a provider failure recorded its own `failures` entry already
    const result = await evaluateMarketDataTrigger({
      securityId,
      symbol,
      bars,
      configVersion: ctx.jobDefinition.configVersion,
      asOf: ctx.now,
      db: ctx.db,
      now: ctx.now,
      pollDueAt: ctx.dueAt,
      dispatchTriggeredJob: ctx.dispatchTriggeredJob,
    });
    triggerOutcomes.push(result);
  }

  const firedCount = triggerOutcomes.filter((evaluation) => evaluation.verdict.fired).length;
  const refusedCount = triggerOutcomes.filter((evaluation) => evaluation.coverageGapRecorded).length;

  return {
    // The collector's own per-security isolation means an individual failure is expected and
    // handled, not a run failure — only "nothing at all was persisted, and something failed"
    // reads as degraded, matching `attentionSnapshotHandler`'s identical convention.
    status: collected.results.length === 0 && collected.failures.length > 0 ? 'degraded' : 'succeeded',
    itemsWritten: collected.results.length,
    providerCalls: collected.results.length + collected.failures.length,
    estimatedCostUsd: '0',
    dataAsOf: ctx.now,
    metrics: {
      persisted: collected.results.length,
      failures: collected.failures.length,
      triggerEvaluations: triggerOutcomes.length,
      triggersFired: firedCount,
      triggersRefused: refusedCount,
    },
  };
};
