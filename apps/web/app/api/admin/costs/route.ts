import { NextResponse } from 'next/server';
import { requireAdmin, UnauthenticatedError, UnauthorizedError } from '@/services/auth';

/** F02 §4.4: `requireAdmin()` called in this route handler's own body. Fixture state until F18 (SURFACE) lands beyond auth (F01 §4.6). */
export async function GET() {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    throw error;
  }

  return NextResponse.json({
    state: 'fixture',
    route: '/api/admin/costs',
    owner: 'F18 (SURFACE)',
    data: null,
  });
}
