import { NextResponse } from 'next/server';
import { env } from '@/env';
import { checkDispatchHeartbeat } from '@/services/jobs/heartbeat';

/**
 * F16 §4.5 (D-16) — the daily Vercel Cron heartbeat. "One deployment-managed daily Vercel Cron
 * that checks the last successful dispatch and alerts if it is stale. It is a failsafe alert
 * only, never the primary scheduler, and it must not be able to run jobs."
 *
 * **Structurally cannot execute a job.** This route imports exactly one function
 * (`checkDispatchHeartbeat`), which itself imports only a read-only repository query — see
 * `services/jobs/heartbeat.ts`'s own doc. There is no code path from this file that reaches
 * `JobService.execute`, the handler registry, or any provider adapter.
 *
 * **Auth.** `vercel.json`'s own `crons` entry is the only thing configured to call this route on
 * a schedule. Unlike `/api/cron/dispatch`, QStash's signature scheme does not apply here (Vercel
 * Cron, not QStash, calls this URL) — gated instead on the same `INTERNAL_DISPATCH_SECRET`
 * `src/env.ts` already reserves for this feature (F01 §4.2's "Scheduling (F16a)" block), checked
 * only when it is actually configured; a deployment that has not set it yet is not blocked from
 * seeing its own heartbeat. Reported under this feature's `RISKS`/`DECISIONS` — the spec names
 * an auth scheme for the *dispatch* route only, not this one, so this is a judgement call.
 *
 * **The alert itself, for Wave 1.** A stale heartbeat responds `503` and logs at `error` level.
 * There is no paging/email channel wired to this yet (F18/an ops-tooling gap, not this feature's
 * to invent) — a `503` is what makes a stale dispatcher visible in Vercel's own Cron dashboard
 * (failed invocations are shown there) without this feature reaching for a notification channel
 * it does not own.
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (env.INTERNAL_DISPATCH_SECRET !== undefined) {
    const provided = request.headers.get('x-internal-dispatch-secret');
    if (provided !== env.INTERNAL_DISPATCH_SECRET) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const result = await checkDispatchHeartbeat();

  if (result.stale) {
    console.error('[heartbeat] dispatch is stale', result);
    return NextResponse.json({ status: 'stale', ...result }, { status: 503 });
  }

  return NextResponse.json({ status: 'healthy', ...result });
}
