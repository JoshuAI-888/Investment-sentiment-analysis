import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { z } from 'zod';
import { requireUser, UnauthenticatedError, PasswordChangeRequiredError } from '@/services/auth';
import { createQueuedResearchRun, executeResearchRun } from '@/services/research/run-service';

/**
 * F11 §2/§4.1 — `POST /api/research`. Creates the run and responds immediately (Tier A1: "first
 * progress event < 1 s") with the `queued` run row; the state machine itself runs via `after()`,
 * outside the response but inside the same function invocation (`maxDuration` below covers F11
 * §4.2's 30 s hard cap) — see `services/research/run-service.ts`'s module docstring for why this
 * shape rather than a background job (F16 is not built).
 *
 * A client opens `GET /api/research/:runId/stream` immediately after this responds to watch
 * progress; `GET /api/research/:runId` reads the current/final state at any time, including after
 * a reload.
 */
export const maxDuration = 30;

const requestBody = z.object({
  securityId: z.string().uuid(),
  question: z.string().min(1).max(2000),
});

export async function POST(request: Request) {
  let session;
  try {
    session = await requireUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof PasswordChangeRequiredError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    throw error;
  }

  const json: unknown = await request.json().catch(() => null);
  const parsed = requestBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', issues: parsed.error.issues }, { status: 400 });
  }

  let created;
  try {
    created = await createQueuedResearchRun({
      userId: session.userId,
      securityId: parsed.data.securityId,
      question: parsed.data.question,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json({ error: 'security_not_found' }, { status: 404 });
    }
    throw error;
  }

  const { run, security } = created;
  after(async () => {
    await executeResearchRun(run, security, {
      userId: session.userId,
      securityId: parsed.data.securityId,
      question: parsed.data.question,
    });
  });

  return NextResponse.json({ run }, { status: 202 });
}
