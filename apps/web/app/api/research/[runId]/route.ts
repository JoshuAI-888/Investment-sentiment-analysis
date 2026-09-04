import { NextResponse } from 'next/server';
import { requireUser, UnauthenticatedError, PasswordChangeRequiredError } from '@/services/auth';
import { reloadResearchRun } from '@/services/research/run-service';

/**
 * F11 §4.1 — `GET /api/research/:runId`. Reads current (possibly still in-flight) state straight
 * off `research_run` + `research_event` + `claim_ledger` — "a run survives reload because the
 * events are the source of truth, not the stream." Never renders prose for a run whose `status`
 * is not `complete` — `run.result.prose` is already `null` at write time for every other status
 * (`run-service.ts#outcomeToPersisted`), so this is a defensive second gate, not the only one.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    await requireUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof PasswordChangeRequiredError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    throw error;
  }

  const { runId } = await params;
  const reloaded = await reloadResearchRun(runId);
  if (reloaded === null) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { run, events, claims } = reloaded;

  // Defence in depth (F11 §6 DoD: "unverified prose can reach a user by no code path") — even
  // though `run.result` is already written with `prose: null` for every non-`complete` status.
  const safeResult =
    run.status === 'complete'
      ? run.result
      : (run.result as { readonly prose?: unknown } | null) === null
        ? null
        : { ...(run.result as Record<string, unknown>), prose: null };

  return NextResponse.json({
    run: { ...run, result: safeResult },
    events: events.map((event) => ({ sequence: event.sequence, eventType: event.eventType, label: event.label, createdAt: event.createdAt })),
    claims,
  });
}
