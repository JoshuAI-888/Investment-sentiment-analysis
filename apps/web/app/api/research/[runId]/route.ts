import { NextResponse } from 'next/server';
import { PasswordChangeRequiredError, requireUser, UnauthenticatedError } from '@/services/auth';
import { researchRepository } from '@/services/research/composition';

/**
 * A point-in-time snapshot of a run — what a page reload reads (F11 §4.1: "a run survives
 * reload because the events are the source of truth, not the stream"). No prose is ever present
 * here unless `run.status === 'complete'`; every other status's `result.prose` is `null` by
 * construction (`orchestrator.ts`'s module doc traces every branch).
 *
 * **Ownership check (lane-review finding 1).** `requireUser()` proves *who* is asking, not that
 * they may see *this* run — a run's question text, prose and claim ledger are exactly the
 * material a user asked about themselves, and nothing here scoped the read to the caller before
 * this fix. A mismatch answers `404`, not `403`: a `403` would confirm the run id exists at all,
 * which is itself information a caller with no claim to the run should not get for free.
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

  const claims = await repo.listClaims(runId);
  return NextResponse.json({ run, claims });
}
