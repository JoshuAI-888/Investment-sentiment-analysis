import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, UnauthenticatedError, UnauthorizedError } from '@/services/auth';
import { createRetractionDeps } from '@/services/research/composition';
import { retractRun } from '@/services/research/retraction';
import { RetractionError } from '@/services/research/ports';
import { researchRunStatus } from '@/contracts/research';

/**
 * F11 §4.8 / F-20 — the operator entry point retraction had no route for at all before this fix
 * (lane-review finding 8). `02-ARCHITECTURE-CONTRACTS.md` §8's four requirements, each traceable
 * to one line here or in `retraction.ts`: **authorization** is `requireAdmin()` (retraction is
 * an operator action — spec §4.8: "an operator can mark a run retracted"); **validation** is the
 * zod body schema; the **optimistic-concurrency check** and the **`audit_event` write** both live
 * in `retraction.ts` itself, which this route calls rather than reimplementing.
 */
const requestBody = z.object({
  reason: z.string().min(1),
  expectedStatus: researchRunStatus,
});

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  let session;
  try {
    session = await requireAdmin();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    throw error;
  }

  const parsed = requestBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', issues: parsed.error.issues }, { status: 400 });
  }

  const { runId } = await params;
  const { repo, clock, audit } = createRetractionDeps();

  try {
    const run = await retractRun(repo, clock, audit, {
      runId,
      reason: parsed.data.reason,
      actor: session.userId,
      expectedStatus: parsed.data.expectedStatus,
    });
    return NextResponse.json({ run });
  } catch (error) {
    if (error instanceof RetractionError) {
      return NextResponse.json({ error: 'retraction_refused', message: error.message }, { status: 409 });
    }
    throw error;
  }
}
