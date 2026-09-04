import { NextResponse } from 'next/server';
import {
  requireAdmin,
  UnauthenticatedError,
  UnauthorizedError,
  PasswordChangeRequiredError,
} from '@/services/auth';
import { runAdminMutation } from '@/services/admin/mutation';
import { rollbackSettingsMutation } from '@/services/admin/settings';
import { mutationResponse } from '@/services/admin/http';

/** F15 §4.4 — settings rollback: activates a prior config_version's full catalogue as a new version. */
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

  const outcome = await runAdminMutation(rollbackSettingsMutation, body, session);
  return mutationResponse(outcome);
}
