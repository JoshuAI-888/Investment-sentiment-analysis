import { NextResponse } from 'next/server';
import {
  requireAdmin,
  UnauthenticatedError,
  UnauthorizedError,
  PasswordChangeRequiredError,
} from '@/services/auth';
import { getCalculationIssuesView } from '@/services/admin/reads';
import type { CalculationIssue } from '@/contracts/calculation';

/** F15 §4.6 — the calculation-issue queue, read side. */
export async function GET(request: Request) {
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

  const url = new URL(request.url);
  const status = url.searchParams.get('status') as CalculationIssue['status'] | null;
  const issues = await getCalculationIssuesView({ status: status ?? undefined });

  return NextResponse.json({ state: 'ready', route: '/api/admin/calculation-issues', issues });
}
