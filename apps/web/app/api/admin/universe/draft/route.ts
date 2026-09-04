import { NextResponse } from 'next/server';
import {
  requireAdmin,
  UnauthenticatedError,
  UnauthorizedError,
  PasswordChangeRequiredError,
} from '@/services/auth';
import { runAdminMutation } from '@/services/admin/mutation';
import { draftUniverseMutation } from '@/services/admin/universe';
import { mutationResponse } from '@/services/admin/http';

/** F15 §4.3/§4.1 — the uniform mutation contract's draft step for the universe selector. */
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

  const outcome = await runAdminMutation(draftUniverseMutation, body, session);
  return mutationResponse(outcome);
}
