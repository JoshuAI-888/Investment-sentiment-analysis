import { NextResponse } from 'next/server';
import { requireAdmin, UnauthenticatedError, UnauthorizedError, PasswordChangeRequiredError } from '@/services/auth';
import { getJobRunHistoryView } from '@/services/admin/reads';

/** F16 §4.4 (F16b) — one job's recent run history, dry runs included. */
export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;

  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof UnauthorizedError || error instanceof PasswordChangeRequiredError) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    throw error;
  }

  const runs = await getJobRunHistoryView({ jobId, limit: 25 });
  return NextResponse.json({ state: 'ready', route: `/api/admin/jobs/${jobId}/runs`, runs });
}
