import { redirect } from 'next/navigation';
import {
  PasswordChangeRequiredError,
  requireAdmin,
  UnauthenticatedError,
  UnauthorizedError,
} from '@/services/auth';
import { AdminDenied } from '@/ui/AdminDenied';
import { createLiveAiRouteSettingsService } from '@/rni/settings/ai-route/service';
import { AiRouteSettingsLiveHarness } from '@/rni/ui/AiRouteSettingsLiveHarness';
import { ReadSurfaceState } from '@/rni/ui/ReadSurfaceState';

export const dynamic = 'force-dynamic';

export default async function RniAiRouteSettingsPage() {
  let actorId: string;
  try {
    actorId = (await requireAdmin()).userId;
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect('/sign-in');
    if (error instanceof PasswordChangeRequiredError) redirect('/change-password');
    if (error instanceof UnauthorizedError) return <AdminDenied route="/rni/settings/ai-route" />;
    throw error;
  }

  try {
    const setting = await createLiveAiRouteSettingsService(actorId).getCurrentAiRouteSetting();
    return <AiRouteSettingsLiveHarness initialSetting={setting} />;
  } catch {
    return (
      <ReadSurfaceState
        message="No usable active AI-route configuration is available. Check the approved capability snapshots and deployment credentials."
        state="unavailable"
        title="AI route settings"
      />
    );
  }
}
