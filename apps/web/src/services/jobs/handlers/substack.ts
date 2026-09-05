/**
 * `substack.collect` — wraps F04's Substack collector (`services/substack/collector.ts`) in the
 * `JobHandler` shape `JobService` calls (F16 §4.1 step 5). No collection logic lives here; this
 * file translates between the collector's outcome and `job_run`'s columns, and implements
 * F16 §4.4's dry run.
 *
 * **This is the job that starts D-16's forward-only clock.** Substack needs no API key and no
 * approval, so it is the one axis that can collect today while Reddit waits on MT-13.
 *
 * **Scoring is deferred, deliberately and visibly.** F20's durable queue does not exist yet
 * (`MEMORY.md` B-31 §4), so this handler passes `deferredScoringQueue()` — see that file for why
 * the backlog stays recoverable. The count that *would* have been queued is reported as
 * `pendingScoring` in `job_run.metrics` on every run, so the size of the deferred backlog is a
 * number an operator can read off the job history rather than something they have to infer.
 */
import { collectSubstackEvidence } from '@/services/substack/collector';
import { getSubstackPublications } from '@/adapters/substack-publications';
import { deferredScoringQueue } from '../deferred-queue';
import type { JobHandler } from '../registry';

export const SUBSTACK_COLLECT_JOB_KEY = 'substack.collect';

export const substackCollectHandler: JobHandler = async (ctx) => {
  if (ctx.dryRun) {
    const publications = await getSubstackPublications();
    return {
      status: 'succeeded',
      dryRunSummary: {
        willCall: publications.map((publication) => `https://${publication.slug}.substack.com/feed`),
        estimatedCostUsd: '0',
        message:
          `Would poll ${publications.length} Substack RSS feed(s) (MT-15's confirmed set), attribute ` +
          'each entry to securities with F10\'s no-LLM pass, write evidence_item rows and record one ' +
          'collector_heartbeat for the substack axis. Substack RSS is free and keyless — this run ' +
          'would cost $0. Scoring is deferred: no durable queue exists yet, so collected items are ' +
          'written but not queued.',
      },
    };
  }

  const outcome = await collectSubstackEvidence({
    db: ctx.db,
    queue: deferredScoringQueue(),
    now: ctx.now,
  });

  if (!outcome.ok) {
    // Every publication failed: the axis genuinely went dark, and the collector deliberately
    // wrote no heartbeat so F22's gap detection finds the hole on its own. That is a failed run,
    // not a degraded one — nothing was collected and nothing can be vouched for.
    return {
      status: 'failed',
      providerCalls: outcome.failedPublications.length,
      estimatedCostUsd: '0',
      error: {
        kind: 'total_outage',
        message: outcome.message,
        failedPublications: outcome.failedPublications.map((failed) => failed.slug),
      },
    };
  }

  const attributed = outcome.rows.filter((row) => row.securityId !== null).length;
  const publicationCount = (await getSubstackPublications()).length;

  return {
    // A partial failure is `degraded`, not `failed`: the heartbeat was written and the items that
    // were collected are real. A clean run with nothing published is `succeeded` — a quiet window
    // is not a fault, and treating it as one would train an operator to ignore this job.
    status: outcome.failedPublications.length > 0 ? 'degraded' : 'succeeded',
    itemsRead: outcome.entriesSeen,
    itemsWritten: outcome.rows.length,
    providerCalls: publicationCount,
    estimatedCostUsd: '0',
    dataAsOf: new Date(outcome.observedAt),
    metrics: {
      entriesSeen: outcome.entriesSeen,
      rowsWritten: outcome.rows.length,
      attributed,
      // Written with `security_id: null` — permanent corpus under D-17, resolvable later by
      // `entity.collision_guard` rather than discarded at the cheapest stage of the pipeline.
      unattributed: outcome.rows.length - attributed,
      // The deferred-scoring backlog this run added. See `deferred-queue.ts`.
      pendingScoring: outcome.enqueuedCount,
      failedPublications: outcome.failedPublications.map((failed) => failed.slug),
      heartbeatWritten: outcome.heartbeatWritten,
    },
  };
};
