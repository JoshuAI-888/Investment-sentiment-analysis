import { NextResponse } from 'next/server';
import {
  requireAdmin,
  UnauthenticatedError,
  UnauthorizedError,
  PasswordChangeRequiredError,
} from '@/services/auth';
import { getDeploymentSettingsView, getSettingsCatalogueView } from '@/services/admin/reads';
import { runAdminMutation } from '@/services/admin/mutation';
import { updateSettingMutation } from '@/services/admin/settings';
import { mutationResponse } from '@/services/admin/http';

/**
 * F15 §4.2 — the settings tab. GET renders the allowlisted catalogue with current values
 * (falling back to each entry's default when no config_version has ever carried it) plus the
 * deployment-secrets section: **status and a fixed-length mask only**, never a value (DoD item 3).
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

  const { activeConfigVersion, catalogue } = await getSettingsCatalogueView();
  const { secrets, plain } = getDeploymentSettingsView();

  return NextResponse.json({
    state: 'ready',
    route: '/api/admin/settings',
    activeConfigVersion,
    catalogue,
    deploymentSecrets: secrets,
    deploymentPlain: plain,
  });
}

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

  const outcome = await runAdminMutation(updateSettingMutation, body, session);
  return mutationResponse(outcome);
}
