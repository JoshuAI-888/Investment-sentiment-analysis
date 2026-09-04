import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, UnauthenticatedError, UnauthorizedError, PasswordChangeRequiredError } from '@/services/auth';
import { retractResearchRun, RunNotRetractableError } from '@/services/research/run-service';

/**
 * F11 §4.8 / F-20 — `POST /api/research/:runId/retract`. Operator-only (`requireAdmin`, F02 §4.4
 * — checked in this handler's own body). "Identify" is the operator naming a `runId` they already
 * found; "retract"/"record" happen atomically in `repositories/research.ts#retractResearchRun`
 * (the status update and the `audit_event` write share one transaction); "notify" is every other
 * render surface reading the now-`retracted` status the moment it next reads this run — there is
 * no separate notification channel to build for that, the row itself is the notification.
 */
const requestBody = z.object({ reason: z.string().min(1).max(2000) });

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  let session;
  try {
    session = await requireAdmin();
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof UnauthorizedError || error instanceof PasswordChangeRequiredError) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    throw error;
  }

  const { runId } = await params;
  const json: unknown = await request.json().catch(() => null);
  const parsed = requestBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const run = await retractResearchRun({ runId, reason: parsed.data.reason, actorId: session.userId });
    return NextResponse.json({ run });
  } catch (error) {
    if (error instanceof RunNotRetractableError) {
      return NextResponse.json({ error: 'not_retractable', message: error.message }, { status: 409 });
    }
    throw error;
  }
}
