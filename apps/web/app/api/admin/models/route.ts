import { NextResponse } from 'next/server';
import {
  requireAdmin,
  UnauthenticatedError,
  UnauthorizedError,
  PasswordChangeRequiredError,
} from '@/services/auth';
import { getModelRoutesView } from '@/services/admin/reads';

/**
 * F15 §4.2 — the models tab. **Read-only in this build**: `model_route` rows for the active
 * config version, from local data, no provider call. The write side (an allowlisted-model
 * mutation through the same uniform pipeline as `settings.update`) is deferred — reported in
 * this feature's PR body under Deferred, with the trigger. Nothing here echoes a credential;
 * `model_route` carries none.
 */
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

  const { activeConfigVersion, routes } = await getModelRoutesView();

  return NextResponse.json({
    state: 'ready',
    route: '/api/admin/models',
    activeConfigVersion,
    routes,
  });
}
