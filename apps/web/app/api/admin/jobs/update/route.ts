import { NextResponse } from 'next/server';
import {
  requireAdmin,
  UnauthenticatedError,
  UnauthorizedError,
  PasswordChangeRequiredError,
} from '@/services/auth';
import { runAdminMutation } from '@/services/admin/mutation';
import { updateJobMutation } from '@/services/admin/jobs';
import { mutationResponse } from '@/services/admin/http';

/**
 * F16 §4.2 — editable: due times, cadence, enabled state, retry policy, per-job budget ceiling.
 * Never the QStash schedule, `vercel.json`, or the dispatch secret (ADR-013) — see
 * `services/admin/jobs.ts`'s module doc and `tests/unit/services/jobs/adr-013-invariants.test.ts`.
 */
export async function POST(request: Request) {
  let session;
  try {
    session = await requireAdmin();
  } catch (error) {
    if (
      error instanceof UnauthenticatedError ||
      error instanceof UnauthorizedError ||
      error instanceof PasswordChangeRequiredError
    ) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    throw error;
  }

  const body = await request.json().catch(() => null);
  if (body === null) return NextResponse.json({ status: 'invalid', issues: ['body must be JSON'] }, { status: 400 });

  const outcome = await runAdminMutation(updateJobMutation, body, session);
  return mutationResponse(outcome);
}
