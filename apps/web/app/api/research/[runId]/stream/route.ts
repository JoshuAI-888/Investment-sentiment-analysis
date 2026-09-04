import { NextResponse } from 'next/server';
import { PasswordChangeRequiredError, requireUser, UnauthenticatedError } from '@/services/auth';
import { researchRepository } from '@/services/research/composition';
import { replayStreamEvents, toSseFrame } from '@/services/research/stream-events';

/**
 * The reload path. `POST /api/research` streams a run live within its own request; this route
 * replays a run's **persisted** events instead — the same events, read back, which is what
 * makes "a run survives reload" true even though there is no background job keeping it running
 * between requests (F16a is Wave 4+; see `composition.ts`'s docstring for the honest accounting
 * of what is and is not wired yet). It never re-runs anything and never re-spends.
 *
 * **Ownership check (lane-review finding 1)**, mirrored from `../route.ts`: a run's events are
 * exactly the material `GET .../:runId` protects, so replaying them needs the identical guard —
 * `404`, not `403`, on a run that exists but is not the caller's own.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  let session;
  try {
    session = await requireUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof PasswordChangeRequiredError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    throw error;
  }

  const { runId } = await params;
  const repo = researchRepository();
  const run = await repo.getRun(runId);
  if (run === null || run.userId !== session.userId) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const events = await repo.listEvents(runId);
  const replayed = replayStreamEvents(events);
  const body = replayed.map(toSseFrame).join('');

  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
    },
  });
}
