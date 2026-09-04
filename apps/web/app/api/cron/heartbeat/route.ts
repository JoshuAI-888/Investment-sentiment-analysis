import { NextResponse } from 'next/server';
import { env } from '@/env';
import { checkDispatchHeartbeat } from '@/services/jobs/heartbeat';

/**
 * `GET /api/cron/heartbeat` — F16 §4.5. Driven by a **daily Vercel Cron** entry in `vercel.json`
 * (ADR-013: the admin can never create, edit or write this file — see that file's own comment).
 *
 * **This route never dispatches anything.** It imports `checkDispatchHeartbeat`
 * (`services/jobs/heartbeat.ts`) and nothing from `services/jobs/dispatch.ts` or `job-service.ts`
 * — there is no code path in this file's dependency graph that can start, claim or execute a
 * job, which is what makes "it must not be able to run jobs" (§4.5) a property of the import
 * graph, not merely something this handler happens not to call today.
 *
 * **Auth is best-effort, disclosed as such rather than claimed as real.** Vercel's own
 * `Authorization: Bearer $CRON_SECRET` auto-injection for `vercel.json` crons only fires for an
 * environment variable literally named `CRON_SECRET`; this project's env var is
 * `INTERNAL_DISPATCH_SECRET` (`docs/DEPLOY.md` MT-04), so Vercel's own Cron invocations will
 * **not** carry a matching header. This check therefore *validates* a bearer token when one is
 * presented (so a manual/curl invocation can be authenticated) but does not *require* one — a
 * hard requirement would make Vercel's own daily invocation reject itself. See this feature's
 * report for the honest statement of what this route's auth does and does not guarantee.
 */
export async function GET(request: Request) {
  const configuredSecret = env.INTERNAL_DISPATCH_SECRET;
  const authorization = request.headers.get('authorization');
  if (configuredSecret !== undefined && authorization !== null) {
    const expected = `Bearer ${configuredSecret}`;
    if (authorization !== expected) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const check = await checkDispatchHeartbeat();

  if (check.stale) {
    // The alerting channel this route has in Wave 1: Vercel's own function logs. F18 is where a
    // real notification path would replace this.
    console.error(`[F16 heartbeat] dispatch is stale: ${check.message}`);
  }

  return NextResponse.json(check, { status: check.stale ? 503 : 200 });
}
