import { redirect } from 'next/navigation';
import {
  PasswordChangeRequiredError,
  requireAdmin,
  UnauthenticatedError,
  UnauthorizedError,
} from '@/services/auth';
import { AdminDenied } from '@/ui/AdminDenied';
import { createLiveRniUniverseReadService } from '@/rni/read-model';
import { ManualRefreshControls } from '@/rni/ui/ManualRefreshControls';
import { ReadSurfaceState } from '@/rni/ui/ReadSurfaceState';

export const dynamic = 'force-dynamic';

export default async function RniRefreshPage() {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect('/sign-in');
    if (error instanceof PasswordChangeRequiredError) redirect('/change-password');
    if (error instanceof UnauthorizedError) return <AdminDenied route="/rni/refresh" />;
    throw error;
  }

  try {
    const active = await createLiveRniUniverseReadService().getActiveUniverse();
    return (
      <ManualRefreshControls
        scopeContext={{
          defaultSecurity: active.defaultSecurity,
          securityCount: active.version.securityCount,
          universeVersion: active.version.id,
        }}
      />
    );
  } catch {
    return (
      <ReadSurfaceState
        message="The active universe could not be verified, so no refresh request can be submitted."
        state="unavailable"
        title="Manual refresh"
      />
    );
  }
}
