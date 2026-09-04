import { NextResponse } from 'next/server';
import { PasswordChangeRequiredError, requireUser, UnauthenticatedError } from '@/services/auth';
import { researchRepository } from '@/services/research/composition';

/**
 * A point-in-time snapshot of a run — what a page reload reads (F11 §4.1: "a run survives
 * reload because the events are the source of truth, not the stream"). No prose is ever present
 * here unless `run.status === 'complete'`; every other status's `result.prose` is `null` by
 * construction (`orchestrator.ts`'s module doc traces every branch).
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
  const repo = researchRepository();
  const run = await repo.getRun(runId);
  if (run === null) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const claims = await repo.listClaims(runId);
  return NextResponse.json({ run, claims });
}
