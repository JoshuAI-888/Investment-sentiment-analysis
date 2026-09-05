/**
 * The registration point (`registry.ts`'s own doc). Importing this module for its side effects
 * is what makes every seeded `job_key` dispatchable — `app/api/cron/dispatch/route.ts` imports
 * it once, at module load, before any request is handled.
 *
 * **Adding a job is exactly one line here, never a change to `registry.ts` or `service.ts`.**
 * `substack.collect` (F04's Substack collector, `services/substack/collector.ts`, already
 * merged) is seeded as a disabled `job_definition` row by `scripts/seed-job-definitions.ts` but
 * deliberately has **no** handler registered below yet — it is the next one to land, and this
 * file is exactly where that registration goes:
 *
 * ```ts
 * import { substackCollectHandler } from './substack';
 * registerJobHandler('substack.collect', substackCollectHandler);
 * ```
 */
import { registerJobHandler } from '../registry';
import { attentionSnapshotHandler, ATTENTION_SNAPSHOT_JOB_KEY } from './attention';
import { marketDataPollHandler, MARKET_DATA_POLL_JOB_KEY } from './market-data';

let registered = false;

/**
 * Idempotent on purpose — `registerJobHandler` throws on a duplicate `job_key`, and Next.js can
 * re-evaluate a route module more than once per process in dev/test. Every real call site
 * (the dispatch route, every test that needs real handlers registered) calls this instead of
 * importing the module for side effects directly, so "registered twice in one process" is never
 * a surprise.
 */
export function registerAllJobHandlers(): void {
  if (registered) return;
  registerJobHandler(ATTENTION_SNAPSHOT_JOB_KEY, attentionSnapshotHandler);
  registerJobHandler(MARKET_DATA_POLL_JOB_KEY, marketDataPollHandler);
  registered = true;
}
