/**
 * Turns the three real, already-built collectors (`services/market/collector.ts`'s
 * `collectMarketSnapshots`, `services/attention/collector.ts`'s `collectAttentionSnapshots`,
 * `services/collect/substack-collector.ts`'s `collectSubstackItems`) into `JobRunOutcome` shapes
 * `job-service.ts#JobService.execute` can hand to `finishJobRun`, and — for `market_data_poll`
 * only — runs the trigger pass (`trigger.ts`) as part of the same execution.
 *
 * Reddit is deliberately absent from this dispatch table. D-39 (`docs/MEMORY.md`) records that
 * the legacy product discarded Reddit-Data-API sourcing entirely — RNI is what replaced it — so
 * there is no `reddit_poll` job for Wave 1 to seed or dispatch.
 *
 * **Substack now has a real bridge function (`runSubstackPoll`), but it is not yet reachable
 * through `JobService.execute`.** `job-service.ts`'s `DISPATCH_TABLE` is the one place a job key
 * is actually wired to a handler, and that file is on this lane's do-not-edit list (its own build
 * brief names it explicitly, alongside `dispatch.ts`/`trigger.ts`/etc., as F16a-merged and not to
 * be restructured by a later slice). Registering `SUBSTACK_POLL_JOB_KEY` there — one line,
 * `[SUBSTACK_POLL_JOB_KEY]: (_job, db, now) => runSubstackPoll(db, now),`, exactly the same shape
 * as `ATTENTION_POLL_JOB_KEY`'s own entry — is a real, small, disclosed gap for the coordinator (or
 * whoever owns `job-service.ts`) to close; see this feature's report. Until that one line lands,
 * `substack_poll` can be seeded (this feature's migration does that) and `collectSubstackItems`
 * can be run directly or by a script, but `executeJob` will reject it with "no dispatch handler
 * registered for job_key 'substack_poll'" — the same failure mode `executeJob`'s own code already
 * names for any job key with no `DISPATCH_TABLE` entry.
 */
import type { JobDefinition } from '@/contracts/operations';
import type { JobRunOutcome } from '@/repositories/jobs';
import { collectMarketSnapshots, type CollectMarketSnapshotsOutcome } from '@/services/market/collector';
import { collectAttentionSnapshots } from '@/services/attention/collector';
import { collectSubstackItems } from '@/services/collect/substack-collector';
import { SUBSTACK_PUBLICATIONS } from '@/services/collect/substack-publications';
import type { Queryable } from '@/repositories/client';
import { runTriggerPass, type TriggerDispatchRequest } from './trigger';

export const MARKET_DATA_POLL_JOB_KEY = 'market_data_poll';
export const ATTENTION_POLL_JOB_KEY = 'attention_poll';
export const SUBSTACK_POLL_JOB_KEY = 'substack_poll';

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

/**
 * The Substack bridge, following `runAttentionPoll`'s exact shape: no trigger pass (Substack is
 * not D-15's trigger axis), never priced (`estimatedCostUsd: '0'`, matching the other two —
 * `adapters/substack.ts`'s own doc: RSS is a flat, free poll), and a `degraded` status whenever
 * anything short of a clean sweep happened, rather than `failed` — a partial success (some
 * publications wrote items, one or more others failed) is not the same outcome as every
 * publication failing, and collapsing the two would hide a real degraded-but-working state behind
 * an alarm that overstates it (`docs/04-BUILD-LOOP.md` §5's "does the failure path show a real
 * degraded state, or a plausible-looking empty one?").
 */
export async function runSubstackPoll(db: Queryable, now: Date): Promise<CollectorRunResult> {
  // No `publications` override — this is the real, dispatched job, always polling the full
  // disclosed MT-15/D-29 set (`SUBSTACK_PUBLICATIONS`), so `SUBSTACK_PUBLICATIONS.length` is
  // exactly how many feed calls this run attempts, one per configured publication, regardless of
  // how many items or failures each one produces.
  const pollOutcome = await collectSubstackItems({ db, now });

  // `failed` only when every configured publication's own feed call failed outright — a partial
  // success (some publications wrote items, one or more others failed) is a real degraded-but-
  // working state, not the same outcome as a clean sweep of failures, and collapsing the two would
  // hide that from an operator (`docs/04-BUILD-LOOP.md` §5: "does the failure path show a real
  // degraded state, or a plausible-looking empty one?").
  const status: JobRunOutcome['status'] =
    pollOutcome.failures.length === 0
      ? 'succeeded'
      : pollOutcome.failures.length === SUBSTACK_PUBLICATIONS.length
        ? 'failed'
        : 'degraded';

  const outcome: JobRunOutcome = {
    status,
    completedAt: new Date(),
    itemsRead: pollOutcome.results.length + pollOutcome.skippedEntries.length,
    itemsWritten: pollOutcome.results.filter((r) => r.inserted).length,
    providerCalls: SUBSTACK_PUBLICATIONS.length,
    estimatedCostUsd: '0',
    dataAsOf: new Date(pollOutcome.collectedAt),
    metrics: {
      failures: pollOutcome.failures.map((f) => ({
        publicationSlug: f.publicationSlug,
        sector: f.sector,
        reason: f.reason,
        message: f.message,
      })),
      skippedEntries: pollOutcome.skippedEntries,
    },
  };

  return { outcome, triggerDispatchRequests: [] };
}
