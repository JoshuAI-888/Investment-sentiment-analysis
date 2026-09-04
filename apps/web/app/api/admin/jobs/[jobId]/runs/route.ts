import { NextResponse } from 'next/server';
import { requireAdmin, UnauthenticatedError, UnauthorizedError, PasswordChangeRequiredError } from '@/services/auth';

/** F02 §4.4: `requireAdmin()` called in this route handler's own body. Fixture state until F16b (SURFACE) lands beyond auth (F01 §4.6). */
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

  return NextResponse.json({
    state: 'fixture',
    route: `/api/admin/jobs/${jobId}/runs`,
    owner: 'F16b (SURFACE)',
    data: null,
  });
}
