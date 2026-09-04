import { NextResponse } from 'next/server';
import {
  requireAdmin,
  UnauthenticatedError,
  UnauthorizedError,
  PasswordChangeRequiredError,
} from '@/services/auth';
import { getJobsView } from '@/services/admin/reads';

/** F16 §4.2/§4.4 (F16b) — every `job_definition` row, read side. */
export async function GET() {
  try {
    await requireAdmin();
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

  const jobs = await getJobsView();
  return NextResponse.json({ state: 'ready', route: '/api/admin/jobs', jobs });
}
