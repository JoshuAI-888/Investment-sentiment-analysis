/**
 * The registration point (`registry.ts`'s own doc). Importing this module for its side effects
 * is what makes every seeded `job_key` dispatchable — `app/api/cron/dispatch/route.ts` imports
 * it once, at module load, before any request is handled.
 *
 * **Adding a job is exactly one line here, never a change to `registry.ts` or `service.ts`.**
 *
 * `substack.collect` landed exactly that way, and its seed row is now `enabled: true` in the
 * same change — the sequencing that row's own `notes` field asked for, so the job never spends a
 * tick enabled-with-no-handler (a loud, misleading `no_handler_registered` failure every hour).
 * It is the job that starts D-16's forward-only clock.
 */
import { registerJobHandler } from '../registry';
import { attentionSnapshotHandler, ATTENTION_SNAPSHOT_JOB_KEY } from './attention';
import { marketDataPollHandler, MARKET_DATA_POLL_JOB_KEY } from './market-data';
import { substackCollectHandler, SUBSTACK_COLLECT_JOB_KEY } from './substack';
import { attentionBoardHandler, ATTENTION_BOARD_JOB_KEY } from './attention-board';

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
  registerJobHandler(SUBSTACK_COLLECT_JOB_KEY, substackCollectHandler);
  registerJobHandler(ATTENTION_BOARD_JOB_KEY, attentionBoardHandler);
  registered = true;
}
