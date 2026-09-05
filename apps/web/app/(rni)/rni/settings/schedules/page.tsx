import { redirect } from 'next/navigation';
import {
  requireAdmin,
  UnauthenticatedError,
  UnauthorizedError,
  PasswordChangeRequiredError,
} from '@/services/auth';
import { AdminDenied } from '@/ui/AdminDenied';
import { createLiveScheduleSettingsService } from '@/rni/settings/schedule/service';
import { ScheduleSettingsLiveHarness } from '@/rni/ui/ScheduleSettingsLiveHarness';
import { ReadSurfaceState } from '@/rni/ui/ReadSurfaceState';

export const dynamic = 'force-dynamic';

export default async function RniScheduleSettingsPage() {
  let actorId: string;
  try {
    actorId = (await requireAdmin()).userId;
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect('/sign-in');
    if (error instanceof PasswordChangeRequiredError) redirect('/change-password');
    if (error instanceof UnauthorizedError) return <AdminDenied route="/rni/settings/schedules" />;
    throw error;
  }
  try {
    const setting = await createLiveScheduleSettingsService(actorId).getCurrentSchedule();
    return <ScheduleSettingsLiveHarness initialSetting={setting} />;
  } catch {
    return (
      <ReadSurfaceState
        title="Refresh schedule"
        state="unavailable"
        message="The live refresh schedule is unavailable. Check that the environment's scheduled job has been provisioned."
      />
    );
  }
}
